/**
 * Definiciones de tipos para el sistema de matching de profesores y asignaturas con pgvector y Gemini Embedding 2
 */

export interface Asignatura {
  id?: number;
  clave?: string | null;
  nombre: string;
  fines_de_aprendizaje_o_formacion?: string | null;
  contenido_tematico?: string | null;
  actividades_de_aprendizaje?: string | null;
  match_nombre?: boolean;
  match_semantico?: boolean;
  dot_product_match?: number | null;
  embedding_768?: number[] | null;
  created_at?: string;
}

export interface AsignaturaUploadRow {
  clave?: string;
  nombre: string;
  fines_de_aprendizaje_o_formacion?: string;
  contenido_tematico?: string;
  actividades_de_aprendizaje?: string;
  [key: string]: unknown;
}

export interface ColumnMapping {
  clave: string;
  nombre: string;
  fines_de_aprendizaje_o_formacion: string;
  contenido_tematico: string;
  actividades_de_aprendizaje: string;
  embedding_768: string;
  [key: string]: string;
}

export interface Profesor {
  id: string | number;
  nombre_profesor: string;
  trayectoria_academica?: string;
  experiencia_laboral?: string;
  [key: string]: unknown;
}

export interface QueryConfig {
  field: string;
  label: string;
  active: boolean;
  template: string;
  weight: number; // Peso relativo w_i
}

export interface MatchResultItem {
  asignaturaId: number;
  clave: string;
  nombre: string;
  contenido_tematico: string;
  compositeSimilarity: number;
  fieldSimilarities: Record<string, number>;
  match_nombre?: boolean;
}

export interface ProfesorMatchResult {
  profesor: Profesor;
  matches: MatchResultItem[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export type MatchFilterMode = 'threshold' | 'topK' | 'both';

export interface MatchingSettings {
  filterMode: MatchFilterMode;
  threshold: number; // Tau: Umbral de similitud compuesta (0.0 - 1.0, default 0.65)
  topK: number;      // K: Número de asignaturas sugeridas por profesor (1 a total asignaturas)
}

export interface EmbeddingBatchResponse {
  success: boolean;
  embeddings?: number[][];
  error?: string;
  tokensUsed?: number;
}

export interface FilteredAsignatura {
  id: number;
  clave: string | null;
  cleanClave: string;
  nombre: string;
  contenido_tematico?: string | null;
  match_nombre?: boolean;
  hasEmbedding?: boolean;
}

export interface FilterClavesResponse {
  success: boolean;
  matchedAsignaturas: FilteredAsignatura[];
  matchedIds: number[];
  matchedCount: number;
  unmatchedClaves: string[];
  totalUploadedClaves: number;
  error?: string;
}
