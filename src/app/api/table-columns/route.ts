import { NextResponse } from "next/server";
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

// GET: Obtener lista de columnas actuales de la tabla asignaturas_extraidas
export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await checkAdmin(supabase);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 403 });
    }

    // 1. Intentar invocar la RPC get_asignaturas_columns si existe
    const { data: rpcCols, error: rpcError } = await supabase.rpc("get_asignaturas_columns");

    if (!rpcError && Array.isArray(rpcCols) && rpcCols.length > 0) {
      return NextResponse.json({
        success: true,
        tableExists: true,
        columns: rpcCols.map((c: { column_name: string; data_type: string }) => ({
          name: c.column_name,
          type: c.data_type,
        })),
      });
    }

    // 2. Fallback: verificar si la tabla existe y obtener una fila de muestra para inferir columnas
    const { data, error: queryError } = await supabase
      .from("asignaturas_extraidas")
      .select("*")
      .limit(1);

    if (queryError) {
      const isMissingTable =
        queryError.code === "PGRST205" ||
        queryError.message?.toLowerCase().includes("could not find") ||
        queryError.message?.toLowerCase().includes("does not exist");

      return NextResponse.json({
        success: false,
        tableExists: !isMissingTable,
        error: isMissingTable
          ? "La tabla 'public.asignaturas_extraidas' aún no ha sido creada en Supabase."
          : queryError.message,
        code: queryError.code,
      });
    }

    // Inferir columnas de la muestra o devolver columnas estándar de la tabla
    const inferredCols =
      data && data.length > 0
        ? Object.keys(data[0]).map((k) => ({
            name: k,
            type: typeof data[0][k] === "object" ? "jsonb" : typeof data[0][k],
          }))
        : [
            { name: "id", type: "bigint" },
            { name: "created_at", type: "timestamptz" },
            { name: "codigo", type: "text" },
            { name: "nombre", type: "text" },
            { name: "creditos", type: "numeric" },
            { name: "prerrequisitos", type: "jsonb" },
            { name: "departamento", type: "text" },
            { name: "semestre", type: "text" },
          ];

    return NextResponse.json({
      success: true,
      tableExists: true,
      columns: inferredCols,
      note: "Columnas detectadas desde la tabla",
    });
  } catch (err: unknown) {
    console.error("Error al consultar columnas:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
