'use client';
import React, { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import type { AirportInfo, Frequency, Runway } from '@/types';
import styles from './AirportPanel.module.css';

interface AirportPanelProps { icao: string; }

const FREQ_ORDER = ['ATIS','TWR','APP','GND','DEL','AFIS','UNICOM','RADIO'];

function FreqRow({ f }: { f: Frequency }) {
  return (
    <div className={styles.freqRow}>
      <span className={styles.freqType}>{f.type}</span>
      <span className={styles.freqMhz}>{f.mhz}</span>
      {f.description && (
        <span className={styles.freqDesc}>{f.description}</span>
      )}
    </div>
  );
}

function RunwayRow({ r }: { r: Runway }) {
  const lenM = r.length_ft ? Math.round(r.length_ft * 0.3048) : null;
  return (
    <div className={[styles.rwyRow, r.closed ? styles.rwyClosed : ''].join(' ')}>
      <span className={styles.rwyIdent}>
        {r.le_ident}/{r.he_ident}
      </span>
      <span className={styles.rwyLen}>
        {lenM ? `${lenM}m` : '—'}
        {r.length_ft ? ` / ${r.length_ft}ft` : ''}
      </span>
      <span className={styles.rwySurf}>{r.surface}</span>
      {r.closed && <span className={styles.rwyClosed}>CLSD</span>}
    </div>
  );
}

export function AirportPanel({ icao }: AirportPanelProps) {
  const [info,    setInfo]    = useState<AirportInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setInfo(null);
    fetch(`/api/airport?icao=${icao}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setInfo(d);
      })
      .catch(() => setError('Dados do aeródromo indisponíveis'))
      .finally(() => setLoading(false));
  }, [icao]);

  const sortedFreqs = info?.frequencies
    ? [...info.frequencies].sort((a, b) => {
        const ai = FREQ_ORDER.indexOf(a.type);
        const bi = FREQ_ORDER.indexOf(b.type);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
    : [];

  const panelStatus = loading ? 'loading' : error ? 'warn' : 'ok';

  return (
    <Panel
      title="AERÓDROMO"
      subtitle={icao}
      status={panelStatus as 'ok' | 'warn' | 'loading'}
      badge={info?.source && (
        <span className={[styles.sourceBadge, styles[info.source]].join(' ')}>
          {info.source.toUpperCase()}
        </span>
      )}
    >
      {loading && (
        <div className={styles.msg}><span className="spin" /> Carregando…</div>
      )}
      {error && <div className={styles.warn}>⚠ {error}</div>}

      {info && (
        <>
          {info.name && (
            <div className={styles.airportName}>{info.name}</div>
          )}

          {/* Frequências */}
          {sortedFreqs.length > 0 && (
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>COMUNICAÇÕES</h4>
              <div className={styles.freqGrid}>
                {sortedFreqs.map((f, i) => (
                  <FreqRow key={i} f={f} />
                ))}
              </div>
            </section>
          )}

          {/* Pistas */}
          {info.runways.length > 0 && (
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>PISTAS</h4>
              <div className={styles.rwyList}>
                {info.runways
                  .sort((a, b) => b.length_ft - a.length_ft)
                  .map((r, i) => (
                    <RunwayRow key={i} r={r} />
                  ))}
              </div>
            </section>
          )}
        </>
      )}
    </Panel>
  );
}
