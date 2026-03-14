// src/hooks/useDumont.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { VoiceResponse } from '@/types';

export type DumontState = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking';

interface DumontResult {
  heard: string;
  response: VoiceResponse;
}

interface UseDumontReturn {
  state: DumontState;
  result: DumontResult | null;
  activate: () => void;
  stop: () => void;
  replay: () => void;
  isSupported: boolean;
  wakeEnabled: boolean;
  toggleWake: () => void;
}

export function useDumont(): UseDumontReturn {
  const [state,       setState]       = useState<DumontState>('idle');
  const [result,      setResult]      = useState<DumontResult | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);

  const recogRef     = useRef<any>(null); // briefing recognition
  const wakeRef      = useRef<any>(null); // wake word recognition
  const wakeActive   = useRef(false);     // guard para evitar restart duplo
  const stateRef     = useRef<DumontState>('idle'); // shadow para closures

  // Mantém stateRef sincronizado
  const setStateSynced = useCallback((s: DumontState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  useEffect(() => {
    const w = window as any;
    setIsSupported(
      typeof window !== 'undefined' &&
      !!(w.SpeechRecognition || w.webkitSpeechRecognition)
    );
  }, []);

  // ── Speech synthesis ──────────────────────────────────
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback((text: string, lang: string) => {
    stopSpeaking();
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setStateSynced('idle');
      return;
    }
    setStateSynced('speaking');
    const utt    = new SpeechSynthesisUtterance(text);
    utt.lang     = lang === 'en' ? 'en-US' : 'pt-BR';
    utt.rate     = 0.95;
    utt.pitch    = 1.0;
    utt.volume   = 1.0;
    const voices    = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === utt.lang && v.localService)
                   || voices.find(v => v.lang.startsWith(utt.lang.substring(0, 2)));
    if (preferred) utt.voice = preferred;
    utt.onend   = () => setStateSynced('idle');
    utt.onerror = () => setStateSynced('idle');
    window.speechSynthesis.speak(utt);
  }, [stopSpeaking, setStateSynced]);

  // ── Process transcript → /api/voice ──────────────────
  const processTranscript = useCallback(async (transcript: string, lang: string) => {
    setStateSynced('thinking');
    const query = transcript.replace(/\bdumont\b/gi, '').trim() || transcript;
    try {
      const res  = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query, lang }),
      });
      const data = await res.json() as VoiceResponse;
      setResult({ heard: transcript, response: data });
      speak(data.reply, data.lang);
    } catch {
      const fallback = lang.startsWith('en')
        ? 'Data temporarily unavailable. Please try again.'
        : 'Dados momentaneamente indisponíveis. Tente novamente.';
      const errResponse: VoiceResponse = {
        reply: fallback, icao: null, type: 'aerodrome',
        lang: lang === 'en' ? 'en' : 'pt',
      };
      setResult({ heard: transcript, response: errResponse });
      speak(fallback, lang);
    }
  }, [speak, setStateSynced]);

  // ── Briefing listener (após wake word ou toque) ───────
  const startBriefingListener = useCallback((lang: string) => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    recogRef.current?.stop();

    const recog          = new SR();
    recog.continuous     = false;
    recog.interimResults = false;
    recog.lang           = lang;
    recogRef.current     = recog;

    recog.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript.trim();
      processTranscript(transcript, lang);
    };
    recog.onerror = (e: any) => {
      if (e.error !== 'no-speech') console.warn('Speech error:', e.error);
      setStateSynced('idle');
    };
    recog.onend = () => {
      // Se ainda está em listening (sem resultado), volta pra idle
      if (stateRef.current === 'listening') setStateSynced('idle');
    };

    setStateSynced('listening');
    recog.start();
  }, [processTranscript, setStateSynced]);

  // ── Wake word listener ────────────────────────────────
  const startWakeListener = useCallback(() => {
    if (!isSupported || wakeActive.current) return;

    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    wakeRef.current?.stop();

    const recog          = new SR();
    recog.continuous     = true;   // ouve continuamente
    recog.interimResults = true;   // resultados parciais para latência menor
    recog.lang           = navigator.language || 'pt-BR';
    wakeRef.current      = recog;
    wakeActive.current   = true;

    recog.onresult = (e: any) => {
      // Varrer todos os resultados acumulados
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.toLowerCase();
        if (text.includes('dumont')) {
          // Wake word detectada — para o wake listener e inicia briefing
          wakeActive.current = false;
          recog.stop();
          const lang = navigator.language || 'pt-BR';
          startBriefingListener(lang);
          return;
        }
      }
    };

    recog.onerror = (e: any) => {
      wakeActive.current = false;
      // Erros esperados: 'no-speech', 'aborted' — reiniciar silenciosamente
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('Wake word error:', e.error);
    };

    recog.onend = () => {
      wakeActive.current = false;
      // Reiniciar automaticamente se wake ainda está habilitado
      // e o app não está em outro estado de voz
      if (wakeEnabled && stateRef.current === 'idle') {
        // Pequeno delay para evitar loop imediato em caso de erro
        setTimeout(() => startWakeListener(), 300);
      }
    };

    try {
      recog.start();
      setStateSynced('wake');
    } catch (err) {
      wakeActive.current = false;
      console.warn('Wake start failed:', err);
    }
  }, [isSupported, wakeEnabled, startBriefingListener, setStateSynced]);

  // Quando wakeEnabled muda, ligar/desligar o listener
  useEffect(() => {
    if (wakeEnabled && isSupported) {
      startWakeListener();
    } else {
      wakeActive.current = false;
      wakeRef.current?.stop();
      if (stateRef.current === 'wake') setStateSynced('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeEnabled, isSupported]);

  // Para o wake listener quando o app entra em outros estados de voz
  useEffect(() => {
    if (state === 'listening' || state === 'thinking' || state === 'speaking') {
      wakeActive.current = false;
      wakeRef.current?.stop();
    }
    // Quando volta para idle, reinicia o wake listener se habilitado
    if (state === 'idle' && wakeEnabled && isSupported) {
      setTimeout(() => startWakeListener(), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Limpar tudo ao desmontar
  useEffect(() => {
    return () => {
      wakeActive.current = false;
      wakeRef.current?.stop();
      recogRef.current?.stop();
      stopSpeaking();
    };
  }, [stopSpeaking]);

  // ── API pública ───────────────────────────────────────
  const activate = useCallback(() => {
    if (state === 'speaking') { stopSpeaking(); setStateSynced('idle'); return; }
    if (state === 'wake')     { /* toque durante wake → briefing imediato */ }
    if (state !== 'idle' && state !== 'wake') return;
    wakeActive.current = false;
    wakeRef.current?.stop();
    const lang = navigator.language || 'pt-BR';
    startBriefingListener(lang);
  }, [state, stopSpeaking, startBriefingListener, setStateSynced]);

  const stop = useCallback(() => {
    wakeActive.current = false;
    wakeRef.current?.stop();
    recogRef.current?.stop();
    stopSpeaking();
    setStateSynced('idle');
  }, [stopSpeaking, setStateSynced]);

  const replay = useCallback(() => {
    if (result) speak(result.response.reply, result.response.lang);
  }, [result, speak]);

  const toggleWake = useCallback(() => {
    setWakeEnabled(e => !e);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  return { state, result, activate, stop, replay, isSupported, wakeEnabled, toggleWake };
}
