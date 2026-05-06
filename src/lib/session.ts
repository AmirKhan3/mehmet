import { auth } from "@/auth";

export async function getCurrentAthleteId(): Promise<number> {
  const session = await auth();
  // Deploy 2 fallback: unauthenticated requests still hit athlete_profile id=1
  // This line is removed in Deploy 3 when middleware enforces auth.
  return (session as { athleteId?: number } | null)?.athleteId ?? 1;
}
