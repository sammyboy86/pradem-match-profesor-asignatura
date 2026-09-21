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
  title: "06 Match Profesor Asignatura | Pradem",
  description:
    "Herramienta para generar embeddings con Jina AI e interactuar con el matching semántico entre profesores y asignaturas en Supabase.",
};

/**
 * Layout raíz de 06matchProfesorAsignatura.
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
