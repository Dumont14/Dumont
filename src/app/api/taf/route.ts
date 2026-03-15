// src/app/api/taf/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchTaf } from '@/lib/weather';

export async function GET(req: NextRequest) {
  const icao = req.nextUrl.searchParams.get('icao')?.toUpperCase();
  if (!icao || icao.length < 2) {
    return NextResponse.json({ error: 'Missing or invalid ICAO' }, { status: 400 });
  }
  try {
    const taf = await fetchTaf(icao);
    return NextResponse.json(
      { taf },
      { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=120' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
