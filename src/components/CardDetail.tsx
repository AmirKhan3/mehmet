"use client";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import type { Card } from "@/types";
import { SchedulePlanDetail } from "./SchedulePlanCard";
import { WorkoutLogsDetail, WorkoutLoggedDetail } from "./WorkoutCard";
import { NutritionTargetsDetail, NutritionDayDetail, NutritionItemDetail, MealSuggestionDetail, NutritionSetupDetail, NutritionWeekDetail } from "./NutritionCard";
import { RoutineImportPreviewDetail, RoutineListDetail, RoutineDetailView } from "./RoutineCard";

interface Props {
  card: Card | null;
  onClose: () => void;
  onEditEntry?: (kind: "workout_log" | "nutrition_entry", entry_id: number) => void;
}

export function CardDetail({ card, onClose, onEditEntry }: Props) {
  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > 80) onClose();
  }

  return (
    <AnimatePresence>
      {card && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
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
            onDragEnd={handleDragEnd}
            className="fixed right-0 top-0 bottom-0 w-[92vw] max-w-md bg-[#0A0A0A] border-l border-[#1A1A1A] z-50 overflow-y-auto"
          >
            <div className="flex items-center px-6 pt-6 pb-2">
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 text-[#666] hover:text-white transition-colors text-[13px]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
            </div>
            <DetailContent card={card} onEditEntry={onEditEntry} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function DetailContent({ card, onEditEntry }: { card: Card; onEditEntry?: (kind: "workout_log" | "nutrition_entry", entry_id: number) => void }) {
  switch (card.type) {
    case "schedule_plan":
    case "weekday_template":
      return <SchedulePlanDetail card={card} />;
    case "schedule_week":
      return <WeekDetail card={card} />;
    case "workout_logged":
    case "workout_corrected":
      return <WorkoutLoggedDetail card={card} onEditEntry={onEditEntry as ((kind: "workout_log", id: number) => void) | undefined} />;
    case "workout_logs":
      return <WorkoutLogsDetail card={card} />;
    case "nutrition_item_logged":
    case "nutrition_corrected":
      return <NutritionItemDetail card={card} onEditEntry={onEditEntry as ((kind: "nutrition_entry", id: number) => void) | undefined} />;
    case "nutrition_day":
      return <NutritionDayDetail card={card} />;
    case "nutrition_targets_vs_actuals":
      return <NutritionTargetsDetail card={card} />;
    case "meal_suggestion": return <MealSuggestionDetail card={card} />;
    case "nutrition_setup_required": return <NutritionSetupDetail card={card} />;
    case "nutrition_week": return <NutritionWeekDetail card={card} />;
    case "routine_import_preview":
      return <RoutineImportPreviewDetail card={card} />;
    case "routine_list":
      return <RoutineListDetail card={card} />;
    case "routine_detail":
      return <RoutineDetailView card={card} />;
    default:
      return (
        <div className="p-6">
          <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-2">{card.type}</div>
          <div className="text-2xl font-bold text-white mb-4">{card.title}</div>
          <pre className="text-[11px] text-[#666] whitespace-pre-wrap break-all">
            {JSON.stringify(card.data, null, 2)}
          </pre>
        </div>
      );
  }
}

function WeekDetail({ card }: { card: Card }) {
  const week = (card.data as { week?: { weekday: string; session_type: string; is_rest_day: boolean; exercises?: { name: string; sets?: number; reps?: number }[] }[] }).week || [];
  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Schedule</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      <div className="space-y-4">
        {week.map((day) => (
          <div key={day.weekday} className="border-b border-[#1A1A1A] pb-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[15px] font-semibold text-white">{day.weekday}</span>
              <span className={`text-[12px] ${day.is_rest_day ? "text-[#444]" : "text-[#BFFF00]"}`}>
                {day.is_rest_day ? "Rest" : day.session_type}
              </span>
            </div>
            {!day.is_rest_day && Array.isArray(day.exercises) && day.exercises.length > 0 && (
              <div className="space-y-1">
                {day.exercises.filter(e => e.name).map((ex, i) => (
                  <div key={i} className="flex justify-between text-[12px]">
                    <span className="text-[#666]">{ex.name}</span>
                    <span className="text-[#444] font-mono">{ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
