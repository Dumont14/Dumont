// src/components/briefing/ProceduresPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import { fetchCartas, CartasByTipo, TIPO_ORDER, TIPO_LABEL, Carta } from '@/lib/aisweb/cartas';
import styles from './ProceduresPanel.module.css';

interface ProceduresPanelProps { dep: string; arr: string; }

const DEP_TIPOS = ['SID', 'ADC', 'VAC'];
const ARR_TIPOS = ['STAR', 'IAC', 'ARC', 'ADC', 'VAC', 'MINIMA'];

// Extrai UUID do link AISWEB
function extractId(link: string): string | null {
  const m = link.match(/arquivo=([a-f0-9-]{30,})/i);
  return m ? m[1] : null;
}

// ── Modal viewer ──────────────────────────────────────────
function CartaModal({ carta, onClose }: { carta: Carta; onClose: () => void }) {
  const id = extractId(carta.link);
  const proxyUrl = id ? `/api/carta-proxy?id=${id}` : carta.link;

  // Fechar com Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalNome}>{carta.nome}</span>
          <div className={styles.modalActions}>
            {carta.tabcode && (
              <a href={carta.tabcode} target="_blank" rel="noopener noreferrer" className={styles.modalBtn}>
                TAB
              </a>
            )}
            <a href={carta.link} target="_blank" rel="noopener noreferrer" className={styles.modalBtn}>
              ↓ PDF
            </a>
            <button className={styles.modalClose} onClick={onClose}>✕</button>
          </div>
        </div>
        <div className={styles.modalBody}>
          <object
            data={proxyUrl}
            type="application/pdf"
            className={styles.modalObject}>
            <div className={styles.modalFallback}>
              <p>Não foi possível exibir o PDF inline.</p>
              <a href={carta.link} target="_blank" rel="noopener noreferrer" className={styles.modalBtn}>
                Abrir PDF ↗
              </a>
            </div>
          </object>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────
export function ProceduresPanel({ dep, arr }: ProceduresPanelProps) {
  const [depCartas, setDepCartas] = useState<CartasByTipo>({});
  const [arrCartas, setArrCartas] = useState<CartasByTipo>({});
  const [loadingDep, setLoadingDep] = useState(true);
  const [loadingArr, setLoadingArr] = useState(true);
  const [errorDep,   setErrorDep]   = useState<string | null>(null);
  const [errorArr,   setErrorArr]   = useState<string | null>(null);
  const [activeAd,   setActiveAd]   = useState<'dep'|'arr'>('dep');
  const [activeTipo, setActiveTipo] = useState<string>('SID');
  const [viewer,     setViewer]     = useState<Carta | null>(null);

  useEffect(() => {
    if (!dep) return;
    setLoadingDep(true); setErrorDep(null); setDepCartas({});
    const ctrl = new AbortController();
    fetchCartas(dep, ctrl.signal)
      .then(setDepCartas)
      .catch(e => { if (e.name !== 'AbortError') setErrorDep(e.message); })
      .finally(() => setLoadingDep(false));
    return () => ctrl.abort();
  }, [dep]);

  useEffect(() => {
    if (!arr) return;
    setLoadingArr(true); setErrorArr(null); setArrCartas({});
    const ctrl = new AbortController();
    fetchCartas(arr, ctrl.signal)
      .then(setArrCartas)
      .catch(e => { if (e.name !== 'AbortError') setErrorArr(e.message); })
      .finally(() => setLoadingArr(false));
    return () => ctrl.abort();
  }, [arr]);

  useEffect(() => {
    const tipos = activeAd === 'dep' ? DEP_TIPOS : ARR_TIPOS;
    const cartas = activeAd === 'dep' ? depCartas : arrCartas;
    const primeiro = tipos.find(t => (cartas[t]?.length ?? 0) > 0);
    if (primeiro) setActiveTipo(primeiro);
    setViewer(null);
  }, [activeAd, depCartas, arrCartas]);

  const isLoading  = activeAd === 'dep' ? loadingDep : loadingArr;
  const error      = activeAd === 'dep' ? errorDep   : errorArr;
  const cartas     = activeAd === 'dep' ? depCartas  : arrCartas;
  const tipos      = (activeAd === 'dep' ? DEP_TIPOS : ARR_TIPOS).filter(t => TIPO_ORDER.includes(t));
  const listaAtiva = cartas[activeTipo] ?? [];

  return (
    <>
      {/* Modal fora do Panel para overlay full-screen */}
      {viewer && <CartaModal carta={viewer} onClose={() => setViewer(null)} />}

      <Panel
        title="PROCEDIMENTOS"
        subtitle={`${dep} → ${arr}`}
        status={isLoading ? 'loading' : error ? 'warn' : 'ok'}>

        {/* DEP / ARR */}
        <div className={styles.adSelector}>
          {(['dep','arr'] as const).map(ad => (
            <button
              key={ad}
              className={activeAd === ad ? styles.adTabActive : styles.adTab}
              onClick={() => setActiveAd(ad)}>
              <span className={styles.adTabLabel}>{ad.toUpperCase()}</span>
              <span className={styles.adTabIcao}>{ad === 'dep' ? dep : arr}</span>
              {(ad === 'dep' ? loadingDep : loadingArr) && <span className={styles.adTabSpin} />}
            </button>
          ))}
        </div>

        {/* Tipo tabs */}
        {!isLoading && !error && (
          <div className={styles.tipoSelector}>
            {tipos.map(tipo => {
              const count = cartas[tipo]?.length ?? 0;
              return (
                <button
                  key={tipo}
                  className={activeTipo === tipo ? styles.tipoTabActive : styles.tipoTab}
                  onClick={() => setActiveTipo(tipo)}
                  disabled={count === 0}>
                  {tipo}
                  {count > 0 && <span className={styles.tipoCount}>{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        {isLoading && <div className={styles.msg}><span className="spin" /> Carregando cartas…</div>}
        {error && <div className={styles.warn}>⚠ {error}</div>}

        {!isLoading && !error && (
          listaAtiva.length === 0 ? (
            <div className={styles.empty}>
              Nenhuma carta {activeTipo} para {activeAd === 'dep' ? dep : arr}.
            </div>
          ) : (
            <>
              <div className={styles.tipoLabel}>{TIPO_LABEL[activeTipo] ?? activeTipo}</div>
              <ul className={styles.cartaList}>
                {listaAtiva.map(carta => (
                  <li key={carta.id} className={styles.cartaItem}>
                    <button className={styles.cartaNomeBtn} onClick={() => setViewer(carta)}>
                      {carta.nome}
                    </button>
                    {carta.icp && <span className={styles.cartaIcp}>{carta.icp}</span>}
                    <div className={styles.cartaActions}>
                      {carta.tabcode && (
                        <a href={carta.tabcode} target="_blank" rel="noopener noreferrer" className={styles.cartaBtn}>
                          TAB
                        </a>
                      )}
                      <button
                        className={`${styles.cartaBtn} ${styles.cartaBtnView}`}
                        onClick={() => setViewer(carta)}>
                        VER
                      </button>
                      <a
                        href={carta.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${styles.cartaBtn} ${styles.cartaBtnPrimary}`}>
                        PDF ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
              <div className={styles.amdt}>Emenda {listaAtiva[0]?.amdt} · {listaAtiva[0]?.dt}</div>
            </>
          )
        )}
      </Panel>
    </>
  );
}
