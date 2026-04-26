"use client";
import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PanInfo } from "framer-motion";
import { BlockSection } from "@/components/RoutineCard";

interface RoutineSummary {
  id: number;
  name: string;
  status: string;
  schedule_mode: string;
  phase_label?: string | null;
  day_count: number;
  parent_routine_id?: number | null;
}

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

interface RoutineDay {
  day_index: number;
  name: string;
  session_type?: string | null;
  is_rest_day?: boolean;
  notes?: string | null;
  blocks: Block[];
}

interface RoutineDetail {
  routine: {
    id: number;
    name: string;
    status: string;
    schedule_mode: string;
    phase_label?: string | null;
    today_day_index: number;
  };
  days: RoutineDay[];
}

export default function RoutinesPage() {
  const [detail, setDetail] = useState<RoutineDetail | null>(null);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activating, setActivating] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const listRes = await fetch("/api/routines/list");
      const listData = await listRes.json();
      const all: RoutineSummary[] = listData.routines || [];
      setRoutines(all);

      const active = all.find((r) => r.status === "active");
      if (active) {
        const detailRes = await fetch(`/api/routines/${active.id}`);
        if (detailRes.ok) setDetail(await detailRes.json());
      } else {
        setDetail(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleActivate(routineId: number) {
    setActivating(routineId);
    try {
      await fetch("/api/routines/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routine_id: routineId }),
      });
      setPanelOpen(false);
      await fetchAll();
    } finally {
      setActivating(null);
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
      await fetchAll();
    } finally {
      setDeleting(null);
    }
  }

  const nonActive = routines.filter((r) => r.status !== "active");

  // Group non-active by parent_routine_id
  const grouped: Map<number, RoutineSummary[]> = new Map();
  for (const r of nonActive) {
    const key = r.parent_routine_id ?? r.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  const groups = Array.from(grouped.values());

  const todayIdx = detail?.routine.today_day_index ?? -1;
  const todayDay = detail?.days.find((d) => d.day_index === todayIdx) ?? null;
  const otherDays = detail?.days.filter((d) => d.day_index !== todayIdx) ?? [];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Side panel — All routines */}
      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setPanelOpen(false)}
            />
            <motion.div
              key="panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              drag="x"
              dragConstraints={{ left: 0, right: 400 }}
              dragElastic={{ left: 0, right: 0.4 }}
              onDragEnd={(_: unknown, info: PanInfo) => { if (info.offset.x > 80) setPanelOpen(false); }}
              className="fixed right-0 top-0 bottom-0 w-[92vw] max-w-md bg-[#0A0A0A] border-l border-[#1A1A1A] z-50 overflow-y-auto"
            >
              <div className="flex items-center px-6 pt-6 pb-2">
                <button
                  onClick={() => setPanelOpen(false)}
                  className="flex items-center gap-1.5 text-[#666] hover:text-white transition-colors text-[13px]"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </button>
              </div>
              <div className="px-6 py-4 space-y-6">
                <div className="text-[20px] font-bold text-white">All Routines</div>
                {groups.length === 0 ? (
                  <div className="text-[13px] text-[#555]">No other routines saved.</div>
                ) : (
                  groups.map((group, gi) => (
                    <div key={gi} className="rounded-2xl border border-[#222] bg-[#111] overflow-hidden">
                      {group.map((r, ri) => (
                        <div
                          key={r.id}
                          className={`flex items-center justify-between p-4 ${ri < group.length - 1 ? "border-b border-[#1A1A1A]" : ""}`}
                        >
                          <div className="flex-1 min-w-0 pr-3">
                            <div className="text-[14px] font-medium text-white truncate">{r.name}</div>
                            <div className="text-[11px] text-[#555] mt-0.5 capitalize">
                              {r.phase_label ? `${r.phase_label} · ` : ""}{r.schedule_mode} · {r.day_count} days
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleActivate(r.id)}
                              disabled={activating === r.id}
                              className="text-[12px] text-[#BFFF00] border border-[#BFFF00]/30 rounded-lg px-3 py-1.5 disabled:opacity-50"
                            >
                              {activating === r.id ? "…" : "Activate"}
                            </button>
                            <button
                              onClick={() => handleDelete(r.id)}
                              disabled={deleting === r.id}
                              className="text-[#444] hover:text-red-500 transition-colors disabled:opacity-30 p-1"
                            >
                              {deleting === r.id ? "…" : (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                  <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="max-w-lg mx-auto px-5 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-[#666] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M13 16L7 10L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <h1 className="text-[22px] font-bold">Routines</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPanelOpen(true)}
              className="text-[12px] text-[#666] hover:text-white border border-[#222] rounded-lg px-3 py-1.5 transition-colors"
            >
              All routines
            </button>
            <a
              href="/routines/manage"
              className="text-[12px] text-[#BFFF00] border border-[#BFFF00]/30 rounded-lg px-3 py-1.5"
            >
              Manage
            </a>
          </div>
        </div>

        {loading && (
          <div className="text-[13px] text-[#444]">Loading…</div>
        )}

        {!loading && !detail && (
          <div className="space-y-4 pt-8 text-center">
            <div className="text-[#555] text-[15px]">No active routine.</div>
            <a
              href="/routines/manage"
              className="inline-block bg-[#BFFF00] text-black font-bold text-[14px] rounded-xl px-6 py-3"
            >
              Import a routine →
            </a>
          </div>
        )}

        {detail && (
          <>
            {/* Routine name */}
            <div>
              <div className="text-[13px] text-[#BFFF00] font-semibold tracking-widest uppercase">Active</div>
              <div className="text-[20px] font-bold text-white mt-0.5">{detail.routine.name}</div>
              {detail.routine.phase_label && (
                <div className="text-[12px] text-[#666] mt-0.5">{detail.routine.phase_label}</div>
              )}
              <div className="text-[11px] text-[#444] mt-1 capitalize">
                {detail.routine.schedule_mode} · {detail.days.length} days
              </div>
            </div>

            {/* TODAY — prominent */}
            {todayDay ? (
              <div className="rounded-2xl border border-[#BFFF00]/40 bg-[#BFFF00]/5 p-5 space-y-4">
                <div>
                  <div className="text-[11px] font-semibold tracking-widest text-[#BFFF00] uppercase">
                    Today · {todayDay.name}
                  </div>
                  {todayDay.session_type && todayDay.session_type !== todayDay.name && (
                    <div className="text-[13px] text-[#999] mt-0.5">{todayDay.session_type}</div>
                  )}
                </div>
                {todayDay.is_rest_day ? (
                  <div className="text-[14px] text-white/50">Rest day. Recovery is training.</div>
                ) : (
                  <div className="space-y-5">
                    {todayDay.blocks.map((block, bi) => (
                      <BlockSection key={bi} block={block} index={bi} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-[#BFFF00]/40 bg-[#BFFF00]/5 p-5">
                <div className="text-[11px] font-semibold tracking-widest text-[#BFFF00] uppercase">Today</div>
                <div className="text-[14px] text-white/50 mt-1">Rest day. Recovery is training.</div>
              </div>
            )}

            {/* Other days */}
            {otherDays.length > 0 && (
              <div className="space-y-4">
                <div className="text-[11px] font-semibold tracking-widest text-[#555] uppercase">Full Schedule</div>
                {otherDays.map((day) => (
                  <DaySection key={day.day_index} day={day} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DaySection({ day }: { day: RoutineDay }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-[#1A1A1A] bg-[#0A0A0A] overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <div className="text-[12px] font-semibold tracking-widest text-[#555] uppercase">{day.name}</div>
          {!day.is_rest_day && day.session_type && day.session_type !== day.name && (
            <div className="text-[11px] text-[#444] mt-0.5">{day.session_type}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {day.is_rest_day ? (
            <span className="text-[11px] text-[#444]">Rest</span>
          ) : (
            <span className="text-[11px] text-[#555]">
              {day.blocks.reduce((sum, b) => sum + (b.exercises?.length || 0), 0)} exercises
            </span>
          )}
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            className={`text-[#444] transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && !day.is_rest_day && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-5 border-t border-[#1A1A1A] pt-4">
              {day.blocks.map((block, bi) => (
                <BlockSection key={bi} block={block} index={bi} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
