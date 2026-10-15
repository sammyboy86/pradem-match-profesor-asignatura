"use client";

import React, { useState, useEffect } from "react";
import HeaderNav from "@/components/HeaderNav";
import TabMatching from "@/components/TabMatching";
import ApiKeyModal from "@/components/ApiKeyModal";
import SqlSetupModal from "@/components/SqlSetupModal";
import { apiFetch } from "@/lib/utils";
import { useRouter } from "next/navigation";

export default function MatchingPage() {
  const router = useRouter();
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [customApiKey, setCustomApiKey] = useState("");
  const [tableExists, setTableExists] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const storedKey = localStorage.getItem("gemini_api_key");
      if (storedKey) setCustomApiKey(storedKey);
    } catch {
      // Ignorar en SSR
    }
  }, []);

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
      <HeaderNav
        activeTab="matching"
        onTabChange={(tab) => {
          if (tab === "asignaturas") router.push("/asignaturas");
        }}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        onOpenSqlModal={() => setIsSqlModalOpen(true)}
        hasCustomKey={Boolean(customApiKey && customApiKey.length > 0)}
        tableExists={tableExists}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <TabMatching onOpenSqlModal={() => setIsSqlModalOpen(true)} />
      </main>

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
