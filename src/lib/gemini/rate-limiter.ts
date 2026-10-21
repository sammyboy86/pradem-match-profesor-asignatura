/**
 * Gestor de límites de tasa (Rate-Limit Manager) para llamadas a Gemini 2 Embeddings.
 * 
 * Implementa un algoritmo híbrido de ventana deslizante (sliding window) y token bucket
 * que restringe de manera estricta el throughput a:
 * - 3,000 Peticiones Por Minuto (RPM)
 * - 1,000,000 Tokens Por Minuto (TPM)
 * 
 * Incluye además reintentos con retroceso exponencial (exponential backoff) y aleatorización
 * (jitter) para capturar y mitigar errores HTTP 429 (Too Many Requests / Quota Exceeded).
 */

export interface RateLimiterConfig {
  maxRpm?: number;         // Límite de peticiones por minuto (default: 3000)
  maxTpm?: number;         // Límite de tokens por minuto (default: 1,000,000)
  windowMs?: number;       // Tamaño de la ventana deslizante en ms (default: 60,000)
}

export interface UsageRecord {
  timestamp: number;
  requests: number;
  tokens: number;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
}

export interface RateLimiterStats {
  currentWindowRequests: number;
  maxRpm: number;
  rpmUtilizationPct: number;
  currentWindowTokens: number;
  maxTpm: number;
  tpmUtilizationPct: number;
  totalRequestsLifetime: number;
  totalTokensLifetime: number;
  total429Retries: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Estima la cantidad de tokens de un texto o conjunto de textos para Gemini.
 * En español y modelos multimodales/multilingües de Gemini, 1 token ≈ 3.2 a 3.5 caracteres.
 * Usamos una razón conservadora de 3.2 caracteres por token para evitar desbordar el TPM.
 */
export function estimateTokens(input: string | string[]): number {
  if (Array.isArray(input)) {
    return input.reduce((acc, text) => acc + estimateTokens(text), 0);
  }
  if (!input || typeof input !== "string") return 1;
  const trimmed = input.trim();
  if (trimmed.length === 0) return 1;
  return Math.max(1, Math.ceil(trimmed.length / 3.2));
}

/**
 * Detecta si un error corresponde a un límite de cuota (HTTP 429 / RESOURCE_EXHAUSTED).
 */
export function isRateLimitOrQuotaError(error: any): boolean {
  if (!error) return false;

  const status = error.status || error.statusCode || error.httpStatusCode || error?.response?.status;
  if (status === 429 || status === 503) {
    return true;
  }

  const code = error.code || error?.error?.code;
  if (code === 429 || code === "RESOURCE_EXHAUSTED") {
    return true;
  }

  const message = String(error.message || error?.error?.message || error || "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("too many requests") ||
    message.includes("overloaded")
  );
}

/**
 * Intenta extraer el tiempo de espera indicado en la cabecera Retry-After o mensaje de error.
 */
export function extractRetryAfterMs(error: any): number | null {
  try {
    const header = error?.response?.headers?.get?.("retry-after") || error?.headers?.["retry-after"];
    if (header) {
      const seconds = parseFloat(header);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.round(seconds * 1000);
      }
      const date = new Date(header);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    }

    const message = String(error?.message || "");
    const matchSec = message.match(/retry(?: after)? ([0-9.]+)s/i);
    if (matchSec && matchSec[1]) {
      const s = parseFloat(matchSec[1]);
      if (!isNaN(s) && s > 0) return Math.round(s * 1000);
    }

    const matchMs = message.match(/retry(?: in)? ([0-9]+)ms/i);
    if (matchMs && matchMs[1]) {
      const ms = parseInt(matchMs[1], 10);
      if (!isNaN(ms) && ms > 0) return ms;
    }
  } catch {
    // Ignorar errores al parsear cabecera
  }
  return null;
}

export class RateLimitManager {
  private readonly maxRpm: number;
  private readonly maxTpm: number;
  private readonly windowMs: number;

  private history: UsageRecord[] = [];
  private windowRequests = 0;
  private windowTokens = 0;

  private totalRequests = 0;
  private totalTokens = 0;
  private total429Retries = 0;

  // Cola de sincronización FIFO para prevenir condiciones de carrera entre llamadas concurrentes
  private queueTail: Promise<void> = Promise.resolve();

  constructor(config: RateLimiterConfig = {}) {
    this.maxRpm = config.maxRpm ?? 3000;
    this.maxTpm = config.maxTpm ?? 1_000_000;
    this.windowMs = config.windowMs ?? 60_000;
  }

  /**
   * Elimina de la ventana deslizante los registros que hayan expirado
   */
  private purgeExpired(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.history.length > 0 && this.history[0].timestamp < cutoff) {
      const removed = this.history.shift()!;
      this.windowRequests = Math.max(0, this.windowRequests - removed.requests);
      this.windowTokens = Math.max(0, this.windowTokens - removed.tokens);
    }
  }

  /**
   * Calcula con exactitud cuántos milisegundos esperar hasta que expire suficiente
   * cuota en la ventana deslizante para admitir los requests y tokens solicitados.
   */
  private calculateWaitTime(now: number, neededRequests: number, neededTokens: number): number {
    const reqDeficit = Math.max(0, this.windowRequests + neededRequests - this.maxRpm);
    const tokenDeficit = Math.max(0, this.windowTokens + neededTokens - this.maxTpm);

    if (reqDeficit === 0 && tokenDeficit === 0) return 0;

    let freedReqs = 0;
    let freedTokens = 0;
    let targetTimestamp = now - this.windowMs;

    for (const entry of this.history) {
      if (freedReqs < reqDeficit) {
        freedReqs += entry.requests;
      }
      if (freedTokens < tokenDeficit) {
        freedTokens += entry.tokens;
      }
      targetTimestamp = entry.timestamp;

      if (freedReqs >= reqDeficit && freedTokens >= tokenDeficit) {
        break;
      }
    }

    const waitMs = targetTimestamp + this.windowMs - now + 25; // +25ms de margen de seguridad
    return Math.max(15, waitMs);
  }

  /**
   * Adquiere cupo en el gestor de tasa de forma sincronizada respetando 3,000 RPM y 1,000,000 TPM.
   * Si la tasa actual excede los límites, la promesa se suspende automáticamente hasta
   * que la ventana deslizante se desplace y libere el presupuesto necesario.
   */
  public async acquire(requests = 1, tokens = 1): Promise<void> {
    const ticket = this.queueTail.then(async () => {
      while (true) {
        const now = Date.now();
        this.purgeExpired(now);

        const fitsRequests = this.windowRequests + requests <= this.maxRpm;
        const fitsTokens = this.windowTokens + tokens <= this.maxTpm;

        if (fitsRequests && fitsTokens) {
          // Reservar cupo
          this.history.push({ timestamp: now, requests, tokens });
          this.windowRequests += requests;
          this.windowTokens += tokens;
          this.totalRequests += requests;
          this.totalTokens += tokens;
          return;
        }

        const waitMs = this.calculateWaitTime(now, requests, tokens);
        await wait(waitMs);
      }
    });

    this.queueTail = ticket.catch(() => {});
    return ticket;
  }

  /**
   * Envuelve una función asíncrona con reintentos basados en retroceso exponencial (exponential backoff)
   * y aleatorización (jitter) para absorber picos y mitigar HTTP 429 sin provocar caídas.
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 5;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 30000;
    const jitterFactor = options.jitterFactor ?? 0.5;

    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        attempt++;
        const isQuotaErr = isRateLimitOrQuotaError(error);

        if (!isQuotaErr || attempt > maxRetries) {
          throw error;
        }

        this.total429Retries++;

        // Consultar cabecera Retry-After si estuviera presente
        const retryAfter = extractRetryAfterMs(error);
        let delayMs: number;

        if (retryAfter && retryAfter > 0) {
          delayMs = retryAfter + Math.random() * 500;
        } else {
          // Retroceso exponencial: base * 2^(attempt - 1)
          const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
          // Jitter aleatorio simétrico
          const jitter = exponential * jitterFactor * (0.5 + Math.random() * 0.5);
          delayMs = Math.min(maxDelayMs, exponential + jitter);
        }

        console.warn(
          `[GeminiRateLimiter] HTTP 429 / Cuota excedida detectada. Reintento ${attempt}/${maxRetries} programado en ${Math.round(delayMs)}ms...`
        );

        await wait(delayMs);
      }
    }
  }

  /**
   * Ejecuta una llamada protegida integralmente: solicita presupuesto en la ventana
   * deslizante y la ejecuta dentro del ciclo de retroceso exponencial ante 429.
   */
  public async schedule<T>(
    operation: () => Promise<T>,
    estimatedTokens: number,
    requestsCount = 1,
    retryOptions?: RetryOptions
  ): Promise<T> {
    await this.acquire(requestsCount, estimatedTokens);
    return this.executeWithRetry(operation, retryOptions);
  }

  /**
   * Obtiene métricas en tiempo real del uso de cuota
   */
  public getStats(): RateLimiterStats {
    this.purgeExpired(Date.now());
    return {
      currentWindowRequests: this.windowRequests,
      maxRpm: this.maxRpm,
      rpmUtilizationPct: Number(((this.windowRequests / this.maxRpm) * 100).toFixed(1)),
      currentWindowTokens: this.windowTokens,
      maxTpm: this.maxTpm,
      tpmUtilizationPct: Number(((this.windowTokens / this.maxTpm) * 100).toFixed(1)),
      totalRequestsLifetime: this.totalRequests,
      totalTokensLifetime: this.totalTokens,
      total429Retries: this.total429Retries,
    };
  }
}

/**
 * Instancia singleton global para gestionar el ritmo de llamadas a Gemini 2 (3000 RPM / 1M TPM)
 */
export const geminiRateLimiter = new RateLimitManager({
  maxRpm: 3000,
  maxTpm: 1_000_000,
  windowMs: 60_000,
});
