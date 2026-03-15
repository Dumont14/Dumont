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

  // Tentar extrair blocos XML estruturados (<item> ou <notam>)
  const blockRe = /<(?:item|notam|NOTAM|Notam)[^>]*>([\s\S]*?)<\/(?:item|notam|NOTAM|Notam)>/gi;
  let block: RegExpExecArray | null;
  let found = false;

  while ((block = blockRe.exec(raw)) !== null) {
    found = true;
    const content = block[1];

    const get = (tag: string): string => {
      // Regex robusto para capturar tags mesmo se houver CDATA ou quebras de linha
      const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Priorizar campos de texto do AISWEB
    const text = get('e') || get('itemE') || get('text') ||
                 get('mens') || get('texto') || get('message') ||
                 content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!text || text.length < 5) continue;

    notams.push({
      id:   get('id') || get('numero') || get('notamId') || String(notams.length + 1),
      text,
      from: get('b') || get('inicio') || get('startValidity') || '',
      to:   get('c') || get('fim')    || get('endValidity')   || '',
      q:    get('q') || get('qLine')  || '',
    });
  }

  // Fallback: se não encontrou blocos XML ou o XML está mal formatado, tentar texto bruto
  if (!found || (notams.length === 0 && raw.length > 50)) {
    // Tentar encontrar padrões de NOTAM (ex: B0283/26) no texto bruto
    const chunks = raw.split(/(?=\b[A-Z]\d{4}\/\d{2}\b)/);
    for (const chunk of chunks) {
      const trimChunk = chunk.trim();
      if (trimChunk.length < 20) continue;

      const idMatch = trimChunk.match(/^([A-Z]\d{4}\/\d{2})/);
      const id = idMatch ? idMatch[1] : String(notams.length + 1);

      // Tentar capturar o texto operacional (geralmente após a linha Q) ou do início
      const qIdx = trimChunk.indexOf('Q)');
      let text = '';
      let qLine = '';
      
      if (qIdx >= 0) {
        const lines = trimChunk.slice(qIdx).split('\n');
        qLine = lines[0].trim();
        text = lines.slice(1).join(' ').trim();
      } else {
        text = trimChunk;
      }

      if (text.length > 10) {
        // Tentar extrair datas simples se existirem
        const dateMatch = trimChunk.match(/(\d{2}\/\d{2}\/\d{2,4}).*?a.*?(\d{2}\/\d{2}\/\d{2,4})/);
        notams.push({ 
          id, 
          text, 
          from: dateMatch ? dateMatch[1] : '', 
          to: dateMatch ? dateMatch[2] : '', 
          q: qLine 
        });
      }
    }
  }

  return notams;
}
