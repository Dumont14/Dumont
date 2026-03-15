// src/app/page.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { Disclaimer }    from '@/components/ui/Disclaimer';
import { MetarPanel }    from '@/components/briefing/MetarPanel';
import { TafPanel }      from '@/components/briefing/TafPanel';
import { NotamPanel }    from '@/components/briefing/NotamPanel';
import { AirportPanel }  from '@/components/briefing/AirportPanel';
import { ActivityFeed }  from '@/components/feed/ActivityFeed';
import { DumontButton }  from '@/components/dumont/DumontButton';
import styles from './page.module.css';

function UtcClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toUTCString().slice(17, 25) + 'Z');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className={styles.clock}>{time}</span>;
}

type MobileTab = 'brief' | 'feed' | 'crew';

export default function HomePage() {
  const [dep, setDep]             = useState('');
  const [arr, setArr]             = useState('');
  const [activeDep, setActiveDep] = useState('');
  const [activeArr, setActiveArr] = useState('');
  const [feedOpen, setFeedOpen]   = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('brief');

  const runBriefing = useCallback(() => {
    const d = dep.trim().toUpperCase();
    if (d.length < 2) return;
    setActiveDep(d);
    setActiveArr(arr.trim().toUpperCase());
    setMobileTab('brief');
  }, [dep, arr]);

  const handleDumontIcao = useCallback((d: string, a?: string) => {
    setDep(d); setArr(a || '');
    setActiveDep(d); setActiveArr(a || '');
    setMobileTab('brief');
  }, []);

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') runBriefing(); };

  return (
    <div className={styles.shell}>

      {/* SIDEBAR */}
      <aside className={[
        styles.sidebar,
        feedOpen ? styles.open : '',
        mobileTab === 'feed' ? styles.mobileVisible : '',
      ].join(' ')}>
        <ActivityFeed />
      </aside>

      {/* MAIN */}
      <main className={[
        styles.main,
        mobileTab !== 'brief' ? styles.mobileHidden : '',
      ].join(' ')}>

        <Disclaimer />

        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.logo}>DUMONT</span>
            <UtcClock />
          </div>

          <div className={styles.search}>
            <div className={styles.inputGroup}>
              <div className={styles.inputWrap}>
                <label className={styles.inputLabel} htmlFor="dep">DEP</label>
                <input
                  id="dep"
                  className={styles.input}
                  value={dep}
                  onChange={e => setDep(e.target.value.toUpperCase())}
                  onKeyDown={handleKey}
                  placeholder="SBSP"
                  maxLength={4}
                  autoComplete="off"
                />
              </div>
              <span className={styles.arrow}>→</span>
              <div className={styles.inputWrap}>
                <label className={styles.inputLabel} htmlFor="arr">ARR</label>
                <input
                  id="arr"
                  className={styles.input}
                  value={arr}
                  onChange={e => setArr(e.target.value.toUpperCase())}
                  onKeyDown={handleKey}
                  placeholder="SBBE"
                  maxLength={4}
                  autoComplete="off"
                />
              </div>
            </div>
            <button className={styles.briefBtn} onClick={runBriefing}>BRIEF</button>
          </div>

          <button
            className={styles.feedToggle}
            onClick={() => setFeedOpen(o => !o)}
            aria-label="Toggle feed"
          >⚡</button>
        </header>

        <div className={styles.content}>
          {!activeDep && (
            <div className={styles.welcome}>
              <span className={styles.welcomeIcon}>✈</span>
              <p>Digite um código ICAO para iniciar o briefing</p>
              <p className={styles.welcomeSub}>ou diga <strong>"Dumont, condições de SBSP"</strong></p>
            </div>
          )}

          {activeDep && (
            <div className={styles.panels}>
              {/* ── DEP ── */}
              <MetarPanel   icao={activeDep} />
              <TafPanel     icao={activeDep} />
              <NotamPanel   icao={activeDep} />
              <AirportPanel icao={activeDep} />

              {/* ── ROTA ── */}
              {activeArr && (
                <>
                  <div className={styles.divider}>
                    <span>{activeDep}</span>
                    <span className={styles.divArrow}>──────→</span>
                    <span>{activeArr}</span>
                  </div>
                  <MetarPanel   icao={activeArr} />
                  <TafPanel     icao={activeArr} />
                  <NotamPanel   icao={activeArr} />
                  <AirportPanel icao={activeArr} />
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* CREW placeholder */}
      {mobileTab === 'crew' && (
        <div className={styles.crewPlaceholder}>
          <span className={styles.welcomeIcon}>👤</span>
          <p>Cadastro de usuários</p>
          <p className={styles.welcomeSub}>Em breve</p>
        </div>
      )}

      {/* BOTTOM NAV */}
      <nav className={styles.bottomNav} aria-label="Navegação principal">
        <button
          className={[styles.navBtn, mobileTab === 'brief' ? styles.navActive : ''].join(' ')}
          onClick={() => setMobileTab('brief')}
        >
          <span className={styles.navIcon}>✈</span>
          <span className={styles.navLabel}>BRIEF</span>
        </button>
        <button
          className={[styles.navBtn, mobileTab === 'feed' ? styles.navActive : ''].join(' ')}
          onClick={() => setMobileTab('feed')}
        >
          <span className={styles.navIcon}>⚡</span>
          <span className={styles.navLabel}>FEED</span>
        </button>
        <button
          className={[styles.navBtn, mobileTab === 'crew' ? styles.navActive : ''].join(' ')}
          onClick={() => setMobileTab('crew')}
        >
          <span className={styles.navIcon}>👤</span>
          <span className={styles.navLabel}>CREW</span>
        </button>
      </nav>

      <DumontButton onIcaoDetected={handleDumontIcao} />

      {feedOpen && (
        <div className={styles.overlay} onClick={() => setFeedOpen(false)} aria-hidden />
      )}
    </div>
  );
}
