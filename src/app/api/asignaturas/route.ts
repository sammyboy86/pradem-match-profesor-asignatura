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

    // 3. Consultar registros filtrados
    let queryBuilder = supabase
      .from("asignaturas")
      .select("id, clave, nombre, cluster, fines_de_aprendizaje_o_formacion, contenido_tematico, actividades_de_aprendizaje, match_nombre, match_semantico, created_at, embedding_768")
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

    const { data: records, error: fetchErr } = await queryBuilder;

    if (fetchErr) {
      throw fetchErr;
    }

    // Omitir array grande de floats en el response de lista para aligerar carga de red,
    // pero indicar si tiene embedding_768
    const sanitizedRecords = (records || []).map((r) => ({
      ...r,
      hasEmbedding: Boolean(r.embedding_768 && Array.isArray(r.embedding_768) && r.embedding_768.length > 0),
      embedding_768: undefined, // no enviar los 768 floats en cada fila de preview
    }));

    return NextResponse.json({
      success: true,
      tableExists: true,
      totalCount: totalCount || 0,
      withEmbeddingCount: withEmbeddingCount || 0,
      withoutEmbeddingCount: Math.max(0, withoutEmbeddingCount),
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
 * POST /api/asignaturas: Carga o actualiza asignaturas en lotes
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

    // Limpiar y preparar payload con TODAS las columnas del CSV compatibles
    const payload = asignaturas.map((a) => {
      const item: any = {};

      Object.entries(a).forEach(([rawKey, val]) => {
        const normKey = rawKey
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        if (normKey === "id" && !val) return;
        if (normKey === "created_at") return;

        // Tratar campo de embedding
        if (normKey === "embedding_768" || normKey === "embedding" || normKey === "vector" || normKey === "embeddings") {
          if (val) {
            if (Array.isArray(val) && val.length > 0) {
              item.embedding_768 = val;
            } else if (typeof val === "string") {
              const parsed = parseEmbeddingValue(val);
              if (parsed && parsed.length > 0) {
                item.embedding_768 = parsed;
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

      return item;
    });

    let result;
    if (mode === "upsert") {
      // Upsert basado en clave si está disponible
      result = await supabase
        .from("asignaturas")
        .upsert(payload, { onConflict: "clave" })
        .select("id, clave, nombre");

      // Si falla por falta de restricción única en 'clave' (código 42P10 o mensaje ON CONFLICT), realizar fallback a insert
      if (
        result.error &&
        (result.error.code === "42P10" ||
          result.error.message?.includes("unique or exclusion constraint") ||
          result.error.message?.includes("ON CONFLICT"))
      ) {
        console.warn(
          "No existe constraint UNIQUE en 'clave' en Supabase. Realizando fallback automático a insert:",
          result.error.message
        );
        result = await supabase
          .from("asignaturas")
          .insert(payload)
          .select("id, clave, nombre");
      }
    } else {
      result = await supabase
        .from("asignaturas")
        .insert(payload)
        .select("id, clave, nombre");
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
