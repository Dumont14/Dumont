// src/components/briefing/ProceduresPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import styles from './ProceduresPanel.module.css';

interface ProceduresPanelProps { dep: string; arr: string; }

interface ProcItem {
  nome:        string;
  tipo:        string;
  recommended: boolean;
  tag:         string;
  tagLabel:    string;
  note:        string | null;
}

interface RwyGroup {
  rwy:        string;
  active:     boolean;
  procedures: ProcItem[];
}

interface Recommended {
  nome:     string;
  tipo:     string;
  rwy:      string;
  reasons:  string[];
  tag:      string;
  tagLabel: string;
}

interface IntelData {
  activeRwy:   string | null;
  windSummary: string;
  recommended: Recommended;
  byRwy:       RwyGroup[];
  briefing:    string;
  allCartas:   any[];
}

// Modal PDF proxy
function CartaModal({ carta, onClose }: { carta: any; onClose: () => void }) {
  const idMatch = carta.link?.match(/arquivo=([a-f0-9-]{30,})/i);
  const proxyUrl = idMatch ? `/api/carta-proxy?id=${idMatch[1]}` : carta.link;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalNome}>{carta.nome}</span>
          <div className={styles.modalActions}>
            <a href={carta.link} target="_blank" rel="noopener noreferrer" className={styles.modalBtn}>↓ PDF</a>
            <button className={styles.modalClose} onClick={onClose}>✕</button>
          </div>
        </div>
        <object data={proxyUrl} type="application/pdf" className={styles.modalObject}>
          <div className={styles.modalFallback}>
            <p>PDF não disponível inline.</p>
            <a href={carta.link} target="_blank" rel="noopener noreferrer" className={styles.modalBtn}>Abrir PDF ↗</a>
          </div>
        </object>
      </div>
    </div>
  );
}

// Painel de detalhes — lista completa de cartas
function AllCartasPanel({ cartas }: { cartas: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const [viewer, setViewer] = useState<any>(null);
  const TIPOS = ['SID','STAR','IAC','ARC','ADC','VAC'];
  const grouped: Record<string, any[]> = {};
  cartas.forEach(c => {
    const t = c.tipo?.toUpperCase() ?? 'OUTRO';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(c);
  });

  return (
    <>
      {viewer && <CartaModal carta={viewer} onClose={() => setViewer(null)} />}
      <div className={styles.allCartasWrap}>
        <button className={styles.allCartasToggle} onClick={() => setExpanded(o => !o)}>
          <span className={styles.allCartasLabel}>TODAS AS CARTAS ({cartas.length})</span>
          <span className={styles.chevron}>{expanded ? '▲' : '▼'}</span>
        </button>
        {expanded && (
          <div className={styles.allCartasBody}>
            {TIPOS.filter(t => grouped[t]?.length).map(tipo => (
              <div key={tipo} className={styles.allCartasTipo}>
                <span className={styles.allCartasTipoLabel}>{tipo}</span>
                <ul className={styles.allCartasList}>
                  {grouped[tipo].map((c: any) => (
                    <li key={c.id} className={styles.allCartasItem}>
                      <button className={styles.cartaNomeBtn} onClick={() => setViewer(c)}>{c.nome}</button>
                      <div className={styles.cartaActions}>
                        <button className={`${styles.cartaBtn} ${styles.cartaBtnView}`} onClick={() => setViewer(c)}>VER</button>
                        <a href={c.link} target="_blank" rel="noopener noreferrer" className={`${styles.cartaBtn} ${styles.cartaBtnPrimary}`}>PDF ↗</a>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Componente principal
export function ProceduresPanel({ dep, arr }: ProceduresPanelProps) {
  const [activeAd,  setActiveAd]  = useState<'dep'|'arr'>('dep');
  const [depData,   setDepData]   = useState<IntelData | null>(null);
  const [arrData,   setArrData]   = useState<IntelData | null>(null);
  const [loadingDep, setLoadingDep] = useState(true);
  const [loadingArr, setLoadingArr] = useState(true);
  const [errorDep,  setErrorDep]  = useState<string | null>(null);
  const [errorArr,  setErrorArr]  = useState<string | null>(null);
  const [viewer,    setViewer]    = useState<any>(null);
  const [showBrief, setShowBrief] = useState(false);

  const fetchIntel = (icao: string, type: 'dep'|'arr',
    setData: (d: IntelData) => void,
    setLoading: (v: boolean) => void,
    setError: (e: string|null) => void,
    signal: AbortSignal
  ) => {
    if (!icao || icao.length < 2) { setLoading(false); return; }
    setLoading(true); setError(null);
    fetch(`/api/procedure-intelligence?icao=${icao}&type=${type}`, { signal })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!dep || dep.length < 3) return;
    const ctrl = new AbortController();
    fetchIntel(dep, 'dep', setDepData, setLoadingDep, setErrorDep, ctrl.signal);
    return () => ctrl.abort();
  }, [dep]);

  useEffect(() => {
    if (!arr || arr.length < 3) return;
    const ctrl = new AbortController();
    fetchIntel(arr, 'arr', setArrData, setLoadingArr, setErrorArr, ctrl.signal);
    return () => ctrl.abort();
  }, [arr]);

  const isLoading = activeAd === 'dep' ? loadingDep : loadingArr;
  const error     = activeAd === 'dep' ? errorDep   : errorArr;
  const data      = activeAd === 'dep' ? depData     : arrData;
  const icao      = activeAd === 'dep' ? dep          : arr;

  return (
    <>
      {viewer && <CartaModal carta={viewer} onClose={() => setViewer(null)} />}

      <Panel
        title="PROCEDIMENTOS"
        subtitle={`${dep} → ${arr}`}
        status={isLoading ? 'loading' : error ? 'warn' : 'ok'}>

        {/* Toggle DEP / ARR */}
        <div className={styles.adSelector}>
          {(['dep','arr'] as const).map(ad => (
            <button key={ad}
              className={activeAd === ad ? styles.adTabActive : styles.adTab}
              onClick={() => { setActiveAd(ad); setShowBrief(false); }}>
              <span className={styles.adTabLabel}>{ad.toUpperCase()}</span>
              <span className={styles.adTabIcao}>{ad === 'dep' ? dep : arr}</span>
              {(ad === 'dep' ? loadingDep : loadingArr) && <span className={styles.adTabSpin} />}
            </button>
          ))}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className={styles.loading}>
            <span className={styles.dot}/><span className={styles.dot}/><span className={styles.dot}/>
            <span className={styles.loadingText}>Analisando procedimentos…</span>
          </div>
        )}

        {/* Error */}
        {error && !isLoading && <div className={styles.error}>⚠ {error}</div>}

        {/* Intelligence */}
        {data && !isLoading && (<>

          {/* Vento / pista ativa */}
          {data.windSummary && (
            <div className={styles.windBar}>
              <span className={styles.windLabel}>VENTO</span>
              <span className={styles.windVal}>{data.windSummary}</span>
            </div>
          )}

          {/* Recomendação principal */}
          {data.recommended && (
            <div className={styles.recBox}>
              <div className={styles.recHeader}>
                <span className={styles.recStar}>⭐</span>
                <span className={styles.recLabel}>{activeAd === 'dep' ? 'SID RECOMENDADA' : 'PROCEDIMENTO RECOMENDADO'}</span>
                <span className={styles.recTag}>{data.recommended.tagLabel}</span>
              </div>
              <div className={styles.recNome}>{data.recommended.nome}</div>
              <ul className={styles.recReasons}>
                {data.recommended.reasons.map((r, i) => (
                  <li key={i} className={styles.recReason}>✔ {r}</li>
                ))}
              </ul>
              <button className={styles.briefBtn} onClick={() => setShowBrief(o => !o)}>
                {showBrief ? '▲ Fechar briefing' : '▼ BRIEFING RÁPIDO'}
              </button>
              {showBrief && (
                <div className={styles.briefText}>{data.briefing}</div>
              )}
            </div>
          )}

          {/* Agrupado por RWY */}
          {data.byRwy?.map(group => (
            <div key={group.rwy} className={styles.rwyGroup}>
              <div className={styles.rwyHeader}>
                <span className={styles.rwyLabel}>RWY {group.rwy}</span>
                {group.active && <span className={styles.rwyActive}>ATIVA</span>}
              </div>
              <ul className={styles.procList}>
                {group.procedures.map((proc, i) => (
                  <li key={i} className={[styles.procItem, proc.recommended ? styles.procItemRec : ''].join(' ')}>
                    <div className={styles.procTop}>
                      {proc.recommended && <span className={styles.procStar}>⭐</span>}
                      <span className={styles.procNome}>{proc.nome}</span>
                      <span className={styles.procTagLabel}>{proc.tagLabel}</span>
                    </div>
                    {proc.note && <div className={styles.procNote}>{proc.note}</div>}
                    <div className={styles.procActions}>
                      {/* Encontrar carta correspondente */}
                      {(() => {
                        const carta = data.allCartas?.find((c: any) =>
                          c.nome?.trim() === proc.nome?.trim()
                        );
                        return carta ? (
                          <>
                            <button className={`${styles.cartaBtn} ${styles.cartaBtnView}`}
                              onClick={() => setViewer(carta)}>VER</button>
                            <a href={carta.link} target="_blank" rel="noopener noreferrer"
                              className={`${styles.cartaBtn} ${styles.cartaBtnPrimary}`}>PDF ↗</a>
                          </>
                        ) : null;
                      })()}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Todas as cartas */}
          {data.allCartas?.length > 0 && (
            <AllCartasPanel cartas={data.allCartas} />
          )}
        </>)}
      </Panel>
    </>
  );
}
