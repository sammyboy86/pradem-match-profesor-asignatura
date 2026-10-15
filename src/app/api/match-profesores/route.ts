import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";
import { generateSingleEmbedding } from "@/lib/gemini/embeddings";
import { Profesor, QueryConfig, MatchResultItem, ProfesorMatchResult } from "@/types";

export const maxDuration = 120; // 2 minutos para procesamiento de matching en lotes

function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < 768; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

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

    // Filtro opcional de asignaturas (IDs específicos pasados tras el paso inicial de filtro)
    const rawFilterIds: unknown[] = Array.isArray(body.filterAsignaturaIds) ? body.filterAsignaturaIds : [];
    const filterAsignaturaIds: number[] = rawFilterIds
      .map((id) => Number(id))
      .filter((id) => !isNaN(id) && id > 0);

    const hasFilter = filterAsignaturaIds.length > 0;

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

    // Si hay filtro activo, cargar previamente las asignaturas objetivo y sus embeddings
    let targetAsignaturas: {
      id: number;
      clave: string;
      nombre: string;
      contenido_tematico: string;
      match_nombre: boolean;
      embedding: number[];
    }[] | null = null;

    if (hasFilter) {
      const { data: filterRows, error: fetchFilterErr } = await supabase
        .from("asignaturas")
        .select("id, clave, nombre, contenido_tematico, match_nombre, embedding_768")
        .in("id", filterAsignaturaIds)
        .not("embedding_768", "is", null);

      if (fetchFilterErr) {
        throw new Error(`Error al consultar asignaturas filtradas: ${fetchFilterErr.message}`);
      }

      if (!filterRows || filterRows.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Ninguna de las asignaturas filtradas tiene embeddings disponibles en la base de datos.",
          },
          { status: 400 }
        );
      }

      targetAsignaturas = filterRows
        .map((r) => {
          let emb = r.embedding_768;
          if (typeof emb === "string") {
            try {
              emb = JSON.parse(emb);
            } catch {
              emb = null;
            }
          }
          return {
            id: r.id,
            clave: r.clave || "",
            nombre: r.nombre || "",
            contenido_tematico: r.contenido_tematico || "",
            match_nombre: Boolean(r.match_nombre),
            embedding: emb,
          };
        })
        .filter((r) => Array.isArray(r.embedding) && r.embedding.length === 768);

      if (targetAsignaturas.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Los vectores de las asignaturas filtradas no son válidos (requieren dimensión 768).",
          },
          { status: 400 }
        );
      }
    }

    const results: ProfesorMatchResult[] = [];

    // Procesar cada profesor secuencialmente o en micro-lotes
    for (const prof of profesores) {
      try {
        // Mapa temporal: asignaturaId -> { id, clave, nombre, contenido_tematico, match_nombre, fieldSims }
        const candidateMap = new Map<
          number,
          {
            id: number;
            clave: string;
            nombre: string;
            contenido_tematico: string;
            match_nombre?: boolean;
            fieldSims: Record<string, number>;
          }
        >();

        // Para cada criterio activo, generar embedding y calcular similitudes
        for (const config of normalizedConfigs) {
          const rawVal = prof[config.field];
          const valText = typeof rawVal === "string" ? rawVal.trim() : rawVal != null ? String(rawVal).trim() : "";

          if (!valText) {
            continue;
          }

          // Interpolar en la plantilla de query asimétrica
          const queryText = config.template.includes("{value}")
            ? config.template.replace(/\{value\}/g, valText)
            : `${config.template}: ${valText}`;

          // Generar embedding 768d con Gemini
          const embedding = await generateSingleEmbedding(queryText, apiKey);

          if (targetAsignaturas && targetAsignaturas.length > 0) {
            // MODO FILTRADO: La matriz de distancias solo se corre sobre las asignaturas filtradas
            for (const target of targetAsignaturas) {
              const sim = computeCosineSimilarity(embedding, target.embedding);
              const current = candidateMap.get(target.id) || {
                id: target.id,
                clave: target.clave,
                nombre: target.nombre,
                contenido_tematico: target.contenido_tematico,
                match_nombre: target.match_nombre,
                fieldSims: {} as Record<string, number>,
              };
              current.fieldSims[config.field] = sim;
              candidateMap.set(target.id, current);
            }
          } else {
            // MODO CATÁLOGO COMPLETO: Consultar match_asignaturas_cosine en Supabase
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
                  match_nombre: Boolean(item.match_nombre),
                  fieldSims: {} as Record<string, number>,
                };
                current.fieldSims[config.field] = Number(item.similarity) || 0;
                candidateMap.set(item.id, current);
              }
            }
          }
        }

        // Si no estábamos en modo filtrado, asegurar banderas match_nombre
        if (!targetAsignaturas) {
          const candidateIds = Array.from(candidateMap.keys());
          if (candidateIds.length > 0) {
            const { data: flagRows } = await supabase
              .from("asignaturas")
              .select("id, match_nombre")
              .in("id", candidateIds);

            if (Array.isArray(flagRows)) {
              flagRows.forEach((r) => {
                const item = candidateMap.get(r.id);
                if (item) {
                  item.match_nombre = Boolean(r.match_nombre);
                }
              });
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
              match_nombre: Boolean(candidate.match_nombre),
            });
          }
        }

        // Ordenar candidatos preliminarmente de MAYOR A MENOR similitud compuesta
        scoredItems.sort((a, b) => b.compositeSimilarity - a.compositeSimilarity);

        // Selección final de asignaturas respetando cupo Top K y match_nombre
        let finalMatches: MatchResultItem[] = [];

        if (filterMode === "threshold") {
          if (topK > 0 && topK < scoredItems.length) {
            let semanticCount = 0;
            for (const item of scoredItems) {
              if (item.match_nombre) {
                finalMatches.push(item);
              } else if (semanticCount < topK) {
                finalMatches.push(item);
                semanticCount++;
              }
            }
          } else {
            finalMatches = scoredItems;
          }
        } else {
          // Modo 'topK' o 'both'
          let semanticCount = 0;
          for (const item of scoredItems) {
            if (item.match_nombre) {
              finalMatches.push(item);
            } else if (semanticCount < topK) {
              finalMatches.push(item);
              semanticCount++;
            }
          }
        }

        // Ordenar SIEMPRE de MAYOR A MENOR similitud compuesta
        finalMatches.sort((a, b) => b.compositeSimilarity - a.compositeSimilarity);

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
      filteredSubjectCount: targetAsignaturas ? targetAsignaturas.length : null,
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
