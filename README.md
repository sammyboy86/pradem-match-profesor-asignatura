# ⚡ 06 Generador de Embeddings de Asignatura — Herramienta Satélite de Pradem

> Herramienta satélite para la generación de **embeddings vectoriales** en la tabla `asignaturas_extraidas` de Supabase utilizando la API de **Jina AI** (`jina-embeddings-v2-base-es`) e inserción optimizada por lotes.

---

## 🏗️ Arquitectura Satélite

Esta herramienta se integra al ecosistema de Pradem mediante proxy inverso:

```
Pradem Core (puerto 3000)
    │
    ▼ (Rewrites /embed-asignatura/*)
06embedAsignatura (puerto 3003, basePath: /embed-asignatura)
    ├── Frontend: Formato vertical intuitivo (4 pasos guiados)
    ├── API Routes:
    │     ├── GET  /api/table-columns       → Inspección de columnas
    │     ├── POST /api/ensure-column       → Verificación y creación dinámica en Supabase
    │     ├── GET  /api/table-records       → Consulta y métricas de registros
    │     └── POST /api/generate-embeddings → Generación por lotes con Jina AI
    └── Supabase (public.asignaturas_extraidas)
```

---

## ⚡ Características Principales

1. **Formato Vertical Intuitivo (4 Pasos Guiados)**:
   - **Paso 1**: Diagnóstico de conexión a Supabase, métricas en vivo de asignaturas con/sin vector y configuración segura de `JINA_API_KEY`.
   - **Paso 2**: Selector dinámico de columna origen (`nombre`, `codigo`, etc.), campo para nombrar columna destino (`embedding`) y selector de modo de procesamiento (solo pendientes vs regenerar todos).
   - **Paso 3**: Botón destacado de generación e inserción directa con barra de progreso reactiva, resumen de métricas y consola de logs en tiempo real.
   - **Paso 4**: Tabla de auditoría con buscador en vivo, filtros y modal para inspeccionar coeficientes numéricos de los vectores (768 dimensiones).

2. **Modelo de Embeddings Jina AI**:
   - Modelo: `jina-embeddings-v2-base-es`
   - Ventana de contexto: 8192 tokens
   - Dimensiones del vector: 768
   - Procesamiento optimizado por lotes (batches configurables)

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
cd 06embedAsignatura
npm run dev
```
La herramienta se ejecutará en: `http://localhost:3003/embed-asignatura`
