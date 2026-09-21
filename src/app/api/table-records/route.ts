import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function checkAdmin(supabase: any) {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) return { ok: true };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") {
    return { ok: false, error: "Acceso denegado: se requiere rol de administrador" };
  }
  return { ok: true, user };
}

// GET: Obtener registros de asignaturas_extraidas con métricas de embeddings
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === "all" ? 2000 : Math.min(Math.max(1, parseInt(rawLimit || "100", 10)), 2000);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);
    const targetColumn = (searchParams.get("targetColumn") || "embedding").trim().toLowerCase().replace(/\s+/g, "_");
    const filter = searchParams.get("filter") || "all"; // 'all' | 'with_embedding' | 'without_embedding'

    const supabase = await createClient();
    const auth = await checkAdmin(supabase);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 403 });
    }

    // 1. Total general de registros
    const { count: totalCount, error: countErr } = await supabase
      .from("asignaturas_extraidas")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      return NextResponse.json(
        {
          success: false,
          error: `Error al consultar asignaturas_extraidas: ${countErr.message}`,
        },
        { status: 400 }
      );
    }

    // 2. Consulta de registros paginados
    let query = supabase
      .from("asignaturas_extraidas")
      .select("*")
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (filter === "with_embedding") {
      query = query.not(targetColumn, "is", null);
    } else if (filter === "without_embedding") {
      query = query.is(targetColumn, null);
    }

    const { data: records, error: recordsErr } = await query;

    if (recordsErr) {
      return NextResponse.json(
        {
          success: false,
          error: recordsErr.message,
        },
        { status: 400 }
      );
    }

    // 3. Conteo de registros con embedding (si la columna existe)
    let countWithEmbedding = 0;
    try {
      const { count: countEmbeddings } = await supabase
        .from("asignaturas_extraidas")
        .select("*", { count: "exact", head: true })
        .not(targetColumn, "is", null);
      countWithEmbedding = countEmbeddings || 0;
    } catch {
      countWithEmbedding = 0;
    }

    return NextResponse.json({
      success: true,
      records: records || [],
      totalCount: totalCount || 0,
      countWithEmbedding,
      countWithoutEmbedding: Math.max(0, (totalCount || 0) - countWithEmbedding),
      limit,
      offset,
    });
  } catch (err: unknown) {
    console.error("Error al obtener registros:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
