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

const ROUTINE_PARSER_SYSTEM = `You are a fitness routine parser. Parse the workout routine text into structured JSON.

Output ONLY valid JSON in this exact shape (no markdown fences):
{
  "routines": [
    {
      "name": "string — program name, include phase label if applicable e.g. 'Akhara Protocol — Week 1-4'",
      "schedule_mode": "weekday OR cycle",
      "phase_label": "string or null — e.g. 'Week 1-4', 'Week A', null",
      "days": [
        {
          "day_index": 0,
          "name": "string — e.g. 'Monday — Upper Push' or 'Push Workout'",
          "session_type": "string — e.g. 'push', 'pull', 'lower-quad', 'upper'",
          "is_rest_day": false,
          "notes": "string or null",
          "blocks": [
            {
              "block_type": "straight OR circuit OR amrap OR superset",
              "rounds": null,
              "rest_between_exercises_sec": null,
              "rest_between_rounds_sec": null,
              "notes": "string or null",
              "exercises": [
                {
                  "name_raw": "exact exercise text including substitutions",
                  "sets": null,
                  "reps_min": null,
                  "reps_max": null,
                  "tempo": null,
                  "rir_min": null,
                  "rir_max": null,
                  "load_notes": null,
                  "duration_sec": null,
                  "is_amrap": false
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

PARSING RULES:
1. schedule_mode: 'weekday' if days named Monday/Tuesday etc; 'cycle' if numbered (Day 1, Day 2) or named by role (Push, Pull, Legs).
2. Weekday day_index: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
3. Cycle day_index: assign 0,1,2... in order of appearance.
4. Multi-phase: if text has distinct phases like 'Week 1-4' vs 'Week 5+' OR 'Week A' vs 'Week B' → emit one entry per phase in routines[]. Each phase shares a base name but has different phase_label.
5. block_type: 'circuit' when header says Block N, Mini-Circuit, or explicitly mentions N rounds of grouped exercises. 'amrap' when AMRAP. 'straight' when each exercise is performed independently with its own rest.
6. rounds: the circuit rounds count (4 rounds, 5 rounds). NOT sets.
7. reps: '6-8 reps' → reps_min=6,reps_max=8. '10 reps' → reps_min=10,reps_max=10. '20' → reps_min=20,reps_max=20.
8. sets: for straight blocks, capture explicit sets. For circuit exercises, sets=null (rounds handles it).
9. tempo: capture '3-1-1', '2-2-1' verbatim in tempo field.
10. rir: 'RIR2' → rir_min=2,rir_max=2. 'RIR1-2' → rir_min=1,rir_max=2.
11. duration_sec: 'hold 45 sec' or '40 sec' timed work → duration_sec=45.
12. is_amrap: true only for AMRAP exercises where you do max reps.
13. rest_between_exercises_sec: 'rest 15 sec between exercises' → 15.
14. rest_between_rounds_sec: 'rest 75 sec between rounds' → 75.
15. name_raw: keep full original text e.g. 'Pull-ups (sub: pulldowns)'.
16. Omit rest-only days (pure walking/mobility days with no structured exercise blocks).
17. For alternating-week exercises within a single day (Week A: X, Week B: Y), split into two phases.
18. load_notes: 'RPE8', 'bodyweight', 'heavy', 'grip one horn' etc.`;

export async function parseRoutine(text: string): Promise<import("@/types").ParsedRoutineResult> {
  return chatCompletionJSON<import("@/types").ParsedRoutineResult>(
    [
      { role: "system", content: ROUTINE_PARSER_SYSTEM },
      { role: "user", content: text },
    ],
    { temperature: 0.1, max_tokens: 6000 }
  );
}
