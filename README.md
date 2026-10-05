# senv - Angular + Better Auth

Angular 22 with SSR, Better Auth, spartan/ui, and tRPC. The Nitro API uses SQLite through Drizzle ORM, and Drizzle Kit manages the schema and migrations. Vite Plus runs workspace tasks, linting, formatting, and API tests.

senv means simple environment. The [first deployment feature specification](docs/deployment-feature.md) records deployment behavior, the [glossary](CONTEXT.md) defines the project language, and [architecture decisions](docs/adr/) explain the design. The API runs static and container deployments through a local Docker Engine and routes previews through Traefik.

## Quick start

The root `package.json` specifies the Node.js version in `engines.node`. CI reads this field through Vite Plus setup.

Install the [Vite Plus CLI](https://viteplus.dev/guide/global-cli), then install dependencies:

```bash
vp install
cp .env.dev .env
```

Set `BETTER_AUTH_SECRET` in `.env`, for example with `openssl rand -base64 32`. The default `DATABASE_URL=file:./data/senv.sqlite` creates a local database under `data/`. Database paths are relative to the working directory, and workspace scripts run database commands and the API from the repository root.

Initialize the database and start the apps:

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
singular, either `user` or `admin`. Ordinary accounts cannot be claimed by setup.

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

Project pages open on **Deployments** at `/projects/:projectSlug/deployments`, where
project members can inspect deployments and developers or admins can publish and
manage them. Project slugs are editable route identifiers; immutable project IDs
remain the internal identifiers used by API records. **Members** at
`/projects/:projectSlug/members` contains the searchable, sortable member table and,
for project admins, the invite form and invitation table. **Settings** at
`/projects/:projectSlug/settings` contains project deployment settings;
developers and project admins can edit deployment defaults, while project admins
control the preview slug and retention/resource defaults. Instance admins can
manage instance upload, proxy, and log limits. Unsaved project-name drafts survive
background refreshes, with a warning if the saved name changes.

## CLI and access management

The Commander CLI and its full-screen `senv tui` interface reuse the typed tRPC API, profiles, and credentials. See [the CLI guide](apps/cli/README.md) for installation, browser-approved login, TUI shortcuts, CI tokens, commands, and shell access. Build it with `vp run @senv/cli#build`; package it with `pnpm --filter @senv/cli pack --pack-destination /tmp`.

Profile manages independent browser/CLI sessions and project-scoped automation tokens. `/cli/authorize` requires an explicit review and approval of the terminal code. Automation tokens default to 30 days, accept seconds/days/months/years in the access form, and never expire when the lifetime is empty. They cannot open shells or administer users. Password reset invalidates sessions, tokens, and outstanding device authorizations.

Interactive shells use only the running app/static origin and the container's configured user. The API owns Docker access and verifies deployment labels and current permissions; the CLI needs no local Docker socket. The API ingress must forward WebSocket upgrades at `/api/cli/shell`. Project configuration and instance defaults have no CLI management commands.

## Workspace commands

```bash
vp run build                 # CLI, Angular SSR and Nitro production builds
vp run check                 # Vite Plus checks and Angular Prettier checks
vp run fmt                   # Format the repository
vp run test                  # Database, API, CLI, and Angular tests
vp run @senv/api#typecheck     # Check API types
vp run @senv/cli#typecheck     # Check CLI types
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

`drizzle/schema.ts` exports the table definitions from the adjacent auth, project, and deployment schema modules. After editing a table, generate and apply a migration:

```bash
vp run db:generate
vp run db:migrate
```

`vp run db:studio` opens Drizzle Studio. `vp run db:push` applies schema changes directly for local experimentation; use checked-in migrations for deployment.

After changing Better Auth plugins, generate its schema into `drizzle/auth-schema.generated.ts`. Review that output and merge the required auth changes into `schema-core.ts`, `schema-access.ts`, and `schema-cli.ts` before generating a migration. The generated file is outside the schema export path, so generation preserves the deployment tables:

```bash
vp run auth:generate
vp run db:generate
```

Apply checked-in migrations with `vp run db:migrate` when upgrading. The CLI migration `0002_cli_access.sql` adds device authorization, CLI session metadata, and hashed automation-token tables without deleting existing users, sessions, projects, or deployments. Back up the SQLite database before a production upgrade. `0003_automation_token_optional_expiry.sql` makes token expiry optional while preserving existing credentials. No database reset is required.

## SSR preview

```bash
vp run build
APP_DOMAIN=localhost vp run @senv/app#preview
vp run @senv/api#preview
```

The production frontend uses the API URL in `apps/app/src/environments/environment.ts`. Update it for your deployment.

The project **Artifacts** tab lists uploaded static artifacts used by deployments. Open an artifact to browse its folders with aggregate sizes. Select a file for its path, copy action, metadata, inline image, or Shiki code preview. Other file types offer a download. A shared Download menu on the artifact page and table offers ZIP and tar.gz. Code previews are limited to 256 KiB and image previews to 32 MiB; larger files remain downloadable. The artifact ID in deployment details links to this browser. Project viewers can browse and download artifacts. Source metadata is captured on upload, or on the first publication for older clients, and stays fixed when deployments reuse the artifact. Artifacts keep the existing deployment cleanup policy; container image contents are not included.

## Docker

Build the apps before building their runtime images:

```bash
vp run build
docker compose -f compose.prod.yml up -d --build
```

The `db-migrate` service applies Drizzle migrations before the API starts. The API mounts `db-data` at `/data` and the separate `deployment-data` volume at `/data/deployments`. Keep both volumes when recreating containers. `preview-proxy` is Traefik's public entry point; it reads an atomically replaced route file from the separate `preview-route-data` volume and shares a private Docker network with the API and deployment containers.

Set the authentication URLs and preview address in `.env`. A production instance needs a unique senv namespace and a DNS name that points to the host:

```dotenv
SENV_INSTANCE_ID=main
API_PORT=3000
APP_PORT=4200
PREVIEW_BASE_DOMAIN=preview.example.com
PREVIEW_ENTRYPOINTS=websecure
PREVIEW_TLS=true
PREVIEW_TLS_RESOLVER=letsencrypt
PREVIEW_HTTP_PORT=80
PREVIEW_HTTPS_PORT=443
PREVIEW_TRAEFIK_API_PORT=8080
```

The ID must be a lowercase DNS-safe label no longer than 31 characters and unique for every senv instance sharing the Docker host. Compose uses its project name if `SENV_INSTANCE_ID` is unset; set the variable explicitly when installations share a host or when changing the Compose project name. `API_PORT` and `APP_PORT` publish the API and frontend on host ports 3000 and 4200 by default; their container ports stay 3000 and 4200. When running multiple instances on one host, assign each a distinct Compose project name, senv instance ID, and host port for the API, frontend, HTTP/HTTPS preview entry points, and loopback Traefik API. The preview domain must resolve to Traefik. Configure the `letsencrypt` resolver on `preview-proxy` for your DNS provider, and supply DNS credentials through the host's secret environment. A wildcard certificate for `*.preview.example.com` does not cover `ac3467.project.preview.example.com`; configure per-project wildcard coverage or certificates that include the project label. Traefik wildcard issuance uses a DNS challenge.

The API mounts `/var/run/docker.sock`, which grants it control over containers on the Docker host. Keep this socket restricted to the trusted senv operator. The API creates an instance-labelled private network and only removes containers carrying its own instance labels. Static deployment origins mount the shared artifact volume read-only. Uploaded bytes and expanded website bytes both use the instance upload limit; Static uploads accept ZIP and TAR, including TAR compressed with gzip, zlib/deflate, raw deflate, Brotli, or Zstandard. ZIP supports stored and deflate entries. Multipart uploads, ZIP/TAR extraction, and hashing stream through bounded buffers. Only the atomic storage commit and artifact registration hold the cleanup lock. Archive extraction rejects traversal paths, links, duplicate names, unsupported entries or compression, and expansion over the limit. Image tags are resolved to repository digests before they are stored in a deployment snapshot. Logs from both origin and proxy are retained within the deployment's captured rotation allowance, including across API restarts.

For local HTTP previews, `.env.dev` selects `preview.localhost`, the `web` entry point, HTTP, and the local Traefik acknowledgement API. Start the local Traefik entry point before publishing:

```bash
mkdir -p "${DEPLOYMENT_STORAGE_DIR:-./data/deployments}/routes"
docker compose -f compose.preview.dev.yml up -d
vp run dev
```

The local proxy mounts only `data/deployments/routes` (or `PREVIEW_CONFIG_DIR`), so uploaded YAML and inaccessible artifact directories are excluded from Traefik’s file provider. If `PREVIEW_DYNAMIC_CONFIG` is overridden, place that file in the mounted directory. After changing the mount, recreate the proxy with `docker compose -f compose.preview.dev.yml up -d --force-recreate preview-proxy`. If route acknowledgement reports empty routers, check that `docker compose -f compose.preview.dev.yml exec preview-proxy ls -la /etc/traefik/dynamic` can read `senv-routes.yml`.

The Docker publish workflow builds the app, API, and migration images together. The API waits for Traefik to acknowledge each changed route snapshot before a route mutation completes; the Traefik API port is bound to loopback on the host and is not exposed publicly. Container health checks run inside the private network. The deployment detail page also requests the public preview root URL and reports its HTTP status, connection errors, and check time separately. It refreshes every 30 seconds and can be checked manually.

## Projects and invitations

See [the project and invitation guide](docs/projects-and-invitations.md) for permissions, account verification, invitations, and local email previews.
