import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";
import { Asignatura } from "@/types";
import { parseEmbeddingValue } from "@/lib/utils";

export const maxDuration = 60;

/**
 * GET /api/asignaturas: Obtiene el listado y métricas de la tabla asignaturas
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createDirectServerClient();
    const { searchParams } = new URL(req.url);

    const query = searchParams.get("q") || "";
    const filter = searchParams.get("filter") || "all"; // 'all' | 'with_embedding' | 'without_embedding'
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // 1. Verificar si la tabla 'asignaturas' existe y contar totales
    const { count: totalCount, error: countErr } = await supabase
      .from("asignaturas")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      return NextResponse.json({
        success: false,
        tableExists: false,
        error: `La tabla 'asignaturas' no parece existir o no es accesible: ${countErr.message}`,
        totalCount: 0,
        withEmbeddingCount: 0,
        withoutEmbeddingCount: 0,
        records: [],
      });
    }

    // 2. Contar con y sin embeddings
    const { count: withEmbeddingCount } = await supabase
      .from("asignaturas")
      .select("*", { count: "exact", head: true })
      .not("embedding_768", "is", null);

    const withoutEmbeddingCount = (totalCount || 0) - (withEmbeddingCount || 0);

    // 3. Consultar registros filtrados con soporte multi-vector
    let selectFields = "id, clave, nombre, cluster, fines_de_aprendizaje_o_formacion, contenido_tematico, actividades_de_aprendizaje, match_nombre, match_semantico, created_at, embedding_768, vectors";
    let queryBuilder = supabase
      .from("asignaturas")
      .select(selectFields)
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);

    if (query) {
      queryBuilder = queryBuilder.or(`nombre.ilike.%${query}%,clave.ilike.%${query}%,cluster.ilike.%${query}%`);
    }

    if (filter === "with_embedding") {
      queryBuilder = queryBuilder.not("embedding_768", "is", null);
    } else if (filter === "without_embedding") {
      queryBuilder = queryBuilder.is("embedding_768", null);
    }

    let records: any[] | null = null;
    const { data: recs, error: fetchErr } = await queryBuilder;

    if (fetchErr) {
      // Si la columna 'vectors' no existe aún en la base de datos, fallback seguro sin 'vectors'
      if (fetchErr.message?.includes("vectors") || fetchErr.code === "42703") {
        selectFields = "id, clave, nombre, cluster, fines_de_aprendizaje_o_formacion, contenido_tematico, actividades_de_aprendizaje, match_nombre, match_semantico, created_at, embedding_768";
        let fallbackQuery = supabase
          .from("asignaturas")
          .select(selectFields)
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1);

        if (query) {
          fallbackQuery = fallbackQuery.or(`nombre.ilike.%${query}%,clave.ilike.%${query}%,cluster.ilike.%${query}%`);
        }
        if (filter === "with_embedding") {
          fallbackQuery = fallbackQuery.not("embedding_768", "is", null);
        } else if (filter === "without_embedding") {
          fallbackQuery = fallbackQuery.is("embedding_768", null);
        }

        const { data: fallbackRecs, error: fallbackErr } = await fallbackQuery;
        if (fallbackErr) throw fallbackErr;
        records = fallbackRecs;
      } else {
        throw fetchErr;
      }
    } else {
      records = recs;
    }

    // Identificar columnas vectoriales para cada registro
    const allKnownVectorCols = new Set<string>();
    const sanitizedRecords = (records || []).map((r) => {
      const vCols: string[] = [];
      if (r.embedding_768 && Array.isArray(r.embedding_768) && r.embedding_768.length > 0) {
        vCols.push("embedding_768");
        allKnownVectorCols.add("embedding_768");
      }
      if (r.vectors && typeof r.vectors === "object") {
        Object.keys(r.vectors).forEach((vk) => {
          if (!vCols.includes(vk)) {
            vCols.push(vk);
            allKnownVectorCols.add(vk);
          }
        });
      }

      return {
        ...r,
        hasEmbedding: vCols.length > 0,
        vectorColumns: vCols,
        embedding_768: undefined, // no enviar los 768 floats en cada fila de preview
        vectors: undefined,
      };
    });

    return NextResponse.json({
      success: true,
      tableExists: true,
      totalCount: totalCount || 0,
      withEmbeddingCount: withEmbeddingCount || 0,
      withoutEmbeddingCount: Math.max(0, withoutEmbeddingCount),
      availableVectorColumns: Array.from(allKnownVectorCols),
      records: sanitizedRecords,
    });
  } catch (error: any) {
    console.error("Error en GET /api/asignaturas:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al obtener asignaturas" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/asignaturas: Carga o actualiza asignaturas en lotes con soporte multi-vector
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createDirectServerClient();
    const body = await req.json().catch(() => ({}));
    const asignaturas: Asignatura[] = body.asignaturas || [];
    const mode: "insert" | "upsert" = body.mode || "upsert";

    if (!Array.isArray(asignaturas) || asignaturas.length === 0) {
      return NextResponse.json(
        { success: false, error: "Debes enviar un array de asignaturas." },
        { status: 400 }
      );
    }

    // Columnas base del esquema public.asignaturas
    const tableColumns = new Set([
      "clave",
      "nombre",
      "cluster",
      "fines_de_aprendizaje_o_formacion",
      "contenido_tematico",
      "actividades_de_aprendizaje",
      "match_nombre",
      "match_semantico",
      "dot_product_match",
      "embedding_768",
      "vectors",
    ]);

    // Consultar dinámicamente si la tabla tiene más columnas en Supabase
    try {
      const { data: sampleRow } = await supabase.from("asignaturas").select("*").limit(1);
      if (sampleRow && sampleRow.length > 0) {
        Object.keys(sampleRow[0]).forEach((c) => tableColumns.add(c.toLowerCase()));
      }
    } catch {
      // Ignorar si la tabla está vacía
    }

    // Limpiar y preparar payload con soporte multi-vector
    const payload = asignaturas.map((a) => {
      const item: any = {};
      const vectorsMap: Record<string, number[]> = {};

      // Si ya viene un mapa de vectores pre-parseado
      if (a.vectors && typeof a.vectors === "object") {
        for (const [vKey, vVal] of Object.entries(a.vectors)) {
          if (Array.isArray(vVal) && vVal.length > 0) {
            vectorsMap[vKey] = vVal;
          } else if (typeof vVal === "string") {
            const parsed = parseEmbeddingValue(vVal);
            if (parsed && parsed.length > 0) vectorsMap[vKey] = parsed;
          }
        }
      }

      Object.entries(a).forEach(([rawKey, val]) => {
        if (rawKey === "vectors") return;

        const normKey = rawKey
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        if (normKey === "id" && !val) return;
        if (normKey === "created_at") return;

        // Tratar campo de embedding principal o vectorial
        if (
          normKey === "embedding_768" ||
          normKey === "embedding" ||
          normKey === "vector" ||
          normKey === "embeddings"
        ) {
          if (val) {
            let vec: number[] | null = null;
            if (Array.isArray(val) && val.length > 0) {
              vec = val;
            } else if (typeof val === "string") {
              vec = parseEmbeddingValue(val);
            }
            if (vec && vec.length > 0) {
              item.embedding_768 = vec;
              vectorsMap["embedding_768"] = vec;
            }
          }
          return;
        }

        // Si es una columna de vector adicional (ej: vector_temario, embedding_objetivos)
        if (
          (normKey.startsWith("vector_") || normKey.startsWith("embedding_") || normKey.endsWith("_vector") || normKey.endsWith("_embedding")) &&
          normKey !== "dot_product_match"
        ) {
          if (val) {
            let vec: number[] | null = null;
            if (Array.isArray(val) && val.length > 0) {
              vec = val;
            } else if (typeof val === "string") {
              vec = parseEmbeddingValue(val);
            }
            if (vec && vec.length > 0) {
              vectorsMap[rawKey] = vec;
              if (tableColumns.has(normKey)) {
                item[normKey] = vec;
              }
            }
          }
          return;
        }

        // Normalizar aliases comunes a columnas oficiales
        let targetKey = normKey;
        if (normKey === "fines_de_aprendizaje" || normKey === "objetivos" || normKey === "objetivo") {
          targetKey = "fines_de_aprendizaje_o_formacion";
        } else if (normKey === "temario" || normKey === "contenido" || normKey === "temas") {
          targetKey = "contenido_tematico";
        } else if (normKey === "actividades" || normKey === "estrategias") {
          targetKey = "actividades_de_aprendizaje";
        } else if (normKey === "codigo" || normKey === "cve") {
          targetKey = "clave";
        } else if (normKey === "asignatura" || normKey === "materia") {
          targetKey = "nombre";
        }

        // Si la columna pertenece a las columnas de la tabla Supabase
        if (tableColumns.has(targetKey)) {
          if (targetKey === "match_nombre" || targetKey === "match_semantico") {
            item[targetKey] =
              val === true ||
              String(val).toLowerCase() === "true" ||
              String(val) === "1" ||
              String(val).toLowerCase() === "t";
          } else if (targetKey === "dot_product_match") {
            const num = parseFloat(String(val));
            item[targetKey] = !isNaN(num) ? num : null;
          } else if (typeof val === "string") {
            item[targetKey] = val.trim() !== "" ? val.trim() : null;
          } else {
            item[targetKey] = val != null ? val : null;
          }
        }
      });

      // Asegurar que nombre esté presente y limpio
      if (!item.nombre && a.nombre) {
        item.nombre = String(a.nombre).trim();
      }

      // Si no tiene embedding_768 principal pero hay vectores en vectorsMap, asignar el primero
      if (!item.embedding_768 && Object.keys(vectorsMap).length > 0) {
        item.embedding_768 = Object.values(vectorsMap)[0];
      }

      // Adjuntar mapa de vectores
      if (Object.keys(vectorsMap).length > 0) {
        item.vectors = vectorsMap;
      }

      return item;
    });

    let result;
    const executeSave = async (dataPayload: any[]) => {
      if (mode === "upsert") {
        let res = await supabase
          .from("asignaturas")
          .upsert(dataPayload, { onConflict: "clave" })
          .select("id, clave, nombre");

        if (
          res.error &&
          (res.error.code === "42P10" ||
            res.error.message?.includes("unique or exclusion constraint") ||
            res.error.message?.includes("ON CONFLICT"))
        ) {
          console.warn("Fallback automático a insert:", res.error.message);
          res = await supabase
            .from("asignaturas")
            .insert(dataPayload)
            .select("id, clave, nombre");
        }
        return res;
      } else {
        return await supabase
          .from("asignaturas")
          .insert(dataPayload)
          .select("id, clave, nombre");
      }
    };

    result = await executeSave(payload);

    // Si falló debido a que la columna 'vectors' no existe aún en Supabase, reintentar sin el campo vectors
    if (result.error && (result.error.message?.includes("vectors") || result.error.code === "42703")) {
      console.warn("La columna 'vectors' no existe aún en Supabase. Reintentando guardado con embedding_768...");
      const strippedPayload = payload.map((p) => {
        const copy = { ...p };
        delete copy.vectors;
        return copy;
      });
      result = await executeSave(strippedPayload);
    }

    if (result.error) {
      console.error("Error al guardar asignaturas:", result.error);
      return NextResponse.json(
        { success: false, error: `Error en Supabase: ${result.error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: result.data?.length || payload.length,
      data: result.data,
    });
  } catch (error: any) {
    console.error("Error en POST /api/asignaturas:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al procesar inserción" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/asignaturas: Elimina una asignatura o limpia el catálogo de prueba
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = createDirectServerClient();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const clearAll = searchParams.get("clearAll") === "true";

    if (id) {
      const { error } = await supabase.from("asignaturas").delete().eq("id", id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: `Asignatura ${id} eliminada.` });
    }

    if (clearAll) {
      const { error } = await supabase.from("asignaturas").delete().neq("id", 0);
      if (error) throw error;
      return NextResponse.json({ success: true, message: "Todas las asignaturas han sido eliminadas." });
    }

    return NextResponse.json(
      { success: false, error: "Parámetro 'id' o 'clearAll=true' requerido." },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Error al eliminar" },
      { status: 500 }
    );
  }
}
