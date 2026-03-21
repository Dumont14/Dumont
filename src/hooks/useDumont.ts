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

// Variações fonéticas de "Dumont" que o browser pode transcrever
const WAKE_PATTERNS = [
  'dumont','du mont','dumon','dumonte','dumund',
  'du mond','dimon','domon','demon','duman','do monte','do mont',
];

function matchesWakeWord(text: string): boolean {
  const n = text.toLowerCase().trim();
  return WAKE_PATTERNS.some(p => n.includes(p));
}

// ── Seleção de voz ────────────────────────────────────────
// Prioridade: Google PT-BR Neural → Google PT-BR → qualquer PT-BR → fallback
function selectBestVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const isEnglish = lang.startsWith('en');
  const targetLang = isEnglish ? 'en' : 'pt';

  // Candidatos em ordem de preferência
  const candidates = [
    // 1. Google Neural PT-BR (Android Chrome — melhor qualidade)
    voices.find(v => v.name === 'Google português Brasil' && !isEnglish),
    voices.find(v => v.name.includes('Google') && v.lang === 'pt-BR' && !isEnglish),
    // 2. Google EN-US para inglês
    voices.find(v => v.name === 'Google US English' && isEnglish),
    voices.find(v => v.name.includes('Google') && v.lang.startsWith('en') && isEnglish),
    // 3. Qualquer voz local PT-BR
    voices.find(v => v.lang === 'pt-BR' && v.localService && !isEnglish),
    // 4. Qualquer PT-BR
    voices.find(v => v.lang === 'pt-BR' && !isEnglish),
    // 5. Qualquer PT
    voices.find(v => v.lang.startsWith(targetLang)),
  ].filter(Boolean) as SpeechSynthesisVoice[];

  return candidates[0] ?? null;
}

export function useDumont(): UseDumontReturn {
  const [state,       setState]       = useState<DumontState>('idle');
  const [result,      setResult]      = useState<DumontResult | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);

  const stateRef        = useRef<DumontState>('idle');
  const wakeEnabledRef  = useRef(false);
  const wakeRecogRef    = useRef<any>(null);
  const briefRecogRef   = useRef<any>(null);
  const wakeActiveRef   = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voicesLoadedRef = useRef(false);

  const setStateSynced = useCallback((s: DumontState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  useEffect(() => { wakeEnabledRef.current = wakeEnabled; }, [wakeEnabled]);

  useEffect(() => {
    const w = window as any;
    setIsSupported(
      typeof window !== 'undefined' &&
      !!(w.SpeechRecognition || w.webkitSpeechRecognition)
    );
  }, []);

  // ── Pré-carregar vozes ────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => {
      window.speechSynthesis.getVoices();
      voicesLoadedRef.current = true;
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  // ── Síntese de voz ────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopSpeaking = useCallback(() => {
    // Parar OpenAI TTS
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    // Parar Web Speech fallback
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speakWebSpeech = useCallback((text: string, lang: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setStateSynced('idle'); return;
    }
    const utt    = new SpeechSynthesisUtterance(text);
    utt.lang     = lang === 'en' ? 'en-US' : 'pt-BR';
    utt.rate     = 0.92;
    utt.pitch    = 0.95;
    utt.volume   = 1.0;
    const bestVoice = selectBestVoice(lang);
    if (bestVoice) utt.voice = bestVoice;

    const resumeInterval = setInterval(() => {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 5000);

    utt.onend = () => { clearInterval(resumeInterval); setStateSynced('idle'); };
    utt.onerror = () => { clearInterval(resumeInterval); setStateSynced('idle'); };
    window.speechSynthesis.speak(utt);
  }, [setStateSynced]);

  const speak = useCallback(async (text: string, lang: string) => {
    stopSpeaking();
    setStateSynced('speaking');

    try {
      // Tentar OpenAI TTS
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) throw new Error(`TTS ${res.status}`);

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setStateSynced('idle');
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        speakWebSpeech(text, lang); // fallback
      };

      await audio.play();
    } catch {
      // Fallback para Web Speech se OpenAI TTS falhar
      speakWebSpeech(text, lang);
    }
  }, [stopSpeaking, speakWebSpeech, setStateSynced]);

  // ── Processamento da query ────────────────────────────
  const processTranscript = useCallback(async (transcript: string, lang: string) => {
    setStateSynced('thinking');
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
    const recog           = new SR();
    recog.continuous      = false;
    recog.interimResults  = false;
    recog.lang            = lang;
    recog.maxAlternatives = 1;
    briefRecogRef.current = recog;

    recog.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript.trim();
      processTranscript(transcript, lang);
    };
    recog.onerror = (e: any) => {
      if (e.error !== 'no-speech') console.warn('[Dumont] Brief error:', e.error);
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
    wakeRecogRef.current?.stop();
    wakeActiveRef.current = false;
    setStateSynced('wake');
    await playChime();
    startBriefingListener(lang);
  }, [startBriefingListener, setStateSynced]);

  // ── Wake word listener ────────────────────────────────
  const startWakeListener = useCallback(() => {
    if (!isSupported || wakeActiveRef.current) return;
    const w  = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    try { wakeRecogRef.current?.stop(); } catch {}

    const recog           = new SR();
    recog.continuous      = false;   // false é mais estável no Android
    recog.interimResults  = true;
    recog.lang            = navigator.language || 'pt-BR';
    recog.maxAlternatives = 3;
    wakeRecogRef.current  = recog;
    wakeActiveRef.current = true;

    recog.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        for (let j = 0; j < e.results[i].length; j++) {
          const text = e.results[i][j].transcript;
          if (matchesWakeWord(text)) {
            console.log('[Dumont] Wake word:', text);
            wakeActiveRef.current = false;
            recog.stop();
            activateWithChime(navigator.language || 'pt-BR');
            return;
          }
        }
      }
    };

    recog.onerror = (e: any) => {
      wakeActiveRef.current = false;
      if (e.error === 'not-allowed') {
        console.warn('[Dumont] Microfone negado');
      }
    };

    recog.onend = () => {
      wakeActiveRef.current = false;
      if (wakeEnabledRef.current && stateRef.current === 'wake') {
        restartTimerRef.current = setTimeout(startWakeListener, 250);
      }
    };

    try {
      recog.start();
      setStateSynced('wake');
    } catch {
      wakeActiveRef.current = false;
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

  // ── Efeitos ───────────────────────────────────────────
  useEffect(() => {
    if (wakeEnabled && isSupported) startWakeListener();
    else stopWakeListener();
  }, [wakeEnabled, isSupported]); // eslint-disable-line

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

  useEffect(() => {
    return () => {
      stopWakeListener();
      briefRecogRef.current?.stop();
      stopSpeaking();
    };
  }, []); // eslint-disable-line

  // ── API pública ───────────────────────────────────────
  const activate = useCallback(() => {
    if (state === 'speaking') { stopSpeaking(); setStateSynced('idle'); return; }
    if (state !== 'idle' && state !== 'wake') return;
    stopWakeListener();
    activateWithChime(navigator.language || 'pt-BR');
  }, [state, stopSpeaking, stopWakeListener, activateWithChime, setStateSynced]);

  const stop = useCallback(() => {
    stopWakeListener();
    briefRecogRef.current?.stop();
    stopSpeaking();
    setStateSynced('idle');
    setResult(null);
  }, [stopWakeListener, stopSpeaking, setStateSynced]);

  const clearResult  = useCallback(() => setResult(null), []);
  const replay       = useCallback(() => {
    if (result) speak(result.response.reply, result.response.lang);
  }, [result, speak]);
  const toggleWake   = useCallback(() => setWakeEnabled(e => !e), []);

  return { state, result, activate, stop, clearResult, replay, isSupported, wakeEnabled, toggleWake };
}
