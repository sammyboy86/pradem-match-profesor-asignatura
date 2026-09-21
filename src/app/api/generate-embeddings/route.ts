import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getJinaEmbeddings } from "@/lib/jina";

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
      sourceColumn,
      targetColumn = "embedding",
      apiKey,
      model = "jina-embeddings-v2-base-es",
      mode = "missing_only", // 'missing_only' | 'all'
      batchSize = 25,
      limit,
    } = body;

    // 1. Validaciones
    if (!sourceColumn || typeof sourceColumn !== "string") {
      return NextResponse.json(
        { error: "Debes seleccionar una columna origen (sourceColumn) para generar los embeddings." },
        { status: 400 }
      );
    }

    const cleanTargetCol = (targetColumn || "embedding")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanTargetCol)) {
      return NextResponse.json(
        { error: "Nombre de columna destino inválido. Usa solo letras, números y guión bajo (_)." },
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

    // 2. Asegurar que la columna destino exista en la tabla asignaturas_extraidas
    try {
      const { data: sampleRow } = await supabase
        .from("asignaturas_extraidas")
        .select("*")
        .limit(1);

      if (sampleRow && sampleRow.length > 0 && !(cleanTargetCol in sampleRow[0])) {
        // Intentar crear columna vía RPC
        await supabase.rpc("add_asignaturas_column", {
          col_name: cleanTargetCol,
          col_type: "jsonb",
        });
      }
    } catch (colErr) {
      console.warn("Advertencia al verificar/crear columna destino:", colErr);
    }

    // 3. Consultar registros a procesar
    let query = supabase
      .from("asignaturas_extraidas")
      .select("*")
      .not(sourceColumn, "is", null)
      .order("id", { ascending: true });

    if (mode === "missing_only") {
      query = query.is(cleanTargetCol, null);
    }

    if (typeof limit === "number" && limit > 0) {
      query = query.limit(limit);
    }

    const { data: rawRows, error: selectErr } = await query;

    if (selectErr) {
      return NextResponse.json(
        {
          error: `Error al consultar asignaturas_extraidas: ${selectErr.message}. Verifica que la columna origen '${sourceColumn}' exista.`,
        },
        { status: 400 }
      );
    }

    const rows: Array<Record<string, any>> = (rawRows as any[]) || [];

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message:
          mode === "missing_only"
            ? "Todos los registros ya cuentan con embeddings en la columna seleccionada."
            : "No se encontraron registros con contenido en la columna origen.",
        totalProcessed: 0,
        totalUpdated: 0,
        tokensUsed: 0,
      });
    }

    // Filtrar filas con texto no vacío en la columna origen
    const validRows = rows.filter((r) => {
      const val = r[sourceColumn];
      return val !== null && val !== undefined && String(val).trim().length > 0;
    });

    if (validRows.length === 0) {
      return NextResponse.json({
        success: true,
        message: `Los registros encontrados tienen la columna '${sourceColumn}' vacía.`,
        totalProcessed: 0,
        totalUpdated: 0,
        tokensUsed: 0,
      });
    }

    const startTime = Date.now();
    let totalUpdated = 0;
    let totalTokens = 0;
    const errors: string[] = [];
    const effectiveBatchSize = Math.min(Math.max(1, batchSize), 50);

    // 4. Procesamiento por lotes
    for (let i = 0; i < validRows.length; i += effectiveBatchSize) {
      const currentBatch = validRows.slice(i, i + effectiveBatchSize);
      const texts = currentBatch.map((r) => String(r[sourceColumn]).trim());

      try {
        const { embeddings, totalTokens: batchTokens } = await getJinaEmbeddings(
          texts,
          jinaKey,
          model
        );

        totalTokens += batchTokens;

        // Actualizar registros en Supabase en paralelo
        const updatePromises = currentBatch.map(async (row, index) => {
          const vector = embeddings[index];
          if (!vector || !Array.isArray(vector)) {
            errors.push(`No se obtuvo vector para la asignatura ID ${row.id}`);
            return;
          }

          const { error: updateErr } = await supabase
            .from("asignaturas_extraidas")
            .update({ [cleanTargetCol]: vector })
            .eq("id", row.id);

          if (updateErr) {
            errors.push(`Error al guardar en ID ${row.id}: ${updateErr.message}`);
          } else {
            totalUpdated++;
          }
        });

        await Promise.all(updatePromises);
      } catch (batchErr: unknown) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        errors.push(`Lote ${i / effectiveBatchSize + 1}: ${msg}`);
        // Si hay error crítico de API key, frenar el loop
        if (msg.includes("Clave de API") || msg.includes("401")) {
          return NextResponse.json(
            {
              error: msg,
              totalProcessed: i,
              totalUpdated,
              errors,
            },
            { status: 401 }
          );
        }
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    return NextResponse.json({
      success: totalUpdated > 0 || errors.length === 0,
      message: `Generación completada: ${totalUpdated} de ${validRows.length} registros actualizados en '${cleanTargetCol}'.`,
      totalFound: validRows.length,
      totalUpdated,
      tokensUsed: totalTokens,
      durationSeconds: Number(durationSeconds),
      sourceColumn,
      targetColumn: cleanTargetCol,
      model,
      errors: errors.slice(0, 10),
    });
  } catch (err: unknown) {
    console.error("Error general en generate-embeddings:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Error inesperado al generar embeddings",
      },
      { status: 500 }
    );
  }
}
