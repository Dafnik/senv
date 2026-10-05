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

## Backend structure

The backend groups code by feature under `server/features/`:

| Feature         | Responsibilities                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `projects`      | Project identity, membership, invitations, access checks, preview slugs, and defaults for future deployments       |
| `deployments`   | Publication, lifecycle, tags, branch selection, artifacts, retained history, audit, logs, and runtime coordination |
| `auth`          | Sessions, instance setup, account signup, password recovery, and account administration                            |
| `admin`         | Instance deployment defaults and account statistics                                                                |
| `notifications` | Email rendering and delivery, plus the development inbox                                                           |

Within a feature, `services/` contains application rules and coordinates operations. `repositories/` contains Drizzle queries or file persistence. Services own transaction boundaries and pass the existing transaction handle into repository operations so related writes commit or roll back together. Repository code does not import services or transport handlers.

Feature routers and project procedure files validate tRPC requests and call services. Better Auth configuration and hooks stay with the feature they configure. `deployments/runtime/` contains Docker container coordination, preview proxy configuration, and artifact processing. `deployments/storage/` contains the storage location and locking. Feature integration tests live in `tests/`; runtime and small module tests also sit beside their implementation.

`server/infrastructure/` contains the database connection, environment configuration, and Docker client. `server/trpc/` contains shared transport setup and composes the feature routers. Nitro's `api/`, `routes/`, `plugins/`, and `middleware/` directories remain framework entry points. `shared/` contains the schemas and types consumed by both the API and Angular app; Drizzle's schema and migrations remain at the repository root.

Add new behavior to the feature that owns it. Keep database queries in that feature's repositories and import cross-feature operations from their owning module. Use the deployments entry point for deployment operations only. Services and repositories can be functions; their responsibility and directory determine the boundary.

## Resource history

The deployment runtime collects origin CPU and memory working-set samples every 30 seconds, independently of open browser sessions. Samples are stored in SQLite and retained for 20 minutes. The resource-history endpoint enforces the same project read permissions as live resources. Missing, stopped, or unavailable origins create gaps rather than zero values. Removing a deployment clears its resource samples.

Apply the database migrations before starting an updated API (`vp run db:migrate`).
