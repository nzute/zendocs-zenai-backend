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

// Import withTimeout function (we'll need to export it from ai.ts)
async function withTimeout<T>(p: Promise<T>, ms = 4500): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("AI_TIMEOUT")), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}
import { serializeErr } from "./errors";
import { mirrorVisaStatus, mirrorVisaPayload } from "./mirror";

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
            .select("resident_country, nationality, destination, visa_category, visa_type, res_nat_dest_cat_type, last_updated")
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
    combos.map(async (c) => {
      try {
        const row = await limitRun(() =>
          generateAndUpsert(
            supabase,
            {
              resident_country: c.resident_country,
              nationality: c.nationality,
              destination: c.destination,
              visa_category: c.visa_category,
              visa_type: c.visa_type,
              res_nat_dest_cat_type: c.res_nat_dest_cat_type,
            },
            provider
          )
        );
        
        // PRIORITY: Mirror successful repopulate to Firebase FIRST
        await mirrorVisaPayload(row.res_nat_dest_cat_type, {
          ...row, // whatever you selected/returned after upsert
          res_nat_dest_cat_type: row.res_nat_dest_cat_type,
          source: provider,
          last_updated: new Date().toISOString(),
        });
        
        return row;
      } catch (error) {
        // PRIORITY: Mirror error status to Firebase FIRST
        await mirrorVisaStatus(c.res_nat_dest_cat_type, "error", {
          resident_country: c.resident_country,
          nationality: c.nationality,
          destination: c.destination,
          visa_category: c.visa_category,
          visa_type: c.visa_type,
        });
        throw error;
      }
    })
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
  const {
    resident_country, nationality, destination, visa_category, visa_type,
    res_nat_dest_cat_type, provider = "openai", force_refresh = false
  } = req.body || {};
  for (const f of ["resident_country","nationality","destination","visa_category","visa_type","res_nat_dest_cat_type"]) {
    if (!req.body?.[f]) return res.status(400).json({ error: `Missing field: ${f}` });
  }

  const supabase = getSupabase();

  // 1) Send to Firebase FIRST for fresh queries
  const baseKey = { resident_country, nationality, destination, visa_category, visa_type };
  const nowISO = new Date().toISOString();
  const base = { resident_country, nationality, destination, visa_category, visa_type };

  // Check if row exists and is complete (has both res_nat_dest_cat_type and visa_description)
  const { data: existing } = await supabase
    .from("visa_requirements_cache")
    .select("last_updated,status,res_nat_dest_cat_type,visa_description")
    .match(baseKey)
    .maybeSingle();

  // Verify if the row is complete (has both required fields)
  const isComplete = existing && 
    existing.res_nat_dest_cat_type && 
    existing.visa_description && 
    existing.res_nat_dest_cat_type === res_nat_dest_cat_type;

  // Handle force_refresh: if true, always retry regardless of freshness
  const fresh = existing && isFresh(existing.last_updated) && !force_refresh && isComplete;
  
  // Set appropriate status for real-time frontend updates
  let nextStatus;
  if (fresh) {
    nextStatus = "ready";
  } else if (force_refresh && existing?.status === "error") {
    nextStatus = "processing"; // Show retry progress
  } else if (existing && !isComplete) {
    // Row exists but is incomplete - need to complete it
    nextStatus = "processing";
    console.log(`🔄 Row exists but incomplete for ${res_nat_dest_cat_type}, completing...`);
  } else if (existing) {
    nextStatus = "refreshing";
  } else {
    nextStatus = "queued";
  }

  // PRIORITY: Send to Firebase FIRST
  await mirrorVisaStatus(res_nat_dest_cat_type, nextStatus as any, base);

  // Then update Supabase
  const supabaseStart = Date.now();
  await supabase.from("visa_requirements_cache").upsert({
    ...baseKey,
    res_nat_dest_cat_type,
    status: nextStatus,
    updated_at: nowISO
  }, {
    onConflict: "resident_country,nationality,destination,visa_category,visa_type"
  });
  const supabaseDuration = Date.now() - supabaseStart;
  console.log(`🗄️ Supabase Status Update: ${supabaseDuration}ms (${nextStatus})`);

  // 2) Fire-and-forget background job to generate (only if not fresh, force_refresh, or incomplete row)
  if (!fresh || force_refresh || (existing && !isComplete)) {
    (async () => {
      try {
        // PRIORITY: Update Firebase status to "processing" FIRST
        await mirrorVisaStatus(res_nat_dest_cat_type, "processing", base);
        
        // Then update Supabase status
        const supabaseProcessingStart = Date.now();
        await supabase.from("visa_requirements_cache").update({
          status: "processing",
          updated_at: new Date().toISOString()
        }).match(baseKey);
        const supabaseProcessingDuration = Date.now() - supabaseProcessingStart;
        console.log(`🗄️ Supabase Processing Update: ${supabaseProcessingDuration}ms`);
        
        const aiStart = Date.now();
        
        // Log the scenario we're handling
        if (existing && !isComplete) {
          console.log(`🔧 Completing existing incomplete row for ${res_nat_dest_cat_type}`);
        } else if (force_refresh) {
          console.log(`🔄 Force refreshing row for ${res_nat_dest_cat_type}`);
        } else {
          console.log(`🆕 Creating new row for ${res_nat_dest_cat_type}`);
        }
        
        const up = await generateAndUpsert(
          supabase,
          {
            resident_country, nationality, destination, visa_category, visa_type,
            res_nat_dest_cat_type
          },
          provider
        );
        const aiDuration = Date.now() - aiStart;
        console.log(`🤖 AI Generation + Supabase Upsert: ${aiDuration}ms`);

        // PRIORITY: Send full payload to Firebase FIRST
        await mirrorVisaPayload(res_nat_dest_cat_type, {
          ...up, // includes all the visa_* fields you store in Supabase
          res_nat_dest_cat_type,
          source: provider,
          last_updated: new Date().toISOString(),
        });
        
        // Then mark Supabase as ready
        const supabaseReadyStart = Date.now();
        await supabase.from("visa_requirements_cache").update({
          status: "ready",
          updated_at: new Date().toISOString(),
          last_updated: new Date().toISOString()
        }).match(baseKey);
        const supabaseReadyDuration = Date.now() - supabaseReadyStart;
        console.log(`🗄️ Supabase Ready Update: ${supabaseReadyDuration}ms`);
      } catch (err) {
        // PRIORITY: Update Firebase error status FIRST
        await mirrorVisaStatus(res_nat_dest_cat_type, "error", base);
        console.error("BG gen error", err);
        
        // Then mark Supabase error
        const supabaseErrorStart = Date.now();
        await supabase.from("visa_requirements_cache").update({
          status: "error",
          updated_at: new Date().toISOString()
        }).match(baseKey);
        const supabaseErrorDuration = Date.now() - supabaseErrorStart;
        console.log(`🗄️ Supabase Error Update: ${supabaseErrorDuration}ms`);
      }
    })();
  }

  // 3) Return immediately so frontend can navigate & show shimmer
  // If fresh, you *can* also include data here, but your flow wants the page to load by keys.
  return res.status(fresh ? 200 : 202).json({
    ok: true,
    status: nextStatus,
    ...baseKey
  });
});

// Secure weekly refresh endpoint (purge stale rows) - runs every Saturday at midnight (UTC)
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

// Secure weekly repopulation: re-generate stale rows (not just delete) - runs every Saturday at midnight (UTC)
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
  FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
});

// Internal cron job configuration
const cronEnabled = process.env.ENABLE_INTERNAL_CRON === "true";
const cronExpr = process.env.INTERNAL_CRON_EXPR || "0 0 * * 6"; // Every Saturday at midnight (UTC)
const cronDays = Number(process.env.INTERNAL_CRON_DAYS || 7);
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
