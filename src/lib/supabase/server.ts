// src/lib/supabase/server.ts
// Server-side Supabase client (uses service_role key)
// Use ONLY in API routes (src/app/api/*) — never in browser code

import { createClient } from '@supabase/supabase-js';

export function createServerClient() {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase environment variables. Check .env.local');
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
