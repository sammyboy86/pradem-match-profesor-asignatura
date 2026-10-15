import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseDirectClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Crea un cliente Supabase para Server Components y Route Handlers.
 * Lee las cookies de sesión inyectadas por Pradem Core (mismo dominio).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignorar en Server Components donde no se pueden modificar cookies
          }
        },
      },
    }
  );
}

/**
 * Crea un cliente directo de Supabase para background tasks o llamadas API de backend
 * utilizando service_role_key si existe, o anon_key.
 */
export function createDirectServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createSupabaseDirectClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
