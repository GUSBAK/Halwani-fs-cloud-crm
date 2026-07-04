import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabase() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes('YOUR-PROJECT')) return null;

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return client;
}

export function hasSupabaseConfig() {
  return Boolean(getSupabase());
}
