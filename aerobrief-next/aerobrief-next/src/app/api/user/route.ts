// src/app/api/user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('ab_users')
    .select('id, name, role, visible, rep_score, rep_level, post_count, confirm_count, created_at')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { name, role, phone, visible } = await req.json();
  if (!name?.trim() || !role?.trim()) {
    return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
  }

  const db = createServerClient();
  const { data, error } = await db
    .from('ab_users')
    .insert({ name: name.trim(), role, phone: phone?.trim() || null, visible: visible !== false })
    .select('id, name, role, phone, visible, rep_level')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { id, visible, name, role, phone } = await req.json();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (visible  !== undefined) updates.visible = visible;
  if (name)                   updates.name    = name.trim();
  if (role)                   updates.role    = role;
  if (phone    !== undefined) updates.phone   = phone?.trim() || null;

  const db = createServerClient();
  const { data, error } = await db
    .from('ab_users')
    .update(updates)
    .eq('id', id)
    .select('id, name, role, phone, visible, rep_level')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
