import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";
import { generateSingleEmbedding } from "@/lib/gemini/embeddings";
import { Profesor, QueryConfig, MatchResultItem, ProfesorMatchResult } from "@/types";

export const maxDuration = 120; // 2 minutos para procesamiento de matching en lotes

export async function POST(req: NextRequest) {
  try {
    const headerKey = req.headers.get("x-gemini-api-key") || undefined;
    const body = await req.json().catch(() => ({}));

    const apiKey = headerKey || body.apiKey;
    const profesores: Profesor[] = body.profesores || [];
    const queryConfigs: QueryConfig[] = body.queryConfigs || [];
    const filterMode: "threshold" | "topK" | "both" = body.filterMode || "both";
    const threshold: number = typeof body.threshold === "number" ? body.threshold : 0.65;
    const topK: number = typeof body.topK === "number" ? Math.max(1, body.topK) : 3;

    if (!profesores.length) {
      return NextResponse.json(
        { success: false, error: "Debes proporcionar una lista de 'profesores'." },
        { status: 400 }
      );
    }

    const activeConfigs = queryConfigs.filter((c) => c.active);
    if (!activeConfigs.length) {
      return NextResponse.json(
        { success: false, error: "Debes seleccionar al menos un campo activo para el matching." },
        { status: 400 }
      );
    }

    // Normalizar pesos sum(w_i) = 1.0
    const totalRawWeight = activeConfigs.reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0);
    const normalizedConfigs = activeConfigs.map((c) => ({
      ...c,
      normalizedWeight: totalRawWeight > 0 ? (c.weight > 0 ? c.weight / totalRawWeight : 0) : 1 / activeConfigs.length,
    }));

    const supabase = createDirectServerClient();

    const results: ProfesorMatchResult[] = [];

    // Procesar cada profesor secuencialmente o en micro-lotes para controlar cuota de Gemini
    for (const prof of profesores) {
      try {
        // Mapa temporal para consolidar asignaturas y sus similitudes por campo:
        // asignaturaId -> { id, clave, nombre, contenido_tematico, fieldSims: { [field]: score } }
        const candidateMap = new Map<
          number,
          {
            id: number;
            clave: string;
            nombre: string;
            contenido_tematico: string;
            fieldSims: Record<string, number>;
          }
        >();

        // Para cada criterio activo, generar embedding y consultar match_asignaturas_cosine
        for (const config of normalizedConfigs) {
          const rawVal = prof[config.field];
          const valText = typeof rawVal === "string" ? rawVal.trim() : rawVal != null ? String(rawVal).trim() : "";

          if (!valText) {
            // El profesor no tiene información en este campo específico
            continue;
          }

          // Interpolar en la plantilla de query asimétrica
          const queryText = config.template.includes("{value}")
            ? config.template.replace(/\{value\}/g, valText)
            : `${config.template}: ${valText}`;

          // Generar embedding 768d con Gemini
          const embedding = await generateSingleEmbedding(queryText, apiKey);

          // Consultar match_asignaturas_cosine en Supabase con match_count suficiente para cubrir todo el catálogo
          const { data: matches, error: rpcError } = await supabase.rpc("match_asignaturas_cosine", {
            query_embedding: embedding,
            match_count: Math.max(500, topK * 2),
            similarity_threshold: 0.0,
          });

          if (rpcError) {
            console.error("Error en RPC match_asignaturas_cosine:", rpcError);
            throw new Error(`Error en Supabase RPC match_asignaturas_cosine: ${rpcError.message}`);
          }

          if (Array.isArray(matches)) {
            for (const item of matches) {
              const current = candidateMap.get(item.id) || {
                id: item.id,
                clave: item.clave || "",
                nombre: item.nombre || "",
                contenido_tematico: item.contenido_tematico || "",
                fieldSims: {} as Record<string, number>,
              };
              current.fieldSims[config.field] = Number(item.similarity) || 0;
              candidateMap.set(item.id, current);
            }
          }
        }

        // Calcular similitud compuesta ponderada: sum(w_i * Sim_i)
        const scoredItems: MatchResultItem[] = [];

        for (const candidate of candidateMap.values()) {
          let compositeSim = 0;

          for (const config of normalizedConfigs) {
            const sim = candidate.fieldSims[config.field] || 0;
            compositeSim += config.normalizedWeight * sim;
          }

          // Validación según el modo de filtrado seleccionado por el usuario:
          // 1. 'topK': No filtra por umbral; incluye candidatos para ordenar y tomar los K mejores
          // 2. 'threshold' o 'both': Requiere que compositeSim >= threshold
          const passesFilter =
            filterMode === "topK" ? true : compositeSim >= threshold;

          if (passesFilter) {
            scoredItems.push({
              asignaturaId: candidate.id,
              clave: candidate.clave,
              nombre: candidate.nombre,
              contenido_tematico: candidate.contenido_tematico,
              compositeSimilarity: Number(compositeSim.toFixed(4)),
              fieldSimilarities: Object.fromEntries(
                Object.entries(candidate.fieldSims).map(([k, v]) => [k, Number(v.toFixed(4))])
              ),
            });
          }
        }

        // Ordenar SIEMPRE de MAYOR A MENOR similitud compuesta
        scoredItems.sort((a, b) => b.compositeSimilarity - a.compositeSimilarity);

        // Selección final de asignaturas:
        // - Modo 'threshold': Devuelve todas las que superan el umbral (o hasta topK si se especifica un límite)
        // - Modo 'topK': Devuelve las mejores K asignaturas
        // - Modo 'both': Devuelve las mejores K que además superan el umbral
        const finalMatches =
          filterMode === "threshold"
            ? (topK > 0 ? scoredItems.slice(0, topK) : scoredItems)
            : scoredItems.slice(0, topK);

        results.push({
          profesor: prof,
          matches: finalMatches,
          status: "completed",
        });
      } catch (profError: any) {
        console.error(`Error procesando match para profesor ${prof.nombre_profesor || prof.id}:`, profError);
        results.push({
          profesor: prof,
          matches: [],
          status: "error",
          error: profError.message || "Error al calcular matching",
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
    });
  } catch (error: any) {
    console.error("Error general en /api/match-profesores:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error interno al ejecutar el matching",
      },
      { status: 500 }
    );
  }
}
