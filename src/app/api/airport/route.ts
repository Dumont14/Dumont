// src/app/api/airport/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchAirportInfo } from '@/lib/airport';

export async function GET(req: NextRequest) {
  const icao = req.nextUrl.searchParams.get('icao')?.toUpperCase();
  if (!icao || icao.length < 2) {
    return NextResponse.json({ error: 'Missing or invalid ICAO' }, { status: 400 });
  }
  try {
    const data = await fetchAirportInfo(icao);
    if (!data) {
      return NextResponse.json({ error: 'Airport not found' }, { status: 404 });
    }
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600' },
    });
  } catch (e) {
    console.error('Airport API Error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
