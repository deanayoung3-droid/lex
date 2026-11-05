import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { signOutAction } from "../login/actions";
import { Nav } from "./client";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  await requireAdmin();
  const s = await getSettings();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-sunken px-4 py-3 md:w-52 md:flex-col md:items-stretch md:justify-start md:border-r md:border-b-0 md:px-3 md:py-5">
        <div className="flex items-center gap-4 md:flex-col md:items-stretch md:gap-5">
          <p className="px-3 text-[15px] font-semibold whitespace-nowrap text-ink">
            {s.agentName || "Lex"}
            <span className={`ml-2 inline-block size-1.5 rounded-full align-middle ${s.enabled ? "bg-success" : "bg-line-strong"}`} aria-label={s.enabled ? "On" : "Off"} />
          </p>
          <Nav />
        </div>
        <form action={signOutAction} className="md:mt-auto">
          <button type="submit" className="px-3 text-[13px] whitespace-nowrap text-muted hover:text-ink">
            Sign out
          </button>
        </form>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
