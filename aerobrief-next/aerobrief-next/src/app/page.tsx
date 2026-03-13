// src/app/page.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { Disclaimer }    from '@/components/ui/Disclaimer';
import { MetarPanel }    from '@/components/briefing/MetarPanel';
import { NotamPanel }    from '@/components/briefing/NotamPanel';
import { ActivityFeed }  from '@/components/feed/ActivityFeed';
import { DumontButton }  from '@/components/dumont/DumontButton';
import styles from './page.module.css';

function UtcClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toUTCString().slice(17, 25) + ' UTC');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className={styles.clock}>{time}</span>;
}

export default function HomePage() {
  const [dep, setDep]             = useState('');
  const [arr, setArr]             = useState('');
  const [activeDep, setActiveDep] = useState('');
  const [activeArr, setActiveArr] = useState('');
  const [feedOpen, setFeedOpen]   = useState(false);

  const runBriefing = useCallback(() => {
    const d = dep.trim().toUpperCase();
    if (d.length < 2) return;
    setActiveDep(d);
    setActiveArr(arr.trim().toUpperCase());
  }, [dep, arr]);

  const handleDumontIcao = useCallback((d: string, a?: string) => {
    setDep(d); setArr(a || '');
    setActiveDep(d); setActiveArr(a || '');
  }, []);

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') runBriefing(); };

  return (
    <div className={styles.shell}>
      <aside className={[styles.sidebar, feedOpen ? styles.open : ''].join(' ')}>
        <ActivityFeed />
      </aside>

      <main className={styles.main}>
        <Disclaimer />

        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.logo}>AEROBRIEF</span>
            <UtcClock />
          </div>
          <div className={styles.search}>
            <div className={styles.inputWrap}>
              <label className={styles.inputLabel} htmlFor="dep">DEP</label>
              <input id="dep" className={styles.input} value={dep}
                onChange={e => setDep(e.target.value.toUpperCase())} onKeyDown={handleKey}
                placeholder="SBSP" maxLength={4} autoComplete="off" />
            </div>
            <span className={styles.arrow}>→</span>
            <div className={styles.inputWrap}>
              <label className={styles.inputLabel} htmlFor="arr">ARR</label>
              <input id="arr" className={styles.input} value={arr}
                onChange={e => setArr(e.target.value.toUpperCase())} onKeyDown={handleKey}
                placeholder="opcional" maxLength={4} autoComplete="off" />
            </div>
            <button className={styles.briefBtn} onClick={runBriefing}>BRIEF</button>
          </div>
          <button className={styles.feedToggle} onClick={() => setFeedOpen(o => !o)} aria-label="Toggle feed">⚡</button>
        </header>

        <div className={styles.content}>
          {!activeDep && (
            <div className={styles.welcome}>
              <span className={styles.welcomeIcon}>✈</span>
              <p>Enter an ICAO code to start your briefing</p>
              <p className={styles.welcomeSub}>or say <strong>"Dumont, condições de SBSP"</strong></p>
            </div>
          )}

          {activeDep && (
            <div className={styles.panels}>
              <MetarPanel icao={activeDep} />
              <NotamPanel icao={activeDep} />
              {activeArr && (
                <>
                  <div className={styles.divider}>
                    <span>{activeDep}</span>
                    <span className={styles.divArrow}>──────→</span>
                    <span>{activeArr}</span>
                  </div>
                  <MetarPanel icao={activeArr} />
                  <NotamPanel icao={activeArr} />
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <DumontButton onIcaoDetected={handleDumontIcao} />
      {feedOpen && <div className={styles.overlay} onClick={() => setFeedOpen(false)} aria-hidden />}
    </div>
  );
}
