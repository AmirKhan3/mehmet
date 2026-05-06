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

function todayStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

function fmtLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const today = todayStr();
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1))
    .toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function fmtShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function setsRepsStr(row: LogRow): string {
  if (row.sets && row.reps) return `${row.sets}×${row.reps}`;
  if (row.sets) return `${row.sets} sets`;
  if (row.reps) return `${row.reps} reps`;
  return "";
}

export default function LogsPage() {
  const [dates, setDates] = useState<string[]>([]);
  const [dayIndex, setDayIndex] = useState(0); // 0 = most recent date with logs (or today)
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingDates, setLoadingDates] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Load all dates that have logs
  useEffect(() => {
    fetch("/api/logs")
      .then((r) => r.json())
      .then((data) => {
        const d: string[] = data.dates || [];
        setDates(d);
        // Start at today; if today has no logs, show it empty (user can nav back)
        const today = todayStr();
        const idx = d.indexOf(today);
        if (idx >= 0) {
          setDayIndex(idx);
          setCurrentDate(today);
        } else {
          // Insert today at the front as a placeholder
          setDates([today, ...d]);
          setDayIndex(0);
          setCurrentDate(today);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDates(false));
  }, []);

  const fetchLogs = useCallback(async (date: string) => {
    setLoadingLogs(true);
    setLogs([]);
    try {
      const res = await fetch(`/api/logs?date=${date}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (currentDate) fetchLogs(currentDate);
  }, [currentDate, fetchLogs]);

  function navigate(dir: -1 | 1) {
    const next = dayIndex + dir;
    if (next < 0 || next >= dates.length) return;
    setDayIndex(next);
    setCurrentDate(dates[next]);
  }

  const canPrev = dayIndex < dates.length - 1; // older
  const canNext = dayIndex > 0;                 // newer

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-5 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <a href="/" className="text-[#666] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 16L7 10L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
          <h1 className="text-[22px] font-bold">Workout Logs</h1>
        </div>

        {/* Day navigator */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(1)}
            disabled={!canPrev || loadingDates}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#666] hover:text-white hover:bg-[#111] disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 13L5 8L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div className="text-center">
            <div className="text-[17px] font-semibold">{fmtLabel(currentDate)}</div>
            <div className="text-[12px] text-[#444] mt-0.5">{fmtShort(currentDate)}</div>
          </div>

          <button
            onClick={() => navigate(-1)}
            disabled={!canNext || loadingDates}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#666] hover:text-white hover:bg-[#111] disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Logs for selected day */}
        {loadingLogs && (
          <div className="text-[13px] text-[#444]">Loading…</div>
        )}

        {!loadingLogs && logs.length === 0 && (
          <div className="rounded-2xl border border-[#1A1A1A] bg-[#0A0A0A] px-5 py-8 text-center">
            <div className="text-[13px] text-[#444]">No workout logged</div>
          </div>
        )}

        {!loadingLogs && logs.length > 0 && (
          <div className="rounded-2xl border border-[#222] bg-[#111] overflow-hidden">
            {logs.map((row, i) => (
              <div
                key={row.id}
                className={`flex items-center justify-between px-4 py-3 ${i < logs.length - 1 ? "border-b border-[#1A1A1A]" : ""}`}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <div className={`text-[13px] font-medium ${row.skipped ? "text-white/30 line-through" : "text-white"}`}>
                    {row.exercise_name ?? "—"}
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
        )}

      </div>
    </div>
  );
}
