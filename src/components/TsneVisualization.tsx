"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Sparkles,
  Sliders,
  RefreshCw,
  Search,
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info,
  Compass,
} from "lucide-react";
import { computeTSNE, TsnePoint } from "@/lib/tsne";

interface TsneVisualizationProps {
  records: Array<Record<string, unknown>>;
  embeddingColumn: string;
  labelColumn: string;
  categoryColumn?: string;
  matchedIds?: number[];
  queryText?: string;
  queryVector?: number[] | null;
}

// Paleta de colores vibrantes para departamentos o categorías
const CATEGORY_COLORS = [
  "#38bdf8", // Sky
  "#a855f7", // Purple
  "#34d399", // Emerald
  "#fbbf24", // Amber
  "#f43f5e", // Rose
  "#818cf8", // Indigo
  "#2dd4bf", // Teal
  "#fb923c", // Orange
  "#c084fc", // Violet
  "#4ade80", // Green
  "#94a3b8", // Slate
];

export default function TsneVisualization({
  records,
  embeddingColumn,
  labelColumn,
  categoryColumn = "departamento",
  matchedIds = [],
  queryText,
  queryVector,
}: TsneVisualizationProps) {
  // Opciones del algoritmo t-SNE
  const [perplexity, setPerplexity] = useState<number>(15);
  const [iterations, setIterations] = useState<number>(250);
  const [isComputing, setIsComputing] = useState<boolean>(false);
  const [points, setPoints] = useState<TsnePoint[]>([]);

  // Filtros y estados interactivos
  const [hoveredPoint, setHoveredPoint] = useState<TsnePoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<TsnePoint | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [zoom, setZoom] = useState<number>(1);

  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Extraer registros válidos que tengan el vector de embeddings
  const validRecords = useMemo(() => {
    return records.filter((r) => {
      const vec = r[embeddingColumn];
      if (vec === null || vec === undefined) return false;
      if (Array.isArray(vec)) return vec.length > 0;
      if (typeof vec === "string") {
        const trimmed = vec.trim();
        return trimmed.startsWith("[") && trimmed.length > 2;
      }
      if (typeof vec === "object") {
        return Object.keys(vec).length > 0;
      }
      return false;
    });
  }, [records, embeddingColumn]);

  // 2. Extraer categorías únicas para la leyenda
  const { categories, categoryColorMap } = useMemo(() => {
    const cats = new Set<string>();
    validRecords.forEach((r) => {
      const cat = String(r[categoryColumn] || r.departamento || "General").trim();
      if (cat) cats.add(cat);
    });
    const catList = Array.from(cats);
    const map: Record<string, string> = {};
    catList.forEach((cat, idx) => {
      map[cat] = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
    });
    return { categories: catList, categoryColorMap: map };
  }, [validRecords, categoryColumn]);

  // 3. Ejecutar algoritmo t-SNE
  const runTsne = () => {
    if (validRecords.length === 0) {
      setPoints([]);
      return;
    }

    setIsComputing(true);

    // Usar setTimeout para permitir que la UI muestre el estado de carga
    setTimeout(() => {
      try {
        const rawVectors: number[][] = [];
        const metadataList: Array<{
          id: number | string;
          label: string;
          category: string;
          code?: string;
          credits?: number;
          raw: Record<string, unknown>;
        }> = [];

        for (const r of validRecords) {
          let vec = r[embeddingColumn];
          if (typeof vec === "string") {
            try {
              vec = JSON.parse(vec);
            } catch {
              continue;
            }
          } else if (vec && typeof vec === "object" && !Array.isArray(vec)) {
            vec = Object.values(vec);
          }
          if (Array.isArray(vec) && vec.length > 0) {
            rawVectors.push(vec);
            metadataList.push({
              id: (r.id as number | string) || Math.random(),
              label: String(r[labelColumn] || r.nombre || `ID ${r.id}`),
              category: String(r[categoryColumn] || r.departamento || "General"),
              code: (r.codigo as string) || undefined,
              credits: (r.creditos as number) || undefined,
              raw: r,
            });
          }
        }

        // Si tenemos un queryVector del profesor, lo proyectamos junto a las asignaturas
        const hasQuery = queryVector && Array.isArray(queryVector) && queryVector.length > 0;
        if (hasQuery) {
          rawVectors.push(queryVector);
          metadataList.push({
            id: "QUERY_PROFESOR",
            label: `🎯 Profesor: ${queryText || "Consulta"}`,
            category: "Consulta Profesor",
            code: "DOCENTE",
            raw: { isQuery: true },
          });
        }

        const coords = computeTSNE(rawVectors, {
          perplexity,
          iterations,
          metric: "cosine",
        });

        const newPoints: TsnePoint[] = coords.map(([x, y], idx) => {
          const meta = metadataList[idx];
          return {
            id: meta.id,
            x,
            y,
            label: meta.label,
            category: meta.category,
            code: meta.code,
            credits: meta.credits,
            rawRecord: meta.raw,
          };
        });

        setPoints(newPoints);
      } catch (err) {
        console.error("Error al calcular t-SNE:", err);
      } finally {
        setIsComputing(false);
      }
    }, 50);
  };

  // Recalcular cuando cambien los registros válidos o el vector del profesor
  useEffect(() => {
    runTsne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRecords.length, embeddingColumn, queryVector]);

  // Dimensiones del gráfico SVG
  const width = 850;
  const height = 500;
  const cx = width / 2;
  const cy = height / 2;

  // Filtrado de puntos según búsqueda y categoría seleccionada
  const visiblePoints = useMemo(() => {
    return points.map((p) => {
      const matchesSearch =
        !searchTerm.trim() ||
        p.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.code && p.code.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCat = !filterCategory || p.category === filterCategory;
      const isMatched = matchedIds.includes(Number(p.id));
      const isQuery = p.id === "QUERY_PROFESOR";

      return {
        ...p,
        isDimmed: !matchesSearch || (!matchesCat && !isQuery && !isMatched),
        isMatched,
        isQuery,
      };
    });
  }, [points, searchTerm, filterCategory, matchedIds]);

  // Punto del profesor si existe
  const queryPoint = useMemo(() => {
    return visiblePoints.find((p) => p.isQuery);
  }, [visiblePoints]);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-md shadow-2xl space-y-6">
      {/* ── Encabezado y Controles Rápidos ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Compass className="h-5 w-5 text-indigo-400" />
            Mapa Semántico 2D (t-SNE Embeddings)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Proyección no-lineal en 2D de los embeddings de 768 dimensiones. Las asignaturas afines o con contenidos cercanos forman clusters visuales.
          </p>
        </div>

        {/* Controles de Zoom y Recálculo */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 text-xs">
            <button
              onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition"
              title="Acercar"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(z - 0.2, 0.6))}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition"
              title="Alejar"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setFilterCategory(null);
                setSearchTerm("");
              }}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition"
              title="Restablecer Vista"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={runTsne}
            disabled={isComputing || validRecords.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-600/20 px-3.5 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/30 hover:text-white transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isComputing ? "animate-spin text-indigo-400" : ""}`} />
            {isComputing ? "Proyectando..." : "Recalcular t-SNE"}
          </button>
        </div>
      </div>

      {/* ── Parámetros y Búsqueda ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Buscador de Asignatura */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Resaltar asignatura o código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-900/80 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Perplejidad Slider */}
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-300">
          <Sliders className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
          <span className="text-[11px] text-slate-400">Perplejidad:</span>
          <input
            type="range"
            min={5}
            max={40}
            step={1}
            value={perplexity}
            onChange={(e) => setPerplexity(Number(e.target.value))}
            className="flex-1 accent-indigo-500 cursor-pointer h-1.5"
          />
          <span className="font-mono text-indigo-400 font-bold text-xs w-6 text-right">
            {perplexity}
          </span>
        </div>

        {/* Total Vectorizados Info */}
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/50 px-3.5 py-1.5 text-xs">
          <span className="text-slate-400">Puntos en Gráfica:</span>
          <span className="font-bold text-emerald-400 font-mono">
            {validRecords.length} asignaturas
          </span>
        </div>
      </div>

      {/* ── Lienzo SVG Interactivo del Gráfico 2D ── */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-950 via-slate-900 to-black p-2 select-none"
        style={{ minHeight: "480px" }}
      >
        {/* Cuadrícula de fondo sutil */}
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:20px_20px]" />

        {validRecords.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
            <Info className="h-10 w-10 text-slate-500 mb-2" />
            <h4 className="text-sm font-semibold text-slate-300">
              No hay embeddings para graficar
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              Selecciona una columna que contenga vectores generados o genera embeddings en la pestaña &ldquo;Generador embeddings&rdquo;.
            </p>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-[480px] overflow-visible"
          >
            {/* Ejes guía en el origen (0, 0) */}
            <g opacity="0.12" stroke="white" strokeDasharray="3 3">
              <line x1={0} y1={cy} x2={width} y2={cy} />
              <line x1={cx} y1={0} x2={cx} y2={height} />
            </g>

            {/* Líneas conectoras desde la consulta del profesor hacia sus mejores matches */}
            {queryPoint &&
              visiblePoints
                .filter((p) => p.isMatched && !p.isQuery)
                .map((matchPoint) => {
                  const x1 = cx + queryPoint.x * 2.8 * zoom;
                  const y1 = cy + queryPoint.y * 2.8 * zoom;
                  const x2 = cx + matchPoint.x * 2.8 * zoom;
                  const y2 = cy + matchPoint.y * 2.8 * zoom;
                  return (
                    <line
                      key={`line-${matchPoint.id}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#f59e0b"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      opacity="0.6"
                    />
                  );
                })}

            {/* Renderizado de Puntos */}
            {visiblePoints.map((point) => {
              const px = cx + point.x * 2.8 * zoom;
              const py = cy + point.y * 2.8 * zoom;
              const color = point.isQuery
                ? "#f59e0b"
                : categoryColorMap[point.category] || "#818cf8";

              const isHovered = hoveredPoint?.id === point.id;
              const isSelected = selectedPoint?.id === point.id;
              const isMatched = point.isMatched;
              const isQuery = point.isQuery;

              const radius = isQuery ? 8 : isMatched ? 7 : isHovered ? 6 : 4.5;

              return (
                <g
                  key={String(point.id)}
                  transform={`translate(${px}, ${py})`}
                  className="cursor-pointer transition-transform duration-150"
                  opacity={point.isDimmed ? 0.2 : 1}
                  onMouseEnter={() => setHoveredPoint(point)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onClick={() => setSelectedPoint(point)}
                >
                  {/* Resplandor especial para el profesor o matches */}
                  {(isQuery || isMatched || isHovered) && (
                    <circle
                      r={radius + 6}
                      fill={isQuery ? "#f59e0b" : color}
                      opacity={isQuery ? "0.35" : "0.25"}
                      className="animate-pulse"
                    />
                  )}

                  {/* Círculo del punto */}
                  <circle
                    r={radius}
                    fill={color}
                    stroke={isSelected || isMatched || isQuery ? "#ffffff" : "#0f172a"}
                    strokeWidth={isSelected || isMatched || isQuery ? 2 : 1.2}
                    className="transition-all"
                  />

                  {/* Icono de estrella/diana para el profesor */}
                  {isQuery && (
                    <text
                      y={-12}
                      textAnchor="middle"
                      fill="#f59e0b"
                      fontSize="10"
                      fontWeight="bold"
                      className="drop-shadow"
                    >
                      🎯 Profesor
                    </text>
                  )}

                  {/* Etiqueta flotante permanente para los top matches o hover */}
                  {(isHovered || isMatched) && !isQuery && (
                    <text
                      y={-radius - 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="600"
                      className="drop-shadow pointer-events-none"
                    >
                      {point.code || point.label.slice(0, 18)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Tooltip flotante con detalles */}
        {hoveredPoint && (
          <div
            className="absolute bottom-4 left-4 max-w-sm rounded-xl border border-white/20 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md pointer-events-none z-30 space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono text-indigo-400 font-semibold uppercase">
                {hoveredPoint.code || "Asignatura"}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium border"
                style={{
                  backgroundColor: `${categoryColorMap[hoveredPoint.category] || "#818cf8"}20`,
                  borderColor: `${categoryColorMap[hoveredPoint.category] || "#818cf8"}40`,
                  color: categoryColorMap[hoveredPoint.category] || "#818cf8",
                }}
              >
                {hoveredPoint.category}
              </span>
            </div>
            <div className="text-xs font-bold text-white leading-tight">
              {hoveredPoint.label}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-1">
              <span>Créditos: {hoveredPoint.credits || "n/d"}</span>
              <span>•</span>
              <span className="font-mono">
                Coord: ({hoveredPoint.x.toFixed(1)}, {hoveredPoint.y.toFixed(1)})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Leyenda Interactiva de Categorías / Departamentos ── */}
      {categories.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300">
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              Filtrar por Departamento / Área ({categories.length}):
            </span>
            {filterCategory && (
              <button
                onClick={() => setFilterCategory(null)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
              >
                Mostrar todos
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const isSelected = filterCategory === cat;
              const color = categoryColorMap[cat] || "#818cf8";
              const count = validRecords.filter(
                (r) => (r[categoryColumn] || r.departamento || "General") === cat
              ).length;

              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(isSelected ? null : cat)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition border ${
                    isSelected
                      ? "border-white bg-white/10 text-white shadow"
                      : "border-white/5 bg-black/20 text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span>{cat}</span>
                  <span className="text-[10px] opacity-60 font-mono">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
