import "dotenv/config"; // locally; harmless on Railway

console.log("ENV CHECK:", {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
  CRON_SECRET: !!process.env.CRON_SECRET,
});

// import routes/handlers AFTER the log
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { getSupabase, isFresh } from "./db";
import {
  OutputSchema,
  SYSTEM_INSTRUCTIONS,
  composeUserPrompt,
  callOpenAIJson,
  callGeminiJson,
  generateAndUpsert,
  type Provider,
} from "./ai";
import { serializeErr } from "./errors";

// shared repopulate function
async function repopulateStale(opts: {
  days: number;
  provider: Provider;
  limit: number;
  concurrency: number;
}) {
  const supabase = getSupabase();
  const { days, provider, limit, concurrency } = opts;

  // cutoff
  const cutoffISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // fetch stale rows
  const { data: stale, error } = await supabase
    .from("visa_requirements_cache")
    .select("resident_country, nationality, destination, visa_category, visa_type, last_updated")
    .lt("last_updated", cutoffISO)
    .limit(limit);

  if (error) throw error;
  if (!stale?.length) return { requested: 0, refreshed: 0, failed: 0, errors: [] };

  // dedupe by key
  const key = (r: any) =>
    [r.resident_country, r.nationality, r.destination, r.visa_category, r.visa_type].join("|");
  const map = new Map<string, any>();
  for (const r of stale) map.set(key(r), r);
  const combos = Array.from(map.values());

  // tiny concurrency limiter
  function pLimit(n: number) {
    const q: Array<() => void> = [];
    let active = 0;
    const next = () => { active--; q.shift()?.(); };
    return <T>(fn: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const run = () => {
          active++;
          fn().then((v) => { resolve(v); next(); })
             .catch((e) => { reject(e); next(); });
        };
        active < n ? run() : q.shift()?.();
      });
  }

  const limitRun = pLimit(concurrency);
  const results = await Promise.allSettled(
    combos.map((c) =>
      limitRun(() =>
        generateAndUpsert(
          supabase,
          {
            resident_country: c.resident_country,
            nationality: c.nationality,
            destination: c.destination,
            visa_category: c.visa_category,
            visa_type: c.visa_type,
          },
          provider
        )
      )
    )
  );

  const refreshed = results.filter(r => r.status === "fulfilled").length;
  const errors = results
    .map((r, i) => r.status === "rejected" ? { combo: combos[i], error: String((r as any).reason) } : null)
    .filter(Boolean);

  return { requested: combos.length, refreshed, failed: errors.length, errors };
}

// simple concurrency limiter
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length) queue.shift()!();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then((v) => { resolve(v); next(); }).catch((e) => { reject(e); next(); });
      };
      if (active < concurrency) run(); else queue.push(run);
    });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// DO NOT call getSupabase() here globally

app.get("/health", (_req, res) => res.json({ ok: true }));

// Main endpoint: fetch/cached visa requirements
app.post("/zen-ai", async (req, res) => {
  const supabase = getSupabase();
  try {
    const {
      resident_country,
      nationality,
      destination,
      visa_category,
      visa_type,
      provider = "openai",
      force_refresh = false,
    } = req.body || {};

    for (const f of ["resident_country", "nationality", "destination", "visa_category", "visa_type"]) {
      if (!req.body?.[f]) return res.status(400).json({ error: `Missing field: ${f}` });
    }

    // 1) Cache lookup
    const { data: existing, error: selErr } = await supabase
      .from("visa_requirements_cache")
      .select("*")
      .eq("resident_country", resident_country)
      .eq("nationality", nationality)
      .eq("destination", destination)
      .eq("visa_category", visa_category)
      .eq("visa_type", visa_type)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing && !force_refresh && isFresh(existing.last_updated)) {
      return res.json({ source: "cache", ...existing });
    }

    // 2) Generate and upsert using the unified function
    const up = await generateAndUpsert(
      supabase,
      { resident_country, nationality, destination, visa_category, visa_type },
      provider as Provider
    );

    res.json({ source: provider, ...up });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Secure monthly refresh endpoint (purge stale rows)
app.post("/refresh", async (req, res) => {
  const supabase = getSupabase();
  try {
    if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const days = Number(req.body?.days ?? 30);
    const { error } = await supabase.rpc("delete_old_cache", { days_old: days });
    if (error) throw error;
    res.json({ ok: true, purged_older_than_days: days });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Secure monthly repopulation: re-generate stale rows (not just delete)
app.post("/repopulate", async (req, res) => {
  try {
    if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const days = Number(req.body?.days ?? 30);
    const provider = (req.body?.provider ?? "openai") as Provider;
    const limit = Number(req.body?.limit ?? 100);
    const concurrency = Number(req.body?.concurrency ?? 3);

    const summary = await repopulateStale({ days, provider, limit, concurrency });
    res.json({ ok: true, days, provider, ...summary });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

console.log("ENV CHECK:", {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
  CRON_SECRET: !!process.env.CRON_SECRET,
});

// Internal cron job configuration
const cronEnabled = process.env.ENABLE_INTERNAL_CRON === "true";
const cronExpr = process.env.INTERNAL_CRON_EXPR || "0 3 1 * *"; // 03:00 on the 1st (UTC)
const cronDays = Number(process.env.INTERNAL_CRON_DAYS || 30);
const cronProvider = (process.env.INTERNAL_CRON_PROVIDER || "openai") as Provider;
const cronLimit = Number(process.env.INTERNAL_CRON_LIMIT || 100);
const cronConcurrency = Number(process.env.INTERNAL_CRON_CONCURRENCY || 3);

if (cronEnabled) {
  console.log(`[CRON] enabled. expr=${cronExpr}, days=${cronDays}, provider=${cronProvider}, limit=${cronLimit}, concurrency=${cronConcurrency}`);
  cron.schedule(cronExpr, async () => {
    try {
      console.log("[CRON] repopulate starting…");
      const summary = await repopulateStale({
        days: cronDays,
        provider: cronProvider,
        limit: cronLimit,
        concurrency: cronConcurrency,
      });
      console.log("[CRON] repopulate done:", summary);
    } catch (err) {
      console.error("[CRON] repopulate error:", err);
    }
  });
} else {
  console.log("[CRON] disabled (set ENABLE_INTERNAL_CRON=true to enable).");
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Zen AI running on http://localhost:${port}`));
