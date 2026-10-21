import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";

export const maxDuration = 30;

/**
 * GET /api/asignaturas/clusters?column=cluster
 * Retorna las columnas disponibles en la tabla 'asignaturas' y la lista de valores
 * únicos de la columna especificada (por defecto 'cluster').
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createDirectServerClient();
    const { searchParams } = new URL(req.url);
    const targetColumn = (searchParams.get("column") || "cluster").trim();

    // 1. Obtener una fila de muestra para conocer las columnas disponibles
    let availableColumns: string[] = ["cluster", "nombre", "clave"];
    try {
      const { data: sampleRow, error: sampleErr } = await supabase
        .from("asignaturas")
        .select("*")
        .limit(1);

      if (!sampleErr && sampleRow && sampleRow.length > 0) {
        availableColumns = Object.keys(sampleRow[0]).filter(
          (col) => !["embedding_768", "dot_product_match", "match_nombre", "match_semantico"].includes(col)
        );
      }
    } catch {
      // Usar columnas por defecto si la tabla está vacía
    }

    // 2. Consultar valores únicos de la columna de cluster objetivo
    let uniqueClusters: string[] = [];

    try {
      // Comprobar si la columna objetivo existe en las columnas disponibles
      const colToQuery = availableColumns.includes(targetColumn) ? targetColumn : "cluster";
      const { data: rows, error: clusterErr } = await supabase
        .from("asignaturas")
        .select(colToQuery)
        .not(colToQuery, "is", null)
        .limit(2000);

      if (!clusterErr && Array.isArray(rows)) {
        const set = new Set<string>();
        rows.forEach((r: any) => {
          const val = r[colToQuery];
          if (val !== null && val !== undefined) {
            const strVal = String(val).trim();
            if (strVal.length > 0) {
              set.add(strVal);
            }
          }
        });
        uniqueClusters = Array.from(set).sort();
      }
    } catch (err: any) {
      console.warn("No se pudieron cargar clusters únicos de Supabase:", err.message);
    }

    return NextResponse.json({
      success: true,
      selectedColumn: targetColumn,
      availableColumns,
      clusters: uniqueClusters,
    });
  } catch (error: any) {
    console.error("Error en GET /api/asignaturas/clusters:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al obtener columnas y clusters de asignaturas",
      },
      { status: 500 }
    );
  }
}
