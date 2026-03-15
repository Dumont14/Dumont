// src/types/index.ts

// ── Users & Reputation ──────────────────────────────────
export type UserRole = 'nav' | 'plt' | 'met' | 'ais' | 'mnt' | 'adm' | 'sci' | 'gnd';
export type RepLevel = 'observer' | 'reporter' | 'trusted' | 'expert';

export interface User {
  id: string; name: string; role: UserRole;
  phone?: string | null; visible: boolean;
  rep_score: number; rep_level: RepLevel;
  post_count: number; confirm_count: number; created_at: string;
}

// ── Field Reports ───────────────────────────────────────
export type ReportCategory = 'met' | 'rwy' | 'equip' | 'obs' | 'ops';

export interface Report {
  id: string; user_id: string; icao: string;
  category: ReportCategory; title: string;
  body?: string | null; photo_url?: string | null;
  score: number; raw_confirms: number; weighted_confirms: number;
  is_active: boolean; expires_at?: string | null;
  created_at: string; updated_at: string;
  ab_users?: Pick<User, 'id' | 'name' | 'role' | 'rep_level'>;
  minutes_left?: number | null;
}

export interface Confirmation {
  id: number; post_id: string; user_id: string;
  weight: number; created_at: string;
}

// ── Activity Feed ───────────────────────────────────────
export interface ActivityEvent {
  id: number; user_id: string;
  icao_dep: string; icao_arr?: string | null; created_at: string;
  ab_users?: Pick<User, 'id' | 'name' | 'role' | 'visible'>;
}

// ── Weather ─────────────────────────────────────────────
export type FlightCategory = 'VMC' | 'MVFR' | 'IFR' | 'LIFR';

export interface DecodedMetar {
  raw?: string; wdir?: string; wspdS?: string; wgust?: string | null;
  vis?: string; cavok?: boolean; clouds: CloudLayer[];
  ceil?: number | null; temp?: string; dew?: string;
  qnh?: string; wx?: string | null; auto?: boolean; obsTime?: string | null;
}

export interface CloudLayer { cov: string; alt: number | null; tp: string; }

export interface AerodromeData {
  icao: string;
  metar: string | null; metarErr?: string | null;
  taf: string | null;   tafErr?: string | null;
  notam: unknown;       notamErr?: string | null;
}

// ── NOTAMs ──────────────────────────────────────────────
export type NotamSeverity = 'crit' | 'warn' | 'info';

export interface ParsedNotam {
  id: string; text: string; from: string; to: string;
  sev: NotamSeverity; cat: { l: string; c: string };
}

export interface ScheduleStatus {
  raw:          string;   // "MON-FRI 1030-1300"
  closedNow:    boolean;
  openNow:      boolean;
  nextChange:   string;   // "Abre às 13:00Z"
  closedPeriod: string;   // "Seg-Sex 10:30–13:00Z"
  openPeriod:   string;   // "Aberto fora desse período"
}

export interface ParsedNotamEx extends ParsedNotam {
  notamNum:  string;            // "G0576/26"
  schedule?: ScheduleStatus;
  validFrom: string;            // "12/03/2026 13:14Z"
  validTo:   string;            // "31/03/2026 13:00Z"
}

export interface AtsHours {
  raw: string; open: number; close: number;
  isH24: boolean; isOpen: boolean;
  closingSoon: boolean; opensIn?: number;
}

// ── Airport Information ─────────────────────────────────
export interface Frequency {
  type: string; mhz: string; description: string;
}

export interface Runway {
  ident:    string;
  length_m: number;
  width_m:  number;
  surface:  string;
  closed:   boolean;
  tora_le?: number | null;
  tora_he?: number | null;
}

export interface AirportInfo {
  icao:        string;
  name:        string;
  city:        string;
  uf:          string;
  lat:         string;
  lng:         string;
  alt_ft:      string;
  utc:         string;
  type_opr:    string;
  type_util:   string;
  ats_hours:   string;
  frequencies: Frequency[];
  runways:     Runway[];
  remarks:     string[];
  fuel:        string;
  source:      'aisweb' | 'ourairports';
}

// ── Voice / Dumont ──────────────────────────────────────
export type VoiceIntent = 'aerodrome' | 'route';
export type VoiceLang   = 'pt' | 'en';

export interface VoiceRequest  { text: string; lang?: string; }

export interface VoiceResponse {
  reply: string; icao: string | null; icao_arr?: string | null;
  type: VoiceIntent | 'error'; lang: VoiceLang;
}

// ── API ─────────────────────────────────────────────────
export interface ApiError { error: string; }
export type ApiResult<T> = T | ApiError;
export function isApiError(res: unknown): res is ApiError {
  return typeof res === 'object' && res !== null && 'error' in res;
}
