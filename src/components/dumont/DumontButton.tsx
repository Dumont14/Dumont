// src/components/dumont/DumontButton.tsx
'use client';

import { useEffect } from 'react';
import { useDumont } from '@/hooks/useDumont';
import styles from './DumontButton.module.css';

interface DumontButtonProps {
  onIcaoDetected?:      (dep: string, arr?: string) => void;
  onBubbleStateChange?: (isOpen: boolean) => void;
}

const STATE_LABEL: Record<string, string> = {
  idle:      'DUMONT',
  wake:      'AGUARDANDO…',
  listening: 'OUVINDO…',
  thinking:  'PROCESSANDO…',
  speaking:  'FALANDO…',
};

export function DumontButton({ onIcaoDetected, onBubbleStateChange }: DumontButtonProps) {
  const {
    state, result,
    activate, stop, clearResult, replay,
    isSupported, wakeEnabled, toggleWake,
  } = useDumont();

  // Notifica parent quando bubble abre/fecha.
  // FIX: agora reflete corretamente porque result vira null ao fechar.
  useEffect(() => {
    onBubbleStateChange?.(!!result);
  }, [result, onBubbleStateChange]);

  // Dispara onIcaoDetected apenas uma vez quando result chega com ICAO.
  useEffect(() => {
    if (result?.response.icao && onIcaoDetected) {
      onIcaoDetected(
        result.response.icao,
        result.response.icao_arr ?? undefined,
      );
    }
  }, [result]); // eslint-disable-line

  if (!isSupported) return null;

  const handleBtnClick = () => {
    if (!wakeEnabled) {
      toggleWake();
      return;
    }
    if (state === 'idle' || state === 'wake') {
      activate();
    } else {
      stop();
    }
  };

  // FIX: X fecha apenas a bubble; se wake estiver ativo, mantém escuta.
  // Usa clearResult (não stop) para não derrubar o wake word listener.
  const handleCloseBubble = () => {
    clearResult();
    // Se estava falando, para a síntese de voz também
    if (typeof window !== 'undefined') {
      window.speechSynthesis?.cancel();
    }
  };

  return (
    <>
      <div className={styles.wrap}>
        <button
          className={[styles.btn, styles[state]].join(' ')}
          onClick={handleBtnClick}
          title={
            !wakeEnabled
              ? 'Ativar escuta (Dumont)'
              : state === 'listening'
                ? 'Parar'
                : 'Dumont — Ativar'
          }
          aria-label={`Dumont — ${STATE_LABEL[state]}`}
        >
          {state === 'listening' ? (
            <span className={styles.wave} aria-hidden>
              {[0,1,2,3,4].map(i => (
                <span
                  key={i}
                  className={styles.bar}
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </span>
          ) : (
            <div className={styles.prohibitedWrap}>
              <span className={styles.icon}>{state === 'wake' ? '👂' : '🎙'}</span>
              {!wakeEnabled && <div className={styles.slash} />}
            </div>
          )}
        </button>
        <span className={[styles.label, styles[state]].join(' ')}>
          {STATE_LABEL[state]}
        </span>
      </div>

      {/* Bubble — só aparece quando há result */}
      {result && (
        <div className={styles.bubble} role="dialog" aria-label="Dumont briefing response">
          <div className={styles.bubbleHead}>
            <span className={styles.bubbleName}>DUMONT</span>
            {/* FIX: usa clearResult para fechar sem travar campos */}
            <button
              className={styles.closeBtn}
              onClick={handleCloseBubble}
              aria-label="Fechar"
              type="button"
            >
              ✕
            </button>
          </div>

          <div className={styles.heard}>
            YOU: <span>{result.heard}</span>
          </div>

          <div className={styles.reply}>
            {result.response.reply}
          </div>

          <div className={styles.footer}>
            <button className={styles.replayBtn} onClick={replay}>
              ▶ REPLAY
            </button>
            {result.response.icao && (
              <button
                className={styles.briefBtn}
                onClick={() => {
                  onIcaoDetected?.(
                    result.response.icao!,
                    result.response.icao_arr ?? undefined,
                  );
                  // FIX: fecha bubble após brief — libera campos DEP/ARR
                  clearResult();
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
