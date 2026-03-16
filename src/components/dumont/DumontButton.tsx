// src/components/dumont/DumontButton.tsx
'use client';
import { useDumont } from '@/hooks/useDumont';
import styles from './DumontButton.module.css';

interface DumontButtonProps {
  onIcaoDetected?: (dep: string, arr?: string) => void;
}

const STATE_LABEL: Record<string, string> = {
  idle:      'DUMONT',
  wake:      'AGUARDANDO…',
  listening: 'OUVINDO…',
  thinking:  'PROCESSANDO…',
  speaking:  'FALANDO…',
};

export function DumontButton({ onIcaoDetected }: DumontButtonProps) {
  const { state, result, activate, stop, replay, isSupported, wakeEnabled, toggleWake } = useDumont();

  if (result?.response.icao && onIcaoDetected) {
    onIcaoDetected(result.response.icao, result.response.icao_arr ?? undefined);
  }

  if (!isSupported) return null;

  return (
    <>
      <div className={styles.wrap}>
        {/* Toggle wake word */}
        <button
          className={[styles.wakeToggle, wakeEnabled ? styles.wakeOn : ''].join(' ')}
          onClick={toggleWake}
          title={wakeEnabled ? 'Desativar ativação por voz' : 'Ativar ativação por voz — diga "Dumont"'}
          aria-label={wakeEnabled ? 'Wake word ativa' : 'Wake word inativa'}
        >
          <div className={styles.prohibitedWrap}>
            <span className={styles.icon} style={{ fontSize: '0.9rem' }}>🎙</span>
            {!wakeEnabled && <div className={styles.slash} />}
          </div>
        </button>

        {/* Botão principal */}
        <button
          className={[styles.btn, styles[state]].join(' ')}
          onClick={state === 'idle' || state === 'wake' ? activate : stop}
          title="Dumont — Voice Briefing"
          aria-label={`Dumont — ${STATE_LABEL[state]}`}
        >
          {state === 'listening' ? (
            <span className={styles.wave} aria-hidden>
              {[0,1,2,3,4].map(i => (
                <span key={i} className={styles.bar} style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </span>
          ) : state === 'wake' ? (
            <span className={styles.wakeIcon} aria-hidden>👂</span>
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
            <button className={styles.closeBtn} onClick={stop} aria-label="Fechar">✕</button>
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
