"use client";
import type { Card } from "@/types";

interface Exercise {
  name: string;
  sets?: number;
  reps?: number;
  tempo?: string;
  notes?: string;
}

interface ScheduleData {
  date?: string;
  session_type?: string;
  exercises?: Exercise[];
  is_rest_day?: boolean;
}

export function SchedulePlanCard({ card }: { card: Card }) {
  const d = card.data as ScheduleData;
  const exercises: Exercise[] = Array.isArray(d.exercises) ? d.exercises : [];

  if (d.is_rest_day) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold tracking-widest text-[#999] uppercase">Rest Day</div>
        <div className="text-[15px] text-white/60">Recovery and mobility</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">
          {d.session_type || "Training"}
        </span>
        <span className="text-xs text-[#666]">{exercises.length} exercises</span>
      </div>
      <div className="space-y-1.5">
        {exercises.slice(0, 4).map((ex, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-[13px] text-white/80">{ex.name}</span>
            <span className="text-[12px] text-[#666] font-mono">
              {ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ex.sets ? `${ex.sets} sets` : ""}
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

export function SchedulePlanDetail({ card }: { card: Card }) {
  const d = card.data as ScheduleData;
  const exercises: Exercise[] = Array.isArray(d.exercises) ? d.exercises : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">
          {d.session_type || "Training"}
        </div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      {d.is_rest_day ? (
        <div className="text-white/60">Take it easy today. Recovery is training.</div>
      ) : (
        <div className="space-y-3">
          {exercises.map((ex, i) => (
            <div key={i} className="flex items-start justify-between py-3 border-b border-[#1A1A1A]">
              <div>
                <div className="text-[15px] font-medium text-white">{ex.name}</div>
                {ex.notes && <div className="text-[12px] text-[#666] mt-0.5">{ex.notes}</div>}
              </div>
              <div className="text-right shrink-0 ml-4">
                {ex.sets && ex.reps && (
                  <div className="text-[15px] font-mono text-[#BFFF00]">{ex.sets}×{ex.reps}</div>
                )}
                {ex.tempo && (
                  <div className="text-[11px] text-[#666] mt-0.5">{ex.tempo}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
