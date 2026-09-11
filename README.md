# YourPMS

**YourPMS** is a multi-tenant Practice Management System (PMS) + billing platform for South African medical practices: reception, waiting queue, doctor consultations, invoicing, cash and medical-aid claims, and financial reporting — with server-enforced tenant isolation, location-based authorization and an append-only audit trail.

## Stack

| Layer      | Choice |
|------------|--------|
| Framework  | Next.js 15 (App Router, server components) + React 19 + TypeScript (strict) |
| Database   | SQLite (WAL, FK-enforced) via **Drizzle ORM** with versioned SQL migrations |
| Auth       | Custom session auth: scrypt password hashing, hashed opaque session tokens, secure cookies |
| Security   | CSRF double-submit + Origin/Fetch-Site validation, rate limiting, RBAC, hash-chained audit log |
| Tests      | Vitest (unit + HTTP integration), Playwright (browser E2E) |

> **Portability note:** the repo ships `vendor/better-sqlite3`, a drop-in API-compatible shim over Node's built-in `node:sqlite` used in this sandbox (native compilation unavailable). The application code is driver-agnostic — swap in the real `better-sqlite3` (or port the schema to Postgres via drizzle-kit) with no application changes. The shim transparently rewrites raw-mode SQL with positional aliases so Drizzle's field mapping stays correct for joined queries with duplicate column names.

## Getting started

```bash
npm install
npm run db:migrate      # apply drizzle/ SQL migrations
npm run db:seed         # ICD-10, SAMA-style GP tariffs, SA medical schemes
npm run db:validate     # migration validation (fresh DB, tenant scoping, FK integrity)
npm run dev             # http://localhost:3000
```

A practitioner signs up at `/signup` (creates User → Practice → initial Location → OWNER membership → Practitioner profile) and lands on the practice dashboard. Staff are invited from Settings → Staff; the invitation fixes practice, role and authorized locations.

## Architecture

```
src/
├── db/            schema.ts (33 tables, tenant-scoped) + client
├── lib/           auth (sessions/CSRF/origin), rbac, rate-limit, crypto, errors, money
├── services/      business logic (thin routes, fat services)
│   ├── auth, practice, patients (cross-location + transfers)
│   ├── scheduling (appointments, check-in, waiting queue)
│   ├── encounters (clinical notes, ICD-10, tariff items, completion)
│   ├── billing (invoices, payments, reversals, adjustments)
│   ├── claims (provider-independent engine + adapters)
│   ├── finance (dashboard metrics, encounter financial story)
│   ├── platform (god mode: scoped support access)
│   └── audit (append-only hash-chained trail)
├── app/api/       REST endpoints (authorization on every route)
└── app/(app)/     UI: reception, doctor workspace, patients, billing, finance, settings, audit
```

### Core domain rules

- **Tenant isolation** — every tenant row carries `practice_id`; the practice context is resolved from the authenticated session (DB membership), never from client input. Cross-tenant probes return 404.
- **Location authorization** — staff see only their authorized locations (enforced server-side per request); the practice owner is implicitly authorized for all locations of their practice.
- **Patient identity** — one patient per practice; cross-location treatment grants controlled, audited access (no duplicate records). After the configurable threshold (default 2) of completed alternate-location encounters, the patient is **flagged** for transfer — an authorized user must confirm; history keeps original treating locations.
- **Clinical vs financial state** — encounter workflow `WAITING → WITH_DOCTOR → CONSULTATION_COMPLETE → AWAITING_BILLING → CLOSED`, invoice states `DRAFT/ISSUED/PARTIALLY_PAID/PAID/VOID/ADJUSTED`, claim states `NOT_SUBMITTED/SUBMITTED/ACCEPTED/REJECTED/PROCESSED/FAILED`. **Billed ≠ Claimed ≠ Approved/Processed ≠ Paid** — each tracked separately, including medical-aid shortfalls (patient portion).
- **Claims architecture** — provider-independent core (`Claim`, `ClaimLine`, `ClaimBundle`); provider protocols live in adapters. Ships with `manual` and `simulation` adapters; MediKredit/Healthbridge adapters are deliberately NOT configured (no credentials or official documentation — no invented endpoints).
- **God mode** — platform support access is explicit (mandatory reason), time-limited (5–240 min), read-only, and fully audited; grants bind to the admin's session and expire automatically.
- **Audit trail** — append-only, hash-chained (`sha256(prevHash + record)`), tamper-evident via `verifyAuditChain`.

## Scripts

```bash
npm run verify              # typecheck + lint + build
npm run typecheck | lint | build
npm run db:generate | db:migrate | db:seed | db:validate
npm run test                # vitest: unit + integration suites
npm run test:unit | test:integration
npm run test:e2e            # playwright browser tests
```

## Status

Phase 1: PMS + Billing. Deliberately out of scope: marketing sites, website builders, email hosting, telemedicine, patient subscriptions, social features. The architecture (service boundaries, claims adapters, platform layer) is structured so these can be added later without rebuilding the core.

### Notes on compliance & operations

- POPIA-relevant design choices are implemented (least privilege, audit trail, access controls); no legal compliance claims are made.
- Rate limiting is in-memory (single instance); the interface is Redis-ready for horizontal scale.
- Email delivery of staff invitations is a deployment integration; Phase 1 returns the secure invitation link to the inviter.
- Tariff prices in the seed catalogue are representative GP defaults; practices override line prices at charge capture.
