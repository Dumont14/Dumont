// src/components/briefing/TafPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel }    from '@/components/ui/Panel';
import { parseTaf } from '@/lib/weather';
import type { ParsedTaf, TafPeriod } from '@/lib/weather';
import type { BriefingMode } from '@/hooks/useBriefingMode';
import styles from './TafPanel.module.css';

interface TafPanelProps {
  icao: string;
  mode?: BriefingMode;
}

const CAT_CLASS: Record<string, string> = {
  VMC: 'catVmc', MVFR: 'catMvfr', IFR: 'catIfr', LIFR: 'catLifr',
};

const PERIOD_LABEL: Record<string, string> = {
  BASE: 'BASE', BECMG: 'BECMG', TEMPO: 'TEMPO', PROB: 'PROB', FM: 'FM',
};

function fmtValidity(from: string, to: string): string {
  const fmtGroup = (g: string) => {
    if (!g || g.length < 4) return g;
    if (g.length === 6) return `${g.slice(2,4)}:${g.slice(4,6)}Z`;
    return `D${g.slice(0,2)} ${g.slice(2,4)}:00Z`;
  };
  if (!from && !to) return '';
  if (!to) return fmtGroup(from);
  return `${fmtGroup(from)} → ${fmtGroup(to)}`;
}

function PeriodRow({ p }: { p: TafPeriod }) {
  const catCls    = p.cat ? styles[CAT_CLASS[p.cat]] : '';
  const isAdverse = p.adverse.length > 0;

  return (
    <div className={[styles.period, isAdverse ? styles.periodAdverse : ''].join(' ')}>
      <div className={styles.periodHead}>
        <span className={[styles.periodType, isAdverse ? styles.periodTypeAdverse : ''].join(' ')}>
          {p.prob ? `PROB${p.prob} ` : ''}{PERIOD_LABEL[p.type]}
        </span>
        {p.cat && <span className={[styles.catBadge, catCls].join(' ')}>{p.cat}</span>}
        <span className={styles.validity}>{fmtValidity(p.from, p.to)}</span>
      </div>
      {isAdverse && (
        <div className={styles.adverseRow}>
          {p.adverse.map((a, i) => <span key={i} className={styles.adverseBadge}>{a}</span>)}
        </div>
      )}
      <div className={styles.periodDetail}>
        {p.wind && <span className={styles.detail}><span className={styles.detailLabel}>VENTO</span>{p.wind}</span>}
        {p.vis  && (
          <span className={[styles.detail, parseInt(p.vis) < 5000 && p.vis !== '9999' ? styles.detailWarn : ''].join(' ')}>
            <span className={styles.detailLabel}>VIS</span>
            {p.vis === '9999' ? '≥10KM' : p.vis.includes('SM') ? p.vis : `${p.vis}M`}
          </span>
        )}
        {p.wx && <span className={[styles.detail, styles.detailWx].join(' ')}><span className={styles.detailLabel}>TEMPO</span>{p.wx}</span>}
        {p.clouds.filter(c => c !== 'CAVOK').map((c, i) => (
          <span key={i} className={[styles.detail, /CB|TCU/i.test(c) ? styles.detailCrit : ''].join(' ')}>
            <span className={styles.detailLabel}>NUV</span>{c}
          </span>
        ))}
        {p.clouds.includes('CAVOK') && (
          <span className={styles.detail}><span className={styles.detailLabel}>VIS</span>CAVOK</span>
        )}
      </div>
    </div>
  );
}

export function TafPanel({ icao, mode = 'pilot' }: TafPanelProps) {
  const [raw,     setRaw]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setRaw(null);
    fetch(`/api/taf?icao=${icao}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setRaw(d.taf); })
      .catch(() => setError('Falha ao buscar TAF'))
      .finally(() => setLoading(false));
  }, [icao]);

  const parsed: ParsedTaf | null = raw ? parseTaf(raw) : null;
  const hasAdverse = parsed?.hasAdverse ?? false;

  const panelStatus = loading ? 'loading' : error ? 'warn' : hasAdverse ? 'crit' : 'ok';

  // MODO PILOTO — só mostrar se tiver condição adversa
  // Se não tiver adverso, mostrar uma linha simples
  if (mode === 'pilot' && !loading && !error && parsed && !hasAdverse) {
    return (
      <Panel title="TAF" subtitle={icao} status="ok">
        <div className={styles.pilotClear}>✓ Sem condições adversas previstas no TAF</div>
      </Panel>
    );
  }

  return (
    <Panel title="TAF" subtitle={icao} status={panelStatus as 'ok' | 'warn' | 'crit' | 'loading'}>
      {loading && <div className={styles.msg}><span className="spin" /> Buscando TAF…</div>}
      {error   && <div className={styles.warn}>⚠ {error}</div>}

      {!loading && !error && !parsed && (
        <div className={styles.clear}>— TAF não disponível</div>
      )}

      {parsed && (
        <>
          {/* MODO PILOTO — só períodos adversos */}
          {mode === 'pilot' && (
            <>
              <div className={styles.tafHeader}>
                <span className={styles.tafIssued}>Emitido: {parsed.issued}</span>
                <span className={styles.tafValid}>
                  Válido: D{parsed.validFrom.slice(0,2)} {parsed.validFrom.slice(2)}:00Z →
                  D{parsed.validTo.slice(0,2)} {parsed.validTo.slice(2)}:00Z
                </span>
              </div>
              <div className={styles.periods}>
                {parsed.periods
                  .filter(p => p.adverse.length > 0)
                  .map((p, i) => <PeriodRow key={i} p={p} />)}
              </div>
            </>
          )}

          {/* MODO COMPLETO — tudo */}
          {mode === 'full' && (
            <>
              <div className={styles.tafHeader}>
                <span className={styles.tafIssued}>Emitido: {parsed.issued}</span>
                <span className={styles.tafValid}>
                  Válido: D{parsed.validFrom.slice(0,2)} {parsed.validFrom.slice(2)}:00Z →
                  D{parsed.validTo.slice(0,2)} {parsed.validTo.slice(2)}:00Z
                </span>
              </div>
              {!hasAdverse && <div className={styles.clear}>✓ Sem condições adversas previstas</div>}
              <div className={styles.periods}>
                {parsed.periods.map((p, i) => <PeriodRow key={i} p={p} />)}
              </div>
              <details className={styles.rawDetails}>
                <summary className={styles.rawSummary}>TAF BRUTO</summary>
                <pre className={styles.rawPre}>{parsed.raw}</pre>
              </details>
            </>
          )}
        </>
      )}
    </Panel>
  );
}
