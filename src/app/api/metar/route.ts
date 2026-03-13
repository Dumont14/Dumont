// src/app/api/metar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchMetar } from '@/lib/weather';

export async function GET(req: NextRequest) {
  const icao = req.nextUrl.searchParams.get('icao')?.toUpperCase();
  if (!icao || icao.length < 2) {
    return NextResponse.json({ error: 'Missing or invalid ICAO' }, { status: 400 });
  }
  try {
    const metar = await fetchMetar(icao);
    return NextResponse.json({ metar }, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
