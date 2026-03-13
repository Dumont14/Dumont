// src/components/briefing/NotamPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import { parseNotams } from '@/lib/notam';
import type { ParsedNotam } from '@/types';
import styles from './NotamPanel.module.css';

interface NotamPanelProps {
  icao: string;
  showAiSummary?: boolean;
}

const SEV_ICON: Record<string, string> = { crit: '🔴', warn: '🟡', info: '🔵' };

export function NotamPanel({ icao, showAiSummary = true }: NotamPanelProps) {
  const [notams,    setNotams]    = useState<ParsedNotam[]>([]);
  const [aiText,    setAiText]    = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setNotams([]); setAiText(null);

    fetch(`/api/notam?icao=${icao}`)
      .then(r => r.json())
      .then(raw => {
        const parsed = parseNotams(raw);
        setNotams(parsed);

        // AI summary for critical NOTAMs
        if (showAiSummary && parsed.some(n => n.sev === 'crit')) {
          const critTexts = parsed.filter(n => n.sev === 'crit').map(n => n.text).join('\n');
          fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: `You are an aviation briefer. Summarize these critical NOTAMs for ${icao} in 2-3 plain sentences. Be concise and operational. Focus on what affects safety or operations:\n\n${critTexts}`
            }),
          })
            .then(r => r.json())
            .then(d => setAiText(d.text || null))
            .catch(() => null);
        }
      })
      .catch(() => setError('NOTAM fetch failed'))
      .finally(() => setLoading(false));
  }, [icao, showAiSummary]);

  const hasCrit   = notams.some(n => n.sev === 'crit');
  const panelStatus = loading ? 'loading' : error ? 'crit' : hasCrit ? 'crit' : notams.length ? 'warn' : 'ok';

  return (
    <Panel title="NOTAMs" subtitle={icao} status={panelStatus as 'ok' | 'warn' | 'crit' | 'loading'}>
      {loading && <div className={styles.msg}><span className="spin" /> Loading NOTAMs…</div>}
      {error   && <div className={styles.error}>⚠ {error}</div>}

      {!loading && !error && notams.length === 0 && (
        <div className={styles.clear}>✓ No critical NOTAMs found</div>
      )}

      {aiText && (
        <div className={styles.aiBox}>
          <span className={styles.aiLabel}>AI SUMMARY</span>
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
              <span className={styles.sev}>{SEV_ICON[n.sev]}</span>
              <span className={styles.cat}>{n.cat.l}</span>
              <span className={styles.text}>{n.text.substring(0, 90)}{n.text.length > 90 ? '…' : ''}</span>
              <span className={styles.arrow}>{expanded === n.id ? '▲' : '▼'}</span>
            </button>
            {expanded === n.id && (
              <div className={styles.full}>
                <pre className={styles.pre}>{n.text}</pre>
                {(n.from || n.to) && (
                  <div className={styles.validity}>
                    {n.from && <span>FROM: {n.from}</span>}
                    {n.to   && <span>TO: {n.to}</span>}
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
