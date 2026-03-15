interface ParsedNotam {
  id: string;
  text: string;
  from: string;
  to: string;
  sev: string;
  cat: { l: string; c: string };
}

const CRIT_PATTERNS: RegExp[] = [
  /AD\s{0,6}CLSD/i,
  /AEROD[RÓO]DROMO\s{0,10}FECHA/i,
  /AIRPORT\s{0,10}CLOS/i,
  /CLSD\s{0,10}DUE/i,
  /FECHAD[OA]\s{0,10}(PARA|POR|DUE)/i,
  /RWY.{0,15}CLSD/i,
  /CLSD.{0,15}RWY/i,
  /RUNWAY.{0,10}CLOS/i,
  /PISTA.{0,10}FECHA/i,
  /ILS.{0,8}(U\/S|INOP|UNSERV|INDISPON)/i,
  /LOC.{0,8}(U\/S|INOP|UNSERV)/i,
  /GS.{0,8}(U\/S|INOP|UNSERV)/i,
  /GP.{0,8}(U\/S|INOP|UNSERV)/i,
  /VOR.{0,8}(U\/S|INOP|UNSERV)/i,
  /NDB.{0,8}(U\/S|INOP|UNSERV)/i,
  /DME.{0,8}(U\/S|INOP|UNSERV)/i,
  /FUEL.{0,15}(UNAVAIL|NOT AVBL|INDISPON)/i,
  /ABASTEC.{0,15}(INDISPON|SUSPEN|FECHA)/i,
  /HAZARD/i,
  /WIP.{0,20}RWY/i,
];

const WARN_PATTERNS: RegExp[] = [
  /TWY.{0,10}CLSD/i,
  /TAXIWAY.{0,10}CLOS/i,
  /LGT.{0,8}(U\/S|INOP)/i,
  /PAPI.{0,8}(U\/S|INOP)/i,
  /VASI.{0,8}(U\/S|INOP)/i,
  /TWR.{0,8}(CLSD|FECHA|INOP)/i,
  /ATC.{0,8}(CLSD|UNAVAIL)/i,
  /SER\s+ATS/i,
  /AD\s+HR\s+SER/i,
  /OBST/i,
  /CRANE/i,
  /GUINDASTE/i,
];

function getSeverity(text: string): string {
  if (CRIT_PATTERNS.some(r => r.test(text))) return 'crit';
  if (WARN_PATTERNS.some(r => r.test(text)))  return 'warn';
  return 'info';
}

function getCategory(text: string): { l: string; c: string } {
  if (/AD\s{0,4}CLSD|AEROD[RO]DROMO\s{0,6}FECHA|AIRPORT\s{0,6}CLOS/i.test(text))
    return { l: 'AD CLSD', c: 'nr2' };
  if (/RWY|RUNWAY|PISTA/i.test(text))    return { l: 'RWY',   c: 'nr2' };
  if (/ILS|LOC|GS|GP/i.test(text))       return { l: 'ILS',   c: 'na2' };
  if (/VOR|NDB|DME/i.test(text))         return { l: 'NAV',   c: 'na2' };
  if (/TWY|TAXIWAY/i.test(text))         return { l: 'TWY',   c: 'na2' };
  if (/TWR|TOWER|ATC/i.test(text))       return { l: 'ATC',   c: 'nb2' };
  if (/FUEL|ABASTEC/i.test(text))        return { l: 'FUEL',  c: 'na2' };
  if (/AD\s+HR\s+SER|SER\s+ATS/i.test(text)) return { l: 'ATS HR', c: 'nb2' };
  if (/OBST|CRANE|GUINDASTE/i.test(text)) return { l: 'OBST', c: 'nb2' };
  return { l: 'GEN', c: 'ng2' };
}

function parseNotams(raw: unknown, maxItems = 20): ParsedNotam[] {
  if (!raw) return [];

  let items: any[] = [];
  const r = raw as any;

  if (Array.isArray(r.items))          items = r.items;
  else if (Array.isArray(r.notamList)) items = r.notamList;
  else if (Array.isArray(r.notam))     items = r.notam;
  else if (r.notam)                    items = [r.notam];
  else if (Array.isArray(raw))         items = raw;

  return items
    .map((n): ParsedNotam | null => {
      const p  = n;
      const cr = p.coreNOTAMData?.notam;

      const text = String(
        cr?.text         ||
        cr?.originalText ||
        p.text           ||
        p.itemE          ||
        p.e              ||
        p.body           ||
        p.mens           ||
        p.texto          ||
        p.message        ||
        ''
      ).trim();

      if (!text || text === 'undefined') return null;

      return {
        id:   String(cr?.id || p.id || p.notamId || p.numero || '?'),
        text,
        from: String(cr?.effectiveStart || p.startValidity || p.from || p.inicio || p.b || ''),
        to:   String(cr?.effectiveEnd   || p.endValidity   || p.to   || p.fim    || p.c || ''),
        sev:  getSeverity(text),
        cat:  getCategory(text),
      };
    })
    .filter((n): n is ParsedNotam => n !== null)
    .filter(n => n.sev === 'crit' || n.sev === 'warn' || n.cat.l !== 'GEN')
    .sort((a, b: any) => ({ crit: 0, warn: 1, info: 2 } as any)[a.sev] - ({ crit: 0, warn: 1, info: 2 } as any)[b.sev])
    .slice(0, maxItems);
}

const proxyResponse = {
  notamList: [
    {
      id: "B0283/26",
      text: "Q) SBRE/QFALC/IV/NBO/A/000/999/0504S04249W005\nAD CLSD DEVIDO SER MAINT\nORIGEM: SDIA 40C12572\n 09/02/26 08:00 a 20/03/26 14:00 UTC\n FEB 09-20 0800-1400, FEB 23-27 MAR 02-06 09-13 16-20 0930-1400",
      from: "09/02/26 08:00",
      to: "20/03/26 14:00",
      q: "SBRE/QFALC/IV/NBO/A/000/999/0504S04249W005"
    }
  ],
  raw: "<item>...</item>"
}

console.log("NOTAM SENDO ENVIADO:", JSON.stringify(proxyResponse.notamList[0], null, 2));
console.log("\nRESULTADO APOS parseNotams:");
console.log(JSON.stringify(parseNotams(proxyResponse), null, 2));

console.log("\nTESTE SEVERIDADE DIRETA:", getSeverity(proxyResponse.notamList[0].text));
