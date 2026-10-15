import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddingsBatch, generateSingleEmbedding } from "@/lib/gemini/embeddings";

export const maxDuration = 60; // Permitir hasta 60s en Vercel/Next server si es necesario

export async function POST(req: NextRequest) {
  try {
    const headerKey = req.headers.get("x-gemini-api-key") || undefined;
    const body = await req.json().catch(() => ({}));

    const apiKey = headerKey || body.apiKey;
    const texts: string[] = Array.isArray(body.texts)
      ? body.texts
      : typeof body.text === "string"
      ? [body.text]
      : [];

    if (!texts.length) {
      return NextResponse.json(
        { success: false, error: "Debes enviar un campo 'texts' (array) o 'text' (string)." },
        { status: 400 }
      );
    }

    if (texts.length === 1) {
      const embedding = await generateSingleEmbedding(texts[0], apiKey);
      return NextResponse.json({
        success: true,
        embeddings: [embedding],
        count: 1,
      });
    }

    // Procesar en lotes con concurrencia controlada
    const embeddings = await generateEmbeddingsBatch(texts, {
      apiKey,
      concurrency: 5,
    });

    return NextResponse.json({
      success: true,
      embeddings,
      count: embeddings.length,
    });
  } catch (error: any) {
    console.error("Error en /api/embed:", error);
    const status = error.status || 500;
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Error al generar embeddings con Gemini",
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
