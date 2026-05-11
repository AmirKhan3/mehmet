import { auth } from "@/auth";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db";

const GUEST_COOKIE = "guest_id";
const GUEST_TTL_SEC = 365 * 24 * 60 * 60;

export async function getCurrentAthleteId(): Promise<number> {
  const session = await auth();

  if (session?.athleteId) {
    // If a guest cookie exists, absorb that guest's chat history into the
    // authenticated profile and clear the cookie so this only runs once.
    const jar = await cookies();
    const guestCookie = jar.get(GUEST_COOKIE)?.value;
    if (guestCookie) {
      absorbGuest(guestCookie, session.athleteId);
      jar.delete(GUEST_COOKIE);
    }
    return session.athleteId;
  }

  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  if (existing) {
    const row = await queryOne(
      `SELECT id FROM athlete_profile WHERE guest_cookie_id = $1`,
      [existing]
    );
    if (row) return row.id as number;
    // Cookie exists but profile was deleted — fall through to create a new one
  }

  // Create a new guest profile and set the identifying cookie
  const cookieId = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO athlete_profile (guest_cookie_id, name) VALUES ($1, 'Guest') RETURNING id`,
    [cookieId]
  );
  jar.set(GUEST_COOKIE, cookieId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: GUEST_TTL_SEC,
    path: "/",
  });
  return rows[0].id as number;
}

// Fire-and-forget: re-parent the guest's chat history to the authenticated
// profile. The guest profile is left in place (no hard delete) so FK
// constraints on other tables are preserved.
async function absorbGuest(guestCookieId: string, athleteId: number): Promise<void> {
  try {
    const guest = await queryOne(
      `SELECT id FROM athlete_profile WHERE guest_cookie_id = $1`,
      [guestCookieId]
    );
    if (!guest || (guest.id as number) === athleteId) return;
    const guestId = guest.id as number;
    await query(
      `UPDATE chat_messages SET athlete_profile_id = $1 WHERE athlete_profile_id = $2`,
      [athleteId, guestId]
    );
    // Mark the guest profile as claimed so it won't be re-used
    await query(
      `UPDATE athlete_profile SET guest_cookie_id = NULL WHERE id = $1`,
      [guestId]
    );
  } catch {
    // Non-fatal — if absorption fails the user just won't see their guest history
  }
}
