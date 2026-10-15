"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Users,
  Upload,
  FileSpreadsheet,
  Sliders,
  Sparkles,
  Download,
  FileText,
  ChevronDown,
  ChevronUp,
  Award,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  BarChart3,
  Percent,
  UserCheck,
} from "lucide-react";
import {
  Profesor,
  QueryConfig,
  ProfesorMatchResult,
  MatchResultItem,
} from "@/types";
import {
  parseSpreadsheetFile,
  apiFetch,
  exportToExcel,
  exportToCsv,
} from "@/lib/utils";

interface TabMatchingProps {
  onOpenSqlModal: () => void;
}

export default function TabMatching({ onOpenSqlModal }: TabMatchingProps) {
  // ── Estados de Archivo de Profesores ──
  const [file, setFile] = useState<File | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileRows, setFileRows] = useState<Record<string, string>[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Columna que identifica el nombre del profesor
  const [nameColumn, setNameColumn] = useState<string>("");

  // Configurador Dinámico de Queries y Pesos
  const [queryConfigs, setQueryConfigs] = useState<QueryConfig[]>([]);

  // Parámetros de Matching
  const [filterMode, setFilterMode] = useState<"threshold" | "topK" | "both">("both");
  const [threshold, setThreshold] = useState<number>(0.65); // Tau (default 0.65)
  const [topK, setTopK] = useState<number>(3); // Top K (default 3, dinámico hasta totalCatalogCount)
  const [totalCatalogCount, setTotalCatalogCount] = useState<number>(0);

  // Ejecución de Matching
  const [isMatching, setIsMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchStatusText, setMatchStatusText] = useState("");
  const [matchResults, setMatchResults] = useState<ProfesorMatchResult[]>([]);

  // Estados de visualización y acordeón
  const [expandedProfessorIds, setExpandedProfessorIds] = useState<Record<string, boolean>>({});
  const [searchFilter, setSearchFilter] = useState("");
  const [filterOnlyWithMatches, setFilterOnlyWithMatches] = useState(false);

  // ── Cargar conteo total de asignaturas del catálogo de Supabase ──
  useEffect(() => {
    async function loadCatalogCount() {
      try {
        const res = await apiFetch<{ success: boolean; totalCount?: number }>("/api/asignaturas?limit=1");
        if (typeof res.totalCount === "number" && res.totalCount > 0) {
          setTotalCatalogCount(res.totalCount);
        }
      } catch (err) {
        console.warn("No se pudo obtener conteo de asignaturas:", err);
      }
    }
    loadCatalogCount();
  }, []);

  // ── Inicializar Configuraciones de Query al Cargar Archivo ──
  const setupQueryConfigs = (headers: string[], detectedNameCol: string) => {
    const configs: QueryConfig[] = [];

    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    headers.forEach((header) => {
      if (header === detectedNameCol) return;

      const norm = normalize(header);
      const isAcademic =
        norm.includes("acad") || norm.includes("estud") || norm.includes("grado") || norm.includes("formacion");
      const isLabor =
        norm.includes("labor") || norm.includes("profesion") || norm.includes("exper") || norm.includes("trabajo");
      const isRelevant =
        isAcademic ||
        isLabor ||
        norm.includes("certif") ||
        norm.includes("perfil") ||
        norm.includes("cv") ||
        norm.includes("area");

      let defaultTemplate = `task: search result | query: Asignaturas y competencias técnicas afines a ${header}: {value}`;
      if (isAcademic) {
        defaultTemplate =
          "task: search result | query: Programa sintético y asignaturas afines a la trayectoria académica: {value}";
      } else if (isLabor) {
        defaultTemplate =
          "task: search result | query: Asignaturas y competencias técnicas afines a la experiencia laboral: {value}";
      }

      configs.push({
        field: header,
        label: header,
        active: isRelevant,
        template: defaultTemplate,
        weight: isAcademic || isLabor ? 50 : 25,
      });
    });

    setQueryConfigs(configs);
  };

  // ── Manejo de Archivo de Profesores ──
  const handleFileSelected = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsParsing(true);
    setMatchResults([]);
    try {
      const { headers, rows } = await parseSpreadsheetFile(selectedFile);
      setFileHeaders(headers);
      setFileRows(rows);

      // Detectar columna de nombre
      const normalize = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

      const detected =
        headers.find((h) => {
          const n = normalize(h);
          return (
            n.includes("profesor") ||
            n.includes("docente") ||
            n.includes("nombre") ||
            n.includes("maestro")
          );
        }) || headers[0] || "";

      setNameColumn(detected);
      setupQueryConfigs(headers, detected);
    } catch (err: any) {
      alert(err.message || "Error al procesar archivo de profesores");
      setFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  // ── Cálculo de Pesos Normalizados ──
  const totalActiveWeight = useMemo(() => {
    return queryConfigs
      .filter((c) => c.active)
      .reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0);
  }, [queryConfigs]);

  const updateConfig = (field: string, patch: Partial<QueryConfig>) => {
    setQueryConfigs((prev) =>
      prev.map((c) => (c.field === field ? { ...c, ...patch } : c))
    );
  };

  // ── Ejecutar Matching Inteligente ──
  const handleRunMatching = async () => {
    const activeConfigs = queryConfigs.filter((c) => c.active);
    if (!activeConfigs.length) {
      alert("Debes activar al menos un criterio (campo) para el matching.");
      return;
    }

    if (!fileRows.length) {
      alert("No hay registros de profesores para procesar.");
      return;
    }

    setIsMatching(true);
    setMatchProgress(5);
    setMatchStatusText("Iniciando matching multimodal con Gemini...");
    setMatchResults([]);

    try {
      // Formatear profesores
      const profesoresList: Profesor[] = fileRows.map((row, idx) => ({
        id: idx + 1,
        nombre_profesor: (nameColumn ? row[nameColumn] : "") || `Profesor ${idx + 1}`,
        ...row,
      }));

      // Procesar en lotes de 4 profesores para mantener al usuario informado
      const BATCH_SIZE = 4;
      const totalBatches = Math.ceil(profesoresList.length / BATCH_SIZE);
      const allResults: ProfesorMatchResult[] = [];

      for (let b = 0; b < totalBatches; b++) {
        const start = b * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, profesoresList.length);
        const batch = profesoresList.slice(start, end);

        setMatchStatusText(
          `Procesando profesores ${start + 1} a ${end} de ${profesoresList.length}...`
        );
        setMatchProgress(10 + Math.round(((b + 0.5) / totalBatches) * 85));

        const res = await apiFetch<{
          success: boolean;
          results?: ProfesorMatchResult[];
          error?: string;
        }>("/api/match-profesores", {
          method: "POST",
          body: JSON.stringify({
            profesores: batch,
            queryConfigs: activeConfigs,
            filterMode,
            threshold: filterMode === "topK" ? 0.0 : threshold,
            topK: filterMode === "threshold" ? (totalCatalogCount || 500) : topK,
          }),
        });

        if (!res.success || !res.results) {
          throw new Error(res.error || `Error al procesar el lote ${b + 1} de matching.`);
        }

        allResults.push(...res.results);
      }

      setMatchProgress(100);
      setMatchStatusText("¡Matching completado con éxito!");
      setMatchResults(allResults);

      // Expandir por defecto los primeros 3 profesores con matches
      const initialExpanded: Record<string, boolean> = {};
      allResults.slice(0, 3).forEach((r) => {
        initialExpanded[String(r.profesor.id)] = true;
      });
      setExpandedProfessorIds(initialExpanded);
    } catch (err: any) {
      console.error("Error en matching:", err);
      alert(`Error durante el matching: ${err.message || "Error desconocido"}`);
    } finally {
      setIsMatching(false);
    }
  };

  // ── Manejo de Acordeón ──
  const toggleExpand = (id: string | number) => {
    const key = String(id);
    setExpandedProfessorIds((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    matchResults.forEach((r) => {
      next[String(r.profesor.id)] = true;
    });
    setExpandedProfessorIds(next);
  };

  const collapseAll = () => {
    setExpandedProfessorIds({});
  };

  // ── Métricas y Estadísticas de Resultados ──
  const stats = useMemo(() => {
    if (!matchResults.length) return null;
    const totalProfessors = matchResults.length;
    const withMatches = matchResults.filter((r) => r.matches.length > 0).length;
    const withoutMatches = totalProfessors - withMatches;

    let totalScoreSum = 0;
    let matchScoreCount = 0;
    let highestScore = 0;

    matchResults.forEach((r) => {
      r.matches.forEach((m) => {
        totalScoreSum += m.compositeSimilarity;
        matchScoreCount++;
        if (m.compositeSimilarity > highestScore) highestScore = m.compositeSimilarity;
      });
    });

    const averageSimilarity =
      matchScoreCount > 0 ? (totalScoreSum / matchScoreCount) * 100 : 0;

    return {
      totalProfessors,
      withMatches,
      withoutMatches,
      averageSimilarity: averageSimilarity.toFixed(1),
      highestScore: (highestScore * 100).toFixed(1),
    };
  }, [matchResults]);

  // ── Filtrado de Resultados en Vista ──
  const filteredResults = useMemo(() => {
    return matchResults.filter((r) => {
      if (filterOnlyWithMatches && r.matches.length === 0) return false;
      if (searchFilter) {
        const q = searchFilter.toLowerCase();
        const matchesName = r.profesor.nombre_profesor.toLowerCase().includes(q);
        const matchesSubject = r.matches.some(
          (m) => m.nombre.toLowerCase().includes(q) || m.clave.toLowerCase().includes(q)
        );
        return matchesName || matchesSubject;
      }
      return true;
    });
  }, [matchResults, filterOnlyWithMatches, searchFilter]);

  // ── Exportación a Excel (.xlsx) y CSV ──
  const handleExport = (format: "excel" | "csv") => {
    if (!matchResults.length) return;

    // Aplanar los resultados para formato tabular estructurado
    const rows = matchResults.map((item) => {
      const rowData: Record<string, any> = {
        "ID Profesor": item.profesor.id,
        "Nombre Profesor": item.profesor.nombre_profesor,
      };

      // Incluir campos originales del profesor
      fileHeaders.forEach((h) => {
        if (h !== nameColumn) {
          rowData[h] = item.profesor[h] || "";
        }
      });

      rowData["Asignaturas Asignadas"] = item.matches.length;

      // Determinar cuántas columnas de match exportar
      const maxMatchesToExport = Math.max(
        1,
        filterMode === "threshold"
          ? Math.max(...matchResults.map((r) => r.matches.length), 1)
          : topK
      );

      // Desglosar cada una de las recomendaciones ordenadas de mayor a menor
      for (let k = 0; k < maxMatchesToExport; k++) {
        const m = item.matches[k];
        const prefix = `Match ${k + 1}`;
        if (m) {
          rowData[`${prefix} - Asignatura`] = m.nombre;
          rowData[`${prefix} - Clave`] = m.clave;
          rowData[`${prefix} - Tipo`] = m.match_nombre ? "Match Nombre (Exento de cupo)" : "Semántico";
          rowData[`${prefix} - Similitud Compuesta`] = `${(m.compositeSimilarity * 100).toFixed(1)}%`;

          // Desglose por criterio
          const desglose = Object.entries(m.fieldSimilarities)
            .map(([field, score]) => `${field}: ${(score * 100).toFixed(0)}%`)
            .join(" | ");
          rowData[`${prefix} - Desglose`] = desglose;
        } else {
          rowData[`${prefix} - Asignatura`] = "—";
          rowData[`${prefix} - Clave`] = "—";
          rowData[`${prefix} - Similitud Compuesta`] = "—";
          rowData[`${prefix} - Desglose`] = "—";
        }
      }

      return rowData;
    });

    const filename = `Match_Profesores_Asignaturas_${new Date().toISOString().slice(0, 10)}`;
    if (format === "excel") {
      exportToExcel(rows, filename);
    } else {
      exportToCsv(rows, filename);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── SECCIÓN 1: SUBIDA DE ARCHIVO DE PROFESORES ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400 border border-indigo-500/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Carga de Perfiles Docentes (Profesores)
              </h2>
              <p className="text-xs text-slate-400">
                Sube el archivo <code className="text-indigo-300">.xlsx</code> o <code className="text-indigo-300">.csv</code> con la información académica y laboral
              </p>
            </div>
          </div>

          {file && (
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300">
                {fileRows.length} docentes cargados
              </span>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setFileRows([]);
                  setFileHeaders([]);
                  setQueryConfigs([]);
                  setMatchResults([]);
                }}
                className="text-xs text-slate-400 hover:text-white underline"
              >
                Cambiar archivo
              </button>
            </div>
          )}
        </div>

        {/* Zona Drag & Drop si no hay archivo */}
        {!file ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.01] p-10 text-center transition hover:border-indigo-500/50 hover:bg-indigo-500/[0.02] cursor-pointer"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileSelected(e.target.files[0]);
              }}
              className="hidden"
            />
            <div className="mb-4 rounded-2xl bg-indigo-500/10 p-4 text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
              <FileSpreadsheet className="h-8 w-8" />
            </div>
            <h3 className="text-sm font-semibold text-white">
              Arrastra aquí la lista de profesores o haz clic para examinar
            </h3>
            <p className="mt-1 text-xs text-slate-400 max-w-sm">
              Columnas típicas: Nombre, Trayectoria Académica, Experiencia Laboral, Certificaciones, Especialidad.
            </p>
          </div>
        ) : (
          /* Vista Previa de Primeras 5 Filas de Docentes */
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300">Columna con Nombre del Profesor:</span>
                <select
                  value={nameColumn}
                  onChange={(e) => {
                    setNameColumn(e.target.value);
                    setupQueryConfigs(fileHeaders, e.target.value);
                  }}
                  className="rounded-lg border border-white/15 bg-slate-950 px-3 py-1.5 text-xs text-indigo-300 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <span className="text-slate-400">
                Mostrando primeras 5 filas (Total: {fileRows.length})
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5 font-bold text-indigo-300">Profesor</th>
                    {fileHeaders
                      .filter((h) => h !== nameColumn)
                      .slice(0, 4)
                      .map((h) => (
                        <th key={h} className="px-3 py-2.5">
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {fileRows.slice(0, 5).map((row, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-mono text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2 font-semibold text-white">
                        {nameColumn ? row[nameColumn] : "—"}
                      </td>
                      {fileHeaders
                        .filter((h) => h !== nameColumn)
                        .slice(0, 4)
                        .map((h) => (
                          <td key={h} className="px-3 py-2 truncate max-w-xs text-slate-400">
                            {row[h] || "—"}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── SECCIÓN 2: CONSTRUCTOR DINÁMICO DE QUERIES Y PONDERACIÓN ── */}
      {file && queryConfigs.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/10 p-2.5 text-purple-400 border border-purple-500/20">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Constructor Dinámico de Queries y Ponderación
                </h3>
                <p className="text-xs text-slate-400">
                  Selecciona qué campos del docente ponderar, edita sus plantillas asimétricas y asigna pesos ($w_i$)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-1.5 border border-white/10 text-xs">
              <span className="text-slate-400">Campos activos:</span>
              <span className="font-mono font-bold text-indigo-300">
                {queryConfigs.filter((c) => c.active).length} de {queryConfigs.length}
              </span>
            </div>
          </div>

          {/* Lista de Campos con Plantillas y Sliders */}
          <div className="space-y-4">
            {queryConfigs.map((config) => {
              const normalizedPercent =
                config.active && totalActiveWeight > 0
                  ? ((config.weight / totalActiveWeight) * 100).toFixed(1)
                  : "0.0";

              return (
                <div
                  key={config.field}
                  className={`rounded-xl border transition-all p-4 space-y-3 ${
                    config.active
                      ? "border-indigo-500/30 bg-slate-950/80 shadow-md shadow-indigo-500/5"
                      : "border-white/5 bg-slate-950/20 opacity-60"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.active}
                        onChange={(e) => updateConfig(config.field, { active: e.target.checked })}
                        className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-bold text-white tracking-wide">
                        {config.label}
                      </span>
                    </label>

                    {config.active && (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-400">Influencia Relativa:</span>
                        <span className="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-0.5 font-mono font-bold text-indigo-300 text-xs">
                          {normalizedPercent}%
                        </span>
                      </div>
                    )}
                  </div>

                  {config.active && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1">
                      {/* Editor de Plantilla de Query Asimétrica */}
                      <div className="lg:col-span-8 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Plantilla de Query Asimétrica (Gemini Embedding):</span>
                          <span className="text-slate-500 font-mono">&#123;value&#125; se reemplaza por el texto del profesor</span>
                        </div>
                        <input
                          type="text"
                          value={config.template}
                          onChange={(e) => updateConfig(config.field, { template: e.target.value })}
                          className="w-full rounded-xl border border-white/15 bg-slate-900 px-3.5 py-2 text-xs text-indigo-200 font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      {/* Slider de Ponderación w_i */}
                      <div className="lg:col-span-4 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Peso Bruto ($w_i$):</span>
                          <span className="font-mono font-bold text-white">{config.weight}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={config.weight}
                          onChange={(e) =>
                            updateConfig(config.field, { weight: parseFloat(e.target.value) })
                          }
                          className="w-full accent-indigo-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selector de Modo de Filtrado: Threshold O Número de Asignaturas O Ambos */}
          <div className="rounded-xl border border-white/10 bg-slate-950/80 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                  <Filter className="h-4 w-4 text-indigo-400" />
                  Criterio de Selección de Asignaturas (Mayor a Menor Similitud)
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Elige si deseas filtrar por umbral de similitud (&tau;), por un número fijo de asignaturas (Top K), o combinar ambos.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-purple-500/15 border border-purple-500/30 px-2.5 py-1 text-[11px] font-medium text-purple-300 flex items-center gap-1">
                  <span>🎯 match_nombre=True no consume cupo</span>
                </span>
                {totalCatalogCount > 0 && (
                  <span className="rounded-lg bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-[11px] font-mono text-indigo-300">
                    Total en catálogo: {totalCatalogCount} asignaturas
                  </span>
                )}
              </div>
            </div>

            {/* Selector de Modos (3 Tabs / Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setFilterMode("threshold")}
                className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                  filterMode === "threshold"
                    ? "border-indigo-500 bg-indigo-500/15 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500"
                    : "border-white/10 bg-slate-900/60 hover:bg-white/[0.03] text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-xs font-bold ${filterMode === "threshold" ? "text-white" : "text-slate-200"}`}>
                    🎯 Solo por Umbral (&tau;)
                  </span>
                  {filterMode === "threshold" && <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  Devuelve todas las asignaturas con similitud &ge; &tau;, ordenadas de mayor a menor.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterMode("topK")}
                className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                  filterMode === "topK"
                    ? "border-indigo-500 bg-indigo-500/15 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500"
                    : "border-white/10 bg-slate-900/60 hover:bg-white/[0.03] text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-xs font-bold ${filterMode === "topK" ? "text-white" : "text-slate-200"}`}>
                    🔢 Solo por Número (Top K)
                  </span>
                  {filterMode === "topK" && <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  Devuelve las K asignaturas más afines (hasta {totalCatalogCount || "total"}), sin corte por umbral.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterMode("both")}
                className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                  filterMode === "both"
                    ? "border-indigo-500 bg-indigo-500/15 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500"
                    : "border-white/10 bg-slate-900/60 hover:bg-white/[0.03] text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-xs font-bold ${filterMode === "both" ? "text-white" : "text-slate-200"}`}>
                    ⚡ Ambos Combinados
                  </span>
                  {filterMode === "both" && <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  Hasta K asignaturas ordenadas de mayor a menor que además superen el umbral &tau;.
                </p>
              </button>
            </div>

            {/* Controles dinámicos según el modo activo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-white/5">
              {/* Control de Umbral (visible en 'threshold' y 'both') */}
              {(filterMode === "threshold" || filterMode === "both") && (
                <div className={`space-y-2 ${filterMode === "threshold" ? "sm:col-span-2" : ""}`}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Percent className="h-3.5 w-3.5 text-indigo-400" />
                      Umbral Mínimo de Similitud (&tau;):
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-indigo-300">
                        {(threshold * 100).toFixed(0)}%
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        ({threshold.toFixed(2)})
                      </span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.01"
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />

                  {/* Botones de selección rápida para threshold */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {[
                      { label: "0.50 (Flexible)", val: 0.5 },
                      { label: "0.60", val: 0.6 },
                      { label: "0.65 (Recomendado)", val: 0.65 },
                      { label: "0.75 (Alto)", val: 0.75 },
                      { label: "0.85 (Estricto)", val: 0.85 },
                    ].map((t) => (
                      <button
                        key={t.val}
                        type="button"
                        onClick={() => setThreshold(t.val)}
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-mono transition ${
                          Math.abs(threshold - t.val) < 0.01
                            ? "bg-indigo-600 text-white font-bold"
                            : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Control de Número de Asignaturas (visible en 'topK' y 'both') */}
              {(filterMode === "topK" || filterMode === "both") && (
                <div className={`space-y-2 ${filterMode === "topK" ? "sm:col-span-2" : ""}`}>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5 text-indigo-400" />
                      Número de Asignaturas a Asignar (Top K):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max={totalCatalogCount > 0 ? totalCatalogCount : 500}
                        value={topK}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const maxLimit = totalCatalogCount > 0 ? totalCatalogCount : 500;
                          if (!isNaN(val)) {
                            setTopK(Math.min(maxLimit, Math.max(1, val)));
                          }
                        }}
                        className="w-16 rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-xs font-mono font-bold text-center text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-[11px] text-slate-400 font-mono">
                        / {totalCatalogCount > 0 ? totalCatalogCount : "máx"}
                      </span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="1"
                    max={totalCatalogCount > 0 ? totalCatalogCount : 50}
                    step="1"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />

                  {/* Botones de selección rápida para Top K */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {[1, 2, 3, 5, 10].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTopK(k)}
                        className={`rounded-lg px-2.5 py-0.5 text-[10px] font-mono transition ${
                          topK === k
                            ? "bg-indigo-600 text-white font-bold"
                            : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Top {k}
                      </button>
                    ))}
                    {totalCatalogCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setTopK(totalCatalogCount)}
                        className={`rounded-lg px-2.5 py-0.5 text-[10px] font-mono transition ${
                          topK === totalCatalogCount
                            ? "bg-purple-600 text-white font-bold"
                            : "bg-purple-500/10 text-purple-300 border border-purple-500/30 hover:bg-purple-500/20"
                        }`}
                        title="Seleccionar todas las asignaturas disponibles en el catálogo"
                      >
                        Todas ({totalCatalogCount})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Botón de Ejecución Principal */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
            <p className="text-xs text-slate-400 max-w-md">
              Genera los embeddings multimodales con Gemini 2 para cada docente y consulta la función RPC <code className="font-mono text-indigo-300">match_asignaturas_cosine</code> en Supabase.
            </p>

            <button
              type="button"
              disabled={isMatching || totalActiveWeight === 0}
              onClick={handleRunMatching}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-size-200 px-6 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:opacity-95 disabled:opacity-50 transition"
            >
              {isMatching ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Calculando Matching ({matchProgress}%)...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Ejecutar Matching Inteligente</span>
                </>
              )}
            </button>
          </div>

          {/* Barra de Progreso */}
          {isMatching && (
            <div className="space-y-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-medium text-indigo-200">
                <span>{matchStatusText}</span>
                <span className="font-mono">{matchProgress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-900">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${matchProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SECCIÓN 3: RESULTADOS DEL MATCHING Y EXPORTACIÓN ── */}
      {matchResults.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
          {/* Header de Resultados y KPIs */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white tracking-tight">
                  Resultados del Matching de Profesores
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                {matchResults.length} docentes evaluados &bull;{" "}
                <span className="text-indigo-300 font-semibold">
                  {filterMode === "threshold"
                    ? `Modo Umbral: todas las asignaturas con similitud ≥ ${(threshold * 100).toFixed(0)}% (ordenadas de mayor a menor)`
                    : filterMode === "topK"
                    ? `Modo Top K: ${topK} asignaturas por profesor (ordenadas de mayor a menor)`
                    : `Modo Combinado: hasta ${topK} asignaturas con similitud ≥ ${(threshold * 100).toFixed(0)}% (ordenadas de mayor a menor)`}
                </span>
              </p>
            </div>

            {/* Botones de Exportación */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExport("excel")}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exportar Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={() => handleExport("csv")}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Tarjetas de Métricas de Resultados */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                <span className="text-[11px] text-slate-400">Docentes Evaluados</span>
                <p className="text-2xl font-bold font-mono text-white mt-1">
                  {stats.totalProfessors}
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                <span className="text-[11px] text-emerald-400">Con Asignación (&ge; &tau;)</span>
                <p className="text-2xl font-bold font-mono text-emerald-300 mt-1">
                  {stats.withMatches}
                </p>
              </div>

              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] p-4">
                <span className="text-[11px] text-indigo-400">Similitud Promedio</span>
                <p className="text-2xl font-bold font-mono text-indigo-300 mt-1">
                  {stats.averageSimilarity}%
                </p>
              </div>

              <div className="rounded-xl border border-purple-500/20 bg-purple-500/[0.04] p-4">
                <span className="text-[11px] text-purple-400">Puntaje Máximo Obtenido</span>
                <p className="text-2xl font-bold font-mono text-purple-300 mt-1">
                  {stats.highestScore}%
                </p>
              </div>
            </div>
          )}

          {/* Filtros de Lista y Expansores Masivos */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-sm">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar por profesor o asignatura..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white mr-2">
                <input
                  type="checkbox"
                  checked={filterOnlyWithMatches}
                  onChange={(e) => setFilterOnlyWithMatches(e.target.checked)}
                  className="h-3.5 w-3.5 rounded bg-slate-900 border-white/20 text-indigo-600"
                />
                <span>Solo con matches</span>
              </label>

              <button
                type="button"
                onClick={expandAll}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                Expandir todos
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                Colapsar todos
              </button>
            </div>
          </div>

          {/* Lista Acordeón de Profesores */}
          <div className="space-y-3">
            {filteredResults.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-8 text-center text-xs text-slate-400">
                No se encontraron resultados para los filtros seleccionados.
              </div>
            ) : (
              filteredResults.map((result) => {
                const profId = String(result.profesor.id);
                const isExpanded = Boolean(expandedProfessorIds[profId]);
                const hasMatches = result.matches.length > 0;
                const topScore = hasMatches ? result.matches[0].compositeSimilarity : 0;

                // Color dinámico según score
                const scoreColor =
                  topScore >= 0.75
                    ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
                    : topScore >= 0.65
                    ? "text-indigo-300 bg-indigo-500/15 border-indigo-500/30"
                    : "text-amber-300 bg-amber-500/15 border-amber-500/30";

                return (
                  <div
                    key={profId}
                    className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 transition-all hover:border-white/20"
                  >
                    {/* Fila Principal del Profesor (Clic para expandir) */}
                    <div
                      onClick={() => toggleExpand(profId)}
                      className="flex flex-wrap items-center justify-between gap-3 p-4 cursor-pointer hover:bg-white/[0.02]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 font-bold text-xs text-indigo-300">
                          {result.profesor.nombre_profesor.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs sm:text-sm font-bold text-white">
                              {result.profesor.nombre_profesor}
                            </h4>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ID: {profId}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                            <span>
                              {hasMatches
                                ? `${result.matches.length} asignatura(s) recomendada(s)`
                                : "Sin asignaturas sobre el umbral"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {hasMatches ? (
                          <div
                            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-bold font-mono ${scoreColor}`}
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>Top: {(topScore * 100).toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
                            &lt; {(threshold * 100).toFixed(0)}%
                          </span>
                        )}

                        <button
                          type="button"
                          className="rounded-lg p-1 text-slate-400 hover:text-white"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Contenido Expandido: K Asignaturas Recomendadas */}
                    {isExpanded && (
                      <div className="border-t border-white/10 bg-slate-900/40 p-4 space-y-3">
                        {/* Datos Completos del Profesor (Campos Elegidos para el Matching) */}
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                              <UserCheck className="h-3.5 w-3.5 text-indigo-400" />
                              Campos Evaluados del Docente (Texto Completo):
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Información completa sin truncar
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {queryConfigs
                              .filter((c) => c.active && result.profesor[c.field])
                              .map((c) => {
                                const normalizedPercent =
                                  totalActiveWeight > 0
                                    ? ((c.weight / totalActiveWeight) * 100).toFixed(0)
                                    : "0";

                                return (
                                  <div
                                    key={c.field}
                                    className="rounded-xl border border-white/10 bg-slate-950/80 p-3.5 space-y-2 shadow-sm"
                                  >
                                    <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                                      <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-300">
                                        {c.label}
                                      </span>
                                      <span className="rounded bg-indigo-500/20 text-indigo-300 text-[10px] px-2 py-0.5 font-mono font-semibold">
                                        Influencia: {normalizedPercent}%
                                      </span>
                                    </div>
                                    <div className="text-slate-200 text-xs leading-relaxed whitespace-pre-wrap break-words">
                                      {String(result.profesor[c.field])}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>

                          {/* Otros campos del archivo si existen y no fueron usados en matching */}
                          {fileHeaders.filter(
                            (h) =>
                              h !== nameColumn &&
                              !queryConfigs.some((c) => c.active && c.field === h) &&
                              result.profesor[h]
                          ).length > 0 && (
                            <details className="text-xs group pt-1">
                              <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-200 transition select-none flex items-center gap-1">
                                <span className="underline">Ver otros datos del docente</span>
                                <span className="text-[10px] text-slate-500">
                                  ({fileHeaders.filter((h) => h !== nameColumn && !queryConfigs.some((c) => c.active && c.field === h) && result.profesor[h]).length} campos no incluidos en matching)
                                </span>
                              </summary>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-2 bg-slate-950/40 p-3 rounded-xl border border-white/5">
                                {fileHeaders
                                  .filter(
                                    (h) =>
                                      h !== nameColumn &&
                                      !queryConfigs.some((c) => c.active && c.field === h) &&
                                      result.profesor[h]
                                  )
                                  .map((h) => (
                                    <div key={h} className="text-xs space-y-0.5">
                                      <span className="text-[10px] uppercase font-bold text-slate-400">{h}:</span>
                                      <div className="text-slate-300 whitespace-pre-wrap break-words">
                                        {String(result.profesor[h])}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </details>
                          )}
                        </div>

                        {/* Tarjetas de Asignaturas Recomendadas */}
                        {!hasMatches ? (
                          <div className="rounded-lg border border-white/5 bg-slate-950/30 p-4 text-center text-xs text-slate-400">
                            Ninguna asignatura alcanzó el umbral mínimo de similitud de {(threshold * 100).toFixed(0)}%. Puedes reducir el umbral &tau; arriba para encontrar coincidencias más amplias.
                          </div>
                        ) : (
                          <div className="space-y-2.5 pt-1">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Top {result.matches.length} Asignaturas Recomendadas:
                            </span>

                            {result.matches.map((matchItem, idx) => {
                              const matchPercent = (matchItem.compositeSimilarity * 100).toFixed(1);

                              return (
                                <div
                                  key={matchItem.asignaturaId}
                                  className="rounded-xl border border-white/10 bg-slate-950 p-3.5 space-y-2.5 hover:border-indigo-500/40 transition"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600/30 text-[10px] font-bold text-indigo-300 font-mono">
                                        #{idx + 1}
                                      </span>
                                      <h5 className="text-xs font-bold text-white">
                                        {matchItem.nombre}
                                      </h5>
                                      {matchItem.clave && (
                                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300">
                                          {matchItem.clave}
                                        </span>
                                      )}
                                      {matchItem.match_nombre && (
                                        <span className="rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                                          <span>🎯 Match Nombre</span>
                                          <span className="text-[9px] text-purple-200/80 font-normal">(Exento de cupo Top K)</span>
                                        </span>
                                      )}
                                    </div>

                                    {/* Medidor de Similitud Compuesta */}
                                    <div className="flex items-center gap-2">
                                      <div className="w-24 h-2 rounded-full bg-slate-800 overflow-hidden">
                                        <div
                                          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400"
                                          style={{ width: `${matchPercent}%` }}
                                        />
                                      </div>
                                      <span className="font-mono font-bold text-xs text-emerald-300">
                                        {matchPercent}%
                                      </span>
                                    </div>
                                  </div>

                                  {/* Desglose por Criterio Ponderado */}
                                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
                                    <span className="text-[10px] text-slate-400">Desglose:</span>
                                    {Object.entries(matchItem.fieldSimilarities).map(
                                      ([field, score]) => (
                                        <span
                                          key={field}
                                          className="inline-flex items-center gap-1 rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-slate-300"
                                        >
                                          <span className="text-slate-400">{field}:</span>
                                          <strong className="text-indigo-300 font-mono">
                                            {(score * 100).toFixed(1)}%
                                          </strong>
                                        </span>
                                      )
                                    )}
                                  </div>

                                  {/* Extracto de Contenido Temático */}
                                  {matchItem.contenido_tematico && (
                                    <div className="text-[11px] text-slate-300 bg-white/[0.02] p-2.5 rounded-lg border border-white/5 whitespace-pre-wrap break-words leading-relaxed max-h-60 overflow-y-auto">
                                      <span className="font-semibold text-slate-200">Temario: </span>
                                      {matchItem.contenido_tematico}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
