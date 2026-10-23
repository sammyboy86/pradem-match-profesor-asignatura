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

/**
 * Parsea y normaliza un embedding de 768 dimensiones a Float32Array con L2 norm = 1.0.
 * Al estar normalizado a longitud unitaria, la similitud coseno se reduce a un simple producto punto.
 */
function parseEmbeddingToFloat32(val: unknown): Float32Array | null {
  if (!val) return null;
  if (val instanceof Float32Array) {
    return val.length === 768 ? val : null;
  }
  let arr: number[] | null = null;
  if (Array.isArray(val)) {
    arr = val;
  } else if (typeof val === "string") {
    const s = val.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      const tokens = s.replace(/[\[\]\{\}\(\)]/g, "").split(/[\s,]+/);
      const nums: number[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i].trim();
        if (t) {
          const n = Number(t);
          if (!isNaN(n)) nums.push(n);
        }
      }
      if (nums.length === 768) arr = nums;
    }
  }

  if (!arr || arr.length !== 768) return null;

  const f32 = new Float32Array(768);
  let normSq = 0;
  for (let i = 0; i < 768; i++) {
    const v = Number(arr[i]) || 0;
    f32[i] = v;
    normSq += v * v;
  }

  const norm = Math.sqrt(normSq);
  if (norm > 0) {
    const invNorm = 1 / norm;
    for (let i = 0; i < 768; i++) {
      f32[i] *= invNorm;
    }
  }
  return f32;
}

/**
 * Producto punto de alto rendimiento sobre Float32Array de 768 dimensiones.
 * Desenrollado en bloques de 8 iteraciones (loop unrolling) para habilitar vectorización SIMD nativa en V8 (~10x más rápido).
 */
function fastDotProduct(vecA: Float32Array, vecB: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < 768; i += 8) {
    dot +=
      vecA[i] * vecB[i] +
      vecA[i + 1] * vecB[i + 1] +
      vecA[i + 2] * vecB[i + 2] +
      vecA[i + 3] * vecB[i + 3] +
      vecA[i + 4] * vecB[i + 4] +
      vecA[i + 5] * vecB[i + 5] +
      vecA[i + 6] * vecB[i + 6] +
      vecA[i + 7] * vecB[i + 7];
  }
  return dot;
}

/**
 * Consulta las filas candidatas con columnas mínimas ligeras (evitando TOAST de textos masivos)
 * con paginación paralela controlada (máx 4 peticiones concurrentes de 100 filas)
 */
async function fetchCandidateRows(
  supabase: any,
  selectCols: string,
  filterAsignaturaIds: number[],
  hasFilter: boolean
): Promise<any[]> {
  const targetRows: any[] = [];
  const CONCURRENCY = 4;
  const CHUNK_SIZE = 100;

  if (hasFilter) {
    const chunks: number[][] = [];
    for (let i = 0; i < filterAsignaturaIds.length; i += CHUNK_SIZE) {
      chunks.push(filterAsignaturaIds.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((slice) =>
          supabase
            .from("asignaturas")
            .select(selectCols)
            .in("id", slice)
        )
      );

      for (const res of results) {
        if (res.error) throw res.error;
        if (Array.isArray(res.data)) targetRows.push(...res.data);
      }
    }
  } else {
    const { count: totalAsigs, error: countErr } = await supabase
      .from("asignaturas")
      .select("id", { count: "exact", head: true });

    if (countErr) throw countErr;
    const total = totalAsigs || 0;
    const numPages = Math.max(1, Math.ceil(total / CHUNK_SIZE));

    const pages: { from: number; to: number }[] = [];
    for (let i = 0; i < numPages; i++) {
      const from = i * CHUNK_SIZE;
      const to = from + CHUNK_SIZE - 1;
      pages.push({ from, to });
    }

    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const batch = pages.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((p) =>
          supabase
            .from("asignaturas")
            .select(selectCols)
            .range(p.from, p.to)
        )
      );

      for (const res of results) {
        if (res.error) throw res.error;
        if (Array.isArray(res.data)) targetRows.push(...res.data);
      }
    }
  }

  return targetRows;
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
      // Deduplicar textos idénticos para no generar embeddings repetidos
      const uniqueTexts: string[] = [];
      const textToUniqueIdx = new Map<string, number>();

      tasks.forEach((t) => {
        if (!textToUniqueIdx.has(t.queryText)) {
          textToUniqueIdx.set(t.queryText, uniqueTexts.length);
          uniqueTexts.push(t.queryText);
        }
      });

      const uniqueVectors = await generateEmbeddingsBatch(uniqueTexts, {
        apiKey,
        batchChunkSize: 50,
      });

      tasks.forEach((t) => {
        const uIdx = textToUniqueIdx.get(t.queryText);
        if (uIdx !== undefined && uniqueVectors[uIdx]) {
          const vec = uniqueVectors[uIdx];
          if (vec && vec.length === 768) {
            profFieldEmbeddings[t.profIndex][t.field] = vec;
          }
        }
      });
    }

    // ── FASE 1: CARGA LIGERA DE VECTORES DE ASIGNATURAS CANDIDATAS ──
    // Se seleccionan ÚNICAMENTE las columnas vectoriales y de indexación mínimas (incluyendo la columna de cluster activa).
    // Omitir textos masivos (contenido_tematico, fines_de_aprendizaje, actividades)
    // reduce el payload en un 85% y elimina por completo el error de 'statement timeout'.
    const cleanClusterCol = clusterColumn && /^[a-zA-Z0-9_]+$/.test(clusterColumn) ? clusterColumn : "cluster";
    const baseCols = ["id", "clave", "nombre", "cluster", "match_nombre"];
    if (cleanClusterCol !== "cluster" && !baseCols.includes(cleanClusterCol)) {
      baseCols.push(cleanClusterCol);
    }
    let selectCols = `${baseCols.join(", ")}, embedding_768, vectors`;
    let targetRows: any[] = [];
    try {
      targetRows = await fetchCandidateRows(supabase, selectCols, filterAsignaturaIds, hasFilter);
    } catch (fetchErr: any) {
      if (fetchErr.message?.includes("vectors") || fetchErr.code === "42703") {
        selectCols = `${baseCols.join(", ")}, embedding_768`;
        try {
          targetRows = await fetchCandidateRows(supabase, selectCols, filterAsignaturaIds, hasFilter);
        } catch (innerErr: any) {
          if (cleanClusterCol !== "cluster") {
            selectCols = "id, clave, nombre, cluster, match_nombre, embedding_768";
            targetRows = await fetchCandidateRows(supabase, selectCols, filterAsignaturaIds, hasFilter);
          } else {
            throw innerErr;
          }
        }
      } else if (cleanClusterCol !== "cluster" && (fetchErr.message?.includes(cleanClusterCol) || fetchErr.code === "42703")) {
        selectCols = "id, clave, nombre, cluster, match_nombre, embedding_768, vectors";
        targetRows = await fetchCandidateRows(supabase, selectCols, filterAsignaturaIds, hasFilter);
      } else {
        throw new Error(`Error al consultar asignaturas en Supabase: ${fetchErr.message}`);
      }
    }

    // ── PREPARACIÓN VECTORIAL DE ASIGNATURAS CANDIDATAS ──
    // Se pre-parsean y normalizan los vectores en Float32Array una sola vez (L2 norm = 1.0)
    // y se pre-calculan los pesos de cluster para cada par activo.
    interface PreparedTarget {
      id: number;
      clave: string;
      nombre: string;
      cluster: string | null;
      match_nombre: boolean;
      pairVectors: (Float32Array | null)[];
      clusterWeights: number[];
      rawPrimaryEmbedding: number[] | null;
      rawVectorsMap: Record<string, number[]>;
    }

    const numPairs = activePairs.length;
    const preparedTargets: PreparedTarget[] = [];

    for (let rIdx = 0; rIdx < targetRows.length; rIdx++) {
      const r = targetRows[rIdx];

      // 1. Vector principal raw (para exportación y fallbacks)
      let rawPrimaryEmb: number[] | null = null;
      if (Array.isArray(r.embedding_768) && r.embedding_768.length === 768) {
        rawPrimaryEmb = r.embedding_768;
      } else if (typeof r.embedding_768 === "string") {
        try {
          const parsed = JSON.parse(r.embedding_768);
          if (Array.isArray(parsed) && parsed.length === 768) rawPrimaryEmb = parsed;
        } catch {
          rawPrimaryEmb = null;
        }
      }

      // 2. Diccionario de vectores raw
      const rawVectorsMap: Record<string, number[]> = {};
      if (rawPrimaryEmb) {
        rawVectorsMap["embedding_768"] = rawPrimaryEmb;
      }

      if (r.vectors && typeof r.vectors === "object") {
        for (const [vk, vv] of Object.entries(r.vectors)) {
          if (Array.isArray(vv) && vv.length === 768) {
            rawVectorsMap[vk] = vv;
          } else if (typeof vv === "string") {
            try {
              const parsed = JSON.parse(vv);
              if (Array.isArray(parsed) && parsed.length === 768) rawVectorsMap[vk] = parsed;
            } catch {}
          }
        }
      }

      if (!rawPrimaryEmb && Object.keys(rawVectorsMap).length > 0) {
        rawPrimaryEmb = Object.values(rawVectorsMap)[0];
      }

      // 3. Pre-parsear y pre-normalizar vectores para cada par activo en Float32Array
      const pairVectors: (Float32Array | null)[] = new Array(numPairs);
      let hasAtLeastOnePairVector = false;

      for (let p = 0; p < numPairs; p++) {
        const pair = activePairs[p];
        const vecCandidate =
          rawVectorsMap[pair.asigVectorCol] ||
          rawVectorsMap["embedding_768"] ||
          rawPrimaryEmb;

        if (vecCandidate) {
          const f32 = parseEmbeddingToFloat32(vecCandidate);
          pairVectors[p] = f32;
          if (f32) hasAtLeastOnePairVector = true;
        } else {
          pairVectors[p] = null;
        }
      }

      if (!hasAtLeastOnePairVector) {
        continue; // Omitir asignatura si no tiene ningún vector válido para los pares activos
      }

      // 4. Pre-calcular pesos de cluster para cada par activo
      const rawClusterVal = r[cleanClusterCol] !== undefined ? r[cleanClusterCol] : r.cluster;
      const cleanCluster =
        rawClusterVal != null && String(rawClusterVal).trim() !== ""
          ? String(rawClusterVal).trim()
          : null;

      const clusterBetas =
        (cleanCluster && normalizedClusterBetas[cleanCluster]) || normalizedDefaultBetas;

      const clusterWeights: number[] = new Array(numPairs);
      for (let p = 0; p < numPairs; p++) {
        const pId = activePairs[p].id;
        clusterWeights[p] =
          typeof clusterBetas[pId] === "number" ? clusterBetas[pId] : pairWeightMap[pId];
      }

      preparedTargets.push({
        id: r.id,
        clave: r.clave || "",
        nombre: r.nombre || "",
        cluster: cleanCluster,
        match_nombre: Boolean(r.match_nombre),
        pairVectors,
        clusterWeights,
        rawPrimaryEmbedding: rawPrimaryEmb,
        rawVectorsMap,
      });
    }

    if (preparedTargets.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Ninguna de las asignaturas tiene vectores disponibles (se requieren vectores de 768 dimensiones).",
        },
        { status: 400 }
      );
    }

    const results: ProfesorMatchResult[] = [];

    // ── CÁLCULO ULTRA-RÁPIDO DE DISTANCIAS Y SCORE PONDERADO ──
    for (let pIdx = 0; pIdx < profesores.length; pIdx++) {
      const prof = profesores[pIdx];
      const fieldEmbeddings = profFieldEmbeddings[pIdx] || {};

      try {
        const compositeEmbedding =
          prof.embedding_768 && prof.embedding_768.length === 768
            ? prof.embedding_768
            : computeCompositeEmbedding(fieldEmbeddings, pairWeightMap);

        // Pre-normalizar vectores del profesor para cada par activo
        const profPairVectors: (Float32Array | null)[] = new Array(numPairs);
        for (let p = 0; p < numPairs; p++) {
          const reqField = activePairs[p].profField;
          const rawVec = fieldEmbeddings[reqField];
          profPairVectors[p] = rawVec ? parseEmbeddingToFloat32(rawVec) : null;
        }

        // Evaluar todas las asignaturas candidatas
        const candidateScores: {
          targetIndex: number;
          compositeSim: number;
          pSims: number[];
        }[] = [];

        for (let aIdx = 0; aIdx < preparedTargets.length; aIdx++) {
          const target = preparedTargets[aIdx];
          let compositeSim = 0;
          const pSims = new Array(numPairs);

          for (let p = 0; p < numPairs; p++) {
            const profVec = profPairVectors[p];
            const asigVec = target.pairVectors[p];
            let sim = 0;
            if (profVec && asigVec) {
              sim = fastDotProduct(profVec, asigVec);
              if (sim > 1) sim = 1;
              else if (sim < -1) sim = -1;
            }
            pSims[p] = sim;
            compositeSim += target.clusterWeights[p] * sim;
          }

          const passes = filterMode === "topK" ? true : compositeSim >= threshold;
          if (passes) {
            candidateScores.push({
              targetIndex: aIdx,
              compositeSim,
              pSims,
            });
          }
        }

        // Ordenar candidatos por similitud compuesta descendente
        candidateScores.sort((a, b) => b.compositeSim - a.compositeSim);

        // Selección de ganadores respetando Top K y prioridad match_nombre
        const winningScores: typeof candidateScores = [];
        if (filterMode === "threshold") {
          if (topK > 0 && topK < candidateScores.length) {
            let count = 0;
            for (const c of candidateScores) {
              const isMatchNombre = preparedTargets[c.targetIndex].match_nombre;
              if (isMatchNombre) {
                winningScores.push(c);
              } else if (count < topK) {
                winningScores.push(c);
                count++;
              }
            }
          } else {
            winningScores.push(...candidateScores);
          }
        } else {
          let count = 0;
          for (const c of candidateScores) {
            const isMatchNombre = preparedTargets[c.targetIndex].match_nombre;
            if (isMatchNombre) {
              winningScores.push(c);
            } else if (count < topK) {
              winningScores.push(c);
              count++;
            }
          }
        }

        winningScores.sort((a, b) => b.compositeSim - a.compositeSim);

        // Construir items de resultado formateados únicamente para los ganadores Top K
        const finalMatches: MatchResultItem[] = winningScores.map((w) => {
          const target = preparedTargets[w.targetIndex];
          const pairSimsObj: Record<string, number> = {};
          for (let p = 0; p < numPairs; p++) {
            const pId = activePairs[p].id;
            pairSimsObj[pId] = Math.round(w.pSims[p] * 10000) / 10000;
          }

          return {
            asignaturaId: target.id,
            clave: target.clave,
            nombre: target.nombre,
            cluster: target.cluster,
            compositeSimilarity: Math.round(w.compositeSim * 10000) / 10000,
            fieldSimilarities: pairSimsObj,
            pairSimilarities: pairSimsObj,
            match_nombre: target.match_nombre,
            embedding_768: target.rawPrimaryEmbedding,
            vectors: target.rawVectorsMap,
          };
        });

        results.push({
          profesor: prof,
          matches: finalMatches,
          status: "completed",
          embedding_768: compositeEmbedding,
          fieldEmbeddings: fieldEmbeddings,
          sanitizationStatus: profSanitizationStatuses[pIdx],
        });
      } catch (profError: any) {
        console.error(
          `Error procesando match para profesor ${prof.nombre_profesor || prof.id}:`,
          profError
        );
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

    // ── FASE 2: HIDRATACIÓN DE METADATOS COMPLETOS PARA ASIGNATURAS GANADORAS ──
    const winningAsigIds = new Set<number>();
    results.forEach((r) => {
      r.matches.forEach((m) => {
        if (m.asignaturaId) winningAsigIds.add(m.asignaturaId);
      });
    });

    if (winningAsigIds.size > 0) {
      const winningIdList = Array.from(winningAsigIds);
      const detailsMap = new Map<number, Record<string, any>>();
      const HYDRATE_CHUNK = 100;

      for (let i = 0; i < winningIdList.length; i += HYDRATE_CHUNK) {
        const slice = winningIdList.slice(i, i + HYDRATE_CHUNK);
        try {
          const { data: detailsData } = await supabase
            .from("asignaturas")
            .select("*")
            .in("id", slice);

          if (Array.isArray(detailsData)) {
            detailsData.forEach((row) => {
              const cleanRow: Record<string, any> = {};
              Object.entries(row).forEach(([k, v]) => {
                if (k !== "embedding_768" && k !== "vectors") {
                  cleanRow[k] = v;
                }
              });
              detailsMap.set(row.id, cleanRow);
            });
          }
        } catch {
          // Continuar si la hidratación adicional no completa
        }
      }

      results.forEach((r) => {
        r.matches.forEach((m) => {
          const full = detailsMap.get(m.asignaturaId);
          if (full) {
            Object.assign(m, full);
            if (cleanClusterCol && full[cleanClusterCol] !== undefined && full[cleanClusterCol] !== null) {
              m.cluster = String(full[cleanClusterCol]).trim();
            }
          }
        });
      });
    }

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
      filteredSubjectCount: hasFilter ? preparedTargets.length : null,
      totalCatalogProcessed: preparedTargets.length,
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
