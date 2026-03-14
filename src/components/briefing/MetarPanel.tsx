// src/components/briefing/MetarPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel }       from '@/components/ui/Panel';
import { Badge }       from '@/components/ui/Badge';
import { decodeMetar, getFlightCategory, highlightMetar } from '@/lib/weather/metar';
import { useSunTimes } from '@/hooks/useSunTimes';
import type { FlightCategory } from '@/types';
import styles from './MetarPanel.module.css';

interface MetarPanelProps { icao: string; }

const CAT_VARIANT: Record<FlightCategory, 'vmc' | 'mvfr' | 'ifr' | 'lifr'> = {
  VMC: 'vmc', MVFR: 'mvfr', IFR: 'ifr', LIFR: 'lifr',
};

export function MetarPanel({ icao }: MetarPanelProps) {
  const [raw,     setRaw]     = useState<string | null>(null);
  const [obsType, setObsType] = useState<'METAR' | 'SPECI'>('METAR');
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const sun = useSunTimes(icao);

  useEffect(() => {
    setLoading(true); setError(null); setRaw(null);
    fetch(`/api/metar?icao=${icao}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else { setRaw(d.metar); setObsType(d.type ?? 'METAR'); }
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [icao]);

  const decoded = raw ? decodeMetar(raw) : null;
  const cat     = decoded ? getFlightCategory(decoded) : null;

  // ── Badge row: [SPECI?] [VMC/IFR/…] [↑sunrise ↓sunset]
  const badgeEl = (
    <div className={styles.badgeRow}>
      {obsType === 'SPECI' && (
        <span title="Special observation — condições mudaram rapidamente">
          <Badge label="SPECI" variant="mvfr" />
        </span>
      )}
      {cat && <Badge label={cat} variant={CAT_VARIANT[cat]} />}
      {(sun.sunrise || sun.sunset) && (
        <span className={styles.sunTimes}>
          {sun.sunrise && <span title="Nascer do sol">↑{sun.sunrise}</span>}
          {sun.sunset  && <span title="Pôr do sol">↓{sun.sunset}</span>}
        </span>
      )}
    </div>
  );

  const panelStatus = loading ? 'loading' : error ? 'crit' : cat
    ? ({ VMC: 'ok', MVFR: 'warn', IFR: 'crit', LIFR: 'crit' } as const)[cat]
    : 'empty';

  // Título: "METAR / SPECI" — sempre mostra os dois separados por /
  const title = 'METAR / SPECI';

  return (
    <Panel
      title={title}
      subtitle={icao}
      status={panelStatus as 'ok' | 'warn' | 'crit' | 'loading' | 'empty'}
      badge={badgeEl}
    >
      {loading && <div className={styles.loading}><span className="spin" /> Carregando…</div>}
      {error   && <div className={styles.error}>⚠ {error}</div>}
      {raw && decoded && (
        <>
          <pre
            className={styles.raw}
            dangerouslySetInnerHTML={{ __html: highlightMetar(raw) }}
          />
          <dl className={styles.grid}>
            {decoded.wdir && (
              <>
                <dt>Vento</dt>
                <dd className={styles.val}>
                  {decoded.wdir} {decoded.wspdS}
                  {decoded.wgust && <span className={styles.gust}> {decoded.wgust}</span>}
                </dd>
              </>
            )}
            <dt>Visibilidade</dt>
            <dd className={decoded.cavok ? styles.ok : parseInt(decoded.vis || '0') < 1500 ? styles.crit : styles.warn}>
              {decoded.cavok ? 'CAVOK' : `${decoded.vis} m`}
            </dd>
            <dt>Teto</dt>
            <dd className={decoded.ceil && decoded.ceil < 500 ? styles.crit : decoded.ceil && decoded.ceil < 1500 ? styles.warn : styles.ok}>
              {decoded.cavok ? 'CAVOK' : decoded.ceil != null ? `${decoded.ceil} ft` : 'CLEAR'}
            </dd>
            {decoded.wx && (
              <>
                <dt>Tempo</dt>
                <dd className={styles.wx}>{decoded.wx}</dd>
              </>
            )}
            <dt>Temp / Or</dt>
            <dd className={styles.val}>{decoded.temp} / {decoded.dew}</dd>
            <dt>QNH</dt>
            <dd className={styles.val}>{decoded.qnh || '—'}</dd>
          </dl>
        </>
      )}
    </Panel>
  );
}
