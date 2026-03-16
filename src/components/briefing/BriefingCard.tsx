// src/components/briefing/BriefingCard.tsx
'use client';
import { useState, useEffect } from 'react';
import { decodeMetar, getFlightCategory } from '@/lib/weather/metar';
import { parseTaf } from '@/lib/weather';
import { parseNotams, extractAtsHours } from '@/lib/notam';
import { useSunTimes } from '@/hooks/useSunTimes';
import type { ParsedNotamEx, AtsHours } from '@/types';
import type { ParsedTaf } from '@/lib/weather';
import styles from './BriefingCard.module.css';

interface BriefingCardProps {
  icao: string;
  label?: 'DEP' | 'ARR';
}

// ── helpers ──────────────────────────────────────────────

function fmtMin(min: number) {
  return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}Z`;
}

function catColor(cat: string | null) {
  if (!cat) return '';
  return { VMC: styles.catVmc, MVFR: styles.catMvfr, IFR: styles.catIfr, LIFR: styles.catLifr }[cat] ?? '';
}

function AtsStatus({ ats }: { ats: AtsHours }) {
  const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const icon   = !ats.isOpen ? '🔴' : ats.closingSoon ? '🟡' : '🟢';
  const cls    = !ats.isOpen ? styles.atsClosed : ats.closingSoon ? styles.atsWarn : styles.atsOpen;
  return (
    <span className={[styles.atsChip, cls].join(' ')}>
      {icon} ATS {fmtMin(ats.open)}–{fmtMin(ats.close)}
      {!ats.isOpen && ' · FECHADO'}
      {ats.closingSoon && ` · fecha em ${ats.close - nowMin}min`}
    </span>
  );
}

// ── componente principal ──────────────────────────────────

export function BriefingCard({ icao, label }: BriefingCardProps) {
  const [metarRaw,  setMetarRaw]  = useState<string | null>(null);
  const [obsType,   setObsType]   = useState<'METAR'|'SPECI'>('METAR');
  const [tafRaw,    setTafRaw]    = useState<string | null>(null);
  const [notams,    setNotams]    = useState<ParsedNotamEx[]>([]);
  const [airport,   setAirport]   = useState<any>(null);
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState(false);
  const [notamOpen, setNotamOpen] = useState<string | null>(null);

  const sun = useSunTimes(icao);

  useEffect(() => {
    setLoading(true);
    setMetarRaw(null); setTafRaw(null); setNotams([]); setAirport(null);

    Promise.allSettled([
      fetch(`/api/metar?icao=${icao}`).then(r => r.json()),
      fetch(`/api/taf?icao=${icao}`).then(r => r.json()),
      fetch(`/api/notam?icao=${icao}`).then(r => r.json()),
      fetch(`/api/airport?icao=${icao}`).then(r => r.json()),
    ]).then(([m, t, n, a]) => {
      if (m.status === 'fulfilled' && !m.value.error) {
        setMetarRaw(m.value.metar);
        setObsType(m.value.type ?? 'METAR');
      }
      if (t.status === 'fulfilled' && !t.value.error) setTafRaw(t.value.taf);
      if (n.status === 'fulfilled') {
        try { setNotams(parseNotams(n.value)); } catch {}
      }
      if (a.status === 'fulfilled' && !a.value.error) setAirport(a.value);
    }).finally(() => setLoading(false));
  }, [icao]);

  const decoded  = metarRaw ? decodeMetar(metarRaw) : null;
  const cat      = decoded  ? getFlightCategory(decoded) : null;
  const taf      = tafRaw   ? parseTaf(tafRaw) : null;
  const ats      = extractAtsHours(notams);
  const critNotams = notams.filter(n => n.sev === 'crit');
  const warnNotams = notams.filter(n => n.sev === 'warn');
  const hasNotamAlert = critNotams.length > 0 || warnNotams.length > 0;

  // Status geral do card
  const cardStatus = !cat ? 'loading'
    : critNotams.length > 0 || cat === 'IFR' || cat === 'LIFR' || (taf?.hasAdverse) ? 'alert'
    : cat === 'MVFR' || warnNotams.length > 0 ? 'warn'
    : 'ok';

  // TAF: só alertas adversos resumidos
  const tafAdverse = taf?.periods.filter(p => p.adverse.length > 0) ?? [];

  // Frequências ordenadas
  const FREQ_ORDER = ['ATIS','TWR','APP','GND','DEL','AFIS','RADIO','UNICOM','TFC'];
  const freqs = (airport?.frequencies ?? [])
    .filter((f: any) => f.mhz)
    .sort((a: any, b: any) => {
      const ai = FREQ_ORDER.indexOf(a.type);
      const bi = FREQ_ORDER.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const runways = airport?.runways ?? [];

  return (
    <div className={[styles.card, styles[`status_${cardStatus}`]].join(' ')}>

      {/* ── HEADER ─────────────────────────────────── */}
      <div className={styles.cardHeader}>
        <div className={styles.icaoRow}>
          {label && <span className={styles.label}>{label}</span>}
          <span className={styles.icao}>{icao}</span>
          {airport?.name && (
            <span className={styles.adName}>— {airport.name}</span>
          )}
          {cat && (
            <span className={[styles.catBadge, catColor(cat)].join(' ')}>{cat}</span>
          )}
          {obsType === 'SPECI' && (
            <span className={styles.speciBadge}>SPECI</span>
          )}
        </div>
        <div className={styles.subRow}>
          {airport?.city && airport?.uf && (
            <span className={styles.cityUf}>{airport.city}, {airport.uf}</span>
          )}
          {(sun.sunrise || sun.sunset) && (
            <span className={styles.sunRow}>
              {sun.sunrise && <span>↑{sun.sunrise}</span>}
              {sun.sunset  && <span>↓{sun.sunset}</span>}
            </span>
          )}
        </div>
      </div>

      {/* ── LOADING ────────────────────────────────── */}
      {loading && (
        <div className={styles.loadingRow}>
          <span className="spin" /> Carregando briefing…
        </div>
      )}

      {!loading && (
        <>
          {/* ── METAR ──────────────────────────────── */}
          {decoded && (
            <div className={styles.metarRow}>
              {decoded.wdir && (
                <span className={styles.metItem}>
                  <span className={styles.metLabel}>VENTO</span>
                  {decoded.wdir} {decoded.wspdS}
                  {decoded.wgust && <span className={styles.gust}> {decoded.wgust}</span>}
                </span>
              )}
              <span className={[
                styles.metItem,
                decoded.cavok ? styles.ok
                  : parseInt(decoded.vis||'0') < 1500 ? styles.crit : styles.warn
              ].join(' ')}>
                <span className={styles.metLabel}>VIS</span>
                {decoded.cavok ? 'CAVOK' : `${decoded.vis}m`}
              </span>
              <span className={[
                styles.metItem,
                decoded.ceil && decoded.ceil < 500 ? styles.crit
                  : decoded.ceil && decoded.ceil < 1500 ? styles.warn : styles.ok
              ].join(' ')}>
                <span className={styles.metLabel}>TETO</span>
                {decoded.cavok ? 'CAVOK' : decoded.ceil != null ? `${decoded.ceil}ft` : 'CLEAR'}
              </span>
              {decoded.wx && (
                <span className={[styles.metItem, styles.crit].join(' ')}>
                  <span className={styles.metLabel}>TEMPO</span>
                  {decoded.wx}
                </span>
              )}
              <span className={styles.metItem}>
                <span className={styles.metLabel}>QNH</span>
                {decoded.qnh || '—'}
              </span>
            </div>
          )}

          {/* ── TAF ────────────────────────────────── */}
          <div className={styles.tafRow}>
            <span className={styles.sectionLabel}>TAF</span>
            {!taf && <span className={styles.dimText}>— não disponível</span>}
            {taf && tafAdverse.length === 0 && (
              <span className={styles.okText}>✓ Sem condições adversas previstas</span>
            )}
            {taf && tafAdverse.length > 0 && (
              <div className={styles.tafAlerts}>
                {tafAdverse.map((p, i) => {
                  const validity = p.from && p.to
                    ? `${p.from.slice(2,4)}:${p.from.slice(4)||'00'}Z→${p.to.slice(2,4)}:${p.to.slice(4)||'00'}Z`
                    : '';
                  return (
                    <div key={i} className={styles.tafAlert}>
                      <span className={styles.tafType}>{p.type}</span>
                      {validity && <span className={styles.tafTime}>{validity}</span>}
                      {p.adverse.map((a, j) => (
                        <span key={j} className={styles.adverseBadge}>{a}</span>
                      ))}
                      {p.wind && <span className={styles.tafDetail}>{p.wind}</span>}
                      {p.vis && p.vis !== '9999' && (
                        <span className={styles.tafDetail}>
                          VIS {p.vis.includes('SM') ? p.vis : `${p.vis}m`}
                        </span>
                      )}
                      {p.clouds.filter(c => c !== 'CAVOK').map((c, j) => (
                        <span key={j} className={[
                          styles.tafDetail,
                          /CB|TCU/i.test(c) ? styles.crit : ''
                        ].join(' ')}>{c}</span>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── NOTAMs ─────────────────────────────── */}
          <div className={styles.notamRow}>
            <span className={styles.sectionLabel}>NOTAMs</span>
            {notams.length === 0 && (
              <span className={styles.okText}>✓ Sem NOTAMs relevantes</span>
            )}
            {notams.length > 0 && !hasNotamAlert && (
              <span className={styles.dimText}>{notams.length} informativo(s)</span>
            )}
            {critNotams.map(n => (
              <div key={n.id} className={styles.notamCrit}>
                <button
                  className={styles.notamBtn}
                  onClick={() => setNotamOpen(notamOpen === n.id ? null : n.id)}
                >
                  <span className={styles.notamCritBadge}>CRIT</span>
                  <span className={styles.notamCat}>{n.cat.l}</span>
                  {n.notamNum && n.notamNum !== '?' && (
                    <span className={styles.notamNum}>{n.notamNum}</span>
                  )}
                  <span className={styles.notamText}>
                    {n.text.substring(0, 55)}{n.text.length > 55 ? '…' : ''}
                  </span>
                  <span className={styles.notamArrow}>{notamOpen === n.id ? '▲' : '▼'}</span>
                </button>
                {notamOpen === n.id && (
                  <div className={styles.notamExpanded}>
                    <pre className={styles.notamPre}>{n.text}</pre>
                    {n.schedule && (
                      <div className={[
                        styles.schedLine,
                        n.schedule.closedNow ? styles.schedClosed : styles.schedOpen
                      ].join(' ')}>
                        {n.schedule.closedNow ? '🔴 FECHADO AGORA' : '🟢 ABERTO AGORA'}
                        {' · '}{n.schedule.nextChange}
                        {' · Fechado: '}<strong>{n.schedule.closedPeriod}</strong>
                      </div>
                    )}
                    {(n.validFrom || n.validTo) && (
                      <div className={styles.notamValidity}>
                        {n.validFrom && <span>DE: {n.validFrom}</span>}
                        {n.validTo   && <span>ATÉ: {n.validTo}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {warnNotams.length > 0 && critNotams.length === 0 && (
              <span className={styles.warnText}>
                ⚠ {warnNotams.length} NOTAM(s) de atenção
              </span>
            )}
          </div>

          {/* ── ATS + FREQ + PISTAS ─────────────────── */}
          <div className={styles.infraRow}>
            {ats && <AtsStatus ats={ats} />}
            {!ats && airport?.ats_hours && (
              <span className={styles.atsChip + ' ' + styles.atsOpen}>
                🟢 ATS {airport.ats_hours}
              </span>
            )}
            {freqs.map((f: any, i: number) => (
              <span key={i} className={styles.freqChip}>
                <span className={styles.freqType}>{f.type}</span>
                <span className={styles.freqMhz}>{f.mhz}</span>
              </span>
            ))}
            {runways.sort((a: any, b: any) => b.length_m - a.length_m).map((r: any, i: number) => (
              <span key={i} className={[styles.rwyChip, r.closed ? styles.rwyClosed : ''].join(' ')}>
                {r.ident} {r.length_m}m {r.surface}
                {r.closed && ' CLSD'}
              </span>
            ))}
          </div>

          {/* ── BOTÃO VER DETALHES ──────────────────── */}
          <button
            className={styles.detailsBtn}
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? '▲ RESUMO' : '▼ VER DETALHES'}
          </button>

          {/* ── DETALHES EXPANDIDOS ─────────────────── */}
          {expanded && (
            <div className={styles.detailsSection}>
              {/* METAR raw */}
              {metarRaw && (
                <div className={styles.detailBlock}>
                  <span className={styles.detailTitle}>{obsType} BRUTO</span>
                  <pre className={styles.rawPre}>{metarRaw}</pre>
                </div>
              )}
              {/* TAF completo */}
              {taf && (
                <div className={styles.detailBlock}>
                  <span className={styles.detailTitle}>TAF COMPLETO</span>
                  <pre className={styles.rawPre}>{taf.raw}</pre>
                </div>
              )}
              {/* Todos NOTAMs */}
              {notams.length > 0 && (
                <div className={styles.detailBlock}>
                  <span className={styles.detailTitle}>TODOS OS NOTAMs</span>
                  {notams.map(n => (
                    <div key={n.id} className={[styles.notamFull, styles[`sev_${n.sev}`]].join(' ')}>
                      <div className={styles.notamFullHead}>
                        <span className={styles[`badge_${n.sev}`]}>{n.sev.toUpperCase()}</span>
                        <span className={styles.notamCat}>{n.cat.l}</span>
                        {n.notamNum && n.notamNum !== '?' && (
                          <span className={styles.notamNum}>{n.notamNum}</span>
                        )}
                      </div>
                      <pre className={styles.notamPre}>{n.text}</pre>
                      {n.schedule && (
                        <div className={[
                          styles.schedLine,
                          n.schedule.closedNow ? styles.schedClosed : styles.schedOpen
                        ].join(' ')}>
                          {n.schedule.closedNow ? '🔴 FECHADO AGORA' : '🟢 ABERTO AGORA'}
                          {' · '}{n.schedule.nextChange}
                          {' · '}<strong>{n.schedule.closedPeriod}</strong>
                        </div>
                      )}
                      {(n.validFrom || n.validTo) && (
                        <div className={styles.notamValidity}>
                          {n.validFrom && <span>DE: {n.validFrom}</span>}
                          {n.validTo   && <span>ATÉ: {n.validTo}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Observações do aeródromo */}
              {airport?.remarks?.length > 0 && (
                <div className={styles.detailBlock}>
                  <span className={styles.detailTitle}>OBSERVAÇÕES DO AD</span>
                  <ul className={styles.remarksList}>
                    {airport.remarks.map((r: string, i: number) => (
                      <li key={i} className={styles.remark}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {airport?.fuel && (
                <div className={styles.detailBlock}>
                  <span className={styles.detailTitle}>COMBUSTÍVEL</span>
                  <p className={styles.fuelText}>{airport.fuel}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
