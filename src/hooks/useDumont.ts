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
  state:        DumontState;
  result:       DumontResult | null;
  activate:     () => void;
  stop:         () => void;
  clearResult:  () => void;   // ← NOVO: limpa result sem parar o assistente
  replay:       () => void;
  isSupported:  boolean;
  wakeEnabled:  boolean;
  toggleWake:   () => void;
}

const PORCUPINE_ACCESS_KEY = '+H2MG7Ko2e6a6qmF351gYjbOONDKyNXvsnS36Z6rJ7rah9ode84ABw==';
const PORCUPINE_MODEL_URL  = '/models/dumont_pt_wasm.ppn';

export function useDumont(): UseDumontReturn {
  const [state,       setState]       = useState<DumontState>('idle');
  const [result,      setResult]      = useState<DumontResult | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);

  const recogRef      = useRef<any>(null);
  const porcupineRef  = useRef<any>(null);
  const stateRef      = useRef<DumontState>('idle');
  const wakeRecogRef  = useRef<any>(null);
  const wakeActiveRef = useRef(false);

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
    const voices    = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === utt.lang && v.localService)
                   || voices.find(v => v.lang.startsWith(utt.lang.substring(0, 2)));
    if (preferred) utt.voice = preferred;
    utt.onend   = () => setStateSynced('idle');
    utt.onerror = () => setStateSynced('idle');
    window.speechSynthesis.speak(utt);
  }, [stopSpeaking, setStateSynced]);

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
        ? 'Data temporarily unavailable.'
        : 'Dados momentaneamente indisponíveis.';
      const errResponse: VoiceResponse = {
        reply: fallback, icao: null, type: 'aerodrome',
        lang: lang === 'en' ? 'en' : 'pt',
      };
      setResult({ heard: transcript, response: errResponse });
      speak(fallback, lang);
    }
  }, [speak, setStateSynced]);

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
      if (stateRef.current === 'listening') setStateSynced('idle');
    };
    setStateSynced('listening');
    recog.start();
  }, [processTranscript, setStateSynced]);

  const startWakeWebSpeech = useCallback(() => {
    if (!isSupported || wakeActiveRef.current) return;
    const w  = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    wakeRecogRef.current?.stop();
    const recog          = new SR();
    recog.continuous     = true;
    recog.interimResults = true;
    recog.lang           = navigator.language || 'pt-BR';
    wakeRecogRef.current = recog;
    wakeActiveRef.current = true;
    recog.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.toLowerCase();
        if (text.includes('dumont')) {
          wakeActiveRef.current = false;
          recog.stop();
          const lang = navigator.language || 'pt-BR';
          startBriefingListener(lang);
          return;
        }
      }
    };
    recog.onerror = () => { wakeActiveRef.current = false; };
    recog.onend   = () => {
      wakeActiveRef.current = false;
      if (wakeEnabled && stateRef.current === 'idle') {
        setTimeout(() => startWakeWebSpeech(), 300);
      }
    };
    try {
      recog.start();
      setStateSynced('wake');
    } catch { wakeActiveRef.current = false; }
  }, [isSupported, wakeEnabled, startBriefingListener, setStateSynced]);

  const startPorcupine = useCallback(async () => {
    if (porcupineRef.current) return;
    try {
      const { PorcupineWorker } = await import('@picovoice/porcupine-web');
      const ppnRes  = await fetch(PORCUPINE_MODEL_URL);
      const ppnBuf  = await ppnRes.arrayBuffer();
      const ppnData = new Uint8Array(ppnBuf);
      const b64     = btoa(ppnData.reduce((s, b) => s + String.fromCharCode(b), ''));
      const porcupine = await PorcupineWorker.create(
        PORCUPINE_ACCESS_KEY,
        [{ base64: b64, sensitivity: 0.7, label: 'dumont' }],
        () => {
          console.log('[Porcupine] Dumont detectado!');
          // @ts-ignore
          try { porcupine.pause(); } catch {}
          startBriefingListener(navigator.language || 'pt-BR');
        },
        {
          publicPath: 'https://cdn.jsdelivr.net/npm/@picovoice/porcupine-web@4/dist/',
          forceWrite: true,
          // @ts-ignore
          modelVersion: '3.0.0',
          language: 'pt',
        }
      );
      porcupineRef.current = porcupine;
      // @ts-ignore
      await porcupine.start();
      setStateSynced('wake');
    } catch (err) {
      console.warn('[Porcupine] Falhou, usando Web Speech fallback:', err);
      startWakeWebSpeech();
    }
  }, [startBriefingListener, startWakeWebSpeech, setStateSynced]);

  const stopWake = useCallback(() => {
    if (porcupineRef.current) {
      try { porcupineRef.current.terminate(); } catch {}
      porcupineRef.current = null;
    }
    wakeActiveRef.current = false;
    wakeRecogRef.current?.stop();
    if (stateRef.current === 'wake') setStateSynced('idle');
  }, [setStateSynced]);

  useEffect(() => {
    if (wakeEnabled && isSupported) {
      startPorcupine();
    } else {
      stopWake();
    }
  }, [wakeEnabled, isSupported]); // eslint-disable-line

  useEffect(() => {
    if (state === 'idle' && wakeEnabled && isSupported) {
      const t = setTimeout(() => {
        if (porcupineRef.current) {
          try { porcupineRef.current.resume(); } catch {}
        } else {
          startPorcupine();
        }
      }, 500);
      return () => clearTimeout(t);
    }
  }, [state]); // eslint-disable-line

  useEffect(() => {
    return () => {
      stopWake();
      recogRef.current?.stop();
      stopSpeaking();
    };
  }, [stopWake, stopSpeaking]);

  const activate = useCallback(() => {
    if (state === 'speaking') { stopSpeaking(); setStateSynced('idle'); return; }
    if (state !== 'idle' && state !== 'wake') return;
    stopWake();
    const lang = navigator.language || 'pt-BR';
    startBriefingListener(lang);
  }, [state, stopSpeaking, stopWake, startBriefingListener, setStateSynced]);

  // FIX: stop() agora limpa result E para tudo.
  // Campos DEP/ARR ficam desbloqueados assim que result vira null.
  const stop = useCallback(() => {
    stopWake();
    recogRef.current?.stop();
    stopSpeaking();
    setStateSynced('idle');
    setResult(null); // ← FIX: garante que bubble some e campos são desbloqueados
  }, [stopWake, stopSpeaking, setStateSynced]);

  // clearResult: fecha apenas a bubble sem parar wake word.
  // Útil para fechar o painel mantendo o assistente em escuta.
  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

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

  return { state, result, activate, stop, clearResult, replay, isSupported, wakeEnabled, toggleWake };
}
