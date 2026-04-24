"use client";
import type { Card } from "@/types";

interface ConfirmData {
  message?: string;
  action?: string;
}

export function ConfirmationCard({ card, onConfirm }: { card: Card; onConfirm?: () => void }) {
  const d = card.data as ConfirmData;
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold tracking-widest text-red-400 uppercase">Confirm</div>
      <div className="text-[14px] text-white/80">{d.message}</div>
      <button
        onClick={onConfirm}
        className="text-[13px] font-semibold text-red-400 border border-red-400/30 px-3 py-1.5 rounded-lg hover:bg-red-400/10 transition-colors"
      >
        Yes, delete
      </button>
    </div>
  );
}
