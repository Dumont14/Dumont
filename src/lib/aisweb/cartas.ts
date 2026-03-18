// src/lib/aisweb/cartas.ts
// Fetch e parse das cartas aeronáuticas (SID/STAR/IAC/ADC/VAC/etc.)

export interface Carta {
  id:       string;
  tipo:     string;   // SID, STAR, IAC, ADC, VAC, ARC, MINIMA, ...
  tipoDescr:string;
  nome:     string;
  icao:     string;
  link:     string;   // URL direta do PDF
  icp:      string;   // código do procedimento (ex: CX00K)
  tabcode:  string;   // link para tabela de performance
  amdt:     string;   // emenda (ex: 2602A1)
  dt:       string;
}

export type CartasByTipo = Record<string, Carta[]>;

/** Ordem de exibição dos tipos */
export const TIPO_ORDER = ['SID','STAR','IAC','ARC','ADC','VAC','MINIMA','TMA'];

/** Labels legíveis por tipo */
export const TIPO_LABEL: Record<string, string> = {
  SID:    'SID — Saída Padrão',
  STAR:   'STAR — Chegada Padrão',
  IAC:    'IAC — Aproximação por Instrumentos',
  ARC:    'ARC — Aproximação em Círculo',
  ADC:    'ADC — Carta de Aeródromo',
  VAC:    'VAC — Carta de Aproximação Visual',
  MINIMA: 'Mínimos',
  TMA:    'TMA',
};

/** Busca e parseia cartas de um ICAO via proxy */
export async function fetchCartas(icao: string, signal?: AbortSignal): Promise<CartasByTipo> {
  const res = await fetch(`/api/aisweb-cartas?icao=${icao}`, {
    signal,
    headers: { Accept: 'text/xml' },
  });
  if (!res.ok) throw new Error(`Cartas ${icao}: ${res.status} ${res.statusText}`);

  const text = await res.text();
  return parseCartas(text);
}

function parseCartas(xml: string): CartasByTipo {
  if (!xml || !xml.trim().startsWith('<')) return {};

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return {};

  const items = Array.from(doc.getElementsByTagName('item'));
  const result: CartasByTipo = {};

  items.forEach(el => {
    const tipo = el.querySelector('tipo')?.textContent?.trim() ?? '';
    if (!tipo) return;

    // Normalizar variações de tipo
    const tipoKey = normalizeTipo(tipo);

    const carta: Carta = {
      id:        el.querySelector('id')?.textContent?.trim() ?? '',
      tipo:      tipoKey,
      tipoDescr: el.querySelector('tipo_descr')?.textContent?.trim() ?? '',
      nome:      el.querySelector('nome')?.textContent?.trim() ?? '',
      icao:      el.querySelector('IcaoCode')?.textContent?.trim() ?? '',
      link:      el.querySelector('link')?.textContent?.trim() ?? '',
      icp:       el.querySelector('icp')?.textContent?.trim() ?? '',
      tabcode:   el.querySelector('tabcode')?.textContent?.trim() ?? '',
      amdt:      el.querySelector('amdt')?.textContent?.trim() ?? '',
      dt:        el.querySelector('dt')?.textContent?.trim() ?? '',
    };

    if (!carta.nome || !carta.link) return;

    if (!result[tipoKey]) result[tipoKey] = [];
    result[tipoKey].push(carta);
  });

  // Ordenar cada grupo por nome
  Object.values(result).forEach(list => list.sort((a, b) => a.nome.localeCompare(b.nome)));

  return result;
}

function normalizeTipo(raw: string): string {
  const up = raw.toUpperCase().trim();
  if (up.includes('SID'))    return 'SID';
  if (up.includes('STAR'))   return 'STAR';
  if (up.includes('IAC'))    return 'IAC';
  if (up.includes('ARC'))    return 'ARC';
  if (up.includes('ADC'))    return 'ADC';
  if (up.includes('VAC'))    return 'VAC';
  if (up.includes('MINIM'))  return 'MINIMA';
  if (up.includes('TMA'))    return 'TMA';
  return up;
}
