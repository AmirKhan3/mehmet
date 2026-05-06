import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/");

  return (
    <main className="min-h-dvh flex items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-bold tracking-tight">Strong</h1>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="px-8 py-3 rounded-2xl bg-[#BFFF00] text-black font-semibold text-[15px] hover:bg-[#d4ff33] transition-colors"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
