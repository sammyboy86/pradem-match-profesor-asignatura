import { NextRequest, NextResponse } from "next/server";
import {
  generateEmbeddingsBatch,
  computeCompositeEmbedding,
} from "@/lib/gemini/embeddings";
import { geminiRateLimiter } from "@/lib/gemini/rate-limiter";
import { Profesor, QueryConfig, RegexFilterConfig } from "@/types";
import {
  sanitizarCvParaModelo,
  evaluateProfessorCredentialAcrossFields,
} from "@/lib/sanitizer/cv-sanitizer";

export const maxDuration = 120; // 2 minutos para procesamiento por lotes

export async function POST(req: NextRequest) {
  try {
    const headerKey = req.headers.get("x-gemini-api-key") || undefined;
    const body = await req.json().catch(() => ({}));

    const apiKey = headerKey || body.apiKey;
    const profesores: Profesor[] = body.profesores || [];
    const queryConfigs: QueryConfig[] = body.queryConfigs || [];
    const regexFilter: RegexFilterConfig | undefined = body.regexFilter;

    if (!profesores.length) {
      return NextResponse.json(
        { success: false, error: "Debes proporcionar una lista de 'profesores'." },
        { status: 400 }
      );
    }

    const activeConfigs = queryConfigs.filter((c) => c.active);
    if (!activeConfigs.length) {
      return NextResponse.json(
        { success: false, error: "Debes seleccionar al menos un campo activo para generar los embeddings." },
        { status: 400 }
      );
    }

    // Normalizar pesos sum(w_i) = 1.0 para el vector compuesto
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

    // ── RECOLECTAR TAREAS DE TEXTO PARA GENERACIÓN POR LOTES (GEMINI 2) ──
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

    profesores.forEach((prof, profIndex) => {
      // Si el filtro regex está habilitado, verificar si cuenta con credencial académica
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

    const profFieldEmbeddings: Record<string, number[]>[] = profesores.map(() => ({}));

    if (tasks.length > 0) {
      // Generar embeddings utilizando batchEmbedContents y el RateLimitManager (3,000 RPM / 1M TPM)
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

    // Construir respuesta estructurada con los vectores por criterio y el vector compuesto
    const results = profesores.map((prof, idx) => {
      const fieldEmbeddings = profFieldEmbeddings[idx] || {};
      const compositeEmbedding = computeCompositeEmbedding(fieldEmbeddings, weightMap);

      return {
        id: prof.id,
        nombre_profesor: prof.nombre_profesor,
        profesor: prof,
        embedding_768: compositeEmbedding,
        fieldEmbeddings: fieldEmbeddings,
        sanitizationStatus: profSanitizationStatuses[idx],
      };
    });

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
      rateLimiterStats: geminiRateLimiter.getStats(),
    });
  } catch (error: any) {
    console.error("Error en POST /api/profesores/embed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error interno al generar embeddings de profesores",
      },
      { status: 500 }
    );
  }
}
