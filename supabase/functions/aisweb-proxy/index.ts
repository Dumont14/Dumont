import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const url    = new URL(req.url);
    const icao   = url.searchParams.get('icao')?.toUpperCase();
    const user   = Deno.env.get('AISWEB_USER');
    const pass   = Deno.env.get('AISWEB_PASS');

    if (!icao) {
      return new Response(
        JSON.stringify({ error: 'Missing ICAO' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    if (!user || !pass) {
      return new Response(
        JSON.stringify({ error: 'AISWEB credentials not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar NOTAMs do AISWEB
    const aisbRes = await fetch(
      `https://www.aisweb.aer.mil.br/api/notam?ICAOCode=${icao}&APIKey=${user}&APIPass=${pass}`,
      {
        headers: {
          'User-Agent': 'DumontApp/1.0',
          'Accept': 'application/json, text/xml, */*',
        },
        signal: AbortSignal.timeout(10000), // 10s timeout
      }
    );

    if (!aisbRes.ok) {
      return new Response(
        JSON.stringify({ error: `AISWEB ${aisbRes.status}` }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Capturar resposta bruta (pode ser XML, JSON ou texto)
    const rawText = await aisbRes.text();
    const trimmed = rawText.trim();

    // Se já for JSON válido, repassar direto
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return new Response(trimmed, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Parsear XML do AISWEB
    const notams = parseAISWEB(trimmed);

    return new Response(
      JSON.stringify({ notamList: notams, raw: trimmed }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});

// ── Parser AISWEB ─────────────────────────────────────────

interface NotamItem {
  id: string;
  text: string;
  from: string;
  to: string;
  q: string;
}

function parseAISWEB(raw: string): NotamItem[] {
  const notams: NotamItem[] = [];

  // Tentar extrair blocos XML estruturados
  const blockRe = /<(?:item|notam|NOTAM|Notam)[^>]*>([\s\S]*?)<\/(?:item|notam|NOTAM|Notam)>/gi;
  let block: RegExpExecArray | null;
  let found = false;

  while ((block = blockRe.exec(raw)) !== null) {
    found = true;
    const content = block[1];

    const get = (tag: string): string => {
      const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      // Remover CDATA e tags internas
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const text = get('e') || get('itemE') || get('text') ||
                 get('mens') || get('texto') || get('message') ||
                 // fallback: texto completo do bloco sem tags
                 content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!text) continue;

    notams.push({
      id:   get('id') || get('numero') || get('notamId') || String(notams.length + 1),
      text,
      from: get('b') || get('inicio') || get('startValidity') || '',
      to:   get('c') || get('fim')    || get('endValidity')   || '',
      q:    get('q') || get('qLine')  || '',
    });
  }

  // Se não encontrou blocos XML, tentar formato texto livre
  // Formato AISWEB: "G0576/26 R G0565/26 12/03/2026 13:15\nQ) ...\nAD CLSD..."
  if (!found && raw.length > 10) {
    // Separar por padrão de número de NOTAM: LETRA+DIGITOS/ANO
    const chunks = raw.split(/(?=\b[A-Z]\d{4}\/\d{2}\b)/);
    for (const chunk of chunks) {
      const trimChunk = chunk.trim();
      if (trimChunk.length < 10) continue;

      // Extrair ID
      const idMatch = trimChunk.match(/^([A-Z]\d{4}\/\d{2})/);
      const id = idMatch ? idMatch[1] : String(notams.length + 1);

      // Extrair validade das linhas de data
      const dateMatch = trimChunk.match(
        /(\d{2}\/\d{2}\/\d{2,4}\s+\d{2}:\d{2})\s+a\s+(\d{2}\/\d{2}\/\d{2,4}\s+\d{2}:\d{2})/i
      );
      const from = dateMatch ? dateMatch[1] : '';
      const to   = dateMatch ? dateMatch[2] : '';

      // Texto operacional: linhas após Q)
      const qIdx = trimChunk.indexOf('Q)');
      const text = qIdx >= 0
        ? trimChunk.slice(qIdx).split('\n').slice(1).join(' ').trim()
        : trimChunk;

      // Extrair Q line
      const qLine = qIdx >= 0
        ? (trimChunk.slice(qIdx).split('\n')[0] || '')
        : '';

      if (text.length > 5) {
        notams.push({ id, text, from, to, q: qLine });
      }
    }
  }

  return notams;
}
