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
  SlidersHorizontal,
  Table,
  Database,
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

// ── Helpers para Detección Inteligente de Columnas del Docente ──
const normalizeHeader = (s: string): string =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const cleanHeaderToken = (s: string): string =>
  normalizeHeader(s).replace(/[^a-z0-9]/g, "");

const isIdHeader = (h: string): boolean => {
  if (!h) return false;
  const n = normalizeHeader(h).trim();
  const c = cleanHeaderToken(h);

  if (["id", "cve", "clave", "codigo", "matricula", "expediente", "nomina", "rfc", "curp"].includes(c)) {
    return true;
  }
  if (
    c.startsWith("idprofesor") ||
    c.startsWith("iddocente") ||
    c.startsWith("idmaestro") ||
    c.startsWith("idempleado") ||
    c.startsWith("idpersona") ||
    c.endsWith("idprofesor") ||
    c.endsWith("iddocente") ||
    c === "id"
  ) {
    return true;
  }
  if (/^id[\s_.:-]/i.test(n) || /[\s_.:-]id$/i.test(n) || /\bid\b/i.test(n)) {
    return true;
  }
  if (
    n.includes("identificador") ||
    n.includes("matricula") ||
    n.includes("codigo profesor") ||
    n.includes("codigo docente") ||
    n.includes("clave profesor") ||
    n.includes("clave docente") ||
    n.includes("num empleado") ||
    n.includes("numero empleado") ||
    n.includes("num_empleado") ||
    n.includes("nomina")
  ) {
    return true;
  }
  return false;
};

const isVectorHeader = (h: string): boolean => {
  if (!h) return false;
  const n = normalizeHeader(h);
  return n.includes("embedding") || n.includes("vector");
};

const isNameHeader = (h: string): boolean => {
  if (!h) return false;
  if (isIdHeader(h) || isVectorHeader(h)) return false;
  const n = normalizeHeader(h);
  if (
    n.includes("correo") ||
    n.includes("email") ||
    n.includes("telefono") ||
    n.includes("perfil") ||
    n.includes("trayectoria") ||
    n.includes("experiencia") ||
    n.includes("cv") ||
    n.includes("antiguedad") ||
    n.includes("departamento") ||
    n.includes("campus") ||
    n.includes("facultad") ||
    n.includes("escuela") ||
    n.includes("categoria") ||
    n.includes("puesto")
  ) {
    return false;
  }
  return (
    n.includes("nombre") ||
    n.includes("docente") ||
    n.includes("profesor") ||
    n.includes("maestro") ||
    n.includes("catedratico") ||
    n.includes("persona")
  );
};

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
  const [isSyncingWithDb, setIsSyncingWithDb] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

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
  // Columna que identifica el ID del profesor (opcional, autogenerado si no existe)
  const [idColumn, setIdColumn] = useState<string>("");

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

  // ── Selección Personalizada de Columnas para Exportación de Matches ──
  const [isExportConfigOpen, setIsExportConfigOpen] = useState(false);
  const [selectedDocenteCols, setSelectedDocenteCols] = useState<Record<string, boolean>>({});
  const [selectedAsigCols, setSelectedAsigCols] = useState<Record<string, boolean>>({});
  const [selectedMetricCols, setSelectedMetricCols] = useState<Record<string, boolean>>({
    rank: true,
    similitud_compuesta: true,
    tipo_match: true,
    desglose_pares: true,
    desglose_criterios: true,
    asignaturas_asignadas: true,
  });
  const [exportColSearchTerm, setExportColSearchTerm] = useState("");
  const [exportPreviewLayout, setExportPreviewLayout] = useState<"matriz" | "detailed">("matriz");

  // Cargar preferencias guardadas de columnas para exportación al iniciar
  useEffect(() => {
    try {
      const savedDoc = localStorage.getItem("pradem_export_doc_cols");
      if (savedDoc) setSelectedDocenteCols(JSON.parse(savedDoc));
      const savedAsig = localStorage.getItem("pradem_export_asig_cols");
      if (savedAsig) setSelectedAsigCols(JSON.parse(savedAsig));
      const savedMet = localStorage.getItem("pradem_export_metric_cols");
      if (savedMet) setSelectedMetricCols((prev) => ({ ...prev, ...JSON.parse(savedMet) }));
    } catch (e) {
      console.warn("Error al cargar configuración de columnas de exportación:", e);
    }
  }, []);

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

  // ── Cargar Clusters y Metadatos Disponibles desde Supabase o Filtro ──
  const loadAvailableClusters = useCallback(async (colName: string) => {
    setIsLoadingClusters(true);
    try {
      // Siempre consultar las columnas disponibles, clusters de catálogo y el total de asignaturas desde Supabase
      const data = await apiFetch<{
        success: boolean;
        availableColumns: string[];
        clusters: string[];
        availableVectorColumns?: string[];
        totalCatalogCount?: number;
      }>(`/api/asignaturas/clusters?column=${encodeURIComponent(colName)}`);

      if (data.success) {
        if (Array.isArray(data.availableColumns) && data.availableColumns.length > 0) {
          setAvailableClusterColumns(data.availableColumns);
        }
        if (typeof data.totalCatalogCount === "number" && data.totalCatalogCount > 0) {
          setTotalCatalogCount(data.totalCatalogCount);
        }
        if (Array.isArray(data.availableVectorColumns) && data.availableVectorColumns.length > 0) {
          setAvailableAsigVectorCols(data.availableVectorColumns);
        }

        if (isFilterActive && filteredAsignaturas.length > 0) {
          // Extraer de las asignaturas filtradas para colName
          const clustersSet = new Set<string>();
          filteredAsignaturas.forEach((a) => {
            const val = (a as any)[colName] || a.cluster;
            if (val && String(val).trim()) {
              clustersSet.add(String(val).trim());
            }
          });
          setDetectedClusters(Array.from(clustersSet).sort());
        } else {
          // Catálogo completo directo de Supabase
          if (Array.isArray(data.clusters)) {
            setDetectedClusters(data.clusters);
          }
        }
        setLastSyncTime(new Date());
      }
    } catch (err) {
      console.warn("No se pudieron cargar clusters de Supabase:", err);
    } finally {
      setIsLoadingClusters(false);
    }
  }, [isFilterActive, filteredAsignaturas]);

  // ── Sincronizar Asignaturas y Clusters Actualizados directamente de Supabase ──
  const syncCatalogAndClusters = useCallback(
    async (overrideClusterCol?: string) => {
      setIsSyncingWithDb(true);
      const colToUse = overrideClusterCol || clusterColumn;
      try {
        let currentFiltered = filteredAsignaturas;

        // 1. Si hay archivo de filtro activo y columna de claves definida, re-filtrar contra Supabase para traer datos actualizados
        if (filterRows.length > 0 && filterKeyColumn) {
          setIsLoadingFilterMatches(true);
          const cleaned = filterRows
            .map((r) => cleanClave(r[filterKeyColumn]))
            .filter((k) => k.length > 0);
          const unique = Array.from(new Set(cleaned));
          setUniqueCleanedClaves(unique);

          if (unique.length > 0) {
            const res = await apiFetch<FilterClavesResponse>("/api/asignaturas/filter-claves", {
              method: "POST",
              body: JSON.stringify({ claves: unique, clusterColumn: colToUse }),
            });

            if (res.success) {
              currentFiltered = res.matchedAsignaturas || [];
              setFilteredAsignaturas(currentFiltered);
              setUnmatchedClaves(res.unmatchedClaves || []);
              setIsFilterActive(true);

              if (typeof res.totalCatalogCount === "number" && res.totalCatalogCount > 0) {
                setTotalCatalogCount(res.totalCatalogCount);
              }
              if (Array.isArray(res.availableColumns) && res.availableColumns.length > 0) {
                setAvailableClusterColumns(res.availableColumns);
              }
              if (Array.isArray(res.availableVectorColumns) && res.availableVectorColumns.length > 0) {
                setAvailableAsigVectorCols(res.availableVectorColumns);
              }
            }
          }
          setIsLoadingFilterMatches(false);
        }

        // 2. Consultar clusters y metadatos actualizados de Supabase
        const clusterRes = await apiFetch<{
          success: boolean;
          availableColumns: string[];
          clusters: string[];
          availableVectorColumns?: string[];
          totalCatalogCount?: number;
        }>(`/api/asignaturas/clusters?column=${encodeURIComponent(colToUse)}`);

        if (clusterRes.success) {
          if (Array.isArray(clusterRes.availableColumns) && clusterRes.availableColumns.length > 0) {
            setAvailableClusterColumns(clusterRes.availableColumns);
          }
          if (typeof clusterRes.totalCatalogCount === "number" && clusterRes.totalCatalogCount > 0) {
            setTotalCatalogCount(clusterRes.totalCatalogCount);
          }
          if (Array.isArray(clusterRes.availableVectorColumns) && clusterRes.availableVectorColumns.length > 0) {
            setAvailableAsigVectorCols(clusterRes.availableVectorColumns);
          }

          if (isFilterActive && currentFiltered.length > 0) {
            const clustersSet = new Set<string>();
            currentFiltered.forEach((a) => {
              const val = (a as any)[colToUse] || a.cluster;
              if (val && String(val).trim()) clustersSet.add(String(val).trim());
            });
            setDetectedClusters(Array.from(clustersSet).sort());
          } else if (Array.isArray(clusterRes.clusters)) {
            setDetectedClusters(clusterRes.clusters);
          }
        }

        setLastSyncTime(new Date());
        const count = isFilterActive && currentFiltered.length > 0 ? currentFiltered.length : (clusterRes.totalCatalogCount || totalCatalogCount);
        setSyncNotice(`Catálogo sincronizado con Supabase (${count} asignaturas activas).`);
        setTimeout(() => setSyncNotice(null), 4000);
      } catch (err: any) {
        console.warn("Error al sincronizar con Supabase:", err);
      } finally {
        setIsSyncingWithDb(false);
        setIsLoadingFilterMatches(false);
      }
    },
    [clusterColumn, filterRows, filterKeyColumn, filteredAsignaturas, isFilterActive, totalCatalogCount]
  );

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

  // ── Procesamiento de Filtro de Claves (Limpieza Preliminar + Consulta a Supabase) ──
  const processFilterColumn = async (
    rows: Record<string, string>[],
    colName: string,
    targetClusterCol?: string
  ) => {
    if (!rows.length || !colName) {
      setFilteredAsignaturas([]);
      setUnmatchedClaves([]);
      setUniqueCleanedClaves([]);
      return;
    }

    setFilterError(null);
    setIsLoadingFilterMatches(true);
    const clusterColToQuery = targetClusterCol || clusterColumn;

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

      // Consultar endpoint para validar y traer datos actualizados contra catálogo de asignaturas en Supabase
      const res = await apiFetch<FilterClavesResponse>("/api/asignaturas/filter-claves", {
        method: "POST",
        body: JSON.stringify({ claves: unique, clusterColumn: clusterColToQuery }),
      });

      if (res.success) {
        const matched = res.matchedAsignaturas || [];
        setFilteredAsignaturas(matched);
        setUnmatchedClaves(res.unmatchedClaves || []);
        setIsFilterActive(true);

        if (typeof res.totalCatalogCount === "number" && res.totalCatalogCount > 0) {
          setTotalCatalogCount(res.totalCatalogCount);
        }
        if (Array.isArray(res.availableColumns) && res.availableColumns.length > 0) {
          setAvailableClusterColumns(res.availableColumns);
        }

        const vectorColsSet = new Set<string>(["embedding_768"]);
        matched.forEach((a) => {
          if (Array.isArray(a.vectorColumns)) {
            a.vectorColumns.forEach((c) => vectorColsSet.add(c));
          }
          if (a.vectors && typeof a.vectors === "object") {
            Object.keys(a.vectors).forEach((k) => vectorColsSet.add(k));
          }
        });
        if (Array.isArray(res.availableVectorColumns)) {
          res.availableVectorColumns.forEach((c) => vectorColsSet.add(c));
        }
        setAvailableAsigVectorCols(Array.from(vectorColsSet));

        // Actualizar clusters detectados a partir de las asignaturas filtradas recién obtenidas de Supabase
        const clustersSet = new Set<string>();
        matched.forEach((a) => {
          const val = (a as any)[clusterColToQuery] || a.cluster;
          if (val && String(val).trim()) {
            clustersSet.add(String(val).trim());
          }
        });
        setDetectedClusters(Array.from(clustersSet).sort());
        setLastSyncTime(new Date());
        setSyncNotice(`Filtro sincronizado con Supabase: ${matched.length} asignaturas encontradas.`);
        setTimeout(() => setSyncNotice(null), 4000);
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
      // ¡IMPORTANTE! Consultar y traer las asignaturas actualizadas de Supabase
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
    // Al limpiar filtro, recargar clusters completos desde Supabase
    loadAvailableClusters(clusterColumn);
  };

  // ── Inicializar Configuraciones de Query al Cargar Archivo ──
  const setupQueryConfigs = (headers: string[], detectedNameCol: string, detectedIdCol?: string) => {
    const configs: QueryConfig[] = [];

    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    headers.forEach((header) => {
      if (header === detectedNameCol) return;
      if (detectedIdCol && header === detectedIdCol) return;
      if (isIdHeader(header)) return;

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
      const cleanH = cleanHeaderToken(header);
      const matchingEmbCol =
        headers.find((h) => {
          const ch = cleanHeaderToken(h);
          return (
            ch === `embeddingprofesor${cleanH}` ||
            ch === `embedding${cleanH}` ||
            ch === `vector${cleanH}` ||
            ch === `${cleanH}embedding` ||
            ch === `${cleanH}vector`
          );
        }) ||
        headers.find((h) => {
          const ch = cleanHeaderToken(h);
          return ch === "embeddingprofesor" || ch === "embedding768" || ch === "vector";
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

      // Detectar columna de ID
      const detectedId = headers.find((h) => isIdHeader(h)) || "";
      setIdColumn(detectedId);

      // Detectar columna de nombre (prioridad 1: contiene 'nombre', prioridad 2: otros nombres sin id)
      const detectedName =
        headers.find((h) => !isIdHeader(h) && !isVectorHeader(h) && normalizeHeader(h).includes("nombre")) ||
        headers.find((h) => isNameHeader(h)) ||
        headers.find((h) => !isIdHeader(h) && !isVectorHeader(h)) ||
        headers[0] ||
        "";

      setNameColumn(detectedName);
      setupQueryConfigs(headers, detectedName, detectedId);

      // ¡IMPORTANTE! Al iniciar el proceso subiendo profesores, sincronizar y traer las asignaturas más recientes de Supabase
      await syncCatalogAndClusters();
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
        // 1. Resolver ID del profesor sin alterarlo si existe en el archivo
        let actualId: string | number | undefined = undefined;
        if (idColumn && row[idColumn] !== undefined && row[idColumn] !== null && String(row[idColumn]).trim() !== "") {
          actualId = row[idColumn];
        } else if (row["ID Profesor"] !== undefined && row["ID Profesor"] !== null && String(row["ID Profesor"]).trim() !== "") {
          actualId = row["ID Profesor"];
        } else if (row["id"] !== undefined && row["id"] !== null && String(row["id"]).trim() !== "") {
          actualId = row["id"];
        } else if (row["ID"] !== undefined && row["ID"] !== null && String(row["ID"]).trim() !== "") {
          actualId = row["ID"];
        } else {
          const foundIdKey = Object.keys(row).find(
            (k) => isIdHeader(k) && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== ""
          );
          if (foundIdKey) {
            actualId = row[foundIdKey];
          }
        }
        // Si no se encontró ningún ID en el archivo, SOLO ENTONCES generarlo
        if (actualId === undefined || actualId === null || String(actualId).trim() === "") {
          actualId = idx + 1;
        }

        // 2. Resolver Nombre del profesor
        let actualName = "";
        if (nameColumn && row[nameColumn] !== undefined && row[nameColumn] !== null && String(row[nameColumn]).trim() !== "") {
          actualName = String(row[nameColumn]).trim();
        } else if (row["Nombre Profesor"] !== undefined && row["Nombre Profesor"] !== null && String(row["Nombre Profesor"]).trim() !== "") {
          actualName = String(row["Nombre Profesor"]).trim();
        } else if (row["nombre_profesor"] !== undefined && row["nombre_profesor"] !== null && String(row["nombre_profesor"]).trim() !== "") {
          actualName = String(row["nombre_profesor"]).trim();
        } else {
          const foundNameKey = Object.keys(row).find(
            (k) => isNameHeader(k) && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== ""
          );
          if (foundNameKey) {
            actualName = String(row[foundNameKey]).trim();
          }
        }
        if (!actualName) {
          actualName = `Profesor ${actualId}`;
        }

        const prof: Profesor = {
          ...row, // Preservar todos los campos del archivo del usuario sin alterar ninguno
          id: actualId,
          nombre_profesor: actualName,
        };

        // Si el archivo tenía columnas explícitas "ID Profesor" o "Nombre Profesor", asegurarnos de que mantengan sus valores originales
        if (row["ID Profesor"] !== undefined) {
          prof["ID Profesor"] = row["ID Profesor"];
        } else if (idColumn && row[idColumn] !== undefined) {
          prof["ID Profesor"] = row[idColumn];
        }
        if (row["Nombre Profesor"] !== undefined) {
          prof["Nombre Profesor"] = row["Nombre Profesor"];
        } else if (nameColumn && row[nameColumn] !== undefined) {
          prof["Nombre Profesor"] = row[nameColumn];
        }

        if (importMode === "only_match") {
          const fieldEmbeddings: Record<string, number[]> = {};
          for (const config of activeConfigs) {
            let vec: number[] | null = null;
            // 1. Probar columna configurada
            if (config.embeddingColumn && row[config.embeddingColumn]) {
              vec = parseEmbeddingValue(row[config.embeddingColumn]);
            }
            // 2. Probar formato estándar "Embedding Profesor (Campo)"
            if (!vec && row[`Embedding Profesor (${config.field})`]) {
              vec = parseEmbeddingValue(row[`Embedding Profesor (${config.field})`]);
            }
            // 3. Probar coincidencia difusa en encabezados del archivo
            if (!vec) {
              const targetClean = cleanHeaderToken(`embeddingprofesor${config.field}`);
              const altClean = cleanHeaderToken(`embedding${config.field}`);
              const foundCol = Object.keys(row).find((k) => {
                const ck = cleanHeaderToken(k);
                return ck === targetClean || ck === altClean;
              });
              if (foundCol && row[foundCol]) {
                vec = parseEmbeddingValue(row[foundCol]);
              }
            }

            if (vec && vec.length === 768) {
              fieldEmbeddings[config.field] = vec;
            }
          }
          prof.fieldEmbeddings = fieldEmbeddings;

          // Vector compuesto/único de respaldo si existe
          let singleVec: number[] | null = null;
          const singleRaw =
            row["Embedding Profesor"] ||
            row["embedding_768"] ||
            row["embedding"] ||
            row["vector"];
          if (singleRaw) {
            singleVec = parseEmbeddingValue(singleRaw);
          } else {
            const foundCol = Object.keys(row).find((k) => {
              const ck = cleanHeaderToken(k);
              return ck === "embeddingprofesor" || ck === "embedding768" || ck === "vector";
            });
            if (foundCol && row[foundCol]) {
              singleVec = parseEmbeddingValue(row[foundCol]);
            }
          }

          if (singleVec && singleVec.length === 768) {
            prof.embedding_768 = singleVec;
            // Si no había vectores por campo, poblar con el vector único para permitir matching
            activeConfigs.forEach((c) => {
              if (!prof.fieldEmbeddings![c.field]) {
                prof.fieldEmbeddings![c.field] = singleVec!;
              }
            });
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
      const profesoresList: Profesor[] = fileRows.map((row, idx) => {
        let actualId: string | number | undefined = undefined;
        if (idColumn && row[idColumn] !== undefined && row[idColumn] !== null && String(row[idColumn]).trim() !== "") {
          actualId = row[idColumn];
        } else if (row["ID Profesor"] !== undefined && row["ID Profesor"] !== null && String(row["ID Profesor"]).trim() !== "") {
          actualId = row["ID Profesor"];
        } else if (row["id"] !== undefined && row["id"] !== null && String(row["id"]).trim() !== "") {
          actualId = row["id"];
        } else if (row["ID"] !== undefined && row["ID"] !== null && String(row["ID"]).trim() !== "") {
          actualId = row["ID"];
        } else {
          const foundIdKey = Object.keys(row).find(
            (k) => isIdHeader(k) && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== ""
          );
          if (foundIdKey) {
            actualId = row[foundIdKey];
          }
        }
        if (actualId === undefined || actualId === null || String(actualId).trim() === "") {
          actualId = idx + 1;
        }

        let actualName = "";
        if (nameColumn && row[nameColumn] !== undefined && row[nameColumn] !== null && String(row[nameColumn]).trim() !== "") {
          actualName = String(row[nameColumn]).trim();
        } else if (row["Nombre Profesor"] !== undefined && row["Nombre Profesor"] !== null && String(row["Nombre Profesor"]).trim() !== "") {
          actualName = String(row["Nombre Profesor"]).trim();
        } else if (row["nombre_profesor"] !== undefined && row["nombre_profesor"] !== null && String(row["nombre_profesor"]).trim() !== "") {
          actualName = String(row["nombre_profesor"]).trim();
        } else {
          const foundNameKey = Object.keys(row).find(
            (k) => isNameHeader(k) && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== ""
          );
          if (foundNameKey) {
            actualName = String(row[foundNameKey]).trim();
          }
        }
        if (!actualName) {
          actualName = `Profesor ${actualId}`;
        }

        const prof: Profesor = {
          ...row,
          id: actualId,
          nombre_profesor: actualName,
        };

        if (row["ID Profesor"] !== undefined) {
          prof["ID Profesor"] = row["ID Profesor"];
        } else if (idColumn && row[idColumn] !== undefined) {
          prof["ID Profesor"] = row[idColumn];
        }
        if (row["Nombre Profesor"] !== undefined) {
          prof["Nombre Profesor"] = row["Nombre Profesor"];
        } else if (nameColumn && row[nameColumn] !== undefined) {
          prof["Nombre Profesor"] = row[nameColumn];
        }

        return prof;
      });

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
      const rowData: Record<string, any> = {};

      // Primero, escribir todas las columnas del archivo original respetando orden y valores
      fileHeaders.forEach((h) => {
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
      });

      // Asegurar que existan ID Profesor y Nombre Profesor si el archivo no los tenía explícitamente
      if (rowData["ID Profesor"] === undefined) {
        rowData["ID Profesor"] = item.profesor.id;
      }
      if (rowData["Nombre Profesor"] === undefined) {
        rowData["Nombre Profesor"] = item.profesor.nombre_profesor;
      }

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
  const getAsignaturaExtraColumns = useCallback(() => {
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

    filteredAsignaturas.forEach((a) => {
      Object.keys(a).forEach((k) => {
        if (!standardAsigKeys.has(k) && !k.startsWith("vector_") && !k.startsWith("embedding_")) {
          allAsigExtraCols.add(k);
        }
      });
    });

    return Array.from(allAsigExtraCols);
  }, [matchResults, filteredAsignaturas]);

  // ── Columnas Disponibles para Selección en la Descarga de Matches ──
  const allAvailableDocenteCols = useMemo(() => {
    const cols: { key: string; label: string; isStandard?: boolean; isVector?: boolean }[] = [];
    const seen = new Set<string>();

    const fileHasIdCol = fileHeaders.some(
      (h) => isIdHeader(h) || h === idColumn || h === "ID Profesor"
    );
    const fileHasNameCol = fileHeaders.some(
      (h) => isNameHeader(h) || h === nameColumn || h === "Nombre Profesor"
    );

    // Si el archivo no tiene columna de ID, ofrecemos ID Profesor estándar (autogenerado)
    if (!fileHasIdCol) {
      cols.push({ key: "ID Profesor", label: "ID Profesor (Autogenerado)", isStandard: true });
      seen.add("ID Profesor");
    }

    // Si el archivo no tiene columna de Nombre, ofrecemos Nombre Profesor estándar
    if (!fileHasNameCol) {
      cols.push({ key: "Nombre Profesor", label: "Nombre Profesor", isStandard: true });
      seen.add("Nombre Profesor");
    }

    // Incorporar todas las columnas del archivo original respetando su presencia, orden y valores
    fileHeaders.forEach((h) => {
      if (
        h === "embedding_768" ||
        h === "vectors" ||
        h === "fieldEmbeddings" ||
        h === "Embedding Profesor" ||
        h.toLowerCase().startsWith("embedding profesor (")
      ) {
        return;
      }

      if (!seen.has(h)) {
        seen.add(h);
        const isId = isIdHeader(h) || h === idColumn;
        const isName = isNameHeader(h) || h === nameColumn;
        cols.push({
          key: h,
          label:
            isName && h !== "Nombre Profesor"
              ? `${h} (Nombre Profesor)`
              : isId && h !== "ID Profesor"
              ? `${h} (ID Profesor)`
              : h,
          isStandard: isId || isName,
        });
      }
    });

    // Campos adicionales que hayan venido en los resultados de matchResults
    matchResults.forEach((r) => {
      if (r.profesor) {
        Object.keys(r.profesor).forEach((k) => {
          if (
            !seen.has(k) &&
            k !== "id" &&
            k !== "nombre_profesor" &&
            k !== "embedding_768" &&
            k !== "vectors" &&
            k !== "fieldEmbeddings" &&
            k !== "Embedding Profesor" &&
            !k.startsWith("Embedding Profesor (")
          ) {
            seen.add(k);
            cols.push({ key: k, label: k });
          }
        });
      }
    });

    // Estado anti-sesgo
    cols.push({ key: "Filtro Anti-Sesgo", label: "Filtro Anti-Sesgo (Estado)", isStandard: true });

    // Vector compuesto
    cols.push({
      key: "Embedding Profesor",
      label: "Embedding 768d Profesor (Compuesto)",
      isStandard: false,
      isVector: true,
    });

    // Vectores por campo
    const fieldEmbeddingsSet = new Set<string>();
    matchResults.forEach((r) => {
      if (r.fieldEmbeddings) {
        Object.keys(r.fieldEmbeddings).forEach((f) => fieldEmbeddingsSet.add(f));
      }
    });
    fileHeaders.forEach((h) => {
      const m = h.match(/^Embedding Profesor \((.+)\)$/i);
      if (m && m[1]) {
        fieldEmbeddingsSet.add(m[1]);
      }
    });

    fieldEmbeddingsSet.forEach((f) => {
      const cfg = queryConfigs.find((c) => c.field === f || c.label === f);
      const label = cfg?.label || f;
      const key = `Embedding Profesor (${label})`;
      if (!seen.has(key)) {
        seen.add(key);
        cols.push({
          key,
          label: key,
          isStandard: false,
          isVector: true,
        });
      }
    });

    return cols;
  }, [fileHeaders, nameColumn, idColumn, matchResults, queryConfigs]);

  const allAvailableAsigCols = useMemo(() => {
    const cols: { key: string; label: string; isStandard?: boolean; isVector?: boolean }[] = [
      { key: "Clave Asignatura", label: "Clave Asignatura", isStandard: true },
      { key: "Nombre Asignatura", label: "Nombre Asignatura", isStandard: true },
      { key: "Cluster Asignatura", label: "Cluster Asignatura", isStandard: true },
      { key: "ID Asignatura", label: "ID Asignatura", isStandard: true },
      { key: "Contenido Temático", label: "Contenido Temático (Temario)", isStandard: false },
      { key: "Fines de Aprendizaje", label: "Fines de Aprendizaje / Formación", isStandard: false },
      { key: "Actividades de Aprendizaje", label: "Actividades de Aprendizaje", isStandard: false },
    ];

    const extraCols = getAsignaturaExtraColumns();
    extraCols.forEach((c) => {
      cols.push({
        key: `Asignatura - ${c.replace(/_/g, " ")}`,
        label: `Asignatura: ${c.replace(/_/g, " ")}`,
        isStandard: false,
      });
    });

    cols.push({ key: "Embedding Asignatura", label: "Embedding 768d Asignatura", isStandard: false, isVector: true });

    // Multi-vectores de asignaturas si están disponibles
    const availableMultiVectors = new Set<string>();
    matchResults.forEach((r) => {
      r.matches.forEach((m) => {
        if (m.vectors && typeof m.vectors === "object") {
          Object.keys(m.vectors).forEach((vk) => availableMultiVectors.add(vk));
        }
      });
    });
    availableMultiVectors.forEach((vk) => {
      cols.push({
        key: `Vector Asignatura (${vk})`,
        label: `Vector Asignatura (${vk.replace(/_/g, " ")})`,
        isStandard: false,
        isVector: true,
      });
    });

    return cols;
  }, [matchResults, getAsignaturaExtraColumns]);

  const availableMetricCols = useMemo(() => [
    { key: "rank", label: "Rank Match (#1, #2, ...)" },
    { key: "similitud_compuesta", label: "Similitud Compuesta (%)" },
    { key: "tipo_match", label: "Tipo de Match (Nombre / Semántico)" },
    { key: "desglose_pares", label: "Desglose Pares Multi-Vector" },
    { key: "desglose_criterios", label: "Desglose Criterios de Profesor" },
    { key: "asignaturas_asignadas", label: "Total Asignaturas Asignadas (Matriz)" },
  ], []);

  // Helpers para determinar si una columna está seleccionada
  // Por defecto: datos normales están seleccionados (true), vectores grandes (embeddings) están deseleccionados (false)
  const isDocenteColSelected = useCallback((key: string): boolean => {
    if (selectedDocenteCols[key] !== undefined) {
      return selectedDocenteCols[key];
    }
    if (key === "Embedding Profesor" || key.startsWith("Embedding Profesor (")) {
      return false;
    }
    return true;
  }, [selectedDocenteCols]);

  const isAsigColSelected = useCallback((key: string): boolean => {
    if (selectedAsigCols[key] !== undefined) {
      return selectedAsigCols[key];
    }
    if (key === "Embedding Asignatura" || key.startsWith("Vector Asignatura (")) {
      return false;
    }
    return true;
  }, [selectedAsigCols]);

  const isMetricColSelected = useCallback((key: string): boolean => {
    if (selectedMetricCols[key] !== undefined) {
      return selectedMetricCols[key];
    }
    return true;
  }, [selectedMetricCols]);

  // Actualizadores con guardado en localStorage
  const updateSelectedDocenteCols = (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    setSelectedDocenteCols((prev) => {
      const next = updater(prev);
      try { localStorage.setItem("pradem_export_doc_cols", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const updateSelectedAsigCols = (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    setSelectedAsigCols((prev) => {
      const next = updater(prev);
      try { localStorage.setItem("pradem_export_asig_cols", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const updateSelectedMetricCols = (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    setSelectedMetricCols((prev) => {
      const next = updater(prev);
      try { localStorage.setItem("pradem_export_metric_cols", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const selectAllExportCols = () => {
    const nextDoc: Record<string, boolean> = {};
    allAvailableDocenteCols.forEach((c) => { nextDoc[c.key] = true; });
    updateSelectedDocenteCols(() => nextDoc);

    const nextAsig: Record<string, boolean> = {};
    allAvailableAsigCols.forEach((c) => { nextAsig[c.key] = true; });
    updateSelectedAsigCols(() => nextAsig);

    const nextMet: Record<string, boolean> = {};
    availableMetricCols.forEach((m) => { nextMet[m.key] = true; });
    updateSelectedMetricCols(() => nextMet);
  };

  const deselectAllExportCols = () => {
    const nextDoc: Record<string, boolean> = {};
    allAvailableDocenteCols.forEach((c) => { nextDoc[c.key] = false; });
    updateSelectedDocenteCols(() => nextDoc);

    const nextAsig: Record<string, boolean> = {};
    allAvailableAsigCols.forEach((c) => { nextAsig[c.key] = false; });
    updateSelectedAsigCols(() => nextAsig);

    const nextMet: Record<string, boolean> = {};
    availableMetricCols.forEach((m) => { nextMet[m.key] = false; });
    updateSelectedMetricCols(() => nextMet);
  };

  const selectRecommendedExportCols = () => {
    const nextDoc: Record<string, boolean> = {};
    allAvailableDocenteCols.forEach((c) => {
      nextDoc[c.key] = !c.isVector && c.key !== "Embedding Profesor" && !c.key.startsWith("Embedding Profesor (");
    });
    updateSelectedDocenteCols(() => nextDoc);

    const nextAsig: Record<string, boolean> = {};
    allAvailableAsigCols.forEach((c) => {
      nextAsig[c.key] = !c.isVector && c.key !== "Embedding Asignatura" && !c.key.startsWith("Vector Asignatura (");
    });
    updateSelectedAsigCols(() => nextAsig);

    updateSelectedMetricCols(() => ({
      rank: true,
      similitud_compuesta: true,
      tipo_match: true,
      desglose_pares: true,
      desglose_criterios: true,
      asignaturas_asignadas: true,
    }));
  };

  const selectMinimalExportCols = () => {
    const nextDoc: Record<string, boolean> = {};
    allAvailableDocenteCols.forEach((c) => {
      nextDoc[c.key] = Boolean(c.isStandard && c.key !== "Filtro Anti-Sesgo");
    });
    updateSelectedDocenteCols(() => nextDoc);

    const nextAsig: Record<string, boolean> = {};
    allAvailableAsigCols.forEach((c) => {
      nextAsig[c.key] = c.key === "Clave Asignatura" || c.key === "Nombre Asignatura";
    });
    updateSelectedAsigCols(() => nextAsig);

    updateSelectedMetricCols(() => ({
      rank: true,
      similitud_compuesta: true,
      tipo_match: true,
      desglose_pares: false,
      desglose_criterios: false,
      asignaturas_asignadas: false,
    }));
  };

  const selectWithVectorsExportCols = () => {
    const nextDoc: Record<string, boolean> = {};
    allAvailableDocenteCols.forEach((c) => { nextDoc[c.key] = true; });
    updateSelectedDocenteCols(() => nextDoc);

    const nextAsig: Record<string, boolean> = {};
    allAvailableAsigCols.forEach((c) => { nextAsig[c.key] = true; });
    updateSelectedAsigCols(() => nextAsig);

    const nextMet: Record<string, boolean> = {};
    availableMetricCols.forEach((m) => { nextMet[m.key] = true; });
    updateSelectedMetricCols(() => nextMet);
  };

  const totalSelectedDocenteCount = useMemo(() => {
    return allAvailableDocenteCols.filter((c) => isDocenteColSelected(c.key)).length;
  }, [allAvailableDocenteCols, isDocenteColSelected]);

  const totalSelectedAsigCount = useMemo(() => {
    return allAvailableAsigCols.filter((c) => isAsigColSelected(c.key)).length;
  }, [allAvailableAsigCols, isAsigColSelected]);

  const totalSelectedMetricCount = useMemo(() => {
    return availableMetricCols.filter((c) => isMetricColSelected(c.key)).length;
  }, [availableMetricCols, isMetricColSelected]);

  const totalSelectedExportCols = totalSelectedDocenteCount + totalSelectedAsigCount + totalSelectedMetricCount;
  const totalAllExportCols = allAvailableDocenteCols.length + allAvailableAsigCols.length + availableMetricCols.length;

  // ── Generador de Filas para Vista Previa de Encabezados ──
  const matrixPreviewHeaders = useMemo(() => {
    const headers: { name: string; category: "docente" | "asig" | "metric" | "vector" }[] = [];
    allAvailableDocenteCols.forEach((c) => {
      if (isDocenteColSelected(c.key)) {
        headers.push({ name: c.key, category: c.isVector ? "vector" : "docente" });
      }
    });
    if (isMetricColSelected("asignaturas_asignadas")) {
      headers.push({ name: "Asignaturas Asignadas", category: "metric" });
    }
    const samplePrefix = "Match 1";
    if (isMetricColSelected("rank")) headers.push({ name: `${samplePrefix} - Rank`, category: "metric" });
    if (isAsigColSelected("Nombre Asignatura")) headers.push({ name: `${samplePrefix} - Asignatura`, category: "asig" });
    if (isAsigColSelected("Clave Asignatura")) headers.push({ name: `${samplePrefix} - Clave`, category: "asig" });
    if (isAsigColSelected("Cluster Asignatura")) headers.push({ name: `${samplePrefix} - Cluster`, category: "asig" });
    if (isAsigColSelected("ID Asignatura")) headers.push({ name: `${samplePrefix} - ID Asignatura`, category: "asig" });
    if (isMetricColSelected("similitud_compuesta")) headers.push({ name: `${samplePrefix} - Similitud Compuesta`, category: "metric" });
    if (isMetricColSelected("tipo_match")) headers.push({ name: `${samplePrefix} - Tipo Match`, category: "metric" });
    if (isMetricColSelected("desglose_pares")) headers.push({ name: `${samplePrefix} - Desglose Pares`, category: "metric" });
    if (isMetricColSelected("desglose_criterios")) headers.push({ name: `${samplePrefix} - Desglose Criterios`, category: "metric" });
    if (isAsigColSelected("Contenido Temático")) headers.push({ name: `${samplePrefix} - Contenido Temático`, category: "asig" });
    if (isAsigColSelected("Fines de Aprendizaje")) headers.push({ name: `${samplePrefix} - Fines de Aprendizaje`, category: "asig" });
    if (isAsigColSelected("Actividades de Aprendizaje")) headers.push({ name: `${samplePrefix} - Actividades de Aprendizaje`, category: "asig" });

    const extraCols = getAsignaturaExtraColumns();
    extraCols.forEach((extraCol) => {
      const label = `Asignatura - ${extraCol.replace(/_/g, " ")}`;
      if (isAsigColSelected(label)) {
        headers.push({ name: `${samplePrefix} - ${extraCol.replace(/_/g, " ")}`, category: "asig" });
      }
    });

    if (isAsigColSelected("Embedding Asignatura")) {
      headers.push({ name: `${samplePrefix} - Embedding Asignatura`, category: "vector" });
    }

    return headers;
  }, [allAvailableDocenteCols, isDocenteColSelected, isMetricColSelected, isAsigColSelected, getAsignaturaExtraColumns]);

  const detailedPreviewHeaders = useMemo(() => {
    const headers: { name: string; category: "docente" | "asig" | "metric" | "vector" }[] = [];
    allAvailableDocenteCols.forEach((c) => {
      if (isDocenteColSelected(c.key)) {
        headers.push({ name: c.key, category: c.isVector ? "vector" : "docente" });
      }
    });
    if (isMetricColSelected("rank")) headers.push({ name: "Rank Match", category: "metric" });
    if (isMetricColSelected("similitud_compuesta")) headers.push({ name: "Similitud Compuesta", category: "metric" });
    if (isMetricColSelected("tipo_match")) headers.push({ name: "Tipo Match", category: "metric" });
    if (isMetricColSelected("desglose_pares")) headers.push({ name: "Desglose Pares (Multi-Vector)", category: "metric" });
    if (isMetricColSelected("desglose_criterios")) headers.push({ name: "Desglose Criterios", category: "metric" });
    if (isAsigColSelected("ID Asignatura")) headers.push({ name: "ID Asignatura", category: "asig" });
    if (isAsigColSelected("Clave Asignatura")) headers.push({ name: "Clave Asignatura", category: "asig" });
    if (isAsigColSelected("Nombre Asignatura")) headers.push({ name: "Nombre Asignatura", category: "asig" });
    if (isAsigColSelected("Cluster Asignatura")) headers.push({ name: "Cluster Asignatura", category: "asig" });
    if (isAsigColSelected("Contenido Temático")) headers.push({ name: "Contenido Temático", category: "asig" });
    if (isAsigColSelected("Fines de Aprendizaje")) headers.push({ name: "Fines de Aprendizaje", category: "asig" });
    if (isAsigColSelected("Actividades de Aprendizaje")) headers.push({ name: "Actividades de Aprendizaje", category: "asig" });

    const extraCols = getAsignaturaExtraColumns();
    extraCols.forEach((extraCol) => {
      const label = `Asignatura - ${extraCol.replace(/_/g, " ")}`;
      if (isAsigColSelected(label)) {
        headers.push({ name: label, category: "asig" });
      }
    });

    if (isAsigColSelected("Embedding Asignatura")) {
      headers.push({ name: "Embedding Asignatura", category: "vector" });
    }

    return headers;
  }, [allAvailableDocenteCols, isDocenteColSelected, isMetricColSelected, isAsigColSelected, getAsignaturaExtraColumns]);

  // ── Generación de Filas Formato Matriz (1 Fila por Docente) ──
  const generateMatrixRows = useCallback(
    (results: ProfesorMatchResult[]): Record<string, any>[] => {
      if (!results.length) return [];
      const extraAsigCols = getAsignaturaExtraColumns();

      const maxMatchesToExport = Math.max(
        1,
        filterMode === "threshold"
          ? Math.max(...results.map((r) => r.matches.length), 1)
          : topK
      );

      return results.map((item) => {
        const rowData: Record<string, any> = {};

        // 1. Columnas seleccionadas del docente (respetando orden, valores originales e ID/Nombre)
        allAvailableDocenteCols.forEach((c) => {
          if (!isDocenteColSelected(c.key)) return;

          if (c.key === "ID Profesor") {
            rowData["ID Profesor"] =
              item.profesor["ID Profesor"] ??
              (idColumn ? item.profesor[idColumn] : undefined) ??
              item.profesor.id ??
              "";
          } else if (c.key === "Nombre Profesor") {
            rowData["Nombre Profesor"] =
              item.profesor["Nombre Profesor"] ??
              (nameColumn ? item.profesor[nameColumn] : undefined) ??
              item.profesor.nombre_profesor ??
              "";
          } else if (c.key === "Filtro Anti-Sesgo") {
            if (item.sanitizationStatus) {
              rowData["Filtro Anti-Sesgo"] =
                item.sanitizationStatus === "intact"
                  ? "Intacto (Credencial pedagógica)"
                  : item.sanitizationStatus === "sanitized"
                  ? "Sanitizado (Sesgo mitigado)"
                  : "Inactivo";
            } else {
              rowData["Filtro Anti-Sesgo"] = "Inactivo";
            }
          } else if (c.key === "Embedding Profesor") {
            rowData["Embedding Profesor"] = formatEmbeddingForExport(item.embedding_768);
          } else if (c.key.startsWith("Embedding Profesor (")) {
            if (item.fieldEmbeddings && typeof item.fieldEmbeddings === "object") {
              const matchedEntry = Object.entries(item.fieldEmbeddings).find(([field]) => {
                const cfg = queryConfigs.find((qc) => qc.field === field);
                const label = cfg?.label || field;
                return c.key === `Embedding Profesor (${label})`;
              });
              if (matchedEntry) {
                rowData[c.key] = formatEmbeddingForExport(matchedEntry[1]);
              } else {
                rowData[c.key] = "";
              }
            } else {
              rowData[c.key] = "";
            }
          } else {
            let val = item.profesor[c.key] ?? "";
            if (
              item.sanitizationStatus === "sanitized" &&
              typeof val === "string" &&
              regexFilterConfig?.enabled
            ) {
              const res = sanitizarCvParaModelo(val, regexFilterConfig, false);
              val = res.sanitizedText;
            }
            rowData[c.key] = val;
          }
        });

        if (isMetricColSelected("asignaturas_asignadas")) {
          rowData["Asignaturas Asignadas"] = item.matches.length;
        }

        // 2. Columnas por cada Match de la Asignatura
        for (let k = 0; k < maxMatchesToExport; k++) {
          const m = item.matches[k];
          const prefix = `Match ${k + 1}`;

          if (m) {
            if (isMetricColSelected("rank")) {
              rowData[`${prefix} - Rank`] = `#${k + 1}`;
            }
            if (isAsigColSelected("Nombre Asignatura")) {
              rowData[`${prefix} - Asignatura`] = m.nombre ?? "";
            }
            if (isAsigColSelected("Clave Asignatura")) {
              rowData[`${prefix} - Clave`] = m.clave ?? "";
            }
            if (isAsigColSelected("Cluster Asignatura")) {
              rowData[`${prefix} - Cluster`] = m.cluster || "Sin Cluster";
            }
            if (isAsigColSelected("ID Asignatura")) {
              rowData[`${prefix} - ID Asignatura`] = m.asignaturaId ?? m.id ?? "";
            }
            if (isMetricColSelected("similitud_compuesta")) {
              rowData[`${prefix} - Similitud Compuesta`] = `${(m.compositeSimilarity * 100).toFixed(1)}%`;
            }
            if (isMetricColSelected("tipo_match")) {
              rowData[`${prefix} - Tipo Match`] = m.match_nombre
                ? "Match Nombre (Exento de cupo)"
                : "Semántico";
            }

            if (
              isMetricColSelected("desglose_pares") &&
              m.pairSimilarities &&
              Object.keys(m.pairSimilarities).length > 0
            ) {
              const desglosePares = Object.entries(m.pairSimilarities)
                .map(([pairKey, score]) => {
                  const pairCfg = distancePairs.find((p) => p.id === pairKey);
                  const label = pairCfg?.label || pairKey;
                  return `${label}: ${(score * 100).toFixed(0)}%`;
                })
                .join(" | ");
              rowData[`${prefix} - Desglose Pares (Multi-Vector)`] = desglosePares;
            }

            if (isMetricColSelected("desglose_criterios") && m.fieldSimilarities) {
              const desglose = Object.entries(m.fieldSimilarities)
                .map(([field, score]) => `${field}: ${(score * 100).toFixed(0)}%`)
                .join(" | ");
              rowData[`${prefix} - Desglose Criterios`] = desglose;
            }

            if (isAsigColSelected("Contenido Temático")) {
              rowData[`${prefix} - Contenido Temático`] = m.contenido_tematico || "";
            }
            if (isAsigColSelected("Fines de Aprendizaje")) {
              rowData[`${prefix} - Fines de Aprendizaje`] = m.fines_de_aprendizaje_o_formacion || "";
            }
            if (isAsigColSelected("Actividades de Aprendizaje")) {
              rowData[`${prefix} - Actividades de Aprendizaje`] = m.actividades_de_aprendizaje || "";
            }

            extraAsigCols.forEach((extraCol) => {
              const label = `Asignatura - ${extraCol.replace(/_/g, " ")}`;
              if (isAsigColSelected(label)) {
                rowData[`${prefix} - ${extraCol.replace(/_/g, " ")}`] = m[extraCol] ?? "";
              }
            });

            if (isAsigColSelected("Embedding Asignatura")) {
              rowData[`${prefix} - Embedding Asignatura`] = formatEmbeddingForExport(m.embedding_768);
            }

            if (m.vectors && typeof m.vectors === "object") {
              Object.entries(m.vectors).forEach(([vk, vec]) => {
                const vecKey = `Vector Asignatura (${vk})`;
                if (isAsigColSelected(vecKey)) {
                  rowData[`${prefix} - Vector (${vk})`] = formatEmbeddingForExport(vec);
                }
              });
            }
          } else {
            if (isMetricColSelected("rank")) rowData[`${prefix} - Rank`] = "—";
            if (isAsigColSelected("Nombre Asignatura")) rowData[`${prefix} - Asignatura`] = "—";
            if (isAsigColSelected("Clave Asignatura")) rowData[`${prefix} - Clave`] = "—";
            if (isAsigColSelected("Cluster Asignatura")) rowData[`${prefix} - Cluster`] = "—";
            if (isAsigColSelected("ID Asignatura")) rowData[`${prefix} - ID Asignatura`] = "—";
            if (isMetricColSelected("similitud_compuesta")) rowData[`${prefix} - Similitud Compuesta`] = "—";
            if (isMetricColSelected("tipo_match")) rowData[`${prefix} - Tipo Match`] = "—";
            if (isMetricColSelected("desglose_pares")) rowData[`${prefix} - Desglose Pares (Multi-Vector)`] = "—";
            if (isMetricColSelected("desglose_criterios")) rowData[`${prefix} - Desglose Criterios`] = "—";
            if (isAsigColSelected("Contenido Temático")) rowData[`${prefix} - Contenido Temático`] = "—";
            if (isAsigColSelected("Fines de Aprendizaje")) rowData[`${prefix} - Fines de Aprendizaje`] = "—";
            if (isAsigColSelected("Actividades de Aprendizaje")) rowData[`${prefix} - Actividades de Aprendizaje`] = "—";
            extraAsigCols.forEach((extraCol) => {
              const label = `Asignatura - ${extraCol.replace(/_/g, " ")}`;
              if (isAsigColSelected(label)) {
                rowData[`${prefix} - ${extraCol.replace(/_/g, " ")}`] = "—";
              }
            });
            if (isAsigColSelected("Embedding Asignatura")) rowData[`${prefix} - Embedding Asignatura`] = "—";
          }
        }

        return rowData;
      });
    },
    [
      filterMode,
      topK,
      nameColumn,
      idColumn,
      fileHeaders,
      regexFilterConfig,
      distancePairs,
      queryConfigs,
      getAsignaturaExtraColumns,
      isDocenteColSelected,
      isAsigColSelected,
      isMetricColSelected,
      allAvailableDocenteCols,
    ]
  );

  // ── Generación de Filas Formato Detalle Par a Par (1 Fila por Match) ──
  const generateDetailedRows = useCallback(
    (results: ProfesorMatchResult[]): Record<string, any>[] => {
      if (!results.length) return [];
      const extraAsigCols = getAsignaturaExtraColumns();
      const rows: Record<string, any>[] = [];

      results.forEach((item) => {
        const extractDocenteData = () => {
          const d: Record<string, any> = {};
          allAvailableDocenteCols.forEach((c) => {
            if (!isDocenteColSelected(c.key)) return;

            if (c.key === "ID Profesor") {
              d["ID Profesor"] =
                item.profesor["ID Profesor"] ??
                (idColumn ? item.profesor[idColumn] : undefined) ??
                item.profesor.id ??
                "";
            } else if (c.key === "Nombre Profesor") {
              d["Nombre Profesor"] =
                item.profesor["Nombre Profesor"] ??
                (nameColumn ? item.profesor[nameColumn] : undefined) ??
                item.profesor.nombre_profesor ??
                "";
            } else if (c.key === "Filtro Anti-Sesgo") {
              if (item.sanitizationStatus) {
                d["Filtro Anti-Sesgo"] =
                  item.sanitizationStatus === "intact"
                    ? "Intacto (Credencial pedagógica)"
                    : item.sanitizationStatus === "sanitized"
                    ? "Sanitizado (Sesgo mitigado)"
                    : "Inactivo";
              } else {
                d["Filtro Anti-Sesgo"] = "Inactivo";
              }
            } else if (c.key === "Embedding Profesor") {
              d["Embedding Profesor"] = formatEmbeddingForExport(item.embedding_768);
            } else if (c.key.startsWith("Embedding Profesor (")) {
              if (item.fieldEmbeddings && typeof item.fieldEmbeddings === "object") {
                const matchedEntry = Object.entries(item.fieldEmbeddings).find(([field]) => {
                  const cfg = queryConfigs.find((qc) => qc.field === field);
                  const label = cfg?.label || field;
                  return c.key === `Embedding Profesor (${label})`;
                });
                if (matchedEntry) {
                  d[c.key] = formatEmbeddingForExport(matchedEntry[1]);
                } else {
                  d[c.key] = "";
                }
              } else {
                d[c.key] = "";
              }
            } else {
              let val = item.profesor[c.key] ?? "";
              if (
                item.sanitizationStatus === "sanitized" &&
                typeof val === "string" &&
                regexFilterConfig?.enabled
              ) {
                const res = sanitizarCvParaModelo(val, regexFilterConfig, false);
                val = res.sanitizedText;
              }
              d[c.key] = val;
            }
          });

          return d;
        };

        const baseDocenteData = extractDocenteData();

        if (!item.matches.length) {
          const emptyRow: Record<string, any> = { ...baseDocenteData };
          if (isMetricColSelected("rank")) emptyRow["Rank Match"] = "—";
          if (isMetricColSelected("similitud_compuesta")) emptyRow["Similitud Compuesta"] = "Sin matches";
          if (isMetricColSelected("tipo_match")) emptyRow["Tipo Match"] = "—";
          if (isMetricColSelected("desglose_pares")) emptyRow["Desglose Pares (Multi-Vector)"] = "—";
          if (isMetricColSelected("desglose_criterios")) emptyRow["Desglose Criterios"] = "—";

          if (isAsigColSelected("ID Asignatura")) emptyRow["ID Asignatura"] = "—";
          if (isAsigColSelected("Clave Asignatura")) emptyRow["Clave Asignatura"] = "—";
          if (isAsigColSelected("Nombre Asignatura")) emptyRow["Nombre Asignatura"] = "—";
          if (isAsigColSelected("Cluster Asignatura")) emptyRow["Cluster Asignatura"] = "—";
          if (isAsigColSelected("Contenido Temático")) emptyRow["Contenido Temático"] = "—";
          if (isAsigColSelected("Fines de Aprendizaje")) emptyRow["Fines de Aprendizaje"] = "—";
          if (isAsigColSelected("Actividades de Aprendizaje")) emptyRow["Actividades de Aprendizaje"] = "—";
          extraAsigCols.forEach((c) => {
            const label = `Asignatura - ${c.replace(/_/g, " ")}`;
            if (isAsigColSelected(label)) {
              emptyRow[label] = "—";
            }
          });
          if (isAsigColSelected("Embedding Asignatura")) emptyRow["Embedding Asignatura"] = "—";
          rows.push(emptyRow);
          return;
        }

        item.matches.forEach((m, idx) => {
          const rowData: Record<string, any> = { ...baseDocenteData };
          if (isMetricColSelected("rank")) {
            rowData["Rank Match"] = `#${idx + 1}`;
          }
          if (isMetricColSelected("similitud_compuesta")) {
            rowData["Similitud Compuesta"] = `${(m.compositeSimilarity * 100).toFixed(1)}%`;
          }
          if (isMetricColSelected("tipo_match")) {
            rowData["Tipo Match"] = m.match_nombre ? "Match Nombre (Exento de cupo)" : "Semántico";
          }

          if (
            isMetricColSelected("desglose_pares") &&
            m.pairSimilarities &&
            Object.keys(m.pairSimilarities).length > 0
          ) {
            const desglosePares = Object.entries(m.pairSimilarities)
              .map(([pairKey, score]) => {
                const pairCfg = distancePairs.find((p) => p.id === pairKey);
                const label = pairCfg?.label || pairKey;
                return `${label}: ${(score * 100).toFixed(0)}%`;
              })
              .join(" | ");
            rowData["Desglose Pares (Multi-Vector)"] = desglosePares;
          }

          if (isMetricColSelected("desglose_criterios") && m.fieldSimilarities) {
            const desglose = Object.entries(m.fieldSimilarities)
              .map(([field, score]) => `${field}: ${(score * 100).toFixed(0)}%`)
              .join(" | ");
            rowData["Desglose Criterios"] = desglose;
          }

          if (isAsigColSelected("ID Asignatura")) rowData["ID Asignatura"] = m.asignaturaId ?? m.id ?? "";
          if (isAsigColSelected("Clave Asignatura")) rowData["Clave Asignatura"] = m.clave ?? "";
          if (isAsigColSelected("Nombre Asignatura")) rowData["Nombre Asignatura"] = m.nombre ?? "";
          if (isAsigColSelected("Cluster Asignatura")) rowData["Cluster Asignatura"] = m.cluster || "Sin Cluster";
          if (isAsigColSelected("Contenido Temático")) rowData["Contenido Temático"] = m.contenido_tematico || "";
          if (isAsigColSelected("Fines de Aprendizaje")) rowData["Fines de Aprendizaje"] = m.fines_de_aprendizaje_o_formacion || "";
          if (isAsigColSelected("Actividades de Aprendizaje")) rowData["Actividades de Aprendizaje"] = m.actividades_de_aprendizaje || "";

          extraAsigCols.forEach((extraCol) => {
            const label = `Asignatura - ${extraCol.replace(/_/g, " ")}`;
            if (isAsigColSelected(label)) {
              rowData[label] = m[extraCol] ?? "";
            }
          });

          if (isAsigColSelected("Embedding Asignatura")) {
            rowData["Embedding Asignatura"] = formatEmbeddingForExport(m.embedding_768);
          }

          if (m.vectors && typeof m.vectors === "object") {
            Object.entries(m.vectors).forEach(([vk, vec]) => {
              const vecKey = `Vector Asignatura (${vk})`;
              if (isAsigColSelected(vecKey)) {
                rowData[`Vector Asignatura (${vk})`] = formatEmbeddingForExport(vec);
              }
            });
          }

          rows.push(rowData);
        });
      });

      return rows;
    },
    [
      nameColumn,
      idColumn,
      fileHeaders,
      regexFilterConfig,
      distancePairs,
      queryConfigs,
      getAsignaturaExtraColumns,
      isDocenteColSelected,
      isAsigColSelected,
      isMetricColSelected,
      allAvailableDocenteCols,
    ]
  );

  // ── Handlers de Descarga Global ──
  const handleExport = (format: "excel" | "csv") => {
    if (!matchResults.length) return;
    if (totalSelectedExportCols === 0) {
      alert("Debes seleccionar al menos una columna para exportar. Abre el panel de 'Columnas a Exportar'.");
      setIsExportConfigOpen(true);
      return;
    }

    const rows = generateMatrixRows(matchResults);
    const filename = `Match_Matriz_Docentes_Asignaturas_${new Date().toISOString().slice(0, 10)}`;
    if (format === "excel") {
      exportToExcel(rows, filename);
    } else {
      exportToCsv(rows, filename);
    }
  };

  const handleExportDetailed = (format: "excel" | "csv") => {
    if (!matchResults.length) return;
    if (totalSelectedExportCols === 0) {
      alert("Debes seleccionar al menos una columna para exportar. Abre el panel de 'Columnas a Exportar'.");
      setIsExportConfigOpen(true);
      return;
    }

    const rows = generateDetailedRows(matchResults);
    const filename = `Match_Detallado_Docente_Asignatura_${new Date().toISOString().slice(0, 10)}`;
    if (format === "excel") {
      exportToExcel(rows, filename);
    } else {
      exportToCsv(rows, filename);
    }
  };

  // ── Descarga de Matches de un Profesor Individual ──
  const handleExportSingleProfessor = (
    result: ProfesorMatchResult,
    format: "excel" | "csv",
    layout: "matriz" | "detailed" = "detailed"
  ) => {
    if (totalSelectedExportCols === 0) {
      alert("Debes seleccionar al menos una columna para exportar. Abre el panel de 'Columnas a Exportar'.");
      setIsExportConfigOpen(true);
      return;
    }

    const safeName = (result.profesor.nombre_profesor || `Profesor_${result.profesor.id}`)
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 30);
    const filename = `Match_${safeName}_${layout}_${new Date().toISOString().slice(0, 10)}`;
    const rows = layout === "matriz" ? generateMatrixRows([result]) : generateDetailedRows([result]);

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

          {/* Badge de Estado del Filtro y Botón Sincronizar Supabase */}
          <div className="flex flex-wrap items-center gap-2">
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
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
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
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 transition font-semibold cursor-pointer"
                >
                  Reactivar
                </button>
              </div>
            )}

            {/* Botón para forzar sincronización con Supabase */}
            <button
              type="button"
              onClick={() => syncCatalogAndClusters()}
              disabled={isSyncingWithDb}
              className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              title="Sincronizar catálogo y clusters actualizados desde Supabase"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingWithDb ? "animate-spin text-cyan-400" : ""}`} />
              <span>{isSyncingWithDb ? "Sincronizando..." : "Sincronizar Catálogo BD"}</span>
            </button>
          </div>
        </div>

        {/* Notificación de sincronización con Supabase */}
        {syncNotice && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-300 animate-in fade-in">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            <span>{syncNotice}</span>
            {lastSyncTime && (
              <span className="text-[10px] text-emerald-400/70 font-mono ml-auto">
                {lastSyncTime.toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

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
                            <th className="px-3 py-2 text-cyan-300">Cluster BD ({clusterColumn})</th>
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
                              <td className="px-3 py-1.5 font-medium text-cyan-300 text-[11px]">
                                {(asig as any)[clusterColumn] || asig.cluster || (
                                  <span className="text-slate-500 italic">Sin cluster</span>
                                )}
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
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-300">Columna con Nombre del Profesor:</span>
                  <select
                    value={nameColumn}
                    onChange={(e) => {
                      setNameColumn(e.target.value);
                      setupQueryConfigs(fileHeaders, e.target.value, idColumn);
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

                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-300">Columna con ID del Profesor (opcional):</span>
                  <select
                    value={idColumn}
                    onChange={(e) => {
                      setIdColumn(e.target.value);
                      setupQueryConfigs(fileHeaders, nameColumn, e.target.value);
                    }}
                    className="rounded-lg border border-white/15 bg-slate-950 px-3 py-1.5 text-xs text-cyan-300 font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="">(Autogenerar ID si no existe en archivo)</option>
                    {fileHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
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
                    <th className="px-3 py-2.5 font-bold text-cyan-300">ID</th>
                    <th className="px-3 py-2.5 font-bold text-indigo-300">Profesor</th>
                    {fileHeaders
                      .filter((h) => h !== nameColumn && h !== idColumn)
                      .slice(0, 4)
                      .map((h) => (
                        <th key={h} className="px-3 py-2.5">
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-300">
                  {fileRows.slice(0, 5).map((row, idx) => {
                    const rowId =
                      idColumn && row[idColumn] !== undefined && String(row[idColumn]).trim() !== ""
                        ? row[idColumn]
                        : row["ID Profesor"] || row["id"] || row["ID"] || (idx + 1);
                    const rowName =
                      nameColumn && row[nameColumn] !== undefined && String(row[nameColumn]).trim() !== ""
                        ? row[nameColumn]
                        : row["Nombre Profesor"] || row["Nombre"] || `Profesor ${rowId}`;

                    return (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-mono text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono text-cyan-300 font-semibold">{rowId}</td>
                        <td className="px-3 py-2 font-semibold text-white">{rowName}</td>
                        {fileHeaders
                          .filter((h) => h !== nameColumn && h !== idColumn)
                          .slice(0, 4)
                          .map((h) => (
                            <td key={h} className="px-3 py-2 truncate max-w-xs text-slate-400">
                              {row[h] || "—"}
                            </td>
                          ))}
                      </tr>
                    );
                  })}
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
                  onChange={(e) => {
                    const newCol = e.target.value;
                    setClusterColumn(newCol);
                    syncCatalogAndClusters(newCol);
                  }}
                  className="rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1 text-xs text-cyan-300 font-semibold focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {availableClusterColumns.map((col) => (
                    <option key={col} value={col}>
                      {col} {col === "cluster" ? "(Por defecto)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => syncCatalogAndClusters()}
                  disabled={isSyncingWithDb || isLoadingClusters}
                  className="p-1 rounded-md hover:bg-white/10 text-cyan-400 transition cursor-pointer"
                  title="Recargar clusters y asignaturas desde Supabase"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${
                      isSyncingWithDb || isLoadingClusters ? "animate-spin text-cyan-400" : ""
                    }`}
                  />
                </button>
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

            {/* Botones de Exportación y Personalización de Columnas */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsExportConfigOpen(!isExportConfigOpen)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer shadow-sm ${
                  isExportConfigOpen
                    ? "bg-cyan-500/20 border-cyan-400 text-cyan-200 ring-2 ring-cyan-400/40 shadow-cyan-500/10"
                    : "bg-slate-900 border-cyan-500/30 text-white hover:border-cyan-400 hover:bg-cyan-500/10"
                }`}
                title="Configurar qué columnas de profesor y qué columnas de asignatura incluir en el archivo descargable"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
                <span>Elegir Columnas a Exportar</span>
                <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
                  {totalSelectedExportCols}/{totalAllExportCols}
                </span>
                <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${isExportConfigOpen ? "rotate-180" : ""}`} />
              </button>

              <div className="flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-0.5 shadow-sm">
                <span className="px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  Matriz:
                </span>
                <button
                  type="button"
                  onClick={() => handleExport("excel")}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600/30 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600/50 transition cursor-pointer"
                  title="Descargar matriz (1 fila por docente con columnas de Match 1, Match 2...) en Excel (.xlsx)"
                >
                  <Download className="h-3 w-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-200 hover:text-white transition cursor-pointer"
                  title="Descargar matriz en CSV (.csv)"
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
                  title="Descargar listado relacional (1 fila por match profesor-asignatura) en Excel (.xlsx)"
                >
                  <Download className="h-3 w-3" />
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportDetailed("csv")}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-200 hover:text-white transition cursor-pointer"
                  title="Descargar listado relacional en CSV (.csv)"
                >
                  <FileText className="h-3 w-3" />
                  <span>CSV</span>
                </button>
              </div>
            </div>
          </div>

          {/* Panel Desplegable de Configuración de Columnas a Exportar */}
          {isExportConfigOpen && (
            <div className="rounded-2xl border border-cyan-500/40 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-md space-y-4 animate-in fade-in slide-in-from-top-2 duration-200 ring-1 ring-cyan-500/20">
              {/* Encabezado y Presets Rápidos */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      Personalizar Columnas del Archivo de Matches
                      <span className="rounded-full bg-cyan-500/20 px-2 py-0.2 text-[10px] font-mono text-cyan-300 border border-cyan-500/30">
                        {totalSelectedExportCols} activas
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Selecciona qué datos del docente, qué campos de asignatura y qué métricas por match se exportarán (aplica a Excel y CSV).
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium mr-1">Preajustes:</span>
                  <button
                    type="button"
                    onClick={selectAllExportCols}
                    className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                    title="Selecciona absolutamente todas las columnas disponibles"
                  >
                    ✨ Todas
                  </button>
                  <button
                    type="button"
                    onClick={selectRecommendedExportCols}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 transition cursor-pointer font-semibold"
                    title="Selecciona todos los datos descriptivos y métricas, excluyendo vectores pesados para un archivo ágil"
                  >
                    🎯 Recomendadas (Ligero)
                  </button>
                  <button
                    type="button"
                    onClick={selectMinimalExportCols}
                    className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                    title="Selecciona únicamente Docente, Clave, Asignatura, Rank y Similitud"
                  >
                    ⚡ Mínimo Esencial
                  </button>
                  <button
                    type="button"
                    onClick={selectWithVectorsExportCols}
                    className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-200 hover:bg-purple-500/20 transition cursor-pointer"
                    title="Incluye además los vectores completos de 768 floats (embeddings) de docente y asignatura"
                  >
                    🧠 Con Embeddings 768d
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllExportCols}
                    className="rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-rose-500/10 hover:text-rose-300 transition cursor-pointer"
                    title="Deselecciona todas las columnas"
                  >
                    🧹 Ninguna
                  </button>
                </div>
              </div>

              {/* Input de Búsqueda Rápida de Columnas */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative max-w-sm w-full">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Filtrar columnas (ej. clave, correo, temario, embedding)..."
                    value={exportColSearchTerm}
                    onChange={(e) => setExportColSearchTerm(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  {exportColSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setExportColSearchTerm("")}
                      className="absolute right-2 top-2 text-slate-400 hover:text-white"
                      title="Limpiar búsqueda"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 hidden sm:flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                    <span>Docente ({totalSelectedDocenteCount})</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                    <span>Asignatura ({totalSelectedAsigCount})</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-indigo-400"></span>
                    <span>Métricas ({totalSelectedMetricCount})</span>
                  </span>
                </div>
              </div>

              {/* Grid de 3 Columnas: Docente, Asignatura por Match, Métricas */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                {/* 1. Columnas de Profesor / Docente */}
                <div className="rounded-xl border border-cyan-500/20 bg-slate-900/60 p-3.5 flex flex-col space-y-2.5">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      Docente ({totalSelectedDocenteCount}/{allAvailableDocenteCols.length})
                    </span>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const n: Record<string, boolean> = { ...selectedDocenteCols };
                          allAvailableDocenteCols.forEach((c) => { n[c.key] = true; });
                          updateSelectedDocenteCols(() => n);
                        }}
                        className="text-cyan-400 hover:underline cursor-pointer font-medium"
                      >
                        Todas
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          const n: Record<string, boolean> = { ...selectedDocenteCols };
                          allAvailableDocenteCols.forEach((c) => { n[c.key] = false; });
                          updateSelectedDocenteCols(() => n);
                        }}
                        className="text-slate-400 hover:underline cursor-pointer"
                      >
                        Ninguna
                      </button>
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {allAvailableDocenteCols
                      .filter((c) => !exportColSearchTerm || c.label.toLowerCase().includes(exportColSearchTerm.toLowerCase()))
                      .map((col) => {
                        const isChecked = isDocenteColSelected(col.key);
                        return (
                          <label
                            key={col.key}
                            className={`flex items-center gap-2 p-1.5 rounded-lg border transition cursor-pointer select-none ${
                              isChecked
                                ? "bg-cyan-500/10 border-cyan-500/30 text-white"
                                : "bg-slate-950/40 border-white/5 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                updateSelectedDocenteCols((prev) => ({
                                  ...prev,
                                  [col.key]: e.target.checked,
                                }));
                              }}
                              className="rounded border-white/20 bg-slate-950 text-cyan-500 focus:ring-cyan-500 h-3.5 w-3.5 cursor-pointer"
                            />
                            <span className="truncate flex-1 font-mono text-[11px]">{col.label}</span>
                            {col.isVector && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-sans font-semibold">
                                768d
                              </span>
                            )}
                            {col.isStandard && !col.isVector && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-sans">
                                Estándar
                              </span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                </div>

                {/* 2. Columnas de Asignatura (por cada Match) */}
                <div className="rounded-xl border border-emerald-500/20 bg-slate-900/60 p-3.5 flex flex-col space-y-2.5">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" />
                      Asignatura por Match ({totalSelectedAsigCount}/{allAvailableAsigCols.length})
                    </span>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const n: Record<string, boolean> = { ...selectedAsigCols };
                          allAvailableAsigCols.forEach((c) => { n[c.key] = true; });
                          updateSelectedAsigCols(() => n);
                        }}
                        className="text-emerald-400 hover:underline cursor-pointer font-medium"
                      >
                        Todas
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          const n: Record<string, boolean> = { ...selectedAsigCols };
                          allAvailableAsigCols.forEach((c) => { n[c.key] = false; });
                          updateSelectedAsigCols(() => n);
                        }}
                        className="text-slate-400 hover:underline cursor-pointer"
                      >
                        Ninguna
                      </button>
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {allAvailableAsigCols
                      .filter((c) => !exportColSearchTerm || c.label.toLowerCase().includes(exportColSearchTerm.toLowerCase()))
                      .map((col) => {
                        const isChecked = isAsigColSelected(col.key);
                        return (
                          <label
                            key={col.key}
                            className={`flex items-center gap-2 p-1.5 rounded-lg border transition cursor-pointer select-none ${
                              isChecked
                                ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                                : "bg-slate-950/40 border-white/5 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                updateSelectedAsigCols((prev) => ({
                                  ...prev,
                                  [col.key]: e.target.checked,
                                }));
                              }}
                              className="rounded border-white/20 bg-slate-950 text-emerald-500 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                            />
                            <span className="truncate flex-1 font-mono text-[11px]">{col.label}</span>
                            {col.isVector && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-sans font-semibold">
                                768d
                              </span>
                            )}
                            {col.isStandard && !col.isVector && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-sans">
                                Estándar
                              </span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                </div>

                {/* 3. Métricas y Desgloses de Matching */}
                <div className="rounded-xl border border-indigo-500/20 bg-slate-900/60 p-3.5 flex flex-col space-y-2.5">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5" />
                      Métricas Match ({totalSelectedMetricCount}/{availableMetricCols.length})
                    </span>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const n: Record<string, boolean> = { ...selectedMetricCols };
                          availableMetricCols.forEach((c) => { n[c.key] = true; });
                          updateSelectedMetricCols(() => n);
                        }}
                        className="text-indigo-400 hover:underline cursor-pointer font-medium"
                      >
                        Todas
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          const n: Record<string, boolean> = { ...selectedMetricCols };
                          availableMetricCols.forEach((c) => { n[c.key] = false; });
                          updateSelectedMetricCols(() => n);
                        }}
                        className="text-slate-400 hover:underline cursor-pointer"
                      >
                        Ninguna
                      </button>
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {availableMetricCols
                      .filter((c) => !exportColSearchTerm || c.label.toLowerCase().includes(exportColSearchTerm.toLowerCase()))
                      .map((metric) => {
                        const isChecked = isMetricColSelected(metric.key);
                        return (
                          <label
                            key={metric.key}
                            className={`flex items-center gap-2 p-1.5 rounded-lg border transition cursor-pointer select-none ${
                              isChecked
                                ? "bg-indigo-500/10 border-indigo-500/30 text-white"
                                : "bg-slate-950/40 border-white/5 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                updateSelectedMetricCols((prev) => ({
                                  ...prev,
                                  [metric.key]: e.target.checked,
                                }));
                              }}
                              className="rounded border-white/20 bg-slate-950 text-indigo-500 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                            />
                            <span className="truncate flex-1 font-mono text-[11px]">{metric.label}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* ── Vista Previa en Vivo de las Columnas Resultantes en el Archivo ── */}
              <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                  <div className="flex items-center gap-2">
                    <Table className="h-4 w-4 text-cyan-400" />
                    <span className="text-xs font-bold text-white">
                      Vista Previa de Columnas en el Archivo Generado
                    </span>
                    <span className="text-[11px] text-slate-400">
                      ({exportPreviewLayout === "matriz" ? matrixPreviewHeaders.length : detailedPreviewHeaders.length} columnas en este ejemplo)
                    </span>
                  </div>

                  {/* Switcher de Vista Previa entre Matriz y Detalle */}
                  <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-white/10 text-xs">
                    <button
                      type="button"
                      onClick={() => setExportPreviewLayout("matriz")}
                      className={`px-2.5 py-1 rounded-md transition cursor-pointer font-medium ${
                        exportPreviewLayout === "matriz"
                          ? "bg-emerald-500/20 text-emerald-300 font-semibold"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Formato Matriz (1 Fila/Docente)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportPreviewLayout("detailed")}
                      className={`px-2.5 py-1 rounded-md transition cursor-pointer font-medium ${
                        exportPreviewLayout === "detailed"
                          ? "bg-indigo-500/20 text-indigo-300 font-semibold"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Formato Detalle (1 Fila/Match)
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-thin">
                  {(exportPreviewLayout === "matriz" ? matrixPreviewHeaders : detailedPreviewHeaders).length === 0 ? (
                    <span className="text-rose-400 text-xs py-1">
                      ⚠️ No has seleccionado ninguna columna. Selecciona al menos una columna para poder exportar.
                    </span>
                  ) : (
                    <>
                      {(exportPreviewLayout === "matriz" ? matrixPreviewHeaders : detailedPreviewHeaders).map((h, idx) => {
                        const colorClass =
                          h.category === "docente"
                            ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-200"
                            : h.category === "asig"
                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200"
                            : h.category === "vector"
                            ? "bg-purple-500/20 border-purple-500/30 text-purple-200"
                            : "bg-indigo-500/15 border-indigo-500/30 text-indigo-200";

                        return (
                          <span
                            key={idx}
                            className={`whitespace-nowrap px-2.5 py-1 rounded-md border font-mono text-[10px] font-medium shrink-0 ${colorClass}`}
                          >
                            {h.name}
                          </span>
                        );
                      })}
                      {exportPreviewLayout === "matriz" && (
                        <span className="text-[10px] text-slate-500 whitespace-nowrap italic px-2">
                          + columnas repetidas para Match 2, Match 3, ...
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Footer con resumen y atajos directos de descarga */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10 bg-slate-900/60 p-3 rounded-xl">
                <span className="text-xs text-slate-300">
                  Total configurado: <strong className="text-cyan-300">{totalSelectedExportCols}</strong> columnas activas para el archivo exportable.
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleExportDetailed("excel")}
                    disabled={totalSelectedExportCols === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition cursor-pointer shadow disabled:opacity-40"
                    title="Descargar listado relacional con las columnas seleccionadas (.xlsx)"
                  >
                    <Download className="h-3 w-3" />
                    <span>Descargar Detalle (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportDetailed("csv")}
                    disabled={totalSelectedExportCols === 0}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/30 transition cursor-pointer shadow disabled:opacity-40"
                    title="Descargar listado relacional con las columnas seleccionadas (.csv)"
                  >
                    <FileText className="h-3 w-3" />
                    <span>Detalle (.csv)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("excel")}
                    disabled={totalSelectedExportCols === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition cursor-pointer shadow disabled:opacity-40"
                    title="Descargar matriz con las columnas seleccionadas (.xlsx)"
                  >
                    <Download className="h-3 w-3" />
                    <span>Descargar Matriz (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("csv")}
                    disabled={totalSelectedExportCols === 0}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 transition cursor-pointer shadow disabled:opacity-40"
                    title="Descargar matriz con las columnas seleccionadas (.csv)"
                  >
                    <FileText className="h-3 w-3" />
                    <span>Matriz (.csv)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExportConfigOpen(false)}
                    className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                  >
                    Listo / Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Banner de Embeddings Descargables & Rate Limiter Gemini 2 */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-xs flex flex-wrap items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-2.5 text-slate-300">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <span className="font-semibold text-white">Descarga personalizada:</span>{" "}
                <span className="text-slate-400">
                  {isDocenteColSelected("Embedding Profesor") || isAsigColSelected("Embedding Asignatura")
                    ? "Los vectores 768d están seleccionados para exportarse. Puedes desmarcarlos arriba en 'Columnas a Exportar' para generar archivos ultra-ligeros."
                    : "Archivos optimizados: los vectores pesados están excluidos de la descarga. Puedes activarlos arriba en 'Columnas a Exportar'."}
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
                          {(result.profesor.nombre_profesor || "PR").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs sm:text-sm font-bold text-white">
                              {result.profesor.nombre_profesor || `Profesor ${profId}`}
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
                          <div className="flex items-center gap-2">
                            <div
                              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-bold font-mono ${scoreColor}`}
                            >
                              <Sparkles className="h-3 w-3" />
                              <span>Top: {(topScore * 100).toFixed(1)}%</span>
                            </div>

                            {/* Exportar únicamente este profesor con las columnas seleccionadas */}
                            <div
                              className="hidden sm:flex items-center bg-slate-900 border border-white/10 rounded-lg p-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleExportSingleProfessor(result, "excel", "detailed")}
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
                                title="Exportar asignaturas de este docente a Excel (.xlsx) con las columnas configuradas"
                              >
                                <Download className="h-2.5 w-2.5" />
                                <span>Excel</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportSingleProfessor(result, "csv", "detailed")}
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/20 transition cursor-pointer"
                                title="Exportar asignaturas de este docente a CSV (.csv) con las columnas configuradas"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                <span>CSV</span>
                              </button>
                            </div>
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
                              idColumn,
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
        profesores={fileRows.map((r, i) => {
          const actualId =
            (idColumn && r[idColumn] !== undefined && String(r[idColumn]).trim() !== "" ? r[idColumn] : undefined) ||
            r["ID Profesor"] ||
            r["id"] ||
            r["ID"] ||
            (i + 1);
          const actualName =
            (nameColumn && r[nameColumn] !== undefined && String(r[nameColumn]).trim() !== "" ? r[nameColumn] : undefined) ||
            r["Nombre Profesor"] ||
            r["nombre_profesor"] ||
            r["Nombre"] ||
            `Profesor ${actualId}`;
          return {
            ...r,
            id: actualId,
            nombre_profesor: actualName,
          };
        })}
      />
    </div>
  );
}
