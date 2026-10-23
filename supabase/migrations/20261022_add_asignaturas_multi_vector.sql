-- ==============================================================================
-- MIGRACIÓN SUPABASE: HABILITACIÓN DE MULTI-VECTOR PARA ASIGNATURAS
-- ==============================================================================
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase para habilitar
-- el soporte de múltiples columnas de vectores (JSONB) en la tabla asignaturas.

-- 1. Agregar columna 'vectors' para almacenar diccionarios de vectores por columna
ALTER TABLE public.asignaturas 
ADD COLUMN IF NOT EXISTS vectors JSONB DEFAULT '{}'::jsonb;

-- 2. NOTA DE RENDIMIENTO:
-- No se crea índice GIN sobre la columna 'vectors' (JSONB). Al contener arrays numéricos
-- de 768 flotantes, los índices GIN sufren de una amplificación extrema de escritura
-- que causa 'canceling statement due to statement timeout' durante inserciones masivas.
-- DROP INDEX IF EXISTS public.idx_asignaturas_vectors_gin;

-- 3. Notificación de esquema listo
COMMENT ON COLUMN public.asignaturas.vectors IS 'Almacena múltiples vectores nombrados (ej: vector_temario, vector_objetivos, etc.)';
