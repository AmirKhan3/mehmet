import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { query, queryOne } from "@/lib/db";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      if (user?.name) token.name = user.name;
      if (user?.image) token.picture = user.image;

      // Only run DB work on first sign-in (token.athleteId not yet set)
      if (token.email && !token.athleteId) {
        await query(
          `INSERT INTO users (email, name, image)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image`,
          [token.email, token.name ?? null, token.picture ?? null]
        );
        const userRow = await queryOne<{ id: number }>(
          `SELECT id FROM users WHERE email = $1`,
          [token.email]
        );
        if (!userRow) return token;

        if (token.email === "amirkhan3@gmail.com") {
          await query(
            `UPDATE athlete_profile SET user_id = $1 WHERE id = 1 AND user_id IS NULL`,
            [userRow.id]
          );
        } else {
          const existingProfile = await queryOne<{ id: number }>(
            `SELECT id FROM athlete_profile WHERE user_id = $1 LIMIT 1`,
            [userRow.id]
          );
          if (!existingProfile) {
            await query(
              `INSERT INTO athlete_profile (user_id, preferences, nutrition_enabled) VALUES ($1, '{}', FALSE)`,
              [userRow.id]
            );
          }
        }

        const profileRow = await queryOne<{ id: number }>(
          `SELECT id FROM athlete_profile WHERE user_id = $1 LIMIT 1`,
          [userRow.id]
        );
        if (profileRow) token.athleteId = profileRow.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.athleteId) session.athleteId = token.athleteId as number;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    athleteId?: number;
  }
  interface JWT {
    athleteId?: number;
    email?: string | null;
  }
}
