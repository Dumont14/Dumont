// src/app/api/aisweb-routes/route.ts
//
// Proxy server-side para AISWEB area=routesp.
// Mantém credenciais (AISWEB_USER / AISWEB_PASS) fora do bundle do cliente.
// Padrão idêntico ao notam/route.ts do projeto.

import { NextRequest, NextResponse } from 'next/server';

const AISWEB_BASE = 'https://api.decea.mil.br/aisweb/';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const adep  = searchParams.get('adep')?.toUpperCase()  ?? '';
  const ades  = searchParams.get('ades')?.toUpperCase()  ?? '';
  const level = searchParams.get('level')?.toUpperCase() ?? '';

  const user = process.env.AISWEB_USER;
  const pass = process.env.AISWEB_PASS;

  if (!user || !pass) {
    return NextResponse.json(
      { error: 'AISWEB credentials not configured (AISWEB_USER / AISWEB_PASS)' },
      { status: 503 }
    );
  }

  // Montar query para AISWEB
  const query = new URLSearchParams({
    apiKey:  user,
    apiPass: pass,
    area:    'routesp',
  });
  if (adep)  query.set('adep',  adep);
  if (ades)  query.set('ades',  ades);
  if (level) query.set('level', level);

  try {
    const res = await fetch(`${AISWEB_BASE}?${query.toString()}`, {
      headers: { Accept: 'application/json, text/xml, */*' },
      cache: 'no-store', // sem cache — params variam por par
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `AISWEB error: ${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();

    // Repassar resposta crua (XML ou JSON) — o helper client faz o parse
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'text/xml',
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=300',
      },
    });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Unknown error';
    console.error('[aisweb-routes] fetch error:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
