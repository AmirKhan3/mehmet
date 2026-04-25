"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Card } from "@/types";

interface RoutineSummary {
  id: number;
  name: string;
  status: string;
  schedule_mode: string;
  phase_label?: string | null;
  day_count: number;
  parent_routine_id?: number | null;
}

interface ImportPreviewData {
  routine_ids?: number[];
  routines?: RoutineSummary[];
  phases?: number;
  total_exercises?: number;
  error?: string;
}

export default function RoutinesPage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Card | null>(null);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [activating, setActivating] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchRoutines = useCallback(async () => {
    const res = await fetch("/api/routines/list");
    if (res.ok) {
      const data = await res.json();
      setRoutines(data.routines || []);
    }
  }, []);

  useEffect(() => {
    fetchRoutines();
  }, [fetchRoutines]);

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

  async function handleDelete(routineId: number) {
    setDeleting(routineId);
    try {
      await fetch("/api/routines/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routine_id: routineId }),
      });
      await fetchRoutines();
    } finally {
      setDeleting(null);
    }
  }

  async function handleActivate(routineId: number) {
    setActivating(routineId);
    try {
      await fetch("/api/routines/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routine_id: routineId }),
      });
      await fetchRoutines();
      setPreview(null);
      setText("");
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

  const previewData = preview?.data as ImportPreviewData | undefined;
  const previewRoutines = previewData?.routines || [];
  const activeRoutine = routines.find((r) => r.status === "active");

  // Group by parent_routine_id
  const grouped: Map<number | null, RoutineSummary[]> = new Map();
  for (const r of routines) {
    const key = r.parent_routine_id ?? r.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  const groups = Array.from(grouped.values());

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-5 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <a href="/" className="text-[#666] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 16L7 10L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <h1 className="text-[22px] font-bold">Routines</h1>
        </div>

        {/* Active routine */}
        {activeRoutine && (
          <div className="rounded-2xl border border-[#222] bg-[#111] p-5">
            <div className="text-[10px] font-semibold tracking-widest text-[#BFFF00] uppercase mb-2">Active</div>
            <div className="text-[17px] font-semibold text-white">{activeRoutine.name}</div>
            {activeRoutine.phase_label && (
              <div className="text-[12px] text-[#666] mt-0.5">{activeRoutine.phase_label}</div>
            )}
            <div className="text-[12px] text-[#444] mt-1 capitalize">{activeRoutine.schedule_mode} · {activeRoutine.day_count} days</div>
          </div>
        )}

        {/* Import section */}
        <div className="space-y-3">
          <div className="text-[13px] font-semibold text-[#999] uppercase tracking-wider">Import Routine</div>

          {/* Drop zone */}
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

          {/* Paste textarea */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Or paste your routine text here..."
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

        {/* Preview result */}
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

        {previewData?.error && (
          <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-[13px] text-red-400">
            {previewData.error}
          </div>
        )}

        {/* All routines */}
        {groups.length > 0 && (
          <div className="space-y-3">
            <div className="text-[13px] font-semibold text-[#999] uppercase tracking-wider">All Routines</div>
            {groups.map((group, gi) => (
              <div key={gi} className="rounded-2xl border border-[#222] bg-[#111] overflow-hidden">
                {group.map((r, ri) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between p-4 ${ri < group.length - 1 ? "border-b border-[#1A1A1A]" : ""}`}
                  >
                    <div>
                      <div className="text-[14px] font-medium text-white">{r.name}</div>
                      <div className="text-[11px] text-[#555] mt-0.5 capitalize">
                        {r.status}
                        {r.phase_label ? ` · ${r.phase_label}` : ""}
                        {" · "}{r.day_count} days
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status !== "active" && (
                        <button
                          onClick={() => handleActivate(r.id)}
                          disabled={activating === r.id}
                          className="text-[12px] text-[#BFFF00] border border-[#BFFF00]/30 rounded-lg px-3 py-1.5 disabled:opacity-50"
                        >
                          {activating === r.id ? "…" : "Activate"}
                        </button>
                      )}
                      {r.status === "active" && (
                        <span className="text-[11px] font-semibold text-[#BFFF00]">Active</span>
                      )}
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={deleting === r.id}
                        className="text-[#444] hover:text-red-500 transition-colors disabled:opacity-30 p-1"
                        title="Delete"
                      >
                        {deleting === r.id ? "…" : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
