import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";
import {
  generateEmbeddingsBatch,
  computeCompositeEmbedding,
} from "@/lib/gemini/embeddings";
import { geminiRateLimiter } from "@/lib/gemini/rate-limiter";
import { Profesor, QueryConfig, MatchResultItem, ProfesorMatchResult, RegexFilterConfig } from "@/types";
import {
  sanitizarCvParaModelo,
  evaluateProfessorCredentialAcrossFields,
} from "@/lib/sanitizer/cv-sanitizer";

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
    const regexFilter: RegexFilterConfig | undefined = body.regexFilter;

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

    // Configuración opcional de cluster y betas
    const clusterColumn: string = (body.clusterColumn || "cluster").trim();
    const rawClusterBetas: Record<string, Record<string, number>> = body.clusterBetas || {};
    const rawDefaultBetas: Record<string, number> = body.defaultBetas || {};

    // Normalizar pesos base sum(w_i) = 1.0
    const totalRawWeight = activeConfigs.reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0);
    const normalizedConfigs = activeConfigs.map((c) => ({
      ...c,
      normalizedWeight: totalRawWeight > 0 ? (c.weight > 0 ? c.weight / totalRawWeight : 0) : 1 / activeConfigs.length,
    }));

    const weightMap: Record<string, number> = {};
    normalizedConfigs.forEach((c) => {
      weightMap[c.field] = c.normalizedWeight;
    });

    const activeFields = normalizedConfigs.map((c) => c.field);

    // Función auxiliar para normalizar los betas de un cluster
    const normalizeWeights = (rawWeights: Record<string, number>): Record<string, number> => {
      let total = 0;
      activeFields.forEach((f) => {
        const w = typeof rawWeights[f] === "number" && rawWeights[f] > 0 ? rawWeights[f] : 0;
        total += w;
      });
      const res: Record<string, number> = {};
      activeFields.forEach((f) => {
        const w = typeof rawWeights[f] === "number" && rawWeights[f] > 0 ? rawWeights[f] : 0;
        res[f] = total > 0 ? w / total : 1 / activeFields.length;
      });
      return res;
    };

    // Betas predeterminadas (fallback para asignaturas sin cluster o clusters no configurados)
    const normalizedDefaultBetas = Object.keys(rawDefaultBetas).length > 0
      ? normalizeWeights(rawDefaultBetas)
      : weightMap;

    // Matriz de betas normalizadas por cluster
    const normalizedClusterBetas: Record<string, Record<string, number>> = {};
    for (const [cName, betasObj] of Object.entries(rawClusterBetas)) {
      if (betasObj && typeof betasObj === "object") {
        normalizedClusterBetas[cName] = normalizeWeights(betasObj);
      }
    }

    const supabase = createDirectServerClient();

    // Si hay filtro activo, cargar previamente las asignaturas objetivo y sus embeddings
    let targetAsignaturas: {
      id: number;
      clave: string;
      nombre: string;
      cluster: string | null;
      contenido_tematico: string;
      match_nombre: boolean;
      embedding: number[];
    }[] | null = null;

    if (hasFilter) {
      const selectColumns = `id, clave, nombre, contenido_tematico, match_nombre, embedding_768, cluster${
        clusterColumn && clusterColumn !== "cluster" ? `, ${clusterColumn}` : ""
      }`;

      const { data: filterRows, error: fetchFilterErr } = await supabase
        .from("asignaturas")
        .select(selectColumns)
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
        .map((r: any) => {
          let emb = r.embedding_768;
          if (typeof emb === "string") {
            try {
              emb = JSON.parse(emb);
            } catch {
              emb = null;
            }
          }
          const rawClusterVal = r[clusterColumn] !== undefined ? r[clusterColumn] : r.cluster;
          const cleanCluster = rawClusterVal != null && String(rawClusterVal).trim() !== "" ? String(rawClusterVal).trim() : null;

          return {
            id: r.id,
            clave: r.clave || "",
            nombre: r.nombre || "",
            cluster: cleanCluster,
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

    // ── GESTIÓN DE EMBEDDINGS DE PROFESORES: PRECOMPUTADOS vs GEMINI 2 ──
    // Inicializar mapas con cualquier embedding ya provisto en el profesor
    const profFieldEmbeddings: Record<string, number[]>[] = profesores.map((prof) => {
      const existing: Record<string, number[]> = {};
      if (prof.fieldEmbeddings && typeof prof.fieldEmbeddings === "object") {
        for (const [k, v] of Object.entries(prof.fieldEmbeddings)) {
          if (Array.isArray(v) && v.length === 768) {
            existing[k] = v;
          }
        }
      }
      return existing;
    });

    interface EmbeddingTask {
      profIndex: number;
      field: string;
      queryText: string;
    }

    const tasks: EmbeddingTask[] = [];
    const profSanitizationStatuses: ("intact" | "sanitized" | "bypassed")[] = profesores.map((p): "intact" | "sanitized" | "bypassed" => {
      if (p.sanitizationStatus === "intact" || p.sanitizationStatus === "sanitized" || p.sanitizationStatus === "bypassed") {
        return p.sanitizationStatus;
      }
      const filtroCol = p["Filtro Anti-Sesgo"] || p["Filtro Anti Sesgo"] || p["filtro_anti_sesgo"];
      if (typeof filtroCol === "string") {
        const lower = filtroCol.toLowerCase();
        if (lower.includes("sanitiz")) return "sanitized";
        if (lower.includes("intact")) return "intact";
      }
      return regexFilter?.enabled ? "intact" : "bypassed";
    });

    // Solo crear tareas de generación para aquellos campos que NO tengan vector precalculado
    profesores.forEach((prof, profIndex) => {
      let contextHasCredential: boolean | undefined = undefined;
      let profWasSanitized = false;

      if (regexFilter?.enabled) {
        if (regexFilter.checkAcrossAllFields !== false) {
          contextHasCredential = evaluateProfessorCredentialAcrossFields(
            prof,
            regexFilter.regexCredencial
          );
        } else {
          contextHasCredential = evaluateProfessorCredentialAcrossFields(
            prof,
            regexFilter.regexCredencial,
            activeFields
          );
        }

        // Si el docente no cuenta con credencial pedagógica oficial, sanitizar sus campos de texto
        if (!contextHasCredential) {
          Object.keys(prof).forEach((key) => {
            if (
              key === "id" ||
              key === "nombre_profesor" ||
              key === "embedding_768" ||
              key === "fieldEmbeddings" ||
              key === "sanitizationStatus"
            ) {
              return;
            }
            const raw = prof[key];
            if (typeof raw === "string" && raw.trim()) {
              const res = sanitizarCvParaModelo(raw, regexFilter, false);
              if (res.status === "sanitized") {
                profWasSanitized = true;
                prof[key] = res.sanitizedText;
              }
            }
          });
        }

        profSanitizationStatuses[profIndex] = profWasSanitized
          ? "sanitized"
          : "intact";
      }

      for (const config of normalizedConfigs) {
        if (profFieldEmbeddings[profIndex][config.field]) {
          continue; // Ya tiene embedding precalculado
        }

        const rawVal = prof[config.field];
        let valText = typeof rawVal === "string" ? rawVal.trim() : rawVal != null ? String(rawVal).trim() : "";
        if (!valText) continue;

        // Asegurar que si el filtro está activado y el profesor no tiene credencial, el texto esté sanitizado
        if (regexFilter?.enabled && !contextHasCredential) {
          const sanitizedResult = sanitizarCvParaModelo(valText, regexFilter, false);
          valText = sanitizedResult.sanitizedText;
          if (sanitizedResult.status === "sanitized") {
            profWasSanitized = true;
          }
          prof[config.field] = sanitizedResult.sanitizedText;
        }

        const queryText = config.template.includes("{value}")
          ? config.template.replace(/\{value\}/g, valText)
          : `${config.template}: ${valText}`;

        tasks.push({ profIndex, field: config.field, queryText });
      }

      if (regexFilter?.enabled) {
        profSanitizationStatuses[profIndex] = profWasSanitized
          ? "sanitized"
          : "intact";
      }
    });

    if (tasks.length > 0) {
      // Generar embeddings eficientemente en lote con batchEmbedContents y el RateLimitManager
      const taskTexts = tasks.map((t) => t.queryText);
      const generatedVectors = await generateEmbeddingsBatch(taskTexts, {
        apiKey,
        batchChunkSize: 25,
      });

      tasks.forEach((t, i) => {
        const vec = generatedVectors[i];
        if (vec && vec.length === 768) {
          profFieldEmbeddings[t.profIndex][t.field] = vec;
        }
      });
    }

    const results: ProfesorMatchResult[] = [];

    // Procesar matching de cada profesor con sus embeddings ya calculados
    for (let pIdx = 0; pIdx < profesores.length; pIdx++) {
      const prof = profesores[pIdx];
      const fieldEmbeddings = profFieldEmbeddings[pIdx] || {};

      try {
        // Calcular vector compuesto del profesor
        const compositeEmbedding = prof.embedding_768 && prof.embedding_768.length === 768
          ? prof.embedding_768
          : computeCompositeEmbedding(fieldEmbeddings, weightMap);

        // Mapa temporal: asignaturaId -> { id, clave, nombre, cluster, contenido_tematico, match_nombre, fieldSims }
        const candidateMap = new Map<
          number,
          {
            id: number;
            clave: string;
            nombre: string;
            cluster?: string | null;
            contenido_tematico: string;
            match_nombre?: boolean;
            fieldSims: Record<string, number>;
          }
        >();

        // Para cada criterio activo que tenga embedding disponible
        for (const config of normalizedConfigs) {
          const embedding = fieldEmbeddings[config.field];
          if (!embedding) continue;

          if (targetAsignaturas && targetAsignaturas.length > 0) {
            // MODO FILTRADO: La matriz de distancias solo se corre sobre las asignaturas filtradas
            for (const target of targetAsignaturas) {
              const sim = computeCosineSimilarity(embedding, target.embedding);
              const current = candidateMap.get(target.id) || {
                id: target.id,
                clave: target.clave,
                nombre: target.nombre,
                cluster: target.cluster,
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
                  cluster: (item as any).cluster || null,
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

        // Si no estábamos en modo filtrado, asegurar banderas match_nombre y columna cluster
        if (!targetAsignaturas) {
          const candidateIds = Array.from(candidateMap.keys());
          if (candidateIds.length > 0) {
            const selectCandidateFields = `id, match_nombre, cluster${
              clusterColumn && clusterColumn !== "cluster" ? `, ${clusterColumn}` : ""
            }`;
            const { data: flagRows } = await supabase
              .from("asignaturas")
              .select(selectCandidateFields)
              .in("id", candidateIds);

            if (Array.isArray(flagRows)) {
              flagRows.forEach((r: any) => {
                const item = candidateMap.get(r.id);
                if (item) {
                  item.match_nombre = Boolean(r.match_nombre);
                  const rawClVal = r[clusterColumn] !== undefined ? r[clusterColumn] : r.cluster;
                  if (rawClVal != null && String(rawClVal).trim() !== "") {
                    item.cluster = String(rawClVal).trim();
                  }
                }
              });
            }
          }
        }

        // Calcular similitud compuesta ponderada usando los BETAS ESPECÍFICOS DEL CLUSTER de la asignatura
        const scoredItems: MatchResultItem[] = [];

        for (const candidate of candidateMap.values()) {
          let compositeSim = 0;
          const cName = candidate.cluster ? String(candidate.cluster).trim() : "";
          const candidateWeights = (cName && normalizedClusterBetas[cName]) || normalizedDefaultBetas;

          for (const config of normalizedConfigs) {
            const sim = candidate.fieldSims[config.field] || 0;
            const w = typeof candidateWeights[config.field] === "number" ? candidateWeights[config.field] : config.normalizedWeight;
            compositeSim += w * sim;
          }

          // Validación según el modo de filtrado seleccionado por el usuario
          const passesFilter =
            filterMode === "topK" ? true : compositeSim >= threshold;

          if (passesFilter) {
            scoredItems.push({
              asignaturaId: candidate.id,
              clave: candidate.clave,
              nombre: candidate.nombre,
              cluster: candidate.cluster || null,
              contenido_tematico: candidate.contenido_tematico,
              compositeSimilarity: Number(compositeSim.toFixed(4)),
              fieldSimilarities: Object.fromEntries(
                Object.entries(candidate.fieldSims).map(([k, v]) => [k, Number(v.toFixed(4))])
              ),
              match_nombre: Boolean(candidate.match_nombre),
              embedding_768: null, // Se asignará en el paso final de resolución vectorial
            });
          }
        }

        // Ordenar candidatos de MAYOR A MENOR similitud compuesta
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

        finalMatches.sort((a, b) => b.compositeSimilarity - a.compositeSimilarity);

        results.push({
          profesor: prof,
          matches: finalMatches,
          status: "completed",
          embedding_768: compositeEmbedding,
          fieldEmbeddings: fieldEmbeddings,
          sanitizationStatus: profSanitizationStatuses[pIdx],
        });
      } catch (profError: any) {
        console.error(`Error procesando match para profesor ${prof.nombre_profesor || prof.id}:`, profError);
        results.push({
          profesor: prof,
          matches: [],
          status: "error",
          error: profError.message || "Error al calcular matching",
          embedding_768: null,
          fieldEmbeddings: fieldEmbeddings,
        });
      }
    }

    // ── OBTENCIÓN Y ASIGNACIÓN DE EMBEDDINGS DE ASIGNATURAS ──
    // Asegurar que cada asignatura recomendada tenga su vector de 768d incluido para descarga
    if (targetAsignaturas && targetAsignaturas.length > 0) {
      // Modo filtrado: los embeddings ya estaban en memoria
      const targetVectorMap = new Map<number, number[]>();
      targetAsignaturas.forEach((t) => {
        if (Array.isArray(t.embedding)) {
          targetVectorMap.set(t.id, t.embedding);
        }
      });

      for (const res of results) {
        for (const match of res.matches) {
          match.embedding_768 = targetVectorMap.get(match.asignaturaId) || null;
        }
      }
    } else {
      // Modo catálogo completo: consultar los vectores de las asignaturas ganadoras en Supabase
      const allMatchedIds = Array.from(
        new Set(results.flatMap((r) => r.matches.map((m) => m.asignaturaId)))
      );

      if (allMatchedIds.length > 0) {
        const { data: subjectRows, error: subVectorErr } = await supabase
          .from("asignaturas")
          .select("id, embedding_768")
          .in("id", allMatchedIds);

        if (!subVectorErr && Array.isArray(subjectRows)) {
          const subjectVectorMap = new Map<number, number[]>();
          subjectRows.forEach((r) => {
            let emb = r.embedding_768;
            if (typeof emb === "string") {
              try {
                emb = JSON.parse(emb);
              } catch {
                emb = null;
              }
            }
            if (Array.isArray(emb) && emb.length === 768) {
              subjectVectorMap.set(r.id, emb);
            }
          });

          for (const res of results) {
            for (const match of res.matches) {
              match.embedding_768 = subjectVectorMap.get(match.asignaturaId) || null;
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
      filteredSubjectCount: targetAsignaturas ? targetAsignaturas.length : null,
      rateLimiterStats: geminiRateLimiter.getStats(),
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
