# Deploying an instance

senv currently runs deployments on one local Docker Engine. The operator supplies the API/frontend ingress, preview domain, DNS, and TLS configuration.

Use the Node.js version in `package.json`, install dependencies with `vp install`, and create `.env` from `.env.dev`. Set a unique `BETTER_AUTH_SECRET`, production `API_URL`, `APP_URL`, and `ROOT_DOMAIN`, and both `SMTP_URL` and `EMAIL_FROM` for account and invitation emails. Set `APP_DOMAIN` to the frontend hostname for Angular SSR.

The production frontend's API and frontend URLs are compiled from `apps/app/src/environments/environment.ts`. Update `apiUrl` and `baseUrl` for your instance **before building**; changing the API's `.env` does not update the frontend bundle.

## Build and start

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

## Instance identity, DNS, and TLS

`SENV_INSTANCE_ID` must be a lowercase DNS-safe label no longer than 31 characters and unique for every senv instance sharing the Docker host. Compose uses its project name when this value is unset. Set it explicitly when installations share a host or when changing the Compose project name.

`API_PORT` and `APP_PORT` publish the API and frontend on host ports 3000 and 4200 by default; their container ports stay 3000 and 4200. Multiple instances need distinct Compose project names, instance IDs, and host ports for the API, frontend, preview HTTP/HTTPS entry points, and loopback Traefik API.

Point the preview domain and its deployment/alias subdomains at Traefik. Configure the `letsencrypt` resolver on `preview-proxy` for your DNS provider and supply the credentials through the host's secret environment. The supplied Compose file does not configure a certificate resolver for you. A wildcard certificate for `*.preview.example.com` does not cover `abc2349defgh.project.preview.example.com`; configure per-project wildcard coverage or certificates that include the project label. Traefik wildcard issuance uses a DNS challenge.

## Docker and ingress access

The API mounts `/var/run/docker.sock`, granting control over containers on the Docker host. Keep it restricted to the trusted senv operator. The API creates an instance-labelled private network and removes only containers carrying its own instance labels. Static origins mount the shared artifact volume read-only.

Route changes wait for acknowledgement from the Traefik API. Compose binds that API port to loopback on the host; keep it out of public ingress. The [development guide](development.md#local-previews) includes route-file diagnostics for local previews.

The Docker publish workflow builds the app, API, and migration images together.

## Upgrading and backups

Back up the SQLite database and deployment artifacts before upgrading. Use SQLite's backup API or stop writers before taking a consistent copy; an open WAL-mode database cannot be backed up by copying only its main file. Preserve the instance ID and named volumes across upgrades. The migration service applies checked-in schema changes before the API starts; a database reset is not required.

For direct Node.js operation, build the API with `vp run @senv/api#build` and run it with `vp run @senv/api#preview`. Build output is in `dist/apps/api`; preview reads `.env` from the repository root. Apply migrations first. The frontend SSR preview is described in the [development guide](development.md#ssr-preview).

CLI shell access requires WebSocket upgrades through the API ingress at `/api/cli/shell`. This uses the API ingress rather than deployment preview ingress; see the [CLI guide](../../apps/cli/README.md#interactive-shells).
