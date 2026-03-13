// src/lib/supabase/client.ts
// Browser-side Supabase client (uses public anon key)
// Use in React components and client-side hooks

import { createClient } from '@supabase/supabase-js';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton for browser use
export const supabase = createClient(url, anon);
