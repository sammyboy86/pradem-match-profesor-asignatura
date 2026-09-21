"use client";

import React, { useState, useEffect, useCallback } from "react";
import PrademLogo from "@/components/PrademLogo";
import Step1ConnectionStatus from "@/components/Step1ConnectionStatus";
import Step2EmbeddingConfig from "@/components/Step2EmbeddingConfig";
import Step3GenerateAction from "@/components/Step3GenerateAction";
import Step4RecordsTable from "@/components/Step4RecordsTable";
import AnalysisTab from "@/components/AnalysisTab";
import { Zap, Compass } from "lucide-react";

export default function MatchProfesorAsignaturaPage() {
  // ── Navegación entre Sub-Pestañas ──
  const [activeTab, setActiveTab] = useState<"generator" | "analysis">("generator");

  // ── Estados de columnas y datos ──
  const [columns, setColumns] = useState<Array<{ name: string; type: string }>>([]);
  const [sourceColumn, setSourceColumn] = useState<string>("nombre");
  const [targetColumn, setTargetColumn] = useState<string>("embedding");
  const [mode, setMode] = useState<"missing_only" | "all">("missing_only");
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);

  // ── Estados de Diagnóstico y Métricas ──
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [loadingRecords, setLoadingRecords] = useState<boolean>(false);
  const [tableExists, setTableExists] = useState<boolean>(true);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [withEmbeddingCount, setWithEmbeddingCount] = useState<number>(0);
  const [withoutEmbeddingCount, setWithoutEmbeddingCount] = useState<number>(0);

  // ── Clave Jina AI (Almacenada en memoria y sincronizada con localStorage) ──
  const [jinaApiKey, setJinaApiKey] = useState<string>("");

  // ── Estados de Generación ──
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<{
    success: boolean;
    totalUpdated: number;
    tokensUsed: number;
    durationSeconds: number;
    message: string;
    errors?: string[];
  } | null>(null);

  // Cargar Jina API Key desde localStorage si existe
  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("pradem_jina_api_key");
      if (savedKey) {
        setJinaApiKey(savedKey);
      }
    } catch {
      // Ignorar en entornos sin acceso a localStorage
    }
  }, []);

  const handleApiKeyChange = (newKey: string) => {
    setJinaApiKey(newKey);
    try {
      if (newKey) {
        localStorage.setItem("pradem_jina_api_key", newKey);
      } else {
        localStorage.removeItem("pradem_jina_api_key");
      }
    } catch {
      // Ignorar
    }
  };

  const addLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${message}`, ...prev]);
  }, []);

  // ── Cargar Columnas ──
  const loadColumns = useCallback(async () => {
    try {
      const res = await fetch("/match-profesor-asignatura/api/table-columns");
      const data = await res.json();

      if (data.success && Array.isArray(data.columns)) {
        setColumns(data.columns);
        setTableExists(true);

        // Si 'nombre' existe, seleccionarlo por defecto como origen
        const hasNombre = data.columns.some((c: { name: string }) => c.name === "nombre");
        if (hasNombre) {
          setSourceColumn("nombre");
        } else if (data.columns.length > 0) {
          const firstEligible = data.columns.find(
            (c: { name: string }) => !["id", "created_at"].includes(c.name.toLowerCase())
          );
          if (firstEligible) setSourceColumn(firstEligible.name);
        }
      } else {
        if (data.tableExists === false) {
          setTableExists(false);
        }
      }
    } catch (err) {
      console.error("Error al cargar columnas:", err);
    }
  }, []);

  // ── Cargar Registros y Métricas ──
  const loadRecords = useCallback(async (targetCol: string = targetColumn) => {
    setLoadingRecords(true);
    try {
      const res = await fetch(
        `/match-profesor-asignatura/api/table-records?limit=50&targetColumn=${encodeURIComponent(
          targetCol
        )}`
      );
      const data = await res.json();

      if (data.success) {
        setRecords(data.records || []);
        setTotalRecords(data.totalCount || 0);
        setWithEmbeddingCount(data.countWithEmbedding || 0);
        setWithoutEmbeddingCount(data.countWithoutEmbedding || 0);
      }
    } catch (err) {
      console.error("Error al cargar registros:", err);
    } finally {
      setLoadingRecords(false);
      setLoadingInitial(false);
    }
  }, [targetColumn]);

  // Carga inicial
  useEffect(() => {
    loadColumns();
    loadRecords();
  }, [loadColumns, loadRecords]);

  // Recargar métricas cuando cambie la columna destino
  useEffect(() => {
    if (targetColumn.trim()) {
      loadRecords(targetColumn.trim());
    }
  }, [targetColumn, loadRecords]);

  // ── Ejecutar Generación de Embeddings ──
  const handleGenerateEmbeddings = async () => {
    if (!sourceColumn || !targetColumn) return;

    setIsGenerating(true);
    setProgressPercentage(10);
    setStatusMessage("Verificando columna destino en asignaturas_extraidas...");
    setLastResult(null);

    addLog(`Iniciando generación de embeddings desde '${sourceColumn}' hacia '${targetColumn}'...`);

    try {
      // 1. Asegurar columna destino
      addLog(`Comprobando existencia de columna '${targetColumn}' en Supabase...`);
      const ensureRes = await fetch("/match-profesor-asignatura/api/ensure-column", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnName: targetColumn,
          columnType: "jsonb",
        }),
      });

      const ensureData = await ensureRes.json();
      if (ensureData.created) {
        addLog(`Columna '${targetColumn}' creada exitosamente en Supabase.`);
      } else {
        addLog(`Columna '${targetColumn}' validada en Supabase.`);
      }

      setProgressPercentage(30);
      setStatusMessage("Conectando con Jina AI y procesando asignaturas...");

      // 2. Invocar API de generación
      addLog("Llamando a Jina AI API (jina-embeddings-v2-base-es)...");
      const genRes = await fetch("/match-profesor-asignatura/api/generate-embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceColumn,
          targetColumn,
          apiKey: jinaApiKey,
          model: "jina-embeddings-v2-base-es",
          mode,
          batchSize: 25,
        }),
      });

      setProgressPercentage(75);
      const genData = await genRes.json();

      if (!genRes.ok || !genData.success) {
        throw new Error(genData.error || "Error al procesar los embeddings.");
      }

      setProgressPercentage(100);
      setStatusMessage("¡Proceso completado exitosamente!");
      addLog(
        `Completado: ${genData.totalUpdated} asignaturas actualizadas. Tokens consumidos: ${
          genData.tokensUsed || 0
        }`
      );

      setLastResult({
        success: true,
        totalUpdated: genData.totalUpdated,
        tokensUsed: genData.tokensUsed,
        durationSeconds: genData.durationSeconds,
        message: genData.message,
        errors: genData.errors,
      });

      // Refrescar registros y columnas
      await loadColumns();
      await loadRecords(targetColumn);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error inesperado durante la generación";
      addLog(`ERROR: ${msg}`);
      setStatusMessage("Hubo un error en la ejecución.");
      setLastResult({
        success: false,
        totalUpdated: 0,
        tokensUsed: 0,
        durationSeconds: 0,
        message: msg,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Valor de muestra de la columna origen
  const sampleValue =
    records.length > 0 && records[0][sourceColumn]
      ? String(records[0][sourceColumn])
      : undefined;

  // Verificar si la columna destino existe
  const existingTargetColumn = columns.some(
    (c) => c.name.toLowerCase() === targetColumn.trim().toLowerCase()
  );

  return (
    <main className="min-h-screen pb-16">
      {/* ── Header Pradem Satélite ── */}
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <a
              href="/dashboard"
              className="relative flex-shrink-0 transition hover:opacity-80"
              title="Volver al Dashboard"
            >
              <PrademLogo className="h-9 w-9 text-[#C8A2C8]" />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/40 text-[11px] ring-2 ring-slate-950">
                🎯
              </span>
            </a>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-tight">
                  06 Match Profesor - Asignatura
                </h1>
                <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-500/30">
                  Satélite Pradem
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Generador de Embeddings con Jina AI e inserción en <code className="text-amber-300 font-mono">asignaturas_extraidas</code>
              </p>
            </div>
          </div>

          <a
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
            title="Volver a Herramientas de Pradem"
          >
            <span>←</span> Herramientas
          </a>
        </div>
      </header>

      {/* ── Contenido Principal con Sub-Pestañas ── */}
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* ── Barra de Sub-Pestañas de Navegación ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("generator")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition ${
                activeTab === "generator"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/30"
                  : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <Zap className="h-4 w-4 text-amber-300" />
              <span>Generador embeddings</span>
            </button>

            <button
              onClick={() => setActiveTab("analysis")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition ${
                activeTab === "analysis"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/30"
                  : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5"
              }`}
            >
              <Compass className="h-4 w-4 text-indigo-400" />
              <span>Análisis embeddings</span>
              {withEmbeddingCount > 0 && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/30 font-mono">
                  {withEmbeddingCount}
                </span>
              )}
            </button>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <span className="font-mono text-indigo-400">{records.length}</span> asignaturas cargadas
          </div>
        </div>

        {/* ── SUB-PESTAÑA 1: Generador de Embeddings (Formato Vertical) ── */}
        {activeTab === "generator" && (
          <div className="space-y-8">
            {/* Paso 1: Diagnóstico de Conexión y API Key */}
            <Step1ConnectionStatus
              loading={loadingRecords || loadingInitial}
              totalRecords={totalRecords}
              withEmbeddingCount={withEmbeddingCount}
              withoutEmbeddingCount={withoutEmbeddingCount}
              targetColumnName={targetColumn}
              tableExists={tableExists}
              jinaApiKey={jinaApiKey}
              onApiKeyChange={handleApiKeyChange}
              onRefreshStats={() => {
                loadColumns();
                loadRecords();
              }}
            />

            {/* Paso 2: Configuración de Columnas y Modelo */}
            <Step2EmbeddingConfig
              columns={columns}
              sourceColumn={sourceColumn}
              onSourceColumnChange={setSourceColumn}
              targetColumn={targetColumn}
              onTargetColumnChange={setTargetColumn}
              mode={mode}
              onModeChange={setMode}
              sampleValue={sampleValue}
              existingTargetColumn={existingTargetColumn}
            />

            {/* Paso 3: Botón de Acción Principal y Progreso */}
            <Step3GenerateAction
              isGenerating={isGenerating}
              onGenerate={handleGenerateEmbeddings}
              sourceColumn={sourceColumn}
              targetColumn={targetColumn}
              hasApiKey={Boolean(jinaApiKey && jinaApiKey.trim().length > 0)}
              tableExists={tableExists}
              progressPercentage={progressPercentage}
              statusMessage={statusMessage}
              logs={logs}
              lastResult={lastResult}
            />

            {/* Paso 4: Visor de Registros y Auditoría */}
            <Step4RecordsTable
              records={records as any}
              loading={loadingRecords}
              totalRecords={totalRecords}
              sourceColumn={sourceColumn}
              targetColumn={targetColumn}
              onRefresh={() => loadRecords(targetColumn)}
            />
          </div>
        )}

        {/* ── SUB-PESTAÑA 2: Análisis de Embeddings (Match Semántico + Gráfica t-SNE 2D) ── */}
        {activeTab === "analysis" && (
          <AnalysisTab
            columns={columns}
            records={records}
            jinaApiKey={jinaApiKey}
            defaultEmbeddingCol={targetColumn}
            onRefreshRecords={() => loadRecords(targetColumn)}
          />
        )}
      </div>
    </main>
  );
}
