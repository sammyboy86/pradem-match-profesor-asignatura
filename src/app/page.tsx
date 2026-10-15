"use client";

import React, { useState, useEffect } from "react";
import HeaderNav from "@/components/HeaderNav";
import TabAsignaturas from "@/components/TabAsignaturas";
import TabMatching from "@/components/TabMatching";
import ApiKeyModal from "@/components/ApiKeyModal";
import SqlSetupModal from "@/components/SqlSetupModal";
import { apiFetch } from "@/lib/utils";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"asignaturas" | "matching">("asignaturas");
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [customApiKey, setCustomApiKey] = useState("");
  const [tableExists, setTableExists] = useState<boolean | null>(null);

  // Cargar clave personalizada desde localStorage
  useEffect(() => {
    try {
      const storedKey = localStorage.getItem("gemini_api_key");
      if (storedKey) {
        setCustomApiKey(storedKey);
      }
    } catch {
      // Ignorar en SSR
    }
  }, []);

  // Verificar estado de la base de datos Supabase
  const checkDatabaseStatus = async () => {
    try {
      const data = await apiFetch<{
        success: boolean;
        tableExists: boolean;
      }>("/api/asignaturas?limit=1");
      setTableExists(data.tableExists !== false);
    } catch {
      setTableExists(false);
    }
  };

  useEffect(() => {
    checkDatabaseStatus();
  }, []);

  const handleSaveApiKey = (key: string) => {
    setCustomApiKey(key);
    try {
      if (key) {
        localStorage.setItem("gemini_api_key", key);
      } else {
        localStorage.removeItem("gemini_api_key");
      }
    } catch {
      // Ignorar
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500/30">
      {/* Barra de Navegación Superior */}
      <HeaderNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        onOpenSqlModal={() => setIsSqlModalOpen(true)}
        hasCustomKey={Boolean(customApiKey && customApiKey.length > 0)}
        tableExists={tableExists}
      />

      {/* Contenido Principal con Contenedor Responsivo */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {activeTab === "asignaturas" ? (
          <TabAsignaturas
            onDatabaseUpdated={checkDatabaseStatus}
            onOpenSqlModal={() => setIsSqlModalOpen(true)}
          />
        ) : (
          <TabMatching onOpenSqlModal={() => setIsSqlModalOpen(true)} />
        )}
      </main>

      {/* Footer Minimalista */}
      <footer className="border-t border-white/10 bg-slate-950/80 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Pradem Match Profesor – Asignatura &copy; {new Date().getFullYear()}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            Google GenAI gemini-embedding-2 &bull; Supabase pgvector HNSW
          </span>
        </div>
      </footer>

      {/* Modales Auxiliares */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSaveKey={handleSaveApiKey}
        initialKey={customApiKey}
      />

      <SqlSetupModal
        isOpen={isSqlModalOpen}
        onClose={() => setIsSqlModalOpen(false)}
        tableExists={tableExists}
      />
    </div>
  );
}
