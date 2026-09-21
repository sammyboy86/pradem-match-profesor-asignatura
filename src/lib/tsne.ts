/**
 * Implementación de t-SNE (t-Distributed Stochastic Neighbor Embedding) y PCA en TypeScript.
 * Permite reducir embeddings de alta dimensión (ej. 768 dims de Jina AI) a 2 dimensiones (X, Y)
 * de forma completamente local en el navegador o servidor, sin dependencias externas.
 */

export interface TsnePoint {
  id: number | string;
  x: number;
  y: number;
  label: string;
  category: string;
  code?: string;
  credits?: number;
  similarity?: number;
  rawRecord?: Record<string, unknown>;
}

export interface TsneOptions {
  perplexity?: number; // Típicamente entre 5 y 50 (default: 15)
  iterations?: number; // Número de iteraciones de descenso de gradiente (default: 250)
  learningRate?: number; // Tasa de aprendizaje (default: 100)
  metric?: "cosine" | "euclidean"; // Métrica de distancia
}

/**
 * Calcula la distancia entre dos vectores según la métrica elegida.
 */
function vectorDistance(a: number[], b: number[], metric: "cosine" | "euclidean" = "cosine"): number {
  if (metric === "cosine") {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;
    // Distancia coseno: 1 - cosine_similarity (rango [0, 2])
    return Math.max(0, 1 - dot / denom);
  } else {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
}

/**
 * Inicialización con PCA simple en 2 dimensiones para acelerar y estabilizar t-SNE
 */
function pca2D(X: number[][]): number[][] {
  const n = X.length;
  const d = X[0].length;
  if (n === 0) return [];

  // 1. Centrar los datos (restar la media)
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      mean[j] += X[i][j];
    }
  }
  for (let j = 0; j < d; j++) {
    mean[j] /= n;
  }

  const centered: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(d);
    for (let j = 0; j < d; j++) {
      row[j] = X[i][j] - mean[j];
    }
    centered.push(Array.from(row));
  }

  // Si hay muy pocos puntos, devolver inicialización con jitter
  if (n <= 2) {
    return centered.map((_, idx) => [idx * 2 - 1, (Math.random() - 0.5) * 0.1]);
  }

  // 2. Aproximación rápida de los 2 primeros componentes principales con método de potencias
  function powerIteration(data: number[][], prevComponent?: number[]): number[] {
    let v = new Float64Array(d);
    for (let j = 0; j < d; j++) v[j] = Math.random() - 0.5;

    for (let iter = 0; iter < 15; iter++) {
      if (prevComponent) {
        // Ortogonalizar contra el componente anterior
        let dot = 0;
        for (let j = 0; j < d; j++) dot += v[j] * prevComponent[j];
        for (let j = 0; j < d; j++) v[j] -= dot * prevComponent[j];
      }

      // Normalizar
      let norm = 0;
      for (let j = 0; j < d; j++) norm += v[j] * v[j];
      norm = Math.sqrt(norm);
      if (norm === 0) break;
      for (let j = 0; j < d; j++) v[j] /= norm;

      // Multiplicar: (X^T * X) * v
      const Xv = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < d; j++) {
          Xv[i] += data[i][j] * v[j];
        }
      }

      const nextV = new Float64Array(d);
      for (let j = 0; j < d; j++) {
        for (let i = 0; i < n; i++) {
          nextV[j] += data[i][j] * Xv[i];
        }
      }
      v = nextV;
    }

    // Normalización final
    let norm = 0;
    for (let j = 0; j < d; j++) norm += v[j] * v[j];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < d; j++) v[j] /= norm;
    }
    return Array.from(v);
  }

  const pc1 = powerIteration(centered);
  const pc2 = powerIteration(centered, pc1);

  // Proyectar datos a 2D
  const Y: number[][] = [];
  for (let i = 0; i < n; i++) {
    let y1 = 0;
    let y2 = 0;
    for (let j = 0; j < d; j++) {
      y1 += centered[i][j] * pc1[j];
      y2 += centered[i][j] * pc2[j];
    }
    Y.push([y1, y2]);
  }

  return Y;
}

/**
 * Algoritmo t-SNE exacto optimizado para navegador.
 * Proyecta una matriz de vectores X (N x D) a Y (N x 2).
 */
export function computeTSNE(
  vectors: number[][],
  options: TsneOptions = {}
): number[][] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0]];
  if (n === 2) return [[-1, 0], [1, 0]];

  const perplexity = Math.min(Math.max(2, options.perplexity ?? 15), Math.max(2, Math.floor((n - 1) / 3)));
  const iterations = options.iterations ?? 250;
  const learningRate = options.learningRate ?? 100;
  const metric = options.metric ?? "cosine";

  // 1. Matriz de distancias al cuadrado
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = vectorDistance(vectors[i], vectors[j], metric);
      const d2 = dist * dist;
      D[i * n + j] = d2;
      D[j * n + i] = d2;
    }
  }

  // 2. Calcular probabilidades condicionales P_j|i mediante búsqueda binaria de sigma_i
  const P = new Float64Array(n * n);
  const targetEntropy = Math.log(perplexity);

  for (let i = 0; i < n; i++) {
    let beta = 1.0; // beta = 1 / (2 * sigma^2)
    let betaMin = -Infinity;
    let betaMax = Infinity;
    const iOffset = i * n;

    for (let attempt = 0; attempt < 50; attempt++) {
      let sumP = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pVal = Math.exp(-D[iOffset + j] * beta);
        P[iOffset + j] = pVal;
        sumP += pVal;
      }

      let entropy = 0;
      if (sumP > 1e-12) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          P[iOffset + j] /= sumP;
          if (P[iOffset + j] > 1e-12) {
            entropy -= P[iOffset + j] * Math.log(P[iOffset + j]);
          }
        }
      } else {
        // Fallback uniforme si sumP es infinitesimal
        for (let j = 0; j < n; j++) {
          if (i !== j) P[iOffset + j] = 1.0 / (n - 1);
        }
        break;
      }

      const entropyDiff = entropy - targetEntropy;
      if (Math.abs(entropyDiff) < 1e-4) break;

      if (entropyDiff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
    }
  }

  // 3. Simetrizar probabilidades P_ij = (P_j|i + P_i|j) / (2N)
  const symP = new Float64Array(n * n);
  const twoN = 2 * n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const val = (P[i * n + j] + P[j * n + i]) / twoN;
        // Exageración temprana inicial (multiplicador 4 para agrupar clusters rápidamente)
        symP[i * n + j] = Math.max(val, 1e-12);
      }
    }
  }

  // 4. Inicializar Y con PCA para que la orientación sea intuitiva y converja en menos pasos
  let Y: number[][] = [];
  try {
    const pcaInit = pca2D(vectors);
    // Escalar PCA a un rango pequeño adecuado para t-SNE
    let maxAbs = 0;
    for (let i = 0; i < n; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(pcaInit[i][0]), Math.abs(pcaInit[i][1]));
    }
    const scale = maxAbs > 0 ? 0.1 / maxAbs : 1e-4;
    Y = pcaInit.map(([x, y]) => [x * scale, y * scale]);
  } catch {
    Y = Array.from({ length: n }, () => [
      (Math.random() - 0.5) * 1e-3,
      (Math.random() - 0.5) * 1e-3,
    ]);
  }

  // Velocidades y momentos para el gradiente con momentum
  const velocity = Array.from({ length: n }, () => [0, 0]);
  const gains = Array.from({ length: n }, () => [1, 1]);

  // 5. Ciclo de Optimización t-SNE
  for (let iter = 0; iter < iterations; iter++) {
    const isEarlyExaggeration = iter < 75;
    const momentum = iter < 100 ? 0.5 : 0.8;
    const exaggeration = isEarlyExaggeration ? 3.0 : 1.0;

    // Calcular distribución q en el espacio 2D (Student-t con 1 grado de libertad)
    // q_ij = (1 + ||y_i - y_j||^2)^(-1) / sum
    const num = new Float64Array(n * n);
    let sumNum = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i][0] - Y[j][0];
        const dy = Y[i][1] - Y[j][1];
        const distSq = dx * dx + dy * dy;
        const qVal = 1.0 / (1.0 + distSq);
        num[i * n + j] = qVal;
        num[j * n + i] = qVal;
        sumNum += 2 * qVal;
      }
    }

    if (sumNum < 1e-12) sumNum = 1e-12;

    // Gradientes dY
    const dY = Array.from({ length: n }, () => [0, 0]);

    for (let i = 0; i < n; i++) {
      let gradX = 0;
      let gradY = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const qVal = num[i * n + j] / sumNum;
        const pVal = symP[i * n + j] * exaggeration;
        const mult = 4.0 * (pVal - qVal) * num[i * n + j];

        gradX += mult * (Y[i][0] - Y[j][0]);
        gradY += mult * (Y[i][1] - Y[j][1]);
      }
      dY[i][0] = gradX;
      dY[i][1] = gradY;
    }

    // Actualizar Y con momentum adaptable (delta-bar-delta)
    for (let i = 0; i < n; i++) {
      for (let dim = 0; dim < 2; dim++) {
        const grad = dY[i][dim];
        const vel = velocity[i][dim];

        // Adaptar gain
        if (grad * vel > 0) {
          gains[i][dim] = Math.max(0.01, gains[i][dim] * 0.8);
        } else {
          gains[i][dim] = gains[i][dim] + 0.2;
        }

        const step = gains[i][dim] * grad;
        velocity[i][dim] = momentum * vel - learningRate * step;
        Y[i][dim] += velocity[i][dim];
      }
    }

    // Centrar Y después de cada iteración
    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < n; i++) {
      meanX += Y[i][0];
      meanY += Y[i][1];
    }
    meanX /= n;
    meanY /= n;
    for (let i = 0; i < n; i++) {
      Y[i][0] -= meanX;
      Y[i][1] -= meanY;
    }
  }

  // Normalizar coordenadas resultantes al rango [-100, 100] para fácil renderizado
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < n; i++) {
    maxX = Math.max(maxX, Math.abs(Y[i][0]));
    maxY = Math.max(maxY, Math.abs(Y[i][1]));
  }

  const maxVal = Math.max(maxX, maxY) || 1;
  const scale = 85 / maxVal;

  return Y.map(([x, y]) => [Math.round(x * scale * 10) / 10, Math.round(y * scale * 10) / 10]);
}
