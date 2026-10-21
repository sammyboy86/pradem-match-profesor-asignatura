/**
 * Definiciones de tipos para el sistema de matching de profesores y asignaturas con pgvector y Gemini Embedding 2
 */

export interface Asignatura {
  id?: number;
  clave?: string | null;
  nombre: string;
  cluster?: string | null;
  fines_de_aprendizaje_o_formacion?: string | null;
  contenido_tematico?: string | null;
  actividades_de_aprendizaje?: string | null;
  match_nombre?: boolean;
  match_semantico?: boolean;
  dot_product_match?: number | null;
  embedding_768?: number[] | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface AsignaturaUploadRow {
  clave?: string;
  nombre: string;
  cluster?: string;
  fines_de_aprendizaje_o_formacion?: string;
  contenido_tematico?: string;
  actividades_de_aprendizaje?: string;
  [key: string]: unknown;
}

export interface ColumnMapping {
  clave: string;
  nombre: string;
  cluster?: string;
  fines_de_aprendizaje_o_formacion: string;
  contenido_tematico: string;
  actividades_de_aprendizaje: string;
  embedding_768: string;
  [key: string]: string | undefined;
}

export interface Profesor {
  id: string | number;
  nombre_profesor: string;
  trayectoria_academica?: string;
  experiencia_laboral?: string;
  embedding_768?: number[] | null;
  fieldEmbeddings?: Record<string, number[]>;
  [key: string]: unknown;
}

export interface QueryConfig {
  field: string;
  label: string;
  active: boolean;
  template: string;
  weight: number; // Peso relativo w_i (usado como default o fallback)
  embeddingColumn?: string; // Columna en el archivo de profesores con el vector precalculado
}

export interface RegexFilterConfig {
  enabled: boolean;
  regexCredencial: string;
  regexExperiencia: string;
  replacementText: string;
  checkAcrossAllFields?: boolean;
}

export interface ClusterBetasConfig {
  clusterColumn: string; // Columna de cluster en asignaturas (default: 'cluster')
  clusters: string[];    // Lista de clusters únicos detectados
  betas: Record<string, Record<string, number>>; // clusterName -> { fieldName: weightInPercent }
  defaultBetas: Record<string, number>;          // { fieldName: weightInPercent } para asignaturas sin cluster
}

export type ProfessorImportMode = "generate" | "only_match";

export interface MatchResultItem {
  asignaturaId: number;
  clave: string;
  nombre: string;
  cluster?: string | null;
  contenido_tematico: string;
  compositeSimilarity: number;
  fieldSimilarities: Record<string, number>;
  match_nombre?: boolean;
  embedding_768?: number[] | null;
}

export interface ProfesorMatchResult {
  profesor: Profesor;
  matches: MatchResultItem[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  embedding_768?: number[] | null;
  fieldEmbeddings?: Record<string, number[]>;
  sanitizationStatus?: 'intact' | 'sanitized' | 'bypassed';
}

export interface ProfesorEmbeddingResult {
  id: string | number;
  nombre_profesor: string;
  profesor: Profesor;
  embedding_768: number[] | null;
  fieldEmbeddings: Record<string, number[]>;
  sanitizationStatus?: 'intact' | 'sanitized' | 'bypassed';
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
  cluster?: string | null;
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

