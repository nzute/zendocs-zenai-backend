import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Better error message with booleans so logs are helpful
  if (!url || !key) {
    console.error("ENV MISS:", {
      SUPABASE_URL: !!url,
      SUPABASE_SERVICE_ROLE_KEY: !!key,
    });
    throw new Error("Supabase env vars missing at runtime");
  }

  _client = createClient(url, key);
  return _client;
}

export function isFresh(iso: string, days = 30) {
  return Date.now() - new Date(iso).getTime() < days * 24 * 60 * 60 * 1000;
}
