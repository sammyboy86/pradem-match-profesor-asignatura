"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Sliders, Compass, Sparkles, Database, CheckCircle2, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import Step5SemanticMatchTester, { MatchResult } from "@/components/Step5SemanticMatchTester";
import TsneVisualization from "@/components/TsneVisualization";

interface ColumnInfo {
  name: string;
  type: string;
}

interface AnalysisTabProps {
  columns: ColumnInfo[];
  records: Array<Record<string, unknown>>;
  jinaApiKey: string;
  defaultEmbeddingCol?: string;
  onRefreshRecords?: () => void;
}

export default function AnalysisTab({
  columns,
  records: initialRecords,
  jinaApiKey,
  defaultEmbeddingCol = "embedding",
  onRefreshRecords,
}: AnalysisTabProps) {
  // 1. Detectar automáticamente la mejor columna de embeddings inicial
  const autoDetectedCol = useMemo(() => {
    // Si la tabla contiene 'embedding_contenido_tematico', priorizarla
    const specificCol = columns.find(
      (c) => c.name.toLowerCase() === "embedding_contenido_tematico"
    );
    if (specificCol) return specificCol.name;

    // Buscar cualquier columna que contenga 'embedding' o 'vector'
    const anyEmbeddingCol = columns.find(
      (c) =>
        c.name.toLowerCase().includes("embedding") ||
        c.name.toLowerCase().includes("vector")
    );
    if (anyEmbeddingCol) return anyEmbeddingCol.name;

    return defaultEmbeddingCol;
  }, [columns, defaultEmbeddingCol]);

  // Columna de embeddings seleccionada
  const [selectedEmbeddingCol, setSelectedEmbeddingCol] = useState<string>(autoDetectedCol);
  // Columna de etiqueta (texto de la asignatura)
  const [selectedLabelCol, setSelectedLabelCol] = useState<string>("nombre");
  // Columna para colorear por categoría/departamento
  const [selectedCategoryCol, setSelectedCategoryCol] = useState<string>("departamento");

  // Registros locales específicos de la columna seleccionada
  const [localRecords, setLocalRecords] = useState<Array<Record<string, unknown>>>(initialRecords);
  const [isLoadingRecords, setIsLoadingRecords] = useState<boolean>(false);

  // Estado del matching activo para vincular con la gráfica t-SNE
  const [matchedIds, setMatchedIds] = useState<number[]>([]);
  const [matchedQueryText, setMatchedQueryText] = useState<string>("");
  const [queryVector, setQueryVector] = useState<number[] | null>(null);

  // Sincronizar autoDetectedCol si selectedEmbeddingCol está en el default genérico y existe una mejor
  useEffect(() => {
    if (autoDetectedCol && autoDetectedCol !== "embedding" && selectedEmbeddingCol === "embedding") {
      setSelectedEmbeddingCol(autoDetectedCol);
    }
  }, [autoDetectedCol, selectedEmbeddingCol]);

  // Función para obtener registros completos para la columna seleccionada
  const fetchRecordsForColumn = useCallback(async (colName: string) => {
    if (!colName) return;
    setIsLoadingRecords(true);
    try {
      // Pedimos hasta 1000 registros para tener cobertura amplia en el mapa t-SNE
      const res = await fetch(
        `/match-profesor-asignatura/api/table-records?limit=1000&targetColumn=${encodeURIComponent(
          colName
        )}`
      );
      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        setLocalRecords(data.records);
      }
    } catch (err) {
      console.error("Error al cargar registros para", colName, err);
    } finally {
      setIsLoadingRecords(false);
    }
  }, []);

  // Cargar registros al cambiar la columna seleccionada
  useEffect(() => {
    fetchRecordsForColumn(selectedEmbeddingCol);
  }, [selectedEmbeddingCol, fetchRecordsForColumn]);

  // Filtrar columnas candidatas a ser embeddings
  const candidateEmbeddingCols = useMemo(() => {
    return columns.filter(
      (c) =>
        c.type === "jsonb" ||
        c.type === "json" ||
        c.name.toLowerCase().includes("embedding") ||
        c.name.toLowerCase().includes("vector")
    );
  }, [columns]);

  // Si no se detectan por tipo, mostrar todas las columnas excepto id y created_at
  const displayEmbeddingCols =
    candidateEmbeddingCols.length > 0
      ? candidateEmbeddingCols
      : columns.filter((c) => !["id", "created_at"].includes(c.name.toLowerCase()));

  // Conteo de registros con vector en la columna seleccionada
  const recordsWithVector = useMemo(() => {
    return localRecords.filter((r) => {
      const v = r[selectedEmbeddingCol];
      if (v === null || v === undefined) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "string") {
        const trimmed = v.trim();
        return trimmed.startsWith("[") && trimmed.length > 2;
      }
      if (typeof v === "object") {
        return Object.keys(v).length > 0;
      }
      return false;
    });
  }, [localRecords, selectedEmbeddingCol]);

  const hasVectors = recordsWithVector.length > 0;

  // Callback cuando se ejecuta una búsqueda en el Step5SemanticMatchTester
  const handleMatchesFound = (
    matches: MatchResult[],
    query: string,
    vector?: number[]
  ) => {
    const ids = matches.map((m) => m.id);
    setMatchedIds(ids);
    setMatchedQueryText(query);
    setQueryVector(vector || null);
  };

  return (
    <div className="space-y-8">
      {/* ── Panel de Selección de Columna de Interés y Configuración ── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm shadow-xl shadow-black/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
              📊
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Sliders className="h-4 w-4 text-indigo-400" />
                Selección de Columna de Interés y Parámetros de Análisis
              </h2>
              <p className="text-xs text-slate-400">
                Elige la columna vectorial de la tabla <code className="text-amber-300 font-mono">asignaturas_extraidas</code> a explorar y evaluar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchRecordsForColumn(selectedEmbeddingCol)}
              disabled={isLoadingRecords}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition"
              title="Recargar datos de la columna"
            >
              <RefreshCw className={`h-3 w-3 ${isLoadingRecords ? "animate-spin text-indigo-400" : ""}`} />
              Sincronizar
            </button>

            {hasVectors ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {recordsWithVector.length} asignaturas con vector
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300">
                <AlertCircle className="h-3.5 w-3.5" />
                Sin vectores en &apos;{selectedEmbeddingCol}&apos;
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Selector 1: Columna de Interés (Embeddings) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
              1. Columna de Embeddings de Interés:
            </label>
            <select
              value={selectedEmbeddingCol}
              onChange={(e) => {
                const newCol = e.target.value;
                setSelectedEmbeddingCol(newCol);
                setMatchedIds([]);
                setQueryVector(null);
              }}
              className="w-full rounded-xl border border-indigo-500/40 bg-slate-900 px-3.5 py-2 text-xs font-mono font-bold text-indigo-300 focus:border-indigo-400 focus:outline-none shadow-sm"
            >
              {displayEmbeddingCols.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name} ({col.type})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400">
              Columna vectorial que se proyectará con t-SNE y se usará para matching.
            </p>
          </div>

          {/* Selector 2: Columna de Etiquetas (Nombre) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
              2. Columna para Etiquetas:
            </label>
            <select
              value={selectedLabelCol}
              onChange={(e) => setSelectedLabelCol(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-900/90 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            >
              {columns
                .filter((c) => !["id", "created_at"].includes(c.name.toLowerCase()))
                .map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
            </select>
            <p className="text-[11px] text-slate-400">
              Texto que se mostrará al pasar el cursor sobre los puntos del gráfico.
            </p>
          </div>

          {/* Selector 3: Columna de Categoría / Agrupación */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
              3. Columna para Colorear / Agrupar:
            </label>
            <select
              value={selectedCategoryCol}
              onChange={(e) => setSelectedCategoryCol(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-900/90 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            >
              {columns
                .filter((c) => !["id", "created_at"].includes(c.name.toLowerCase()))
                .map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
            </select>
            <p className="text-[11px] text-slate-400">
              Campo usado para la leyenda de colores del mapa semántico.
            </p>
          </div>
        </div>
      </section>

      {/* ── Módulo 1: Probador de Matching Semántico (Profesor ↔ Asignatura) ── */}
      <Step5SemanticMatchTester
        targetColumn={selectedEmbeddingCol}
        hasVectors={hasVectors}
        jinaApiKey={jinaApiKey}
        onMatchesFound={handleMatchesFound}
      />

      {/* ── Módulo 2: Gráfica t-SNE en 2 Dimensiones (Abajo) ── */}
      {isLoadingRecords ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-12 text-center flex flex-col items-center justify-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm font-semibold text-white">
            Cargando vectores de &apos;{selectedEmbeddingCol}&apos; desde Supabase...
          </p>
        </div>
      ) : (
        <TsneVisualization
          records={localRecords}
          embeddingColumn={selectedEmbeddingCol}
          labelColumn={selectedLabelCol}
          categoryColumn={selectedCategoryCol}
          matchedIds={matchedIds}
          queryText={matchedQueryText}
          queryVector={queryVector}
        />
      )}
    </div>
  );
}
