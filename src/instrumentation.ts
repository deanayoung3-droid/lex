// Runs once when the server starts: starts the background work (reading the website, grouping questions).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
      console.warn("[config] SESSION_SECRET is not set; sessions are signed with ADMIN_PASSWORD.");
    }
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
