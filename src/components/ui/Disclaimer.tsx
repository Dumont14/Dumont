// src/components/ui/Disclaimer.tsx
'use client';
import { useEffect, useState } from 'react';
import { OFFICIAL_SOURCES } from '@/lib/constants';
import styles from './Disclaimer.module.css';

export function Disclaimer() {
  const [textVisible, setTextVisible] = useState(true);
  const [textFading,  setTextFading]  = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setTextFading(true), 4000);
    const hideTimer = setTimeout(() => setTextVisible(false), 5200);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  return (
    <div className={styles.banner} role="complementary" aria-label="Fontes oficiais">

      {/* Texto de aviso — some após 5s */}
      {textVisible && (
        <p className={[styles.text, textFading ? styles.textFade : ''].join(' ')}>
          <span className={styles.icon}>⚠</span>
          <strong>Informação complementar.</strong>{' '}
          Não substitui fontes oficiais.{' '}
          O piloto em comando é a autoridade final.
        </p>
      )}

      {/* Links — sempre visíveis */}
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
