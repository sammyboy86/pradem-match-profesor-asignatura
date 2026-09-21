import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ══════════════════════════════════════════════════════════════
  //  basePath — Integración con Pradem Core
  // ══════════════════════════════════════════════════════════════
  // Este basePath debe coincidir con el source de los rewrites
  // configurados en 02prademCore/next.config.ts.
  //
  // Ejemplo: si basePath es "/mi-herramienta", entonces en el Core:
  //   source: "/mi-herramienta/:path*"
  //   destination: `${TOOL_URL}/mi-herramienta/:path*`
  //
  basePath: "/match-profesor-asignatura",

  // Necesario para que las imágenes funcionen correctamente
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
