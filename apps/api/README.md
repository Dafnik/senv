# API

Nitro API with Better Auth, tRPC, and Drizzle ORM over SQLite.

## Getting started

```bash
vp install
vp run db:migrate
vp run @senv/api#dev
```

## Deploying

```bash
vp run @senv/api#build
vp run @senv/api#preview
```

Run these commands from the repository root. Configure `.env` as described in the root README. Build output is written to `dist/apps/api`.
