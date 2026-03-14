// src/app/page.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { Disclaimer }   from '@/components/ui/Disclaimer';
import { MetarPanel }   from '@/components/briefing/MetarPanel';
import { NotamPanel }   from '@/components/briefing/NotamPanel';
import { ActivityFeed } from '@/components/feed/ActivityFeed';
import { DumontButton } from '@/components/dumont/DumontButton';
import styles from './page.module.css';

// ── UTC Clock ────────────────────────────────────────────
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

// ── Tabs para bottom nav mobile ──────────────────────────
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
    setMobileTab('brief'); // volta para a aba de briefing no mobile
  }, [dep, arr]);

  const handleDumontIcao = useCallback((d: string, a?: string) => {
    setDep(d); setArr(a || '');
    setActiveDep(d); setActiveArr(a || '');
    setMobileTab('brief');
  }, []);

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') runBriefing(); };

  return (
    <div className={styles.shell}>

      {/* ── SIDEBAR (desktop) / Feed overlay (mobile) ── */}
      <aside className={[
        styles.sidebar,
        feedOpen ? styles.open : '',
        mobileTab === 'feed' ? styles.mobileVisible : '',
      ].join(' ')}>
        <ActivityFeed />
      </aside>

      {/* ── MAIN ──────────────────────────────────────── */}
      <main className={[
        styles.main,
        mobileTab !== 'brief' ? styles.mobileHidden : '',
      ].join(' ')}>

        <Disclaimer />

        {/* HEADER */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.logo}>DUMONT</span>
            <UtcClock />
          </div>

          {/* Search — DEP → ARR em linha no desktop, empilhado no mobile */}
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

          {/* Feed toggle — só desktop */}
          <button
            className={styles.feedToggle}
            onClick={() => setFeedOpen(o => !o)}
            aria-label="Toggle feed"
          >⚡</button>
        </header>

        {/* CONTENT */}
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

      {/* ── CREW TAB (placeholder) ─────────────────────── */}
      {mobileTab === 'crew' && (
        <div className={styles.crewPlaceholder}>
          <span className={styles.welcomeIcon}>👤</span>
          <p>Cadastro de usuários</p>
          <p className={styles.welcomeSub}>Em breve</p>
        </div>
      )}

      {/* ── BOTTOM NAV (mobile only) ──────────────────── */}
      <nav className={styles.bottomNav} aria-label="Navegação principal">
        <button
          className={[styles.navBtn, mobileTab === 'brief' ? styles.navActive : ''].join(' ')}
          onClick={() => setMobileTab('brief')}
          aria-label="Briefing"
        >
          <span className={styles.navIcon}>✈</span>
          <span className={styles.navLabel}>BRIEF</span>
        </button>
        <button
          className={[styles.navBtn, mobileTab === 'feed' ? styles.navActive : ''].join(' ')}
          onClick={() => setMobileTab('feed')}
          aria-label="Atividade"
        >
          <span className={styles.navIcon}>⚡</span>
          <span className={styles.navLabel}>FEED</span>
        </button>
        <button
          className={[styles.navBtn, mobileTab === 'crew' ? styles.navActive : ''].join(' ')}
          onClick={() => setMobileTab('crew')}
          aria-label="Tripulação"
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
