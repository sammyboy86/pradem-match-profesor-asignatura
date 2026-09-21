"use client";

import React from "react";
import { Sliders, Sparkles, Check, Plus, AlertCircle, ArrowRight } from "lucide-react";

interface ColumnInfo {
  name: string;
  type: string;
}

interface Step2Props {
  columns: ColumnInfo[];
  sourceColumn: string;
  onSourceColumnChange: (col: string) => void;
  targetColumn: string;
  onTargetColumnChange: (col: string) => void;
  mode: "missing_only" | "all";
  onModeChange: (mode: "missing_only" | "all") => void;
  sampleValue?: string;
  existingTargetColumn: boolean;
}

export default function Step2EmbeddingConfig({
  columns,
  sourceColumn,
  onSourceColumnChange,
  targetColumn,
  onTargetColumnChange,
  mode,
  onModeChange,
  sampleValue,
  existingTargetColumn,
}: Step2Props) {
  const quickTargetNames = ["embedding", "embedding_jina", "embedding_nombre"];

  // Filtrar columnas elegibles para origen (omitir id, created_at y la misma columna destino)
  const eligibleSourceCols = columns.filter(
    (c) => !["id", "created_at"].includes(c.name.toLowerCase()) && c.name !== targetColumn
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm shadow-xl shadow-black/20">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
          2
        </div>
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sliders className="h-4 w-4 text-indigo-400" />
            Configuración de Columnas y Modelo
          </h2>
          <p className="text-xs text-slate-400">
            Define la columna origen con el texto a vectorizar y la columna donde se insertarán los embeddings.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna Izquierda: Selección de Columna Origen */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider mb-2">
              1. Elegir de cuál columna hacer los embeddings:
            </label>
            <div className="relative">
              <select
                value={sourceColumn}
                onChange={(e) => onSourceColumnChange(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/90 px-4 py-2.5 text-sm text-white font-medium focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
              >
                {eligibleSourceCols.length === 0 ? (
                  <option value="nombre">nombre (por defecto)</option>
                ) : (
                  eligibleSourceCols.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name} ({col.type})
                    </option>
                  ))
                )}
              </select>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Se tomará el texto de esta columna (ej: nombre o descripción de la materia) para pasarlo a Jina AI.
            </p>
          </div>

          {/* Vista previa del valor de muestra */}
          {sampleValue && (
            <div className="rounded-xl border border-white/5 bg-black/30 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                <span>Muestra de texto a vectorizar:</span>
                <span className="font-mono text-indigo-400">{sourceColumn}</span>
              </div>
              <p className="text-xs text-slate-200 font-medium italic truncate">
                &ldquo;{sampleValue}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Columna Derecha: Nombrar Columna Destino */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider mb-2">
              2. Nombrar columna donde insertarlos en asignaturas_extraidas:
            </label>
            <div className="relative">
              <input
                type="text"
                value={targetColumn}
                onChange={(e) => onTargetColumnChange(e.target.value)}
                placeholder="ej: embedding"
                className="w-full rounded-xl border border-white/10 bg-slate-900/90 px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
              />
            </div>

            {/* Chips de nombres sugeridos */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-slate-400">Sugerencias:</span>
              {quickTargetNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onTargetColumnChange(name)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-mono transition border ${
                    targetColumn === name
                      ? "border-indigo-500 bg-indigo-500/20 text-indigo-300 font-semibold"
                      : "border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>

            {/* Indicador de si la columna existe o se creará */}
            <div className="mt-2.5">
              {existingTargetColumn ? (
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] text-emerald-300">
                  <Check className="h-3.5 w-3.5" />
                  La columna <code className="font-mono">{targetColumn}</code> ya existe en Supabase y será actualizada.
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-[11px] text-indigo-300">
                  <Plus className="h-3.5 w-3.5" />
                  La columna <code className="font-mono">{targetColumn}</code> no existe aún; se creará automáticamente como <code className="font-mono">jsonb</code> al presionar generar.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Selector de Modo de Ejecución */}
      <div className="mt-6 pt-4 border-t border-white/10">
        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
          3. Modo de procesamiento:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label
            onClick={() => onModeChange("missing_only")}
            className={`cursor-pointer rounded-xl border p-3.5 flex items-start gap-3 transition ${
              mode === "missing_only"
                ? "border-indigo-500 bg-indigo-500/10 shadow-sm"
                : "border-white/10 bg-slate-900/40 hover:bg-slate-900/70"
            }`}
          >
            <input
              type="radio"
              name="execMode"
              checked={mode === "missing_only"}
              onChange={() => onModeChange("missing_only")}
              className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-600"
            />
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Solo registros pendientes (Recomendado)</span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[10px] text-emerald-300 font-normal">
                  Económico & Rápido
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                Genera embeddings únicamente para las asignaturas que aún tengan valor nulo en la columna destino.
              </p>
            </div>
          </label>

          <label
            onClick={() => onModeChange("all")}
            className={`cursor-pointer rounded-xl border p-3.5 flex items-start gap-3 transition ${
              mode === "all"
                ? "border-indigo-500 bg-indigo-500/10 shadow-sm"
                : "border-white/10 bg-slate-900/40 hover:bg-slate-900/70"
            }`}
          >
            <input
              type="radio"
              name="execMode"
              checked={mode === "all"}
              onChange={() => onModeChange("all")}
              className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-600"
            />
            <div>
              <div className="text-xs font-bold text-white">
                Regenerar / Sobrescribir todos
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                Calcula e inserta nuevos vectores para la totalidad de las filas de la tabla, reemplazando datos previos.
              </p>
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}
