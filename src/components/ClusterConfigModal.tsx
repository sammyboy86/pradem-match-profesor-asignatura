"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Save,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Tag,
  Search,
  Copy,
  Check,
  Share2,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  Database,
  Info,
} from "lucide-react";
import {
  SavedClusterConfiguration,
  ClusterVerificationResult,
} from "@/types";
import { apiFetch } from "@/lib/utils";

interface ClusterConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "load" | "save";
  currentClusterColumn: string;
  currentClusterBetas: Record<string, Record<string, number>>;
  currentDefaultBetas: Record<string, number>;
  currentCustomClusters: string[];
  activeAsignaturaClusters: string[];
  onLoadConfiguration: (config: SavedClusterConfiguration) => void;
}

export function verifyClusterConfiguration(
  configClusters: string[],
  currentAsigClusters: string[]
): ClusterVerificationResult {
  const configSet = new Set(configClusters.map((c) => c.trim()).filter(Boolean));
  const asigSet = new Set(currentAsigClusters.map((c) => c.trim()).filter(Boolean));

  const matchingClusters: string[] = [];
  const missingInAsignaturas: string[] = [];
  const missingInConfig: string[] = [];

  configSet.forEach((c) => {
    if (asigSet.has(c)) {
      matchingClusters.push(c);
    } else {
      missingInAsignaturas.push(c);
    }
  });

  asigSet.forEach((c) => {
    if (!configSet.has(c)) {
      missingInConfig.push(c);
    }
  });

  const isValid = missingInAsignaturas.length === 0 && missingInConfig.length === 0;

  return {
    isValid,
    matchingClusters: matchingClusters.sort(),
    missingInAsignaturas: missingInAsignaturas.sort(),
    missingInConfig: missingInConfig.sort(),
    totalConfigured: configSet.size,
    totalInAsignaturas: asigSet.size,
  };
}

export default function ClusterConfigModal({
  isOpen,
  onClose,
  initialTab = "load",
  currentClusterColumn,
  currentClusterBetas,
  currentDefaultBetas,
  currentCustomClusters,
  activeAsignaturaClusters,
  onLoadConfiguration,
}: ClusterConfigModalProps) {
  const [activeTab, setActiveTab] = useState<"load" | "save">(initialTab);

  // Estados de listado de configuraciones
  const [savedConfigs, setSavedConfigs] = useState<SavedClusterConfiguration[]>([]);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
  const [tableExists, setTableExists] = useState<boolean | null>(null);
  const [sqlSetupCode, setSqlSetupCode] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<number | string | null>(null);

  // Estados de formulario para guardar
  const [configName, setConfigName] = useState("");
  const [configDescription, setConfigDescription] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Cargar lista de configuraciones de Supabase al abrir el modal
  const fetchSavedConfigurations = async () => {
    setIsLoadingConfigs(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        tableExists?: boolean;
        configurations?: SavedClusterConfiguration[];
        sqlSetup?: string;
        error?: string;
      }>("/api/cluster-configurations");

      if (res.tableExists === false) {
        setTableExists(false);
        setSqlSetupCode(res.sqlSetup || null);
        setSavedConfigs([]);
      } else if (res.success && Array.isArray(res.configurations)) {
        setTableExists(true);
        setSavedConfigs(res.configurations);
      } else {
        setSavedConfigs([]);
      }
    } catch (err: any) {
      console.warn("Error al cargar configuraciones de clusters:", err);
      setTableExists(false);
    } finally {
      setIsLoadingConfigs(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      fetchSavedConfigurations();
      setSaveSuccessMsg(null);
      setSaveErrorMsg(null);
    }
  }, [isOpen, initialTab]);

  // Lista filtrada de configuraciones
  const filteredConfigs = useMemo(() => {
    if (!searchQuery.trim()) return savedConfigs;
    const q = searchQuery.toLowerCase().trim();
    return savedConfigs.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.author && c.author.toLowerCase().includes(q)) ||
        c.clusterColumn.toLowerCase().includes(q)
    );
  }, [savedConfigs, searchQuery]);

  // Manejo de guardado en Supabase
  const handleSaveConfiguration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configName.trim()) {
      setSaveErrorMsg("Introduce un nombre representativo para la configuración.");
      return;
    }

    setIsSaving(true);
    setSaveErrorMsg(null);
    setSaveSuccessMsg(null);

    try {
      const res = await apiFetch<{
        success: boolean;
        configuration?: SavedClusterConfiguration;
        tableExists?: boolean;
        sqlSetup?: string;
        error?: string;
        message?: string;
      }>("/api/cluster-configurations", {
        method: "POST",
        body: JSON.stringify({
          name: configName.trim(),
          description: configDescription.trim() || undefined,
          clusterColumn: currentClusterColumn,
          clusterBetas: currentClusterBetas,
          defaultBetas: currentDefaultBetas,
          customClusters: currentCustomClusters,
          author: authorName.trim() || undefined,
        }),
      });

      if (res.tableExists === false) {
        setTableExists(false);
        setSqlSetupCode(res.sqlSetup || null);
        setSaveErrorMsg(res.error || "La tabla no existe en Supabase.");
        return;
      }

      if (res.success) {
        setSaveSuccessMsg(`¡Configuración '${configName}' guardada con éxito en Supabase!`);
        setConfigName("");
        setConfigDescription("");
        await fetchSavedConfigurations();
        setTimeout(() => {
          setActiveTab("load");
          setSaveSuccessMsg(null);
        }, 1200);
      } else {
        setSaveErrorMsg(res.error || "Error al guardar la configuración en Supabase.");
      }
    } catch (err: any) {
      setSaveErrorMsg(err.message || "Error al conectar con Supabase.");
    } finally {
      setIsSaving(false);
    }
  };

  // Manejo de eliminación
  const handleDeleteConfig = async (id: number | string, name: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar la configuración '${name}' de Supabase? Esta acción afectará a todos los usuarios.`)) {
      return;
    }

    setDeletingId(id);
    try {
      const res = await apiFetch<{ success: boolean; error?: string }>(
        `/api/cluster-configurations?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );

      if (res.success) {
        setSavedConfigs((prev) => prev.filter((c) => c.id !== id));
      } else {
        alert(res.error || "No se pudo eliminar la configuración.");
      }
    } catch (err: any) {
      alert(err.message || "Error al eliminar la configuración.");
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen) return null;

  const currentConfiguredClusterCount = Object.keys(currentClusterBetas).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in">
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Encabezado del Modal */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-400 border border-cyan-500/20">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Configuraciones de Clusters en Supabase
                </h3>
                <span className="rounded-md bg-cyan-500/20 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-cyan-300 font-mono">
                  Compartido
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Guarda tus ponderaciones Beta (&beta;) y clusters en la nube para compartirlos entre todos los usuarios.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Barra de Pestañas (Cargar vs Guardar) */}
        <div className="flex items-center border-b border-white/10 bg-slate-950/40 px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("load")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition cursor-pointer ${
              activeTab === "load"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            <FolderOpen className="h-4 w-4" />
            <span>Cargar Configuración Guardada ({savedConfigs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("save")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition cursor-pointer ${
              activeTab === "save"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            <Save className="h-4 w-4" />
            <span>Guardar Configuración Actual</span>
          </button>
        </div>

        {/* Contenido Principal */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ── PESTAÑA: CARGAR CONFIGURACIÓN ── */}
          {activeTab === "load" && (
            <div className="space-y-4">
              {/* Alerta si la tabla no existe en Supabase */}
              {tableExists === false && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>La tabla &apos;cluster_configurations&apos; aún no ha sido creada en Supabase</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Para permitir guardar y compartir configuraciones entre todos los usuarios, ejecuta este script en el SQL Editor de tu proyecto Supabase:
                  </p>
                  {sqlSetupCode && (
                    <div className="relative">
                      <pre className="max-h-36 overflow-x-auto rounded-lg bg-black/60 p-3 font-mono text-[11px] text-slate-300 border border-white/10">
                        {sqlSetupCode}
                      </pre>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(sqlSetupCode);
                          setCopiedSql(true);
                          setTimeout(() => setCopiedSql(false), 2000);
                        }}
                        className="absolute top-2 right-2 flex items-center gap-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-2 py-1 text-[11px] text-amber-200 transition"
                      >
                        {copiedSql ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedSql ? "Copiado" : "Copiar SQL"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Barra de Búsqueda y Botón Refrescar */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre, autor, descripción..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/80 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={fetchSavedConfigurations}
                  disabled={isLoadingConfigs}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition cursor-pointer"
                  title="Recargar configuraciones de Supabase"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingConfigs ? "animate-spin text-cyan-400" : ""}`} />
                  <span>Actualizar</span>
                </button>
              </div>

              {/* Listado de Tarjetas de Configuraciones */}
              {isLoadingConfigs ? (
                <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-cyan-400 mx-auto" />
                  <p>Consultando configuraciones en Supabase...</p>
                </div>
              ) : filteredConfigs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/40 p-8 text-center space-y-2">
                  <Cloud className="h-8 w-8 text-slate-600 mx-auto" />
                  <h4 className="text-sm font-semibold text-slate-300">
                    No se encontraron configuraciones guardadas
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    {searchQuery
                      ? "Ninguna configuración coincide con tu término de búsqueda."
                      : "Aún no hay plantillas compartidas en Supabase. Ve a la pestaña 'Guardar Configuración Actual' para crear la primera."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("save")}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>Guardar configuración actual</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredConfigs.map((cfg) => {
                    // Verificación en vivo contra las asignaturas actuales
                    const configClusters = Object.keys(cfg.clusterBetas).concat(cfg.customClusters || []);
                    const verification = verifyClusterConfiguration(configClusters, activeAsignaturaClusters);

                    return (
                      <div
                        key={cfg.id}
                        className="group rounded-xl border border-white/10 bg-slate-950/60 p-4 transition hover:border-cyan-500/40 hover:bg-slate-950/90 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition">
                                {cfg.name}
                              </h4>
                              <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                                Columna: {cfg.clusterColumn}
                              </span>
                            </div>
                            {cfg.description && (
                              <p className="text-xs text-slate-400 leading-relaxed">
                                {cfg.description}
                              </p>
                            )}
                          </div>

                          {/* Acciones */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onLoadConfiguration(cfg);
                                onClose();
                              }}
                              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-bold text-white shadow transition cursor-pointer"
                            >
                              <span>Cargar</span>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => cfg.id && handleDeleteConfig(cfg.id, cfg.name)}
                              disabled={deletingId === cfg.id}
                              className="rounded-lg border border-white/10 bg-white/5 hover:bg-red-500/20 hover:border-red-500/30 p-1.5 text-slate-400 hover:text-red-300 transition cursor-pointer"
                              title="Eliminar de Supabase"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Metadatos y Verificación de Clusters */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-2.5 text-xs">
                          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                            <span>
                              Autor: <strong className="text-slate-300">{cfg.author || "Usuario"}</strong>
                            </span>
                            <span>&bull;</span>
                            <span>
                              {Object.keys(cfg.clusterBetas).length} clusters configurados
                            </span>
                            {cfg.updated_at && (
                              <>
                                <span>&bull;</span>
                                <span className="font-mono text-slate-500 text-[10px]">
                                  {new Date(cfg.updated_at).toLocaleDateString()}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Indicador de Verificación */}
                          {activeAsignaturaClusters.length > 0 ? (
                            verification.isValid ? (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Coincide 100% con asignaturas actuales</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>
                                  {verification.matchingClusters.length} de {activeAsignaturaClusters.length} clusters coinciden
                                </span>
                              </span>
                            )
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              (Sin asignaturas cargadas para verificar)
                            </span>
                          )}
                        </div>

                        {/* Desglose de Advertencia de Clusters si no coinciden completamente */}
                        {!verification.isValid && activeAsignaturaClusters.length > 0 && (
                          <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/20 p-2.5 text-[11px] text-amber-300/90 space-y-1">
                            {verification.missingInAsignaturas.length > 0 && (
                              <p>
                                <strong>No presentes en asignaturas actuales:</strong>{" "}
                                {verification.missingInAsignaturas.join(", ")}
                              </p>
                            )}
                            {verification.missingInConfig.length > 0 && (
                              <p>
                                <strong>Clusters en asignaturas sin Betas específicas (usarán General):</strong>{" "}
                                {verification.missingInConfig.join(", ")}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── PESTAÑA: GUARDAR CONFIGURACIÓN ── */}
          {activeTab === "save" && (
            <form onSubmit={handleSaveConfiguration} className="space-y-4">
              {saveSuccessMsg && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 animate-in fade-in">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{saveSuccessMsg}</span>
                </div>
              )}

              {saveErrorMsg && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 animate-in fade-in">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                  <span>{saveErrorMsg}</span>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-cyan-400" />
                  Resumen de la Configuración a Guardar
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg border border-white/5 bg-slate-900/60 p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">Columna</span>
                    <strong className="text-cyan-300 font-mono text-sm">{currentClusterColumn}</strong>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-slate-900/60 p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">Clusters con Betas</span>
                    <strong className="text-white text-sm">{currentConfiguredClusterCount}</strong>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-slate-900/60 p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">Clusters Personalizados</span>
                    <strong className="text-white text-sm">{currentCustomClusters.length}</strong>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-slate-900/60 p-2.5">
                    <span className="text-[10px] text-slate-400 block uppercase font-mono">Ponderación General</span>
                    <strong className="text-emerald-400 text-sm">Configurada</strong>
                  </div>
                </div>
              </div>

              {/* Campos del Formulario */}
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Nombre de la Configuración <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Ponderación Ingenierías 2024-B (Énfasis Técnico)"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Descripción o Criterios (opcional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Describe los criterios de esta plantilla (ej: 70% trayectoria académica en ciencias exactas, 30% experiencia laboral)..."
                    value={configDescription}
                    onChange={(e) => setConfigDescription(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Autor / Creador (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Tu nombre o departamento (ej: Coordinación de Ingeniería)"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveTab("load")}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-xs font-semibold text-slate-300 transition"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSaving || !configName.trim()}
                  className="flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-cyan-600/20 disabled:opacity-50 transition cursor-pointer"
                >
                  {isSaving ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  <span>{isSaving ? "Guardando en Supabase..." : "Guardar en Supabase"}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
