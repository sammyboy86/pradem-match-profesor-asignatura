import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * API Route de ejemplo: GET /api/example
 *
 * Demuestra cómo:
 * 1. Validar la sesión de Supabase
 * 2. Hacer consultas a Supabase
 * 3. Retornar respuestas JSON
 *
 * 🔧 PERSONALIZAR:
 * - Renombrar la carpeta `example/` al nombre de tu endpoint
 * - Cambiar el método (GET, POST, PUT, DELETE) según necesidad
 * - Agregar la lógica de negocio de tu herramienta
 */
export async function GET() {
  // 1. Validar sesión Supabase
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 }
      );
    }

    // Si esta herramienta es exclusiva para administradores:
    // if (user.app_metadata?.role !== "admin") {
    //   return NextResponse.json(
    //     { error: "Acceso denegado: se requiere rol de administrador" },
    //     { status: 403 }
    //   );
    // }

    // 2. Ejemplo: consulta a Supabase
    // const { data, error } = await supabase
    //   .from("mi_tabla")
    //   .select("*")
    //   .limit(10);
    //
    // if (error) {
    //   return NextResponse.json({ error: error.message }, { status: 500 });
    // }

    // 3. Retornar respuesta
    return NextResponse.json({
      success: true,
      message: "API funcionando correctamente",
      user: user.email,
      // data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Ejemplo de endpoint POST.
 * Descomente y personalice según necesidad.
 */
// export async function POST(request: NextRequest) {
//   const supabase = await createClient();
//   const { data: { user } } = await supabase.auth.getUser();
//
//   if (!user) {
//     return NextResponse.json({ error: "No autorizado" }, { status: 401 });
//   }
//
//   const body = await request.json();
//   // ... lógica de negocio ...
//
//   return NextResponse.json({ success: true });
// }
