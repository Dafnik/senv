# Development

Start with the [root quick start](../../README.md#quick-start). Run workspace commands from the repository root. Node.js and package-manager versions are declared in `package.json`.

The default `DATABASE_URL=file:./data/senv.sqlite` creates a local SQLite database under `data/`. Database paths are relative to the working directory; workspace scripts run database commands and the API from the repository root. Configure authentication URLs and secrets in `.env` using `.env.dev` as the local template.

Start one app with `vp run @senv/api#dev` or `vp run @senv/app#dev`. `vp run dev` starts both and the CLI build watcher. The frontend is on port 4200 and the API on port 3000.

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

Each app is a workspace package, and build tasks live in its `vite.config.ts`. Angular CLI handles Angular compilation, SSR, and development serving through `apps/app/angular.json`. Angular's test builder uses the same Vitest version bundled with Vite Plus. The app package declares Vitest to supply the builder's required package import; test code imports `vite-plus/test`.

Prettier and its import and Tailwind plugins are configured in `apps/app` and format the app and its `apps/app/libs/ui` package, including Angular templates. Vite Plus formats the remaining files and lints TypeScript across the workspace.

pnpm keeps its shared virtual store in `.pnpm` at the repository root. Vite Plus recognizes this store and allows Angular's dev server to serve dependency assets across the workspace boundary.

For focused verification commands and repository conventions, see [AGENTS.md](../../AGENTS.md#verifying). Full checks belong to CI unless explicitly requested during agent work.

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

Apply checked-in migrations with `vp run db:migrate` when upgrading. Back up the SQLite database before a production upgrade; do not reset it.

## SSR preview

```bash
vp run build
APP_DOMAIN=localhost vp run @senv/app#preview
vp run @senv/api#preview
```

The production frontend compiles its API and frontend URLs from `apps/app/src/environments/environment.ts`. For a local production preview, set `apiUrl` to `http://localhost:3000` and `baseUrl` to `http://localhost:4200` before building. Run the two preview processes in separate terminals.

## Local previews

For local HTTP previews, `.env.dev` selects `preview.localhost`, the `web` entry point, HTTP, and the local Traefik acknowledgement API. Start the local Traefik entry point before publishing:

```bash
mkdir -p "${DEPLOYMENT_STORAGE_DIR:-./data/deployments}/routes"
docker compose -f compose.preview.dev.yml up -d
vp run dev
```

The local proxy mounts only `data/deployments/routes` (or `PREVIEW_CONFIG_DIR`), so uploaded YAML and inaccessible artifact directories are excluded from Traefik’s file provider. If `PREVIEW_DYNAMIC_CONFIG` is overridden, place that file in the mounted directory. After changing the mount, recreate the proxy with `docker compose -f compose.preview.dev.yml up -d --force-recreate preview-proxy`. If route acknowledgement reports empty routers, check that `docker compose -f compose.preview.dev.yml exec preview-proxy ls -la /etc/traefik/dynamic` can read `senv-routes.yml`.

Docker is needed by the API for deployment origins and proxies. The CLI itself needs no local Docker socket. To stop the local entry point when finished:

```sh
docker compose -f compose.preview.dev.yml down
```

## Development email

Nitro development captures signup, verification, reset, and project invitation emails instead of sending them. Visit [localhost:3000/api/notifications](http://localhost:3000/api/notifications) to find the captured messages and preview links. This endpoint is unavailable outside development. Production delivery requires both `SMTP_URL` and `EMAIL_FROM`.

## Isolated worktrees

Use a separate `.env`, database, and deployment storage for each worktree. When realistic data is needed, take a SQLite backup into the worktree; SQLite uses WAL mode, so copying only the database file while it is open can lose committed changes. Copy artifact data only when needed, never symlink or write changes back to the source checkout. Concurrent instances also need distinct instance IDs and ports for their Docker resources.
