import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "06 Generador de Embeddings de Asignatura | Pradem",
  description:
    "Herramienta satélite de Pradem para generar embeddings vectoriales de asignaturas con Jina AI e insertarlos en Supabase.",
};

/**
 * Layout raíz de 06embedAsignatura.
 * Herramienta satélite de Pradem Core.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
        {children}
      </body>
    </html>
  );
}
