// src/components/ui/Badge.tsx
import styles from './Badge.module.css';

interface BadgeProps {
  label: string;
  variant?: 'vmc' | 'mvfr' | 'ifr' | 'lifr' | 'default';
  size?: 'sm' | 'md';
}

export function Badge({ label, variant = 'default', size = 'md' }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant], styles[size]].join(' ')}>
      {label}
    </span>
  );
}
