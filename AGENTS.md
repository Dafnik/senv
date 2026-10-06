# senv

senv means simple environment. It is a deployment and preview application for web apps (SPA, SSR) using prebuilt static files or Docker containers.

senv is an open source, self-hostable alternative to Netlify or Vercel preview services.

## What makes senv special?

- **Open at the core.** senv is open source and self-hostable. Keep decisions and changes understandable to maintainers and people running forks.
- **Performance without compromise.** Consider the cost of polling, rendering, database queries, uploads, and container operations. Avoid unnecessary work and unbounded buffering.
- **Two client surfaces.** The Angular web app is the main surface. The Commander CLI and React Ink TUI share their client services and support deployment, diagnostics, teams, account administration, and automation workflows.

The following stay outside the CLI/TUI scope:

- Reading or editing project runtime configuration, environment variables, secrets, deployment defaults, resource/retention defaults, health defaults, repository defaults, and proxy defaults through configuration commands.
- Registry credential management, including create/update/delete commands. Publishing may reference an existing credential ID supplied by the user.
- Reading or editing instance deployment defaults through dedicated management commands. Existing server-side upload limits and defaults still apply to CLI requests.
- Initial instance setup, account signup/password entry, password-reset completion, and impersonation. These remain browser workflows. Admin commands can send the existing signup/reset emails.
- A browser terminal, proxy-container shells, host shells, arbitrary Docker container access, Docker socket exposure, SSH infrastructure, image building, and installing shells into images. CLI/TUI shells target only a deployment's running origin container.

senv accepts prebuilt static files or existing container images. Repository metadata describes their source; senv does not clone repositories or build applications. Managed stateful environments and remote Docker hosts are outside the current scope. See the [architecture decisions](docs/adr/).

## Note

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

Use judgment for routine implementation choices. Explicit scope limits, verification limits, and the shared-UI rule are requirements unless the maintainer overrides them. If another instruction conflicts with the task, explain the conflict and ask before making an exception.

## Glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing senv.
- **we, us, and maintainers** mean the people building senv. These are who you are talking to now.
- **Instance**: A senv installation with its own accounts and projects.
- **Instance admin**: An account administrator for the instance, with authority over all projects, their administrators, static upload limits, proxy allowances, and log-size defaults.
- **Instance role**: The account's single role in an instance, either user or admin. It is separate from project membership.
- **Project**: A named workspace with members and a permanent identity.
- **Project slug**: A readable, editable project name used in preview addresses and senv project, deployment, and log routes. Changing it retires the old links immediately and allows reuse of the old slug without changing the project's identity.
- **Project member**: An account with a role in a particular project, either viewer, developer, or admin.
- **Project admin**: A project member who manages that project's settings, memberships, invitations, deployment retention, resource limits, deployments, and retained history.
- **Project developer**: A project member who can manage deployments, tags, registry credentials, and project proxy settings. They cannot manage membership, retention, resource limits, project name, project slug, or permanent history removal.
- **Signup email**: An invitation to complete a pending account by verifying its email address and choosing a password.
- **Project invitation**: An offer to join one project with a specified project role, addressed to an account's email.
- **Password reset email**: A recovery link for an account that already has a password, allowing its recipient to choose a replacement.
- **Deployment**: A publication of fixed application content within a project, with its own identity and preview address. Publishing the same source revision again creates another deployment.
- **Deployment ID**: A permanent, 12-character readable lowercase identifier without a prefix, using the alphabet `abcdefghjkmnopqrstuvwxy2345679`, used in a deployment's preview address. Existing deployments retain their earlier identifiers and addresses.
- **Static deployment**: A deployment of built website files supplied as a directory or archive.
- **Container deployment**: A deployment of a container image that contains a web application.
- **Pinned deployment**: A deployment explicitly protected from automatic timed cleanup until it is unpinned. Unpinning starts a new retention period if no branch or tag protects it.
- **Project resource limits**: Admin-controlled CPU and memory defaults applied independently to each new deployment's origin container. Each deployment retains its captured limits when the project defaults change.
- **Proxy allowance**: Instance-admin-controlled CPU and memory defaults for each deployment's proxy container, separate from the origin's project resource limits. New deployments capture this allowance at publication.
- **Project proxy settings**: The project's reverse-proxy, compression, and cache defaults managed by developers and admins and captured by each new deployment's proxy. Changes affect future deployments rather than modifying existing ones.
- **Client-side routing fallback**: A project setting that serves `index.html` when a static-site request does not match a file. New static deployments capture the setting at publication.
- **Project health settings**: The project's HTTP probe path, startup deadline, polling interval, probe timeout, and unhealthy threshold captured by new deployments. They are configured at project level rather than independently for a deployment.
- **Proxy route**: A project rule that forwards matching requests to a configured HTTP(S) destination with an optional path rewrite, overriding the default origin and bypassing caching. Deployments retain the routes captured at publication.
- **Cache rule**: A project rule for caching eligible default-origin responses by request path or file type. Explicit proxy routes take precedence and bypass these rules.
- **Registry credential**: A project-scoped credential that developers and admins can reuse when selecting a private registry image for deployment.
- **Stateless web deployment**: A static or container deployment whose persistent application data is not managed by senv. It can be pinned or unpinned.
- **Stateful environment**: An environment containing persistent services and application data that senv manages, such as a database. Outside the current deployment scope.
- **Deployment artifact**: The fixed prebuilt website files or container image content supplied for a deployment.
- **Uploaded artifact**: A fixed collection of prebuilt website files within a project, optionally associated with a branch or commit. Deployments can share it, and it follows their cleanup policy.
- **Project runtime settings**: The project's environment variables and runtime secrets, captured by each new deployment. Changes affect future publications. Secret values are never returned after saving.
- **Deployment configuration**: The fixed runtime settings captured for a publication, including environment values, secrets, HTTP port, health check, SPA behavior, resource limits, and project proxy settings. Changing these settings requires a new deployment.
- **Project repository**: The optional, single source repository associated with a project. Commit and branch metadata refer to this repository when present; deployment tags have no repository integration.
- **Source metadata**: Optional information associating a deployment or uploaded artifact with a Git commit or branch. It describes the claimed source of the supplied artifact and does not assign deployment tags.
- **Deployment tag**: A project-scoped senv label assigned through the web app or CLI/TUI to select one deployment for a named preview address, with no Git integration. A deployment can carry several tags; developers and admins can assign or move them to healthy targets, or remove them.
- **Branch alias**: A named address for a branch's selected deployment, chosen when healthy. Earlier deployments retain their own addresses and their association with the branch until cleanup.
- **Tagged deployment**: A deployment currently carrying a user-assigned deployment tag and exempt from automatic timed cleanup. Formerly carrying a tag does not grant permanent protection.
- **Current branch deployment**: The deployment selected by a branch alias and exempt from automatic timed cleanup, even if it later becomes unhealthy. It must be healthy when selected, and submission order determines which successful deployment is newer.
- **Deployment retention period**: The project-configured time after which an unprotected deployment becomes eligible for automatic removal.
- **Cleanup protection**: Exemption from automatic timed cleanup because a deployment is pinned, current for a branch, or carries a deployment tag. Losing the final protection starts a fresh retention period.
- **Standalone deployment**: A deployment with no branch association. If untagged, its automatic cleanup clock starts when it becomes ready.
- **Deployment history**: The lifecycle events, source metadata, configuration summaries without secret values, and failure reasons retained after deletion or cleanup removes a deployment's resources, artifact, and raw logs. Project and deployment views share one history API with search, filters, sorting, and pagination. Only project admins can permanently remove this record.
- **Stopped deployment**: A deployment deliberately taken out of service while retaining its artifact, identity, and branch or tag selections. Developers and admins can restart it using the same identity, unless cleanup has removed its artifact.

## Hit every surface

Before calling client-facing work done, say which surfaces apply and which you checked:

- **Web:** `apps/app`, including SSR when browser globals, authentication, or routing change.
- **CLI and TUI:** `apps/cli`. Both use `src/services/` and `src/api/`; check command output and interactive behavior when applicable. Respect the browser-only workflows above.
- **Shared contracts:** `apps/api/shared` contains schemas, types, permissions, and helpers consumed by clients. Both clients use the API's `AppRouter` type. Keep business rules and authorization in the API rather than duplicating them in clients.

Reuse the existing shared contracts and CLI/TUI services; introduce another package only when a concrete need justifies it.

## Development

Run workspace commands from the repository root. `package.json` owns the Node.js and package-manager versions.

- `vp install` installs dependencies. For initial setup, copy `.env.dev` to `.env`, generate your own `BETTER_AUTH_SECRET`, and run `vp run db:migrate`.
- `vp run dev` starts the Nitro API on port 3000, Angular app on port 4200, and CLI build watcher.
- Start only the needed app with `vp run @senv/api#dev` or `vp run @senv/app#dev`.
- Publishing previews also requires Docker and the local Traefik entry point: `docker compose -f compose.preview.dev.yml up -d`. See the [development guide](docs/operations/development.md) for setup.
- Stop processes and containers you started; track their PIDs or Compose services. Do not stop another developer's servers.

## Test data

For manual development that needs realistic data, seed your worktree with an independent copy of the main checkout's data. Never point it at the main or production database or deployment storage, and never symlink data between checkouts.

- SQLite uses WAL mode. Use SQLite's backup API for a running database; copying only `senv.sqlite` can omit committed changes. Copy deployment artifacts only if the task needs them.
- Give concurrent local instances distinct `SENV_INSTANCE_ID` values and ports so their Docker resources do not collide.
- Automated tests use isolated temporary databases and their existing test-support helpers. Keep fixtures deterministic; do not seed tests from a developer's database. The root test configuration sets a temporary fallback `DATABASE_URL` to prevent accidental use of `.env` data.

## Verifying

Use the smallest proof that the change works:

- API, CLI, and database tests: `vp test run <test-files>` from the root.
- Angular tests: `vp run @senv/app#test --include='src/app/path/to/feature.spec.ts'`. The root Vite Plus test configuration does not discover Angular tests.
- Targeted lint: `vp lint <changed-typescript-files>`.
- API/CLI types: `vp run @senv/api#typecheck` or `vp run @senv/cli#typecheck`, as applicable. For Angular compilation/template changes, use `vp run @senv/app#build` when the focused tests do not cover them.
- Formatting outside `apps/app`: `vp fmt <changed-files> --check`. The Angular app and local UI library use the app's Prettier configuration; check only changed files with `pnpm --filter @senv/app exec prettier --check <paths-relative-to-app>`.

Test meaningful logic or observable behavior. Do not render components to static markup to assert props or attributes, or add tests that merely assert callback wiring or mirror the implementation. Backend behavior changes ship with focused tests for that behavior.

**Do not run repo-wide checks** unless requested: no `vp check`, `vp run check`, `vp run test`, `vp run -r test`, or recursive typechecks. CI owns the full suite.

Do not launch browsers or use computer automation unless the maintainer explicitly agrees or requests it. When requested, do one integrated frontend pass after the changes are combined. Do not launch separate dev servers for each agent.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(app): deployment logs no longer reset on refresh`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the maintainer asks. Keep contributions focused on one problem.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/adr/` records architectural decisions and their reasons. Use `docs/internals/` only when needed for constraints that span components or implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds development setup, instance deployment, release, and debugging procedures. The root README stays a short overview and quick start, with links to focused guides. The CLI README stays with its package because it ships in the CLI archive.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. Do not rely on a scratch directory being gitignored.
- Track active maintainer work in the GitHub issue or project item that owns it (if one exists).
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## Where code lives

| Path                                                   | Responsibility                                                                                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/server/features/`                            | API features: `auth`, `projects`, `deployments`, `admin`, and `notifications`. Services own application rules and transactions; repositories own persistence; routers/procedures validate requests and call services. |
| `apps/api/server/features/deployments/runtime/`        | Docker coordination, origin/proxy configuration, artifact processing, health checks, and logs. `storage/` owns deployment storage and locking.                                                                        |
| `apps/api/server/infrastructure/`                      | Database connection, environment configuration, Docker client, and shared infrastructure.                                                                                                                             |
| `apps/api/server/trpc/`                                | tRPC context, transport setup, and root router composition. Nitro `api/`, `routes/`, `plugins/`, and `middleware/` are framework entry points.                                                                        |
| `apps/api/shared/`                                     | Shared validation schemas, domain types, permissions, and helpers.                                                                                                                                                    |
| `apps/app/src/app/`                                    | Angular pages, layouts, auth, tRPC transport, query/mutation helpers, and app-specific UI.                                                                                                                            |
| `apps/app/libs/ui/`                                    | Local spartan/ui Helm components imported through `@spartan-ng/helm/<component>`.                                                                                                                                     |
| `apps/cli/src/`                                        | Commander commands, client API/services, profiles, credentials, output, shell transport, and React Ink TUI under `tui/`.                                                                                              |
| `drizzle/`                                             | SQLite schema, database helpers, and checked-in migrations.                                                                                                                                                           |
| `compose.*.yml`, app Dockerfiles, `.github/workflows/` | Local preview ingress, production containers, and CI/image publishing.                                                                                                                                                |

Tests live beside modules or in a feature's `tests/` directory. API/CLI tests use `.test.ts`; Angular tests mostly use `.spec.ts`.

## Database changes

Edit the owning schema module exported by `drizzle/schema.ts`, then run `vp run db:generate`. Apply checked-in migrations to your development database with `vp run db:migrate`; avoid resets or edits to applied migrations. `db:push` is for disposable local experimentation.

After changing Better Auth plugins, `vp run auth:generate` writes `drizzle/auth-schema.generated.ts`. Review and merge the needed changes into the auth schema modules before generating a migration. The generated file is deliberately outside the schema exports so it cannot replace deployment tables.

## Taste

- UI stays dumb.
- Server features are services; transports stay thin. A tRPC procedure or Nitro route validates input, calls the owning service, and maps errors. Services own transaction boundaries and pass transaction handles into repositories; repositories do not import services or transports. Functions are sufficient; do not introduce classes just to express these boundaries.
- **Shared UI owns appearance.** `apps/app/libs/ui` contains the shared spartan/ui Helm components. Use their `variant` and `size` inputs; do not override their appearance at call sites through classes, inline styles, host bindings, or feature CSS. Add a shared variant when a missing look is a reusable concept. Feature-specific visuals belong in the feature's own component. Put layout classes (width, flex, margin, position) on the parent. This is a review rule; the current lint configuration does not enforce it.
- Inferred types over annotations. `any` is the enemy.
- Comments explain intent, constraints, or how a function is used. Keep them near the relevant code and update them when it moves; avoid narrating each line.
- Users notice dropped frames, misleading loading indicators, and stale deployment status. No continuously repainting animations; they peg the GPU on high-refresh displays.

Security is important, but keep safeguards proportionate to the actual trust boundary, especially for development and maintainer-only features.
