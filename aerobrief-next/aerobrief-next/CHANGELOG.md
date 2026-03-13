# Changelog

All notable changes to AeroBrief are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2025 (Current)

### Added
- METAR + TAF fetching with smart routing (REDEMET for SB*, NOAA for international)
- Critical NOTAM filtering (AISWEB for SB*, FAA for international)
- AI briefing summaries via Claude (Anthropic)
- Flight category display (VMC / MVFR / IFR / LIFR)
- Route briefing: side-by-side DEP → ARR conditions
- **Dumont** voice assistant (Web Speech API + Claude) — bilingual PT/EN
  - Wake word activation ("Dumont")
  - Intent parsing: single aerodrome + route briefing
  - Concise spoken output — only operationally relevant information
- Field Reports system
  - Categories: Meteorologia, Pista/Taxiway, Equipamento, Obstáculo, Seg. Operacional
  - Photo upload (Supabase Storage, max 5MB)
  - Score-based decay (MET: 30min, others: 4–8h)
  - Confirmation system with role-weighted votes
  - Reputation levels: Observer → Reporter → Trusted → Expert
- Activity Feed (Supabase Realtime)
- User profiles with role, opt-in feed visibility
- Official sources disclaimer banner (REDEMET, AISWEB, DECEA, NOAA, ICAO)

### Infrastructure
- Vercel serverless functions (API routes)
- Supabase (PostgreSQL + Realtime + Storage)
- Environment variables for all API keys

---

## Planned

### [0.2.0] — Pending
- [ ] Next.js migration (SSR + TypeScript + component architecture)
- [ ] PWA manifest + offline support
- [ ] Push notifications for confirmed high-score reports
- [ ] Admin / moderation panel

### [0.3.0] — Future
- [ ] Multi-language UI (i18n: PT/EN)
- [ ] Real authentication (email/OAuth)
- [ ] Analytics dashboard
- [ ] Mobile app (React Native)
