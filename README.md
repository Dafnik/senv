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
and marks the first admin as email verified. Setup closes as soon as any instance admin
exists, including a banned admin, and concurrent setup requests create only one
admin. The last instance admin cannot be deleted or demoted. Instance roles are
singular, either `user` or `admin`; migrations normalize legacy role lists while
preserving administrators. Existing ordinary accounts are preserved and cannot be claimed by setup.

Public registration is disabled in both the UI and the API. Instance admins can
create accounts under **Users → Add user** using a name and email only. The signup
email links to `/signup`, where the recipient chooses and confirms their own
password. Completing signup verifies their email address and logs them in
automatically. Signup links expire after one hour and can only be used once.
Opening a link does not consume it. If delivery fails or a link expires, admins
can choose **Resend signup email** from the user actions. Resending invalidates
the previous link. Pending accounts cannot sign in until they set a password.
Project admins can invite these accounts to projects. Instance admin and project
admin are separate roles. Authenticated users start at `/projects`; unauthenticated
users go to `/login`. There is no public landing page or dashboard.

Signed-in users can view their name and email at `/profile`, using the Profile button beside Logout.
They can request an email verification link to change their password there.
Existing accounts can also request a reset email at `/forgot-password`. Instance admins
can select **Send password reset email** in user actions. Password reset links
expire after one hour, are single-use, and revoke the account's existing sessions
on completion. Admins cannot choose another user's password. Pending accounts use
their signup email instead of password recovery.

Every account and sign-in requires a valid email address. Internal user IDs remain
generated IDs; email addresses are the login identifiers.

Project pages open on **Deployments**, which currently shows an empty state. The
**Members** section at `/projects/:projectId/members` contains the searchable, sortable member table and, for project
admins, the invite form and invitation table. **Settings** contains project
settings at `/projects/:projectId/settings`; project admins and instance admins
can edit them. The default URL is `/projects/:projectId/deployments`. Unsaved name
drafts survive background refreshes, with a warning if the saved name changes.

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
characters. The project list loads more projects as you scroll and only renders
the visible rows. Project IDs are immutable, 21-character Nano IDs using the alphabet
`acdefghjkmnpqrtuvwxy34679` to avoid look-alike characters.

Projects use Better Auth's organization plugin. Its organization ID and internal
slug are the project ID. The creator is an `admin`; `developer` and `viewer` are
separate project roles. All three can view their project and its members. Project admins can rename projects, invite users, change member roles, remove members, or cancel
invitations. Instance admins can view and manage all projects without membership.
They can invite a new admin or change an existing member's role, including when a
project has no members or admins. Removing a member revokes access to that project.
Developers and viewers currently have the same read permissions; future project
resource operations can distinguish them. Better Auth prevents the last project
admin from leaving or demoting themselves.

Run `pnpm db:migrate` before starting an existing installation to add the project,
membership, and invitation tables. Existing accounts and sessions are preserved.

Invitation emails link to `/invitations/:invitationId`. The recipient signs in
using the invited email address and accepts the invitation. **Use another account**
preserves the invitation while signing out and returning to login. Users who completed
account signup are already verified. Older unverified accounts can still request
a verification email from the invitation page. That link expires after one hour
and returns to the same invitation. Knowing an
invitation ID is insufficient without a verified recipient account. Links are
single-use and expire after seven days. Inviting the same address again replaces
its pending invitation. Invalid replacement roles leave the existing link valid.
Expired or cancelled invitations cannot be accepted.

Project admins manage open invitations in a table with email search, sortable
columns, and server pagination. Accepted, canceled, rejected, and expired
invitations are excluded. The member table records who invited each user.
Migration `0003_member_inviter.sql` restores inviter details from accepted invitations
where that history is available and preserves inviter names if their account is deleted.

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
signup, password reset, and verification emails. Each entry includes a `previewUrl` linking to
`GET /notification/:id`, which displays the rendered email. The last 100 messages
are saved as HTML and JSON in `email-notifications/` beside the SQLite database
and survive API restarts. Older messages and their HTML previews are removed. This unauthenticated local
inbox contains invitation links; do not expose the development API publicly.
Both endpoints return 404 outside development.

References: [Better Auth organizations](https://better-auth.com/docs/plugins/organization)
and [React Email's Nodemailer integration](https://react.email/docs/integrations/nodemailer).
