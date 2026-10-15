import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { Asignatura } from "@/types";

/**
 * Combina clases de Tailwind asegurando precedencia y limpieza
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Obtiene el basePath configurado para resolver rutas en Next.js con soporte Pradem Core
 */
export function getBasePath(): string {
  if (typeof window !== "undefined") {
    if (window.location.pathname.startsWith("/match-profesor-asignatura")) {
      return "/match-profesor-asignatura";
    }
  }
  return process.env.NEXT_PUBLIC_BASE_PATH || "/match-profesor-asignatura";
}

/**
 * Realiza peticiones fetch al backend con resolución automática de basePath y parseo de errores
 */
export async function apiFetch<T = any>(
  endpoint: string,
  init?: RequestInit,
  customApiKey?: string
): Promise<T> {
  const basePath = getBasePath();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${basePath}${cleanEndpoint}`;

  const headers = new Headers(init?.headers || {});
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  // Si el usuario proporcionó una clave de Gemini en la UI o localStorage, adjuntarla en cabecera
  const storedKey = customApiKey || (typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null);
  if (storedKey && storedKey.trim()) {
    headers.set("x-gemini-api-key", storedKey.trim());
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `El servidor respondió con código ${res.status} (${res.statusText || "Error"}) pero no devolvió JSON: "${text.slice(0, 120)}"`
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Error en la respuesta del servidor`);
  }

  return data;
}

/**
 * Parsea archivos .csv, .xlsx y .xls en el navegador devolviendo columnas y filas tipadas
 */
export async function parseSpreadsheetFile(
  file: File
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (results) => {
          const headers = results.meta.fields || [];
          const rows = (results.data as Record<string, string>[]).filter((row) =>
            Object.values(row).some((val) => val && String(val).trim().length > 0)
          );
          resolve({ headers, rows });
        },
        error: (err) => reject(new Error(`Error al leer archivo CSV: ${err.message}`)),
      });
    });
  }

  if (extension === "xlsx" || extension === "xls") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, {
            defval: "",
          });

          if (!json.length) {
            resolve({ headers: [], rows: [] });
            return;
          }

          const headers = Object.keys(json[0]);
          const stringRows = json.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [k, v != null ? String(v).trim() : ""])
            )
          );

          resolve({ headers, rows: stringRows });
        } catch (err: any) {
          reject(new Error(`Error al procesar archivo Excel: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error("Error al leer el archivo en memoria"));
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error(`Formato no soportado: .${extension}. Usa archivos .csv, .xlsx o .xls`);
}

/**
 * Limpieza preliminar de clave de asignatura:
 * Quita cualquier carácter no alfa-numérico y pasa todo a mayúsculas.
 * Ej: "ING-101\n" -> "ING101", "mat_202" -> "MAT202"
 */
export function cleanClave(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remover acentos y diacríticos
    .replace(/[^a-zA-Z0-9]/g, "") // quitar todo carácter no alfa-numérico
    .toUpperCase()
    .trim();
}

/**
 * Genera el texto estructurado para el embedding multimodal de una asignatura
 */
export function formatAsignaturaForEmbedding(item: Partial<Asignatura>): string {
  const parts: string[] = [];

  if (item.nombre) parts.push(`Asignatura: ${item.nombre.trim()}`);
  if (item.clave) parts.push(`Clave: ${item.clave.trim()}`);
  if (item.fines_de_aprendizaje_o_formacion) {
    parts.push(`Fines de aprendizaje: ${item.fines_de_aprendizaje_o_formacion.trim()}`);
  }
  if (item.contenido_tematico) {
    parts.push(`Contenido temático: ${item.contenido_tematico.trim()}`);
  }
  if (item.actividades_de_aprendizaje) {
    parts.push(`Actividades: ${item.actividades_de_aprendizaje.trim()}`);
  }

  return parts.join("\n");
}

/**
 * Descarga una lista de objetos planos como archivo Excel (.xlsx)
 */
export function exportToExcel(data: Record<string, any>[], filename: string) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Resultados");
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

/**
 * Descarga una lista de objetos planos como archivo CSV con codificación UTF-8 BOM
 */
export function exportToCsv(data: Record<string, any>[], filename: string) {
  const csv = Papa.unparse(data);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
