// src/components/dumont/DumontButton.tsx
'use client';

import { useDumont } from '@/hooks/useDumont';
import styles from './DumontButton.module.css';

interface DumontButtonProps {
  onIcaoDetected?: (dep: string, arr?: string) => void;
}

const STATE_LABEL: Record<string, string> = {
  idle: 'DUMONT', listening: 'OUVINDO…', thinking: 'PROCESSANDO…', speaking: 'FALANDO…',
};

export function DumontButton({ onIcaoDetected }: DumontButtonProps) {
  const { state, result, activate, stop, replay, isSupported } = useDumont();

  // When a result comes in, propagate ICAO to parent
  if (result?.response.icao && onIcaoDetected) {
    onIcaoDetected(result.response.icao, result.response.icao_arr ?? undefined);
  }

  if (!isSupported) return null;

  return (
    <>
      {/* Floating button */}
      <div className={styles.wrap}>
        <button
          className={[styles.btn, styles[state]].join(' ')}
          onClick={state === 'idle' ? activate : stop}
          title="Dumont — Voice Briefing"
          aria-label={`Dumont voice assistant — ${STATE_LABEL[state]}`}
        >
          {state === 'listening' ? (
            <span className={styles.wave} aria-hidden>
              {[0,1,2,3,4].map(i => <span key={i} className={styles.bar} style={{ animationDelay: `${i * 0.1}s` }} />)}
            </span>
          ) : (
            <span className={styles.icon}>🎙</span>
          )}
        </button>
        <span className={[styles.label, styles[state]].join(' ')}>
          {STATE_LABEL[state]}
        </span>
      </div>

      {/* Response bubble */}
      {result && (
        <div className={styles.bubble} role="dialog" aria-label="Dumont briefing response">
          <div className={styles.bubbleHead}>
            <span className={styles.bubbleName}>DUMONT</span>
            <button className={styles.closeBtn} onClick={stop} aria-label="Close">✕</button>
          </div>

          <div className={styles.heard}>
            YOU: <span>{result.heard}</span>
          </div>

          <div className={styles.reply}>
            {result.response.reply}
          </div>

          <div className={styles.footer}>
            <button className={styles.replayBtn} onClick={replay}>▶ REPLAY</button>
            {result.response.icao && (
              <button
                className={styles.briefBtn}
                onClick={() => {
                  onIcaoDetected?.(result.response.icao!, result.response.icao_arr ?? undefined);
                  stop();
                }}
              >
                ⊞ BRIEF {result.response.icao}
                {result.response.icao_arr ? ` → ${result.response.icao_arr}` : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
