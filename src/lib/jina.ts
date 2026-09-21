/**
 * Utilidades para interactuar con la API de Embeddings de Jina AI
 * Modelo oficial: jina-embeddings-v2-base-es (Optimizado para Español, 8192 tokens de contexto, 768 dimensiones)
 */

export interface JinaEmbeddingResponse {
  model: string;
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
  };
}

export interface EmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

/**
 * Genera embeddings vectoriales utilizando la API de Jina AI.
 * Soporta procesamiento por lotes si el número de textos es grande.
 */
export async function getJinaEmbeddings(
  inputs: string[],
  apiKey: string,
  model: string = "jina-embeddings-v2-base-es"
): Promise<EmbeddingResult> {
  const cleanKey = apiKey?.trim();
  if (!cleanKey) {
    throw new Error(
      "No se ha proporcionado la clave de API de Jina AI. Configúrala en .env.local (JINA_API_KEY) o ingrésala en la interfaz."
    );
  }

  if (!inputs || inputs.length === 0) {
    return { embeddings: [], totalTokens: 0 };
  }

  // Filtrar textos vacíos pero mantener el orden o sustituir por fallback seguro
  const normalizedInputs = inputs.map((t) => (t && t.trim() ? t.trim() : "sin descripción"));

  // Jina permite hasta 100 textos por petición
  const BATCH_SIZE = 50;
  const allEmbeddings: number[][] = new Array(normalizedInputs.length);
  let accumulatedTokens = 0;

  for (let i = 0; i < normalizedInputs.length; i += BATCH_SIZE) {
    const chunk = normalizedInputs.slice(i, i + BATCH_SIZE);

    const response = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify({
        model,
        input: chunk,
      }),
    });

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorJson = await response.json();
        errorDetail = errorJson.message || errorJson.error || JSON.stringify(errorJson);
      } catch {
        errorDetail = await response.text();
      }

      if (response.status === 401) {
        throw new Error(
          "Clave de API de Jina AI no válida o no autorizada. Revisa tu JINA_API_KEY."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Límite de tasa (Rate limit) excedido en Jina AI. Espera unos momentos antes de reintentar."
        );
      }

      throw new Error(`Error en la API de Jina AI (${response.status}): ${errorDetail}`);
    }

    const data: JinaEmbeddingResponse = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Respuesta inválida recibida de la API de Jina AI (sin campo data).");
    }

    data.data.forEach((item) => {
      const targetIndex = i + item.index;
      allEmbeddings[targetIndex] = item.embedding;
    });

    if (data.usage?.total_tokens) {
      accumulatedTokens += data.usage.total_tokens;
    }
  }

  return {
    embeddings: allEmbeddings,
    totalTokens: accumulatedTokens,
  };
}

/**
 * Calcula la similitud de coseno entre dos vectores numéricos.
 * Retorna un valor entre -1 y 1 (usualmente 0 a 1 para embeddings normalizados).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Formatea un array de números como un resumen legible de vector
 */
export function formatVectorSummary(vec: unknown): string {
  if (!vec) return "Sin vector";
  if (Array.isArray(vec)) {
    if (vec.length === 0) return "Vector vacío (0 dims)";
    const sample = vec
      .slice(0, 3)
      .map((n) => (typeof n === "number" ? n.toFixed(4) : String(n)))
      .join(", ");
    return `[${sample}, ... ${vec.length} dims]`;
  }
  if (typeof vec === "string") {
    try {
      const parsed = JSON.parse(vec);
      return formatVectorSummary(parsed);
    } catch {
      return "Formato vector text";
    }
  }
  return "Vector disponible";
}
