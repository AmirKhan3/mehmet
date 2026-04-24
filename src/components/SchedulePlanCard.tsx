"use client";
import type { Card } from "@/types";

interface Exercise {
  name: string;
  sets?: number;
  reps?: number;
  tempo?: string;
  notes?: string;
}

interface BlockExercise {
  name: string;
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  tempo?: string | null;
  is_amrap?: boolean;
  duration_sec?: number | null;
}

interface Block {
  block_type: string;
  rounds?: number | null;
  rest_between_exercises_sec?: number | null;
  rest_between_rounds_sec?: number | null;
  notes?: string | null;
  exercises?: BlockExercise[];
}

interface ScheduleData {
  date?: string;
  session_type?: string;
  exercises?: Exercise[];
  blocks?: Block[];
  is_rest_day?: boolean;
  day_name?: string;
  routine_name?: string;
  phase_label?: string;
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

function repsStr(ex: BlockExercise): string {
  if (ex.is_amrap) return "AMRAP";
  if (ex.duration_sec) return `${ex.duration_sec}s`;
  if (ex.reps_min && ex.reps_max && ex.reps_min !== ex.reps_max) return `${ex.reps_min}–${ex.reps_max}`;
  if (ex.reps_min) return `${ex.reps_min}`;
  return "";
}

export function SchedulePlanDetail({ card }: { card: Card }) {
  const d = card.data as ScheduleData;
  const exercises: Exercise[] = Array.isArray(d.exercises) ? d.exercises : [];
  const blocks: Block[] = Array.isArray(d.blocks) && d.blocks.length > 0 ? d.blocks : [];
  const hasBlocks = blocks.some((b) => (b.exercises?.length || 0) > 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">
          {d.day_name || d.session_type || "Training"}
        </div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
        {d.routine_name && (
          <div className="text-[12px] text-[#555] mt-1">
            {d.routine_name}{d.phase_label ? ` · ${d.phase_label}` : ""}
          </div>
        )}
      </div>
      {d.is_rest_day ? (
        <div className="text-white/60">Take it easy today. Recovery is training.</div>
      ) : hasBlocks ? (
        <div className="space-y-6">
          {blocks.map((block, bi) => {
            const isCircuit = block.block_type === "circuit" || block.block_type === "superset";
            const blockExercises = block.exercises || [];
            return (
              <div key={bi} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-widest text-[#555] uppercase">
                    {isCircuit ? `Block ${bi + 1}` : "Exercises"}
                  </span>
                  {isCircuit && block.rounds && (
                    <span className="text-[11px] text-[#444]">{block.rounds} rounds</span>
                  )}
                  {block.rest_between_rounds_sec && (
                    <span className="text-[11px] text-[#333]">{block.rest_between_rounds_sec}s rest</span>
                  )}
                </div>
                {blockExercises.map((ex, ei) => (
                  <div key={ei} className="flex items-start justify-between py-2.5 border-b border-[#111]">
                    <div className="text-[13px] font-medium text-white flex-1 min-w-0 pr-3">{ex.name}</div>
                    <div className="text-right shrink-0">
                      {isCircuit ? (
                        repsStr(ex) && <div className="text-[13px] font-mono text-[#BFFF00]">{repsStr(ex)}</div>
                      ) : (
                        (ex.sets && repsStr(ex)) && (
                          <div className="text-[13px] font-mono text-[#BFFF00]">{ex.sets}×{repsStr(ex)}</div>
                        )
                      )}
                      {ex.tempo && <div className="text-[10px] text-[#444] mt-0.5">{ex.tempo}</div>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
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
