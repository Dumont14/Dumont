// src/app/api/sigmet/route.ts
import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://api-redemet.decea.mil.br/mensagens/sigmet';

export async function GET(req: NextRequest) {
  const apiKey = process.env.REDEMET_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'REDEMET_API_KEY not configured' }, { status: 503 });
  }

  try {
    const url = `${BASE}/?api_key=${apiKey}&pais=Brasil&page_tam=150`;
    const res = await fetch(url, {
      next: { revalidate: 300 }, // cache 5min — SIGMETs mudam com frequência
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `REDEMET error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
