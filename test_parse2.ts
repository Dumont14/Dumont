import * as fs from 'fs';

const raw = `<item> <id>B0283/26</id> <e>Q) SBRE/QFALC/IV/NBO/A/000/999/0504S04249W005
AD CLSD DEVIDO SER MAINT
ORIGEM: SDIA 40C12572
09/02/26 08:00 a 20/03/26 14:00 UTC
FEB 09-20 0800-1400, FEB 23-27 MAR 02-06 09-13 16-20 0930-1400</e></item>`;

interface NotamItem {
  id: string;
  text: string;
  from: string;
  to: string;
  q: string;
}

function parseAISWEB(raw: string): NotamItem[] {
  const notams: NotamItem[] = [];

  const blockRe = /<(?:item|notam|NOTAM|Notam)[^>]*>([\s\S]*?)<\/(?:item|notam|NOTAM|Notam)>/gi;
  let block: RegExpExecArray | null;
  let found = false;

  while ((block = blockRe.exec(raw)) !== null) {
    found = true;
    const content = block[1];

    const get = (tag: string): string => {
      const m = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      return m[1]
        .replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    };

    const text = get('e') || get('itemE') || get('text') ||
                 get('mens') || get('texto') || get('message') ||
                 content.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();

    if (!text) continue;

    notams.push({
      id:   get('id') || get('numero') || get('notamId') || String(notams.length + 1),
      text,
      from: get('b') || get('inicio') || get('startValidity') || '',
      to:   get('c') || get('fim')    || get('endValidity')   || '',
      q:    get('q') || get('qLine')  || '',
    });
  }
  return notams;
}

const parsed = parseAISWEB(raw);
console.log('--- OUTPUT DO EDGE FUNCTION (PRIMEIRO PASSO) ---');
console.log(JSON.stringify(parsed, null, 2));

const proxyResponse = {
  notamList: parsed,
  raw: raw
};

console.log('--- ENCAMINHANDO PARA parseNotams (frontend) ---');
import { parseNotams } from './src/lib/notam/index.ts';

const result = parseNotams(proxyResponse);
console.log(JSON.stringify(result, null, 2));
