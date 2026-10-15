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

    // Obtener conteo total para paginación segura
    const { count: totalCount, error: countErr } = await supabase
      .from("asignaturas")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      throw new Error(`Error al consultar catálogo de asignaturas: ${countErr.message}`);
    }

    const total = totalCount || 0;
    const PAGE_SIZE = 1000;
    const numPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    // Descargar metadatos básicos en paralelo
    const pagePromises = [];
    for (let i = 0; i < numPages; i++) {
      const from = i * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      pagePromises.push(
        supabase
          .from("asignaturas")
          .select("id, clave, nombre, contenido_tematico, match_nombre")
          .range(from, to)
      );
    }

    const pageResults = await Promise.all(pagePromises);
    const allRows: any[] = [];
    for (const res of pageResults) {
      if (res.error) {
        throw new Error(`Error al leer asignaturas: ${res.error.message}`);
      }
      if (Array.isArray(res.data)) {
        allRows.push(...res.data);
      }
    }

    // Filtrar asignaturas cuya clave limpia coincida con las claves subidas
    const matchedAsignaturas: FilteredAsignatura[] = [];
    const matchedIds: number[] = [];
    const matchedCleanClaves = new Set<string>();

    for (const row of allRows) {
      const cClean = cleanClave(row.clave);
      if (cClean && inputSet.has(cClean)) {
        matchedAsignaturas.push({
          id: row.id,
          clave: row.clave,
          cleanClave: cClean,
          nombre: row.nombre,
          contenido_tematico: row.contenido_tematico || "",
          match_nombre: Boolean(row.match_nombre),
          hasEmbedding: true,
        });
        matchedIds.push(row.id);
        matchedCleanClaves.add(cClean);
      }
    }

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
