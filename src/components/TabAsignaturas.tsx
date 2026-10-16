"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Database,
  Search,
  RefreshCw,
  Trash2,
  Layers,
  ArrowRight,
  Eye,
  Sliders,
  Check,
  ChevronDown,
  Info,
} from "lucide-react";
import { Asignatura, ColumnMapping } from "@/types";
import {
  parseSpreadsheetFile,
  parseEmbeddingValue,
  apiFetch,
} from "@/lib/utils";

interface TabAsignaturasProps {
  onDatabaseUpdated?: () => void;
  onOpenSqlModal: () => void;
}

export default function TabAsignaturas({
  onDatabaseUpdated,
  onOpenSqlModal,
}: TabAsignaturasProps) {
  // ── Estados de Archivo y Mapeo ──
  const [file, setFile] = useState<File | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileRows, setFileRows] = useState<Record<string, string>[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mapeo de columnas
  const [mapping, setMapping] = useState<ColumnMapping>({
    clave: "",
    nombre: "",
    fines_de_aprendizaje_o_formacion: "",
    contenido_tematico: "",
    actividades_de_aprendizaje: "",
    embedding_768: "",
  });

  // Opciones de Carga
  const [upsertMode, setUpsertMode] = useState<"upsert" | "insert">("upsert");
  const [showAdvancedMapping, setShowAdvancedMapping] = useState(false);

  // Progreso de Carga
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [uploadReport, setUploadReport] = useState<{
    total: number;
    success: number;
    errors: string[];
  } | null>(null);

  // ── Estados del Catálogo Existente en Supabase ──
  const [dbRecords, setDbRecords] = useState<
    Array<{
      id: number;
      clave: string | null;
      nombre: string;
      contenido_tematico: string | null;
      hasEmbedding: boolean;
      created_at: string;
    }>
  >([]);
  const [totalDbCount, setTotalDbCount] = useState(0);
  const [withEmbeddingCount, setWithEmbeddingCount] = useState(0);
  const [withoutEmbeddingCount, setWithoutEmbeddingCount] = useState(0);
  const [tableExists, setTableExists] = useState<boolean | null>(null);
  const [loadingDb, setLoadingDb] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "with_embedding" | "without_embedding">("all");

  // ── Cargar Registros de Supabase ──
  const loadDatabaseRecords = useCallback(async () => {
    setLoadingDb(true);
    try {
      const data = await apiFetch<{
        success: boolean;
        tableExists: boolean;
        totalCount: number;
        withEmbeddingCount: number;
        withoutEmbeddingCount: number;
        records: any[];
        error?: string;
      }>(`/api/asignaturas?q=${encodeURIComponent(searchQuery)}&filter=${filterType}&limit=50`);

      if (data.tableExists === false) {
        setTableExists(false);
      } else {
        setTableExists(true);
        setTotalDbCount(data.totalCount || 0);
        setWithEmbeddingCount(data.withEmbeddingCount || 0);
        setWithoutEmbeddingCount(data.withoutEmbeddingCount || 0);
        setDbRecords(data.records || []);
      }
    } catch (err) {
      console.error("Error al cargar asignaturas de Supabase:", err);
      setTableExists(false);
    } finally {
      setLoadingDb(false);
    }
  }, [searchQuery, filterType]);

  useEffect(() => {
    loadDatabaseRecords();
  }, [loadDatabaseRecords]);

  // ── Auto-Detección Inteligente de Columnas ──
  const detectColumns = (headers: string[]): ColumnMapping => {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");

    const findMatch = (candidates: string[]) => {
      for (const cand of candidates) {
        const found = headers.find((h) => normalize(h).includes(normalize(cand)));
        if (found) return found;
      }
      return "";
    };

    return {
      nombre: findMatch(["nombre", "asignatura", "materia", "unidad", "curso", "title"]),
      clave: findMatch(["clave", "codigo", "code", "id", "cod"]),
      embedding_768: findMatch([
        "embedding768",
        "embedding_768",
        "embeddings",
        "embedding",
        "vector768",
        "vector_768",
        "vector",
        "vectores",
        "emb",
        "representation",
        "representacion",
      ]),
      fines_de_aprendizaje_o_formacion: findMatch([
        "fines",
        "objetivo",
        "proposito",
        "competencias",
        "aprendizaje",
      ]),
      contenido_tematico: findMatch([
        "contenido",
        "tematico",
        "temario",
        "temas",
        "unidades",
        "syllabus",
      ]),
      actividades_de_aprendizaje: findMatch([
        "actividades",
        "estrategias",
        "tareas",
        "metodologia",
      ]),
    };
  };

  // ── Manejo de Archivo ──
  const handleFileSelected = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsParsing(true);
    setUploadReport(null);
    try {
      const { headers, rows } = await parseSpreadsheetFile(selectedFile);
      setFileHeaders(headers);
      setFileRows(rows);
      const autoMapping = detectColumns(headers);
      setMapping(autoMapping);
    } catch (err: any) {
      alert(err.message || "Error al procesar el archivo");
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

  // ── Ejecutar Carga a Supabase ──
  const handleUploadToSupabase = async () => {
    // Detectar columna de nombre automáticamente si no se mapeó explícitamente
    const detectedNombreCol =
      mapping.nombre ||
      fileHeaders.find((h) => {
        const n = h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return n.includes("nombre") || n.includes("asignatura") || n.includes("materia");
      }) ||
      fileHeaders.find((h) => h !== mapping.embedding_768) ||
      fileHeaders[0];

    setIsUploading(true);
    setUploadProgress(10);
    setStatusMessage("Preparando todas las columnas para inserción en Supabase...");
    setUploadReport(null);

    try {
      // Filtrar filas válidas incluyendo TODAS las columnas del CSV
      const validRows: Asignatura[] = [];
      const discardedRows: string[] = [];
      let parsedEmbeddingsCount = 0;
      let invalidEmbeddingsCount = 0;

      fileRows.forEach((row, idx) => {
        const rawNombre = detectedNombreCol ? row[detectedNombreCol]?.trim() : "";
        if (!rawNombre) {
          discardedRows.push(`Fila ${idx + 1}: Sin nombre de asignatura`);
          return;
        }

        // Subir TODAS las columnas del CSV por defecto
        const rowData: Record<string, any> = { ...row };

        // Asegurar que 'nombre' esté presente
        rowData.nombre = rawNombre;

        // Si hay mapeo de clave específico
        if (mapping.clave && row[mapping.clave]) {
          rowData.clave = row[mapping.clave].trim();
        }

        // Si hay mapeos explícitos opcionales
        if (mapping.contenido_tematico && row[mapping.contenido_tematico]) {
          rowData.contenido_tematico = row[mapping.contenido_tematico].trim();
        }
        if (mapping.fines_de_aprendizaje_o_formacion && row[mapping.fines_de_aprendizaje_o_formacion]) {
          rowData.fines_de_aprendizaje_o_formacion = row[mapping.fines_de_aprendizaje_o_formacion].trim();
        }
        if (mapping.actividades_de_aprendizaje && row[mapping.actividades_de_aprendizaje]) {
          rowData.actividades_de_aprendizaje = row[mapping.actividades_de_aprendizaje].trim();
        }

        // Parsear embedding de la columna seleccionada
        if (mapping.embedding_768 && row[mapping.embedding_768]) {
          const parsedEmb = parseEmbeddingValue(row[mapping.embedding_768]);
          if (parsedEmb) {
            rowData.embedding_768 = parsedEmb;
            parsedEmbeddingsCount++;
          } else {
            invalidEmbeddingsCount++;
          }

          // Si el header del archivo no se llamaba 'embedding_768', remover el valor string original
          if (mapping.embedding_768 !== "embedding_768") {
            delete rowData[mapping.embedding_768];
          }
        }

        validRows.push(rowData as Asignatura);
      });

      if (!validRows.length) {
        throw new Error("No se encontraron filas con el nombre de asignatura especificado.");
      }

      // Guardar directamente en Supabase vía /api/asignaturas en lotes de 50
      setStatusMessage(
        `Guardando ${validRows.length} registros en Supabase (${parsedEmbeddingsCount} con vector)...`
      );
      setUploadProgress(25);

      const DB_BATCH_SIZE = 50;
      const totalDbBatches = Math.ceil(validRows.length / DB_BATCH_SIZE);
      let totalInserted = 0;

      for (let i = 0; i < totalDbBatches; i++) {
        const batchSlice = validRows.slice(i * DB_BATCH_SIZE, (i + 1) * DB_BATCH_SIZE);

        const res = await apiFetch<{
          success: boolean;
          count: number;
          error?: string;
        }>("/api/asignaturas", {
          method: "POST",
          body: JSON.stringify({
            asignaturas: batchSlice,
            mode: upsertMode,
          }),
        });

        if (!res.success) {
          throw new Error(res.error || `Error al guardar lote ${i + 1} en Supabase`);
        }

        totalInserted += res.count || batchSlice.length;
        setUploadProgress(25 + Math.round(((i + 1) / totalDbBatches) * 75));
      }

      setUploadProgress(100);
      setStatusMessage("¡Carga completada exitosamente!");

      const observations: string[] = [...discardedRows];
      if (mapping.embedding_768) {
        if (invalidEmbeddingsCount > 0) {
          observations.push(
            `Aviso: En ${invalidEmbeddingsCount} filas no se pudo parsear el vector de la columna '${mapping.embedding_768}'.`
          );
        }
        observations.push(
          `Embeddings leídos del CSV: ${parsedEmbeddingsCount} de ${validRows.length} asignaturas guardadas.`
        );
      } else {
        observations.push(
          "No se asignó columna de embeddings. Las asignaturas se guardaron sin vector."
        );
      }

      setUploadReport({
        total: fileRows.length,
        success: totalInserted,
        errors: observations,
      });

      // Refrescar catálogo de Supabase
      await loadDatabaseRecords();
      if (onDatabaseUpdated) onDatabaseUpdated();
    } catch (err: any) {
      console.error("Error al cargar a Supabase:", err);
      setStatusMessage(`Error: ${err.message || "Fallo en el proceso"}`);
      setUploadReport({
        total: fileRows.length,
        success: 0,
        errors: [err.message || "Error desconocido al procesar asignaturas"],
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Limpiar catálogo de prueba
  const handleClearDatabase = async () => {
    if (
      !confirm(
        "¿Estás seguro de que deseas eliminar todas las asignaturas de la base de datos? Esta acción es irreversible."
      )
    ) {
      return;
    }

    try {
      await apiFetch("/api/asignaturas?clearAll=true", { method: "DELETE" });
      await loadDatabaseRecords();
    } catch (err: any) {
      alert(`Error al limpiar catálogo: ${err.message}`);
    }
  };

  // Inspección de la columna de embeddings seleccionada para feedback en tiempo real
  const embeddingSample = React.useMemo(() => {
    if (!mapping.embedding_768 || fileRows.length === 0) return null;
    const rawVal = fileRows[0][mapping.embedding_768];
    if (!rawVal) return { status: "empty", length: 0, preview: "" };
    const parsed = parseEmbeddingValue(rawVal);
    if (!parsed) {
      return {
        status: "invalid",
        length: 0,
        preview: String(rawVal).slice(0, 80),
      };
    }
    return {
      status: parsed.length === 768 ? "valid_768" : "valid_other",
      length: parsed.length,
      preview: `[${parsed.slice(0, 3).map((n) => n.toFixed(4)).join(", ")}... +${parsed.length - 3} floats]`,
    };
  }, [mapping.embedding_768, fileRows]);

  // Columnas esperadas en Supabase con sus etiquetas y descripciones
  const targetFields: Array<{
    key: keyof ColumnMapping;
    label: string;
    required: boolean;
    description: string;
  }> = [
    {
      key: "nombre",
      label: "Nombre de la Asignatura",
      required: true,
      description: "Título o denominación de la materia (requerido para matching)",
    },
    {
      key: "embedding_768",
      label: "Columna de Embeddings / Vector (768d)",
      required: false,
      description: "Columna del CSV con el vector precalculado (ej. [0.012, -0.045, ...])",
    },
    {
      key: "clave",
      label: "Clave / Código",
      required: false,
      description: "Identificador único de la asignatura (utilizado como clave de conflicto en Upsert)",
    },
    {
      key: "contenido_tematico",
      label: "Contenido Temático / Temario",
      required: false,
      description: "Unidades temáticas, syllabus o temas principales",
    },
    {
      key: "fines_de_aprendizaje_o_formacion",
      label: "Fines de Aprendizaje / Objetivos",
      required: false,
      description: "Objetivos generales, competencias o fines formativos",
    },
    {
      key: "actividades_de_aprendizaje",
      label: "Actividades de Aprendizaje",
      required: false,
      description: "Estrategias didácticas, prácticas o talleres",
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── ALERTA SI LA TABLA NO EXISTE EN SUPABASE ── */}
      {tableExists === false && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-200">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 flex-shrink-0 text-amber-400" />
            <div>
              <h4 className="font-semibold text-white text-sm">
                Tabla &apos;asignaturas&apos; o extensión pgvector no inicializada
              </h4>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Debes ejecutar el script de migración SQL en Supabase para crear la tabla y habilitar vectores de 768 dimensiones.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSqlModal}
            className="flex-shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20"
          >
            Ver Script SQL y Copiar
          </button>
        </div>
      )}

      {/* ── SECCIÓN 1: SUBIDA Y MAPEO DE ASIGNATURAS ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400 border border-indigo-500/20">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Carga Masiva de Programas de Asignaturas
              </h2>
              <p className="text-xs text-slate-400">
                Sube tu catálogo en formato <code className="text-indigo-300">.csv</code>, <code className="text-indigo-300">.xlsx</code> o <code className="text-indigo-300">.xls</code>
              </p>
            </div>
          </div>

          {file && (
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300">
                {fileRows.length} registros cargados
              </span>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setFileRows([]);
                  setFileHeaders([]);
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
              Arrastra tu archivo aquí o haz clic para examinar
            </h3>
            <p className="mt-1 text-xs text-slate-400 max-w-sm">
              Soporta archivos de Excel (.xlsx, .xls) y CSV estructurados con columnas de asignatura, temario y objetivos.
            </p>
          </div>
        ) : (
          /* Mapeador de Columnas Interactivo */
          <div className="space-y-6">
            {/* 1. SELECCIÓN DESTACADA DE LA COLUMNA DE EMBEDDINGS */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-5 space-y-4 shadow-lg shadow-purple-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-purple-500/20 p-2 text-purple-300 border border-purple-500/30">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      Columna de Embeddings / Vector (768d)
                      <span className="text-[10px] rounded-full bg-purple-500/30 px-2 py-0.5 text-purple-200 border border-purple-400/30 font-semibold">
                        Requerida para matching
                      </span>
                    </h3>
                    <p className="text-xs text-purple-200/70">
                      Selecciona cuál de las columnas del CSV contiene los vectores precalculados.
                    </p>
                  </div>
                </div>

                {mapping.embedding_768 && (
                  <span className="rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-200 text-xs px-2.5 py-1 font-mono font-semibold">
                    Columna activa: {mapping.embedding_768}
                  </span>
                )}
              </div>

              {/* Selector principal de la columna de embedding */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">
                    Columna con los embeddings del CSV:
                  </label>
                  <select
                    value={mapping.embedding_768 || ""}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, embedding_768: e.target.value }))
                    }
                    className="w-full rounded-xl border border-purple-400/30 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-medium"
                  >
                    <option value="">-- Seleccionar columna de embeddings (o ninguna) --</option>
                    {fileHeaders.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Panel de validación visual del vector */}
                <div>
                  {embeddingSample ? (
                    <div className="space-y-1.5 pt-1">
                      {embeddingSample.status === "valid_768" && (
                        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-medium">
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                          <div>
                            <p className="font-bold">¡Vector compatible detectado!</p>
                            <p className="text-[11px] text-emerald-400/80">
                              768 dimensiones numéricas confirmadas en la muestra de la primera fila.
                            </p>
                          </div>
                        </div>
                      )}
                      {embeddingSample.status === "valid_other" && (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 font-medium">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          <div>
                            <p className="font-bold">{embeddingSample.length} dimensiones detectadas</p>
                            <p className="text-[11px] text-amber-400/80">
                              Supabase espera un vector de 768 dimensiones.
                            </p>
                          </div>
                        </div>
                      )}
                      {embeddingSample.status === "invalid" && (
                        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          <div>
                            <p className="font-bold">Formato de vector no reconocido</p>
                            <p className="text-[11px] text-rose-400/80">
                              No se pudieron extraer números flotantes de la celda de muestra.
                            </p>
                          </div>
                        </div>
                      )}
                      {embeddingSample.preview && (
                        <p className="text-[10px] text-slate-400 truncate font-mono bg-white/5 p-2 rounded-lg border border-white/5">
                          <span className="text-slate-500 font-sans">Muestra fila 1:</span> {embeddingSample.preview}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-400">
                      <p className="text-slate-300 font-medium">Ninguna columna seleccionada como vector</p>
                      <p className="text-[11px] mt-0.5">
                        Si tu CSV no contiene embeddings, las asignaturas se cargarán como texto plano.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Badges para seleccionar columna de vector con un clic */}
              <div className="pt-2 border-t border-purple-500/20 space-y-1.5">
                <span className="text-[11px] font-medium text-purple-200/80">
                  Haz clic en cualquier columna del archivo para asignarla como vector:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {fileHeaders.map((header) => {
                    const isEmbedding = header === mapping.embedding_768;
                    return (
                      <button
                        key={header}
                        type="button"
                        onClick={() => {
                          setMapping((prev) => ({
                            ...prev,
                            embedding_768: prev.embedding_768 === header ? "" : header,
                          }));
                        }}
                        className={`rounded-lg px-2.5 py-1 text-xs font-mono border transition flex items-center gap-1.5 ${
                          isEmbedding
                            ? "border-purple-400 bg-purple-500/30 text-white font-bold shadow-md shadow-purple-500/30 ring-1 ring-purple-400"
                            : "border-white/10 bg-white/5 text-slate-300 hover:border-purple-500/40 hover:text-white"
                        }`}
                      >
                        <span>{header}</span>
                        {isEmbedding && (
                          <span className="rounded bg-purple-400/30 text-purple-200 text-[10px] px-1 font-sans">
                            Vector ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2. TODAS LAS COLUMNAS A SUBIR POR DEFECTO */}
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Se subirán automáticamente TODAS las columnas del archivo ({fileHeaders.length}):
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdvancedMapping((prev) => !prev)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
                >
                  {showAdvancedMapping ? "Ocultar mapeo manual" : "Mapeo manual avanzado (opcional)"}
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {fileHeaders.map((header) => {
                  const isEmbedding = header === mapping.embedding_768;
                  return (
                    <span
                      key={header}
                      className={`rounded-lg px-2.5 py-1 text-xs font-mono border ${
                        isEmbedding
                          ? "border-purple-500/60 bg-purple-500/25 text-purple-200 font-bold"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-medium"
                      }`}
                    >
                      {header}
                      {isEmbedding && " (Vector 768d)"}
                    </span>
                  );
                })}
              </div>

              {/* Mapeo manual opcional */}
              {showAdvancedMapping && (
                <div className="pt-4 border-t border-white/10 space-y-3 animate-in fade-in">
                  <p className="text-[11px] text-slate-400">
                    Por defecto las columnas se asocian automáticamente con la tabla. Solo utiliza estos selectores si los nombres en tu archivo difieren significativamente.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {targetFields.map((field) => (
                      <div key={field.key} className="rounded-lg border border-white/10 bg-slate-900/90 p-3 space-y-1.5">
                        <label className="text-xs font-semibold text-white">{field.label}</label>
                        <select
                          value={mapping[field.key] || ""}
                          onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          className="w-full rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">-- Detección automática --</option>
                          {fileHeaders.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 3. VISTA PREVIA DE FILAS */}
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Eye className="h-3.5 w-3.5 text-indigo-400" />
                  Previsualización de datos a cargar (Primeras 4 filas)
                </span>
                <span>Total a procesar: {fileRows.length} asignaturas</span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      {fileHeaders.slice(0, 6).map((h) => (
                        <th key={h} className="px-3 py-2">
                          {h}
                          {h === mapping.embedding_768 && (
                            <span className="ml-1 text-purple-300 font-bold">(Vector)</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {fileRows.slice(0, 4).map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        {fileHeaders.slice(0, 6).map((h) => {
                          const val = row[h];
                          const isEmbedding = h === mapping.embedding_768;
                          if (isEmbedding) {
                            const parsed = val ? parseEmbeddingValue(val) : null;
                            return (
                              <td key={h} className="px-3 py-2 font-mono text-xs">
                                {parsed ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {parsed.length}d ✓
                                  </span>
                                ) : val ? (
                                  <span className="text-amber-400 text-[10px]">No válido</span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                            );
                          }
                          return (
                            <td key={h} className="px-3 py-2 truncate max-w-xs font-mono text-slate-300">
                              {val || "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Opciones y Acción de Subida */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-indigo-950/20 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Database className="h-4 w-4 text-indigo-400" />
                  <span>Carga directa de catálogo con embeddings</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {mapping.embedding_768
                    ? `Los embeddings se leerán directamente de la columna '${mapping.embedding_768}' del archivo.`
                    : "No se seleccionó columna de embeddings. Las materias se guardarán sin vector."}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={upsertMode}
                  onChange={(e) => setUpsertMode(e.target.value as "upsert" | "insert")}
                  className="rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs text-white"
                >
                  <option value="upsert">Modo: Upsert (Actualizar por clave)</option>
                  <option value="insert">Modo: Insert (Siempre nuevo registro)</option>
                </select>

                <button
                  type="button"
                  disabled={isUploading || !mapping.nombre}
                  onClick={handleUploadToSupabase}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50 transition"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Procesando ({uploadProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Database className="h-4 w-4" />
                      <span>Cargar a Supabase</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Barra de Progreso Interactiva */}
            {isUploading && (
              <div className="space-y-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 animate-in fade-in">
                <div className="flex items-center justify-between text-xs font-medium text-indigo-200">
                  <span>{statusMessage}</span>
                  <span className="font-mono">{uploadProgress}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-900">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Reporte de Carga */}
            {uploadReport && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Reporte de Operación:</span>
                </div>
                <p className="text-slate-300">
                  Se insertaron exitosamente <strong className="text-white">{uploadReport.success}</strong> de{" "}
                  <strong>{uploadReport.total}</strong> asignaturas en Supabase.
                </p>
                {uploadReport.errors.length > 0 && (
                  <div className="mt-2 text-rose-300 text-[11px] space-y-1">
                    <p className="font-semibold">Filas descartadas u observaciones:</p>
                    <ul className="list-disc pl-5 max-h-24 overflow-y-auto">
                      {uploadReport.errors.map((e, idx) => (
                        <li key={idx}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── SECCIÓN 2: CATÁLOGO Y GESTIÓN EN SUPABASE ── */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-indigo-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Catálogo de Asignaturas en Supabase
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Registros almacenados en la tabla <code className="text-amber-300 font-mono">public.asignaturas</code> con vectorización HNSW
            </p>
          </div>

          <div className="flex items-center gap-3">

            <button
              type="button"
              onClick={loadDatabaseRecords}
              className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10 hover:text-white transition"
              title="Recargar catálogo"
            >
              <RefreshCw className={`h-4 w-4 ${loadingDb ? "animate-spin" : ""}`} />
            </button>

            {totalDbCount > 0 && (
              <button
                type="button"
                onClick={handleClearDatabase}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20 transition"
                title="Limpiar todas las asignaturas de la base de datos"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tarjetas de Métricas de Base de Datos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <span className="text-xs text-slate-400">Total en Base de Datos</span>
            <p className="text-2xl font-bold font-mono text-white mt-1">
              {loadingDb ? "..." : totalDbCount}
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <span className="text-xs text-emerald-400">Con Embeddings (768d)</span>
            <p className="text-2xl font-bold font-mono text-emerald-300 mt-1">
              {loadingDb ? "..." : withEmbeddingCount}
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
            <span className="text-xs text-amber-400">Sin Embeddings (Pendientes)</span>
            <p className="text-2xl font-bold font-mono text-amber-300 mt-1">
              {loadingDb ? "..." : withoutEmbeddingCount}
            </p>
          </div>
        </div>

        {/* Filtros y Búsqueda */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre o clave de asignatura..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-slate-950 pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950 p-1 text-xs">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                filterType === "all" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Todos ({totalDbCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("with_embedding")}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                filterType === "with_embedding"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-400 hover:text-emerald-300"
              }`}
            >
              Con Vector ({withEmbeddingCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("without_embedding")}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                filterType === "without_embedding"
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-slate-400 hover:text-amber-300"
              }`}
            >
              Pendientes ({withoutEmbeddingCount})
            </button>
          </div>
        </div>

        {/* Tabla del Catálogo */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/10">
                <tr>
                  <th className="px-4 py-3">ID / Clave</th>
                  <th className="px-4 py-3">Nombre Asignatura</th>
                  <th className="px-4 py-3">Contenido Temático</th>
                  <th className="px-4 py-3 text-center">Estado Vectorial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {loadingDb ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-indigo-400" />
                      Cargando asignaturas de Supabase...
                    </td>
                  </tr>
                ) : dbRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No se encontraron asignaturas registradas. Carga tu archivo arriba para comenzar.
                    </td>
                  </tr>
                ) : (
                  dbRecords.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono">
                        <span className="text-indigo-300 font-semibold">{item.clave || `ID-${item.id}`}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-white max-w-sm">
                        {item.nombre}
                      </td>
                      <td className="px-4 py-3 truncate max-w-md text-slate-400">
                        {item.contenido_tematico || "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.hasEmbedding ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            <Sparkles className="h-2.5 w-2.5" />
                            768d ✓
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                            Sin vector
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
