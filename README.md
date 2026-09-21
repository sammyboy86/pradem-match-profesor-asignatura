# 🎯 06 Match Profesor - Asignatura — Herramienta Satélite de Pradem

> Herramienta para la generación de **embeddings vectoriales** en la tabla `asignaturas_extraidas` de Supabase utilizando la API de **Jina AI** (`jina-embeddings-v2-base-es`) y el cálculo de **matching semántico** entre profesores y materias.

---

## 🏗️ Arquitectura Satélite

Esta herramienta se integra al ecosistema de Pradem mediante proxy inverso:

```
Pradem Core (puerto 3000)
    │
    ▼ (Rewrites /match-profesor-asignatura/*)
06matchProfesorAsignatura (puerto 3003, basePath: /match-profesor-asignatura)
    ├── Frontend: Formato vertical intuitivo (5 pasos guiados)
    ├── API Routes:
    │     ├── GET  /api/table-columns      → Inspección de columnas
    │     ├── POST /api/ensure-column      → Verificación y creación dinámica en Supabase
    │     ├── GET  /api/table-records      → Consulta y métricas de registros
    │     ├── POST /api/generate-embeddings→ Generación por lotes con Jina AI
    │     └── POST /api/semantic-match     → Similitud coseno profesor ↔ materias
    └── Supabase (public.asignaturas_extraidas)
```

---

## ⚡ Características Principales

1. **Formato Vertical Intuitivo**:
   - **Paso 1**: Diagnóstico de conexión a Supabase y configuración de `JINA_API_KEY`.
   - **Paso 2**: Selector dinámico de columna origen (`nombre`, `codigo`, etc.), campo para nombrar columna destino (`embedding`) y modo de ejecución (solo pendientes vs regenerar todos).
   - **Paso 3**: Botón destacado de generación con barra de progreso reactiva y log de terminal en vivo.
   - **Paso 4**: Tabla de auditoría para verificar vectores generados (768 dimensiones) e inspeccionar sus valores numéricos.
   - **Paso 5**: Probador semántico interactivo para ingresar el perfil de un docente y obtener las asignaturas más compatibles ordenadas por porcentaje de afinidad.

2. **Modelo de Embeddings Jina AI**:
   - Modelo: `jina-embeddings-v2-base-es`
   - Ventana de contexto: 8192 tokens
   - Dimensiones del vector: 768
   - Procesamiento optimizado por lotes (batches de hasta 50 textos)

---

## 🚀 Puesta en Marcha Local

### 1. Variables de Entorno (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://yonkcvfzbezflejwwdtg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
JINA_API_KEY=jina_...
```
*(También puedes ingresar o actualizar la `JINA_API_KEY` directamente desde la interfaz web).*

### 2. Iniciar Servidor de Desarrollo
```bash
cd 06matchProfesorAsignatura
npm run dev
```
La herramienta se ejecutará en: `http://localhost:3003/match-profesor-asignatura`
