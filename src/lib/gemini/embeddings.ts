import { GoogleGenAI } from "@google/genai";
import {
  geminiRateLimiter,
  estimateTokens,
  isRateLimitOrQuotaError,
} from "./rate-limiter";

/**
 * Modelo de Gemini Embeddings multimodales y dimensionalidad requerida
 */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONALITY = 768;

/**
 * Resuelve la clave de API de Gemini buscando en orden de prioridad:
 * 1. Clave provista explícitamente en la petición (overrideKey)
 * 2. Variables de entorno GEMINI_API_KEY, GOOGLE_GENAI_API_KEY, GOOGLE_API_KEY
 */
export function resolveApiKey(overrideKey?: string): string {
  const key =
    (overrideKey && overrideKey.trim()) ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";

  if (!key) {
    throw new Error(
      "No se encontró una clave GEMINI_API_KEY válida. Por favor configúrala en .env.local o ingrésala en la interfaz."
    );
  }
  return key;
}

/**
 * Espera de retardo para operaciones internas
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Llamada REST directa para un solo texto (fallback si el SDK falla)
 */
async function embedContentRest(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: {
        parts: [{ text }],
      },
      outputDimensionality: EMBEDDING_DIMENSIONALITY,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    const error = new Error(`Google GenAI REST error [${res.status}]: ${errorText}`);
    (error as any).status = res.status;
    throw error;
  }

  const json = await res.json();
  const values = json.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Respuesta inválida de Google GenAI: valores de embedding no encontrados.");
  }

  return values;
}

/**
 * Llamada REST por lote (batchEmbedContents) directa a Google GenAI v1beta.
 * Permite enviar hasta 100 textos en una única petición HTTP, reduciendo drásticamente
 * la latencia de red y consumiendo solo 1 request del cupo de 3,000 RPM.
 */
async function batchEmbedContentsRest(texts: string[], apiKey: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) {
    const single = await embedContentRest(texts[0], apiKey);
    return [single];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`;

  const requests = texts.map((t) => ({
    model: `models/${GEMINI_EMBEDDING_MODEL}`,
    content: {
      parts: [{ text: t }],
    },
    outputDimensionality: EMBEDDING_DIMENSIONALITY,
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    const error = new Error(`Google GenAI REST batch error [${res.status}]: ${errorText}`);
    (error as any).status = res.status;
    throw error;
  }

  const json = await res.json();
  const embeddings = json.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(
      `Respuesta batch incompleta de Google GenAI: se esperaban ${texts.length} vectores y se recibieron ${embeddings?.length || 0}.`
    );
  }

  return embeddings.map((e: any) => {
    if (Array.isArray(e?.values) && e.values.length === EMBEDDING_DIMENSIONALITY) {
      return e.values;
    }
    throw new Error("Vector devuelto por batchEmbedContents tiene una dimensionalidad inválida.");
  });
}

/**
 * Genera el embedding de 768 dimensiones para un solo texto utilizando @google/genai
 * o REST fallback, estrictamente gestionado por el RateLimitManager (3,000 RPM / 1,000,000 TPM)
 * y envuelto en retroceso exponencial con jitter contra errores HTTP 429.
 */
export async function generateSingleEmbedding(
  text: string,
  apiKey?: string,
  retries = 5
): Promise<number[]> {
  const key = resolveApiKey(apiKey);
  const cleanText = text.trim();
  if (!cleanText) {
    return new Array(EMBEDDING_DIMENSIONALITY).fill(0);
  }

  const tokensNeeded = estimateTokens(cleanText);

  // Solicitar permiso en la ventana deslizante (3000 RPM / 1M TPM) y ejecutar con retroceso exponencial
  return geminiRateLimiter.schedule(
    async () => {
      // 1. Intentar con el SDK oficial @google/genai
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.embedContent({
          model: GEMINI_EMBEDDING_MODEL,
          contents: cleanText,
          config: {
            outputDimensionality: EMBEDDING_DIMENSIONALITY,
          },
        });

        const embedding =
          (response as any).embedding?.values ||
          (response as any).embeddings?.[0]?.values;

        if (Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSIONALITY) {
          return embedding;
        }
      } catch (sdkErr: any) {
        // Si es error de cuota 429 / RESOURCE_EXHAUSTED, relanzarlo para que executeWithRetry lo gestione
        if (isRateLimitOrQuotaError(sdkErr)) {
          throw sdkErr;
        }
        // Si fue otro error de SDK (ej. incompatibilidad interna), intentar fallback REST
      }

      // 2. Fallback REST
      return await embedContentRest(cleanText, key);
    },
    tokensNeeded,
    1,
    { maxRetries: retries }
  );
}

export interface BatchEmbedOptions {
  apiKey?: string;
  concurrency?: number;
  batchChunkSize?: number;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Procesa un lote de textos eficientemente agrupando en micro-lotes de batchEmbedContents
 * para minimizar llamadas a la API (1 petición por bloque) y respetando de manera
 * estricta la ventana deslizante de 3,000 RPM y 1,000,000 TPM.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  options: BatchEmbedOptions = {}
): Promise<number[][]> {
  const { apiKey, batchChunkSize = 25, onProgress } = options;
  const key = resolveApiKey(apiKey);

  if (texts.length === 0) return [];
  if (texts.length === 1) {
    const single = await generateSingleEmbedding(texts[0], key);
    if (onProgress) onProgress(1, 1);
    return [single];
  }

  const results: number[][] = new Array(texts.length);
  let completedCount = 0;

  // Dividir los textos en bloques para enviar vía batchEmbedContents
  const chunks: { startIndex: number; items: string[] }[] = [];
  for (let i = 0; i < texts.length; i += batchChunkSize) {
    chunks.push({
      startIndex: i,
      items: texts.slice(i, i + batchChunkSize),
    });
  }

  // Procesar cada bloque con el rate-limit manager
  for (const chunk of chunks) {
    const chunkTokens = estimateTokens(chunk.items);

    try {
      const chunkVectors = await geminiRateLimiter.schedule(
        async () => {
          // 1. Intentar SDK @google/genai con array de contenidos
          try {
            const ai = new GoogleGenAI({ apiKey: key });
            const response = await ai.models.embedContent({
              model: GEMINI_EMBEDDING_MODEL,
              contents: chunk.items,
              config: {
                outputDimensionality: EMBEDDING_DIMENSIONALITY,
              },
            });

            const embeddings = (response as any).embeddings;
            if (
              Array.isArray(embeddings) &&
              embeddings.length === chunk.items.length &&
              embeddings.every((e: any) => Array.isArray(e?.values) && e.values.length === EMBEDDING_DIMENSIONALITY)
            ) {
              return embeddings.map((e: any) => e.values as number[]);
            }
          } catch (sdkErr: any) {
            if (isRateLimitOrQuotaError(sdkErr)) {
              throw sdkErr;
            }
          }

          // 2. Fallback REST batchEmbedContents
          return await batchEmbedContentsRest(chunk.items, key);
        },
        chunkTokens,
        1,
        { maxRetries: 5 }
      );

      // Asignar resultados
      chunkVectors.forEach((vec, idx) => {
        results[chunk.startIndex + idx] = vec;
      });
      completedCount += chunk.items.length;
      if (onProgress) onProgress(completedCount, texts.length);
    } catch (chunkErr) {
      console.warn(
        `Error procesando lote batch (${chunk.startIndex} a ${chunk.startIndex + chunk.items.length}). Realizando fallback uno a uno...`,
        chunkErr
      );

      // Fallback resiliente: procesar uno a uno los elementos de este bloque para no fallar el proceso entero
      for (let j = 0; j < chunk.items.length; j++) {
        const itemIdx = chunk.startIndex + j;
        const vec = await generateSingleEmbedding(chunk.items[j], key);
        results[itemIdx] = vec;
        completedCount++;
        if (onProgress) onProgress(completedCount, texts.length);
      }
    }
  }

  return results;
}

/**
 * Normaliza un vector a longitud unitaria (L2 norm = 1.0) para cálculos de similitud coseno
 */
export function normalizeVector(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Calcula el vector compuesto ponderado sum(w_i * V_i) y lo normaliza a longitud unitaria
 */
export function computeCompositeEmbedding(
  fieldEmbeddings: Record<string, number[]>,
  weights: Record<string, number>
): number[] {
  const fields = Object.keys(fieldEmbeddings);
  if (fields.length === 0) {
    return new Array(EMBEDDING_DIMENSIONALITY).fill(0);
  }
  if (fields.length === 1) {
    return fieldEmbeddings[fields[0]];
  }

  const composite = new Array(EMBEDDING_DIMENSIONALITY).fill(0);
  let totalWeight = 0;

  for (const field of fields) {
    const w = weights[field] ?? 1;
    totalWeight += w;
    const vec = fieldEmbeddings[field];
    for (let i = 0; i < EMBEDDING_DIMENSIONALITY; i++) {
      composite[i] += vec[i] * w;
    }
  }

  return normalizeVector(composite);
}
