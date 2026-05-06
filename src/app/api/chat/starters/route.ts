import { NextResponse } from "next/server";
import { loadProfile, loadTodayState } from "@/lib/profile";
import { getCurrentAthleteId } from "@/lib/session";

export async function GET() {
  try {
    const athleteId = await getCurrentAthleteId();
    const [profile, today] = await Promise.all([loadProfile(athleteId), loadTodayState(athleteId)]);

    const hasProfile =
      profile.weight_lbs != null ||
      profile.goals != null ||
      Object.keys(profile.preferences).length > 0;

    if (!hasProfile) {
      return NextResponse.json({
        starters: [
          "I'm 5'10\" 180lbs, want to bulk",
          "Log my breakfast",
          "Show me how this works",
        ],
      });
    }

    if (today.is_training_day_today && today.last_workout_date !== today.today_date) {
      return NextResponse.json({
        starters: [
          today.today_session_name ? `What's today's ${today.today_session_name}?` : "What's today's lift?",
          "Log breakfast",
          "Macros so far",
        ],
      });
    }

    return NextResponse.json({
      starters: ["How was last week?", "Log breakfast", "Suggest a meal"],
    });
  } catch {
    return NextResponse.json({
      starters: [
        "What's my workout today?",
        "Log 2 eggs",
        "Show my routines",
      ],
    });
  }
}
