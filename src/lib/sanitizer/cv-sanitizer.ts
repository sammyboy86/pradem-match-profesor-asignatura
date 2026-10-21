/**
 * Módulo de Sanitización de CVs y Perfiles Docentes para Mitigación de Sesgos.
 *
 * Aplica filtros basados en expresiones regulares antes de la generación de embeddings
 * multimodales con Gemini 2.
 *
 * Lógica:
 * 1. Si el docente cuenta con una credencial académica comprobable en educación o pedagogía
 *    (definida por `regex_credencial`), el texto permanece íntegro e intacto.
 * 2. Si NO cuenta con dicha credencial pedagógica, se enmascaran o sanitizan las palabras
 *    detonantes de sesgo (definidas por `regex_experiencia`) sustituyéndolas por el término neutral
 *    (ej. "profesional_con_experiencia_frente_a_grupo").
 */

import { RegexFilterConfig } from "@/types";

export const DEFAULT_REGEX_CREDENCIAL =
  "(?i)\\b(licenciatura|maestr[íi]a|doctorado|especialidad|diplomado|certificado|t[íi]tulo|ciencias)\\s+(en\\s+)?(educaci[óo]n|pedagog[íi]a|docencia|did[áa]ctica)\\b|\\b(pedagogo|pedagoga|normalista)\\b";

export const DEFAULT_REGEX_EXPERIENCIA =
  "(?i)\\b(docente(\\s+frente\\s+a\\s+grupo)?|docencia|experiencia\\s+docente|impartiendo\\s+clase[s]?|profesor)\\b";

export const DEFAULT_REPLACEMENT_TEXT = "profesional_con_experiencia_frente_a_grupo";

export const DEFAULT_REGEX_FILTER_CONFIG: RegexFilterConfig = {
  enabled: true,
  regexCredencial: DEFAULT_REGEX_CREDENCIAL,
  regexExperiencia: DEFAULT_REGEX_EXPERIENCIA,
  replacementText: DEFAULT_REPLACEMENT_TEXT,
  checkAcrossAllFields: true,
};

/**
 * Compila de forma segura una expresión regular que puede provenir de Python
 * (por ejemplo con prefijo `(?i)` para case-insensitive).
 */
export function buildSafeRegExp(rawPattern: string, defaultFlags: string = "i"): RegExp | null {
  if (!rawPattern || typeof rawPattern !== "string" || !rawPattern.trim()) {
    return null;
  }

  try {
    let pattern = rawPattern.trim();
    let flags = defaultFlags;

    // Quitar prefijos comunes de expresiones regulares de Python (?i), (?iu), (?ui)
    if (pattern.startsWith("(?i)")) {
      pattern = pattern.slice(4);
      if (!flags.includes("i")) flags += "i";
    } else if (pattern.startsWith("(?iu)") || pattern.startsWith("(?ui)")) {
      pattern = pattern.slice(5);
      if (!flags.includes("i")) flags += "i";
      if (!flags.includes("u")) flags += "u";
    }

    return new RegExp(pattern, flags);
  } catch (err) {
    console.warn("Error al compilar expresión regular:", rawPattern, err);
    return null;
  }
}

/**
 * Valida la sintaxis de una expresión regular sin arrojar excepciones.
 */
export function validateRegexPattern(rawPattern: string): { isValid: boolean; error?: string } {
  if (!rawPattern || typeof rawPattern !== "string" || !rawPattern.trim()) {
    return { isValid: false, error: "El patrón no puede estar vacío." };
  }
  try {
    let pattern = rawPattern.trim();
    if (pattern.startsWith("(?i)")) pattern = pattern.slice(4);
    if (pattern.startsWith("(?iu)") || pattern.startsWith("(?ui)")) pattern = pattern.slice(5);
    new RegExp(pattern);
    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, error: err.message || "Sintaxis de expresión regular inválida." };
  }
}

/**
 * Verifica si un texto contiene alguna credencial académica de educación/pedagogía.
 */
export function hasAcademicCredential(text: string, patternCredencial: string): boolean {
  if (!text || typeof text !== "string") return false;
  const re = buildSafeRegExp(patternCredencial, "i");
  if (!re) return false;
  return re.test(text);
}

/**
 * Sanitiza un texto específico según la configuración del filtro regex.
 *
 * @param textoCv Texto del campo o CV del docente.
 * @param config Configuración del filtro regex.
 * @param contextHasCredential Si ya se evaluó positivamente la credencial en el perfil global del profesor.
 * @returns Texto sanitizado y el estado del procesamiento ('intact' | 'sanitized' | 'bypassed').
 */
export function sanitizarCvParaModelo(
  textoCv: string,
  config?: RegexFilterConfig,
  contextHasCredential?: boolean
): {
  sanitizedText: string;
  status: "intact" | "sanitized" | "bypassed";
  matchedCredential?: boolean;
  termsReplacedCount?: number;
} {
  if (!textoCv || typeof textoCv !== "string") {
    return { sanitizedText: "", status: "bypassed", matchedCredential: false, termsReplacedCount: 0 };
  }

  // Si el filtro no está activo o no está provisto, devolver sin cambios
  if (!config || !config.enabled) {
    return { sanitizedText: textoCv, status: "bypassed", matchedCredential: false, termsReplacedCount: 0 };
  }

  const patternCred = config.regexCredencial || DEFAULT_REGEX_CREDENCIAL;
  const patternExp = config.regexExperiencia || DEFAULT_REGEX_EXPERIENCIA;
  const replacement = config.replacementText !== undefined ? config.replacementText : DEFAULT_REPLACEMENT_TEXT;

  // 1. Si el contexto ya validó credenciales o el texto actual las contiene, dejamos el texto intacto
  const tieneCredencial =
    contextHasCredential !== undefined
      ? contextHasCredential
      : hasAcademicCredential(textoCv, patternCred);

  if (tieneCredencial) {
    return {
      sanitizedText: textoCv,
      status: "intact",
      matchedCredential: true,
      termsReplacedCount: 0,
    };
  }

  // 2. Si NO tiene credencial, ocultamos las palabras detonantes de sesgo
  const reExp = buildSafeRegExp(patternExp, "gi");
  if (!reExp) {
    return {
      sanitizedText: textoCv,
      status: "bypassed",
      matchedCredential: false,
      termsReplacedCount: 0,
    };
  }

  let replaceCount = 0;
  const sanitized = textoCv.replace(reExp, (match) => {
    replaceCount++;
    return replacement;
  });

  return {
    sanitizedText: sanitized,
    status: replaceCount > 0 ? "sanitized" : "intact",
    matchedCredential: false,
    termsReplacedCount: replaceCount,
  };
}

/**
 * Evalúa el perfil completo de un profesor para determinar si cuenta con credenciales académicas,
 * permitiendo considerar columnas separadas (como "Estudios" y "Experiencia").
 */
export function evaluateProfessorCredentialAcrossFields(
  profesor: Record<string, any>,
  patternCredencial: string,
  candidateFields?: string[]
): boolean {
  if (!profesor || typeof profesor !== "object") return false;

  const fieldsToCheck = candidateFields && candidateFields.length > 0
    ? candidateFields
    : Object.keys(profesor).filter(
        (k) =>
          k !== "id" &&
          k !== "embedding_768" &&
          k !== "fieldEmbeddings" &&
          k !== "sanitizationStatus"
      );

  const texts: string[] = [];
  for (const field of fieldsToCheck) {
    const val = profesor[field];
    if (typeof val === "string" && val.trim()) {
      texts.push(val.trim());
    } else if (typeof val === "number") {
      texts.push(String(val));
    }
  }

  const combinedText = texts.join(" ");
  return hasAcademicCredential(combinedText, patternCredencial);
}
