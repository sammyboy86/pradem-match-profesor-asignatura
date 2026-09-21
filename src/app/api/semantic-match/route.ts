import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getJinaEmbeddings, cosineSimilarity } from "@/lib/jina";

export const dynamic = "force-dynamic";

async function checkAdmin(supabase: any) {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) return { ok: true };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") {
    return { ok: false, error: "Acceso denegado: se requiere rol de administrador" };
  }
  return { ok: true, user };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      query,
      targetColumn = "embedding",
      apiKey,
      topK = 5,
      model = "jina-embeddings-v2-base-es",
    } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Debes ingresar un texto de búsqueda o descripción del profesor." },
        { status: 400 }
      );
    }

    const jinaKey = apiKey?.trim() || process.env.JINA_API_KEY?.trim();
    if (!jinaKey) {
      return NextResponse.json(
        {
          error:
            "No se encontró la clave de API de Jina AI. Ingrésala en el formulario o configúrala en .env.local como JINA_API_KEY.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const auth = await checkAdmin(supabase);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 403 });
    }

    const cleanTargetCol = (targetColumn || "embedding")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    // 1. Obtener registros que posean embedding
    const { data: rows, error: selectErr } = await supabase
      .from("asignaturas_extraidas")
      .select(`*`)
      .not(cleanTargetCol, "is", null);

    if (selectErr) {
      return NextResponse.json(
        {
          error: `Error al consultar asignaturas con embedding: ${selectErr.message}. Verifica que la columna '${cleanTargetCol}' exista.`,
        },
        { status: 400 }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: `No hay asignaturas con embeddings guardados en la columna '${cleanTargetCol}'. Genera embeddings primero.`,
        matches: [],
      });
    }

    // 2. Generar embedding para la consulta (perfil o materia del profesor)
    const { embeddings } = await getJinaEmbeddings([query.trim()], jinaKey, model);
    const queryVector = embeddings[0];

    if (!queryVector || !Array.isArray(queryVector)) {
      return NextResponse.json(
        { error: "No fue posible generar el embedding para la consulta." },
        { status: 500 }
      );
    }

    // 3. Calcular similitud coseno con cada asignatura
    const scoredMatches: Array<{
      id: number;
      codigo?: string;
      nombre?: string;
      departamento?: string;
      creditos?: number;
      similarity: number;
      similarityPercentage: number;
      rawRecord: Record<string, unknown>;
    }> = [];

    for (const row of rows) {
      let candidateVector = row[cleanTargetCol];
      if (typeof candidateVector === "string") {
        try {
          candidateVector = JSON.parse(candidateVector);
        } catch {
          continue;
        }
      }

      if (Array.isArray(candidateVector) && candidateVector.length > 0) {
        const sim = cosineSimilarity(queryVector, candidateVector);
        const percentage = Math.max(0, Math.min(100, Math.round(sim * 10000) / 100));

        // Construir registro sin el vector gigante para que el JSON de respuesta sea ligero
        const { [cleanTargetCol]: _, ...recordWithoutVector } = row;

        scoredMatches.push({
          id: row.id,
          codigo: row.codigo,
          nombre: row.nombre,
          departamento: row.departamento,
          creditos: row.creditos,
          similarity: sim,
          similarityPercentage: percentage,
          rawRecord: recordWithoutVector,
        });
      }
    }

    // 4. Ordenar descendentemente por similitud y tomar los mejores topK
    scoredMatches.sort((a, b) => b.similarity - a.similarity);
    const topMatches = scoredMatches.slice(0, Math.max(1, topK));

    return NextResponse.json({
      success: true,
      query: query.trim(),
      queryVector,
      totalCompared: scoredMatches.length,
      topK,
      matches: topMatches,
    });
  } catch (err: unknown) {
    console.error("Error en semantic-match:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error inesperado al calcular matching" },
      { status: 500 }
    );
  }
}
