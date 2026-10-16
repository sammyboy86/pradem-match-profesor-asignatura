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
      .select("id, clave, nombre, fines_de_aprendizaje_o_formacion, contenido_tematico, actividades_de_aprendizaje, match_nombre, match_semantico, created_at, embedding_768")
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);

    if (query) {
      queryBuilder = queryBuilder.or(`nombre.ilike.%${query}%,clave.ilike.%${query}%`);
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

    // Limpiar y preparar payload
    const payload = asignaturas.map((a) => {
      const item: any = {
        nombre: a.nombre.trim(),
        clave: a.clave ? String(a.clave).trim() : null,
        fines_de_aprendizaje_o_formacion: a.fines_de_aprendizaje_o_formacion || null,
        contenido_tematico: a.contenido_tematico || null,
        actividades_de_aprendizaje: a.actividades_de_aprendizaje || null,
      };

      if (a.embedding_768) {
        if (Array.isArray(a.embedding_768) && a.embedding_768.length > 0) {
          item.embedding_768 = a.embedding_768;
        } else if (typeof a.embedding_768 === "string") {
          const parsed = parseEmbeddingValue(a.embedding_768);
          if (parsed && parsed.length > 0) {
            item.embedding_768 = parsed;
          }
        }
      }

      return item;
    });

    let result;
    if (mode === "upsert") {
      // Upsert basado en clave o nombre si tiene clave
      result = await supabase
        .from("asignaturas")
        .upsert(payload, { onConflict: "clave" })
        .select("id, clave, nombre");
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
