"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CardPeek } from "./CardPeek";
import { CardDetail } from "./CardDetail";
import type { Message, Card } from "@/types";

function genId() {
  return Math.random().toString(36).slice(2);
}

const STORAGE_KEY = "strong_chat_messages";
const MAX_STORED = 60;

export function Chat() {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Message[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailCard, setDetailCard] = useState<Card | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: genId(), role: "user", text: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-10).map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      const data = await res.json();
      const assistantMsg: Message = {
        id: genId(),
        role: "assistant",
        text: data.text || "",
        cards: data.cards || [],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "assistant", text: "Something went wrong. Try again.", timestamp: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex flex-col h-full bg-black">
      <CardDetail card={detailCard} onClose={() => setDetailCard(null)} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b border-[#111]">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.2em] text-[#BFFF00] uppercase">Strong</div>
          <div className="text-[13px] text-[#444]">Training partner</div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/logs" className="w-8 h-8 rounded-full bg-[#111] border border-[#222] flex items-center justify-center" title="Logs">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4h10M2 7h7M2 10h5" stroke="#666" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </a>
          <a href="/routines" className="w-8 h-8 rounded-full bg-[#111] border border-[#222] flex items-center justify-center" title="Routines">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="#666" strokeWidth="1.2"/>
              <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="#666" strokeWidth="1.2"/>
              <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="#666" strokeWidth="1.2"/>
              <rect x="8" y="8" width="4" height="4" rx="0.8" stroke="#666" strokeWidth="1.2"/>
            </svg>
          </a>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 overscroll-contain">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8 py-20">
            <div className="text-[32px] font-black tracking-tight text-white mb-2">
              What&apos;s the move?
            </div>
            <div className="text-[14px] text-[#444] leading-relaxed">
              Ask about your schedule, log a workout, or track nutrition.
            </div>
            <div className="mt-8 grid grid-cols-1 gap-2 w-full max-w-xs">
              {["What's my workout today?", "Log 2 eggs", "Show my routines"].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-[13px] text-[#666] border border-[#1A1A1A] rounded-xl px-4 py-2.5 hover:border-[#333] hover:text-[#999] transition-all text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              {msg.text && (
                <div
                  className={`
                    max-w-[80%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed
                    ${msg.role === "user"
                      ? "bg-[#BFFF00] text-black font-medium rounded-br-md"
                      : "bg-[#111] text-white/90 border border-[#1A1A1A] rounded-bl-md"
                    }
                  `}
                >
                  {msg.text}
                </div>
              )}
              {msg.cards?.map((card, i) => (
                <div key={i} className="w-full max-w-[320px]">
                  <CardPeek
                    card={card}
                    onTap={setDetailCard}
                    onConfirm={() => send("yes")}
                  />
                </div>
              ))}
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-2"
          >
            <div className="bg-[#111] border border-[#1A1A1A] rounded-2xl rounded-bl-md px-4 py-3 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-[#444]"
                  style={{ animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-8 pt-3 border-t border-[#111]">
        <div className="flex items-end gap-2 bg-[#111] border border-[#1A1A1A] rounded-2xl px-4 py-3 focus-within:border-[#333] transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Message"
            rows={1}
            className="flex-1 bg-transparent text-[15px] text-white placeholder-[#444] resize-none max-h-32 leading-relaxed"
            style={{ scrollbarWidth: "none" }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-xl bg-[#BFFF00] flex items-center justify-center shrink-0 disabled:opacity-20 transition-opacity active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 12V2M2 7l5-5 5 5" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
