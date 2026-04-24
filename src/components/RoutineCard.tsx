"use client";
import type { Card } from "@/types";

interface RoutineSummary {
  id: number;
  name: string;
  phase_label?: string | null;
  schedule_mode: string;
  day_count: number;
  status?: string;
}

interface ImportPreviewData {
  routine_ids?: number[];
  routines?: RoutineSummary[];
  phases?: number;
  total_exercises?: number;
  status?: string;
  error?: string;
}

interface RoutineListData {
  routines?: RoutineSummary[];
  activated?: RoutineSummary;
  message?: string;
}

// --- Peek cards ---

export function RoutineImportPreviewCard({ card, onActivate }: { card: Card; onActivate?: (ids: number[]) => void }) {
  const d = card.data as ImportPreviewData;

  if (d.error) {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold tracking-widest text-red-400 uppercase">Import Error</div>
        <div className="text-[13px] text-[#999]">{d.error}</div>
      </div>
    );
  }

  const routines = d.routines || [];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Imported</span>
        <span className="text-[12px] text-[#666]">
          {d.phases && d.phases > 1 ? `${d.phases} phases` : "1 routine"} · {d.total_exercises} exercises
        </span>
      </div>
      <div className="space-y-1">
        {routines.slice(0, 3).map((r) => (
          <div key={r.id} className="flex items-center justify-between">
            <span className="text-[13px] text-white/80">{r.name}</span>
            <span className="text-[12px] text-[#666]">{r.day_count}d</span>
          </div>
        ))}
      </div>
      {onActivate && d.routine_ids && (
        <button
          onClick={() => onActivate(d.routine_ids!)}
          className="w-full text-center text-[12px] font-semibold text-black bg-[#BFFF00] rounded-lg py-2 mt-1"
        >
          Activate
        </button>
      )}
    </div>
  );
}

export function RoutineListCard({ card }: { card: Card }) {
  const d = card.data as RoutineListData;
  const routines = d.routines || [];
  const active = routines.find((r) => r.status === "active");

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Routines</div>
      {active && (
        <div className="text-[14px] font-medium text-white">
          {active.name}
          {active.phase_label && <span className="text-[#666] ml-1 text-[12px]">· {active.phase_label}</span>}
        </div>
      )}
      <div className="text-[12px] text-[#666]">{routines.length} routine{routines.length !== 1 ? "s" : ""} total</div>
      {d.message && <div className="text-[12px] text-[#BFFF00]">{d.message}</div>}
    </div>
  );
}

// --- Detail views ---

interface BlockEx {
  name: string;
  name_raw?: string;
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  tempo?: string | null;
  rir_min?: number | null;
  rir_max?: number | null;
  load_notes?: string | null;
  is_amrap?: boolean;
  duration_sec?: number | null;
}

interface Block {
  block_type: string;
  rounds?: number | null;
  rest_between_exercises_sec?: number | null;
  rest_between_rounds_sec?: number | null;
  notes?: string | null;
  exercises?: BlockEx[];
}

interface DayDetail {
  name?: string;
  session_type?: string;
  is_rest_day?: boolean;
  blocks?: Block[];
}

function repsLabel(ex: BlockEx): string {
  if (ex.is_amrap) return "AMRAP";
  if (ex.duration_sec) return `${ex.duration_sec}s`;
  if (ex.reps_min && ex.reps_max && ex.reps_min !== ex.reps_max) return `${ex.reps_min}–${ex.reps_max}`;
  if (ex.reps_min) return `${ex.reps_min}`;
  return "";
}

function BlockSection({ block, index }: { block: Block; index: number }) {
  const isCircuit = block.block_type === "circuit" || block.block_type === "superset";
  const exercises = block.exercises || [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-widest text-[#666] uppercase">
          {isCircuit ? `Block ${index + 1}` : "Exercises"}
        </span>
        {isCircuit && block.rounds && (
          <span className="text-[11px] text-[#444]">{block.rounds} rounds</span>
        )}
        {block.rest_between_rounds_sec && (
          <span className="text-[11px] text-[#444]">{block.rest_between_rounds_sec}s rest</span>
        )}
      </div>
      {block.notes && (
        <div className="text-[11px] text-[#555] italic">{block.notes}</div>
      )}
      {exercises.map((ex, i) => (
        <div key={i} className="flex items-start justify-between py-2 border-b border-[#111]">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-white truncate">{ex.name}</div>
            {ex.load_notes && (
              <div className="text-[11px] text-[#555] mt-0.5">{ex.load_notes}</div>
            )}
          </div>
          <div className="text-right ml-3 shrink-0">
            {ex.sets && !isCircuit && (
              <div className="text-[12px] font-mono text-[#BFFF00]">{ex.sets}×{repsLabel(ex)}</div>
            )}
            {isCircuit && repsLabel(ex) && (
              <div className="text-[12px] font-mono text-[#BFFF00]">{repsLabel(ex)}</div>
            )}
            {ex.tempo && (
              <div className="text-[10px] text-[#444] mt-0.5">{ex.tempo}</div>
            )}
            {(ex.rir_min != null) && (
              <div className="text-[10px] text-[#444]">
                RIR {ex.rir_min === ex.rir_max ? ex.rir_min : `${ex.rir_min}–${ex.rir_max}`}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RoutineImportPreviewDetail({ card }: { card: Card }) {
  const d = card.data as ImportPreviewData;
  const routines = d.routines || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Imported — Draft</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
        <div className="text-[13px] text-[#666] mt-1">
          {d.phases && d.phases > 1 ? `${d.phases} phases` : "Ready to activate"} · {d.total_exercises} exercises
        </div>
      </div>
      <div className="space-y-2">
        {routines.map((r, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-[#1A1A1A]">
            <div>
              <div className="text-[14px] font-medium text-white">{r.name}</div>
              {r.phase_label && <div className="text-[12px] text-[#666]">{r.phase_label}</div>}
            </div>
            <div className="text-right">
              <div className="text-[12px] text-[#666]">{r.day_count} days</div>
              <div className="text-[11px] text-[#444] capitalize">{r.schedule_mode}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[12px] text-[#555]">
        Go to Settings → Routines to activate or manage phases.
      </div>
    </div>
  );
}

export function RoutineListDetail({ card }: { card: Card }) {
  const d = card.data as RoutineListData;
  const routines = d.routines || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Routines</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      {d.message && (
        <div className="text-[14px] text-[#BFFF00]">{d.message}</div>
      )}
      <div className="space-y-1">
        {routines.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-3 border-b border-[#1A1A1A]">
            <div>
              <div className="text-[14px] font-medium text-white">{r.name}</div>
              {r.phase_label && <div className="text-[12px] text-[#666]">{r.phase_label}</div>}
            </div>
            <div className="text-right">
              <div className={`text-[12px] font-semibold capitalize ${r.status === "active" ? "text-[#BFFF00]" : "text-[#444]"}`}>
                {r.status}
              </div>
              <div className="text-[11px] text-[#444]">{r.day_count}d</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RoutineDetailView({ card }: { card: Card }) {
  const d = card.data as DayDetail;
  const blocks = d.blocks || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">
          {d.session_type || "Workout"}
        </div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      {d.is_rest_day ? (
        <div className="text-white/60">Rest day.</div>
      ) : (
        <div className="space-y-6">
          {blocks.map((block, i) => (
            <BlockSection key={i} block={block} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
