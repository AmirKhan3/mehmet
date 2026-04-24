export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  messages: LLMMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const res = await fetch(`${process.env.NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "deepseek-ai/deepseek-v3.2",
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

export async function chatCompletionJSON<T>(
  messages: LLMMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<T> {
  const raw = await chatCompletion(messages, options);
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// Keep only structural exercise content; drop coaching-cue prose paragraphs.
// Uses positive matching: a line is kept if it IS structural, not by trying to detect narrative.
function preprocessRoutineText(text: string): string {
  // Patterns that positively identify exercise/structure lines
  const IS_STRUCTURAL = [
    /^#/,                          // markdown headings
    /^\*\*/,                       // bold (block headers, day labels)
    /^---/,                        // horizontal rules
    /\|\s*Tempo/i,                 // Akhara: "Exercise — N reps | Tempo X-X-X"
    /\|\s*Static/i,                // Akhara: timed holds "— 45 sec | Static"
    /—\s*\d+\s*(reps?|each|sec)/i, // "— 12 reps", "— 45 sec", "— 12 each"
    /\d+[×xX]\d+/,                 // "4×5–8" (Nippard), "3x6-8" (PPL)
    /\d+\s*sets?\s*[x×]\s*\d+/i,   // "3 sets x 6-8 reps" (PPL)
    /\b(Block|Circuit|Part\s+[AB])\s*\d/i, // "Block 1", "Circuit A", "Part B"
    /\b\d+\s*rounds?\b/i,          // "4 rounds", "5 rounds"
    /\bRest\s+\d+\s*sec\b/i,       // "Rest 15 sec between..."
    /\bAMRAP\b/i,                  // AMRAP format
    /\bWeek\s+\d/i,                // "Week 5+", "Week A", "Week 1-4"
    /\bDay\s+\d/i,                 // "Day 1", "Day 2"
    /:\s*\d+\s*sets?\s/i,          // "Bench Press: 3 sets"
    /,\s*RIR\d/i,                  // "4×5–8, tempo 3-1-1, RIR2"
    /\bWork\s+\d+\s*sec\b/i,       // "Work 40 sec"
  ];

  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true; // keep blank lines for readability
      if (t.length <= 60) return true; // short lines are always structural
      return IS_STRUCTURAL.some((re) => re.test(t));
    })
    .join("\n");
}

const ROUTINE_PARSER_SYSTEM = `You are a fitness routine parser. Parse the workout routine text into compact JSON.

IMPORTANT: Output ONLY raw JSON (no markdown fences). Omit any field that is null, false, or 0 — only include fields with real values. This keeps the output small.

Schema:
{
  "routines": [{
    "name": string,
    "schedule_mode": "weekday"|"cycle",
    "phase_label": string,          // only if there are phases
    "days": [{
      "day_index": number,
      "name": string,
      "session_type": string,
      "is_rest_day": true,          // only include when true
      "blocks": [{
        "block_type": "straight"|"circuit"|"amrap"|"superset",
        "rounds": number,           // only for circuits
        "rest_between_exercises_sec": number,
        "rest_between_rounds_sec": number,
        "exercises": [{
          "name_raw": string,
          "sets": number,
          "reps_min": number,
          "reps_max": number,
          "tempo": string,
          "rir_min": number,
          "rir_max": number,
          "load_notes": string,
          "duration_sec": number,
          "is_amrap": true          // only include when true
        }]
      }]
    }]
  }]
}

RULES:
1. schedule_mode: 'weekday' if days are Mon/Tue/etc; 'cycle' if Day 1/Day 2 or Push/Pull/Legs.
2. Weekday day_index: Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6.
3. Cycle day_index: 0,1,2... in appearance order.
4. Multi-phase (Week 1-4 vs Week 5+, Week A vs Week B): emit one routines[] entry per phase, each with its own phase_label.
5. block_type circuit: section says "Block N", "Mini-Circuit", or "N rounds". straight: independent exercises with own rest. amrap: AMRAP format.
6. rounds: circuit round count only (not sets).
7. reps: "6-8 reps"→reps_min=6,reps_max=8. "12 reps"→reps_min=12,reps_max=12.
8. sets: explicit sets count for straight blocks. Omit for circuit exercises (rounds covers repetition).
9. tempo: "3-1-1" verbatim.
10. rir: "RIR2"→rir_min=2,rir_max=2. "RIR1-2"→rir_min=1,rir_max=2.
11. duration_sec: timed holds like "45 sec" or "40 sec work".
12. rest_between_exercises_sec: "rest 15 sec between exercises"→15.
13. rest_between_rounds_sec: "rest 75 sec between rounds"→75.
14. name_raw: exact exercise name including any substitution note e.g. "Pull-ups (sub: pulldowns)".
15. Skip pure rest/walk days (no exercise blocks).
16. For alternating weeks within one day (Week A: X, Week B: Y) → split into two routines[].`;

export async function parseRoutine(text: string): Promise<import("@/types").ParsedRoutineResult> {
  const processed = preprocessRoutineText(text);
  console.log(`[parseRoutine] Original: ${text.length} chars → Preprocessed: ${processed.length} chars`);

  return chatCompletionJSON<import("@/types").ParsedRoutineResult>(
    [
      { role: "system", content: ROUTINE_PARSER_SYSTEM },
      { role: "user", content: processed },
    ],
    { temperature: 0.1, max_tokens: 8000 }
  );
}
