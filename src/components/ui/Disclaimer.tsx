// src/components/ui/Disclaimer.tsx
'use client';
import { useEffect, useState } from 'react';
import { OFFICIAL_SOURCES } from '@/lib/constants';
import styles from './Disclaimer.module.css';

export function Disclaimer() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading]   = useState(false);

  useEffect(() => {
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
      <nav className={styles.links} aria-label="Fontes oficiais">
        {OFFICIAL_SOURCES.map(s => (
          <a
            key={s.label}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
            title={s.description}
          >
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
