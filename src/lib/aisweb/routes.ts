// src/lib/aisweb/routes.ts
//
// Helper client para buscar rotas ERC (area=routesp) via proxy AISWEB.
// Inclui:
//  - Cache em memória por dep-arr-level
//  - Resolução de coords via tokens ICAO (batch, com cache de aeródromos)
//  - Parse defensivo XML/JSON via parseRoutespResponse

import type { RoutespItem, ErcLevel } from '@/types/aisweb';
import { parseRoutespResponse } from './parseRoutespXml';

// ── Cache de rotas ────────────────────────────────────────────────────────
const routeCache = new Map<string, RoutespItem[]>();

function routeCacheKey(adep?: string, ades?: string, level?: ErcLevel): string {
  return `${adep ?? ''}-${ades ?? ''}-${level ?? 'ALL'}`;
}

// ── Cache de coordenadas de aeródromos ────────────────────────────────────
// Compartilhado entre chamadas para evitar fetches duplicados
const airportCoordCache = new Map<string, [number, number] | null>();

/** Resolve lat/lng de um ICAO via /api/airport. Retorna null se não encontrado. */
async function resolveAirportCoord(
  icao: string,
  signal?: AbortSignal
): Promise<[number, number] | null> {
  if (airportCoordCache.has(icao)) return airportCoordCache.get(icao)!;

  try {
    const res = await fetch(`/api/airport?icao=${icao}`, {
      signal,
      // Não cachear erros de rede — apenas resultados válidos
    });
    if (!res.ok) { airportCoordCache.set(icao, null); return null; }
    const data = await res.json();
    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);
    if (isNaN(lat) || isNaN(lng)) { airportCoordCache.set(icao, null); return null; }
    const coord: [number, number] = [lat, lng];
    airportCoordCache.set(icao, coord);
    return coord;
  } catch {
    airportCoordCache.set(icao, null);
    return null;
  }
}

/**
 * Popula coords[] em cada RoutespItem usando adep e ades como endpoints.
 * O campo <route> contém airways + waypoints RNAV (não ICAOs de aeródromo),
 * por isso usamos apenas DEP e ARR para desenhar a polyline.
 * Faz lookups em batch (Promise.all) com cache de aeródromos.
 */
async function resolveCoords(
  routes: RoutespItem[],
  signal?: AbortSignal
): Promise<RoutespItem[]> {
  // Coletar todos os ICAOs de adep/ades únicos
  const allIcaos = new Set<string>();
  for (const r of routes) {
    if (r.coords && r.coords.length >= 2) continue;
    if (r.adep) allIcaos.add(r.adep.toUpperCase());
    if (r.ades) allIcaos.add(r.ades.toUpperCase());
  }

  // Resolver todos em paralelo (batch)
  await Promise.all(
    Array.from(allIcaos).map(icao => resolveAirportCoord(icao, signal))
  );

  // Popular coords: linha reta adep → ades (suficiente para overlay visual)
  return routes.map(r => {
    if (r.coords && r.coords.length >= 2) return r;

    const depCoord = r.adep ? airportCoordCache.get(r.adep.toUpperCase()) : null;
    const arrCoord = r.ades ? airportCoordCache.get(r.ades.toUpperCase()) : null;

    if (depCoord && arrCoord) {
      return { ...r, coords: [depCoord, arrCoord] };
    }
    return r;
  });
}

// ── fetchRoutesp ──────────────────────────────────────────────────────────

export interface FetchRoutespParams {
  adep?: string;
  ades?: string;
  level?: ErcLevel;
  signal?: AbortSignal;
  /** Limite máximo de resultados (default 200) */
  limit?: number;
}

/**
 * Busca rotas ERC via proxy AISWEB e retorna array normalizado de RoutespItem.
 *
 * - Cache em memória por dep-arr-level (evita refetch ao toggle on/off).
 * - Parse defensivo XML ou JSON.
 * - Resolução de coords via ICAOs em batch.
 */
export async function fetchRoutesp(params: FetchRoutespParams): Promise<RoutespItem[]> {
  const { adep, ades, level, signal, limit = 200 } = params;

  const cacheKey = routeCacheKey(adep, ades, level);
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  // Montar query string para /api/aisweb-routes
  const query = new URLSearchParams();
  if (adep) query.set('adep', adep);
  if (ades) query.set('ades', ades);
  if (level && level !== 'ALL') query.set('level', level);

  const res = await fetch(`/api/aisweb-routes?${query.toString()}`, {
    signal,
    headers: { Accept: 'application/json, text/xml, */*' },
  });

  if (!res.ok) {
    throw new Error(`AISWEB proxy error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  console.debug('[fetchRoutesp] raw response (first 300 chars):', text.slice(0, 300));

  let routes = parseRoutespResponse(text).slice(0, limit);

  // Tentar resolver coordenadas (pode ser parcial — sem erros fatais)
  try {
    routes = await resolveCoords(routes, signal);
  } catch (e) {
    // Se a resolução falhar (ex.: AbortError), retornar o que temos
    if ((e as Error).name !== 'AbortError') {
      console.debug('[fetchRoutesp] coord resolution partial failure:', e);
    }
  }

  // Só cachear se não foi abortado
  if (!signal?.aborted) {
    routeCache.set(cacheKey, routes);
  }

  return routes;
}

/** Limpa o cache de rotas (útil em testes ou ao trocar de rota). */
export function clearRoutespCache(): void {
  routeCache.clear();
}
