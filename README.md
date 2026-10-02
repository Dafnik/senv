# senv - Angular + Better Auth

Angular 22 with SSR, Better Auth, spartan/ui, and tRPC. The Nitro API uses SQLite through Drizzle ORM, and Drizzle Kit manages the schema and migrations. Vite Plus runs workspace tasks, linting, formatting, and API tests.

## Quick start

The root `package.json` specifies the Node.js version in `engines.node`. CI reads this field through Vite Plus setup.

Install the [Vite Plus CLI](https://viteplus.dev/guide/global-cli), then install dependencies:

```bash
vp install
cp .env.dev .env
```

Set `BETTER_AUTH_SECRET` in `.env`, for example with `openssl rand -base64 32`. The default `DATABASE_URL=file:./data/senv.sqlite` creates a local database under `data/`. Database paths are relative to the working directory, and workspace scripts run database commands and the API from the repository root.

Apply the checked-in migrations and start both apps:

```bash
vp run db:migrate
vp run dev
```

Open [localhost:4200](http://localhost:4200). The API runs on [localhost:3000](http://localhost:3000). SQLite runs in the API process, so development needs no database container.

When the instance has no admin account, the app opens `/setup`. Create the first
instance admin with a name, email, and password. Setup signs you in immediately
without requiring email verification. The account remains unverified until its
owner follows a verification email. Setup closes as soon as any instance admin
exists, including a banned admin, and concurrent setup requests create only one
admin. Existing ordinary accounts are preserved and cannot be claimed by setup.

Public registration is disabled in both the UI and the API. Instance admins can
create accounts under **Users → Add user**, then share the login details with the
user. Project admins can invite these accounts to projects. Instance admin and
project admin are separate roles.

Every account and sign-in requires a valid email address. Internal user IDs remain
generated IDs; email addresses are the login identifiers.

## Workspace commands

```bash
vp run build                 # Angular SSR and Nitro production builds
vp run check                 # Vite Plus checks and Angular Prettier checks
vp run fmt                   # Format the repository
vp run test                  # Database, API, and Angular tests
vp run @senv/api#typecheck     # Check API types
vp run @senv/app#test          # Angular CLI unit tests
```

Each package declares its own dependencies. The root keeps Vite Plus, shared TypeScript tools, and dependencies used by the root database scripts.

Vite Plus replaces Nx. Each app is a workspace package, and build tasks live in its `vite.config.ts`. Angular CLI handles Angular compilation, SSR, and development serving through `apps/app/angular.json`. Angular's test builder uses the same Vitest version bundled with Vite Plus. The app package declares Vitest to supply the builder's required package import; test code imports `vite-plus/test`.

Prettier and its import and Tailwind plugins are configured in `apps/app` and format the app and its `apps/app/libs/ui` package, including Angular templates. Vite Plus formats the remaining files and lints TypeScript across the workspace. The old Angular ESLint template rules are no longer run.

pnpm keeps its shared virtual store in `.pnpm` at the repository root. Vite Plus recognizes this store and allows Angular's dev server to serve dependency assets across the workspace boundary.

## UI generators

The spartan CLI is installed for generating and maintaining UI components. Use it through Angular CLI:

```bash
vp run @senv/app#ui:info
vp run @senv/app#ui --name=dialog
```

UI components live inside the app's Angular workspace so generators can update them. Nx is a dependency of the spartan CLI. Vite Plus runs the repository's workspace tasks.

## Database changes

The tables are defined in `drizzle/schema.ts`. After editing them, generate and apply a migration:

```bash
vp run db:generate
vp run db:migrate
```

`vp run db:studio` opens Drizzle Studio. `vp run db:push` applies schema changes directly for local experimentation; use checked-in migrations for deployment.

After changing Better Auth plugins, regenerate its schema and review the changes before generating a migration:

```bash
vp run auth:generate
vp run db:generate
```

The SQLite migrations initialize a new database. They do not transfer existing PostgreSQL data. Export and convert any existing users, accounts, sessions, and verification records separately, including timestamps and booleans.

## SSR preview

```bash
vp run build
APP_DOMAIN=localhost vp run @senv/app#preview
vp run @senv/api#preview
```

The production frontend uses the API URL in `apps/app/src/environments/environment.ts`. Update it for your deployment.

## Docker

Build the apps before building their runtime images:

```bash
vp run build
docker compose -f compose.prod.yml up -d --build
```

The `db-migrate` service applies Drizzle migrations before the API starts. Both services mount the same `db-data` volume and use `file:/data/senv.sqlite`. Keep this volume when recreating containers; it contains the database and SQLite journal files.

Set the authentication URLs and domains in `.env` for your deployment. Nitro includes the SQLite driver's prebuilt binaries for Linux and Alpine in the API output. The Docker publish workflow builds the app, API, and migration images together.

## Projects and invitations

Open **Projects** in the sidebar to create a project. Names can contain 1 to 100
characters. Project IDs are immutable, 21-character Nano IDs using the alphabet
`acdefghjkmnpqrtuvwxy34679` to avoid look-alike characters.

Projects use Better Auth's organization plugin. Its organization ID and internal
slug are the project ID. The creator is an `admin`; `developer` and `viewer` are
separate project roles. All three can view their project and its members. Only
project admins can rename projects, invite users, change member roles, or cancel
invitations. Global user-admin privileges do not grant project membership.
Developers and viewers currently have the same read permissions; future project
resource operations can distinguish them. Better Auth prevents the last project
admin from leaving or demoting themselves.

Run `pnpm db:migrate` before starting an existing installation to add the project,
membership, and invitation tables. Existing accounts and sessions are preserved.

Invitation emails link to `/invitations/:invitationId`. The recipient signs in
using the invited email address, verifies ownership of that email, then accepts
the invitation. The invitation page can send a verification email with a link
that expires after one hour and returns to the same invitation. Knowing an
invitation ID is insufficient without a verified recipient account. Links are
single-use and expire after seven days. Inviting the same address again replaces
its pending invitation. Expired or cancelled invitations cannot be accepted.

### Email delivery

The API renders HTML and plain-text invitations with React Email and sends them
through Nodemailer. Outside development, configure:

- `SMTP_URL`, for example `smtps://username:password@smtp.example.com:465`.
- `EMAIL_FROM`, for example `senv <noreply@example.com>`.
- `APP_URL`, the public app origin used in invitation links.

Missing delivery configuration causes sending to fail instead of discarding the
email. After fixing delivery, invite the address again to issue a fresh link.

During local development (`NODE_ENV=development`), no email is sent. The temporary
`GET /api/notifications` endpoint returns `{ notifications: [...] }`, newest first,
with recipient, subject, rendered HTML, plain text, and timestamps, including
verification emails. It stores the
last 100 messages in memory and clears on API restart. This unauthenticated local
inbox contains invitation links; do not expose the development API publicly.
The endpoint returns 404 outside development.

References: [Better Auth organizations](https://better-auth.com/docs/plugins/organization)
and [React Email's Nodemailer integration](https://react.email/docs/integrations/nodemailer).
