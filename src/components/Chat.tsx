"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signOut, useSession } from "next-auth/react";
import { CardPeek } from "./CardPeek";
import { CardDetail } from "./CardDetail";
import type { Message, Card } from "@/types";

function genId() {
  return Math.random().toString(36).slice(2);
}

// Resize image to fit within maxSide px on the longest edge. Returns original file unchanged
// if it already fits. Falls back to original on any canvas error.
async function resizeImageFile(file: File, maxSide = 1024): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxSide && h <= maxSide) {
        resolve(file);
        return;
      }
      const scale = maxSide / Math.max(w, h);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function fetchMessages(): Promise<Message[]> {
  const res = await fetch("/api/chat/messages");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.messages || []) as Message[];
}

const DEFAULT_STARTERS = ["What's my workout today?", "Log 2 eggs", "Show my routines"];

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailCard, setDetailCard] = useState<Card | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [starters, setStarters] = useState<string[]>(DEFAULT_STARTERS);
  const { data: session } = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Object URLs owned by messages are intentionally not revoked — they live for
  // the session lifetime. The pending preview URL is only revoked explicitly in
  // clearPendingImage (cancel) and setPendingImageFile (replace).

  // Fetch contextual starters on mount — falls back to defaults on error.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/starters")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d.starters) && d.starters.length > 0) setStarters(d.starters); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load history on mount, then poll briefly if the latest message is an orphan
  // user message (LLM may still be processing from a prior page).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initial = await fetchMessages();
      if (cancelled) return;
      setMessages(initial);

      const last = initial[initial.length - 1];
      if (last?.role === "user") {
        setLoading(true);
        let attempts = 0;
        pollTimerRef.current = setInterval(async () => {
          attempts += 1;
          const next = await fetchMessages();
          if (cancelled) return;
          const newLast = next[next.length - 1];
          if (newLast?.role === "assistant") {
            setMessages(next);
            setLoading(false);
            stopPoll();
          } else if (attempts >= 20) {
            setLoading(false);
            stopPoll();
          }
        }, 1500);
      }
    })();

    return () => {
      cancelled = true;
      stopPoll();
    };
  }, [stopPoll]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!profileOpen) return;
    function handleClick(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [profileOpen]);

  const clearPendingImage = useCallback(() => {
    setPendingImage(null);
    setPendingImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const setPendingImageFile = useCallback((file: File) => {
    setPendingImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setPendingImage(file);
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && !pendingImage) || loading) return;
    stopPoll();

    const capturedImage = pendingImage;
    const capturedImageUrl = pendingImageUrl;
    const displayText = capturedImage
      ? (trimmed ? `📷 ${trimmed}` : "📷 pasted image")
      : trimmed;

    setMessages((prev) => [...prev, {
      id: genId(), role: "user", text: displayText, timestamp: Date.now(),
      photoUrl: capturedImageUrl ?? undefined,
    }]);
    setInput("");
    // URL is now owned by the message in state — don't revoke it here.
    setPendingImage(null);
    setPendingImageUrl(null);
    setLoading(true);

    try {
      const history = messages.slice(-10).map((m) => ({ role: m.role, text: m.text }));
      let data: { text?: string; cards?: Card[] };

      if (capturedImage) {
        // Keep payload under 1 MB to avoid Next.js body-size limits.
        const resized = await resizeImageFile(capturedImage, 1024);
        const form = new FormData();
        form.append("photo", resized);
        if (trimmed) form.append("message", trimmed);
        form.append("history", JSON.stringify(history));
        const res = await fetch("/api/chat/photo", { method: "POST", body: form });
        data = await res.json();
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, history }),
        });
        data = await res.json();
      }

      setMessages((prev) => [...prev, {
        id: genId(), role: "assistant",
        text: data.text || "", cards: data.cards || [], timestamp: Date.now(),
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: genId(), role: "assistant",
        text: "Something went wrong. Try again.", timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, stopPoll, pendingImage, pendingImageUrl]);

  const handleAction = useCallback(async (
    card: Card,
    kind: "confirm" | "cancel" | "edit",
    patch?: Record<string, unknown>
  ): Promise<void> => {
    const pendingId = card.pending_id;
    if (!pendingId) return;

    try {
      const res = await fetch("/api/chat/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_id: pendingId, action: kind, patch }),
      });
      const data = await res.json() as { text?: string; card?: Card; error?: string };
      if (data.error) {
        setMessages((prev) => [...prev, {
          id: genId(), role: "assistant",
          text: data.error!, cards: [], timestamp: Date.now(),
        }]);
        return;
      }

      if (kind === "edit" && data.card) {
        // Update the card in-place — find and replace the message containing this pending_id
        setMessages((prev) => prev.map((msg) => {
          if (!msg.cards) return msg;
          const updated = msg.cards.map((c) => c.pending_id === pendingId ? data.card! : c);
          return { ...msg, cards: updated };
        }));
      } else if (data.card) {
        // confirm/cancel — append a new assistant message
        setMessages((prev) => [...prev, {
          id: genId(), role: "assistant",
          text: data.text || "", cards: [data.card!], timestamp: Date.now(),
        }]);
      }
    } catch {
      // silent — don't disrupt the UI on transient network errors
    }
  }, []);

  const handleEditEntry = useCallback(async (kind: "workout_log" | "nutrition_entry", entry_id: number) => {
    setDetailCard(null);
    try {
      const res = await fetch("/api/chat/action/edit-existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, entry_id }),
      });
      const data = await res.json() as { card?: Card; error?: string };
      if (data.card) {
        setMessages((prev) => [...prev, {
          id: genId(), role: "assistant",
          text: "", cards: [data.card!], timestamp: Date.now(),
        }]);
      }
    } catch {
      // silent
    }
  }, []);

  const handlePhotoCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || loading) return;
    e.target.value = "";
    setPendingImageFile(file);
    inputRef.current?.focus();
  }, [loading, setPendingImageFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || loading) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setPendingImageFile(file);
        return;
      }
    }
  }, [loading, setPendingImageFile]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex flex-col h-full bg-black">
      <CardDetail card={detailCard} onClose={() => setDetailCard(null)} onEditEntry={handleEditEntry} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b border-[#111]">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.2em] text-[#BFFF00] uppercase">Strong</div>
          <div className="text-[13px] text-[#444]">Training partner</div>
        </div>
        {session ? (
          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className="w-8 h-8 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:border-[#444] transition-colors"
              title="Profile"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <circle cx="7.5" cy="5" r="2.5" stroke="#666" strokeWidth="1.2"/>
                <path d="M2 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="#666" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </button>

            <AnimatePresence>
              {profileOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-10 w-44 bg-[#111] border border-[#222] rounded-2xl overflow-hidden shadow-xl z-50"
                >
                  <a
                    href="/logs"
                    className="flex items-center gap-3 px-4 py-3 text-[13px] text-[#999] hover:text-white hover:bg-[#1A1A1A] transition-colors"
                    onClick={() => setProfileOpen(false)}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    Logs
                  </a>
                  <a
                    href="/routines"
                    className="flex items-center gap-3 px-4 py-3 text-[13px] text-[#999] hover:text-white hover:bg-[#1A1A1A] transition-colors"
                    onClick={() => setProfileOpen(false)}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
                      <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
                      <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
                      <rect x="8" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                    Routines
                  </a>
                  <div className="border-t border-[#1A1A1A]" />
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="w-full flex items-center gap-3 px-4 py-3 text-[13px] text-[#666] hover:text-[#ff6b6b] hover:bg-[#1A1A1A] transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M5 7h7M9.5 4.5 12 7l-2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M8 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <a
            href="/login"
            className="px-3 h-8 rounded-full bg-[#BFFF00] text-black text-[13px] font-semibold flex items-center hover:bg-[#a8e000] transition-colors"
          >
            Sign up
          </a>
        )}
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
              {starters.map((q) => (
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
              {msg.photoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={msg.photoUrl}
                  alt="uploaded photo"
                  className="h-36 max-w-[60%] rounded-2xl object-cover border border-[#333]"
                />
              )}
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
              {msg.timestamp && (
                <div className={`text-[10px] text-[#444] px-1 ${msg.role === "user" ? "self-end" : "self-start"}`}>
                  {new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </div>
              )}
              {msg.cards?.map((card, i) => (
                <div key={i} className="w-full max-w-[320px]">
                  <CardPeek
                    card={card}
                    onTap={setDetailCard}
                    onAction={handleAction}
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
          <div className="flex flex-col flex-1 min-w-0 gap-2">
            {/* Pending image preview */}
            {pendingImageUrl && (
              <div className="relative inline-block self-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingImageUrl}
                  alt="pending upload"
                  className="h-16 w-16 rounded-xl object-cover border border-[#333]"
                />
                <button
                  onClick={clearPendingImage}
                  className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-[#2a2a2a] border border-[#444] flex items-center justify-center"
                  aria-label="Remove image"
                >
                  <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                    <path d="M1 1l5 5M6 1L1 6" stroke="#aaa" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              placeholder={pendingImageUrl ? "Add a message (optional)..." : "Message"}
              rows={1}
              className="bg-transparent text-[15px] text-white placeholder-[#444] resize-none max-h-32 leading-relaxed w-full"
              style={{ scrollbarWidth: "none" }}
            />
          </div>
          {/* hidden camera input */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoCapture}
          />
          {/* camera button */}
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={loading}
            className="w-8 h-8 rounded-xl bg-[#1A1A1A] border border-[#222] flex items-center justify-center shrink-0 disabled:opacity-20 transition-opacity active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 4.5C1 3.67 1.67 3 2.5 3h1l1-1.5h5L10.5 3h1c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-9C1.67 12 1 11.33 1 10.5v-6z" stroke="#666" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="7" cy="7.5" r="2" stroke="#666" strokeWidth="1.2"/>
            </svg>
          </button>
          <button
            onClick={() => send(input)}
            disabled={(!input.trim() && !pendingImage) || loading}
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
