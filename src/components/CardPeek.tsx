"use client";
import type { Card, ActionDescriptor } from "@/types";
import { SchedulePlanCard } from "./SchedulePlanCard";
import { WorkoutLoggedCard, WorkoutLogsCard } from "./WorkoutCard";
import { NutritionItemCard, NutritionDayCard, NutritionTargetsCard, MealSuggestionCard, NutritionSetupCard, NutritionWeekCard } from "./NutritionCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { RoutineImportPreviewCard, RoutineListCard } from "./RoutineCard";

const PREVIEW_TYPES = new Set([
  "workout_log_preview",
  "workout_correction_preview",
  "nutrition_setup_preview",
  "nutrition_correction_preview",
  "routine_activation_preview",
  "program_edit_preview",
  "confirmation",
]);

interface Props {
  card: Card;
  onTap: (card: Card) => void;
  onAction?: (card: Card, kind: ActionDescriptor["kind"], patch?: Record<string, unknown>) => void;
  /** @deprecated use onAction */
  onConfirm?: () => void;
}

export function CardPeek({ card, onTap, onAction, onConfirm }: Props) {
  const isPreview = PREVIEW_TYPES.has(card.type);

  const handleAction = (kind: ActionDescriptor["kind"], patch?: Record<string, unknown>) => {
    if (onAction) {
      onAction(card, kind, patch);
    } else if (kind === "confirm" && onConfirm) {
      onConfirm();
    }
  };

  return (
    <div
      onClick={isPreview ? undefined : () => onTap(card)}
      className={`
        rounded-2xl border border-[#222] bg-[#111] p-4 w-full
        ${isPreview ? "" : "cursor-pointer active:scale-[0.98] transition-transform"}
      `}
    >
      <div className="text-[11px] font-semibold text-[#444] uppercase tracking-widest mb-2.5">
        {card.title}
      </div>
      <CardContent card={card} onAction={handleAction} />
      {!isPreview && (
        <div className="mt-3 text-[11px] text-[#444]">Tap to expand →</div>
      )}
      {isPreview && card.pending_id && card.actions && card.actions.length > 0 && (
        <ActionBar actions={card.actions} onAction={handleAction} />
      )}
    </div>
  );
}

function ActionBar({
  actions,
  onAction,
}: {
  actions: ActionDescriptor[];
  onAction: (kind: ActionDescriptor["kind"], patch?: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex gap-2 mt-4 pt-3 border-t border-[#1A1A1A]">
      {actions.map((a) => (
        <ActionButton key={a.kind} descriptor={a} onAction={onAction} />
      ))}
    </div>
  );
}

function ActionButton({
  descriptor,
  onAction,
}: {
  descriptor: ActionDescriptor;
  onAction: (kind: ActionDescriptor["kind"], patch?: Record<string, unknown>) => void;
}) {
  const { kind, label } = descriptor;

  if (kind === "confirm") {
    return (
      <button
        onClick={() => onAction("confirm")}
        className="flex-1 text-[12px] font-semibold text-black bg-[#BFFF00] px-3 py-1.5 rounded-lg hover:bg-[#d4ff33] transition-colors"
      >
        {label}
      </button>
    );
  }
  if (kind === "cancel") {
    return (
      <button
        onClick={() => onAction("cancel")}
        className="flex-1 text-[12px] font-medium text-[#666] border border-[#2A2A2A] px-3 py-1.5 rounded-lg hover:bg-[#1A1A1A] transition-colors"
      >
        {label}
      </button>
    );
  }
  // edit — clicking sends the edit kind; the parent handles showing an edit UI
  return (
    <button
      onClick={() => onAction("edit")}
      className="flex-1 text-[12px] font-medium text-white/60 border border-[#2A2A2A] px-3 py-1.5 rounded-lg hover:bg-[#1A1A1A] transition-colors"
    >
      {label}
    </button>
  );
}

function CardContent({
  card,
  onAction,
}: {
  card: Card;
  onAction: (kind: ActionDescriptor["kind"], patch?: Record<string, unknown>) => void;
}) {
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
    case "workout_log_preview":
      return <WorkoutLogPreviewCard card={card} />;
    case "workout_correction_preview":
      return <WorkoutCorrectionPreviewCard card={card} />;
    case "nutrition_item_logged":
      return <NutritionItemCard card={card} />;
    case "nutrition_day":
      return <NutritionDayCard card={card} />;
    case "nutrition_targets_vs_actuals":
      return <NutritionTargetsCard card={card} />;
    case "meal_suggestion": return <MealSuggestionCard card={card} />;
    case "nutrition_setup_required": return <NutritionSetupCard card={card} />;
    case "nutrition_week": return <NutritionWeekCard card={card} />;
    case "nutrition_setup_preview":
      return <NutritionSetupPreviewCard card={card} />;
    case "nutrition_correction_preview":
      return <NutritionCorrectionPreviewCard card={card} />;
    case "nutrition_deleted":
    case "nutrition_restored":
      return (
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">{card.type === "nutrition_deleted" ? "Removed" : "Restored"}</div>
          <div className="text-[14px] text-white/80">{(card.data as { item_name?: string }).item_name}</div>
        </div>
      );
    case "program_edit_preview":
      return <ProgramEditPreviewCard card={card} />;
    case "confirmation":
      return <ConfirmationCard card={card} onConfirm={() => onAction("confirm")} />;
    case "routine_import_preview":
      return <RoutineImportPreviewCard card={card} />;
    case "routine_activation_preview":
      return <RoutineActivationPreviewCard card={card} />;
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

function ProgramEditPreviewCard({ card }: { card: Card }) {
  const d = card.data as { source?: string; target_date?: string; session_type?: string; error?: string };
  if (d.error) return <div className="text-[13px] text-red-400">{d.error}</div>;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-yellow-400 uppercase">Move Session</div>
      <div className="flex justify-between text-[13px]">
        <span className="text-[#666]">From</span>
        <span className="text-white/80">{d.source}</span>
      </div>
      <div className="flex justify-between text-[13px]">
        <span className="text-[#666]">To</span>
        <span className="text-white/80">{d.target_date}</span>
      </div>
      {d.session_type && (
        <div className="flex justify-between text-[13px]">
          <span className="text-[#666]">Session</span>
          <span className="text-white/80">{d.session_type}</span>
        </div>
      )}
    </div>
  );
}

function WorkoutLogPreviewCard({ card }: { card: Card }) {
  const d = card.data as { date?: string; exercises?: { name: string; sets: number; reps: number }[] };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Log Preview</div>
      <div className="text-[12px] text-[#666]">{d.date}</div>
      <div className="space-y-1">
        {(d.exercises || []).map((ex, i) => (
          <div key={i} className="flex justify-between text-[13px]">
            <span className="text-white/80">{ex.name}</span>
            <span className="text-[#666]">{ex.sets}×{ex.reps}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkoutCorrectionPreviewCard({ card }: { card: Card }) {
  const d = card.data as {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  const fields = ["sets", "reps", "status", "modifier"].filter(
    (k) => d.before?.[k] !== d.after?.[k]
  );
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-yellow-400 uppercase">Edit Entry</div>
      {fields.length === 0 ? (
        <div className="text-[13px] text-[#666]">No changes yet</div>
      ) : (
        <div className="space-y-1">
          {fields.map((k) => (
            <div key={k} className="flex justify-between text-[13px]">
              <span className="text-[#666]">{k}</span>
              <span>
                <span className="line-through text-[#444] mr-2">{String(d.before?.[k] ?? "—")}</span>
                <span className="text-white/80">{String(d.after?.[k] ?? "—")}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NutritionSetupPreviewCard({ card }: { card: Card }) {
  const d = card.data as {
    goal?: string;
    weight_lbs?: number;
    computed?: { calories_max?: number; protein_max_g?: number; carbs_max_g?: number; fats_max_g?: number };
  };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Macro Targets</div>
      <div className="flex justify-between text-[13px]">
        <span className="text-[#666]">Goal</span>
        <span className="text-white/80 capitalize">{d.goal}</span>
      </div>
      {d.weight_lbs && (
        <div className="flex justify-between text-[13px]">
          <span className="text-[#666]">Weight</span>
          <span className="text-white/80">{d.weight_lbs} lbs</span>
        </div>
      )}
      {d.computed && (
        <>
          <div className="flex justify-between text-[13px]">
            <span className="text-[#666]">Calories</span>
            <span className="text-white/80">{d.computed.calories_max} kcal</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-[#666]">Protein</span>
            <span className="text-white/80">{d.computed.protein_max_g}g</span>
          </div>
        </>
      )}
    </div>
  );
}

function NutritionCorrectionPreviewCard({ card }: { card: Card }) {
  const d = card.data as {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  const fields = ["item_name", "quantity", "calories", "protein_g", "carbs_g", "fat_g"].filter(
    (k) => d.before?.[k] !== d.after?.[k]
  );
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-yellow-400 uppercase">Edit Entry</div>
      {fields.length === 0 ? (
        <div className="text-[13px] text-[#666]">{String(d.before?.item_name ?? "Entry")}</div>
      ) : (
        <div className="space-y-1">
          {fields.map((k) => (
            <div key={k} className="flex justify-between text-[13px]">
              <span className="text-[#666]">{k}</span>
              <span>
                <span className="line-through text-[#444] mr-2">{String(d.before?.[k] ?? "—")}</span>
                <span className="text-white/80">{String(d.after?.[k] ?? "—")}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutineActivationPreviewCard({ card }: { card: Card }) {
  const d = card.data as { routine_name?: string };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Activate Routine</div>
      <div className="text-[14px] text-white/80">{d.routine_name}</div>
      <div className="text-[12px] text-[#666]">This will archive your current active routine.</div>
    </div>
  );
}
