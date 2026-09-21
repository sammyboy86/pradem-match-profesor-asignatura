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

// POST: Asegurar que una columna exista en asignaturas_extraidas (crearla si falta)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { columnName, columnType = "jsonb" } = body;

    if (!columnName || typeof columnName !== "string") {
      return NextResponse.json(
        { error: "Nombre de columna requerido" },
        { status: 400 }
      );
    }

    const cleanName = columnName.trim().toLowerCase().replace(/\s+/g, "_");

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanName)) {
      return NextResponse.json(
        { error: "Nombre de columna inválido. Solo letras, números y guión bajo (_)." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const auth = await checkAdmin(supabase);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 403 });
    }

    // 1. Verificar si la columna ya existe consultando un registro
    const { data: sampleRow, error: sampleErr } = await supabase
      .from("asignaturas_extraidas")
      .select("*")
      .limit(1);

    if (!sampleErr && sampleRow && sampleRow.length > 0) {
      if (cleanName in sampleRow[0]) {
        return NextResponse.json({
          success: true,
          exists: true,
          created: false,
          column: cleanName,
          message: `La columna '${cleanName}' ya existe en la tabla asignaturas_extraidas.`,
        });
      }
    }

    // 2. Intentar llamar a RPC add_asignaturas_column
    const { data: rpcRes, error: rpcErr } = await supabase.rpc("add_asignaturas_column", {
      col_name: cleanName,
      col_type: columnType,
    });

    if (rpcErr) {
      // Si la función RPC no existe o dio error
      return NextResponse.json(
        {
          success: false,
          error: `Error al crear columna mediante RPC: ${rpcErr.message}. Puedes crearla manualmente en Supabase SQL: ALTER TABLE public.asignaturas_extraidas ADD COLUMN IF NOT EXISTS ${cleanName} ${columnType};`,
          sqlSnippet: `ALTER TABLE public.asignaturas_extraidas ADD COLUMN IF NOT EXISTS ${cleanName} ${columnType};`,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      exists: true,
      created: true,
      column: cleanName,
      type: columnType,
      message: `Columna '${cleanName}' creada exitosamente en asignaturas_extraidas.`,
    });
  } catch (err: unknown) {
    console.error("Error al asegurar columna:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno al verificar/crear columna" },
      { status: 500 }
    );
  }
}
