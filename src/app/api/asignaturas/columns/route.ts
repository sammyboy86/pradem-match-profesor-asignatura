import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * GET /api/asignaturas/columns: Obtiene la lista de todas las columnas existentes en public.asignaturas
 */
export async function GET() {
  try {
    const supabase = createDirectServerClient();

    // Consultar una fila de muestra para inspeccionar los nombres de columnas
    const { data, error } = await supabase.from("asignaturas").select("*").limit(1);

    if (error) {
      throw error;
    }

    const defaultColumns = [
      "id",
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
      "created_at",
    ];

    const discoveredColumns = new Set<string>(defaultColumns);
    if (data && data.length > 0) {
      Object.keys(data[0]).forEach((c) => discoveredColumns.add(c.toLowerCase()));
    }

    return NextResponse.json({
      success: true,
      columns: Array.from(discoveredColumns),
    });
  } catch (error: any) {
    console.error("Error al obtener columnas de asignaturas:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al obtener columnas" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/asignaturas/columns: Crea una nueva columna en public.asignaturas dinámicamente
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawName: string = body.columnName || body.name || "";
    const rawType: string = body.columnType || body.type || "TEXT";

    if (!rawName.trim()) {
      return NextResponse.json(
        { success: false, error: "El nombre de la columna es requerido." },
        { status: 400 }
      );
    }

    // Sanitizar nombre de columna (alfanumérico y guiones bajos)
    const cleanName = rawName
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "");

    if (!cleanName) {
      return NextResponse.json(
        { success: false, error: "El nombre de la columna debe contener caracteres alfanuméricos válidos." },
        { status: 400 }
      );
    }

    // Validar tipo de columna permitido
    let cleanType = rawType.trim().toUpperCase();
    const allowedTypes = [
      "TEXT",
      "VARCHAR",
      "INTEGER",
      "BIGINT",
      "REAL",
      "DOUBLE PRECISION",
      "BOOLEAN",
      "TIMESTAMPTZ",
      "JSONB",
    ];

    if (!allowedTypes.includes(cleanType)) {
      cleanType = "TEXT";
    }

    const supabase = createDirectServerClient();

    // Intentar crear la columna vía RPC en Supabase
    const { data: rpcSuccess, error: rpcError } = await supabase.rpc("add_asignatura_column", {
      col_name: cleanName,
      col_type: cleanType,
    });

    if (rpcError) {
      console.warn("RPC add_asignatura_column falló o no existe:", rpcError.message);
      const sqlCommand = `ALTER TABLE public.asignaturas ADD COLUMN IF NOT EXISTS ${cleanName} ${cleanType};`;

      return NextResponse.json({
        success: false,
        rpcMissing: true,
        columnName: cleanName,
        columnType: cleanType,
        sql: sqlCommand,
        error: `La función RPC 'add_asignatura_column' no está instalada en tu base de datos Supabase. Ejecuta este comando en el SQL Editor: ${sqlCommand}`,
      });
    }

    return NextResponse.json({
      success: true,
      columnName: cleanName,
      columnType: cleanType,
      message: `Columna '${cleanName}' creada exitosamente en la tabla asignaturas.`,
    });
  } catch (error: any) {
    console.error("Error en POST /api/asignaturas/columns:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al crear nueva columna" },
      { status: 500 }
    );
  }
}
