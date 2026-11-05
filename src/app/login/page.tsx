import { connection } from "next/server";
import { redirect } from "next/navigation";
import { signedIn } from "@/lib/auth";
import { SignInForm } from "./form";

// Job: the person who runs Lex signs in to its admin; next they set it up or read the chats.
export default async function LoginPage() {
  await connection();
  if (await signedIn()) redirect("/admin");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground px-4">
      <div className="card w-full max-w-sm p-6">
        <p className="kicker mb-2 text-accent-strong">Lex</p>
        <h1 className="title">Sign in</h1>
        <p className="mt-1.5 mb-5 text-[13.5px] text-muted">Use the admin password (ADMIN_PASSWORD) set on the server.</p>
        <SignInForm />
      </div>
    </main>
  );
}
