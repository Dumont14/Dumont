// src/components/ui/Disclaimer.tsx
import { OFFICIAL_SOURCES } from '@/lib/constants';
import styles from './Disclaimer.module.css';

export function Disclaimer() {
  return (
    <div className={styles.banner} role="alert" aria-label="Official sources disclaimer">
      <span className={styles.icon}>⚠</span>
      <p className={styles.text}>
        <strong>AeroBrief não substitui fontes oficiais.</strong>{' '}
        Sempre verifique antes de qualquer decisão operacional.{' '}
        AeroBrief does not replace official sources. Always verify before any operational decision.
      </p>
      <nav className={styles.links} aria-label="Official sources">
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
