"use client";

import React, { useState } from "react";
import {
  Database,
  CheckCircle2,
  AlertCircle,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
} from "lucide-react";

interface Step1Props {
  loading: boolean;
  totalRecords: number;
  withEmbeddingCount: number;
  withoutEmbeddingCount: number;
  targetColumnName: string;
  tableExists: boolean;
  jinaApiKey: string;
  onApiKeyChange: (key: string) => void;
  onRefreshStats: () => void;
}

export default function Step1ConnectionStatus({
  loading,
  totalRecords,
  withEmbeddingCount,
  withoutEmbeddingCount,
  targetColumnName,
  tableExists,
  jinaApiKey,
  onApiKeyChange,
  onRefreshStats,
}: Step1Props) {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [showKeyText, setShowKeyText] = useState(false);
  const [tempKey, setTempKey] = useState(jinaApiKey);

  const hasKey = Boolean(jinaApiKey && jinaApiKey.trim().length > 0);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    onApiKeyChange(tempKey.trim());
    setShowKeyInput(false);
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm shadow-xl shadow-black/20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
            1
          </div>
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Database className="h-4 w-4 text-indigo-400" />
              Diagnóstico de Supabase y Servicio de Embeddings
            </h2>
            <p className="text-xs text-slate-400">
              Estado de la tabla <code className="text-amber-300 font-mono">asignaturas_extraidas</code> y credenciales de Jina AI.
            </p>
          </div>
        </div>

        <button
          onClick={onRefreshStats}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition"
          title="Actualizar datos de Supabase"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          Sincronizar
        </button>
      </div>

      {/* Grid de métricas en tarjetas verticales/compactas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tarjeta 1: Estado de la tabla */}
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Tabla Supabase</span>
            {tableExists ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Conectada
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400 border border-red-500/20">
                <AlertCircle className="h-3 w-3" /> No detectada
              </span>
            )}
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">
            {loading ? "..." : totalRecords}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Total asignaturas en <span className="text-slate-200 font-mono">asignaturas_extraidas</span>
          </p>
        </div>

        {/* Tarjeta 2: Asignaturas con Embeddings */}
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">Columna &apos;{targetColumnName}&apos;</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-300 border border-indigo-500/20">
              <Sparkles className="h-3 w-3" /> Vectorizados
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-400 tracking-tight">
              {loading ? "..." : withEmbeddingCount}
            </span>
            <span className="text-xs text-slate-400">
              de {totalRecords} ({totalRecords > 0 ? Math.round((withEmbeddingCount / totalRecords) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {withoutEmbeddingCount} registros pendientes sin vector
          </p>
        </div>

        {/* Tarjeta 3: Estado de Jina AI API Key */}
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">Modelo Jina AI</span>
              {hasKey ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                  <Key className="h-3 w-3" /> API Key Activa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/20">
                  <AlertCircle className="h-3 w-3" /> Falta API Key
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-white truncate font-mono">
              jina-embeddings-v2-base-es
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              8192 tokens de contexto • 768 dims
            </p>
          </div>

          <div className="mt-3 pt-2 border-t border-white/5">
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition underline underline-offset-2 flex items-center gap-1"
            >
              <Key className="h-3 w-3" />
              {hasKey ? "Cambiar API Key de Jina" : "Configurar JINA_API_KEY"}
            </button>
          </div>
        </div>
      </div>

      {/* Drawer desplegable para configurar o cambiar API Key */}
      {showKeyInput && (
        <form onSubmit={handleSaveKey} className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-4 transition">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-indigo-200 flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5 text-indigo-400" />
              Ingresa o actualiza tu JINA_API_KEY:
            </label>
            <span className="text-[11px] text-slate-400">
              Obtén una gratis en{" "}
              <a
                href="https://jina.ai/embeddings"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:underline"
              >
                jina.ai
              </a>
            </span>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKeyText ? "text" : "password"}
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
                placeholder="jina_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 pr-10 text-xs font-mono text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKeyText(!showKeyText)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showKeyText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition"
            >
              Guardar Clave
            </button>
            <button
              type="button"
              onClick={() => setShowKeyInput(false)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400 hover:bg-white/10 transition"
            >
              Cerrar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
