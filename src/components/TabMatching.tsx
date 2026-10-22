"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  Check,
  X,
  Layers,
  Eye,
  EyeOff,
  Trash2,
  ListFilter,
  BookOpen,
  ShieldCheck,
  Cpu,
  Tag,
  Plus,
  Equal,
  Copy,
  RotateCcw,
  Info,
  ArrowRightLeft,
  GitCompare,
  Link2,
} from "lucide-react";
import {
  Profesor,
  QueryConfig,
  ProfesorMatchResult,
  ProfesorEmbeddingResult,
  MatchResultItem,
  FilteredAsignatura,
  FilterClavesResponse,
  ProfessorImportMode,
  RegexFilterConfig,
  DistancePairConfig,
} from "@/types";
import {
  DEFAULT_REGEX_FILTER_CONFIG,
  sanitizarCvParaModelo,
} from "@/lib/sanitizer/cv-sanitizer";
import { RegexFilterModal } from "@/components/RegexFilterModal";
import {
  parseSpreadsheetFile,
  apiFetch,
  exportToExcel,
  exportToCsv,
  formatEmbeddingForExport,
  parseEmbeddingValue,
  cleanClave,
} from "@/lib/utils";

interface TabMatchingProps {
  onOpenSqlModal: () => void;
}

export default function TabMatching({ onOpenSqlModal }: TabMatchingProps) {
  // ── Modo de Importación de Profesores ──
  const [importMode, setImportMode] = useState<ProfessorImportMode>("generate");

  // ── Configuración de Clusters y Betas ──
  const [clusterColumn, setClusterColumn] = useState<string>("cluster");
  const [availableClusterColumns, setAvailableClusterColumns] = useState<string[]>(["cluster"]);
  const [detectedClusters, setDetectedClusters] = useState<string[]>([]);
  const [customClusters, setCustomClusters] = useState<string[]>([]);
  const [selectedClusterTab, setSelectedClusterTab] = useState<string>("__default__");
  const [clusterBetas, setClusterBetas] = useState<Record<string, Record<string, number>>>({});
  const [defaultBetas, setDefaultBetas] = useState<Record<string, number>>({});
  const [newClusterName, setNewClusterName] = useState<string>("");
  const [isLoadingClusters, setIsLoadingClusters] = useState<boolean>(false);

  // ── Configuración de Pares de Distancia Multi-Vector (Profesor ↔ Asignatura) ──
  const [availableAsigVectorCols, setAvailableAsigVectorCols] = useState<string[]>(["embedding_768"]);
  const [distancePairs, setDistancePairs] = useState<DistancePairConfig[]>([]);
  const [newPairProfField, setNewPairProfField] = useState<string>("");
  const [newPairAsigCol, setNewPairAsigCol] = useState<string>("");
  // ── Estados de Filtro Inicial de Asignaturas (Paso 1: Filtro por Claves) ──
  const [filterFile, setFilterFile] = useState<File | null>(null);
  const [filterHeaders, setFilterHeaders] = useState<string[]>([]);
  const [filterRows, setFilterRows] = useState<Record<string, string>[]>([]);
  const [filterKeyColumn, setFilterKeyColumn] = useState<string>("");
  const [isFilterParsing, setIsFilterParsing] = useState(false);
  const [isFilterActive, setIsFilterActive] = useState(true);
  const [uniqueCleanedClaves, setUniqueCleanedClaves] = useState<string[]>([]);
  const [filteredAsignaturas, setFilteredAsignaturas] = useState<FilteredAsignatura[]>([]);
  const [unmatchedClaves, setUnmatchedClaves] = useState<string[]>([]);
  const [isLoadingFilterMatches, setIsLoadingFilterMatches] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [isFilterPreviewOpen, setIsFilterPreviewOpen] = useState(false);
  const [filterPreviewTab, setFilterPreviewTab] = useState<"matched" | "unmatched">("matched");
  const [filterSearchTerm, setFilterSearchTerm] = useState("");
  const filterFileInputRef = useRef<HTMLInputElement>(null);

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
  const [rateLimiterStats, setRateLimiterStats] = useState<{
    currentWindowRequests: number;
    maxRpm: number;
    rpmUtilizationPct: number;
    currentWindowTokens: number;
    maxTpm: number;
    tpmUtilizationPct: number;
    totalRequestsLifetime: number;
    totalTokensLifetime: number;
    total429Retries: number;
  } | null>(null);

  // Generación exclusiva de Embeddings de Profesores (sin matching)
  const [isEmbeddingOnly, setIsEmbeddingOnly] = useState(false);
  const [embedOnlyProgress, setEmbedOnlyProgress] = useState(0);
  const [embedOnlyStatusText, setEmbedOnlyStatusText] = useState("");
  const [professorEmbeddingsList, setProfessorEmbeddingsList] = useState<ProfesorEmbeddingResult[]>([]);

  // Estados de visualización y acordeón
  const [expandedProfessorIds, setExpandedProfessorIds] = useState<Record<string, boolean>>({});
  const [searchFilter, setSearchFilter] = useState("");
  const [filterOnlyWithMatches, setFilterOnlyWithMatches] = useState(false);

  // ── Filtro Regex Anti-Sesgo Docente (Sanitizador de CVs) ──
  const [isRegexModalOpen, setIsRegexModalOpen] = useState(false);
  const [regexFilterConfig, setRegexFilterConfig] = useState<RegexFilterConfig>(DEFAULT_REGEX_FILTER_CONFIG);

  // Cargar configuración guardada de localStorage al iniciar
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pradem_cv_regex_filter");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setRegexFilterConfig((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch (e) {
      console.warn("Error al cargar configuración regex de localStorage:", e);
    }
  }, []);

  // Función de actualización y autoguardado en localStorage
  const handleUpdateRegexFilterConfig = (newConfig: RegexFilterConfig) => {
    setRegexFilterConfig(newConfig);
    try {
      localStorage.setItem("pradem_cv_regex_filter", JSON.stringify(newConfig));
    } catch (e) {
      console.warn("Error al guardar configuración regex en localStorage:", e);
    }
  };

  // ── Cargar conteo total de asignaturas del catálogo de Supabase ──
  useEffect(() => {
    async function loadCatalogCount() {
      try {
        const res = await apiFetch<{
          success: boolean;
          totalCount?: number;
          availableVectorColumns?: string[];
        }>("/api/asignaturas?limit=1");
        if (typeof res.totalCount === "number" && res.totalCount > 0) {
          setTotalCatalogCount(res.totalCount);
        }
        if (Array.isArray(res.availableVectorColumns) && res.availableVectorColumns.length > 0) {
          setAvailableAsigVectorCols(res.availableVectorColumns);
        }
      } catch (err) {
        console.warn("No se pudo obtener conteo de asignaturas:", err);
      }
    }
    loadCatalogCount();
  }, []);

  // ── Conteo Efectivo de Asignaturas (Filtradas vs Catálogo Completo) ──
  const isFilterEffective = isFilterActive && filteredAsignaturas.length > 0;
  const effectiveCatalogCount = isFilterEffective ? filteredAsignaturas.length : totalCatalogCount;

  // Ajustar Top K automáticamente si excede el catálogo efectivo
  useEffect(() => {
    if (effectiveCatalogCount > 0 && topK > effectiveCatalogCount) {
      setTopK(effectiveCatalogCount);
    }
  }, [effectiveCatalogCount, topK]);

  // ── Cargar Clusters Disponibles desde Supabase o Filtro ──
  const loadAvailableClusters = useCallback(async (colName: string) => {
    setIsLoadingClusters(true);
    try {
      if (isFilterActive && filteredAsignaturas.length > 0) {
        // Extraer de las asignaturas filtradas
        const clustersSet = new Set<string>();
        const vectorColsSet = new Set<string>(["embedding_768"]);
        filteredAsignaturas.forEach((a) => {
          const val = (a as any)[colName] || a.cluster;
          if (val && String(val).trim()) {
            clustersSet.add(String(val).trim());
          }
          if (Array.isArray(a.vectorColumns)) {
            a.vectorColumns.forEach((c) => vectorColsSet.add(c));
          }
          if (a.vectors && typeof a.vectors === "object") {
            Object.keys(a.vectors).forEach((k) => vectorColsSet.add(k));
          }
        });
        setDetectedClusters(Array.from(clustersSet).sort());
        setAvailableAsigVectorCols(Array.from(vectorColsSet));
      } else {
        // Consultar el endpoint de clusters
        const data = await apiFetch<{
          success: boolean;
          availableColumns: string[];
          clusters: string[];
          availableVectorColumns?: string[];
        }>(`/api/asignaturas/clusters?column=${encodeURIComponent(colName)}`);

        if (data.success) {
          if (Array.isArray(data.availableColumns) && data.availableColumns.length > 0) {
            setAvailableClusterColumns(data.availableColumns);
          }
          if (Array.isArray(data.clusters)) {
            setDetectedClusters(data.clusters);
          }
          if (Array.isArray(data.availableVectorColumns) && data.availableVectorColumns.length > 0) {
            setAvailableAsigVectorCols(data.availableVectorColumns);
          }
        }
      }
    } catch (err) {
      console.warn("No se pudieron cargar clusters:", err);
    } finally {
      setIsLoadingClusters(false);
    }
  }, [isFilterActive, filteredAsignaturas]);

  useEffect(() => {
    loadAvailableClusters(clusterColumn);
  }, [loadAvailableClusters, clusterColumn]);

  const allClustersList = useMemo(() => {
    const set = new Set([...detectedClusters, ...customClusters]);
    return Array.from(set).sort();
  }, [detectedClusters, customClusters]);

  const activeFields = useMemo(() => {
    return queryConfigs.filter((c) => c.active).map((c) => c.field);
  }, [queryConfigs]);

  // Pares de distancia activos (cuyo campo docente esté activo en queryConfigs y el par esté marcado como activo)
  const activePairs = useMemo(() => {
    return distancePairs.filter(
      (p) => p.active !== false && activeFields.includes(p.profField)
    );
  }, [distancePairs, activeFields]);

  // Auto-sincronizar distancePairs cuando cambian los campos activos o las columnas vectoriales
  useEffect(() => {
    if (!activeFields.length) return;

    setDistancePairs((prev) => {
      const existing = [...prev];
      const primaryCol = availableAsigVectorCols[0] || "embedding_768";
      let changed = false;

      // Garantizar que cada campo activo tenga al menos un par
      activeFields.forEach((profField) => {
        const hasPair = existing.some((p) => p.profField === profField);
        if (!hasPair) {
          const cfg = queryConfigs.find((c) => c.field === profField);
          const pairId = `${profField}__${primaryCol}`;
          if (!existing.some((p) => p.id === pairId)) {
            existing.push({
              id: pairId,
              profField,
              asigVectorCol: primaryCol,
              label: `${cfg?.label || profField} ↔ ${primaryCol}`,
              active: true,
              weight: cfg && cfg.weight > 0 ? cfg.weight : 1,
            });
            changed = true;
          }
        }
      });

      return changed ? existing : prev;
    });
  }, [activeFields, availableAsigVectorCols, queryConfigs]);

  // Acciones de gestión de pares de distancia
  const handleAddDistancePair = () => {
    if (!newPairProfField || !newPairAsigCol) return;
    const pairId = `${newPairProfField}__${newPairAsigCol}`;
    if (distancePairs.some((p) => p.id === pairId)) {
      alert("Este par de distancia ya existe en la configuración.");
      return;
    }
    const profCfg = queryConfigs.find((c) => c.field === newPairProfField);
    const newPair: DistancePairConfig = {
      id: pairId,
      profField: newPairProfField,
      asigVectorCol: newPairAsigCol,
      label: `${profCfg?.label || newPairProfField} ↔ ${newPairAsigCol}`,
      active: true,
      weight: profCfg && profCfg.weight > 0 ? profCfg.weight : 1,
    };
    setDistancePairs((prev) => [...prev, newPair]);
    setNewPairProfField("");
    setNewPairAsigCol("");
  };

  const handleTogglePairActive = (pairId: string) => {
    setDistancePairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, active: !p.active } : p))
    );
  };

  const handleRemoveDistancePair = (pairId: string) => {
    setDistancePairs((prev) => prev.filter((p) => p.id !== pairId));
  };

  const handleResetPairsToOneToOne = () => {
    const primaryCol = availableAsigVectorCols[0] || "embedding_768";
    const pairs: DistancePairConfig[] = activeFields.map((f) => {
      const cfg = queryConfigs.find((c) => c.field === f);
      return {
        id: `${f}__${primaryCol}`,
        profField: f,
        asigVectorCol: primaryCol,
        label: `${cfg?.label || f} ↔ ${primaryCol}`,
        active: true,
        weight: cfg && cfg.weight > 0 ? cfg.weight : 1,
      };
    });
    setDistancePairs(pairs);
  };

  const handleCrossAllPairs = () => {
    const pairs: DistancePairConfig[] = [];
    activeFields.forEach((f) => {
      const cfg = queryConfigs.find((c) => c.field === f);
      availableAsigVectorCols.forEach((col) => {
        pairs.push({
          id: `${f}__${col}`,
          profField: f,
          asigVectorCol: col,
          label: `${cfg?.label || f} ↔ ${col}`,
          active: true,
          weight: cfg && cfg.weight > 0 ? cfg.weight : 1,
        });
      });
    });
    setDistancePairs(pairs);
  };

  // Asegurar que defaultBetas y cada cluster tengan valores válidos que sumen 100% sobre activePairs
  useEffect(() => {
    if (!activePairs.length) return;

    setDefaultBetas((prev) => {
      const next = { ...prev };
      let missingCount = 0;
      activePairs.forEach((p) => {
        if (typeof next[p.id] !== "number") {
          if (typeof next[p.profField] === "number") {
            next[p.id] = next[p.profField];
          } else {
            missingCount++;
          }
        }
      });

      if (missingCount > 0 || Object.keys(next).length === 0) {
        const totalW = activePairs.reduce((acc, p) => {
          const cfg = queryConfigs.find((c) => c.field === p.profField);
          const w = p.weight ?? (cfg && cfg.weight > 0 ? cfg.weight : 1);
          return acc + w;
        }, 0);

        activePairs.forEach((p) => {
          if (typeof next[p.id] !== "number") {
            const cfg = queryConfigs.find((c) => c.field === p.profField);
            const w = p.weight ?? (cfg && cfg.weight > 0 ? cfg.weight : 1);
            next[p.id] = totalW > 0 ? Math.round((w / totalW) * 100) : Math.round(100 / activePairs.length);
          }
        });
      }
      return next;
    });

    setClusterBetas((prev) => {
      const next = { ...prev };
      allClustersList.forEach((cluster) => {
        if (!next[cluster]) {
          next[cluster] = {};
        }
        activePairs.forEach((p) => {
          if (typeof next[cluster][p.id] !== "number") {
            if (typeof next[cluster][p.profField] === "number") {
              next[cluster][p.id] = next[cluster][p.profField];
            } else {
              const defVal = defaultBetas[p.id] ?? defaultBetas[p.profField];
              next[cluster][p.id] = typeof defVal === "number" ? defVal : Math.round(100 / activePairs.length);
            }
          }
        });
      });
      return next;
    });
  }, [activePairs, allClustersList, queryConfigs, defaultBetas]);

  // Actualizar un peso beta individual (key puede ser pair.id o field)
  const handleUpdateBeta = (clusterKey: string, key: string, value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    if (clusterKey === "__default__") {
      setDefaultBetas((prev) => ({ ...prev, [key]: clamped }));
    } else {
      setClusterBetas((prev) => ({
        ...prev,
        [clusterKey]: {
          ...(prev[clusterKey] || {}),
          [key]: clamped,
        },
      }));
    }
  };

  // Normalizar los betas del cluster activo para que sumen exactamente 100% sobre activePairs
  const handleNormalizeBetas = (clusterKey: string) => {
    const current = clusterKey === "__default__" ? defaultBetas : clusterBetas[clusterKey] || {};
    const total = activePairs.reduce(
      (acc, p) => acc + (current[p.id] ?? current[p.profField] ?? 0),
      0
    );
    if (total === 0) {
      const eq = Math.round(100 / activePairs.length);
      activePairs.forEach((p) => handleUpdateBeta(clusterKey, p.id, eq));
      return;
    }
    const updated: Record<string, number> = {};
    let running = 0;
    activePairs.forEach((p, idx) => {
      if (idx === activePairs.length - 1) {
        updated[p.id] = Math.max(0, 100 - running);
      } else {
        const val = Math.round(
          (((current[p.id] ?? current[p.profField] ?? 0) / total) * 100)
        );
        updated[p.id] = val;
        running += val;
      }
    });

    if (clusterKey === "__default__") {
      setDefaultBetas((prev) => ({ ...prev, ...updated }));
    } else {
      setClusterBetas((prev) => ({
        ...prev,
        [clusterKey]: { ...(prev[clusterKey] || {}), ...updated },
      }));
    }
  };

  // Distribuir equitativamente entre los pares activos
  const handleEquiDistribute = (clusterKey: string) => {
    const count = activePairs.length;
    if (count === 0) return;
    const base = Math.floor(100 / count);
    const remainder = 100 - base * count;
    const updated: Record<string, number> = {};
    activePairs.forEach((p, idx) => {
      updated[p.id] = idx === 0 ? base + remainder : base;
    });

    if (clusterKey === "__default__") {
      setDefaultBetas((prev) => ({ ...prev, ...updated }));
    } else {
      setClusterBetas((prev) => ({
        ...prev,
        [clusterKey]: { ...(prev[clusterKey] || {}), ...updated },
      }));
    }
  };

  // Copiar betas actuales a todos los clusters
  const handleCopyBetasToAll = (sourceClusterKey: string) => {
    const sourceBetas = sourceClusterKey === "__default__"
      ? defaultBetas
      : clusterBetas[sourceClusterKey] || defaultBetas;

    setDefaultBetas({ ...sourceBetas });
    const nextClusterBetas: Record<string, Record<string, number>> = {};
    allClustersList.forEach((c) => {
      nextClusterBetas[c] = { ...sourceBetas };
    });
    setClusterBetas(nextClusterBetas);
  };

  // Agregar cluster manual
  const handleAddCustomCluster = () => {
    const trimmed = newClusterName.trim();
    if (!trimmed) return;
    if (!allClustersList.includes(trimmed)) {
      setCustomClusters((prev) => [...prev, trimmed]);
      setClusterBetas((prev) => ({
        ...prev,
        [trimmed]: { ...defaultBetas },
      }));
    }
    setSelectedClusterTab(trimmed);
    setNewClusterName("");
  };

  // Estadísticas de validación de vectores en modo Solo Match
  const validVectorStats = useMemo(() => {
    if (importMode !== "only_match" || !fileRows.length) return null;
    const activeConfigs = queryConfigs.filter((c) => c.active);
    if (!activeConfigs.length) return null;

    let fullyMappedProfessors = 0;
    fileRows.forEach((row) => {
      const hasAllFields = activeConfigs.every((c) => {
        const col = c.embeddingColumn || `Embedding Profesor (${c.field})`;
        const raw = row[col];
        const vec = parseEmbeddingValue(raw);
        return Array.isArray(vec) && vec.length === 768;
      });

      const singleRaw = row["Embedding Profesor"] || row["embedding_768"] || row["embedding"] || row["vector"];
      const hasSingle = Array.isArray(parseEmbeddingValue(singleRaw));

      if (hasAllFields || hasSingle) {
        fullyMappedProfessors++;
      }
    });

    return {
      validCount: fullyMappedProfessors,
      totalCount: fileRows.length,
      percentage: Math.round((fullyMappedProfessors / fileRows.length) * 100),
    };
  }, [importMode, fileRows, queryConfigs]);

  // ── Procesamiento de Filtro de Claves (Limpieza Preliminar + Consulta) ──
  const processFilterColumn = async (rows: Record<string, string>[], colName: string) => {
    if (!rows.length || !colName) {
      setFilteredAsignaturas([]);
      setUnmatchedClaves([]);
      setUniqueCleanedClaves([]);
      return;
    }

    setFilterError(null);
    setIsLoadingFilterMatches(true);

    try {
      // Limpieza preliminar: quitar caracteres no alfa-numéricos y pasar a mayúsculas
      const cleaned = rows
        .map((r) => cleanClave(r[colName]))
        .filter((k) => k.length > 0);

      const unique = Array.from(new Set(cleaned));
      setUniqueCleanedClaves(unique);

      if (unique.length === 0) {
        setFilteredAsignaturas([]);
        setUnmatchedClaves([]);
        setFilterError("No se encontraron claves con caracteres alfa-numéricos válidos en la columna seleccionada.");
        return;
      }

      // Consultar endpoint para validar contra catálogo de asignaturas en Supabase
      const res = await apiFetch<FilterClavesResponse>("/api/asignaturas/filter-claves", {
        method: "POST",
        body: JSON.stringify({ claves: unique }),
      });

      if (res.success) {
        setFilteredAsignaturas(res.matchedAsignaturas || []);
        setUnmatchedClaves(res.unmatchedClaves || []);
        setIsFilterActive(true);
        if (res.matchedAsignaturas && res.matchedAsignaturas.length > 0) {
          const vectorColsSet = new Set<string>(["embedding_768"]);
          res.matchedAsignaturas.forEach((a) => {
            if (Array.isArray(a.vectorColumns)) {
              a.vectorColumns.forEach((c) => vectorColsSet.add(c));
            }
            if (a.vectors && typeof a.vectors === "object") {
              Object.keys(a.vectors).forEach((k) => vectorColsSet.add(k));
            }
          });
          setAvailableAsigVectorCols(Array.from(vectorColsSet));
        }
      } else {
        setFilterError(res.error || "Error al buscar asignaturas por claves en el catálogo.");
      }
    } catch (err: any) {
      console.error("Error al procesar filtro de claves:", err);
      setFilterError(err.message || "Error al conectar con el servidor para filtrar claves.");
    } finally {
      setIsLoadingFilterMatches(false);
    }
  };

  const handleFilterFileSelected = async (selectedFile: File) => {
    setFilterFile(selectedFile);
    setIsFilterParsing(true);
    setFilterError(null);

    try {
      const { headers, rows } = await parseSpreadsheetFile(selectedFile);
      setFilterHeaders(headers);
      setFilterRows(rows);

      // Detección automática inteligente de la columna de claves
      const normalize = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

      const detected =
        headers.find((h) => {
          const n = normalize(h);
          return (
            n === "clave" ||
            n.includes("clave") ||
            n === "cve" ||
            n.includes("cve") ||
            n.includes("codigo") ||
            n.includes("code") ||
            n === "id" ||
            n.includes("asignatura") ||
            n.includes("materia")
          );
        }) || headers[0] || "";

      setFilterKeyColumn(detected);
      await processFilterColumn(rows, detected);
    } catch (err: any) {
      alert(err.message || "Error al procesar archivo de claves");
      setFilterFile(null);
    } finally {
      setIsFilterParsing(false);
    }
  };

  const handleFilterDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFilterFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleClearFilter = () => {
    setFilterFile(null);
    setFilterHeaders([]);
    setFilterRows([]);
    setFilterKeyColumn("");
    setUniqueCleanedClaves([]);
    setFilteredAsignaturas([]);
    setUnmatchedClaves([]);
    setIsFilterActive(false);
    setFilterError(null);
    setIsFilterPreviewOpen(false);
    if (filterFileInputRef.current) {
      filterFileInputRef.current.value = "";
    }
  };

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

      // Omitir columnas que son vectores precalculados para no agregarlas como texto a buscar
      if (
        norm.startsWith("embedding") ||
        norm.includes("embedding") ||
        norm.includes("vector")
      ) {
        return;
      }

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

      // Auto-detectar si existe una columna de embedding en el archivo para este campo
      const matchingEmbCol =
        headers.find((h) => {
          const hn = normalize(h);
          return (
            hn === `embeddingprofesor(${norm})` ||
            hn === `embeddingprofesor${norm}` ||
            hn === `embedding${norm}` ||
            hn === `vector${norm}` ||
            hn === `${norm}embedding` ||
            hn === `${norm}vector`
          );
        }) ||
        headers.find((h) => {
          const hn = normalize(h);
          return hn === "embeddingprofesor" || hn === "embedding768" || hn === "vector";
        }) ||
        "";

      configs.push({
        field: header,
        label: header,
        active: isRelevant,
        template: defaultTemplate,
        weight: isAcademic || isLabor ? 50 : 25,
        embeddingColumn: matchingEmbCol,
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

    if (isFilterActive && filterFile && filteredAsignaturas.length === 0) {
      alert("El filtro de asignaturas está activo pero no coincide con ninguna asignatura en la base de datos. Revisa el archivo o desactiva el filtro.");
      return;
    }

    setIsMatching(true);
    setMatchProgress(5);
    setMatchStatusText(
      importMode === "only_match"
        ? "Iniciando matching directo con embeddings precalculados..."
        : "Iniciando matching multimodal con Gemini..."
    );
    setMatchResults([]);

    try {
      // Formatear profesores e incorporar embeddings precalculados si está en modo Solo Match
      const profesoresList: Profesor[] = fileRows.map((row, idx) => {
        const prof: Profesor = {
          id: idx + 1,
          nombre_profesor: (nameColumn ? row[nameColumn] : "") || `Profesor ${idx + 1}`,
          ...row,
        };

        if (importMode === "only_match") {
          const fieldEmbeddings: Record<string, number[]> = {};
          for (const config of activeConfigs) {
            const col = config.embeddingColumn || `Embedding Profesor (${config.field})`;
            const raw = row[col];
            if (raw) {
              const vec = parseEmbeddingValue(raw);
              if (vec && vec.length === 768) {
                fieldEmbeddings[config.field] = vec;
              }
            }
          }
          prof.fieldEmbeddings = fieldEmbeddings;

          // Vector compuesto/único de respaldo si existe
          const singleRaw =
            row["Embedding Profesor"] ||
            row["embedding_768"] ||
            row["embedding"] ||
            row["vector"];
          if (singleRaw) {
            const singleVec = parseEmbeddingValue(singleRaw);
            if (singleVec && singleVec.length === 768) {
              prof.embedding_768 = singleVec;
              // Si no había vectores por campo, poblar con el vector único para permitir matching
              activeConfigs.forEach((c) => {
                if (!prof.fieldEmbeddings![c.field]) {
                  prof.fieldEmbeddings![c.field] = singleVec;
                }
              });
            }
          }
        }

        return prof;
      });

      // Si es solo matching sin llamadas a Gemini, procesar en lotes de 20 para máxima velocidad
      const BATCH_SIZE = importMode === "only_match" ? 20 : 4;
      const totalBatches = Math.ceil(profesoresList.length / BATCH_SIZE);
      const allResults: ProfesorMatchResult[] = [];

      for (let b = 0; b < totalBatches; b++) {
        const start = b * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, profesoresList.length);
        const batch = profesoresList.slice(start, end);

        const filterSuffix = isFilterEffective
          ? ` sobre ${filteredAsignaturas.length} asignaturas filtradas`
          : "";
        setMatchStatusText(
          importMode === "only_match"
            ? `Calculando similitudes coseno para profesores ${start + 1} a ${end} de ${profesoresList.length}${filterSuffix}...`
            : `Procesando profesores ${start + 1} a ${end} de ${profesoresList.length}${filterSuffix}...`
        );
        setMatchProgress(10 + Math.round(((b + 0.5) / totalBatches) * 85));

        const res = await apiFetch<{
          success: boolean;
          results?: ProfesorMatchResult[];
          rateLimiterStats?: any;
          error?: string;
        }>("/api/match-profesores", {
          method: "POST",
          body: JSON.stringify({
            profesores: batch,
            queryConfigs: activeConfigs,
            distancePairs: activePairs,
            filterMode,
            threshold: filterMode === "topK" ? 0.0 : threshold,
            topK: filterMode === "threshold" ? (effectiveCatalogCount || 500) : topK,
            filterAsignaturaIds: isFilterEffective ? filteredAsignaturas.map((a) => a.id) : undefined,
            clusterColumn,
            clusterBetas,
            defaultBetas,
            regexFilter: importMode === "generate" ? regexFilterConfig : undefined,
          }),
        });

        if (!res.success || !res.results) {
          throw new Error(res.error || `Error al procesar el lote ${b + 1} de matching.`);
        }

        allResults.push(...res.results);
        if (res.rateLimiterStats) {
          setRateLimiterStats(res.rateLimiterStats);
        }
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

  // ── Generación Exclusiva de Embeddings de Profesores (Sin Matching) ──
  const handleGenerateProfessorEmbeddingsOnly = async () => {
    const activeConfigs = queryConfigs.filter((c) => c.active && c.weight > 0);
    if (!activeConfigs.length) {
      alert("Debes seleccionar y activar al menos un campo con peso > 0 para generar los embeddings.");
      return;
    }

    if (!fileRows.length) {
      alert("No hay registros de profesores para procesar.");
      return;
    }

    setIsEmbeddingOnly(true);
    setEmbedOnlyProgress(5);
    setEmbedOnlyStatusText("Iniciando generación de embeddings de profesores con Gemini 2...");
    setProfessorEmbeddingsList([]);

    try {
      const profesoresList: Profesor[] = fileRows.map((row, idx) => ({
        id: idx + 1,
        nombre_profesor: (nameColumn ? row[nameColumn] : "") || `Profesor ${idx + 1}`,
        ...row,
      }));

      // Procesar en lotes de 15 profesores con el RateLimitManager
      const BATCH_SIZE = 15;
      const totalBatches = Math.ceil(profesoresList.length / BATCH_SIZE);
      const allResults: ProfesorEmbeddingResult[] = [];

      for (let b = 0; b < totalBatches; b++) {
        const start = b * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, profesoresList.length);
        const batch = profesoresList.slice(start, end);

        setEmbedOnlyStatusText(
          `Generando embeddings para docentes ${start + 1} a ${end} de ${profesoresList.length} con Gemini 2...`
        );
        setEmbedOnlyProgress(10 + Math.round(((b + 0.5) / totalBatches) * 85));

        const res = await apiFetch<{
          success: boolean;
          results?: ProfesorEmbeddingResult[];
          rateLimiterStats?: any;
          error?: string;
        }>("/api/profesores/embed", {
          method: "POST",
          body: JSON.stringify({
            profesores: batch,
            queryConfigs: activeConfigs,
            regexFilter: regexFilterConfig,
          }),
        });

        if (!res.success || !res.results) {
          throw new Error(res.error || `Error al procesar el lote ${b + 1} de embeddings.`);
        }

        allResults.push(...res.results);
        if (res.rateLimiterStats) {
          setRateLimiterStats(res.rateLimiterStats);
        }
      }

      setEmbedOnlyProgress(100);
      setEmbedOnlyStatusText("¡Embeddings de docentes generados exitosamente!");
      setProfessorEmbeddingsList(allResults);

      // Descargar automáticamente en Excel (.xlsx) por comodidad
      exportProfessorEmbeddings(allResults, "excel");
    } catch (err: any) {
      console.error("Error generando embeddings de profesores:", err);
      alert(`Error al generar embeddings: ${err.message || "Error desconocido"}`);
    } finally {
      setIsEmbeddingOnly(false);
    }
  };

  const exportProfessorEmbeddings = (
    items: ProfesorEmbeddingResult[],
    format: "excel" | "csv"
  ) => {
    if (!items.length) return;

    const rows = items.map((item) => {
      const rowData: Record<string, any> = {
        "ID Profesor": item.profesor.id,
        "Nombre Profesor": item.profesor.nombre_profesor,
      };

      fileHeaders.forEach((h) => {
        if (h !== nameColumn) {
          let val = item.profesor[h] ?? "";
          if (
            item.sanitizationStatus === "sanitized" &&
            typeof val === "string" &&
            regexFilterConfig?.enabled
          ) {
            const res = sanitizarCvParaModelo(val, regexFilterConfig, false);
            val = res.sanitizedText;
          }
          rowData[h] = val;
        }
      });

      // Embedding 768d global/compuesto del profesor
      rowData["Embedding Profesor"] = formatEmbeddingForExport(item.embedding_768);

      // Estado del filtro anti-sesgo
      if (item.sanitizationStatus) {
        rowData["Filtro Anti-Sesgo"] =
          item.sanitizationStatus === "intact"
            ? "Intacto (Credencial pedagógica)"
            : item.sanitizationStatus === "sanitized"
            ? "Sanitizado (Sesgo mitigado)"
            : "Inactivo";
      }

      // Embeddings por cada criterio evaluado
      if (item.fieldEmbeddings) {
        Object.entries(item.fieldEmbeddings).forEach(([field, vec]) => {
          const cfg = queryConfigs.find((c) => c.field === field);
          const label = cfg ? cfg.label : field;
          rowData[`Embedding Profesor (${label})`] = formatEmbeddingForExport(vec);
        });
      }

      return rowData;
    });

    const filename = `Embeddings_Profesores_Gemini2_${new Date().toISOString().slice(0, 10)}`;
    if (format === "excel") {
      exportToExcel(rows, filename);
    } else {
      exportToCsv(rows, filename);
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

  // ── Exportación a Excel (.xlsx) y CSV con Embeddings (Profesor y Asignatura) ──
  // Descubrir todas las columnas adicionales de asignaturas presentes en los resultados
  const getAsignaturaExtraColumns = () => {
    const allAsigExtraCols = new Set<string>();
    const standardAsigKeys = new Set([
      "id",
      "asignaturaId",
      "clave",
      "nombre",
      "cluster",
      "contenido_tematico",
      "fines_de_aprendizaje_o_formacion",
      "actividades_de_aprendizaje",
      "match_nombre",
      "match_semantico",
      "dot_product_match",
      "embedding_768",
      "vectors",
      "compositeSimilarity",
      "fieldSimilarities",
      "pairSimilarities",
      "created_at",
    ]);

    matchResults.forEach((r) => {
      r.matches.forEach((m) => {
        Object.keys(m).forEach((k) => {
          if (!standardAsigKeys.has(k) && !k.startsWith("vector_") && !k.startsWith("embedding_")) {
            allAsigExtraCols.add(k);
          }
        });
      });
    });

    return Array.from(allAsigExtraCols);
  };

  // ── Exportación Matriz a Excel (.xlsx) y CSV (1 Fila por Docente con Todas las Columnas) ──
  const handleExport = (format: "excel" | "csv") => {
    if (!matchResults.length) return;

    const extraAsigCols = getAsignaturaExtraColumns();

    // Aplanar los resultados para formato tabular estructurado
    const rows = matchResults.map((item) => {
      const rowData: Record<string, any> = {};

      // 1. Incluir TODAS las columnas del docente
      const handledDocenteKeys = new Set<string>();

      rowData["ID Profesor"] = item.profesor.id ?? "";
      rowData["Nombre Profesor"] = item.profesor.nombre_profesor ?? "";
      handledDocenteKeys.add("id");
      handledDocenteKeys.add("ID Profesor");
      handledDocenteKeys.add("nombre_profesor");
      handledDocenteKeys.add("Nombre Profesor");
      if (nameColumn) handledDocenteKeys.add(nameColumn);

      // Recopilar todas las columnas del archivo o del objeto profesor
      const allDocenteCols = new Set<string>();
      fileHeaders.forEach((h) => allDocenteCols.add(h));
      Object.keys(item.profesor).forEach((k) => allDocenteCols.add(k));

      allDocenteCols.forEach((col) => {
        if (
          handledDocenteKeys.has(col) ||
          col === "embedding_768" ||
          col === "vectors" ||
          col === "fieldEmbeddings"
        ) {
          return;
        }

        let val = item.profesor[col] ?? "";
        if (
          item.sanitizationStatus === "sanitized" &&
          typeof val === "string" &&
          regexFilterConfig?.enabled
        ) {
          const res = sanitizarCvParaModelo(val, regexFilterConfig, false);
          val = res.sanitizedText;
        }
        rowData[col] = val;
        handledDocenteKeys.add(col);
      });

      // Embedding 768d del Profesor (Vector compuesto multimodal)
      rowData["Embedding Profesor"] = formatEmbeddingForExport(item.embedding_768);

      // Embeddings específicos por criterio evaluado si existen
      if (item.fieldEmbeddings) {
        Object.entries(item.fieldEmbeddings).forEach(([field, vec]) => {
          const cfg = queryConfigs.find((c) => c.field === field);
          const label = cfg ? cfg.label : field;
          rowData[`Embedding Profesor (${label})`] = formatEmbeddingForExport(vec);
        });
      }

      rowData["Asignaturas Asignadas"] = item.matches.length;

      // Estado del filtro anti-sesgo
      if (item.sanitizationStatus) {
        rowData["Filtro Anti-Sesgo"] =
          item.sanitizationStatus === "intact"
            ? "Intacto (Credencial pedagógica)"
            : item.sanitizationStatus === "sanitized"
            ? "Sanitizado (Sesgo mitigado)"
            : "Inactivo";
      }

      // Determinar cuántas columnas de match exportar
      const maxMatchesToExport = Math.max(
        1,
        filterMode === "threshold"
          ? Math.max(...matchResults.map((r) => r.matches.length), 1)
          : topK
      );

      // Desglosar cada una de las recomendaciones con TODAS sus columnas de asignatura
      for (let k = 0; k < maxMatchesToExport; k++) {
        const m = item.matches[k];
        const prefix = `Match ${k + 1}`;
        if (m) {
          rowData[`${prefix} - Asignatura`] = m.nombre;
          rowData[`${prefix} - Clave`] = m.clave;
          rowData[`${prefix} - Cluster`] = m.cluster || "Sin Cluster";
          rowData[`${prefix} - Tipo`] = m.match_nombre ? "Match Nombre (Exento de cupo)" : "Semántico";
          rowData[`${prefix} - Similitud Compuesta`] = `${(m.compositeSimilarity * 100).toFixed(1)}%`;

          // Desglose por par de distancia (multi-vector)
          if (m.pairSimilarities && Object.keys(m.pairSimilarities).length > 0) {
            const desglosePares = Object.entries(m.pairSimilarities)
              .map(([pairKey, score]) => {
                const pairCfg = distancePairs.find((p) => p.id === pairKey);
                const label = pairCfg?.label || pairKey;
                return `${label}: ${(score * 100).toFixed(0)}%`;
              })
              .join(" | ");
            rowData[`${prefix} - Desglose Pares (Multi-Vector)`] = desglosePares;
          }

          // Desglose por criterio
          const desglose = Object.entries(m.fieldSimilarities)
            .map(([field, score]) => `${field}: ${(score * 100).toFixed(0)}%`)
            .join(" | ");
          rowData[`${prefix} - Desglose`] = desglose;

          // Todas las columnas de contenido y formación de la Asignatura
          rowData[`${prefix} - Contenido Temático`] = m.contenido_tematico || "";
          rowData[`${prefix} - Fines de Aprendizaje`] = m.fines_de_aprendizaje_o_formacion || "";
          rowData[`${prefix} - Actividades de Aprendizaje`] = m.actividades_de_aprendizaje || "";

          // Columnas adicionales dinámicas de la Asignatura
          extraAsigCols.forEach((extraCol) => {
            const label = extraCol.replace(/_/g, " ");
            rowData[`${prefix} - ${label}`] = m[extraCol] ?? "";
          });

          // Embedding principal 768d de la Asignatura recomendada
          rowData[`${prefix} - Embedding Asignatura`] = formatEmbeddingForExport(m.embedding_768);

          // Embeddings vectoriales adicionales de la Asignatura si existen
          if (m.vectors && typeof m.vectors === "object") {
            Object.entries(m.vectors).forEach(([vCol, vVec]) => {
              rowData[`${prefix} - Vector Asig (${vCol})`] = formatEmbeddingForExport(vVec);
            });
          }
        } else {
          rowData[`${prefix} - Asignatura`] = "—";
          rowData[`${prefix} - Clave`] = "—";
          rowData[`${prefix} - Cluster`] = "—";
          rowData[`${prefix} - Tipo`] = "—";
          rowData[`${prefix} - Similitud Compuesta`] = "—";
          rowData[`${prefix} - Desglose Pares (Multi-Vector)`] = "—";
          rowData[`${prefix} - Desglose`] = "—";
          rowData[`${prefix} - Contenido Temático`] = "—";
          rowData[`${prefix} - Fines de Aprendizaje`] = "—";
          rowData[`${prefix} - Actividades de Aprendizaje`] = "—";
          extraAsigCols.forEach((extraCol) => {
            const label = extraCol.replace(/_/g, " ");
            rowData[`${prefix} - ${label}`] = "—";
          });
          rowData[`${prefix} - Embedding Asignatura`] = "—";
        }
      }

      return rowData;
    });

    const filename = `Match_Matriz_Docentes_Asignaturas_${new Date().toISOString().slice(0, 10)}`;
    if (format === "excel") {
      exportToExcel(rows, filename);
    } else {
      exportToCsv(rows, filename);
    }
  };

  // ── Exportación Detallada Par a Par (1 Fila por Match con Todas las Columnas de Docente y Asignatura) ──
  const handleExportDetailed = (format: "excel" | "csv") => {
    if (!matchResults.length) return;

    const extraAsigCols = getAsignaturaExtraColumns();
    const rows: Record<string, any>[] = [];

    matchResults.forEach((item) => {
      // Helper para extraer todas las columnas del docente
      const extractDocenteData = () => {
        const d: Record<string, any> = {};
        const handledDocenteKeys = new Set<string>();

        d["ID Profesor"] = item.profesor.id ?? "";
        d["Nombre Profesor"] = item.profesor.nombre_profesor ?? "";
        handledDocenteKeys.add("id");
        handledDocenteKeys.add("ID Profesor");
        handledDocenteKeys.add("nombre_profesor");
        handledDocenteKeys.add("Nombre Profesor");
        if (nameColumn) handledDocenteKeys.add(nameColumn);

        const allDocenteCols = new Set<string>();
        fileHeaders.forEach((h) => allDocenteCols.add(h));
        Object.keys(item.profesor).forEach((k) => allDocenteCols.add(k));

        allDocenteCols.forEach((col) => {
          if (
            handledDocenteKeys.has(col) ||
            col === "embedding_768" ||
            col === "vectors" ||
            col === "fieldEmbeddings"
          ) {
            return;
          }

          let val = item.profesor[col] ?? "";
          if (
            item.sanitizationStatus === "sanitized" &&
            typeof val === "string" &&
            regexFilterConfig?.enabled
          ) {
            const res = sanitizarCvParaModelo(val, regexFilterConfig, false);
            val = res.sanitizedText;
          }
          d[col] = val;
          handledDocenteKeys.add(col);
        });

        d["Embedding Profesor"] = formatEmbeddingForExport(item.embedding_768);
        return d;
      };

      const baseDocenteData = extractDocenteData();

      // Si el profesor no tuvo asignaturas sobre el umbral
      if (!item.matches.length) {
        const emptyRow: Record<string, any> = {
          ...baseDocenteData,
          "Rank Match": "—",
          "Similitud Compuesta": "Sin matches",
          "Tipo Match": "—",
          "Desglose Pares (Multi-Vector)": "—",
          "Desglose Criterios": "—",
          "ID Asignatura": "—",
          "Clave Asignatura": "—",
          "Nombre Asignatura": "—",
          "Cluster Asignatura": "—",
          "Contenido Temático": "—",
          "Fines de Aprendizaje": "—",
          "Actividades de Aprendizaje": "—",
        };
        extraAsigCols.forEach((c) => {
          emptyRow[`Asignatura - ${c.replace(/_/g, " ")}`] = "—";
        });
        emptyRow["Embedding Asignatura"] = "—";
        rows.push(emptyRow);
        return;
      }

      // 1 fila por cada match par a par con todas las columnas
      item.matches.forEach((m, idx) => {
        const rowData: Record<string, any> = {
          ...baseDocenteData,
          "Rank Match": `#${idx + 1}`,
          "Similitud Compuesta": `${(m.compositeSimilarity * 100).toFixed(1)}%`,
          "Tipo Match": m.match_nombre ? "Match Nombre (Exento de cupo)" : "Semántico",
        };

        if (m.pairSimilarities && Object.keys(m.pairSimilarities).length > 0) {
          const desglosePares = Object.entries(m.pairSimilarities)
            .map(([pairKey, score]) => {
              const pairCfg = distancePairs.find((p) => p.id === pairKey);
              const label = pairCfg?.label || pairKey;
              return `${label}: ${(score * 100).toFixed(0)}%`;
            })
            .join(" | ");
          rowData["Desglose Pares (Multi-Vector)"] = desglosePares;
        }

        const desglose = Object.entries(m.fieldSimilarities)
          .map(([field, score]) => `${field}: ${(score * 100).toFixed(0)}%`)
          .join(" | ");
        rowData["Desglose Criterios"] = desglose;

        // Todas las columnas de la asignatura
        rowData["ID Asignatura"] = m.asignaturaId ?? m.id ?? "";
        rowData["Clave Asignatura"] = m.clave ?? "";
        rowData["Nombre Asignatura"] = m.nombre ?? "";
        rowData["Cluster Asignatura"] = m.cluster || "Sin Cluster";
        rowData["Contenido Temático"] = m.contenido_tematico || "";
        rowData["Fines de Aprendizaje"] = m.fines_de_aprendizaje_o_formacion || "";
        rowData["Actividades de Aprendizaje"] = m.actividades_de_aprendizaje || "";

        // Columnas personalizadas / dinámicas
        extraAsigCols.forEach((extraCol) => {
          rowData[`Asignatura - ${extraCol.replace(/_/g, " ")}`] = m[extraCol] ?? "";
        });

        // Embeddings de la asignatura
        rowData["Embedding Asignatura"] = formatEmbeddingForExport(m.embedding_768);
        if (m.vectors && typeof m.vectors === "object") {
          Object.entries(m.vectors).forEach(([vCol, vVec]) => {
            rowData[`Vector Asignatura (${vCol})`] = formatEmbeddingForExport(vVec);
          });
        }

        rows.push(rowData);
      });
    });

    const filename = `Match_Detallado_Docente_Asignatura_${new Date().toISOString().slice(0, 10)}`;
    if (format === "excel") {
      exportToExcel(rows, filename);
    } else {
      exportToCsv(rows, filename);
    }
  };

  // Filtrar asignaturas en el modal/cajón de previsualización de Paso 1
  const filteredPreviewAsignaturas = useMemo(() => {
    if (!filterSearchTerm.trim()) return filteredAsignaturas;
    const q = filterSearchTerm.toLowerCase();
    return filteredAsignaturas.filter(
      (a) =>
        a.nombre.toLowerCase().includes(q) ||
        (a.clave && a.clave.toLowerCase().includes(q)) ||
        a.cleanClave.toLowerCase().includes(q)
    );
  }, [filteredAsignaturas, filterSearchTerm]);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── PASO 1: FILTRO PRELIMINAR DE ASIGNATURAS POR CLAVES ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-400 border border-cyan-500/20">
              <Filter className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-cyan-500/20 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-cyan-300">
                  Paso 1 &bull; Inicial
                </span>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Filtro Preliminar de Asignaturas (Claves)
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Sube un archivo <code className="text-cyan-300 font-mono">.xlsx</code> o <code className="text-cyan-300 font-mono">.csv</code> con las claves para restringir el universo de matching. La matriz de distancias solo se correrá en estas asignaturas.
              </p>
            </div>
          </div>

          {/* Badge de Estado del Filtro */}
          <div className="flex items-center gap-2">
            {!filterFile ? (
              <span className="rounded-xl border border-white/10 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                Sin filtro activo ({totalCatalogCount > 0 ? `${totalCatalogCount} en catálogo` : "Catálogo completo"})
              </span>
            ) : isFilterEffective ? (
              <div className="flex items-center gap-2">
                <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300 flex items-center gap-1.5 shadow-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  Filtro activo: {filteredAsignaturas.length} asignaturas
                </span>
                <button
                  type="button"
                  onClick={() => setIsFilterActive(!isFilterActive)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/10 transition"
                  title="Pausar o reactivar el filtro de claves"
                >
                  Pausar
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  Filtro pausado (Usando catálogo completo)
                </span>
                <button
                  type="button"
                  onClick={() => setIsFilterActive(true)}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 transition font-semibold"
                >
                  Reactivar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Zona Drag & Drop si no hay archivo de filtro */}
        {!filterFile ? (
          <div className="space-y-3">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFilterDrop}
              onClick={() => filterFileInputRef.current?.click()}
              className="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.01] p-8 text-center transition hover:border-cyan-500/50 hover:bg-cyan-500/[0.02] cursor-pointer"
            >
              <input
                ref={filterFileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFilterFileSelected(e.target.files[0]);
                }}
                className="hidden"
              />
              <div className="mb-3 rounded-2xl bg-cyan-500/10 p-3.5 text-cyan-400 border border-cyan-500/20 group-hover:scale-110 transition-transform">
                <FileSpreadsheet className="h-7 w-7" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Arrastra aquí el archivo con las claves de asignaturas o haz clic para examinar
              </h3>
              <p className="mt-1 text-xs text-slate-400 max-w-lg">
                Formatos compatibles: <code className="text-cyan-300 font-mono">.xlsx</code>, <code className="text-cyan-300 font-mono">.xls</code> o <code className="text-cyan-300 font-mono">.csv</code>.
              </p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-cyan-300/90 bg-cyan-950/50 border border-cyan-800/40 px-3.5 py-1.5 rounded-xl">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>
                  <strong>Limpieza preliminar automática:</strong> Se eliminan caracteres no alfa-numéricos (guiones, espacios, saltos de línea) y se pasa todo a mayúsculas para un match exacto con el catálogo.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-950/40 px-4 py-2.5 text-xs text-slate-400">
              <BookOpen className="h-4 w-4 text-cyan-400 shrink-0" />
              <span>
                <strong>Paso opcional:</strong> Si no cargas este filtro, el matching calculará distancias sobre todas las {totalCatalogCount > 0 ? `${totalCatalogCount} ` : ""}asignaturas del catálogo. Al cargar claves, la matriz de distancias solo se correrá en las asignaturas filtradas y solo se desplegarán esos matches.
              </span>
            </div>
          </div>
        ) : (
          /* Vista de Filtro Cargado */
          <div className="space-y-5">
            {/* Barra de Controles y Selector de Columna */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">
                    Columna con Claves:
                  </span>
                  <select
                    value={filterKeyColumn}
                    onChange={(e) => {
                      setFilterKeyColumn(e.target.value);
                      processFilterColumn(filterRows, e.target.value);
                    }}
                    className="rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-xs text-cyan-300 font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  >
                    {filterHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="text-xs text-slate-500 font-mono">
                  ({filterRows.length} filas en archivo)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => filterFileInputRef.current?.click()}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
                >
                  Cambiar archivo
                </button>
                <input
                  ref={filterFileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFilterFileSelected(e.target.files[0]);
                  }}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={handleClearFilter}
                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Quitar filtro</span>
                </button>
              </div>
            </div>

            {/* Alerta de Error si ocurre */}
            {filterError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{filterError}</span>
              </div>
            )}

            {/* Métricas del Filtro tras Limpieza Preliminar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1">
                  <Check className="h-3 w-3 text-cyan-400" />
                  Regla de Limpieza
                </span>
                <p className="text-xs font-mono font-bold text-cyan-300 mt-1">
                  Alfanumérico &bull; MAYÚS
                </p>
                <span className="text-[10px] text-slate-500">
                  Sin símbolos ni espacios
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Claves Únicas Limpias
                </span>
                <p className="text-xl font-bold font-mono text-white mt-1">
                  {uniqueCleanedClaves.length}
                </p>
                <span className="text-[10px] text-slate-500">
                  de {filterRows.length} filas
                </span>
              </div>

              <div className={`rounded-xl border p-3.5 ${
                filteredAsignaturas.length > 0
                  ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                  : "border-amber-500/30 bg-amber-500/[0.04]"
              }`}>
                <span className={`text-[10px] uppercase font-bold tracking-wider ${
                  filteredAsignaturas.length > 0 ? "text-emerald-400" : "text-amber-400"
                }`}>
                  Asignaturas en BD
                </span>
                <p className={`text-xl font-bold font-mono mt-1 ${
                  filteredAsignaturas.length > 0 ? "text-emerald-300" : "text-amber-300"
                }`}>
                  {isLoadingFilterMatches ? "Buscando..." : filteredAsignaturas.length}
                </p>
                <span className="text-[10px] text-slate-500">
                  {totalCatalogCount > 0 ? `de ${totalCatalogCount} en catálogo` : "coincidentes"}
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Claves No Halladas
                </span>
                <p className={`text-xl font-bold font-mono mt-1 ${
                  unmatchedClaves.length > 0 ? "text-amber-400" : "text-slate-400"
                }`}>
                  {isLoadingFilterMatches ? "..." : unmatchedClaves.length}
                </p>
                <span className="text-[10px] text-slate-500">
                  {unmatchedClaves.length > 0 ? "no existen en BD" : "todas encontradas"}
                </span>
              </div>
            </div>

            {/* Botón para Desplegar Previsualización de Asignaturas Filtradas */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsFilterPreviewOpen(!isFilterPreviewOpen);
                    setFilterPreviewTab("matched");
                  }}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    isFilterPreviewOpen && filterPreviewTab === "matched"
                      ? "bg-cyan-600 text-white"
                      : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {isFilterPreviewOpen && filterPreviewTab === "matched" ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  <span>Ver asignaturas filtradas ({filteredAsignaturas.length})</span>
                </button>

                {unmatchedClaves.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsFilterPreviewOpen(true);
                      setFilterPreviewTab("unmatched");
                    }}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      isFilterPreviewOpen && filterPreviewTab === "unmatched"
                        ? "bg-amber-600 text-white"
                        : "bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20"
                    }`}
                  >
                    <span>Ver claves no halladas ({unmatchedClaves.length})</span>
                  </button>
                )}
              </div>

              {isFilterEffective && (
                <span className="text-[11px] text-emerald-400 font-mono">
                  ✓ Matriz de distancias se correrá exclusivamente sobre estas {filteredAsignaturas.length} asignaturas
                </span>
              )}
            </div>

            {/* Cajón de Previsualización Expandible */}
            {isFilterPreviewOpen && (
              <div className="rounded-xl border border-white/10 bg-slate-950/80 p-4 space-y-3 animate-in fade-in duration-200">
                {filterPreviewTab === "matched" ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Buscar en asignaturas filtradas..."
                          value={filterSearchTerm}
                          onChange={(e) => setFilterSearchTerm(e.target.value)}
                          className="w-full rounded-lg border border-white/15 bg-slate-900 pl-8 pr-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>
                      <span className="text-xs text-slate-400">
                        Mostrando {filteredPreviewAsignaturas.length} de {filteredAsignaturas.length}
                      </span>
                    </div>

                    <div className="max-h-60 overflow-y-auto rounded-lg border border-white/10">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/10">
                          <tr>
                            <th className="px-3 py-2">#</th>
                            <th className="px-3 py-2 font-mono text-cyan-300">Clave Limpia</th>
                            <th className="px-3 py-2 text-slate-400">Clave Original BD</th>
                            <th className="px-3 py-2 font-bold text-white">Nombre de Asignatura</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-slate-300">
                          {filteredPreviewAsignaturas.slice(0, 100).map((asig, idx) => (
                            <tr key={asig.id} className="hover:bg-white/[0.02]">
                              <td className="px-3 py-1.5 font-mono text-slate-500 text-[11px]">
                                {idx + 1}
                              </td>
                              <td className="px-3 py-1.5 font-mono font-semibold text-cyan-300 text-[11px]">
                                {asig.cleanClave}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-400 text-[11px]">
                                {asig.clave || "—"}
                              </td>
                              <td className="px-3 py-1.5 font-medium text-white">
                                {asig.nombre}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">
                      Las siguientes claves existen en tu archivo pero no se encontraron en la base de datos de asignaturas:
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 rounded-lg bg-slate-900/60 border border-white/5">
                      {unmatchedClaves.map((key) => (
                        <span
                          key={key}
                          className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-mono text-amber-300"
                        >
                          {key}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PASO 2: CARGA DE PERFILES DOCENTES (PROFESORES) ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400 border border-indigo-500/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-indigo-300">
                  Paso 2
                </span>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Carga de Perfiles Docentes (Profesores)
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                Sube el archivo <code className="text-indigo-300">.xlsx</code> o <code className="text-indigo-300">.csv</code> con la información académica y laboral
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Selector de Modo de Procesamiento */}
            <div className="flex items-center rounded-xl border border-white/10 bg-slate-950 p-1 text-xs">
              <button
                type="button"
                onClick={() => setImportMode("generate")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition cursor-pointer ${
                  importMode === "generate"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Con Gemini 2</span>
              </button>
              <button
                type="button"
                onClick={() => setImportMode("only_match")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition cursor-pointer ${
                  importMode === "only_match"
                    ? "bg-cyan-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Cpu className="h-3.5 w-3.5" />
                <span>Solo Match (Con Embeddings)</span>
              </button>
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
                  className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Cambiar archivo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Banner Informativo cuando Solo Match está activo */}
        {importMode === "only_match" && (
          <div className="flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-xs text-cyan-200 animate-in fade-in">
            <Cpu className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-bold text-white text-xs">
                  Modo "Solo Match" Activo — Sin llamadas a la API de Gemini
                </h4>
                {validVectorStats && (
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold border ${
                      validVectorStats.percentage === 100
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    }`}
                  >
                    {validVectorStats.validCount} de {validVectorStats.totalCount} profesores con vectores listos ({validVectorStats.percentage}%)
                  </span>
                )}
              </div>
              <p className="text-cyan-200/90 leading-relaxed text-[11px]">
                Este modo utiliza los vectores de 768 dimensiones incluidos en tu archivo (ej. columnas exportadas previamente como <em>Embedding Profesor</em>). No se consumirá cuota de tokens ni se requiere conexión con Gemini.
              </p>
            </div>
          </div>
        )}

        {/* Banner de Control del Filtro Regex Anti-Sesgo cuando importMode === "generate" */}
        {importMode === "generate" && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-900/60 p-4 text-xs animate-in fade-in shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-500/20 p-2.5 text-indigo-300 border border-indigo-500/30">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-white text-xs">
                    Filtro Regex Anti-Sesgo Docente
                  </h4>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold border transition ${
                      regexFilterConfig.enabled
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-slate-700/50 text-slate-400 border-slate-600/40"
                    }`}
                  >
                    {regexFilterConfig.enabled ? "FILTRO ACTIVO" : "INACTIVO"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 max-w-xl">
                  {regexFilterConfig.enabled
                    ? "Preserva perfiles con credenciales oficiales en educación; enmascara términos detonantes de experiencia en perfiles no pedagógicos."
                    : "Desactivado: se generarán embeddings directamente sobre el texto original sin sanitización."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  handleUpdateRegexFilterConfig({
                    ...regexFilterConfig,
                    enabled: !regexFilterConfig.enabled,
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  regexFilterConfig.enabled ? "bg-indigo-600" : "bg-slate-700"
                }`}
                title={regexFilterConfig.enabled ? "Desactivar filtro regex" : "Activar filtro regex"}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    regexFilterConfig.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => setIsRegexModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 transition cursor-pointer"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>Configurar y Probar Regex</span>
              </button>
            </div>
          </div>
        )}

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

      {/* ── PASO 3: CONSTRUCTOR DINÁMICO DE QUERIES Y PONDERACIÓN ── */}
      {file && queryConfigs.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/10 p-2.5 text-purple-400 border border-purple-500/20">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-purple-500/20 border border-purple-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-purple-300">
                    Paso 3
                  </span>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Constructor Dinámico de Queries y Ponderación
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
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
                      {/* Vinculación de Columna de Vector (Solo Match) */}
                      {importMode === "only_match" && (
                        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-cyan-500/20 bg-cyan-500/[0.03] p-2.5 rounded-lg">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                              <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                              Columna del archivo con el vector (768d) para este campo:
                            </span>
                            <select
                              value={config.embeddingColumn || ""}
                              onChange={(e) => updateConfig(config.field, { embeddingColumn: e.target.value })}
                              className="rounded-lg border border-cyan-500/30 bg-slate-900 px-3 py-1 text-xs text-cyan-200 font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            >
                              <option value="">-- Seleccionar columna con vector --</option>
                              {fileHeaders.map((h) => (
                                <option key={h} value={h}>
                                  {h}
                                </option>
                              ))}
                            </select>
                          </div>
                          {config.embeddingColumn ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-300 font-mono">
                              <Check className="h-3 w-3" />
                              Columna vinculada: {config.embeddingColumn}
                            </span>
                          ) : (
                            <span className="text-[11px] text-amber-300 font-mono">
                              ⚠️ Selecciona la columna del archivo que contiene el embedding de este campo
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── SECCIÓN DE CONFIGURACIÓN DE PARES DE DISTANCIA (MULTI-VECTOR) ── */}
          <div className="rounded-xl border border-indigo-500/30 bg-slate-950/90 p-5 space-y-4 shadow-lg shadow-indigo-500/5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-indigo-300 flex items-center gap-1">
                    <GitCompare className="h-3 w-3" />
                    Multi-Vector &bull; Distancias
                  </span>
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    Configuración de Pares de Distancia (Profesor ⟷ Asignatura)
                  </h4>
                </div>
                <p className="text-xs text-slate-400">
                  Define qué columna vectorial de las asignaturas se comparará contra cada campo del docente. Puedes crear múltiples pares para ponderar diferentes dimensiones temáticas y pedagógicas.
                </p>
              </div>

              {/* Badges de columnas y pares */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-mono text-cyan-300 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" />
                  {availableAsigVectorCols.length} vect. asignatura
                </span>
                <span className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-mono text-indigo-300 flex items-center gap-1.5">
                  <Link2 className="h-3 w-3" />
                  {activePairs.length} pares activos
                </span>
              </div>
            </div>

            {/* Acciones Rápidas de Auto-vinculación */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
              <span className="text-xs text-slate-400">
                Pares vinculados actualmente ({distancePairs.length}):
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetPairsToOneToOne}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition cursor-pointer"
                  title="Crea una vinculación 1 a 1 entre cada campo docente activo y la columna vectorial primaria"
                >
                  <RotateCcw className="h-3 w-3 text-cyan-400" />
                  <span>Auto-vincular 1 a 1</span>
                </button>
                {availableAsigVectorCols.length > 1 && (
                  <button
                    type="button"
                    onClick={handleCrossAllPairs}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 text-[11px] font-medium text-indigo-300 transition cursor-pointer"
                    title="Crea todas las combinaciones posibles entre campos docentes activos y columnas de asignatura"
                  >
                    <Layers className="h-3 w-3 text-indigo-400" />
                    <span>Cruzar Todos (Matriz Completa)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Lista de Pares Configurados */}
            {distancePairs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-slate-900/40 p-4 text-center text-xs text-slate-400">
                No hay pares de distancia configurados. Pulsa en <strong className="text-cyan-300 font-semibold">Auto-vincular 1 a 1</strong> o agrega uno manualmente abajo.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {distancePairs.map((pair) => {
                  const isProfActive = activeFields.includes(pair.profField);
                  return (
                    <div
                      key={pair.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 transition ${
                        pair.active && isProfActive
                          ? "border-indigo-500/40 bg-slate-900/90"
                          : "border-white/5 bg-slate-950/40 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Toggle activo */}
                        <button
                          type="button"
                          onClick={() => handleTogglePairActive(pair.id)}
                          className={`p-1 rounded cursor-pointer transition ${
                            pair.active && isProfActive
                              ? "bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
                              : "bg-white/5 text-slate-500 hover:bg-white/10"
                          }`}
                          title={pair.active ? "Desactivar par" : "Activar par"}
                        >
                          <Check className={`h-3.5 w-3.5 ${pair.active && isProfActive ? "opacity-100" : "opacity-30"}`} />
                        </button>

                        {/* Campo Profesor ↔ Columna Asignatura */}
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-xs">
                          <span
                            className="rounded-md bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 font-semibold text-indigo-200 truncate max-w-[130px]"
                            title={pair.profField}
                          >
                            {pair.profField}
                          </span>
                          <ArrowRightLeft className="h-3 w-3 text-slate-400 shrink-0" />
                          <span
                            className="rounded-md bg-cyan-500/20 border border-cyan-500/30 px-2 py-0.5 font-mono font-semibold text-cyan-200 truncate max-w-[130px]"
                            title={pair.asigVectorCol}
                          >
                            {pair.asigVectorCol}
                          </span>
                        </div>
                      </div>

                      {/* Botón eliminar par */}
                      <button
                        type="button"
                        onClick={() => handleRemoveDistancePair(pair.id)}
                        className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer shrink-0"
                        title="Eliminar este par"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Agregar Nuevo Par Manual */}
            <div className="rounded-lg border border-white/10 bg-slate-900/60 p-3 space-y-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-indigo-400" />
                Vincular un nuevo par de distancia personalizado:
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {/* Selector Campo Docente */}
                <select
                  value={newPairProfField}
                  onChange={(e) => setNewPairProfField(e.target.value)}
                  className="flex-1 min-w-[150px] rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs text-indigo-300 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- Campo Profesor --</option>
                  {activeFields.map((f) => {
                    const cfg = queryConfigs.find((c) => c.field === f);
                    return (
                      <option key={f} value={f}>
                        {cfg?.label || f}
                      </option>
                    );
                  })}
                </select>

                <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400 shrink-0" />

                {/* Selector Columna Vector Asignatura */}
                <select
                  value={newPairAsigCol}
                  onChange={(e) => setNewPairAsigCol(e.target.value)}
                  className="flex-1 min-w-[150px] rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs text-cyan-300 font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">-- Vector Asignatura --</option>
                  {availableAsigVectorCols.map((col) => (
                    <option key={col} value={col}>
                      {col} {col === "embedding_768" ? "(Primario)" : ""}
                    </option>
                  ))}
                </select>

                {/* Botón Agregar */}
                <button
                  type="button"
                  onClick={handleAddDistancePair}
                  disabled={!newPairProfField || !newPairAsigCol}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 transition cursor-pointer shrink-0"
                >
                  + Vincular Par
                </button>
              </div>
            </div>
          </div>

          {/* ── SECCIÓN DE CONFIGURACIÓN DE CLUSTERS Y BETAS ── */}
          <div className="rounded-xl border border-cyan-500/30 bg-slate-950/90 p-5 space-y-5 shadow-lg shadow-cyan-500/5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-cyan-500/20 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-cyan-300 flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    Ponderación por Cluster
                  </span>
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    Configuración General de Cluster y Betas (&beta;)
                  </h4>
                </div>
                <p className="text-xs text-slate-400">
                  Introduce los coeficientes Beta (%) que ponderan cada par de distancia según el cluster al que pertenezca la asignatura.
                </p>
              </div>

              {/* Selector de Columna de Cluster */}
              <div className="flex items-center gap-2 bg-slate-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs">
                <span className="text-slate-400 font-medium">Columna de Cluster:</span>
                <select
                  value={clusterColumn}
                  onChange={(e) => setClusterColumn(e.target.value)}
                  className="rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1 text-xs text-cyan-300 font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {availableClusterColumns.map((col) => (
                    <option key={col} value={col}>
                      {col} {col === "cluster" ? "(Por defecto)" : ""}
                    </option>
                  ))}
                </select>
                {isLoadingClusters && <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />}
              </div>
            </div>

            {/* Pestañas de Clusters Detectados + Default */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Selecciona un cluster para ajustar sus coeficientes Beta:</span>
                <span className="font-mono text-[11px] text-cyan-300">
                  {allClustersList.length} clusters disponibles + 1 General
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Pestaña Fallback / General */}
                <button
                  type="button"
                  onClick={() => setSelectedClusterTab("__default__")}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold border transition cursor-pointer ${
                    selectedClusterTab === "__default__"
                      ? "border-cyan-400 bg-cyan-500/20 text-white shadow-md shadow-cyan-500/20 ring-1 ring-cyan-400"
                      : "border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <span>⚙️ General / Sin Cluster</span>
                  <span className="rounded bg-black/40 px-1.5 py-0.2 text-[10px] font-mono text-cyan-300">
                    Fallback
                  </span>
                </button>

                {/* Pestañas de clusters detectados */}
                {allClustersList.map((cName) => {
                  const isSelected = selectedClusterTab === cName;
                  return (
                    <button
                      key={cName}
                      type="button"
                      onClick={() => setSelectedClusterTab(cName)}
                      className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold border transition cursor-pointer ${
                        isSelected
                          ? "border-indigo-400 bg-indigo-500/25 text-white shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400"
                          : "border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <Tag className="h-3 w-3 text-indigo-400" />
                      <span>{cName}</span>
                    </button>
                  );
                })}

                {/* Input para agregar cluster manual */}
                <div className="flex items-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-slate-900/60 px-2 py-1">
                  <input
                    type="text"
                    placeholder="Nuevo cluster..."
                    value={newClusterName}
                    onChange={(e) => setNewClusterName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCustomCluster();
                      }
                    }}
                    className="w-28 bg-transparent px-1.5 py-0.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomCluster}
                    disabled={!newClusterName.trim()}
                    className="rounded-lg bg-indigo-600/50 hover:bg-indigo-600 p-1 text-white disabled:opacity-30 transition cursor-pointer"
                    title="Agregar cluster manualmente"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Editor de Betas para la Pestaña Activa */}
            {activePairs.length === 0 ? (
              <div className="rounded-lg border border-white/5 bg-slate-900/40 p-4 text-center text-xs text-slate-400">
                Activa al menos un par de distancia en la sección superior para configurar sus Betas (&beta;).
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      Coeficientes Beta (&beta;) por Par para:
                    </span>
                    <span className="rounded-md bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-xs font-mono font-bold text-indigo-300">
                      {selectedClusterTab === "__default__" ? "General / Sin Cluster" : selectedClusterTab}
                    </span>
                  </div>

                  {/* Métrica de Suma Total */}
                  {(() => {
                    const currentBetas = selectedClusterTab === "__default__" ? defaultBetas : clusterBetas[selectedClusterTab] || {};
                    const currentTotal = activePairs.reduce((acc, p) => acc + (currentBetas[p.id] ?? currentBetas[p.profField] ?? 0), 0);
                    const isHundred = currentTotal === 100;

                    return (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">Suma de Betas:</span>
                        <span className={`rounded-lg px-2.5 py-0.5 font-mono font-bold text-xs border ${
                          isHundred
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                        }`}>
                          {currentTotal}% {isHundred ? "✓" : "(Se normalizará a 100%)"}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Sliders de cada par para este cluster */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activePairs.map((pair) => {
                    const currentBetas = selectedClusterTab === "__default__" ? defaultBetas : clusterBetas[selectedClusterTab] || {};
                    const val = typeof currentBetas[pair.id] === "number"
                      ? currentBetas[pair.id]
                      : typeof currentBetas[pair.profField] === "number"
                      ? currentBetas[pair.profField]
                      : 0;

                    return (
                      <div key={pair.id} className="rounded-lg border border-white/5 bg-slate-950/60 p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-semibold text-white truncate" title={pair.label || pair.id}>
                              {pair.label || `${pair.profField} ↔ ${pair.asigVectorCol}`}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono truncate">
                              Profesor: <strong className="text-indigo-300">{pair.profField}</strong> ↔ Asignatura: <strong className="text-cyan-300">{pair.asigVectorCol}</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono shrink-0">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={val}
                              onChange={(e) => handleUpdateBeta(selectedClusterTab, pair.id, parseFloat(e.target.value) || 0)}
                              className="w-16 rounded-md border border-white/15 bg-slate-900 px-1.5 py-0.5 text-center text-xs font-bold text-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <span className="text-slate-400 text-xs">%</span>
                          </div>
                        </div>

                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={val}
                          onChange={(e) => handleUpdateBeta(selectedClusterTab, pair.id, parseFloat(e.target.value))}
                          className="w-full accent-cyan-500 cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Acciones Rápidas */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleNormalizeBetas(selectedClusterTab)}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer font-medium"
                      title="Ajusta proporcionalmente los valores para que sumen exactamente 100%"
                    >
                      <Equal className="h-3.5 w-3.5" />
                      <span>Auto-normalizar a 100%</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleEquiDistribute(selectedClusterTab)}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      title="Distribuye porcentajes iguales entre todos los pares activos"
                    >
                      <Sliders className="h-3.5 w-3.5" />
                      <span>Distribuir equitativamente</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyBetasToAll(selectedClusterTab)}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-indigo-300 hover:bg-indigo-500/20 transition cursor-pointer font-medium"
                    title="Aplica la configuración de betas de este cluster a todos los demás clusters"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copiar a todos los clusters</span>
                  </button>
                </div>
              </div>
            )}
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
                {isFilterEffective ? (
                  <span className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-mono text-emerald-300 flex items-center gap-1 font-semibold">
                    <span>⚡ Filtro activo: {filteredAsignaturas.length} asignaturas (de {totalCatalogCount})</span>
                  </span>
                ) : totalCatalogCount > 0 ? (
                  <span className="rounded-lg bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-[11px] font-mono text-indigo-300">
                    Total en catálogo: {totalCatalogCount} asignaturas
                  </span>
                ) : null}
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
                        max={effectiveCatalogCount > 0 ? effectiveCatalogCount : 500}
                        value={topK}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const maxLimit = effectiveCatalogCount > 0 ? effectiveCatalogCount : 500;
                          if (!isNaN(val)) {
                            setTopK(Math.min(maxLimit, Math.max(1, val)));
                          }
                        }}
                        className="w-16 rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-xs font-mono font-bold text-center text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-[11px] text-slate-400 font-mono">
                        / {effectiveCatalogCount > 0 ? effectiveCatalogCount : "máx"}
                      </span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="1"
                    max={effectiveCatalogCount > 0 ? effectiveCatalogCount : 50}
                    step="1"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />

                  {/* Botones de selección rápida para Top K */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {[1, 2, 3, 5, 10]
                      .filter((k) => effectiveCatalogCount === 0 || k <= effectiveCatalogCount)
                      .map((k) => (
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
                    {effectiveCatalogCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setTopK(effectiveCatalogCount)}
                        className={`rounded-lg px-2.5 py-0.5 text-[10px] font-mono transition ${
                          topK === effectiveCatalogCount
                            ? "bg-purple-600 text-white font-bold"
                            : "bg-purple-500/10 text-purple-300 border border-purple-500/30 hover:bg-purple-500/20"
                        }`}
                        title="Seleccionar todas las asignaturas disponibles en el conjunto activo"
                      >
                        Todas ({effectiveCatalogCount})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Botón de Ejecución Principal */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
            <div className="space-y-1 max-w-md">
              <p className="text-xs text-slate-400">
                {importMode === "only_match" ? (
                  <>
                    Utiliza los vectores de 768 dimensiones precalculados del archivo sin invocar a Gemini, aplicando los coeficientes Betas (&beta;) según el cluster de cada asignatura{" "}
                    {isFilterEffective && (
                      <strong className="text-emerald-300 font-semibold">
                        exclusivamente sobre las {filteredAsignaturas.length} asignaturas filtradas
                      </strong>
                    )}.
                  </>
                ) : isFilterEffective ? (
                  <>
                    Genera embeddings multimodales con Gemini 2 y corre la matriz de distancias{" "}
                    <strong className="text-emerald-300 font-semibold">
                      exclusivamente en las {filteredAsignaturas.length} asignaturas filtradas
                    </strong>.
                  </>
                ) : (
                  <>
                    Genera los embeddings multimodales con Gemini 2 para cada docente y consulta la función RPC <code className="font-mono text-indigo-300">match_asignaturas_cosine</code> en Supabase sobre el catálogo completo.
                  </>
                )}
              </p>
              {importMode === "generate" && (
                <div className="flex items-center gap-2 pt-0.5 text-[11px]">
                  <span className="text-slate-500">Filtro Regex:</span>
                  <button
                    type="button"
                    onClick={() => setIsRegexModalOpen(true)}
                    className={`inline-flex items-center gap-1 font-semibold underline cursor-pointer transition ${
                      regexFilterConfig.enabled ? "text-emerald-400 hover:text-emerald-300" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>{regexFilterConfig.enabled ? "Anti-Sesgo Activo" : "Inactivo"} (Editar)</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Opción 1: Solo Generar y Descargar Embeddings de Profesores (solo si importMode === 'generate') */}
              {importMode === "generate" && (
                <button
                  type="button"
                  disabled={isMatching || isEmbeddingOnly || totalActiveWeight === 0}
                  onClick={handleGenerateProfessorEmbeddingsOnly}
                  className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-5 py-3 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 transition cursor-pointer shadow-md shadow-cyan-500/10"
                  title="Genera exclusivamente los vectores de 768 dimensiones de los docentes y los descarga inmediatamente en Excel/CSV sin ejecutar matching"
                >
                  {isEmbeddingOnly ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-cyan-300" />
                      <span>Generando Embeddings ({embedOnlyProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Cpu className="h-4 w-4 text-cyan-400" />
                      <span>Solo Generar y Descargar Embeddings Docentes</span>
                    </>
                  )}
                </button>
              )}

              {/* Opción 2: Ejecutar Matching */}
              <button
                type="button"
                disabled={isMatching || isEmbeddingOnly || totalActiveWeight === 0}
                onClick={handleRunMatching}
                className={`flex items-center gap-2 rounded-xl px-6 py-3 text-xs font-bold text-white shadow-lg transition cursor-pointer disabled:opacity-50 ${
                  importMode === "only_match"
                    ? "bg-gradient-to-r from-cyan-600 via-indigo-600 to-cyan-600 shadow-cyan-600/30 hover:opacity-95"
                    : "bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-size-200 shadow-indigo-600/30 hover:opacity-95"
                }`}
              >
                {isMatching ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Calculando Matching ({matchProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>
                      {importMode === "only_match"
                        ? `Ejecutar Solo Matching (Embeddings Precalculados ${isFilterEffective ? `- ${filteredAsignaturas.length} Filtradas` : ""})`
                        : `Ejecutar Matching Inteligente ${isFilterEffective ? `(${filteredAsignaturas.length} Filtradas)` : "(Catálogo Completo)"}`}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Barra de Progreso de Solo Embeddings */}
          {isEmbeddingOnly && (
            <div className="space-y-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-medium text-cyan-200">
                <span className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-cyan-400 animate-pulse" />
                  <span>{embedOnlyStatusText}</span>
                </span>
                <span className="font-mono font-bold">{embedOnlyProgress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-900">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${embedOnlyProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Barra de Progreso de Matching */}
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

      {/* ── SECCIÓN DE RESULTADOS DE SOLO EMBEDDINGS DOCENTES ── */}
      {professorEmbeddingsList.length > 0 && (
        <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6 backdrop-blur-sm shadow-xl space-y-5 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase text-cyan-300 flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" />
                  Embeddings de Docentes Generados
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {professorEmbeddingsList.length} docentes procesados
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mt-1">
                Vectores Multimodales de 768 Dimensiones Listos
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Los embeddings de cada profesor han sido calculados con Gemini 2 mediante el RateLimitManager (3,000 RPM / 1M TPM) y descargados directamente en Excel/CSV.
              </p>
            </div>

            {/* Botones de Descarga */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportProfessorEmbeddings(professorEmbeddingsList, "excel")}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition shadow-sm cursor-pointer"
                title="Descargar archivo Excel con los vectores 768d de los profesores"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Descargar Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={() => exportProfessorEmbeddings(professorEmbeddingsList, "csv")}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                title="Descargar archivo CSV con los vectores 768d"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Descargar CSV</span>
              </button>
            </div>
          </div>

          {/* Tabla de Previsualización de Profesores y Vectores */}
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">#</th>
                  <th className="py-2.5 px-3 font-semibold">Nombre del Docente</th>
                  <th className="py-2.5 px-3 font-semibold">Filtro Anti-Sesgo</th>
                  <th className="py-2.5 px-3 font-semibold">Criterios Evaluados</th>
                  <th className="py-2.5 px-3 font-semibold">Vector Compuesto (768d)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {professorEmbeddingsList.slice(0, 10).map((item, idx) => {
                  const fields = Object.keys(item.fieldEmbeddings || {});
                  return (
                    <tr key={item.id} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 font-mono text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-3 font-semibold text-white">{item.nombre_profesor}</td>
                      <td className="py-2 px-3">
                        {item.sanitizationStatus === "intact" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
                            Credencial Verificada
                          </span>
                        ) : item.sanitizationStatus === "sanitized" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
                            Sesgo Mitigado
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-mono">Sin filtro</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {fields.map((f) => (
                            <span key={f} className="rounded bg-indigo-500/15 text-indigo-300 px-1.5 py-0.5 text-[10px] font-mono">
                              {f}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-cyan-300">
                        {item.embedding_768 ? `768 floats [${item.embedding_768.slice(0, 3).map(n => n.toFixed(3)).join(", ")}...]` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono">
                          <Check className="h-2.5 w-2.5" />
                          <span>Generado</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {professorEmbeddingsList.length > 10 && (
              <div className="p-2.5 text-center text-xs text-slate-400 bg-slate-900/50 border-t border-white/5">
                Mostrando 10 de {professorEmbeddingsList.length} profesores. Descarga el archivo completo en Excel o CSV para ver todos los vectores.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PASO 4: RESULTADOS DEL MATCHING Y EXPORTACIÓN ── */}
      {matchResults.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
          {/* Header de Resultados y KPIs */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-indigo-300">
                  Paso 4 &bull; Resultados
                </span>
                <Award className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white tracking-tight">
                  Resultados del Matching de Profesores
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                <span>
                  {matchResults.length} docentes evaluados &bull;{" "}
                  <span className="text-indigo-300 font-semibold">
                    {filterMode === "threshold"
                      ? `Modo Umbral: similitud ≥ ${(threshold * 100).toFixed(0)}%`
                      : filterMode === "topK"
                      ? `Modo Top K: ${topK} asignaturas`
                      : `Modo Combinado: hasta ${topK} con similitud ≥ ${(threshold * 100).toFixed(0)}%`}
                  </span>
                </span>
                {isFilterEffective && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-300 font-semibold">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Filtrado a {filteredAsignaturas.length} asignaturas
                  </span>
                )}
              </p>
            </div>

            {/* Botones de Exportación: Matriz y Detalle Par a Par con todas las columnas */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-0.5 shadow-sm">
                <span className="px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  Matriz (1 fila/docente):
                </span>
                <button
                  type="button"
                  onClick={() => handleExport("excel")}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600/30 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600/50 transition cursor-pointer"
                  title="Descargar matriz con todas las columnas de docente y asignaturas (.xlsx)"
                >
                  <Download className="h-3 w-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-200 hover:text-white transition cursor-pointer"
                  title="Descargar matriz con todas las columnas de docente y asignaturas (.csv)"
                >
                  <FileText className="h-3 w-3" />
                  <span>CSV</span>
                </button>
              </div>

              <div className="flex items-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-0.5 shadow-sm">
                <span className="px-2.5 py-1 text-[11px] font-semibold text-indigo-300">
                  Detalle Par a Par:
                </span>
                <button
                  type="button"
                  onClick={() => handleExportDetailed("excel")}
                  className="flex items-center gap-1 rounded-lg bg-indigo-600/40 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-600/60 transition cursor-pointer"
                  title="Descargar listado relacional con cada columna de docente y asignatura una al lado de la otra (.xlsx)"
                >
                  <Download className="h-3 w-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportDetailed("csv")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-200 hover:text-white transition cursor-pointer"
                  title="Descargar listado relacional con cada columna de docente y asignatura una al lado de la otra (.csv)"
                >
                  <FileText className="h-3 w-3" />
                  <span>CSV</span>
                </button>
              </div>
            </div>
          </div>

          {/* Banner de Embeddings Descargables & Rate Limiter Gemini 2 */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-xs flex flex-wrap items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-2.5 text-slate-300">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <span className="font-semibold text-white">Embeddings 768d incluidos en la descarga:</span>{" "}
                <span className="text-slate-400">
                  Los archivos XLSX y CSV exportan el vector de cada profesor y el vector de cada asignatura asignada.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-white/10 text-[11px] text-slate-300 font-mono">
              <Cpu className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span>
                Rate Limiter: <strong className="text-cyan-300">3,000 RPM</strong> | <strong className="text-indigo-300">1,000,000 TPM</strong>
              </span>
              {rateLimiterStats && (
                <span className="ml-1 text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  Activo
                </span>
              )}
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
                            {result.sanitizationStatus === "intact" && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                title="Cuenta con credencial formal en educación/pedagogía comprobada"
                              >
                                Credencial Verificada
                              </span>
                            )}
                            {result.sanitizationStatus === "sanitized" && (
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                title="Sesgo de experiencia neutralizado para evaluación objetiva"
                              >
                                Sesgo Mitigado
                              </span>
                            )}
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
                        {result.embedding_768 && (
                          <span
                            className="hidden sm:inline-flex items-center gap-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300 font-mono"
                            title="Vector multimodal 768d generado y disponible para descarga"
                          >
                            <Cpu className="h-2.5 w-2.5" />
                            <span>Emb 768d</span>
                          </span>
                        )}

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

                          {/* Otros campos del docente si existen y no fueron usados en matching */}
                          {(() => {
                            const excludeProfKeys = new Set([
                              "id",
                              "nombre_profesor",
                              "embedding_768",
                              "vectors",
                              "fieldEmbeddings",
                              nameColumn,
                              ...queryConfigs.filter((c) => c.active).map((c) => c.field),
                            ]);
                            const otherKeys = Array.from(
                              new Set([...fileHeaders, ...Object.keys(result.profesor)])
                            ).filter((k) => !excludeProfKeys.has(k) && result.profesor[k]);

                            if (otherKeys.length === 0) return null;

                            return (
                              <details className="text-xs group pt-1">
                                <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-200 transition select-none flex items-center gap-1">
                                  <span className="underline">Ver otros datos del docente</span>
                                  <span className="text-[10px] text-slate-500">
                                    ({otherKeys.length} campos adicionales)
                                  </span>
                                </summary>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-2 bg-slate-950/40 p-3 rounded-xl border border-white/5">
                                  {otherKeys.map((k) => (
                                    <div key={k} className="text-xs space-y-0.5">
                                      <span className="text-[10px] uppercase font-bold text-slate-400">{k}:</span>
                                      <div className="text-slate-300 whitespace-pre-wrap break-words">
                                        {String(result.profesor[k])}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            );
                          })()}
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
                                      {matchItem.cluster && (
                                        <span
                                          className="rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-mono text-cyan-200 flex items-center gap-1 font-semibold"
                                          title={`Cluster de la asignatura: ${matchItem.cluster}`}
                                        >
                                          <Tag className="h-2.5 w-2.5 text-cyan-400" />
                                          <span>{matchItem.cluster}</span>
                                        </span>
                                      )}
                                      {matchItem.match_nombre && (
                                        <span className="rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                                          <span>🎯 Match Nombre</span>
                                          <span className="text-[9px] text-purple-200/80 font-normal">(Exento de cupo Top K)</span>
                                        </span>
                                      )}
                                      {matchItem.vectors && Object.keys(matchItem.vectors).length > 1 ? (
                                        <span
                                          className="hidden sm:inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] text-cyan-200 font-mono font-semibold"
                                          title={`Vectores disponibles: ${Object.keys(matchItem.vectors).join(", ")}`}
                                        >
                                          <Cpu className="h-2.5 w-2.5 text-cyan-400" />
                                          <span>{Object.keys(matchItem.vectors).length} Vectores</span>
                                        </span>
                                      ) : matchItem.embedding_768 ? (
                                        <span
                                          className="hidden sm:inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300 font-mono"
                                          title="Vector 768d disponible y descargable"
                                        >
                                          Vector 768d
                                        </span>
                                      ) : null}
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

                                  {/* Desglose por Pares de Distancia Multi-Vector o Criterios */}
                                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
                                    <span className="text-[10px] text-slate-400">
                                      {matchItem.pairSimilarities && Object.keys(matchItem.pairSimilarities).length > 0
                                        ? "Pares de Distancia:"
                                        : "Desglose:"}
                                    </span>
                                    {matchItem.pairSimilarities && Object.keys(matchItem.pairSimilarities).length > 0
                                      ? Object.entries(matchItem.pairSimilarities).map(([pairKey, score]) => {
                                          const pairCfg = distancePairs.find((p) => p.id === pairKey);
                                          const label = pairCfg?.label || pairKey;
                                          return (
                                            <span
                                              key={pairKey}
                                              className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 border border-indigo-500/25 px-2 py-0.5 text-[10px] text-slate-300"
                                              title={`Par: ${pairKey}`}
                                            >
                                              <span className="text-indigo-300 font-medium">{label}:</span>
                                              <strong className="text-cyan-300 font-mono">
                                                {(score * 100).toFixed(1)}%
                                              </strong>
                                            </span>
                                          );
                                        })
                                      : Object.entries(matchItem.fieldSimilarities).map(([field, score]) => (
                                          <span
                                            key={field}
                                            className="inline-flex items-center gap-1 rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-slate-300"
                                          >
                                            <span className="text-slate-400">{field}:</span>
                                            <strong className="text-indigo-300 font-mono">
                                              {(score * 100).toFixed(1)}%
                                            </strong>
                                          </span>
                                        ))}
                                  </div>

                                  {/* Columnas y Contenido de la Asignatura */}
                                  <div className="space-y-1.5 pt-1">
                                    {matchItem.contenido_tematico && (
                                      <div className="text-[11px] text-slate-300 bg-white/[0.02] p-2.5 rounded-lg border border-white/5 whitespace-pre-wrap break-words leading-relaxed max-h-60 overflow-y-auto">
                                        <span className="font-semibold text-slate-200">Temario: </span>
                                        {matchItem.contenido_tematico}
                                      </div>
                                    )}

                                    {matchItem.fines_de_aprendizaje_o_formacion && (
                                      <div className="text-[11px] text-slate-300 bg-white/[0.02] p-2.5 rounded-lg border border-white/5 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
                                        <span className="font-semibold text-indigo-300">Fines / Objetivos de Aprendizaje: </span>
                                        {matchItem.fines_de_aprendizaje_o_formacion}
                                      </div>
                                    )}

                                    {matchItem.actividades_de_aprendizaje && (
                                      <div className="text-[11px] text-slate-300 bg-white/[0.02] p-2.5 rounded-lg border border-white/5 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
                                        <span className="font-semibold text-purple-300">Actividades de Aprendizaje: </span>
                                        {matchItem.actividades_de_aprendizaje}
                                      </div>
                                    )}

                                    {/* Columnas adicionales / dinámicas de la asignatura */}
                                    {(() => {
                                      const excludeKeys = new Set([
                                        "id",
                                        "asignaturaId",
                                        "clave",
                                        "nombre",
                                        "cluster",
                                        "contenido_tematico",
                                        "fines_de_aprendizaje_o_formacion",
                                        "actividades_de_aprendizaje",
                                        "match_nombre",
                                        "match_semantico",
                                        "dot_product_match",
                                        "embedding_768",
                                        "vectors",
                                        "compositeSimilarity",
                                        "fieldSimilarities",
                                        "pairSimilarities",
                                        "created_at",
                                      ]);
                                      const customEntries = Object.entries(matchItem).filter(
                                        ([k, v]) =>
                                          !excludeKeys.has(k) &&
                                          !k.startsWith("vector_") &&
                                          !k.startsWith("embedding_") &&
                                          v !== null &&
                                          v !== undefined &&
                                          String(v).trim() !== ""
                                      );
                                      if (customEntries.length === 0) return null;

                                      return (
                                        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                                          <span className="text-[10px] uppercase font-bold text-slate-400">
                                            Campos adicionales:
                                          </span>
                                          {customEntries.map(([k, v]) => (
                                            <span
                                              key={k}
                                              className="inline-flex items-center gap-1 rounded bg-slate-900 border border-white/10 px-2 py-0.5 text-[10px] text-slate-300"
                                            >
                                              <span className="text-slate-400 capitalize">
                                                {k.replace(/_/g, " ")}:
                                              </span>
                                              <strong className="text-white">{String(v)}</strong>
                                            </span>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
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

      {/* Modal de Configuración y Prueba del Filtro Regex Anti-Sesgo */}
      <RegexFilterModal
        isOpen={isRegexModalOpen}
        onClose={() => setIsRegexModalOpen(false)}
        config={regexFilterConfig}
        onChangeConfig={handleUpdateRegexFilterConfig}
        profesores={fileRows.map((r, i) => ({
          id: i + 1,
          nombre_profesor: (nameColumn ? r[nameColumn] : "") || `Profesor ${i + 1}`,
          ...r,
        }))}
      />
    </div>
  );
}
