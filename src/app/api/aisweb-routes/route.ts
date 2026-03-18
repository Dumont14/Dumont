// src/app/api/aisweb-cartas/route.ts
// Proxy para AISWEB area=cartas — lista de cartas aeronáuticas por ICAO

import { NextRequest, NextResponse } from 'next/server';

const AISWEB_BASE = 'http://aisweb.decea.gov.br/api/';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const icao = searchParams.get('icao')?.toUpperCase() ?? '';

  if (!icao || icao.length < 4) {
    return NextResponse.json({ error: 'ICAO obrigatório' }, { status: 400 });
  }

  const user = process.env.AISWEB_USER;
  const pass = process.env.AISWEB_PASS;
  if (!user || !pass) {
    return NextResponse.json({ error: 'AISWEB credentials not configured' }, { status: 503 });
  }

  const query = new URLSearchParams({
    apiKey:  user,
    apiPass: pass,
    area:    'cartas',
    icaoCode: icao,
  });

  try {
    const res = await fetch(`${AISWEB_BASE}?${query.toString()}`, {
      headers: { Accept: 'text/xml, */*' },
      next: { revalidate: 43200 }, // cache 12h — cartas mudam por emenda (~28 dias)
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `AISWEB error: ${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }

    const body = await res.text();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Cache-Control': 's-maxage=43200, stale-while-revalidate=3600',
      },
    });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Unknown error';
    console.error('[aisweb-cartas]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
