import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";
import { cleanClave } from "@/lib/utils";
import { FilteredAsignatura } from "@/types";

export const maxDuration = 60;

/**
 * POST /api/asignaturas/filter-claves
 * Recibe un arreglo de claves subidas por el usuario, aplica la limpieza preliminar
 * (alfanumérico y mayúsculas) y busca las asignaturas correspondientes en Supabase.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawClaves: unknown[] = Array.isArray(body.claves) ? body.claves : [];

    // Limpieza preliminar en el backend por seguridad y consistencia
    const cleanedClaves = rawClaves
      .map((c) => cleanClave(c))
      .filter((c) => c.length > 0);

    const uniqueInputClaves = Array.from(new Set(cleanedClaves));

    if (uniqueInputClaves.length === 0) {
      return NextResponse.json({
        success: true,
        matchedAsignaturas: [],
        matchedIds: [],
        matchedCount: 0,
        unmatchedClaves: [],
        totalUploadedClaves: 0,
      });
    }

    const inputSet = new Set(uniqueInputClaves);
    const supabase = createDirectServerClient();

    const targetClusterCol = (typeof body.clusterColumn === "string" && body.clusterColumn.trim())
      ? body.clusterColumn.trim()
      : "cluster";

    // 1. Obtener conteo total y estructura de columnas disponibles en Supabase
    const { count: totalCount, error: countErr } = await supabase
      .from("asignaturas")
      .select("id", { count: "exact", head: true });

    if (countErr) {
      throw new Error(`Error al consultar catálogo de asignaturas: ${countErr.message}`);
    }

    // Obtener una fila de muestra para descubrir todas las columnas de la tabla en tiempo real
    let availableTableCols: string[] = ["id", "clave", "nombre", "cluster", "match_nombre"];
    try {
      const { data: sampleRows } = await supabase.from("asignaturas").select("*").limit(1);
      if (sampleRows && sampleRows.length > 0) {
        availableTableCols = Object.keys(sampleRows[0]);
      }
    } catch {
      // Ignorar fallback
    }

    // Filtrar columnas para seleccionar únicamente metadatos ultraligeros (omitir floats masivos y textos kilométricos)
    const heavyColumns = new Set([
      "embedding_768",
      "vectors",
      "contenido_tematico",
      "fines_de_aprendizaje_o_formacion",
      "actividades_de_aprendizaje",
    ]);

    const selectColList = availableTableCols.filter((col) => {
      const lower = col.toLowerCase();
      if (heavyColumns.has(lower)) return false;
      if (
        lower.startsWith("embedding_") ||
        lower.startsWith("vector_") ||
        lower.endsWith("_vector") ||
        lower.endsWith("_embedding")
      ) {
        return false;
      }
      return true;
    });

    if (!selectColList.includes("id")) selectColList.unshift("id");
    if (!selectColList.includes("clave")) selectColList.push("clave");
    if (!selectColList.includes("nombre")) selectColList.push("nombre");
    if (!selectColList.includes("cluster") && availableTableCols.includes("cluster")) {
      selectColList.push("cluster");
    }
    if (
      targetClusterCol &&
      !selectColList.includes(targetClusterCol) &&
      availableTableCols.includes(targetClusterCol)
    ) {
      selectColList.push(targetClusterCol);
    }

    const selectCols = selectColList.join(", ");

    const total = totalCount || 0;
    const PAGE_SIZE = 1000;
    const numPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const allRows: any[] = [];

    // 2. Descargar metadatos ligeros de asignaturas más recientes de Supabase
    // Se ejecuta en paralelo para máxima velocidad y previene de raíz el error 'canceling statement due to statement timeout'
    const pagePromises = [];
    for (let i = 0; i < numPages; i++) {
      const from = i * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      pagePromises.push(
        supabase
          .from("asignaturas")
          .select(selectCols)
          .range(from, to)
      );
    }
    const pageResults = await Promise.all(pagePromises);
    for (const res of pageResults) {
      if (res.error) throw res.error;
      if (Array.isArray(res.data)) allRows.push(...res.data);
    }

    // 3. Filtrar asignaturas cuya clave limpia coincida con las claves subidas
    const matchedRows: any[] = [];
    const matchedCleanClaves = new Set<string>();

    for (const row of allRows) {
      const cClean = cleanClave(row.clave);
      const idClean = cleanClave(row.id);
      if (cClean && inputSet.has(cClean)) {
        matchedRows.push({ ...row, cleanClave: cClean });
        matchedCleanClaves.add(cClean);
      } else if (idClean && inputSet.has(idClean)) {
        matchedRows.push({ ...row, cleanClave: idClean });
        matchedCleanClaves.add(idClean);
      }
    }

    const matchedIds = matchedRows.map((r) => r.id);

    // 4. Descubrir columnas vectoriales disponibles muestreando un número mínimo de registros
    const discoveredVectorCols = new Set<string>(["embedding_768"]);
    try {
      const { data: sampleVectors } = await supabase
        .from("asignaturas")
        .select("vectors")
        .not("vectors", "is", null)
        .limit(5);

      (sampleVectors || []).forEach((row: any) => {
        if (row.vectors && typeof row.vectors === "object") {
          Object.keys(row.vectors).forEach((k) => discoveredVectorCols.add(k));
        }
      });
    } catch {
      // Fallback seguro con vector principal
    }

    const availableColsArray = Array.from(discoveredVectorCols);

    // 5. Construir asignaturas filtradas ultraligeras preservando todas las columnas actualizadas de Supabase
    const matchedAsignaturas: FilteredAsignatura[] = matchedRows.map((row) => {
      const clusterVal =
        row[targetClusterCol] !== undefined && row[targetClusterCol] !== null
          ? String(row[targetClusterCol]).trim()
          : row.cluster != null
          ? String(row.cluster).trim()
          : null;

      return {
        ...row,
        id: row.id,
        clave: row.clave,
        cleanClave: row.cleanClave,
        nombre: row.nombre,
        cluster: clusterVal || null,
        contenido_tematico: "",
        match_nombre: Boolean(row.match_nombre),
        hasEmbedding: true,
        vectors: null,
        vectorColumns: availableColsArray,
      };
    });

    // Identificar claves que no se encontraron en la base de datos
    const unmatchedClaves = uniqueInputClaves.filter((k) => !matchedCleanClaves.has(k));

    return NextResponse.json({
      success: true,
      matchedAsignaturas,
      matchedIds,
      matchedCount: matchedAsignaturas.length,
      unmatchedClaves,
      totalUploadedClaves: uniqueInputClaves.length,
      totalCatalogCount: total,
      availableColumns: selectColList.filter(
        (c) => !["id", "match_nombre", "match_semantico", "dot_product_match"].includes(c)
      ),
      availableVectorColumns: availableColsArray,
    });
  } catch (error: any) {
    console.error("Error en POST /api/asignaturas/filter-claves:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al filtrar asignaturas por claves",
      },
      { status: 500 }
    );
  }
}
