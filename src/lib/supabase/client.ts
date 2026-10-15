import { createBrowserClient } from "@supabase/ssr";

/**
 * Crea un cliente de Supabase para su uso en componentes cliente del navegador.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Variables de entorno NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY son requeridas."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
