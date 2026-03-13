# AeroBrief

**Operational Aviation Briefing System with Dumont Voice Assistant**

Real-time METAR · TAF · NOTAMs · Community Field Reports · AI Summaries

---

## Stack

| Layer       | Technology |
|-------------|------------|
| Frontend    | Next.js 14 (App Router) + TypeScript |
| Hosting     | Vercel (zero-config deploy) |
| Database    | Supabase (PostgreSQL + Realtime + Storage) |
| AI          | Anthropic Claude (briefing + voice) |
| Voice       | Web Speech API (browser-native, no cost) |

---

## Project Structure

```
aerobrief/
├── src/
│   ├── app/
│   │   ├── api/                   ← Next.js API routes (server-side)
│   │   │   ├── metar/route.ts
│   │   │   ├── taf/route.ts
│   │   │   ├── notam/route.ts
│   │   │   ├── voice/route.ts     ← Dumont voice endpoint
│   │   │   ├── posts/route.ts     ← Field reports
│   │   │   ├── confirm/route.ts   ← Confirmations
│   │   │   ├── upload/route.ts    ← Photo upload
│   │   │   ├── user/route.ts      ← User profiles
│   │   │   └── activity/route.ts  ← Activity feed
│   │   ├── briefing/              ← Briefing page (future: shareable links)
│   │   ├── admin/                 ← Admin panel (future)
│   │   ├── layout.tsx
│   │   └── page.tsx               ← Main app
│   │
│   ├── components/
│   │   ├── briefing/              ← MetarPanel, TafPanel, NotamPanel, RoutePanel
│   │   ├── dumont/                ← DumontButton, DumontBubble, VoiceWave
│   │   ├── feed/                  ← ActivityFeed, FeedItem
│   │   ├── reports/               ← ReportCard, NewReportModal, ConfirmButton
│   │   └── ui/                    ← Badge, Panel, Disclaimer, Header, SearchBar
│   │
│   ├── lib/
│   │   ├── weather/
│   │   │   ├── index.ts           ← fetchMetar, fetchTaf (REDEMET + NOAA routing)
│   │   │   └── metar.ts           ← decodeMetar, getFlightCategory, highlightMetar
│   │   ├── notam/
│   │   │   └── index.ts           ← fetchNotams (AISWEB + FAA), parseNotams
│   │   ├── voice/
│   │   │   └── intent.ts          ← parseVoiceIntent, detectLang
│   │   ├── supabase/
│   │   │   ├── client.ts          ← browser client (anon key)
│   │   │   └── server.ts          ← server client (service key)
│   │   └── constants.ts           ← ROLES, CATEGORIES, REP_LEVELS, OFFICIAL_SOURCES
│   │
│   ├── hooks/                     ← useMetar, useDumont, useActivityFeed, useUser
│   ├── types/
│   │   └── index.ts               ← All TypeScript types
│   └── styles/
│       └── globals.css            ← CSS variables, animations, utilities
│
├── public/
│   └── icons/                     ← PWA icons (future)
│
├── docs/                          ← Architecture decisions, API docs
├── tests/                         ← Jest unit tests
├── .github/workflows/             ← CI/CD (lint, test on push)
│
├── .env.example                   ← Environment variable template
├── next.config.js
├── tsconfig.json
├── package.json
└── CHANGELOG.md
```

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USER/aerobrief.git
cd aerobrief
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                   # http://localhost:3000
```

### 2. Supabase Setup

1. Create free project at [supabase.com](https://supabase.com)
2. Run `supabase_schema_v2.sql` in SQL Editor
3. Storage → New bucket → `aerobrief-posts` → Public: **ON**
4. Settings → API → copy URL and keys to `.env.local`

### 3. Deploy to Vercel

```bash
vercel deploy
# then add all env vars in Vercel → Settings → Environment Variables
```

---

## API Keys Required

| Key | Source | Required |
|-----|--------|----------|
| `ANTHROPIC_KEY` | [console.anthropic.com](https://console.anthropic.com) | AI briefing + Dumont |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings | Feed + reports |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings | Feed + reports |
| `SUPABASE_SERVICE_KEY` | Supabase project settings | API writes |
| `REDEMET_KEY` | [dashboard.redemet.aer.mil.br](https://dashboard.redemet.aer.mil.br) | BR airports MET |
| `AISWEB_USER` + `AISWEB_PASS` | [aisweb.aer.mil.br](https://www.aisweb.aer.mil.br) | BR NOTAMs |
| `FAA_CLIENT_ID` + `FAA_CLIENT_SECRET` | [api.faa.gov](https://api.faa.gov) | International NOTAMs |

> NOAA (international METAR/TAF) is free with no key required.

---

## Dumont Voice Commands

| Phrase | Action |
|--------|--------|
| *"Dumont, condições de SBSP"* | Aerodrome briefing PT |
| *"Dumont, conditions at KJFK"* | Aerodrome briefing EN |
| *"Dumont, rota SBGR para SBBE"* | Route briefing PT |
| *"Dumont, route SBSP to EGLL"* | Route briefing EN |

> Requires Chrome or Edge. HTTPS required (automatic on Vercel).

---

## Disclaimer

AeroBrief **does not replace official sources**. Always verify with
[REDEMET](https://www.redemet.aer.mil.br), [AISWEB](https://www.aisweb.aer.mil.br),
[DECEA](https://www.decea.mil.br), [NOAA AWC](https://aviationweather.gov) and
[ICAO](https://www.icao.int) before any operational decision.
