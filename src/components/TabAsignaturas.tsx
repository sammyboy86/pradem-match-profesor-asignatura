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
  formatAsignaturaForEmbedding,
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
  });

  // Opciones de Carga
  const [generateEmbeddings, setGenerateEmbeddings] = useState(true);
  const [upsertMode, setUpsertMode] = useState<"upsert" | "insert">("upsert");

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
  const [isFixingMissingEmbeddings, setIsFixingMissingEmbeddings] = useState(false);

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
    if (!mapping.nombre) {
      alert("Debes mapear al menos la columna obligatoria 'Nombre de la Asignatura'.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(5);
    setStatusMessage("Preparando asignaturas para inserción...");
    setUploadReport(null);

    try {
      // Filtrar filas válidas que tengan nombre
      const validRows: Asignatura[] = [];
      const discardedRows: string[] = [];

      fileRows.forEach((row, idx) => {
        const nombreVal = mapping.nombre ? row[mapping.nombre]?.trim() : "";
        if (!nombreVal) {
          discardedRows.push(`Fila ${idx + 1}: Sin nombre de asignatura`);
          return;
        }

        validRows.push({
          nombre: nombreVal,
          clave: mapping.clave ? row[mapping.clave]?.trim() || null : null,
          fines_de_aprendizaje_o_formacion: mapping.fines_de_aprendizaje_o_formacion
            ? row[mapping.fines_de_aprendizaje_o_formacion]?.trim() || null
            : null,
          contenido_tematico: mapping.contenido_tematico
            ? row[mapping.contenido_tematico]?.trim() || null
            : null,
          actividades_de_aprendizaje: mapping.actividades_de_aprendizaje
            ? row[mapping.actividades_de_aprendizaje]?.trim() || null
            : null,
        });
      });

      if (!validRows.length) {
        throw new Error("No se encontraron filas con el nombre de asignatura especificado.");
      }

      // Generar embeddings si está habilitado
      if (generateEmbeddings) {
        setStatusMessage(`Generando embeddings (768d) para ${validRows.length} asignaturas con Gemini...`);
        const BATCH_SIZE = 15;
        const totalBatches = Math.ceil(validRows.length / BATCH_SIZE);

        for (let b = 0; b < totalBatches; b++) {
          const start = b * BATCH_SIZE;
          const end = Math.min(start + BATCH_SIZE, validRows.length);
          const currentBatch = validRows.slice(start, end);

          const textsToEmbed = currentBatch.map((item) => formatAsignaturaForEmbedding(item));

          setStatusMessage(
            `Generando embeddings: lote ${b + 1} de ${totalBatches} (${start + 1}-${end} de ${validRows.length})...`
          );
          setUploadProgress(10 + Math.round(((b + 0.5) / totalBatches) * 60));

          const embedRes = await apiFetch<{
            success: boolean;
            embeddings?: number[][];
            error?: string;
          }>("/api/embed", {
            method: "POST",
            body: JSON.stringify({ texts: textsToEmbed }),
          });

          if (!embedRes.success || !embedRes.embeddings) {
            throw new Error(embedRes.error || `Error al generar embeddings en lote ${b + 1}`);
          }

          // Asignar los embeddings calculados a cada asignatura
          embedRes.embeddings.forEach((emb, i) => {
            currentBatch[i].embedding_768 = emb;
          });
        }
      }

      // Guardar en Supabase vía /api/asignaturas en lotes de 50
      setStatusMessage("Guardando registros en la base de datos Supabase...");
      setUploadProgress(75);

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
        setUploadProgress(75 + Math.round(((i + 1) / totalDbBatches) * 25));
      }

      setUploadProgress(100);
      setStatusMessage("¡Carga completada exitosamente!");
      setUploadReport({
        total: fileRows.length,
        success: totalInserted,
        errors: discardedRows,
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

  // ── Generar Embeddings para Registros Pendientes en Supabase ──
  const handleGeneratePendingEmbeddings = async () => {
    if (withoutEmbeddingCount === 0) return;
    setIsFixingMissingEmbeddings(true);
    try {
      // 1. Obtener los registros sin embedding
      const res = await apiFetch<{
        success: boolean;
        records: any[];
      }>("/api/asignaturas?filter=without_embedding&limit=100");

      if (!res.records || !res.records.length) {
        alert("No se encontraron registros pendientes.");
        return;
      }

      const pending = res.records;
      const texts = pending.map((p) =>
        formatAsignaturaForEmbedding({
          nombre: p.nombre,
          clave: p.clave,
          contenido_tematico: p.contenido_tematico,
          fines_de_aprendizaje_o_formacion: p.fines_de_aprendizaje_o_formacion,
          actividades_de_aprendizaje: p.actividades_de_aprendizaje,
        })
      );

      // 2. Generar embeddings
      const embedRes = await apiFetch<{
        success: boolean;
        embeddings: number[][];
      }>("/api/embed", {
        method: "POST",
        body: JSON.stringify({ texts }),
      });

      if (!embedRes.embeddings) throw new Error("Fallo al obtener embeddings");

      // 3. Actualizar en Supabase
      const payload = pending.map((p, idx) => ({
        id: p.id,
        nombre: p.nombre,
        clave: p.clave,
        embedding_768: embedRes.embeddings[idx],
      }));

      await apiFetch("/api/asignaturas", {
        method: "POST",
        body: JSON.stringify({ asignaturas: payload, mode: "upsert" }),
      });

      await loadDatabaseRecords();
      alert(`¡Se generaron y guardaron embeddings para ${pending.length} asignaturas!`);
    } catch (err: any) {
      alert(`Error al generar embeddings pendientes: ${err.message}`);
    } finally {
      setIsFixingMissingEmbeddings(false);
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
      description: "Título o denominación de la materia (requerido para matching y embedding)",
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
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-indigo-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Mapeo de Columnas (Archivo ➔ Supabase)
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">
                  Verifica o cambia la correspondencia de cada campo
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
                {targetFields.map((field) => {
                  const currentValue = mapping[field.key] || "";
                  const sampleVal =
                    currentValue && fileRows.length > 0 ? fileRows[0][currentValue] : null;

                  return (
                    <div
                      key={field.key}
                      className="rounded-xl border border-white/10 bg-slate-900/90 p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                          {field.label}
                          {field.required && (
                            <span className="text-[10px] text-rose-400 font-bold">*</span>
                          )}
                        </label>
                        {currentValue && (
                          <span className="rounded bg-emerald-500/20 text-emerald-300 text-[10px] px-1.5 py-0.5 font-medium">
                            Mapeado
                          </span>
                        )}
                      </div>

                      <select
                        value={currentValue}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">-- No mapear / Omitir --</option>
                        {fileHeaders.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>

                      {sampleVal && (
                        <p className="text-[10px] text-slate-400 truncate font-mono bg-white/5 p-1.5 rounded">
                          <span className="text-slate-500">Muestra:</span> {sampleVal}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Vista Previa de Filas Mapeadas */}
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
                      <th className="px-3 py-2">Clave</th>
                      <th className="px-3 py-2">Nombre de Asignatura</th>
                      <th className="px-3 py-2">Contenido Temático</th>
                      <th className="px-3 py-2">Objetivos / Fines</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {fileRows.slice(0, 4).map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-mono text-indigo-300">
                          {mapping.clave ? row[mapping.clave] || "—" : "—"}
                        </td>
                        <td className="px-3 py-2 font-medium text-white">
                          {mapping.nombre ? row[mapping.nombre] || "—" : "—"}
                        </td>
                        <td className="px-3 py-2 truncate max-w-xs text-slate-400">
                          {mapping.contenido_tematico ? row[mapping.contenido_tematico] || "—" : "—"}
                        </td>
                        <td className="px-3 py-2 truncate max-w-xs text-slate-400">
                          {mapping.fines_de_aprendizaje_o_formacion
                            ? row[mapping.fines_de_aprendizaje_o_formacion] || "—"
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Opciones y Acción de Subida */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-indigo-950/20 p-4">
              <div className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-white">
                  <input
                    type="checkbox"
                    checked={generateEmbeddings}
                    onChange={(e) => setGenerateEmbeddings(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                    Generar embeddings multimodales (768d) con Gemini 2 antes de insertar
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 pl-6">
                  Calcula el vector de similitud para cada programa de estudio garantizando matching instantáneo.
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
            {withoutEmbeddingCount > 0 && (
              <button
                type="button"
                onClick={handleGeneratePendingEmbeddings}
                disabled={isFixingMissingEmbeddings}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-3.5 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/30 transition disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {isFixingMissingEmbeddings
                    ? "Generando..."
                    : `Vectorizar ${withoutEmbeddingCount} pendientes`}
                </span>
              </button>
            )}

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
