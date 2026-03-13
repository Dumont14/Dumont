// src/app/api/notam/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchNotams } from '@/lib/notam';

export async function GET(req: NextRequest) {
  const icao = req.nextUrl.searchParams.get('icao')?.toUpperCase();
  if (!icao || icao.length < 2) {
    return NextResponse.json({ error: 'Missing or invalid ICAO' }, { status: 400 });
  }
  try {
    const data = await fetchNotams(icao);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=120' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
