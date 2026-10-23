-- ==============================================================================
-- MIGRACIÓN SUPABASE: OPTIMIZACIÓN DE RENDIMIENTO E ÍNDICES EN ASIGNATURAS
-- ==============================================================================
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase.
--
-- Motivo:
-- Si previamente se creó un índice GIN sobre la columna 'vectors' (JSONB),
-- PostgreSQL intenta descomponer e indexar individualmente cada número flotante
-- de los arrays de 768 dimensiones. Al subir un archivo con muchas asignaturas,
-- cada fila genera 768+ entradas de índice GIN, provocando que la operación
-- exceda el límite de tiempo de PostgreSQL:
-- "canceling statement due to statement timeout" (código 57014).
--
-- Esta consulta elimina el índice GIN innecesario, permitiendo inserciones
-- por lote ultra rápidas sin bloquear la base de datos.
-- ==============================================================================

-- 1. Eliminar el índice GIN sobre 'vectors' si existe
DROP INDEX IF EXISTS public.idx_asignaturas_vectors_gin;

-- 2. Confirmación
COMMENT ON COLUMN public.asignaturas.vectors IS 'Almacena múltiples vectores nombrados (ej: vector_temario, vector_objetivos, etc.) sin sobrecarga de índice GIN';
