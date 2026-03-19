// src/components/briefing/RouteIntelligence.tsx
'use client';
import { useState, useEffect } from 'react';
import styles from './RouteIntelligence.module.css';

interface Threat {
  icon:     string;
  text:     string;
  impact:   string;
  severity: 'low' | 'medium' | 'high';
}

interface IntelligenceData {
  status:          string;
  statusLevel:     'ok' | 'caution' | 'warning' | 'critical';
  riskScore:       number;
  riskLabel:       'BAIXO' | 'MODERADO' | 'ALTO' | 'CRÍTICO';
  threats:         Threat[];
  window: {
    best:              string;
    deterioration:     string;
    hasDetermination:  boolean;
  };
  criticalPoints: { point: string; issue: string }[];
}

interface RouteIntelligenceProps {
  dep: string;
  arr: string;
}

const LEVEL_COLOR = {
  ok:       '#00e676',
  caution:  '#ffab00',
  warning:  '#ff9100',
  critical: '#ff3d3d',
};

const RISK_COLOR = {
  BAIXO:    '#00e676',
  MODERADO: '#ffab00',
  ALTO:     '#ff9100',
  CRÍTICO:  '#ff3d3d',
};

const SEV_COLOR = {
  low:    '#ffab00',
  medium: '#ff9100',
  high:   '#ff3d3d',
};

export function RouteIntelligence({ dep, arr }: RouteIntelligenceProps) {
  const [data,     setData]     = useState<IntelligenceData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!dep || !arr) return;
    setLoading(true); setError(null); setData(null);
    const ctrl = new AbortController();
    fetch(`/api/route-intelligence?dep=${dep}&arr=${arr}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [dep, arr]);


  return (
    <div className={styles.container}>

      {/* ── Loading ── */}
      {loading && (
        <div className={styles.loading}>
          <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
          <span className={styles.loadingText}>Analisando rota…</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className={styles.error}>⚠ {error}</div>
      )}

      {/* ── Dados ── */}
      {data && !loading && (<>

        {/* 1. STATUS — linha grande */}
        <div className={styles.statusBlock}
          style={{ borderColor: LEVEL_COLOR[data.statusLevel], background: `${LEVEL_COLOR[data.statusLevel]}10` }}>
          <span className={styles.statusDot} style={{ background: LEVEL_COLOR[data.statusLevel] }} />
          <span className={styles.statusText}>{data.status}</span>
        </div>

        {/* 2. RISK SCORE — destaque visual */}
        <div className={styles.riskBlock}>
          <div className={styles.riskLeft}>
            <span className={styles.riskLabel}>RISCO</span>
            <span className={styles.riskValue} style={{ color: RISK_COLOR[data.riskLabel] }}>
              {data.riskLabel}
            </span>
          </div>
          <div className={styles.riskBarWrap}>
            <div className={styles.riskBar}>
              <div
                className={styles.riskFill}
                style={{
                  width: `${data.riskScore}%`,
                  background: RISK_COLOR[data.riskLabel],
                  boxShadow: `0 0 8px ${RISK_COLOR[data.riskLabel]}88`,
                }}
              />
            </div>
            <span className={styles.riskScore}>{data.riskScore}/100</span>
          </div>
        </div>

        {/* 3. AMEAÇAS NA ROTA */}
        <div className={styles.section}>
          <span className={styles.sectionLabel}>AMEAÇAS NA ROTA</span>
          {data.threats.length === 0 ? (
            <div className={styles.clear}>✓ Sem ameaças identificadas nas fontes disponíveis</div>
          ) : (
            <ul className={styles.threatList}>
              {data.threats.map((t, i) => (
                <li key={i} className={styles.threatItem}
                  style={{ borderLeft: `3px solid ${SEV_COLOR[t.severity]}` }}>
                  <div className={styles.threatTop}>
                    <span className={styles.threatIcon}>{t.icon}</span>
                    <span className={styles.threatText}>{t.text}</span>
                  </div>
                  {t.impact && (
                    <div className={styles.threatImpact}>
                      <span className={styles.impactLabel}>✈ IMPACTO</span>
                      <span className={styles.impactText}>{t.impact}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 4. JANELA OPERACIONAL */}
        <div className={styles.section}>
          <span className={styles.sectionLabel}>JANELA OPERACIONAL</span>
          <div className={styles.windowGrid}>
            <div className={styles.windowItem}>
              <span className={styles.windowDot} style={{ background: '#00e676' }} />
              <div>
                <span className={styles.windowItemLabel}>MELHOR</span>
                <span className={styles.windowItemVal} style={{ color: '#00e676' }}>{data.window.best}</span>
              </div>
            </div>
            {data.window.hasDetermination && data.window.deterioration && (
              <div className={styles.windowItem}>
                <span className={styles.windowDot} style={{ background: '#ff3d3d' }} />
                <div>
                  <span className={styles.windowItemLabel}>PIORA</span>
                  <span className={styles.windowItemVal} style={{ color: '#ff3d3d' }}>{data.window.deterioration}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 5. PONTOS CRÍTICOS — expansível */}
        {data.criticalPoints.length > 0 && (
          <div className={styles.section}>
            <button className={styles.expandBtn} onClick={() => setExpanded(o => !o)}>
              <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>
                PONTOS CRÍTICOS ({data.criticalPoints.length})
              </span>
              <span className={styles.chevron}>{expanded ? '▲' : '▼'}</span>
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
          Análise IA · REDEMET SIGMET + TAF · Sempre verifique fontes oficiais antes do voo
        </div>
      </>)}
    </div>
  );
}
