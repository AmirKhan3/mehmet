"use client";
import type { Card } from "@/types";

interface LogEntry {
  id?: number;
  name: string;
  sets?: number;
  reps?: number;
  status?: string;
  skipped?: boolean;
}

interface WorkoutLogsData {
  date?: string;
  logs?: LogEntry[];
  completed?: number;
  planned?: number;
}

interface WorkoutLoggedData {
  date?: string;
  exercises?: LogEntry[];
  source_session?: string;
}

export function WorkoutLoggedCard({ card }: { card: Card }) {
  const d = card.data as WorkoutLoggedData;
  const exercises = Array.isArray(d.exercises) ? d.exercises : [];

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">
        Logged
      </div>
      <div className="space-y-1.5">
        {exercises.slice(0, 4).map((ex, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-[13px] text-white/80">{ex.name}</span>
            <span className="text-[12px] text-[#666] font-mono">
              {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ""}
            </span>
          </div>
        ))}
        {exercises.length > 4 && (
          <div className="text-[12px] text-[#666]">+{exercises.length - 4} more</div>
        )}
      </div>
    </div>
  );
}

export function WorkoutLogsCard({ card }: { card: Card }) {
  const d = card.data as WorkoutLogsData;
  const logs = Array.isArray(d.logs) ? d.logs : [];
  const pct = d.planned ? Math.round(((d.completed || 0) / d.planned) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Progress</span>
        <span className="text-[13px] font-mono text-white">
          {d.completed ?? 0}/{d.planned ?? 0}
        </span>
      </div>
      <div className="w-full h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#BFFF00] rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-1.5">
        {logs.slice(0, 4).map((ex, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className={`text-[13px] ${ex.skipped ? "text-[#666] line-through" : "text-white/80"}`}>
              {ex.name}
            </span>
            <span className="text-[12px] text-[#666] font-mono">
              {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkoutLoggedDetail({ card, onEditEntry }: { card: Card; onEditEntry?: (kind: "workout_log", entry_id: number) => void }) {
  const d = card.data as WorkoutLoggedData;
  const exercises = Array.isArray(d.exercises) ? d.exercises : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Logged</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
        {d.source_session && (
          <div className="text-[13px] text-[#666] mt-1">{d.source_session} plan</div>
        )}
      </div>
      <div className="space-y-3">
        {exercises.map((ex, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-[#1A1A1A]">
            <span className="text-[15px] font-medium text-white">{ex.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-mono text-[#BFFF00]">
                {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ""}
              </span>
              {ex.id && onEditEntry && (
                <button
                  onClick={() => onEditEntry("workout_log", ex.id!)}
                  className="text-[11px] text-[#555] hover:text-white/60 transition-colors"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        ))}
        {exercises.length === 0 && (
          <div className="text-[14px] text-[#666]">Session logged from template</div>
        )}
      </div>
    </div>
  );
}

export function WorkoutLogsDetail({ card }: { card: Card }) {
  const d = card.data as WorkoutLogsData;
  const logs = Array.isArray(d.logs) ? d.logs : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Workout</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
        <div className="text-[13px] text-[#666] mt-1">
          {d.completed ?? 0} of {d.planned ?? 0} completed
        </div>
      </div>
      <div className="space-y-3">
        {logs.map((ex, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-[#1A1A1A]">
            <span className={`text-[15px] font-medium ${ex.skipped ? "text-[#666] line-through" : "text-white"}`}>
              {ex.name}
            </span>
            <span className="text-[14px] font-mono text-[#BFFF00]">
              {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ex.status || ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
