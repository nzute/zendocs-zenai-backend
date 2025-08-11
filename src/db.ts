import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  throw new Error("Supabase env vars missing");
}

export const supabase = createClient(url, serviceKey);

export function getSupabase() {
  return supabase;
}

export function isFresh(iso: string, days = 30) {
  return Date.now() - new Date(iso).getTime() < days * 24 * 60 * 60 * 1000;
}
