# StrongAI — Agent Instructions

> Live state: `.claude/ongoing-context.md` — read before starting work.

## Commands

```bash
npm run eval                          # regression suite (requires npm run dev in a separate terminal)
npm run eval -- --fixture build-routine  # single fixture
npx tsc --noEmit                      # type check (no "typecheck" script exists)
npx vercel --prod                     # deploy to production
npx vercel rollback <deployment-url>  # rollback
```

## Non-obvious conventions

**Athlete ID from session.** `getCurrentAthleteId()` in `src/lib/session.ts` resolves `athleteId` from the JWT session (falls back to `1` during Deploy 2 transition). Pass `athleteId` as the first param to every DB-touching function — never hardcode `1`.

**All heavy writes use prepare/commit split.** Tools that write to the DB (logWorkoutEntry, correctWorkoutEntry, setupNutritionTargets, etc.) insert a `pending_actions` row and return a preview card — they do NOT write the final row. The commit happens in `src/lib/pending.ts` via `/api/chat/action`. Do not skip this pattern for new write tools.

**`chatCompletionJSON` output shape is fixed.** The LLM must return `{tool, args, narration, profile_updates?}`. Do not add new top-level keys to this shape without updating every fixture in `tests/conversations/`.

**The prompt string in `chatEngine.ts` is a template literal.** Backtick characters inside it (e.g. wrapping field names) terminate the template early and cause TS errors. Use plain text for field names inside the prompt.

**`psql` is not available.** Run DB queries via Node: `node -e "const {neon} = require('@neondatabase/serverless'); const sql = neon(process.env.DATABASE_URL); ..."`. `dotenv` is not installed; export `.env.local` vars manually or inline the URL.

**DeepSeek emits `<think>` blocks.** `chatCompletionJSON` and `chatCompletion` in `src/lib/llm.ts` strip them automatically. If you call the LLM client directly, strip them yourself.

**Profile updates are fire-and-forget.** `applyProfileUpdates()` is called without `await` in `runEngine`. This is intentional — do not add await; it would block every response.

**`src/lib/_archive/chatEngine.snapshot.ts`** is a frozen rollback reference. Never import it; never modify it.

## Forbidden

- Do not commit `.env.vercel.prod`, `.env.vercel.prod2`, or `.env.local`. They contain live production secrets.
- Do not write derived state to new DB tables. Totals, remaining macros, and progress counts are computed at query time from source tables.
- Do not add narration that claims something was logged unless a tool was called. The LLM must not fabricate writes.
- Do not add `await` to `applyProfileUpdates` calls.
- Do not re-call `setupNutritionTargets`, `importNutritionPlan`, or any prepare*/setup* tool while their preview is open — use `editPendingAction` instead. Exception: re-calling `logWorkoutEntry` is allowed and auto-cancels the old `log_workout` pending row (re-preview flow).

## Eval fixtures

Fixtures live in `tests/conversations/*.json`. Each has `messages[]` and `assertions[]`. Assertions check `tool` selection and `narration` content. The harness resets `athlete_profile` to null before each fixture run — do not rely on profile state persisting between fixtures.
