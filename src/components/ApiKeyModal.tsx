"use client";

import React, { useState, useEffect } from "react";
import { Key, Sparkles, Check, X, ShieldCheck } from "lucide-react";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveKey: (key: string) => void;
  initialKey: string;
}

export default function ApiKeyModal({
  isOpen,
  onClose,
  onSaveKey,
  initialKey,
}: ApiKeyModalProps) {
  const [keyInput, setKeyInput] = useState(initialKey);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKeyInput(initialKey);
  }, [initialKey, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveKey(keyInput.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  const handleClear = () => {
    setKeyInput("");
    onSaveKey("");
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-400 border border-indigo-500/20">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Clave de Google Gemini</h2>
              <p className="text-xs text-slate-400">Modelo: gemini-embedding-2 (768d)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="my-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            Puedes configurar tu clave en el archivo <code className="text-amber-300 font-mono">.env.local</code> (como <code className="font-mono text-indigo-300">GEMINI_API_KEY</code>) o ingresarla aquí para guardarla de forma segura en tu navegador local.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-200">
              Google Gemini API Key
            </label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
            />
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-indigo-950/40 border border-indigo-500/20 p-3 text-[11px] text-indigo-200">
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-indigo-400 mt-0.5" />
            <span>
              La clave viaja por HTTPS y se procesa exclusivamente en el backend de Next.js mediante el endpoint seguro <code className="font-mono text-indigo-300">/api/embed</code> sin exponerla públicamente en el cliente.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-rose-400 hover:text-rose-300 hover:underline"
          >
            Eliminar clave guardada
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
            >
              {saved ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                  <span>Guardado</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Guardar Clave</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
