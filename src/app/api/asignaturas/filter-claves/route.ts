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

    // 1. Obtener conteo total para paginación segura
    const { count: totalCount, error: countErr } = await supabase
      .from("asignaturas")
      .select("id", { count: "exact", head: true });

    if (countErr) {
      throw new Error(`Error al consultar catálogo de asignaturas: ${countErr.message}`);
    }

    const total = totalCount || 0;
    const PAGE_SIZE = 1000;
    const numPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const allRows: any[] = [];

    // 2. Descargar ÚNICAMENTE metadatos ultraligeros de asignaturas (sin vectores de 768d ni textos masivos)
    // Se ejecuta en paralelo para máxima velocidad y previene de raíz el error 'canceling statement due to statement timeout'
    const pagePromises = [];
    for (let i = 0; i < numPages; i++) {
      const from = i * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      pagePromises.push(
        supabase
          .from("asignaturas")
          .select("id, clave, nombre, cluster, match_nombre")
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
      if (cClean && inputSet.has(cClean)) {
        matchedRows.push({ ...row, cleanClave: cClean });
        matchedCleanClaves.add(cClean);
      }
    }

    const matchedIds = matchedRows.map((r) => r.id);

    // 4. Descubrir columnas vectoriales disponibles muestreando un número mínimo de registros
    // Se evita por completo consultar 'embedding_768' o 'vectors' sobre las cientos de filas filtradas,
    // ya que deserializar miles de floats de 768 dimensiones satura la red y provoca el statement_timeout.
    // El frontend solo requiere conocer los nombres de las columnas vectoriales para los selectores de peso.
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

    // 5. Construir asignaturas filtradas ultraligeras (sin transferir megabytes de floats)
    const matchedAsignaturas: FilteredAsignatura[] = matchedRows.map((row) => ({
      id: row.id,
      clave: row.clave,
      cleanClave: row.cleanClave,
      nombre: row.nombre,
      cluster: row.cluster || null,
      contenido_tematico: "",
      match_nombre: Boolean(row.match_nombre),
      hasEmbedding: true,
      vectors: null,
      vectorColumns: availableColsArray,
    }));

    // Identificar claves que no se encontraron en la base de datos
    const unmatchedClaves = uniqueInputClaves.filter((k) => !matchedCleanClaves.has(k));

    return NextResponse.json({
      success: true,
      matchedAsignaturas,
      matchedIds,
      matchedCount: matchedAsignaturas.length,
      unmatchedClaves,
      totalUploadedClaves: uniqueInputClaves.length,
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
