# senv

senv means simple environment. It is a deployment and preview application for webapps (SPA, SSR) via static HTML or docker containers.

You can think of senv as an open source self-hostable alternative to products like Netlify or Vercel preview service.

## What makes senv special?

Here's a brief list of the things we can never compromise on.

### 1. Open at the core

senv is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks. We work in the open, and should strive to stay that way.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of senv. Make sure all changes are considerate of performance impact.

### 3. Multi-surface

senv has 2 key app surfaces: **web** and **cli**.

**Web** is the main surface use access first.

**cli** is a Commander and React Ink CLI / TUI for using senv except following this:
- Reading or editing project runtime configuration, environment variables, secrets, deployment defaults, resource/retention defaults, health defaults, repository defaults, and proxy defaults through configuration commands.
- Registry credential management, including create/update/delete commands. Publishing may reference an existing credential ID supplied by the user.
- Reading or editing instance deployment defaults through dedicated management commands. Existing server-side upload limits and defaults still apply to CLI requests.
- CLI initial instance setup, account signup/password entry, password-reset completion, and impersonation. These remain browser workflows. Admin commands can send the existing signup/reset emails.
- A browser terminal, proxy-container shells, host shells, arbitrary Docker container access, Docker socket exposure, SSH infrastructure, image building, and installing shells into images.

## Note

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing senv.
- **we, us, and maintainers** mean the people building senv. These are who you are talking to now.
- **Instance**:  A senv installation with its own accounts and projects.
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
- **Stateful environment**: An environment containing persistent services and application data that senv manages, such as a database.
- **Deployment artifact**: The fixed prebuilt website files or container image content supplied for a deployment.
- **Uploaded artifact**: A fixed collection of prebuilt website files within a project, optionally associated with a branch or commit. Deployments can share it, and it follows their cleanup policy.
- **Project runtime settings**: The project's environment variables and runtime secrets, captured by each new deployment. Changes affect future publications. Secret values are never returned after saving.
- **Deployment configuration**: The fixed runtime settings captured for a publication, including environment values, secrets, HTTP port, health check, SPA behavior, resource limits, and project proxy settings. Changing these settings requires a new deployment.
- **Project repository**: The optional, single source repository associated with a project. Commit and branch metadata refer to this repository when present; deployment tags have no repository integration.
- **Source metadata**: Optional information associating a deployment or uploaded artifact with a Git commit or branch. It describes the claimed source of the supplied artifact and does not assign deployment tags.
- **Deployment tag**: A project-scoped senv label assigned in the UI to select one deployment for a named preview address, with no Git integration. A deployment can carry several tags; developers and admins can assign or move them to healthy targets, or remove them.
- **Branch alias**: A named address for a branch's selected deployment, chosen when healthy. Earlier deployments retain their own addresses and their association with the branch until cleanup.
- **Tagged deployment**: A deployment currently carrying a user-assigned deployment tag and exempt from automatic timed cleanup. Formerly carrying a tag does not grant permanent protection.
- **Current branch deployment**: The deployment selected by a branch alias and exempt from automatic timed cleanup, even if it later becomes unhealthy. It must be healthy when selected, and submission order determines which successful deployment is newer.
- **Deployment retention period**: The project-configured time after which an unprotected deployment becomes eligible for automatic removal.
- **Cleanup protection**: Exemption from automatic timed cleanup because a deployment is pinned, current for a branch, or carries a deployment tag. Losing the final protection starts a fresh retention period.
- **Standalone deployment**: A deployment with no branch association. If untagged, its automatic cleanup clock starts when it becomes ready.
- **Deployment history**: The lifecycle events, source metadata, configuration summaries without secret values, and failure reasons retained after deletion or cleanup removes a deployment's resources, artifact, and raw logs. Project and deployment views share one history API with search, filters, sorting, and pagination. Only project admins can permanently remove this record.
- **Stopped deployment**: A deployment deliberately taken out of service while retaining its artifact, identity, and branch or tag selections. Developers and admins can restart it using the same identity, unless cleanup has removed its artifact.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Clients.** Web and cli. Shared logic lives in `packages/client-runtime`

## Dev servers

- `vp i` installs.
- `vp run dev` starts server and web.
- Stop what you started, by the PID you tracked.

## Test data

An empty database is a bad test. Seed your worktree's database with a copy of main data instead of pointing at live state:

- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Smallest proof that the change works. `vp test run <files>` for the tests you touched, targeted lint and typecheck for the scope you changed.
- Test meaningful logic or observable behavior. Do not render components to static markup to assert props or attributes, or add tests that merely assert callback wiring or mirror the implementation.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. CI owns the full suite.
- Backend behavior changes ship with focused tests for that behavior.
- Upon request, user-visible frontend changes should get one integrated pass. The primary agent does this once after integrating. Subagents do not launch their own dev servers. Ask permission before doing computer use or spinning up browsers.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the maintainer asks. Outside contributions follow the stricter [one problem per PR](CONTRIBUTING.md#one-problem) rule.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds maintainer setup, release, and debugging procedures. Keep instructions for operating an installed T3 Code server in the user guides.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. `.plans/` is gitignored only as a safety net for legacy tooling.
- Track active maintainer work in the GitHub issue or project item that owns it (it one exists)
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## Where code lives

- `apps/server` - TBD
- `apps/web` - TBD
- TBD

## Taste

- UI stays dumb.
- Server features are services; transports stay thin. A `ws.ts` RPC handler or HTTP route calls one service method, and maps errors.
- `apps/web/src/components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent. `shadcn/no-restyle` fails lint on violations. See [Web UI](docs/internals/web-ui.md).
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
