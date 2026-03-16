'use client';

import { useState, useCallback, useEffect } from 'react';
import { Disclaimer }    from '@/components/ui/Disclaimer';
import { BriefingCard }  from '@/components/briefing/BriefingCard';
import { RoutePanel }    from '@/components/briefing/RoutePanel';
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
  const [voiceTranscription, setVoiceTranscription] = useState(''); // NOVO: controla modal de voz

  const runBriefing = useCallback(() => {
    const d = dep.trim().toUpperCase();
    if (d.length < 2) return;
    setActiveDep(d);
    setActiveArr(arr.trim().toUpperCase());
    setMobileTab('brief');
    // NOVO: limpar transcrição anterior
    setVoiceTranscription('');
  }, [dep, arr]);

  const handleDumontIcao = useCallback((d: string, a?: string) => {
    setDep(d);
    setArr(a || '');
    setActiveDep(d);
    setActiveArr(a || '');
    setMobileTab('brief');
    // NOVO: limpar transcrição após processar
    setVoiceTranscription('');
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // NOVO: limpar transcrição antes de buscar
      setVoiceTranscription('');
      runBriefing();
    }
  };

  // NOVO: handler para limpar campos e estado de voz
  const handleClearAll = useCallback(() => {
    setDep('');
    setArr('');
    setActiveDep('');
    setActiveArr('');
    setVoiceTranscription('');
  }, []);

  const hasRoute = !!(activeDep && activeArr);

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
                  onFocus={() => setVoiceTranscription('')} // NOVO: limpar ao focar
                  placeholder="SBSP"
                  maxLength={4}
                  autoComplete="off"
                  disabled={voiceTranscription !== ''} // NOVO: bloquear enquanto há transcrição
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
                  onFocus={() => setVoiceTranscription('')} // NOVO: limpar ao focar
                  placeholder="SBBE"
                  maxLength={4}
                  autoComplete="off"
                  disabled={voiceTranscription !== ''} // NOVO: bloquear enquanto há transcrição
                />
              </div>
            </div>
            <button 
              className={styles.briefBtn} 
              onClick={runBriefing}
              disabled={voiceTranscription !== ''} // NOVO: bloquear botão
            >
              BRIEF
            </button>
          </div>

          <div className={styles.headerRight}>
            <button
              className={styles.feedToggle}
              onClick={() => setFeedOpen(o => !o)}
              aria-label="Toggle feed"
            >⚡</button>
          </div>
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
            <>
              {/* ── CARDS DE AD ── */}
              {/* Desktop: 1 coluna (só DEP) ou 2 colunas (DEP+ARR) */}
              {/* Mobile: carrossel horizontal com snap */}
              <div className={[styles.carousel, hasRoute ? styles.carouselTwo : styles.carouselOne].join(' ')}>
                <div className={styles.carouselTrack}>
                  <div className={styles.carouselItem}>
                    <BriefingCard icao={activeDep} label="DEP" />
                  </div>
                  {activeArr && (
                    <div className={styles.carouselItem}>
                      <BriefingCard icao={activeArr} label="ARR" />
                    </div>
                  )}
                  {/* Card de rota — só no carrossel mobile quando há ARR */}
                  {activeArr && (
                    <div className={[styles.carouselItem, styles.carouselRoute].join(' ')}>
                      <RoutePanel dep={activeDep} arr={activeArr} />
                    </div>
                  )}
                </div>

                {/* Indicadores de scroll (mobile) */}
                {hasRoute && (
                  <div className={styles.carouselDots}>
                    <span className={styles.carouselDot} />
                    <span className={styles.carouselDot} />
                    <span className={styles.carouselDot} />
                  </div>
                )}
              </div>

              {/* ── ROTA (desktop) — abaixo dos dois cards ── */}
              {activeArr && (
                <div className={styles.routeDesktop}>
                  <RoutePanel dep={activeDep} arr={activeArr} />
                </div>
              )}
            </>
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

      {/* NOVO: passar estado de transcrição para DumontButton */}
      <DumontButton 
        onIcaoDetected={handleDumontIcao}
        voiceTranscription={voiceTranscription}
        onVoiceTranscriptionChange={setVoiceTranscription}
        onClearAll={handleClearAll}
      />

      {feedOpen && (
        <div className={styles.overlay} onClick={() => setFeedOpen(false)} aria-hidden />
      )}
    </div>
  );
}
