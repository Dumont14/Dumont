// src/components/briefing/NotamPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel }       from '@/components/ui/Panel';
import { parseNotams, extractAtsHours } from '@/lib/notam';
import type { ParsedNotamEx, NotamSeverity, AtsHours } from '@/types';
import styles from './NotamPanel.module.css';

interface NotamPanelProps {
  icao: string;
  showAiSummary?: boolean;
}

const SEV_LABEL: Record<NotamSeverity, string> = {
  crit: 'CRIT', warn: 'WARN', info: 'INFO',
};

function fmtMin(min: number): string {
  return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}Z`;
}

// ── Caixa de Horário ATS ──────────────────────────────
function AtsBox({ ats }: { ats: AtsHours }) {
  const cls  = ats.isH24 ? styles.atsH24
    : !ats.isOpen        ? styles.atsClosed
    : ats.closingSoon    ? styles.atsWarn
    : styles.atsOpen;
  const icon = ats.isH24 ? '🟢'
    : !ats.isOpen        ? '🔴'
    : ats.closingSoon    ? '🟡'
    : '🟢';
  const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();

  return (
    <div className={[styles.atsBox, cls].join(' ')}>
      <span className={styles.atsIcon}>{icon}</span>
      <div className={styles.atsInfo}>
        <span className={styles.atsLabel}>SERVIÇO ATS</span>
        {ats.isH24 ? (
          <span className={styles.atsStatus}>H24 — Operação contínua</span>
        ) : !ats.isOpen ? (
          <span className={styles.atsStatus}>
            FECHADO — Abre {ats.opensIn !== undefined ? `em ${ats.opensIn}min` : `às ${fmtMin(ats.open)}`}
            {' '}· Solicite extensão ao órgão ATS
          </span>
        ) : ats.closingSoon ? (
          <span className={styles.atsStatus}>
            Encerra às {fmtMin(ats.close)} · {ats.close - nowMin}min restantes
          </span>
        ) : (
          <span className={styles.atsStatus}>{fmtMin(ats.open)} – {fmtMin(ats.close)}</span>
        )}
      </div>
    </div>
  );
}

// ── Caixa de Schedule do NOTAM (campo <d>) ────────────
function ScheduleBox({ n }: { n: ParsedNotamEx }) {
  const s = n.schedule;
  if (!s) return null;
  return (
    <div className={[styles.schedBox, s.closedNow ? styles.schedClosed : styles.schedOpen].join(' ')}>
      <div className={styles.schedTop}>
        <span className={styles.schedIcon}>{s.closedNow ? '🔴' : '🟢'}</span>
        <span className={styles.schedStatus}>
          {s.closedNow ? 'FECHADO AGORA' : 'ABERTO AGORA'}
        </span>
        <span className={styles.schedNext}>{s.nextChange}</span>
      </div>
      <div className={styles.schedDetail}>
        <span className={styles.schedPeriod}>
          Fechado: <strong>{s.closedPeriod}</strong>
        </span>
        <span className={styles.schedOpenLabel}>{s.openPeriod}</span>
      </div>
    </div>
  );
}

export function NotamPanel({ icao, showAiSummary = true }: NotamPanelProps) {
  const [notams,   setNotams]   = useState<ParsedNotamEx[]>([]);
  const [aiText,   setAiText]   = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setNotams([]); setAiText(null);
    fetch(`/api/notam?icao=${icao}`)
      .then(r => r.json())
      .then(raw => {
        const parsed = parseNotams(raw);
        setNotams(parsed);
        if (showAiSummary && parsed.some(n => n.sev === 'crit')) {
          const critTexts = parsed.filter(n => n.sev === 'crit').map(n => n.text).join('\n');
          fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: `Você é um briefer de aviação. Resuma em 2-3 frases curtas e operacionais os NOTAMs críticos abaixo para ${icao}. Foque apenas no que afeta segurança ou operações:\n\n${critTexts}`
            }),
          })
            .then(r => r.json())
            .then(d => setAiText(d.text || null))
            .catch(() => null);
        }
      })
      .catch(err => {
        console.error('NOTAM Error:', err);
        setError(err instanceof Error ? err.message : 'Falha ao buscar NOTAMs');
      })
      .finally(() => setLoading(false));
  }, [icao, showAiSummary]);

  const hasCrit = notams.some(n => n.sev === 'crit');
  const hasWarn = notams.some(n => n.sev === 'warn');
  const ats     = extractAtsHours(notams);

  const panelStatus = loading ? 'loading'
    : error   ? 'crit'
    : hasCrit ? 'crit'
    : hasWarn ? 'warn'
    : 'ok';

  return (
    <Panel
      title="NOTAMs"
      subtitle={icao}
      status={panelStatus as 'ok' | 'warn' | 'crit' | 'loading'}
    >
      {loading && <div className={styles.msg}><span className="spin" /> Buscando NOTAMs…</div>}
      {error   && <div className={styles.error}>⚠ {error}</div>}

      {ats && <AtsBox ats={ats} />}

      {!loading && !error && notams.length === 0 && (
        <div className={styles.clear}>✓ Sem NOTAMs relevantes</div>
      )}

      {aiText && (
        <div className={styles.aiBox}>
          <span className={styles.aiLabel}>DUMONT IA</span>
          <p>{aiText}</p>
        </div>
      )}

      <ul className={styles.list}>
        {notams.map(n => (
          <li key={n.id} className={[styles.item, styles[n.sev]].join(' ')}>
            <button
              className={styles.itemHead}
              onClick={() => setExpanded(expanded === n.id ? null : n.id)}
            >
              <span className={[styles.sevBadge, styles[`sev_${n.sev}`]].join(' ')}>
                {SEV_LABEL[n.sev]}
              </span>
              <span className={styles.cat}>{n.cat.l}</span>
              <span className={styles.preview}>
                {n.text.substring(0, 80)}{n.text.length > 80 ? '…' : ''}
              </span>
              <span className={styles.arrow}>{expanded === n.id ? '▲' : '▼'}</span>
            </button>

            {expanded === n.id && (
              <div className={styles.full}>
                {/* Número do NOTAM */}
                {n.notamNum && n.notamNum !== '?' && (
                  <div className={styles.notamHeader}>
                    <span className={styles.notamNum}>{n.notamNum}</span>
                  </div>
                )}

                {/* Texto completo */}
                <pre className={styles.pre}>{n.text}</pre>

                {/* Schedule operacional — aberto/fechado agora */}
                <ScheduleBox n={n} />

                {/* Validade */}
                {(n.validFrom || n.validTo) && (
                  <div className={styles.validity}>
                    {n.validFrom && <span>DE: {n.validFrom}</span>}
                    {n.validTo   && <span>ATÉ: {n.validTo}</span>}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
