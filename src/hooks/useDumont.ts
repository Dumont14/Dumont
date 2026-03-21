// src/hooks/useDumont.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { playChime } from '@/lib/voice/chime';
import type { VoiceResponse } from '@/types';

export type DumontState = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking';

interface DumontResult {
  heard: string;
  response: VoiceResponse;
}

interface UseDumontReturn {
  state:        DumontState;
  result:       DumontResult | null;
  activate:     () => void;
  stop:         () => void;
  clearResult:  () => void;
  replay:       () => void;
  isSupported:  boolean;
  wakeEnabled:  boolean;
  toggleWake:   () => void;
}

// Variações fonéticas que o browser pode transcrever para "Dumont"
const WAKE_PATTERNS = [
  'dumont', 'du mont', 'dumon', 'dumonte', 'dumund',
  'du mond', 'dimon', 'domon', 'demon', 'duman',
];

function matchesWakeWord(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return WAKE_PATTERNS.some(p => normalized.includes(p));
}

export function useDumont(): UseDumontReturn {
  const [state,       setState]       = useState<DumontState>('idle');
  const [result,      setResult]      = useState<DumontResult | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);

  // Refs — nunca ficam stale em closures
  const stateRef       = useRef<DumontState>('idle');
  const wakeEnabledRef = useRef(false);
  const wakeRecogRef   = useRef<any>(null);
  const briefRecogRef  = useRef<any>(null);
  const wakeActiveRef  = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStateSynced = useCallback((s: DumontState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // Manter ref sincronizada com estado
  useEffect(() => { wakeEnabledRef.current = wakeEnabled; }, [wakeEnabled]);

  useEffect(() => {
    const w = window as any;
    setIsSupported(
      typeof window !== 'undefined' &&
      !!(w.SpeechRecognition || w.webkitSpeechRecognition)
    );
  }, []);

  // ── Síntese de voz ────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback((text: string, lang: string) => {
    stopSpeaking();
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setStateSynced('idle'); return;
    }
    setStateSynced('speaking');
    const utt    = new SpeechSynthesisUtterance(text);
    utt.lang     = lang === 'en' ? 'en-US' : 'pt-BR';
    utt.rate     = 0.95; utt.pitch = 1.0; utt.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const voice  = voices.find(v => v.lang === utt.lang && v.localService)
                || voices.find(v => v.lang.startsWith(utt.lang.slice(0, 2)));
    if (voice) utt.voice = voice;
    utt.onend   = () => setStateSynced('idle');
    utt.onerror = () => setStateSynced('idle');
    window.speechSynthesis.speak(utt);
  }, [stopSpeaking, setStateSynced]);

  // ── Processamento da query ────────────────────────────
  const processTranscript = useCallback(async (transcript: string, lang: string) => {
    setStateSynced('thinking');
    // Remove a wake word da query antes de enviar
    const query = transcript.replace(/\bdumont\b/gi, '').trim() || transcript;
    try {
      const res  = await fetch('/api/voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: query, lang }),
      });
      const data = await res.json() as VoiceResponse;
      setResult({ heard: transcript, response: data });
      speak(data.reply, data.lang);
    } catch {
      const fallback = lang.startsWith('en')
        ? 'Data temporarily unavailable.'
        : 'Dados momentaneamente indisponíveis.';
      const errResponse: VoiceResponse = {
        reply: fallback, icao: null, type: 'aerodrome',
        lang:  lang === 'en' ? 'en' : 'pt',
      };
      setResult({ heard: transcript, response: errResponse });
      speak(fallback, lang);
    }
  }, [speak, setStateSynced]);

  // ── Listener de briefing (após chime) ────────────────
  const startBriefingListener = useCallback((lang: string) => {
    const w  = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    briefRecogRef.current?.stop();
    const recog          = new SR();
    recog.continuous     = false;
    recog.interimResults = false;
    recog.lang           = lang;
    briefRecogRef.current = recog;

    recog.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript.trim();
      processTranscript(transcript, lang);
    };
    recog.onerror = (e: any) => {
      if (e.error !== 'no-speech') console.warn('[Dumont] Speech error:', e.error);
      setStateSynced('idle');
    };
    recog.onend = () => {
      if (stateRef.current === 'listening') setStateSynced('idle');
    };

    setStateSynced('listening');
    try { recog.start(); } catch { setStateSynced('idle'); }
  }, [processTranscript, setStateSynced]);

  // ── Chime + abertura do mic ───────────────────────────
  const activateWithChime = useCallback(async (lang: string) => {
    // Parar wake word listener temporariamente
    wakeRecogRef.current?.stop();
    wakeActiveRef.current = false;

    setStateSynced('wake'); // mostra "AGUARDANDO…" durante o chime
    await playChime();
    startBriefingListener(lang);
  }, [startBriefingListener, setStateSynced]);

  // ── Wake word listener (Web Speech robusto) ──────────
  const startWakeListener = useCallback(() => {
    if (!isSupported) return;
    if (wakeActiveRef.current) return;

    const w  = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    // Limpar timer de reinício pendente
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    wakeRecogRef.current?.stop();

    const recog           = new SR();
    // Usar continuous=false com reinício automático é mais estável que continuous=true
    recog.continuous      = false;
    recog.interimResults  = true;
    recog.lang            = navigator.language || 'pt-BR';
    recog.maxAlternatives = 3;
    wakeRecogRef.current  = recog;
    wakeActiveRef.current = true;

    recog.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // Verificar todas as alternativas para maior tolerância
        for (let j = 0; j < e.results[i].length; j++) {
          const text = e.results[i][j].transcript;
          if (matchesWakeWord(text)) {
            console.log('[Dumont] Wake word detectada:', text);
            wakeActiveRef.current = false;
            recog.stop();
            const lang = navigator.language || 'pt-BR';
            activateWithChime(lang);
            return;
          }
        }
      }
    };

    recog.onerror = (e: any) => {
      wakeActiveRef.current = false;
      // 'not-allowed' = sem permissão de mic — não reiniciar
      if (e.error === 'not-allowed') {
        console.warn('[Dumont] Permissão de microfone negada');
        return;
      }
    };

    recog.onend = () => {
      wakeActiveRef.current = false;
      // Só reiniciar se wake ainda estiver habilitado e não em outro estado
      if (
        wakeEnabledRef.current &&
        stateRef.current === 'wake'
      ) {
        // Pequeno delay para evitar loop frenético
        restartTimerRef.current = setTimeout(() => {
          startWakeListener();
        }, 200);
      }
    };

    try {
      recog.start();
      setStateSynced('wake');
    } catch (e) {
      wakeActiveRef.current = false;
      console.warn('[Dumont] Falha ao iniciar wake listener:', e);
    }
  }, [isSupported, activateWithChime, setStateSynced]);

  const stopWakeListener = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    wakeActiveRef.current = false;
    try { wakeRecogRef.current?.stop(); } catch {}
    if (stateRef.current === 'wake') setStateSynced('idle');
  }, [setStateSynced]);

  // ── Efeito: ligar/desligar wake listener ─────────────
  useEffect(() => {
    if (wakeEnabled && isSupported) {
      startWakeListener();
    } else {
      stopWakeListener();
    }
    return () => {
      if (!wakeEnabled) stopWakeListener();
    };
  }, [wakeEnabled, isSupported]); // eslint-disable-line

  // ── Efeito: reiniciar wake após falar/processar ───────
  useEffect(() => {
    if (state === 'idle' && wakeEnabledRef.current && isSupported) {
      const t = setTimeout(() => {
        if (stateRef.current === 'idle' && wakeEnabledRef.current) {
          startWakeListener();
        }
      }, 600);
      return () => clearTimeout(t);
    }
  }, [state, isSupported, startWakeListener]);

  // ── Cleanup ao desmontar ──────────────────────────────
  useEffect(() => {
    return () => {
      stopWakeListener();
      briefRecogRef.current?.stop();
      stopSpeaking();
    };
  }, []); // eslint-disable-line

  // ── Vozes — carregar antecipadamente ─────────────────
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  // ── API pública ───────────────────────────────────────

  // Ativação manual via botão
  const activate = useCallback(() => {
    if (state === 'speaking') { stopSpeaking(); setStateSynced('idle'); return; }
    if (state !== 'idle' && state !== 'wake') return;
    stopWakeListener();
    const lang = navigator.language || 'pt-BR';
    activateWithChime(lang);
  }, [state, stopSpeaking, stopWakeListener, activateWithChime, setStateSynced]);

  const stop = useCallback(() => {
    stopWakeListener();
    briefRecogRef.current?.stop();
    stopSpeaking();
    setStateSynced('idle');
    setResult(null);
  }, [stopWakeListener, stopSpeaking, setStateSynced]);

  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

  const replay = useCallback(() => {
    if (result) speak(result.response.reply, result.response.lang);
  }, [result, speak]);

  const toggleWake = useCallback(() => {
    setWakeEnabled(e => !e);
  }, []);

  return {
    state, result, activate, stop, clearResult,
    replay, isSupported, wakeEnabled, toggleWake,
  };
}
