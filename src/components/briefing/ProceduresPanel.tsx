// src/components/briefing/ProceduresPanel.tsx
'use client';
import { useState, useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import { fetchCartas, CartasByTipo, TIPO_ORDER, TIPO_LABEL } from '@/lib/aisweb/cartas';
import styles from './ProceduresPanel.module.css';

interface ProceduresPanelProps {
  dep: string;
  arr: string;
}

// Quais tipos mostrar por aeródromo (DEP vs ARR)
const DEP_TIPOS = ['SID', 'ADC', 'VAC'];
const ARR_TIPOS = ['STAR', 'IAC', 'ARC', 'ADC', 'VAC', 'MINIMA'];

export function ProceduresPanel({ dep, arr }: ProceduresPanelProps) {
  const [depCartas, setDepCartas] = useState<CartasByTipo>({});
  const [arrCartas, setArrCartas] = useState<CartasByTipo>({});
  const [loadingDep, setLoadingDep] = useState(true);
  const [loadingArr, setLoadingArr] = useState(true);
  const [errorDep,   setErrorDep]   = useState<string | null>(null);
  const [errorArr,   setErrorArr]   = useState<string | null>(null);
  const [activeAd,   setActiveAd]   = useState<'dep' | 'arr'>('dep');
  const [activeTipo, setActiveTipo] = useState<string>('SID');

  // Fetch DEP
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

  // Fetch ARR
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

  // Ao trocar de AD, resetar tipo para o primeiro disponível
  useEffect(() => {
    const tipos = activeAd === 'dep' ? DEP_TIPOS : ARR_TIPOS;
    const cartas = activeAd === 'dep' ? depCartas : arrCartas;
    const primeiro = tipos.find(t => (cartas[t]?.length ?? 0) > 0);
    if (primeiro) setActiveTipo(primeiro);
  }, [activeAd, depCartas, arrCartas]);

  const isLoading = activeAd === 'dep' ? loadingDep : loadingArr;
  const error     = activeAd === 'dep' ? errorDep   : errorArr;
  const cartas    = activeAd === 'dep' ? depCartas  : arrCartas;
  const tipos     = (activeAd === 'dep' ? DEP_TIPOS : ARR_TIPOS)
    .filter(t => TIPO_ORDER.includes(t));

  const listaAtiva = cartas[activeTipo] ?? [];

  return (
    <Panel
      title="PROCEDIMENTOS"
      subtitle={`${dep} → ${arr}`}
      status={isLoading ? 'loading' : error ? 'warn' : 'ok'}>

      {/* ── Seletor DEP / ARR ── */}
      <div className={styles.adSelector}>
        <button
          className={activeAd === 'dep' ? styles.adTabActive : styles.adTab}
          onClick={() => setActiveAd('dep')}>
          <span className={styles.adTabLabel}>DEP</span>
          <span className={styles.adTabIcao}>{dep}</span>
          {loadingDep && <span className={styles.adTabSpin} />}
        </button>
        <button
          className={activeAd === 'arr' ? styles.adTabActive : styles.adTab}
          onClick={() => setActiveAd('arr')}>
          <span className={styles.adTabLabel}>ARR</span>
          <span className={styles.adTabIcao}>{arr}</span>
          {loadingArr && <span className={styles.adTabSpin} />}
        </button>
      </div>

      {/* ── Seletor de tipo ── */}
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

      {/* ── Estados ── */}
      {isLoading && (
        <div className={styles.msg}>
          <span className="spin" /> Carregando cartas…
        </div>
      )}
      {error && <div className={styles.warn}>⚠ {error}</div>}

      {/* ── Lista de cartas ── */}
      {!isLoading && !error && listaAtiva.length === 0 && (
        <div className={styles.empty}>
          Nenhuma carta {activeTipo} disponível para {activeAd === 'dep' ? dep : arr}.
        </div>
      )}

      {!isLoading && !error && listaAtiva.length > 0 && (
        <>
          <div className={styles.tipoLabel}>
            {TIPO_LABEL[activeTipo] ?? activeTipo}
          </div>
          <ul className={styles.cartaList}>
            {listaAtiva.map(carta => (
              <li key={carta.id} className={styles.cartaItem}>
                <div className={styles.cartaMain}>
                  <span className={styles.cartaNome}>{carta.nome}</span>
                  {carta.icp && (
                    <span className={styles.cartaIcp}>{carta.icp}</span>
                  )}
                </div>
                <div className={styles.cartaActions}>
                  {carta.tabcode && (
                    <a
                      href={carta.tabcode}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.cartaBtn}
                      title="Tabela de performance">
                      TAB
                    </a>
                  )}
                  <a
                    href={carta.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.cartaBtn} ${styles.cartaBtnPrimary}`}
                    title="Abrir carta PDF">
                    PDF ↗
                  </a>
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.amdt}>
            Emenda {listaAtiva[0]?.amdt} · {listaAtiva[0]?.dt}
          </div>
        </>
      )}
    </Panel>
  );
}
