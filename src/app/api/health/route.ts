import { connection } from "next/server";
import { get } from "@/lib/db";

// Used by health checks (Cloud Run, Docker). Touches the database so a lost connection shows up as unhealthy.
export async function GET() {
  await connection();
  try {
    await get("SELECT 1");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[health]", err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
