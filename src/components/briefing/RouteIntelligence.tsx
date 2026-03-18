// src/components/briefing/RouteIntelligence.tsx
'use client';
import { useState, useEffect } from 'react';
import styles from './RouteIntelligence.module.css';

interface Threat {
  icon:     string;
  text:     string;
  severity: 'low' | 'medium' | 'high';
}

interface Window {
  best:    string;
  warning: string;
  detail:  string;
}

interface CriticalPoint {
  point: string;
  issue: string;
}

interface IntelligenceData {
  status:         string;
  statusLevel:    'ok' | 'caution' | 'warning' | 'critical';
  threats:        Threat[];
  window:         Window;
  criticalPoints: CriticalPoint[];
}

interface RouteIntelligenceProps {
  dep: string;
  arr: string;
  distance: number;
  heading: number;
}

const STATUS_COLOR = {
  ok:       '#00e676',
  caution:  '#ffab00',
  warning:  '#ff9100',
  critical: '#ff3d3d',
};

const STATUS_BG = {
  ok:       'rgba(0,230,118,.08)',
  caution:  'rgba(255,171,0,.08)',
  warning:  'rgba(255,145,0,.08)',
  critical: 'rgba(255,61,61,.08)',
};

const SEVERITY_COLOR = {
  low:    '#ffab00',
  medium: '#ff9100',
  high:   '#ff3d3d',
};

export function RouteIntelligence({ dep, arr, distance, heading }: RouteIntelligenceProps) {
  const [data,    setData]    = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!dep || !arr) return;
    setLoading(true); setError(null); setData(null);
    const ctrl = new AbortController();

    fetch(`/api/route-intelligence?dep=${dep}&arr=${arr}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [dep, arr]);

  const fmt3 = (deg: number) => String(Math.round(deg)).padStart(3, '0') + '°';

  return (
    <div className={styles.container}>
      {/* ── Header da rota ── */}
      <div className={styles.routeHeader}>
        <div className={styles.routeAd}>
          <span className={styles.adLabel}>DEP</span>
          <span className={styles.adIcao}>{dep}</span>
        </div>
        <div className={styles.routeMeta}>
          <span className={styles.routeArrow}>→</span>
          <span className={styles.routeInfo}>{fmt3(heading)} · {distance} NM</span>
        </div>
        <div className={styles.routeAd}>
          <span className={styles.adLabel}>ARR</span>
          <span className={styles.adIcao}>{arr}</span>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingText}>Analisando rota…</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className={styles.error}>⚠ {error}</div>
      )}

      {/* ── Dados ── */}
      {data && !loading && (
        <>
          {/* 1. STATUS */}
          <div
            className={styles.statusBar}
            style={{
              borderColor: STATUS_COLOR[data.statusLevel],
              background:  STATUS_BG[data.statusLevel],
            }}>
            <span
              className={styles.statusDot}
              style={{ background: STATUS_COLOR[data.statusLevel] }}
            />
            <span className={styles.statusText}>{data.status}</span>
          </div>

          {/* 2. AMEAÇAS */}
          {data.threats.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>AMEAÇAS NA ROTA</span>
              <ul className={styles.threatList}>
                {data.threats.map((t, i) => (
                  <li key={i} className={styles.threatItem}>
                    <span className={styles.threatIcon}>{t.icon}</span>
                    <span
                      className={styles.threatText}
                      style={{ borderLeft: `2px solid ${SEVERITY_COLOR[t.severity]}` }}>
                      {t.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.threats.length === 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>AMEAÇAS NA ROTA</span>
              <div className={styles.clear}>✓ Sem ameaças identificadas</div>
            </div>
          )}

          {/* 3. JANELA OPERACIONAL */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>JANELA OPERACIONAL</span>
            <div className={styles.windowBox}>
              <div className={styles.windowBest}>
                <span className={styles.windowBestLabel}>MELHOR</span>
                <span className={styles.windowBestVal}>{data.window.best}</span>
              </div>
              {data.window.warning && (
                <div className={styles.windowWarn}>⚠ {data.window.warning}</div>
              )}
              <div className={styles.windowDetail}>{data.window.detail}</div>
            </div>
          </div>

          {/* 4. PONTOS CRÍTICOS — expansível */}
          {data.criticalPoints.length > 0 && (
            <div className={styles.section}>
              <button
                className={styles.expandBtn}
                onClick={() => setExpanded(o => !o)}>
                <span className={styles.sectionLabel}>PONTOS CRÍTICOS</span>
                <span className={styles.expandIcon}>{expanded ? '▲' : '▼'}</span>
              </button>
              {expanded && (
                <ul className={styles.critList}>
                  {data.criticalPoints.map((cp, i) => (
                    <li key={i} className={styles.critItem}>
                      <span className={styles.critPoint}>{cp.point}</span>
                      <span className={styles.critIssue}>{cp.issue}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={styles.footer}>
            Análise gerada por IA · Fontes: REDEMET SIGMET + TAF · Verifique sempre as fontes oficiais
          </div>
        </>
      )}
    </div>
  );
}
