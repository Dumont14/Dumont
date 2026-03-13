// src/app/api/confirm/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getConfirmWeight } from '@/lib/constants';
import type { UserRole, ReportCategory } from '@/types';

export async function GET(req: NextRequest) {
  const { post_id, user_id } = Object.fromEntries(req.nextUrl.searchParams);
  if (!post_id || !user_id) {
    return NextResponse.json({ error: 'post_id and user_id required' }, { status: 400 });
  }
  const db = createServerClient();
  const { data } = await db
    .from('ab_confirmations')
    .select('id')
    .eq('post_id', post_id)
    .eq('user_id', user_id)
    .single();
  return NextResponse.json({ confirmed: !!data });
}

export async function POST(req: NextRequest) {
  const { post_id, user_id } = await req.json();
  if (!post_id || !user_id) {
    return NextResponse.json({ error: 'post_id and user_id required' }, { status: 400 });
  }

  const db = createServerClient();

  const [{ data: user }, { data: post }] = await Promise.all([
    db.from('ab_users').select('id, role').eq('id', user_id).single(),
    db.from('ab_posts').select('id, category, user_id').eq('id', post_id).single(),
  ]);

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  if (post.user_id === user_id) {
    return NextResponse.json({ error: 'Cannot confirm your own post' }, { status: 400 });
  }

  const weight = getConfirmWeight(user.role as UserRole, post.category as ReportCategory);

  const { data, error } = await db
    .from('ab_confirmations')
    .insert({ post_id, user_id, weight })
    .select('id, weight')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: updated } = await db
    .from('ab_posts')
    .select('score, raw_confirms, weighted_confirms, expires_at')
    .eq('id', post_id)
    .single();

  return NextResponse.json({ weight, ...updated }, { status: 201 });
}
