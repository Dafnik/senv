# senv

senv means simple environment: an open source, self-hostable deployment and preview service for web apps, similar to Netlify or Vercel previews.

Publish prebuilt static files or existing container images, share preview addresses for deployments, branches, and tags, and manage access within projects. The web app is the main surface; a CLI and terminal interface support deployment, diagnostics, and automation. senv runs deployments on a local Docker Engine with Traefik ingress and a separate Nginx proxy per deployment. Building applications and managing persistent application data are outside the current scope.

The workspace uses Angular with SSR and spartan/ui, a Nitro API with Better Auth and tRPC, SQLite through Drizzle ORM, and a Commander/React Ink CLI. Vite Plus runs workspace tasks.

## Quick start

Use the Node.js version in [package.json](package.json) and install the [Vite Plus CLI](https://viteplus.dev/guide/global-cli). Run from the repository root:

```sh
vp install
cp .env.dev .env
```

Replace `BETTER_AUTH_SECRET` in `.env` with your own secret, generated with `openssl rand -base64 32`. Then initialize the database and start development:

```sh
vp run db:migrate
vp run dev
```

Open [localhost:4200](http://localhost:4200); the API runs on [localhost:3000](http://localhost:3000). The development command also watches the CLI build. SQLite needs no separate database container; the default database is `data/senv.sqlite`.

The first visit opens `/setup` to create the first instance admin. Public signup is disabled; instance admins invite new accounts by email. Development emails are captured at [localhost:3000/api/notifications](http://localhost:3000/api/notifications).

Publishing previews also requires Docker and the local Traefik entry point:

```sh
mkdir -p data/deployments/routes
docker compose -f compose.preview.dev.yml up -d
```

## Guides

- [Accounts, projects, and invitations](docs/user/accounts-and-projects.md)
- [Publishing and managing deployments](docs/user/deployments.md)
- [CLI and terminal interface](apps/cli/README.md), including CI tokens and origin-container shells
- [Development](docs/operations/development.md), including workspace commands, database changes, and local previews
- [Deploying an instance](docs/operations/deployment.md), including Docker, DNS, TLS, and storage
- [Architecture decisions](docs/adr/)
- [Agent instructions and glossary](AGENTS.md)

## License

[MIT](LICENSE).
