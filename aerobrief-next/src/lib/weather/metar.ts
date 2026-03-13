// src/lib/weather/metar.ts
// Pure METAR parsing — no fetch, no side effects
// Converts raw METAR string into structured DecodedMetar

import type { DecodedMetar, CloudLayer, FlightCategory } from '@/types';

export function decodeMetar(raw: string): DecodedMetar {
  const d: DecodedMetar = { raw, clouds: [] };

  // Wind
  const wm = raw.match(/\b(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (wm) {
    d.wdir  = wm[1] === 'VRB' ? 'VRB' : `${wm[1]}°`;
    d.wspdS = `${wm[2]}KT`;
    d.wgust = wm[4] ? `G${wm[4]}KT` : null;
  }

  // Visibility
  const cavok = /CAVOK/i.test(raw);
  if (cavok) {
    d.vis   = '9999';
    d.cavok = true;
  } else {
    const vm = raw.match(/\b(\d{4})\b/);
    if (vm) d.vis = vm[1];
  }

  // Clouds
  const clouds: CloudLayer[] = [];
  const cx = /(FEW|SCT|BKN|OVC|SKC|NSC)(\d{3})?(CB|TCU)?/g;
  let m: RegExpExecArray | null;
  while ((m = cx.exec(raw)) !== null) {
    clouds.push({ cov: m[1], alt: m[2] ? parseInt(m[2]) * 100 : null, tp: m[3] || '' });
  }
  d.clouds = clouds;

  // Ceiling
  const ceil = clouds.find(c => (c.cov === 'BKN' || c.cov === 'OVC') && c.alt !== null);
  d.ceil = ceil ? ceil.alt : cavok ? 9999 : null;

  // Temp / Dew
  const tm = raw.match(/\b(M?)(\d{2})\/(M?)(\d{2})\b/);
  if (tm) {
    d.temp = `${tm[1] ? '-' : ''}${tm[2]}°C`;
    d.dew  = `${tm[3] ? '-' : ''}${tm[4]}°C`;
  }

  // QNH / Altimeter
  const qm = raw.match(/\bQ(\d{4})\b/);
  if (qm) d.qnh = `${qm[1]} hPa`;
  const am = raw.match(/\bA(\d{4})\b/);
  if (am) d.qnh = `${(parseInt(am[1]) / 100).toFixed(2)} inHg`;

  // Present weather
  const wx = raw.match(/\b(-|\+|VC)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS|TS|SH|FZ)\w*\b/g);
  d.wx = wx ? wx.join(' ') : null;

  d.auto    = /\bAUTO\b/.test(raw);
  const ti  = raw.match(/\b\d{6}Z\b/);
  d.obsTime = ti ? ti[0] : null;

  return d;
}

export function getFlightCategory(dec: DecodedMetar): FlightCategory {
  const vis  = parseInt(dec.vis || '0') || (dec.cavok ? 9999 : 0);
  const ceil = dec.ceil ?? 9999;
  if (vis >= 5000 && ceil >= 1500) return 'VMC';
  if (vis >= 1600 && ceil >= 500)  return 'MVFR';
  if (vis >= 800  && ceil >= 200)  return 'IFR';
  return 'LIFR';
}

export function visColor(vis: string | undefined): 'ok' | 'warn' | 'crit' {
  const n = parseInt(vis || '0') || 0;
  if (n >= 5000 || vis === '9999') return 'ok';
  if (n >= 1500)                   return 'warn';
  return 'crit';
}

export function ceilColor(ceil: number | null | undefined): 'ok' | 'warn' | 'crit' | '' {
  if (ceil === null || ceil === undefined) return '';
  if (ceil >= 1500) return 'ok';
  if (ceil >= 500)  return 'warn';
  return 'crit';
}

// Highlight METAR tokens with HTML spans
export function highlightMetar(raw: string): string {
  return raw
    .replace(/\b(\d{6}Z)\b/g,               '<span class="tm">$1</span>')
    .replace(/\b(VRB|\d{3})(\d{2,3})(G\d{2,3})?KT\b/g, '<span class="tw">$&</span>')
    .replace(/\b(\d{4})\b(?=\s)/g,           '<span class="tv">$1</span>')
    .replace(/\bCAVOK\b/g,                   '<span class="tv">CAVOK</span>')
    .replace(/(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?/g, '<span class="tc">$&</span>')
    .replace(/\bM?\d{2}\/M?\d{2}\b/g,        '<span class="tt">$&</span>')
    .replace(/\b[QA]\d{4}\b/g,               '<span class="tq">$&</span>')
    .replace(/\b(-|\+|VC)?(TS|SH|FZ|DZ|RA|SN|BR|FG|HZ)\w*\b/g, '<span class="tx">$&</span>');
}
