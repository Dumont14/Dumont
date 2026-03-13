// src/app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('photo') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 413 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Only images allowed' }, { status: 400 });
  }

  const ext      = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const fileName = `post_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
  const buffer   = Buffer.from(await file.arrayBuffer());

  const db = createServerClient();
  const { data, error } = await db.storage
    .from('aerobrief-posts')
    .upload(fileName, buffer, { contentType: file.type, cacheControl: '3600', upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = db.storage.from('aerobrief-posts').getPublicUrl(data.path);
  return NextResponse.json({ url: publicUrl, path: data.path });
}
