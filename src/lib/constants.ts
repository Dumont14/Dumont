// src/lib/constants.ts
// Single source of truth for roles, categories, reputation levels, decay times
// Import from here everywhere — never hardcode these values

import type { UserRole, ReportCategory, RepLevel } from '@/types';

// ── USER ROLES ───────────────────────────────────────────

export const ROLES: Record<UserRole, { label: string; labelEn: string; cssClass: string }> = {
  nav: { label: 'Navegação Aérea', labelEn: 'Air Navigation / ATC', cssClass: 'rn' },
  plt: { label: 'Piloto/Comandante', labelEn: 'Pilot / Commander',    cssClass: 'rp' },
  met: { label: 'Meteorologia',      labelEn: 'Meteorology',          cssClass: 'rm' },
  ais: { label: 'AIS / NOTAM',       labelEn: 'AIS / NOTAM',          cssClass: 'ra' },
  mnt: { label: 'Manutenção',        labelEn: 'Maintenance',          cssClass: 'rx' },
  adm: { label: 'Administração',     labelEn: 'Administration',       cssClass: 'rd' },
  sci: { label: 'SCI',               labelEn: 'SCI',                  cssClass: 'rs' },
  gnd: { label: 'Equipe de Solo',    labelEn: 'Ground Crew',          cssClass: 'rg' },
};

export const ROLE_LIST = Object.entries(ROLES) as [UserRole, (typeof ROLES)[UserRole]][];

// ── REPORT CATEGORIES ────────────────────────────────────

export const CATEGORIES: Record<ReportCategory, {
  label: string;
  labelEn: string;
  icon: string;
  color: string;
  decayMinutes: number;       // base expiry
  extensionMinutes: number;   // per confirmation
}> = {
  met:   { label: 'Meteorologia',       labelEn: 'Meteorology',        icon: '🌫️', color: 'var(--acc)',  decayMinutes: 30,  extensionMinutes: 30 },
  rwy:   { label: 'Pista / Taxiway',    labelEn: 'Runway / Taxiway',   icon: '✈️', color: 'var(--red)',  decayMinutes: 240, extensionMinutes: 60 },
  equip: { label: 'Equipamento',        labelEn: 'Equipment',          icon: '📡', color: 'var(--amb)',  decayMinutes: 240, extensionMinutes: 60 },
  obs:   { label: 'Obstáculo',          labelEn: 'Obstacle',           icon: '🚧', color: 'var(--purp)', decayMinutes: 480, extensionMinutes: 60 },
  ops:   { label: 'Seg. Operacional',   labelEn: 'Operational Safety', icon: '⚠️', color: 'var(--grn)',  decayMinutes: 480, extensionMinutes: 60 },
};

export const CATEGORY_LIST = Object.entries(CATEGORIES) as [ReportCategory, (typeof CATEGORIES)[ReportCategory]][];

// ── REPUTATION LEVELS ────────────────────────────────────

export const REP_LEVELS: Record<RepLevel, {
  label: string;
  minScore: number;
  cssClass: string;
  description: string;
}> = {
  observer: { label: 'Observer', minScore: 0,   cssClass: 'rep-observer', description: 'New user, building reputation' },
  reporter: { label: 'Reporter', minScore: 8,   cssClass: 'rep-reporter', description: 'Reports confirmed by others' },
  trusted:  { label: 'Trusted',  minScore: 30,  cssClass: 'rep-trusted',  description: 'Consistently accurate reports' },
  expert:   { label: 'Expert',   minScore: 100, cssClass: 'rep-expert',   description: 'Highly trusted operational source' },
};

/** Confirmation weight based on role × category match */
export function getConfirmWeight(role: UserRole, category: ReportCategory): number {
  if (category === 'met'   && ['met', 'nav', 'plt'].includes(role))    return 3;
  if (category === 'rwy'   && ['nav', 'gnd', 'mnt'].includes(role))    return 3;
  if (category === 'equip' && ['nav', 'mnt', 'ais'].includes(role))    return 3;
  if (category === 'obs'   && ['nav', 'gnd', 'mnt'].includes(role))    return 2;
  if (category === 'ops'   && ['nav', 'plt', 'met', 'ais'].includes(role)) return 2;
  return 1;
}

// ── OFFICIAL SOURCES ─────────────────────────────────────

export const OFFICIAL_SOURCES = [
  { label: 'REDEMET', url: 'https://www.redemet.aer.mil.br',   description: 'Brazilian military meteorology' },
  { label: 'AISWEB',  url: 'https://www.aisweb.aer.mil.br',    description: 'Brazilian AIS and NOTAMs' },
  { label: 'DECEA',   url: 'https://www.decea.mil.br',          description: 'Brazilian airspace authority' },
  { label: 'NOAA AWC',url: 'https://aviationweather.gov',       description: 'US/International weather' },
  { label: 'ICAO',    url: 'https://www.icao.int',              description: 'International standards' },
] as const;
