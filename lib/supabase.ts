import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "default";

export const SUPABASE_AUTH_STORAGE_KEY = `sb-${ref}-auth-token`;

export const supabase = createClient(url, anonKey, {
  auth: {
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
