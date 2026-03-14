// src/components/ui/Disclaimer.tsx
'use client';
import { useEffect, useState } from 'react';
import styles from './Disclaimer.module.css';

export function Disclaimer() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading]   = useState(false);

  useEffect(() => {
    // começa a fade após 4s, some completamente em 5s
    const fadeTimer = setTimeout(() => setFading(true), 4000);
    const hideTimer = setTimeout(() => setVisible(false), 5200);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={[styles.banner, fading ? styles.fadeOut : ''].join(' ')}
      role="alert"
      aria-label="Aviso de fontes oficiais"
    >
      <span className={styles.icon}>⚠</span>
      <p className={styles.text}>
        <strong>Informação complementar.</strong>{' '}
        Não substitui fontes oficiais.{' '}
        O piloto em comando é a autoridade final.
      </p>
    </div>
  );
}
