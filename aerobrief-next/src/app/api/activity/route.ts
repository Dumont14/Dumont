// src/app/api/activity/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '40'), 100);
  const db = createServerClient();

  const { data, error } = await db
    .from('ab_activity')
    .select(`id, icao_dep, icao_arr, created_at, ab_users ( id, name, role, visible )`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const filtered = (data || []).filter(a => a.ab_users?.visible);
  return NextResponse.json(filtered);
}

export async function POST(req: NextRequest) {
  const { user_id, icao_dep, icao_arr } = await req.json();
  if (!user_id || !icao_dep) {
    return NextResponse.json({ error: 'user_id and icao_dep required' }, { status: 400 });
  }

  const db = createServerClient();
  const { data: user } = await db
    .from('ab_users').select('visible').eq('id', user_id).single();

  if (!user)         return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (!user.visible) return NextResponse.json({ logged: false, reason: 'opted-out' });

  const { error } = await db.from('ab_activity').insert({
    user_id,
    icao_dep: icao_dep.toUpperCase(),
    icao_arr: icao_arr?.toUpperCase() || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logged: true }, { status: 201 });
}
