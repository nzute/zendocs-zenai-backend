import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("ENV MISS:", {
      SUPABASE_URL: !!url,
      SUPABASE_SERVICE_ROLE_KEY: !!key,
    });
    // Do NOT throw at import time; only when actually called
    throw new Error("Supabase env vars missing at runtime");
  }

  if (_client) return _client;
  _client = createClient(url, key);
  return _client;
}

export function isFresh(iso: string, days = 30) {
  return Date.now() - new Date(iso).getTime() < days * 24 * 60 * 60 * 1000;
}
