// src/app/api/posts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { ReportCategory } from '@/types';

const VALID_CATS: ReportCategory[] = ['met', 'rwy', 'equip', 'obs', 'ops'];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const icao  = searchParams.get('icao')?.toUpperCase();
  const feed  = searchParams.get('feed') === '1';
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 60);

  const db = createServerClient();

  if (icao) {
    const { data, error } = await db
      .from('ab_posts')
      .select(`id, icao, category, title, body, photo_url,
               score, raw_confirms, weighted_confirms,
               created_at, expires_at,
               ab_users ( id, name, role, rep_level )`)
      .eq('icao', icao)
      .eq('is_active', true)
      .order('score', { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const now = Date.now();
    const annotated = (data || []).map(p => ({
      ...p,
      minutes_left: p.expires_at
        ? Math.max(0, Math.round((new Date(p.expires_at).getTime() - now) / 60000))
        : null,
    }));
    return NextResponse.json(annotated);
  }

  if (feed) {
    const { data, error } = await db
      .from('ab_posts')
      .select(`id, icao, category, title, score, raw_confirms,
               created_at, expires_at,
               ab_users ( id, name, role, rep_level )`)
      .eq('is_active', true)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || []);
  }

  return NextResponse.json({ error: 'Provide icao or feed=1' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Cron: deactivate expired posts
  if (searchParams.get('expire') === '1') {
    const db = createServerClient();
    const { data } = await db.rpc('deactivate_expired_posts');
    return NextResponse.json({ deactivated: data });
  }

  const { user_id, icao, category, title, body, photo_url } = await req.json();
  if (!user_id || !icao || !category || !title?.trim()) {
    return NextResponse.json({ error: 'user_id, icao, category and title required' }, { status: 400 });
  }
  if (!VALID_CATS.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  const db = createServerClient();
  const { data: user } = await db.from('ab_users').select('id').eq('id', user_id).single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { data, error } = await db
    .from('ab_posts')
    .insert({ user_id, icao: icao.toUpperCase(), category, title: title.trim(), body: body?.trim() || null, photo_url: photo_url || null })
    .select('id, icao, category, title, score, created_at, expires_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
