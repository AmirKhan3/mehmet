"use client";
import type { Card } from "@/types";
import { SchedulePlanCard } from "./SchedulePlanCard";
import { WorkoutLoggedCard, WorkoutLogsCard } from "./WorkoutCard";
import { NutritionItemCard, NutritionDayCard, NutritionTargetsCard, MealSuggestionCard, NutritionSetupCard, NutritionWeekCard } from "./NutritionCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { RoutineImportPreviewCard, RoutineListCard } from "./RoutineCard";

interface Props {
  card: Card;
  onTap: (card: Card) => void;
  onConfirm?: () => void;
}

export function CardPeek({ card, onTap, onConfirm }: Props) {
  const isConfirmation = card.type === "confirmation";

  return (
    <div
      onClick={isConfirmation ? undefined : () => onTap(card)}
      className={`
        rounded-2xl border border-[#222] bg-[#111] p-4 w-full
        ${isConfirmation ? "" : "cursor-pointer active:scale-[0.98] transition-transform"}
      `}
    >
      <div className="text-[11px] font-semibold text-[#444] uppercase tracking-widest mb-2.5">
        {card.title}
      </div>
      <CardContent card={card} onConfirm={onConfirm} />
      {!isConfirmation && (
        <div className="mt-3 text-[11px] text-[#444]">Tap to expand →</div>
      )}
    </div>
  );
}

function CardContent({ card, onConfirm }: { card: Card; onConfirm?: () => void }) {
  switch (card.type) {
    case "schedule_plan":
    case "weekday_template":
      return <SchedulePlanCard card={card} />;
    case "schedule_week":
      return <ScheduleWeekCard card={card} />;
    case "workout_logged":
      return <WorkoutLoggedCard card={card} />;
    case "workout_logs":
      return <WorkoutLogsCard card={card} />;
    case "nutrition_item_logged":
      return <NutritionItemCard card={card} />;
    case "nutrition_day":
      return <NutritionDayCard card={card} />;
    case "nutrition_targets_vs_actuals":
      return <NutritionTargetsCard card={card} />;
    case "meal_suggestion": return <MealSuggestionCard card={card} />;
    case "nutrition_setup_required": return <NutritionSetupCard card={card} />;
    case "nutrition_week": return <NutritionWeekCard card={card} />;
    case "nutrition_deleted":
    case "nutrition_restored":
      return (
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">{card.type === "nutrition_deleted" ? "Removed" : "Restored"}</div>
          <div className="text-[14px] text-white/80">{(card.data as { item_name?: string }).item_name}</div>
        </div>
      );
    case "program_edit_preview":
      return <PreviewCard card={card} />;
    case "confirmation":
      return <ConfirmationCard card={card} onConfirm={onConfirm} />;
    case "routine_import_preview":
      return <RoutineImportPreviewCard card={card} />;
    case "routine_list":
      return <RoutineListCard card={card} />;
    default:
      return <div className="text-[13px] text-[#666]">{JSON.stringify(card.data).slice(0, 100)}</div>;
  }
}

function ScheduleWeekCard({ card }: { card: Card }) {
  const week = (card.data as { week?: { weekday: string; session_type: string; is_rest_day: boolean }[] }).week || [];
  return (
    <div className="space-y-1.5">
      {week.map((day) => (
        <div key={day.weekday} className="flex items-center justify-between">
          <span className="text-[12px] text-[#666] w-8">{day.weekday.slice(0, 3)}</span>
          <span className={`text-[13px] ${day.is_rest_day ? "text-[#444]" : "text-white/80"}`}>
            {day.is_rest_day ? "Rest" : day.session_type}
          </span>
        </div>
      ))}
    </div>
  );
}

function PreviewCard({ card }: { card: Card }) {
  const d = card.data as { message?: string; pending_confirmation?: boolean };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-yellow-400 uppercase">Preview</div>
      <div className="text-[13px] text-white/80">{d.message}</div>
      {d.pending_confirmation && (
        <div className="text-[11px] text-[#666]">Reply "confirm" to apply</div>
      )}
    </div>
  );
}
