"use client";

import React from "react";
import { Zap, Loader2, CheckCircle2, AlertTriangle, Clock, Cpu, ArrowUpRight, Terminal } from "lucide-react";

interface Step3Props {
  isGenerating: boolean;
  onGenerate: () => void;
  sourceColumn: string;
  targetColumn: string;
  hasApiKey: boolean;
  tableExists: boolean;
  progressPercentage: number;
  statusMessage: string;
  logs: string[];
  lastResult?: {
    success: boolean;
    totalUpdated: number;
    tokensUsed: number;
    durationSeconds: number;
    message: string;
    errors?: string[];
  } | null;
}

export default function Step3GenerateAction({
  isGenerating,
  onGenerate,
  sourceColumn,
  targetColumn,
  hasApiKey,
  tableExists,
  progressPercentage,
  statusMessage,
  logs,
  lastResult,
}: Step3Props) {
  const canGenerate = hasApiKey && tableExists && !isGenerating && Boolean(sourceColumn);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm shadow-xl shadow-black/20">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
          3
        </div>
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-400" />
            Acción: Generar e Insertar Embeddings
          </h2>
          <p className="text-xs text-slate-400">
            Vectorización con Jina AI e inserción directa en la tabla <code className="text-amber-300 font-mono">asignaturas_extraidas</code>.
          </p>
        </div>
      </div>

      {/* Botón Principal Prominente y Vertical */}
      <div className="space-y-4">
        <div className="p-4 rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <h3 className="text-sm font-semibold text-white flex items-center justify-center sm:justify-start gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              ¿Todo listo para vectorizar?
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Tomará la columna <span className="font-mono text-indigo-300 font-semibold">&ldquo;{sourceColumn}&rdquo;</span> y guardará los vectores en <span className="font-mono text-emerald-300 font-semibold">&ldquo;{targetColumn}&rdquo;</span>.
            </p>
          </div>

          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className={`relative group overflow-hidden w-full sm:w-auto px-8 py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 shadow-xl flex items-center justify-center gap-2.5 ${
              canGenerate
                ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] cursor-pointer"
                : "bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed"
            }`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-white" />
                <span>Generando e Insertando...</span>
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 fill-amber-300 text-amber-300 group-hover:scale-110 transition-transform" />
                <span>⚡ Generar Embeddings en asignaturas_extraidas</span>
              </>
            )}
          </button>
        </div>

        {/* Alertas de requisitos faltantes */}
        {!hasApiKey && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>Por favor configura tu JINA_API_KEY en el Paso 1 para habilitar la generación de embeddings.</span>
          </div>
        )}

        {!tableExists && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>La tabla asignaturas_extraidas no se encuentra disponible en Supabase.</span>
          </div>
        )}

        {/* Barra de progreso interactiva si está generando o terminó */}
        {(isGenerating || progressPercentage > 0) && (
          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-2">
                {isGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />}
                {statusMessage || "Procesando registros..."}
              </span>
              <span className="font-mono font-bold text-indigo-400">
                {progressPercentage}%
              </span>
            </div>

            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        )}

        {/* Resumen del último resultado exitoso */}
        {lastResult && (
          <div
            className={`rounded-xl border p-4 space-y-3 ${
              lastResult.success
                ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                : "border-red-500/30 bg-red-950/20 text-red-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-xs text-white">
                {lastResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                )}
                <span>{lastResult.message}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-black/30 p-2">
                <span className="text-[10px] text-slate-400 block">Registros Guardados</span>
                <span className="font-bold text-white text-sm">{lastResult.totalUpdated}</span>
              </div>
              <div className="rounded-lg bg-black/30 p-2">
                <span className="text-[10px] text-slate-400 block">Tokens Consumidos</span>
                <span className="font-bold text-indigo-300 text-sm">{lastResult.tokensUsed}</span>
              </div>
              <div className="rounded-lg bg-black/30 p-2">
                <span className="text-[10px] text-slate-400 block">Tiempo Total</span>
                <span className="font-bold text-emerald-300 text-sm">{lastResult.durationSeconds}s</span>
              </div>
            </div>

            {lastResult.errors && lastResult.errors.length > 0 && (
              <div className="p-2 rounded bg-black/40 text-[11px] text-red-300 font-mono space-y-1">
                <div className="font-bold">Advertencias / Errores:</div>
                {lastResult.errors.map((err, idx) => (
                  <div key={idx}>• {err}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Consola de logs en tiempo real */}
        {logs.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-black/60 p-3.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400 pb-2 border-b border-white/5 mb-2 font-mono">
              <span className="flex items-center gap-1.5 text-indigo-400 font-semibold">
                <Terminal className="h-3.5 w-3.5" />
                Registro de Ejecución en Vivo
              </span>
              <span>{logs.length} eventos</span>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] font-mono text-slate-300 pr-1">
              {logs.map((log, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-slate-500 select-none">&gt;</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
