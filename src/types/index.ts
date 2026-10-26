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
  vectors?: Record<string, number[]> | null;
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
  vectorColumns?: string[];
  [key: string]: string | string[] | undefined;
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

/**
 * Configuración de un par de distancia entre un campo del profesor y una columna de vector de la asignatura
 */
export interface DistancePairConfig {
  id: string;              // Identificador único (ej: "trayectoria_academica__vector_temario")
  profField: string;       // Campo de profesor (ej: "trayectoria_academica")
  asigVectorCol: string;   // Columna de vector de asignatura (ej: "vector_temario" o "embedding_768")
  label?: string;          // Etiqueta legible (ej: "Trayectoria Académica ↔ Vector Temario")
  active: boolean;         // Si el par está activo para el matching
  weight: number;          // Peso base o inicial (0-100)
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
  betas: Record<string, Record<string, number>>; // clusterName -> { pairIdOrFieldName: weightInPercent }
  defaultBetas: Record<string, number>;          // { pairIdOrFieldName: weightInPercent } para asignaturas sin cluster
}

export interface SavedClusterConfiguration {
  id?: number | string;
  name: string;
  description?: string;
  clusterColumn: string;
  clusterBetas: Record<string, Record<string, number>>;
  defaultBetas: Record<string, number>;
  customClusters?: string[];
  created_at?: string;
  updated_at?: string;
  author?: string;
}

export interface ClusterVerificationResult {
  isValid: boolean;
  matchingClusters: string[];
  missingInAsignaturas: string[];
  missingInConfig: string[];
  totalConfigured: number;
  totalInAsignaturas: number;
}

export type ProfessorImportMode = "generate" | "only_match";

export type PenalizationSeverity = '5/100' | '10/100' | '20/100';

export interface PenalizationCriterionConfig {
  active: boolean;
  severity: PenalizationSeverity;
}

export interface PenalizationConfig {
  enabled: boolean;
  match_nombre: PenalizationCriterionConfig;
  match_semantico: PenalizationCriterionConfig;
  match_nombre_area_programa: PenalizationCriterionConfig;
  match_semantico_area_programa: PenalizationCriterionConfig;
}

export const PENALIZATION_SEVERITY_VALUES: Record<PenalizationSeverity, number> = {
  '5/100': 0.05,
  '10/100': 0.10,
  '20/100': 0.20,
};

export const DEFAULT_PENALIZATION_CONFIG: PenalizationConfig = {
  enabled: false,
  match_nombre: { active: false, severity: '10/100' },
  match_semantico: { active: false, severity: '10/100' },
  match_nombre_area_programa: { active: false, severity: '10/100' },
  match_semantico_area_programa: { active: false, severity: '10/100' },
};

export interface MatchResultItem {
  asignaturaId: number;
  clave: string;
  nombre: string;
  cluster?: string | null;
  contenido_tematico?: string | null;
  fines_de_aprendizaje_o_formacion?: string | null;
  actividades_de_aprendizaje?: string | null;
  compositeSimilarity: number;
  rawCompositeSimilarity?: number;
  penalizationApplied?: number;
  penalizationBreakdown?: Record<string, number>;
  penalizationStd?: number;
  fieldSimilarities: Record<string, number>;
  pairSimilarities?: Record<string, number>;
  match_nombre?: boolean;
  match_semantico?: boolean;
  match_nombre_area_programa?: boolean;
  match_semantico_area_programa?: boolean;
  embedding_768?: number[] | null;
  vectors?: Record<string, number[]> | null;
  [key: string]: any;
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
  vectors?: Record<string, number[]> | null;
  vectorColumns?: string[];
  [key: string]: any;
}

export interface FilterClavesResponse {
  success: boolean;
  matchedAsignaturas: FilteredAsignatura[];
  matchedIds: number[];
  matchedCount: number;
  unmatchedClaves: string[];
  totalUploadedClaves: number;
  totalCatalogCount?: number;
  availableColumns?: string[];
  availableVectorColumns?: string[];
  error?: string;
}

