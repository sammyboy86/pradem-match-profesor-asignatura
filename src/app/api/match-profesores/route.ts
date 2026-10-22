import { NextRequest, NextResponse } from "next/server";
import { createDirectServerClient } from "@/lib/supabase/server";
import {
  generateEmbeddingsBatch,
  computeCompositeEmbedding,
} from "@/lib/gemini/embeddings";
import { geminiRateLimiter } from "@/lib/gemini/rate-limiter";
import { Profesor, QueryConfig, MatchResultItem, ProfesorMatchResult, RegexFilterConfig, DistancePairConfig } from "@/types";
import {
  sanitizarCvParaModelo,
  evaluateProfessorCredentialAcrossFields,
} from "@/lib/sanitizer/cv-sanitizer";

export const maxDuration = 120; // 2 minutos para procesamiento de matching en lotes

function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== 768 || vecB.length !== 768) return 0;
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
    const rawDistancePairs: DistancePairConfig[] = body.distancePairs || [];
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

    // ── CONFIGURACIÓN DE PARES DE DISTANCIA (MULTI-VECTOR) ──
    // Si no se proporcionaron distancePairs explícitos, construir pares 1 a 1 por defecto (compatibilidad)
    let distancePairs: DistancePairConfig[] = [];
    if (Array.isArray(rawDistancePairs) && rawDistancePairs.length > 0) {
      distancePairs = rawDistancePairs;
    } else {
      distancePairs = activeConfigs.map((c) => ({
        id: c.field,
        profField: c.field,
        asigVectorCol: "embedding_768",
        label: `${c.label || c.field} ↔ Vector Principal`,
        active: true,
        weight: c.weight,
      }));
    }

    const activePairs = distancePairs.filter((p) => p.active !== false);
    if (!activePairs.length) {
      return NextResponse.json(
        { success: false, error: "Debes tener al menos un par de distancia activo entre profesor y asignatura." },
        { status: 400 }
      );
    }

    // Campos de profesor requeridos por los pares activos
    const requiredProfFields = Array.from(new Set(activePairs.map((p) => p.profField)));

    // Configuración opcional de cluster y betas
    const clusterColumn: string = (body.clusterColumn || "cluster").trim();
    const rawClusterBetas: Record<string, Record<string, number>> = body.clusterBetas || {};
    const rawDefaultBetas: Record<string, number> = body.defaultBetas || {};

    // Normalizar pesos base de los pares sum(w_pair) = 1.0
    const totalRawPairWeight = activePairs.reduce((acc, p) => acc + (p.weight > 0 ? p.weight : 0), 0);
    const pairWeightMap: Record<string, number> = {};
    activePairs.forEach((p) => {
      pairWeightMap[p.id] = totalRawPairWeight > 0 ? (p.weight > 0 ? p.weight / totalRawPairWeight : 0) : 1 / activePairs.length;
    });

    const activePairIds = activePairs.map((p) => p.id);

    // Función auxiliar para normalizar los betas de un cluster para los pares de distancia
    const normalizePairWeights = (rawWeights: Record<string, number>): Record<string, number> => {
      let total = 0;
      activePairIds.forEach((pid) => {
        const pair = activePairs.find((p) => p.id === pid);
        // Soporte tanto de key como pair.id como pair.profField (compatibilidad hacia atrás)
        const rawVal = rawWeights[pid] !== undefined ? rawWeights[pid] : (pair ? rawWeights[pair.profField] : undefined);
        const w = typeof rawVal === "number" && rawVal > 0 ? rawVal : 0;
        total += w;
      });
      const res: Record<string, number> = {};
      activePairIds.forEach((pid) => {
        const pair = activePairs.find((p) => p.id === pid);
        const rawVal = rawWeights[pid] !== undefined ? rawWeights[pid] : (pair ? rawWeights[pair.profField] : undefined);
        const w = typeof rawVal === "number" && rawVal > 0 ? rawVal : 0;
        res[pid] = total > 0 ? w / total : 1 / activePairIds.length;
      });
      return res;
    };

    // Betas predeterminadas de los pares
    const normalizedDefaultBetas = Object.keys(rawDefaultBetas).length > 0
      ? normalizePairWeights(rawDefaultBetas)
      : pairWeightMap;

    // Matriz de betas normalizadas por cluster para cada par
    const normalizedClusterBetas: Record<string, Record<string, number>> = {};
    for (const [cName, betasObj] of Object.entries(rawClusterBetas)) {
      if (betasObj && typeof betasObj === "object") {
        normalizedClusterBetas[cName] = normalizePairWeights(betasObj);
      }
    }

    const supabase = createDirectServerClient();

    // ── GESTIÓN DE EMBEDDINGS DE PROFESORES: PRECOMPUTADOS vs GEMINI 2 ──
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

    // Crear tareas de generación para campos requeridos por los pares activos sin vector precalculado
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
            requiredProfFields
          );
        }

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

        profSanitizationStatuses[profIndex] = profWasSanitized ? "sanitized" : "intact";
      }

      for (const reqField of requiredProfFields) {
        if (profFieldEmbeddings[profIndex][reqField]) {
          continue; // Ya tiene embedding precalculado
        }

        const config = activeConfigs.find((c) => c.field === reqField) || {
          field: reqField,
          template: `${reqField}: {value}`,
        };

        const rawVal = prof[reqField];
        let valText = typeof rawVal === "string" ? rawVal.trim() : rawVal != null ? String(rawVal).trim() : "";
        if (!valText) continue;

        if (regexFilter?.enabled && !contextHasCredential) {
          const sanitizedResult = sanitizarCvParaModelo(valText, regexFilter, false);
          valText = sanitizedResult.sanitizedText;
          if (sanitizedResult.status === "sanitized") {
            profWasSanitized = true;
          }
          prof[reqField] = sanitizedResult.sanitizedText;
        }

        const queryText = config.template.includes("{value}")
          ? config.template.replace(/\{value\}/g, valText)
          : `${config.template}: ${valText}`;

        tasks.push({ profIndex, field: reqField, queryText });
      }

      if (regexFilter?.enabled) {
        profSanitizationStatuses[profIndex] = profWasSanitized ? "sanitized" : "intact";
      }
    });

    if (tasks.length > 0) {
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

    // ── CARGA MULTI-VECTOR DE ASIGNATURAS CANDIDATAS ──
    // Cargamos asignaturas objetivo (filtradas o catálogo completo) con TODAS sus columnas
    interface TargetAsignatura {
      id: number;
      clave: string;
      nombre: string;
      cluster: string | null;
      contenido_tematico: string;
      match_nombre: boolean;
      vectorsMap: Record<string, number[]>;
      primaryEmbedding: number[] | null;
      allColumns: Record<string, any>;
    }

    let targetRows: any[] = [];
    try {
      if (hasFilter) {
        // Consultar por lotes seguros de IDs para evitar desbordamiento de URL en PostgREST y statement timeout
        const CHUNK_SIZE = 250;
        for (let i = 0; i < filterAsignaturaIds.length; i += CHUNK_SIZE) {
          const slice = filterAsignaturaIds.slice(i, i + CHUNK_SIZE);
          const { data, error } = await supabase
            .from("asignaturas")
            .select("*")
            .in("id", slice);

          if (error) throw error;
          if (Array.isArray(data)) targetRows.push(...data);
        }
      } else {
        // Catálogo completo: paginar en bloques de 500 para evitar límite de 1,000 filas de PostgREST y timeouts
        const { count: totalAsigs, error: countErr } = await supabase
          .from("asignaturas")
          .select("id", { count: "exact", head: true });

        if (countErr) throw countErr;
        const total = totalAsigs || 0;
        const PAGE_SIZE = 500;
        const numPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

        for (let i = 0; i < numPages; i++) {
          const from = i * PAGE_SIZE;
          const to = from + PAGE_SIZE - 1;
          const { data, error } = await supabase
            .from("asignaturas")
            .select("*")
            .range(from, to);

          if (error) throw error;
          if (Array.isArray(data)) targetRows.push(...data);
        }
      }
    } catch (fetchErr: any) {
      throw new Error(`Error al consultar asignaturas en Supabase: ${fetchErr.message}`);
    }

    // Procesar y validar vectores de cada asignatura
    const targetAsignaturas: TargetAsignatura[] = targetRows
      .map((r: any) => {
        const vectorsMap: Record<string, number[]> = {};

        // 1. Vector principal embedding_768
        let primaryEmb = r.embedding_768;
        if (typeof primaryEmb === "string") {
          try {
            primaryEmb = JSON.parse(primaryEmb);
          } catch {
            primaryEmb = null;
          }
        }
        if (Array.isArray(primaryEmb) && primaryEmb.length === 768) {
          vectorsMap["embedding_768"] = primaryEmb;
        } else {
          primaryEmb = null;
        }

        // 2. Vectores almacenados en la columna JSONB 'vectors'
        if (r.vectors && typeof r.vectors === "object") {
          for (const [vKey, vVal] of Object.entries(r.vectors)) {
            let vec: number[] | null = null;
            if (Array.isArray(vVal) && vVal.length === 768) {
              vec = vVal;
            } else if (typeof vVal === "string") {
              try {
                const parsed = JSON.parse(vVal);
                if (Array.isArray(parsed) && parsed.length === 768) vec = parsed;
              } catch {
                vec = null;
              }
            }
            if (vec) {
              vectorsMap[vKey] = vec;
            }
          }
        }

        // 3. Revisar si hay columnas dedicadas que contengan vectores
        activePairs.forEach((pair) => {
          if (!vectorsMap[pair.asigVectorCol] && r[pair.asigVectorCol]) {
            let colVal = r[pair.asigVectorCol];
            if (typeof colVal === "string") {
              try {
                colVal = JSON.parse(colVal);
              } catch {
                colVal = null;
              }
            }
            if (Array.isArray(colVal) && colVal.length === 768) {
              vectorsMap[pair.asigVectorCol] = colVal;
            }
          }
        });

        // Si embedding_768 no existía pero hay otro vector, usarlo como principal
        if (!primaryEmb && Object.keys(vectorsMap).length > 0) {
          primaryEmb = Object.values(vectorsMap)[0];
        }

        const rawClusterVal = r[clusterColumn] !== undefined ? r[clusterColumn] : r.cluster;
        const cleanCluster = rawClusterVal != null && String(rawClusterVal).trim() !== "" ? String(rawClusterVal).trim() : null;

        // Extraer todos los campos de la fila de la asignatura (excluyendo arrays crudos de vectores)
        const allColumns: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => {
          if (k !== "embedding_768" && k !== "vectors") {
            allColumns[k] = v;
          }
        });

        return {
          id: r.id,
          clave: r.clave || "",
          nombre: r.nombre || "",
          cluster: cleanCluster,
          contenido_tematico: r.contenido_tematico || "",
          match_nombre: Boolean(r.match_nombre),
          vectorsMap,
          primaryEmbedding: primaryEmb,
          allColumns,
        };
      })
      .filter((a) => Object.keys(a.vectorsMap).length > 0);

    if (targetAsignaturas.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Ninguna de las asignaturas tiene vectores disponibles (se requieren vectores de 768 dimensiones).",
        },
        { status: 400 }
      );
    }

    const results: ProfesorMatchResult[] = [];

    // ── PROCESAMIENTO DE MATCHING PONDERADO MULTI-VECTOR ──
    for (let pIdx = 0; pIdx < profesores.length; pIdx++) {
      const prof = profesores[pIdx];
      const fieldEmbeddings = profFieldEmbeddings[pIdx] || {};

      try {
        // Calcular vector compuesto del profesor (usado para visualización y exportación)
        const compositeEmbedding = prof.embedding_768 && prof.embedding_768.length === 768
          ? prof.embedding_768
          : computeCompositeEmbedding(fieldEmbeddings, pairWeightMap);

        const scoredItems: MatchResultItem[] = [];

        // Evaluar cada asignatura candidata contra todos los pares activos
        for (const target of targetAsignaturas) {
          const pairSims: Record<string, number> = {};

          for (const pair of activePairs) {
            const profVec = fieldEmbeddings[pair.profField];
            // Resolver vector de asignatura para este par (columna específica o fallback a embedding_768)
            const asigVec = target.vectorsMap[pair.asigVectorCol] || target.vectorsMap["embedding_768"] || target.primaryEmbedding;

            if (profVec && asigVec) {
              const sim = computeCosineSimilarity(profVec, asigVec);
              pairSims[pair.id] = Number(sim.toFixed(4));
            } else {
              pairSims[pair.id] = 0;
            }
          }

          // Obtener pesos específicos del cluster de esta asignatura
          const cName = target.cluster ? String(target.cluster).trim() : "";
          const clusterWeights = (cName && normalizedClusterBetas[cName]) || normalizedDefaultBetas;

          let compositeSim = 0;
          for (const pair of activePairs) {
            const sim = pairSims[pair.id] || 0;
            const w = typeof clusterWeights[pair.id] === "number" ? clusterWeights[pair.id] : pairWeightMap[pair.id];
            compositeSim += w * sim;
          }

          // Validación según el modo de filtrado seleccionado por el usuario
          const passesFilter = filterMode === "topK" ? true : compositeSim >= threshold;

          if (passesFilter) {
            scoredItems.push({
              ...target.allColumns,
              asignaturaId: target.id,
              clave: target.clave,
              nombre: target.nombre,
              cluster: target.cluster,
              contenido_tematico: target.contenido_tematico,
              fines_de_aprendizaje_o_formacion: target.allColumns.fines_de_aprendizaje_o_formacion,
              actividades_de_aprendizaje: target.allColumns.actividades_de_aprendizaje,
              compositeSimilarity: Number(compositeSim.toFixed(4)),
              fieldSimilarities: pairSims,
              pairSimilarities: pairSims,
              match_nombre: Boolean(target.match_nombre),
              embedding_768: target.primaryEmbedding,
              vectors: target.vectorsMap,
            });
          }
        }

        // Ordenar candidatos de MAYOR A MENOR similitud compuesta
        scoredItems.sort((a, b) => b.compositeSimilarity - a.compositeSimilarity);

        // Selección final de asignaturas respetando cupo Top K y prioridad match_nombre
        let finalMatches: MatchResultItem[] = [];

        if (filterMode === "threshold") {
          if (topK > 0 && topK < scoredItems.length) {
            let count = 0;
            for (const item of scoredItems) {
              if (item.match_nombre) {
                finalMatches.push(item);
              } else if (count < topK) {
                finalMatches.push(item);
                count++;
              }
            }
          } else {
            finalMatches = scoredItems;
          }
        } else {
          let count = 0;
          for (const item of scoredItems) {
            if (item.match_nombre) {
              finalMatches.push(item);
            } else if (count < topK) {
              finalMatches.push(item);
              count++;
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

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
      filteredSubjectCount: hasFilter ? targetAsignaturas.length : null,
      totalCatalogProcessed: targetAsignaturas.length,
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
