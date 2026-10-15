import { GoogleGenAI } from "@google/genai";

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
 * Espera de retardo con retroceso exponencial y aleatorización (jitter)
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Llamada REST de respaldo directa a Google GenAI v1beta
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
 * Genera el embedding de 768 dimensiones para un solo texto utilizando @google/genai
 * con reintentos automáticos ante errores 429 / cuota y fallback a REST.
 */
export async function generateSingleEmbedding(
  text: string,
  apiKey?: string,
  retries = 3
): Promise<number[]> {
  const key = resolveApiKey(apiKey);
  const cleanText = text.trim();
  if (!cleanText) {
    return new Array(EMBEDDING_DIMENSIONALITY).fill(0);
  }

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    try {
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

        const embedding = (response as any).embedding?.values || (response as any).embeddings?.[0]?.values;
        if (Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSIONALITY) {
          return embedding;
        }
      } catch (sdkErr: any) {
        // Si el SDK falla o da error de cuota, intentar REST directamente
        if (sdkErr?.status === 429 || sdkErr?.message?.includes("429") || sdkErr?.message?.includes("RESOURCE_EXHAUSTED")) {
          throw sdkErr;
        }
      }

      // 2. Fallback REST
      const restEmbedding = await embedContentRest(cleanText, key);
      return restEmbedding;
    } catch (err: any) {
      lastError = err;
      const isQuotaError =
        err?.status === 429 ||
        err?.message?.includes("429") ||
        err?.message?.includes("RESOURCE_EXHAUSTED") ||
        err?.message?.includes("quota");

      if (isQuotaError && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1200 + Math.random() * 500;
        console.warn(`Límite de tasa en Google GenAI detectado. Reintentando intento ${attempt + 1}/${retries} en ${Math.round(delay)}ms...`);
        await wait(delay);
        attempt++;
        continue;
      }

      break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Error desconocido al generar embedding con Gemini");
}

export interface BatchEmbedOptions {
  apiKey?: string;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Procesa un lote de textos con concurrencia controlada para respetar la cuota de la API
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  options: BatchEmbedOptions = {}
): Promise<number[][]> {
  const { apiKey, concurrency = 4, onProgress } = options;
  const results: number[][] = new Array(texts.length);
  let completed = 0;
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < texts.length) {
      const index = currentIndex++;
      const text = texts[index];

      try {
        const embedding = await generateSingleEmbedding(text, apiKey);
        results[index] = embedding;
      } catch (err) {
        console.error(`Error procesando embedding para el índice ${index}:`, err);
        throw err;
      } finally {
        completed++;
        if (onProgress) {
          onProgress(completed, texts.length);
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, texts.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);
  return results;
}
