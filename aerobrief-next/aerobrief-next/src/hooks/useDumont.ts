// src/hooks/useDumont.ts
// Encapsulates all Dumont voice assistant logic
// Web Speech API (recognition + synthesis) + /api/voice

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { parseVoiceIntent } from '@/lib/voice/intent';
import type { VoiceResponse } from '@/types';

export type DumontState = 'idle' | 'listening' | 'thinking' | 'speaking';

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
}

export function useDumont(): UseDumontReturn {
  const [state, setState]   = useState<DumontState>('idle');
  const [result, setResult] = useState<DumontResult | null>(null);
  const recogRef  = useRef<SpeechRecognition | null>(null);
  const synthRef  = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    );
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    synthRef.current = null;
  }, []);

  const speak = useCallback((text: string, lang: string) => {
    stopSpeaking();
    if (!window.speechSynthesis) { setState('idle'); return; }

    setState('speaking');
    const utt   = new SpeechSynthesisUtterance(text);
    utt.lang    = lang === 'en' ? 'en-US' : 'pt-BR';
    utt.rate    = 0.95;
    utt.pitch   = 1.0;
    utt.volume  = 1.0;

    // Pick best available voice
    const voices   = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === utt.lang && v.localService)
                   || voices.find(v => v.lang.startsWith(utt.lang.substring(0, 2)));
    if (preferred) utt.voice = preferred;

    utt.onend   = () => setState('idle');
    utt.onerror = () => setState('idle');
    synthRef.current = utt;
    window.speechSynthesis.speak(utt);
  }, [stopSpeaking]);

  const processTranscript = useCallback(async (transcript: string, lang: string) => {
    setState('thinking');

    // Strip wake word before sending
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

      // Pre-fill ICAO inputs if available (done in component via result)
    } catch {
      const fallback = lang.startsWith('en')
        ? 'Data temporarily unavailable. Please try again.'
        : 'Dados momentaneamente indisponíveis. Tente novamente.';
      const errResponse: VoiceResponse = { reply: fallback, icao: null, type: 'aerodrome', lang: lang === 'en' ? 'en' : 'pt' };
      setResult({ heard: transcript, response: errResponse });
      speak(fallback, lang);
    }
  }, [speak]);

  const activate = useCallback(() => {
    if (state === 'speaking') { stopSpeaking(); setState('idle'); return; }
    if (state !== 'idle') return;
    if (!isSupported) return;

    const SpeechRecognition = (window as unknown as { SpeechRecognition?: typeof globalThis.SpeechRecognition; webkitSpeechRecognition?: typeof globalThis.SpeechRecognition }).SpeechRecognition
                           || (window as unknown as { webkitSpeechRecognition?: typeof globalThis.SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const lang  = navigator.language || 'pt-BR';
    const recog = new SpeechRecognition();
    recog.continuous      = false;
    recog.interimResults  = false;
    recog.lang            = lang;
    recogRef.current      = recog;

    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      processTranscript(transcript, lang);
    };
    recog.onerror = (e) => {
      if (e.error !== 'no-speech') console.warn('Speech error:', e.error);
      setState('idle');
    };
    recog.onend = () => {
      if (state === 'listening') setState('idle');
    };

    setState('listening');
    recog.start();
  }, [state, isSupported, processTranscript, stopSpeaking]);

  const stop = useCallback(() => {
    recogRef.current?.stop();
    stopSpeaking();
    setState('idle');
  }, [stopSpeaking]);

  const replay = useCallback(() => {
    if (result) speak(result.response.reply, result.response.lang);
  }, [result, speak]);

  // Load voices on mount (Chrome async)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  return { state, result, activate, stop, replay, isSupported };
}
