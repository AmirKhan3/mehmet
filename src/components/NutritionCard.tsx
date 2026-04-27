"use client";
import type { Card } from "@/types";

interface MacroBar {
  label: string;
  value: number;
  max: number;
  color: string;
}

function MacroRow({ label, value, max, color }: MacroBar) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-[#999]">{label}</span>
        <span className="font-mono text-white">{Math.round(value)}g</span>
      </div>
      <div className="h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

interface NutritionItemData {
  item?: string;
  quantity?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

interface NutritionDayData {
  totals?: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  entries?: { item_name: string; quantity: string; calories: number; protein_g: number }[];
}

interface TargetsData {
  actuals?: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  targets?: { calories_max: number; protein_max_g: number; carbs_max_g: number; fats_max_g: number } | null;
  remaining?: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
}

export function NutritionItemCard({ card }: { card: Card }) {
  const d = card.data as NutritionItemData;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Logged</div>
      <div className="text-[15px] font-medium text-white">{d.item}</div>
      <div className="text-[12px] text-[#666]">{d.quantity}</div>
      <div className="flex gap-4 text-[12px] font-mono text-[#999]">
        {d.calories !== undefined && <span>{Math.round(d.calories)} kcal</span>}
        {d.protein_g !== undefined && <span>{Math.round(d.protein_g)}g protein</span>}
      </div>
    </div>
  );
}

export function NutritionDayCard({ card }: { card: Card }) {
  const d = card.data as NutritionDayData;
  const t = d.totals;
  const entries = Array.isArray(d.entries) ? d.entries : [];

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Today</div>
      {t && (
        <div className="text-[22px] font-bold text-white font-mono">
          {Math.round(t.calories)} <span className="text-[14px] text-[#666] font-normal">kcal</span>
        </div>
      )}
      <div className="space-y-1.5">
        {entries.slice(0, 4).map((e, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-[13px] text-white/80">{e.item_name}</span>
            <span className="text-[12px] text-[#666] font-mono">{Math.round(e.calories)} kcal</span>
          </div>
        ))}
        {entries.length > 4 && <div className="text-[12px] text-[#666]">+{entries.length - 4} more</div>}
      </div>
    </div>
  );
}

export function NutritionTargetsCard({ card }: { card: Card }) {
  const d = card.data as TargetsData;
  const a = d.actuals;
  const t = d.targets;

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Macros</div>
      {a && t && (
        <div className="space-y-2">
          <MacroRow label="Protein" value={a.protein_g} max={t.protein_max_g} color="#BFFF00" />
          <MacroRow label="Carbs" value={a.carbs_g} max={t.carbs_max_g} color="#60A5FA" />
          <MacroRow label="Fat" value={a.fat_g} max={t.fats_max_g} color="#F97316" />
        </div>
      )}
      {d.remaining && (
        <div className="text-[12px] text-[#666]">
          {Math.round(d.remaining.protein_g)}g protein remaining
        </div>
      )}
    </div>
  );
}

export function NutritionItemDetail({ card }: { card: Card }) {
  const d = card.data as NutritionItemData;
  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Logged</div>
        <div className="text-2xl font-bold text-white">{d.item}</div>
        <div className="text-[14px] text-[#666] mt-1">{d.quantity}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Calories", value: d.calories, unit: "kcal" },
          { label: "Protein", value: d.protein_g, unit: "g" },
          { label: "Carbs", value: d.carbs_g, unit: "g" },
          { label: "Fat", value: d.fat_g, unit: "g" },
        ].map((m) => (
          <div key={m.label} className="bg-[#111] border border-[#1A1A1A] rounded-xl p-3">
            <div className="text-[11px] text-[#666] uppercase tracking-wide">{m.label}</div>
            <div className="text-[20px] font-bold font-mono text-white mt-1">
              {Math.round(m.value ?? 0)}<span className="text-[12px] text-[#666] ml-0.5">{m.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NutritionDayDetail({ card }: { card: Card }) {
  const d = card.data as NutritionDayData;
  const t = d.totals;
  const entries = Array.isArray(d.entries) ? d.entries : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Nutrition</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      {t && (
        <div className="text-[28px] font-bold font-mono">
          {Math.round(t.calories)} <span className="text-[16px] text-[#666] font-normal">kcal</span>
        </div>
      )}
      <div className="space-y-2">
        {entries.map((e, i) => (
          <div key={i} className="flex items-baseline justify-between py-2.5 border-b border-[#1A1A1A]">
            <div>
              <div className="text-[14px] font-medium text-white">{(e as Record<string, unknown>).item_name as string}</div>
              <div className="text-[11px] text-[#666]">{(e as Record<string, unknown>).quantity as string}</div>
            </div>
            <div className="text-right ml-4">
              <div className="text-[13px] font-mono text-white">{Math.round((e as Record<string, unknown>).calories as number)} kcal</div>
              <div className="text-[11px] text-[#666]">{Math.round((e as Record<string, unknown>).protein_g as number)}g protein</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NutritionTargetsDetail({ card }: { card: Card }) {
  const d = card.data as TargetsData;
  const a = d.actuals;
  const t = d.targets;

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Nutrition</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      {a && (
        <div className="text-[28px] font-bold font-mono">
          {Math.round(a.calories)} <span className="text-[16px] text-[#666] font-normal">kcal eaten</span>
        </div>
      )}
      {a && t && (
        <div className="space-y-4">
          {[
            { label: "Protein", value: a.protein_g, max: t.protein_max_g, color: "#BFFF00" },
            { label: "Carbs", value: a.carbs_g, max: t.carbs_max_g, color: "#60A5FA" },
            { label: "Fat", value: a.fat_g, max: t.fats_max_g, color: "#F97316" },
          ].map((m) => (
            <div key={m.label} className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[13px] text-[#999]">{m.label}</span>
                <span className="text-[13px] font-mono text-white">{Math.round(m.value)}g / {m.max}g</span>
              </div>
              <div className="h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, (m.value / m.max) * 100)}%`, background: m.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MealSuggestionCard({ card }: { card: Card }) {
  const d = card.data as {
    intent?: string; suggestion?: string; why?: string; timing?: string;
    macros?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
  };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">
        Suggestion · {(d.intent || "").replace(/_/g, " ")}
      </div>
      <div className="text-[15px] font-medium text-white leading-snug">{d.suggestion}</div>
      {d.macros && (
        <div className="text-[11px] font-mono text-[#666]">
          ~{Math.round(d.macros.calories ?? 0)} kcal · {Math.round(d.macros.protein_g ?? 0)}g P · {Math.round(d.macros.carbs_g ?? 0)}g C · {Math.round(d.macros.fat_g ?? 0)}g F
        </div>
      )}
      {d.why && <div className="text-[12px] text-[#555] truncate">{d.why}</div>}
    </div>
  );
}

export function MealSuggestionDetail({ card }: { card: Card }) {
  const d = card.data as {
    intent?: string; suggestion?: string; why?: string; timing?: string;
    macros?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
    remaining_after?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number } | null;
  };
  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">
          Suggestion · {(d.intent || "").replace(/_/g, " ")}
        </div>
        <div className="text-2xl font-bold text-white">{d.suggestion}</div>
      </div>
      {d.macros && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Calories", value: d.macros.calories, unit: "kcal" },
            { label: "Protein", value: d.macros.protein_g, unit: "g" },
            { label: "Carbs", value: d.macros.carbs_g, unit: "g" },
            { label: "Fat", value: d.macros.fat_g, unit: "g" },
          ].map((m) => (
            <div key={m.label} className="bg-[#111] border border-[#1A1A1A] rounded-xl p-3">
              <div className="text-[11px] text-[#666] uppercase tracking-wide">{m.label}</div>
              <div className="text-[20px] font-bold font-mono text-white mt-1">
                {Math.round(m.value ?? 0)}<span className="text-[12px] text-[#666] ml-0.5">{m.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {d.why && (
        <div>
          <div className="text-[11px] font-semibold tracking-widest text-[#555] uppercase mb-1">Why</div>
          <div className="text-[14px] text-white/70 leading-relaxed">{d.why}</div>
        </div>
      )}
      {d.timing && (
        <div>
          <div className="text-[11px] font-semibold tracking-widest text-[#555] uppercase mb-1">Timing</div>
          <div className="text-[14px] text-[#BFFF00]">{d.timing}</div>
        </div>
      )}
      {d.remaining_after && (
        <div>
          <div className="text-[11px] font-semibold tracking-widest text-[#555] uppercase mb-1">Remaining after</div>
          <div className="text-[12px] font-mono text-[#666]">
            {Math.round(d.remaining_after.calories ?? 0)} kcal · {Math.round(d.remaining_after.protein_g ?? 0)}g P
          </div>
        </div>
      )}
    </div>
  );
}

export function NutritionSetupCard({ card }: { card: Card }) {
  const d = card.data as { why?: string };
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">Setup required</div>
      <div className="text-[14px] text-white/80 leading-snug">{d.why || "Tell me your weight, goal, and training days to get started."}</div>
      <div className="text-[11px] text-[#555]">e.g. &quot;180lbs, bulk, 4 days/week&quot;</div>
    </div>
  );
}

export function NutritionSetupDetail({ card }: { card: Card }) {
  const d = card.data as { why?: string; missing?: string[] };
  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Setup required</div>
        <div className="text-2xl font-bold text-white">Nutrition Goals</div>
      </div>
      <div className="text-[14px] text-white/70 leading-relaxed">{d.why}</div>
      <div className="bg-[#111] border border-[#1A1A1A] rounded-xl p-4">
        <div className="text-[12px] text-[#666] mb-2">Reply in chat with:</div>
        <div className="text-[14px] text-white font-mono">&quot;180lbs, bulk, 4 days/week&quot;</div>
      </div>
    </div>
  );
}

interface WeekDayRow { date: string; kcal: number; protein_g: number; hit_protein: boolean; hit_calories: boolean; }
interface WeekData {
  days?: WeekDayRow[];
  averages?: { protein_g: number; kcal: number };
  adherence?: { protein_hit_days: number; total_days: number };
  targets?: { protein_max_g?: number; calories_max?: number } | null;
}

export function NutritionWeekCard({ card }: { card: Card }) {
  const d = card.data as WeekData;
  const days = d.days || [];
  const maxKcal = Math.max(...days.map((r) => r.kcal), 1);
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase">This week</div>
      <div className="flex items-end gap-1 h-10">
        {days.length === 0 ? <div className="text-[12px] text-[#444]">No data logged</div> : days.map((day) => (
          <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className="w-full rounded-sm"
              style={{ height: `${Math.max(4, Math.round((day.kcal / maxKcal) * 32))}px`, background: day.hit_protein ? "#BFFF00" : "#333" }}
            />
          </div>
        ))}
      </div>
      {d.adherence && d.adherence.total_days > 0 && (
        <div className="text-[12px] text-[#666]">
          Hit protein {d.adherence.protein_hit_days}/{d.adherence.total_days} days · avg {d.averages?.protein_g}g
        </div>
      )}
    </div>
  );
}

export function NutritionWeekDetail({ card }: { card: Card }) {
  const d = card.data as WeekData;
  const days = d.days || [];
  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-widest text-[#BFFF00] uppercase mb-1">Weekly Nutrition</div>
        <div className="text-2xl font-bold text-white">{card.title}</div>
      </div>
      {d.adherence && d.adherence.total_days > 0 && (
        <div className="flex gap-4">
          <div className="bg-[#111] border border-[#1A1A1A] rounded-xl p-3 flex-1">
            <div className="text-[11px] text-[#666] uppercase tracking-wide">Protein days</div>
            <div className="text-[20px] font-bold font-mono text-white mt-1">{d.adherence.protein_hit_days}<span className="text-[12px] text-[#666]">/{d.adherence.total_days}</span></div>
          </div>
          <div className="bg-[#111] border border-[#1A1A1A] rounded-xl p-3 flex-1">
            <div className="text-[11px] text-[#666] uppercase tracking-wide">Avg protein</div>
            <div className="text-[20px] font-bold font-mono text-white mt-1">{d.averages?.protein_g}<span className="text-[12px] text-[#666] ml-0.5">g</span></div>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {days.map((day) => (
          <div key={day.date} className="flex items-center justify-between py-2 border-b border-[#1A1A1A]">
            <div className="text-[13px] text-[#666]">{new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-mono text-white">{day.protein_g}g P</span>
              <span className="text-[12px] font-mono text-[#555]">{day.kcal} kcal</span>
              <span className={`w-1.5 h-1.5 rounded-full ${day.hit_protein ? "bg-[#BFFF00]" : "bg-[#333]"}`} />
            </div>
          </div>
        ))}
        {days.length === 0 && <div className="text-[13px] text-[#444]">No entries logged this week.</div>}
      </div>
    </div>
  );
}
