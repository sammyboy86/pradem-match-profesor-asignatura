"use client";

import React, { useState } from "react";
import { Sparkles, Search, Loader2, ArrowRight, BookOpen, Percent, AlertCircle } from "lucide-react";

export interface MatchResult {
  id: number;
  codigo?: string;
  nombre?: string;
  departamento?: string;
  creditos?: number;
  similarity: number;
  similarityPercentage: number;
  rawRecord: Record<string, unknown>;
}

interface Step5Props {
  targetColumn: string;
  hasVectors: boolean;
  jinaApiKey: string;
  onMatchesFound?: (matches: MatchResult[], query: string, queryVector?: number[]) => void;
}

export default function Step5SemanticMatchTester({
  targetColumn,
  hasVectors,
  jinaApiKey,
  onMatchesFound,
}: Step5Props) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sampleQueries = [
    "Profesor de Matemáticas Discretas, Lógica y Algoritmos",
    "Docente de Física Mecánica, Ondas y Termodinámica",
    "Especialista en Inteligencia Artificial, Aprendizaje Automático y Datos",
    "Profesor de Química Orgánica y Bioquímica Médica",
  ];

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/match-profesor-asignatura/api/semantic-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          targetColumn,
          apiKey: jinaApiKey,
          topK,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Error al calcular el matching semántico.");
      }

      setResults(data.matches || []);
      if (onMatchesFound) {
        onMatchesFound(data.matches || [], query.trim(), data.queryVector);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error inesperado al buscar coincidencias");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm shadow-xl shadow-black/20">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
          5
        </div>
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            Probador de Matching Semántico (Profesor ↔ Asignatura)
          </h2>
          <p className="text-xs text-slate-400">
            Ingresa el perfil, título o especialidad de un docente y encuentra automáticamente las asignaturas con mayor compatibilidad vectorial.
          </p>
        </div>
      </div>

      {!hasVectors ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>
            La columna seleccionada <code className="font-mono text-amber-200">{targetColumn}</code> aún no tiene vectores almacenados. Selecciona otra columna en el desplegable superior (ej. <code className="font-mono text-amber-200">embedding_contenido_tematico</code>) o genera embeddings en la pestaña <strong>Generador embeddings</strong>.
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-2">
                Perfil o descripción de materias que imparte el profesor:
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ej: Docente experto en Estructuras de Datos, Programación y Algoritmos..."
                  className="flex-1 rounded-xl border border-white/10 bg-slate-900/90 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSearching || !query.trim()}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition flex items-center justify-center gap-2"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Comparando...</span>
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      <span>Buscar Matches</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Sugerencias rápidas de búsqueda */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-slate-400">Consultas de prueba:</span>
              {sampleQueries.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setQuery(sample);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white transition"
                >
                  {sample}
                </button>
              ))}
            </div>
          </form>

          {errorMessage && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          {/* Resultados del matching */}
          {results && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/10">
                <span className="font-semibold text-white">
                  Top Asignaturas Compatibles para: &ldquo;{query}&rdquo;
                </span>
                <span>{results.length} asignaturas encontradas</span>
              </div>

              {results.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 p-6 text-center text-xs text-slate-400">
                  No se encontraron asignaturas con afinidad suficiente.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {results.map((item, index) => {
                    const isTop = index === 0;
                    const pct = item.similarityPercentage;

                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border p-4 transition ${
                          isTop
                            ? "border-indigo-500/40 bg-indigo-950/20 shadow-lg shadow-indigo-950/30"
                            : "border-white/10 bg-slate-900/40 hover:bg-slate-900/70"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-start sm:items-center gap-3">
                            <span
                              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                isTop
                                  ? "bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950"
                                  : "bg-white/10 text-slate-300"
                              }`}
                            >
                              #{index + 1}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-white">
                                  {item.nombre || "Asignatura sin nombre"}
                                </span>
                                {item.codigo && (
                                  <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                                    {item.codigo}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {item.departamento || "Departamento no especificado"} • {item.creditos ? `${item.creditos} créditos` : "Créditos n/d"}
                              </p>
                            </div>
                          </div>

                          {/* Similitud visual */}
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            <div className="text-right">
                              <span className="text-sm font-bold text-emerald-400 font-mono">
                                {pct}%
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                Afinidad
                              </span>
                            </div>
                            <div className="w-20 h-2 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                              <div
                                className={`h-full rounded-full ${
                                  pct >= 75
                                    ? "bg-emerald-400"
                                    : pct >= 50
                                    ? "bg-indigo-400"
                                    : "bg-amber-400"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
