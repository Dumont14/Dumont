// src/lib/aisweb/parseRoutespXml.ts
//
// Normaliza respostas XML do proxy AISWEB (area=routesp) para RoutespItem[].
// Isolado aqui para não poluir o helper principal e facilitar testes.

import type { RoutespItem } from '@/types/aisweb';

/** Extrai texto de um elemento pelo tag name (primeiro match) */
function getText(el: Element, tag: string): string | undefined {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
}

/**
 * Tenta parsear uma string (XML ou JSON) retornada pelo proxy.
 * Sempre retorna array — nunca lança.
 */
export function parseRoutespResponse(raw: string): RoutespItem[] {
  if (!raw || typeof raw !== 'string') return [];

  const trimmed = raw.trim();

  // ── JSON ─────────────────────────────────────────────────────────────────
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const items: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed.data ?? parsed.routesp ?? parsed.items ?? parsed.routes ?? [parsed];
      return items.map(normalizeJsonItem).filter(Boolean) as RoutespItem[];
    } catch (e) {
      console.debug('[parseRoutespResponse] JSON parse failed:', e);
      return [];
    }
  }

  // ── XML ──────────────────────────────────────────────────────────────────
  if (trimmed.startsWith('<')) {
    try {
      const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        console.debug('[parseRoutespResponse] XML parse error:', parseError.textContent);
        return [];
      }

      // Tenta vários possíveis tag names para os itens
      const candidates = ['routesp', 'route', 'item', 'row', 'Route', 'RouteItem'];
      let elements: Element[] = [];
      for (const tag of candidates) {
        const found = Array.from(doc.getElementsByTagName(tag));
        if (found.length > 0) { elements = found; break; }
      }

      // Fallback: filhos diretos do root
      if (elements.length === 0 && doc.documentElement) {
        elements = Array.from(doc.documentElement.children);
      }

      return elements.map(normalizeXmlItem).filter(Boolean) as RoutespItem[];
    } catch (e) {
      console.debug('[parseRoutespResponse] XML processing failed:', e);
      return [];
    }
  }

  console.debug('[parseRoutespResponse] Unknown format, first 80 chars:', trimmed.slice(0, 80));
  return [];
}

// ── Normalizadores internos ───────────────────────────────────────────────

function normalizeXmlItem(el: Element): RoutespItem | null {
  // Tenta extrair campos em diferentes variações de tag name
  const ident =
    getText(el, 'ident') ?? getText(el, 'IDENT') ?? getText(el, 'name') ?? getText(el, 'NAME');
  const level =
    getText(el, 'level') ?? getText(el, 'LEVEL') ?? getText(el, 'Level');
  const type =
    getText(el, 'type') ?? getText(el, 'TYPE') ?? getText(el, 'routeType');
  const adep =
    getText(el, 'adep') ?? getText(el, 'ADEP') ?? getText(el, 'dep');
  const ades =
    getText(el, 'ades') ?? getText(el, 'ADES') ?? getText(el, 'arr') ?? getText(el, 'dest');
  const route =
    getText(el, 'route') ?? getText(el, 'ROUTE') ?? getText(el, 'fixes') ?? getText(el, 'waypoints');
  const pdfUrl =
    getText(el, 'pdfUrl') ?? getText(el, 'pdf') ?? getText(el, 'carta') ?? getText(el, 'chart');
  const id =
    getText(el, 'id') ?? getText(el, 'ID') ?? ident ?? `erc-${Math.random().toString(36).slice(2, 7)}`;

  if (!id && !ident && !route) return null;

  return {
    id: id ?? `erc-${Math.random().toString(36).slice(2, 7)}`,
    ident,
    level: normalizeLevel(level),
    type,
    adep,
    ades,
    route,
    pdfUrl,
    raw: { xml: el.outerHTML },
  };
}

function normalizeJsonItem(item: unknown): RoutespItem | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;

  const ident =
    str(o.ident) ?? str(o.IDENT) ?? str(o.name) ?? str(o.routeName);
  const level =
    str(o.level) ?? str(o.LEVEL) ?? str(o.Level);
  const adep =
    str(o.adep) ?? str(o.ADEP) ?? str(o.dep) ?? str(o.departure);
  const ades =
    str(o.ades) ?? str(o.ADES) ?? str(o.arr) ?? str(o.destination) ?? str(o.dest);
  const route =
    str(o.route) ?? str(o.ROUTE) ?? str(o.fixes) ?? str(o.waypoints);
  const pdfUrl =
    str(o.pdfUrl) ?? str(o.pdf) ?? str(o.carta) ?? str(o.chart);
  const id =
    str(o.id) ?? str(o.ID) ?? ident ?? `erc-${Math.random().toString(36).slice(2, 7)}`;

  if (!ident && !route && !id) return null;

  return {
    id: id ?? `erc-${Math.random().toString(36).slice(2, 7)}`,
    ident,
    level: normalizeLevel(level),
    type: str(o.type) ?? str(o.routeType),
    adep,
    ades,
    route,
    pdfUrl,
    raw: item,
  };
}

function normalizeLevel(raw: string | undefined): 'L' | 'H' | string | undefined {
  if (!raw) return undefined;
  const up = raw.toUpperCase().trim();
  if (up === 'L' || up === 'LOW' || up === 'LOWER') return 'L';
  if (up === 'H' || up === 'HIGH' || up === 'UPPER') return 'H';
  return raw;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}
