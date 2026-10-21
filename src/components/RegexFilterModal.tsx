"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  X,
  ShieldCheck,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Info,
  Check,
  Play,
  FileText,
  Sliders,
} from "lucide-react";
import { RegexFilterConfig, Profesor } from "@/types";
import {
  DEFAULT_REGEX_FILTER_CONFIG,
  validateRegexPattern,
  sanitizarCvParaModelo,
  evaluateProfessorCredentialAcrossFields,
} from "@/lib/sanitizer/cv-sanitizer";

interface RegexFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: RegexFilterConfig;
  onChangeConfig: (newConfig: RegexFilterConfig) => void;
  profesores?: Profesor[];
}

export function RegexFilterModal({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  profesores = [],
}: RegexFilterModalProps) {
  // Estado local para prueba interactiva
  const [testText, setTestText] = useState(
    "Ingeniero en Computación con 8 años como docente frente a grupo impartiendo clases de algoritmos y programación. Profesor de posgrado."
  );
  const [selectedProfIndex, setSelectedProfIndex] = useState<number | "custom">("custom");
  const [savedBadge, setSavedBadge] = useState(false);

  // Validación de expresiones regulares en tiempo real
  const credencialValidation = useMemo(
    () => validateRegexPattern(config.regexCredencial),
    [config.regexCredencial]
  );
  const experienciaValidation = useMemo(
    () => validateRegexPattern(config.regexExperiencia),
    [config.regexExperiencia]
  );

  // Disparar animación de guardado cuando cambia la config
  useEffect(() => {
    setSavedBadge(true);
    const timer = setTimeout(() => setSavedBadge(false), 1800);
    return () => clearTimeout(timer);
  }, [config]);

  // Si se selecciona un profesor de la lista, cargar su texto combinado
  const handleSelectProfesor = (idx: number | "custom") => {
    setSelectedProfIndex(idx);
    if (idx === "custom") {
      setTestText(
        "Ingeniero en Computación con 8 años como docente frente a grupo impartiendo clases de algoritmos y programación. Profesor de posgrado."
      );
    } else {
      const p = profesores[idx];
      if (p) {
        const textParts: string[] = [];
        Object.entries(p).forEach(([key, val]) => {
          if (
            key !== "id" &&
            key !== "nombre_profesor" &&
            key !== "embedding_768" &&
            key !== "fieldEmbeddings" &&
            typeof val === "string" &&
            val.trim()
          ) {
            textParts.push(`${key}: ${val.trim()}`);
          }
        });
        setTestText(textParts.join("\n\n") || p.nombre_profesor || "Perfil sin datos de texto");
      }
    }
  };

  // Cálculo en vivo del resultado de sanitización para la prueba interactiva
  const liveResult = useMemo(() => {
    let contextHasCredential = false;
    if (config.checkAcrossAllFields && selectedProfIndex !== "custom" && profesores[selectedProfIndex]) {
      contextHasCredential = evaluateProfessorCredentialAcrossFields(
        profesores[selectedProfIndex],
        config.regexCredencial
      );
    }

    return sanitizarCvParaModelo(
      testText,
      config,
      selectedProfIndex !== "custom" && config.checkAcrossAllFields ? contextHasCredential : undefined
    );
  }, [testText, config, selectedProfIndex, profesores]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border border-white/15 bg-slate-900/95 shadow-2xl backdrop-blur-xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-500/15 p-3 text-indigo-400 border border-indigo-500/30 shadow-inner">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Filtro Regex Anti-Sesgo Docente
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border transition ${
                    config.enabled
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-slate-700/50 text-slate-400 border-slate-600/40"
                  }`}
                >
                  {config.enabled ? "FILTRO ACTIVO" : "INACTIVO"}
                </span>
                {savedBadge && (
                  <span className="flex items-center gap-1 text-[11px] text-cyan-300 animate-in fade-in">
                    <Check className="h-3 w-3" />
                    Guardado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Mitigación automática de sesgo en embeddings: enmascara palabras detonantes de experiencia si el docente no cuenta con credenciales pedagógicas oficiales.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* Switch Principal de Activación */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-4 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-indigo-400" />
                <span className="text-sm font-bold text-white">
                  Activar Filtro Regex en Generación de Embeddings
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 max-w-xl">
                Al estar activo, el texto de cada campo del docente se evaluará antes de enviarse al modelo Gemini 2. Si cuenta con título o posgrado en educación, su perfil se mantiene intacto; de lo contrario, se neutraliza la experiencia docente declarativa.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({
                    ...config,
                    enabled: !config.enabled,
                  })
                }
                className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  config.enabled ? "bg-indigo-600" : "bg-slate-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    config.enabled ? "translate-x-7" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Formulario de Configuración de Regexes */}
          <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/40 p-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  Reglas de Detección y Sanitización (RegEx)
                </h4>
              </div>

              <button
                type="button"
                onClick={() => onChangeConfig(DEFAULT_REGEX_FILTER_CONFIG)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                title="Restaura la configuración a la función por defecto de Python"
              >
                <RotateCcw className="h-3 w-3 text-slate-400" />
                <span>Restablecer Valores Predeterminados</span>
              </button>
            </div>

            {/* Regla 1: Regex Credencial */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span>1. Expresión Regular de Credenciales Acreditadas</span>
                  <code className="text-purple-300 bg-purple-950/50 px-1.5 py-0.5 rounded text-[11px]">
                    regex_credencial
                  </code>
                </label>
                {credencialValidation.isValid ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3 w-3" />
                    Sintaxis válida
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                    <AlertTriangle className="h-3 w-3" />
                    {credencialValidation.error || "Error de sintaxis"}
                  </span>
                )}
              </div>
              <textarea
                rows={2}
                value={config.regexCredencial}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    regexCredencial: e.target.value,
                  })
                }
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2.5 font-mono text-xs text-purple-200 focus:outline-none focus:ring-1 focus:ring-purple-500 shadow-inner resize-y"
                placeholder="(?i)\b(licenciatura|maestria|doctorado)...\b"
              />
              <p className="text-[11px] text-slate-400">
                Si el texto del docente contiene alguna coincidencia de esta credencial oficial, se considera formación pedagógica legítima y su perfil <strong>se deja 100% intacto</strong>.
              </p>
            </div>

            {/* Regla 2: Regex Experiencia */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span>2. Expresión Regular de Términos Detonantes de Experiencia</span>
                  <code className="text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded text-[11px]">
                    regex_experiencia
                  </code>
                </label>
                {experienciaValidation.isValid ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3 w-3" />
                    Sintaxis válida
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                    <AlertTriangle className="h-3 w-3" />
                    {experienciaValidation.error || "Error de sintaxis"}
                  </span>
                )}
              </div>
              <textarea
                rows={2}
                value={config.regexExperiencia}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    regexExperiencia: e.target.value,
                  })
                }
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2.5 font-mono text-xs text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-inner resize-y"
                placeholder="(?i)\b(docente|docencia|experiencia docente|profesor)\b"
              />
              <p className="text-[11px] text-slate-400">
                Palabras o frases que serán ocultadas/reemplazadas cuando el docente <strong>NO</strong> tenga credencial en educación.
              </p>
            </div>

            {/* Regla 3: Texto de Reemplazo Neutral */}
            <div className="space-y-2">
              <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span>3. Texto de Reemplazo Sanitizado</span>
                <span className="text-slate-400 text-[11px]">(Término neutral sustituto)</span>
              </label>
              <input
                type="text"
                value={config.replacementText}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    replacementText: e.target.value,
                  })
                }
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2.5 font-mono text-xs text-cyan-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 shadow-inner"
                placeholder="profesional_con_experiencia_frente_a_grupo"
              />
            </div>

            {/* Checkbox Opción: Evaluar en perfil completo */}
            <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={config.checkAcrossAllFields !== false}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    checkAcrossAllFields: e.target.checked,
                  })
                }
                className="mt-0.5 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <div>
                <span className="font-semibold text-slate-200">
                  Evaluar credenciales en el perfil completo del docente (Recomendado)
                </span>
                <p className="text-[11px] text-slate-400">
                  Permite reconocer credenciales pedagógicas si se encuentran en cualquier columna (ej. "Grado Académico"), evitando enmascarar incorrectamente columnas independientes como "Experiencia Laboral".
                </p>
              </div>
            </label>
          </div>

          {/* Sandbox de Prueba en Tiempo Real (Interactive Playground) */}
          <div className="space-y-3 rounded-2xl border border-cyan-500/30 bg-cyan-950/15 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-cyan-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                  Simulador en Vivo / Probar Filtro
                </h4>
              </div>

              {profesores.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">Probar con docente cargado:</span>
                  <select
                    value={selectedProfIndex}
                    onChange={(e) =>
                      handleSelectProfesor(
                        e.target.value === "custom" ? "custom" : Number(e.target.value)
                      )
                    }
                    className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-[11px] text-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="custom">-- Texto personalizado de ejemplo --</option>
                    {profesores.slice(0, 50).map((p, idx) => (
                      <option key={p.id ?? idx} value={idx}>
                        #{idx + 1} - {p.nombre_profesor || `Profesor ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Entrada del texto de prueba */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                <span>Texto de entrada a evaluar:</span>
              </label>
              <textarea
                rows={3}
                value={testText}
                onChange={(e) => {
                  setSelectedProfIndex("custom");
                  setTestText(e.target.value);
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 shadow-inner resize-y font-mono"
                placeholder="Escribe o pega aquí el CV o descripción para probar..."
              />
            </div>

            {/* Tarjeta de Diagnóstico y Resultado */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* Columna Izquierda: Diagnóstico */}
              <div
                className={`rounded-xl border p-3.5 space-y-2 ${
                  !config.enabled
                    ? "border-slate-700 bg-slate-900/50 text-slate-400"
                    : liveResult.matchedCredential
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : liveResult.termsReplacedCount && liveResult.termsReplacedCount > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    : "border-slate-700 bg-slate-900/50 text-slate-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  {!config.enabled ? (
                    <>
                      <Info className="h-4 w-4 text-slate-400" />
                      <span className="font-bold text-white text-xs">Filtro Inactivo</span>
                    </>
                  ) : liveResult.matchedCredential ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="font-bold text-emerald-300 text-xs">
                        Credencial Académica Detectada (Texto Intacto)
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <span className="font-bold text-amber-300 text-xs">
                        Sin Credencial Pedagógica (Sesgo Mitigado)
                      </span>
                    </>
                  )}
                </div>

                <p className="text-[11px] leading-relaxed">
                  {!config.enabled ? (
                    "El filtro se encuentra apagado. El texto se enviará a Gemini 2 exactamente como fue ingresado."
                  ) : liveResult.matchedCredential ? (
                    "El aspirante cuenta con credencial formal en educación/pedagogía. El texto se envía íntegro para aprovechar su mérito académico oficial."
                  ) : (
                    <>
                      Se detectaron y reemplazaron{" "}
                      <strong className="text-white font-mono">
                        {liveResult.termsReplacedCount || 0}
                      </strong>{" "}
                      término(s) detonante(s) de experiencia por{" "}
                      <code className="text-cyan-300 bg-black/40 px-1 py-0.5 rounded font-mono">
                        {config.replacementText}
                      </code>
                      .
                    </>
                  )}
                </p>
              </div>

              {/* Columna Derecha: Vista Previa del Texto Sanitizado Final */}
              <div className="rounded-xl border border-white/10 bg-slate-950 p-3.5 space-y-1.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Texto Final Enviado al Modelo de Embeddings:
                </span>
                <p className="text-xs font-mono text-cyan-200 max-h-24 overflow-y-auto leading-relaxed bg-black/30 p-2 rounded-lg border border-white/5 select-all">
                  {liveResult.sanitizedText || "(Texto vacío)"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 px-6 py-4 bg-slate-950/80">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Los cambios se guardan automáticamente en este navegador (localStorage)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition cursor-pointer shadow-lg shadow-indigo-600/30"
          >
            Listo / Aplicar Configuración
          </button>
        </div>
      </div>
    </div>
  );
}
