"use client";
import { useState, useEffect, useCallback } from "react";

interface LogRow {
  id: number;
  date: string;
  exercise_name: string | null;
  sets: number | null;
  reps: number | null;
  round_number: number | null;
  status: string | null;
  modifier: string | null;
  exception_type: string | null;
  skipped: boolean | null;
}

interface GroupedDay {
  date: string;
  label: string;
  rows: LogRow[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function groupByDate(logs: LogRow[]): GroupedDay[] {
  const map = new Map<string, LogRow[]>();
  for (const row of logs) {
    if (!map.has(row.date)) map.set(row.date, []);
    map.get(row.date)!.push(row);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, rows]) => ({ date, label: formatDate(date), rows }));
}

function setsRepsStr(row: LogRow): string {
  if (row.sets && row.reps) return `${row.sets}×${row.reps}`;
  if (row.sets) return `${row.sets} sets`;
  if (row.reps) return `${row.reps} reps`;
  return "";
}

export default function LogsPage() {
  const [groups, setGroups] = useState<GroupedDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/logs");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setGroups(groupByDate(data.logs || []));
    } catch {
      setError("Could not load logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-5 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <a href="/" className="text-[#666] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 16L7 10L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <h1 className="text-[22px] font-bold">Workout Logs</h1>
        </div>

        {loading && (
          <div className="text-[13px] text-[#444]">Loading…</div>
        )}

        {error && (
          <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-[13px] text-red-400">{error}</div>
        )}

        {!loading && groups.length === 0 && !error && (
          <div className="text-[14px] text-[#555]">No workouts logged yet. Tell Strong what you completed in chat.</div>
        )}

        {groups.map((group) => (
          <div key={group.date} className="space-y-2">
            <div className="text-[11px] font-semibold tracking-widest text-[#BFFF00] uppercase">{group.label}</div>
            <div className="rounded-2xl border border-[#222] bg-[#111] overflow-hidden">
              {group.rows.map((row, i) => (
                <div
                  key={row.id}
                  className={`flex items-center justify-between px-4 py-3 ${i < group.rows.length - 1 ? "border-b border-[#1A1A1A]" : ""}`}
                >
                  <div className="flex-1 min-w-0 pr-3">
                    <div className={`text-[13px] font-medium ${row.skipped ? "text-white/30 line-through" : "text-white"}`}>
                      {row.exercise_name || "Unknown exercise"}
                    </div>
                    {row.exception_type && (
                      <div className="text-[11px] text-[#666] mt-0.5">{row.exception_type}</div>
                    )}
                    {row.modifier && (
                      <div className="text-[11px] text-[#555] mt-0.5">{row.modifier}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {setsRepsStr(row) && (
                      <div className="text-[13px] font-mono text-[#BFFF00]">{setsRepsStr(row)}</div>
                    )}
                    {row.round_number != null && (
                      <div className="text-[10px] text-[#444] mt-0.5">round {row.round_number}</div>
                    )}
                    {row.skipped && (
                      <div className="text-[11px] text-[#555]">skipped</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
