// src/app/api/metar/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestObs } from '@/lib/weather';

export async function GET(req: NextRequest) {
  const icao = req.nextUrl.searchParams.get('icao')?.toUpperCase();
  if (!icao || icao.length < 2) {
    return NextResponse.json({ error: 'Missing or invalid ICAO' }, { status: 400 });
  }
  try {
    const obs = await fetchLatestObs(icao);
    // obs = { raw: "SBSP 130500Z ...", type: "METAR" | "SPECI" }
    return NextResponse.json(
      { metar: obs.raw, type: obs.type },
      { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=30' } }
      //                                       ^^^ SPECI exige cache menor (2 min)
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
