"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface RoutineSummary {
  id: number;
  name: string;
  phase_label?: string | null;
  day_count: number;
}

interface ImportPreviewData {
  routines?: RoutineSummary[];
  phases?: number;
  total_exercises?: number;
  error?: string;
}

interface PreviewCard {
  title: string;
  data: ImportPreviewData;
}

export default function ManageRoutinesPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<number | null>(null);
  const [activateError, setActivateError] = useState("");
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/routines/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.card) setPreview(data.card);
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate(routineId: number) {
    setActivating(routineId);
    setActivateError("");
    try {
      const res = await fetch("/api/routines/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routine_id: routineId }),
      });
      if (!res.ok) { setActivateError("Activation failed. Try again."); return; }
      router.push("/routines");
    } catch {
      setActivateError("Activation failed. Try again.");
    } finally {
      setActivating(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => setText((e.target?.result as string) || "");
    reader.readAsText(file);
  }

  const previewData = preview?.data;
  const previewRoutines = previewData?.routines || [];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-5 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <a href="/routines" className="text-[#666] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 16L7 10L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <h1 className="text-[22px] font-bold">Import Routine</h1>
        </div>

        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`rounded-xl border-2 border-dashed ${dragOver ? "border-[#BFFF00] bg-[#BFFF00]/5" : "border-[#222]"} p-4 text-center cursor-pointer transition-colors`}
          >
            <div className="text-[13px] text-[#555]">Drop .md or .txt file, or tap to browse</div>
            <input ref={fileRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFileChange} />
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Or paste your routine text here…"
            rows={8}
            className="w-full bg-[#0A0A0A] border border-[#222] rounded-xl p-4 text-[13px] text-white placeholder-[#444] resize-none focus:outline-none focus:border-[#BFFF00]/40"
          />

          <button
            onClick={handleImport}
            disabled={!text.trim() || loading}
            className="w-full bg-[#BFFF00] text-black font-bold text-[14px] rounded-xl py-3.5 disabled:opacity-30 transition-opacity"
          >
            {loading ? "Parsing…" : "Parse & Preview"}
          </button>
        </div>

        {activateError && (
          <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-[13px] text-red-400">
            {activateError}
          </div>
        )}

        {previewData?.error && (
          <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-[13px] text-red-400">
            {previewData.error}
          </div>
        )}

        {preview && !previewData?.error && (
          <div className="rounded-2xl border border-[#222] bg-[#111] p-5 space-y-4">
            <div className="text-[10px] font-semibold tracking-widest text-[#BFFF00] uppercase">Preview — Draft</div>
            <div className="text-[17px] font-semibold text-white">{preview.title}</div>
            <div className="text-[12px] text-[#666]">
              {previewData?.phases && previewData.phases > 1 ? `${previewData.phases} phases` : "1 routine"} · {previewData?.total_exercises} exercises
            </div>
            <div className="space-y-2">
              {previewRoutines.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2.5 border-b border-[#1A1A1A]">
                  <div>
                    <div className="text-[14px] text-white">{r.name}</div>
                    {r.phase_label && <div className="text-[11px] text-[#666]">{r.phase_label}</div>}
                    <div className="text-[11px] text-[#444]">{r.day_count} days</div>
                  </div>
                  <button
                    onClick={() => handleActivate(r.id)}
                    disabled={activating === r.id}
                    className="text-[12px] font-semibold text-black bg-[#BFFF00] rounded-lg px-3 py-1.5 disabled:opacity-50"
                  >
                    {activating === r.id ? "…" : "Activate"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
