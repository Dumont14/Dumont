// src/components/briefing/AirportPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import type { AirportInfo } from '@/lib/airport';
import type { BriefingMode } from '@/hooks/useBriefingMode';
import styles from './AirportPanel.module.css';

interface AirportPanelProps {
  icao: string;
  mode?: BriefingMode;
}

const FREQ_ORDER = ['ATIS','TWR','APP','GND','DEL','AFIS','RADIO','UNICOM','INFO','COM','TFC'];

function fmtAtsHours(raw: string): { label: string; isOpen: boolean; closingSoon: boolean } | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (!m) return null;
  const open   = parseInt(m[1].slice(0,2)) * 60 + parseInt(m[1].slice(2,4));
  const close  = parseInt(m[2].slice(0,2)) * 60 + parseInt(m[2].slice(2,4));
  const now    = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isOpen      = nowMin >= open && nowMin < close;
  const closingSoon = isOpen && (close - nowMin) <= 60;
  const fmt = (n: number) =>
    `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}Z`;
  const days  = raw.match(/^([A-Z/]+)/)?.[1] || 'DLY';
  return { label: `${days} ${fmt(open)}–${fmt(close)}`, isOpen, closingSoon };
}

export function AirportPanel({ icao, mode = 'pilot' }: AirportPanelProps) {
  const [info,    setInfo]    = useState<AirportInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setInfo(null);
    fetch(`/api/airport?icao=${icao}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setInfo(d); })
      .catch(() => setError('Dados do aeródromo indisponíveis'))
      .finally(() => setLoading(false));
  }, [icao]);

  const sortedFreqs = (info?.frequencies ?? [])
    .filter(f => f.mhz)
    .sort((a, b) => {
      const ai = FREQ_ORDER.indexOf(a.type);
      const bi = FREQ_ORDER.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const ats = info?.ats_hours ? fmtAtsHours(info.ats_hours) : null;
  const panelStatus = loading ? 'loading' : error ? 'warn' : 'ok';

  return (
    <Panel
      title="AERÓDROMO"
      subtitle={`${icao}${info?.source === 'aisweb' ? '' : ' OURAIRPORTS'}`}
      status={panelStatus as 'ok' | 'warn' | 'loading'}
    >
      {loading && <div className={styles.msg}><span className="spin" /> Carregando…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {info && (
        <>
          {/* ── MODO PILOTO ─────────────────────────────── */}
          {mode === 'pilot' && (
            <div className={styles.pilotGrid}>
              {/* ATS hours */}
              {ats && (
                <div className={[
                  styles.pilotAts,
                  !ats.isOpen ? styles.atsClosed : ats.closingSoon ? styles.atsWarn : styles.atsOpen,
                ].join(' ')}>
                  <span>{!ats.isOpen ? '🔴' : ats.closingSoon ? '🟡' : '🟢'}</span>
                  <span className={styles.atsLabel}>ATS</span>
                  <span className={styles.atsVal}>{ats.label}</span>
                  {!ats.isOpen && <span className={styles.atsClosedBadge}>FECHADO</span>}
                </div>
              )}
              {/* Frequências — linha horizontal compacta */}
              {sortedFreqs.length > 0 && (
                <div className={styles.pilotFreqs}>
                  {sortedFreqs.map((f, i) => (
                    <span key={i} className={styles.pilotFreq}>
                      <span className={styles.freqType}>{f.type}</span>
                      <span className={styles.freqMhz}>{f.mhz}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* Pistas — linha compacta */}
              {info.runways.length > 0 && (
                <div className={styles.pilotRwys}>
                  {info.runways.sort((a,b) => b.length_m - a.length_m).map((r, i) => (
                    <span key={i} className={[styles.pilotRwy, r.closed ? styles.rwyClosed : ''].join(' ')}>
                      <span className={styles.rwyIdent}>{r.ident}</span>
                      <span className={styles.rwyLen}>{r.length_m}m</span>
                      <span className={styles.rwySurf}>{r.surface}</span>
                      {r.closed && <span className={styles.rwyClosedBadge}>CLSD</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── MODO COMPLETO ────────────────────────────── */}
          {mode === 'full' && (
            <>
              <div className={styles.header}>
                <span className={styles.airportName}>{info.name}</span>
                {info.city && info.uf && (
                  <span className={styles.location}>{info.city} / {info.uf}</span>
                )}
                <div className={styles.metaRow}>
                  {info.alt_ft   && <span className={styles.meta}>ELEV {info.alt_ft}ft</span>}
                  {info.utc      && <span className={styles.meta}>UTC{info.utc}</span>}
                  {info.type_opr && <span className={styles.meta}>{info.type_opr}</span>}
                </div>
              </div>

              {ats && (
                <div className={[
                  styles.atsRow,
                  !ats.isOpen ? styles.atsClosed : ats.closingSoon ? styles.atsWarn : styles.atsOpen,
                ].join(' ')}>
                  <span>{!ats.isOpen ? '🔴' : ats.closingSoon ? '🟡' : '🟢'}</span>
                  <span className={styles.atsLabel}>SERVIÇO ATS</span>
                  <span className={styles.atsVal}>{ats.label}</span>
                  {!ats.isOpen && <span className={styles.atsClosed}>FECHADO</span>}
                </div>
              )}

              {sortedFreqs.length > 0 && (
                <section className={styles.section}>
                  <h4 className={styles.sectionTitle}>COMUNICAÇÕES</h4>
                  <div className={styles.freqGrid}>
                    {sortedFreqs.map((f, i) => (
                      <div key={i} className={styles.freqRow}>
                        <span className={styles.freqType}>{f.type}</span>
                        <span className={styles.freqMhzFull}>{f.mhz}</span>
                        {f.callsign && f.callsign !== f.type && (
                          <span className={styles.freqDesc}>{f.callsign}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {info.runways.length > 0 && (
                <section className={styles.section}>
                  <h4 className={styles.sectionTitle}>PISTAS</h4>
                  <div className={styles.rwyList}>
                    {info.runways.sort((a,b) => b.length_m - a.length_m).map((r, i) => (
                      <div key={i} className={[styles.rwyRow, r.closed ? styles.rwyClosed : ''].join(' ')}>
                        <span className={styles.rwyIdent}>{r.ident}</span>
                        <span className={styles.rwyLen}>
                          {r.length_m}m
                          {r.tora_le && r.tora_le !== r.length_m ? ` (TORA ${r.tora_le}m)` : ''}
                        </span>
                        <span className={styles.rwyWidth}>{r.width_m}m larg</span>
                        <span className={styles.rwySurf}>{r.surface}</span>
                        {r.closed && <span className={styles.rwyClosedBadge}>CLSD</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {info.fuel && (
                <section className={styles.section}>
                  <h4 className={styles.sectionTitle}>COMBUSTÍVEL</h4>
                  <p className={styles.fuelText}>{info.fuel}</p>
                </section>
              )}

              {info.remarks.length > 0 && (
                <section className={styles.section}>
                  <h4 className={styles.sectionTitle}>OBSERVAÇÕES</h4>
                  <ul className={styles.remarksList}>
                    {info.remarks.map((r, i) => (
                      <li key={i} className={styles.remark}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
