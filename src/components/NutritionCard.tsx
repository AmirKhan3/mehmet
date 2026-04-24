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
