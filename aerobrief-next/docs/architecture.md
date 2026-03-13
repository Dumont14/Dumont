# Architecture Decisions

## ADR-001 — Next.js as framework
**Decision:** Next.js 14 with App Router  
**Reason:** Zero-config Vercel deploy, unified API routes + frontend, TypeScript-first, ready for SSR/RSC when needed. No build complexity for solo dev.  
**Alternatives rejected:** Vite+React (separate API layer needed), plain HTML (no component reuse).

## ADR-002 — Supabase as backend
**Decision:** Supabase (PostgreSQL + Realtime + Storage)  
**Reason:** Free tier sufficient, Realtime WebSocket out of the box, Storage for photos, RLS for security.  
**Alternatives rejected:** Firebase (vendor lock-in, NoSQL harder for relational data), custom Postgres (operational overhead).

## ADR-003 — Dumont name for voice assistant
**Decision:** "Dumont" as wake word and assistant name  
**Reason:** Iconic Brazilian aviation figure, unique phonetically (good recognition), bilingual-friendly, memorable for the target audience.

## ADR-004 — Client-side Speech API (no external STT service)
**Decision:** Web Speech API (browser-native)  
**Reason:** Zero cost, zero latency round-trip for STT, works offline for recognition, no API key management.  
**Trade-offs:** Chrome/Edge only, requires HTTPS, no custom vocabulary.  
**Future:** If custom vocabulary needed (ICAO phonetics), consider Whisper API.

## ADR-005 — Score decay for community reports
**Decision:** Time-based decay with confirmation extension  
**Reason:** MET conditions change fast (fog clears in 30min). Score decay prevents stale data appearing relevant.  
**Formula:** `expiry = created_at + base_minutes + (confirms × extension_minutes)`  
**Values:** MET 30min+30/confirm, RWY/EQUIP 4h+1h/confirm, OBS/OPS 8h+1h/confirm.

## ADR-006 — Role-weighted confirmations
**Decision:** Confirm weight based on role × category match  
**Reason:** A meteorologist confirming fog is more meaningful than an admin confirming it.  
**Weights:** Expert role match = 3, related role = 2, any other = 1.

## ADR-007 — API key security via server-only routes
**Decision:** All external API calls go through Next.js API routes  
**Reason:** Never expose REDEMET, AISWEB, FAA, or Anthropic keys to the browser.  
**Pattern:** Browser → `/api/*` (server) → External APIs.

## ADR-008 — TypeScript strict mode
**Decision:** `strict: true` in tsconfig  
**Reason:** Solo dev benefits most from catching errors at compile time, not runtime.
