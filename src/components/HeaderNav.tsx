"use client";

import React from "react";
import PrademLogo from "@/components/PrademLogo";
import { BookOpen, Users, Sparkles, Key, Database, FileCode } from "lucide-react";

interface HeaderNavProps {
  activeTab: "asignaturas" | "matching";
  onTabChange: (tab: "asignaturas" | "matching") => void;
  onOpenApiKeyModal: () => void;
  onOpenSqlModal: () => void;
  hasCustomKey: boolean;
  tableExists: boolean | null;
}

export default function HeaderNav({
  activeTab,
  onTabChange,
  onOpenApiKeyModal,
  onOpenSqlModal,
  hasCustomKey,
  tableExists,
}: HeaderNavProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 py-3.5">
        {/* Logo y Título */}
        <div className="flex items-center gap-3.5">
          <a
            href="/dashboard"
            className="group relative flex-shrink-0 transition-transform hover:scale-105"
            title="Volver a Pradem Core"
          >
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/10 p-2 ring-1 ring-white/15 transition group-hover:ring-indigo-400/40">
              <PrademLogo className="h-full w-full text-[#C8A2C8]" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/30 text-[9px] font-bold text-emerald-300 ring-2 ring-slate-950">
              ✓
            </span>
          </a>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                Match Profesor – Asignatura
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                <Sparkles className="h-2.5 w-2.5" />
                gemini-embedding-2 (768d)
              </span>
            </div>
            <p className="hidden sm:block text-xs text-slate-400">
              Asignación inteligente y matching vectorial multimodal con Supabase pgvector
            </p>
          </div>
        </div>

        {/* Tabs de Navegación Centrales */}
        <div className="flex items-center rounded-xl border border-white/10 bg-slate-900/90 p-1 shadow-inner">
          <button
            type="button"
            onClick={() => onTabChange("asignaturas")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "asignaturas"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">1. Gestión de</span> Asignaturas
          </button>

          <button
            type="button"
            onClick={() => onTabChange("matching")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "matching"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">2. Match</span> Profesores
          </button>
        </div>

        {/* Acciones Rápidas (API Key, SQL Migración, Herramientas) */}
        <div className="flex items-center gap-2">
          {/* Botón Ver Script SQL */}
          <button
            type="button"
            onClick={onOpenSqlModal}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            title="Ver script de migración SQL pgvector"
          >
            <FileCode className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden md:inline">SQL pgvector</span>
            {tableExists === false && (
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          {/* Botón Configurar Gemini API Key */}
          <button
            type="button"
            onClick={onOpenApiKeyModal}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              hasCustomKey
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
            title="Configurar clave GEMINI_API_KEY"
          >
            <Key className="h-3.5 w-3.5 text-indigo-400" />
            <span className="hidden md:inline">Gemini Key</span>
            {hasCustomKey && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
          </button>
        </div>
      </div>
    </header>
  );
}
