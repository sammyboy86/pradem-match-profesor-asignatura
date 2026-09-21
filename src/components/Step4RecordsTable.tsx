"use client";

import React, { useState } from "react";
import { Table, Search, CheckCircle2, Clock, Eye, RefreshCw, X } from "lucide-react";
import { formatVectorSummary } from "@/lib/jina";

interface RecordItem {
  id: number;
  codigo?: string;
  nombre?: string;
  creditos?: number;
  departamento?: string;
  semestre?: string;
  [key: string]: unknown;
}

interface Step4Props {
  records: RecordItem[];
  loading: boolean;
  totalRecords: number;
  sourceColumn: string;
  targetColumn: string;
  onRefresh: () => void;
}

export default function Step4RecordsTable({
  records,
  loading,
  totalRecords,
  sourceColumn,
  targetColumn,
  onRefresh,
}: Step4Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "with" | "without">("all");
  const [inspectVector, setInspectVector] = useState<{ id: number; nombre: string; vector: unknown } | null>(null);

  // Filtrado local
  const filteredRecords = records.filter((rec) => {
    const rawVal = String(rec[sourceColumn] || rec.nombre || "").toLowerCase();
    const codeVal = String(rec.codigo || "").toLowerCase();
    const matchesSearch = rawVal.includes(searchTerm.toLowerCase()) || codeVal.includes(searchTerm.toLowerCase());

    const hasVector = rec[targetColumn] !== null && rec[targetColumn] !== undefined;

    if (!matchesSearch) return false;
    if (filterMode === "with") return hasVector;
    if (filterMode === "without") return !hasVector;
    return true;
  });

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm shadow-xl shadow-black/20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
            4
          </div>
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Table className="h-4 w-4 text-indigo-400" />
              Visor de Registros y Auditoría de Embeddings
            </h2>
            <p className="text-xs text-slate-400">
              Verifica cómo se almacenaron los vectores en la tabla <code className="text-amber-300 font-mono">asignaturas_extraidas</code>.
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          Recargar Tabla
        </button>
      </div>

      {/* Barra de filtros y búsqueda */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por asignatura o código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-900/80 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto bg-slate-900/60 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
              filterMode === "all"
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Todos ({records.length})
          </button>
          <button
            onClick={() => setFilterMode("with")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
              filterMode === "with"
                ? "bg-emerald-600 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Con Vector
          </button>
          <button
            onClick={() => setFilterMode("without")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
              filterMode === "without"
                ? "bg-amber-600 text-white shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Pendientes
          </button>
        </div>
      </div>

      {/* Tabla de registros */}
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/40">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-white/10">
            <tr>
              <th className="py-3 px-3 w-14">ID</th>
              <th className="py-3 px-3 w-28">Código</th>
              <th className="py-3 px-3">Columna Origen ({sourceColumn})</th>
              <th className="py-3 px-3 w-36">Departamento</th>
              <th className="py-3 px-3 w-48">Columna Destino ({targetColumn})</th>
              <th className="py-3 px-3 w-24 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-slate-300">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Cargando registros de asignaturas_extraidas...
                </td>
              </tr>
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  No se encontraron registros que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filteredRecords.map((rec) => {
                const vector = rec[targetColumn];
                const hasVector = vector !== null && vector !== undefined;

                return (
                  <tr key={rec.id} className="hover:bg-white/[0.02] transition">
                    <td className="py-2.5 px-3 font-mono text-slate-400">{rec.id}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-indigo-300">
                      {rec.codigo || "—"}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-white max-w-xs truncate">
                      {String(rec[sourceColumn] || rec.nombre || "—")}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 truncate max-w-[140px]">
                      {rec.departamento || "—"}
                    </td>
                    <td className="py-2.5 px-3">
                      {hasVector ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" />
                          768 dimensiones
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/20">
                          <Clock className="h-3 w-3" />
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {hasVector ? (
                        <button
                          onClick={() =>
                            setInspectVector({
                              id: rec.id,
                              nombre: String(rec.nombre || rec[sourceColumn] || `ID ${rec.id}`),
                              vector,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] text-slate-300 hover:text-white transition"
                          title="Inspeccionar vector"
                        >
                          <Eye className="h-3 w-3" />
                          Ver
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Inspección del Vector */}
      {inspectVector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/20 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Eye className="h-4 w-4 text-indigo-400" />
                  Vector de Embedding: {inspectVector.nombre}
                </h3>
                <p className="text-xs text-slate-400">
                  ID: {inspectVector.id} • Columna: {targetColumn}
                </p>
              </div>
              <button
                onClick={() => setInspectVector(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-slate-300">
                <span className="font-semibold text-white">Resumen: </span>
                {formatVectorSummary(inspectVector.vector)}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/60 p-3">
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  Muestra de valores float (primeros 25 coeficientes):
                </label>
                <pre className="max-h-48 overflow-y-auto text-[10px] font-mono text-emerald-400 leading-relaxed whitespace-pre-wrap">
                  {Array.isArray(inspectVector.vector)
                    ? JSON.stringify(inspectVector.vector.slice(0, 25), null, 2)
                    : typeof inspectVector.vector === "string"
                    ? inspectVector.vector.slice(0, 300)
                    : "Formato no serializable"}
                </pre>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setInspectVector(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
