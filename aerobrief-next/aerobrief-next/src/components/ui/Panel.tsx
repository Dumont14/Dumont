// src/components/ui/Panel.tsx
import styles from './Panel.module.css';

interface PanelProps {
  title: string;
  subtitle?: string;
  status?: 'ok' | 'warn' | 'crit' | 'loading' | 'empty';
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Panel({ title, subtitle, status, badge, actions, children, className }: PanelProps) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          {badge}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      <div className={[styles.lbar, status ? styles[status] : ''].join(' ')} />
      <div className={styles.body}>{children}</div>
    </section>
  );
}
