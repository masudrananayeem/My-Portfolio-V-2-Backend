import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { getGithubProfile, getGithubContributions } from "./lib/github";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: [c.env.ALLOWED_ORIGIN, "http://localhost:5173", "http://localhost:5174"],
  });
  return corsMiddleware(c, next);
});

app.get("/", (c) => c.json({ status: "ok", service: "nayeem-portfolio-api" }));

// GitHub profile: avatar, bio, followers, following, public repo count.
// Cached in KV for 30 min so we stay well under GitHub's rate limits.
app.get("/api/github/profile", async (c) => {
  try {
    const profile = await getGithubProfile(c.env);
    return c.json({ success: true, data: profile });
  } catch (err) {
    console.error("GitHub profile fetch failed:", err);
    // Graceful fallback — the frontend should render its cached Firestore
    // values (github.cachedContributionCount etc.) if this errors, rather
    // than showing a blank section.
    return c.json({ success: false, error: "Failed to fetch GitHub profile" }, 502);
  }
});

// GitHub contribution calendar (heatmap data) — last 12 months.
app.get("/api/github/contributions", async (c) => {
  try {
    const contributions = await getGithubContributions(c.env);
    return c.json({ success: true, data: contributions });
  } catch (err) {
    console.error("GitHub contributions fetch failed:", err);
    return c.json({ success: false, error: "Failed to fetch GitHub contributions" }, 502);
  }
});

app.notFound((c) => c.json({ success: false, error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("Unhandled worker error:", err);
  return c.json({ success: false, error: "Internal server error" }, 500);
});

export default app;
