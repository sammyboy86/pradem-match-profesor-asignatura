-- ==============================================================================
-- MIGRACIÓN SUPABASE: ELIMINAR RESTRICCIÓN DE CLAVE ÚNICA EN ASIGNATURAS
-- ==============================================================================
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase para permitir
-- cargar múltiples asignaturas con la misma clave (ej: diferentes grupos, temarios o planes).

-- 1. Eliminar índice único existente en 'clave' si existe
DROP INDEX IF EXISTS public.idx_asignaturas_clave;

-- 2. Eliminar cualquier restricción de unicidad en 'clave' creada como CONSTRAINT
ALTER TABLE public.asignaturas DROP CONSTRAINT IF EXISTS asignaturas_clave_key;
ALTER TABLE public.asignaturas DROP CONSTRAINT IF EXISTS idx_asignaturas_clave;

-- 3. Crear índice regular (no único) para mantener búsquedas y filtros rápidos por clave
CREATE INDEX IF NOT EXISTS idx_asignaturas_clave ON public.asignaturas(clave);

-- 4. Actualizar comentario en la columna
COMMENT ON COLUMN public.asignaturas.clave IS 'Clave o código de la asignatura (permite duplicados)';
