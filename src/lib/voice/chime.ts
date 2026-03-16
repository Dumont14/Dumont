// src/lib/voice/chime.ts
// Cabin chime (ding-dong) via Web Audio API — no external files needed.
// Sounds like the classic Boeing/Airbus "call chime" used by flight attendants.

/**
 * Plays a two-tone descending cabin chime.
 *
 * Tone 1 (ding): 880 Hz — 380 ms
 * Tone 2 (dong): 660 Hz — 480 ms, starts 320 ms after tone 1
 *
 * Each tone uses a sine oscillator with a smooth gain envelope
 * (quick attack, slow exponential decay) to avoid clicks.
 *
 * Returns a Promise that resolves when the chime finishes,
 * so callers can await it before starting the speech listener.
 */
export function playChime(): Promise<void> {
  return new Promise((resolve) => {
    // Guard: Web Audio not available (SSR or old browser)
    if (typeof window === 'undefined' || !window.AudioContext) {
      resolve();
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      resolve();
      return;
    }

    // Resume context if suspended (browser autoplay policy)
    const ready = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();

    ready.then(() => {
      const now = ctx.currentTime;

      /**
       * playTone(freq, startTime, duration)
       * Builds: oscillator → gain → destination
       * Envelope: instant attack, exponential decay to silence.
       */
      function playTone(freq: number, startTime: number, duration: number) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type            = 'sine';
        osc.frequency.value = freq;

        // Gain envelope: ramp up in 10 ms, exponential decay over duration
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.45, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
      }

      // Ding: 880 Hz, starts now, lasts 380 ms
      playTone(880, now,        0.38);
      // Dong: 660 Hz, starts 320 ms later, lasts 480 ms
      playTone(660, now + 0.32, 0.48);

      // Total chime duration: 320 + 480 = 800 ms
      const totalMs = (0.32 + 0.48) * 1000;

      setTimeout(() => {
        // Close AudioContext to free resources, then resolve
        ctx.close().finally(resolve);
      }, totalMs + 50); // +50 ms buffer for decay tail
    }).catch(() => resolve());
  });
}
