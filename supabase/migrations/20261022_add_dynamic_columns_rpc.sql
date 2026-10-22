-- ==============================================================================
-- MIGRACIÓN SUPABASE: FUNCIÓN RPC PARA CREAR COLUMNAS DINÁMICAMENTE EN ASIGNATURAS
-- ==============================================================================
-- Permite agregar nuevas columnas desde la aplicación cuando el usuario sube
-- archivos Excel/CSV con nuevos campos (ej. creditos, semestre, departamento, etc.).

CREATE OR REPLACE FUNCTION public.add_asignatura_column(col_name TEXT, col_type TEXT DEFAULT 'TEXT')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_col TEXT;
  clean_type TEXT;
BEGIN
  -- Sanitizar nombre de la columna: solo letras minúsculas, números y guiones bajos
  clean_col := lower(regexp_replace(col_name, '[^a-zA-Z0-9_]', '_', 'g'));
  clean_col := trim(both '_' from clean_col);
  
  IF clean_col IS NULL OR length(clean_col) = 0 THEN
    RETURN FALSE;
  END IF;

  -- Validar y normalizar el tipo de datos admitido
  clean_type := upper(trim(col_type));
  IF clean_type NOT IN ('TEXT', 'VARCHAR', 'INTEGER', 'BIGINT', 'REAL', 'DOUBLE PRECISION', 'BOOLEAN', 'TIMESTAMPTZ', 'JSONB') THEN
    clean_type := 'TEXT';
  END IF;

  -- Ejecutar la alteración de la tabla de forma segura
  EXECUTE format('ALTER TABLE public.asignaturas ADD COLUMN IF NOT EXISTS %I %s;', clean_col, clean_type);
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

-- Otorgar permisos de ejecución
GRANT EXECUTE ON FUNCTION public.add_asignatura_column(TEXT, TEXT) TO anon, authenticated, service_role;
