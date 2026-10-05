# senv CLI implementation plan

## Goal and decisions

Add an installable `senv` CLI using Commander. Reuse the existing typed tRPC backend, Better Auth account rules, and deployment services. Integrate CLI authorization and credential management into the frontend. Add an interactive shell for running deployment containers when their image contains a usable shell.

User-confirmed requirements:

- Use Commander and the existing tRPC implementation.
- Support most web workflows, with explicit exclusions below.
- Include frontend authorization and session management for CLI access.
- Exclude project configuration and instance-defaults management.
- Support shell access to nginx Alpine containers and user-selected images that contain a shell.
- Support both browser-approved login and scoped automation tokens for CI/unattended use.
- Restrict shell access to the application/static origin container. Deployment nginx proxies are excluded.
- Include user administration commands.

Technical defaults below, such as credential lifetimes and terminal timeouts, are implementation proposals within this agreed scope.

## Feature scope

| Area                   | Planned commands and behavior                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication         | `auth login`, `auth logout`, `auth status`, `auth whoami`; browser approval, manual URL/code fallback, instance profiles                                        |
| Sessions               | `auth sessions list`, `auth sessions revoke <id>`, `auth sessions revoke-others`; browser and CLI sessions appear together in the frontend                      |
| Automation credentials | `auth tokens list/create/revoke`; project-scoped credentials for CI, also managed in the frontend                                                               |
| Projects               | `projects list/show/create/rename`; change the preview slug through an explicit `projects slug` command                                                         |
| Deployments            | `deployments list/show/publish/stop/restart/delete/pin/unpin`; static directories, supported archives, container images, and reuse of retained artifacts/images |
| Addresses              | `deployments tags set/remove`; show fixed, branch, and tag preview URLs                                                                                         |
| Diagnostics            | `deployments logs`, including `--follow` and origin/proxy selection; `resources`, including history/watch; `preview-status`, `history`, and `audit`             |
| History maintenance    | `deployments history remove <deployment-id>`, with the existing project-admin restriction                                                                       |
| Teams                  | `members list/role/remove`; `invitations list/show/create/cancel/accept/reject`                                                                                 |
| User administration    | `users list/show/create/role/delete/resend-signup/send-password-reset`; instance-admin permissions and existing account safeguards                              |
| Instance statistics    | `instance stats`, read-only                                                                                                                                     |
| Interactive shell      | `shell <deployment-id>` for the application/static origin; optional `--shell /absolute/path`                                                                    |

Explicit exclusions:

- Reading or editing project runtime configuration, environment variables, secrets, deployment defaults, resource/retention defaults, health defaults, repository defaults, and proxy defaults through configuration commands.
- Registry credential management, including create/update/delete commands. Publishing may reference an existing credential ID supplied by the user.
- Reading or editing instance deployment defaults through dedicated management commands. Existing server-side upload limits and defaults still apply to CLI requests.
- CLI initial instance setup, account signup/password entry, password-reset completion, and impersonation. These remain browser workflows. Admin commands can send the existing signup/reset emails.
- A browser terminal, proxy-container shells, host shells, arbitrary Docker container access, Docker socket exposure, SSH infrastructure, image building, and installing shells into images.

Project names and preview slugs remain basic project-identity operations, matching the original Projects feature group. Local instance/project selection is CLI configuration, distinct from server project configuration. Deployment-specific inputs already supported by publication, such as image, port, source branch/commit, pinning, and credential ID, remain in scope. Publications capture the existing server configuration without adding configuration editing.

## Existing implementation to reuse

- `apps/api/server/trpc/routers/index.ts` exports `AppRouter` and the `projects`, `deployments`, `admin`, and `me` procedures.
- `apps/app/src/app/trpc/trpc.service.ts` uses `createTRPCClient<AppRouter>` and SuperJSON. Its HTTP link depends on Angular; the CLI needs a Node-compatible tRPC HTTP link using the same router contract and serialization.
- Better Auth in `apps/api/server/features/auth/auth.ts` owns accounts, sessions, project organizations, invitations, and user administration. Some web workflows call Better Auth rather than tRPC.
- Static uploads use `POST /api/deployments/artifacts`, followed by `deployments.publish`. Preserve that bounded multipart path and its archive-validation rules.
- `assertProjectAccess` and `accessibleDeployment` enforce project permissions. Instance admins have the existing access override.
- `DockerEngine` talks to the daemon over a Unix socket. Current exec requests collect a complete response; they cannot provide an interactive duplex terminal.
- The runtime manages separate `origin` and `proxy` containers. Container labels identify the instance, project, deployment, and role. `assertContainerOwned` must protect shell operations too.
- `/profile` currently shows account details and password recovery. Add session and automation-credential management there.

## Workspace and client architecture

Create `apps/cli` as `@senv/cli`, with an ESM executable registered as `senv`. Follow the workspace's Node engine and Vite Plus tooling. Add development, build, typecheck, and test tasks. Build a distributable package with a shebang, correct executable permissions, and no runtime dependency on Angular, SQLite, Nitro, or backend initialization.

Use a small command structure under `src/commands`, a typed API adapter under `src/api`, and separate modules for instance profiles, credential storage, output, prompts, and terminal handling. Commander commands delegate to those modules; they do not implement backend business rules.

Reuse `AppRouter` through type-only imports and the existing shared validation/contracts. Use a Node fetch-based tRPC HTTP link with SuperJSON. Avoid forcing the Angular transport into a shared factory. If packaging the router types requires an exported declaration entry point, add that entry point without loading server code at CLI runtime. Verify this with the packed CLI installed outside the repository.

Keep Better Auth endpoints for login and account/session lifecycle. For team/user operations, reuse the current Better Auth clients where possible. If a native-client operation needs a tRPC wrapper, have it call the existing authoritative service or Better Auth API with the authenticated request headers. Preserve last-admin protection, invitation verification, email delivery reporting, and self-deletion restrictions.

## CLI behavior

- Support named instance profiles containing the API URL and the frontend URL obtained from trusted instance metadata. Credentials are indexed by instance and account, with one active account per profile.
- Resolve selection in a documented order: explicit flags, environment variables, local project selection, then the active instance profile. Credentials supplied through `SENV_TOKEN` override stored credentials for that process and are never saved automatically.
- Support `--instance`, `--project`, `--json`, `--non-interactive`, and `--yes` where applicable. Accept project slugs or explicit IDs; resolve slugs through `projects.bySlug` and use immutable IDs afterward.
- Local project selection stores only the instance profile and immutable project ID. Create it only through an explicit local-link command. Do not write remote project settings or credentials into repository files.
- Prompts are available on a terminal. Non-interactive commands fail with actionable errors when required input or destructive confirmation is missing. Help/version require no network or authentication.
- Use readable tables by default. Emit stable JSON on stdout for `--json`; progress, prompts, and diagnostic errors go to stderr. Dates use ISO strings. Follow/watch output uses JSON Lines when requested.
- Define exit codes: 0 success, 1 operation/transport failure, 2 invalid input, 3 missing/expired authentication, 4 denied permission, 5 not found, and 130 local cancellation. Shell commands return the remote process exit code when available.
- Do not automatically retry mutations after an ambiguous transport failure. Read requests may use bounded retry/backoff. Publishing supports `--wait` with a bounded timeout and an explicit success/failure status.
- Confirm deployment/user/member deletion, history removal, and revocation of other sessions. `--yes` supplies explicit command-level confirmation for automation.

## Browser-approved CLI login

Use the device-authorization and bearer plugins available in the installed Better Auth version. Do not introduce a separate OAuth server or copy the browser's cookie session into the CLI.

1. `senv auth login` selects an instance and requests a device code using the fixed public client ID `senv-cli`.
2. The CLI prints the verification URL, user code, and expiry, and attempts to open the browser. `--no-browser` leaves the same flow usable from remote terminals.
3. A frontend `/cli/authorize` page accepts the user code. If necessary, the existing login flow returns to that internal route afterward.
4. The signed-in user sees their account, instance, code, requested CLI access, and a user-provided device label. The page requires an explicit approve or deny action. Reject approval from an impersonated session.
5. The CLI polls at the returned interval, respects `slow_down`, and stops on denial, expiry, cancellation, or a bounded timeout.
6. Token redemption creates a separate Better Auth session marked as CLI access. Persist its metadata before reporting successful login; a metadata failure must not leave an untracked credential.
7. Store the bearer session token in the OS credential store when available. For environments without one, allow a private user configuration directory with mode 0700 and a credential file with mode 0600 on POSIX, with equivalent Windows user-only access. Use atomic updates and keep this path out of repositories.
8. Validate the new session through the existing backend before setting it as active. On re-login, revoke the superseded CLI session only after the replacement has been obtained and stored.

Use an absolute verification URL derived from server `APP_URL`, validate the CLI client ID, rate-limit device endpoints, and keep existing browser origin/CSRF protections. Device codes and bearer tokens must not enter logs, analytics, or error output. Permit plaintext HTTP only for loopback development; production login uses HTTPS.

Add server checks at approval and redemption for disabled/deleted/pending accounts and account changes that occur between those steps. A device-flow scope string is not an authorization mechanism. Personal CLI sessions use current account/project permissions, enforced by the backend on every operation.

Use the existing Better Auth expiry and renewal policy for personal CLI sessions. Do not invent a refresh-token protocol. If the session expires or is revoked, return an authentication error with instructions to log in again.

## Frontend and CLI session management

Add server-owned session metadata, either registered additional session fields or a one-to-one metadata table keyed by the Better Auth session ID. Store the session kind, device label, CLI version, and throttled last activity time. Existing sessions without metadata are browser sessions. Device labels and user agents are descriptive, not proof of device identity.

Expose typed, authenticated session procedures for the current user's sessions, revocation by session ID, and revocation of every other session. Lists return IDs and safe metadata, never bearer tokens. If Better Auth revocation needs a token internally, resolve it on the server rather than returning it to the caller. Account ownership checks apply to every session ID.

Extend `/profile` with a Sessions section showing browser/CLI type, device label, creation, expiry, last activity, and a current-session indicator. Support individual revocation and "sign out all other sessions". Revoking the current browser session clears session-bound query caches and returns to login using the existing auth-state/recovery behavior. CLI revocation takes effect on the next request and terminates live shell connections within the documented authorization-check interval.

`auth logout` revokes the current CLI session on the server before removing the local credential. An offline `--local-only` option explicitly removes local credentials without claiming server revocation. Browser logout ends that browser session; it does not silently revoke independent CLI sessions.

Password reset and account deletion must invalidate browser sessions, CLI sessions, automation credentials, outstanding device approvals, and shell grants. Banned accounts and permission changes must fail authoritative request checks. Avoid stale session/user caches delaying revocation. Do not revoke the last instance admin's account or bypass existing admin safeguards.

## Scoped automation credentials

For CI, create named project-scoped automation tokens, distinct from personal Better Auth sessions. The frontend Profile page and authenticated `auth tokens` commands can create/list/revoke them. Creation requires a personal, non-impersonated session and the project permission being delegated.

- Store only a cryptographic token hash, display prefix, owner, project ID, permission set, created/expiry/revocation times, and throttled last use. Reveal the secret once at creation and redact it from logs and subsequent list responses.
- Default expiry to 30 days; an empty lifetime creates a token with no expiry. Accept positive lifetimes in seconds without a 90-day cap. Renewal means creating a replacement and revoking the old token.
- Provide explicit deployment-read and deployment-manage permissions. Enforce an operation allowlist plus the owner's current project/account permissions. A project token cannot create projects, administer users, manage members, change settings, create other credentials, or open shells.
- Use a reserved token prefix and a shared request-principal resolver for tRPC and artifact upload. Reject an invalid explicit bearer credential rather than falling back to a browser cookie.
- Token authentication must not synthesize an unrestricted Better Auth session. Restrict project metadata lookup to the token's project and return only the fields required for deployment workflows.
- Revocation and password reset invalidate these credentials immediately for new requests. Role/membership removal takes effect even if the token has not expired.

## Publishing and diagnostics

Static publishing accepts a supported archive or a local directory. Reuse the existing multipart upload endpoint, preserve relative paths, reject symlinks/special files, exclude local credential files, and enforce file-count/size bounds before upload. Send a determinable `Content-Length`; do not rely on chunked multipart uploads because the current API rejects them. Apply existing server extraction and expanded-size limits too.

After upload, pass the artifact ID to `deployments.publish`. Container publication uses the existing image/digest handling and optional existing registry credential ID. Reuse requests preserve retained artifact/image behavior. Do not execute Docker locally, build images, upload registry passwords, or change project defaults. Report the deployment ID even when waiting for publication times out, so callers can inspect the existing operation instead of republishing.

Reuse current list/detail/history/audit/resource/preview-status procedures and pagination. Implement follow/watch with bounded polling first. The current log cursor pages backward through older entries; add a typed forward-log query with `afterSequence`, chronological results, a high-water cursor, and an explicit retention-gap signal. Do not use the older-page cursor as a live-follow cursor. Share that backend behavior with the frontend where useful.

## Interactive container shell

Examples:

```sh
senv shell <deployment-id> --project <project-slug>
senv shell <deployment-id> --project <project-slug> --shell /bin/bash
```

The target is always the deployment's origin container. Support both the nginx/static origin and a user-selected application image. Deployment nginx proxies, the shared Traefik preview proxy, API/frontend containers, and arbitrary container IDs are excluded. Do not expose a container-role selection flag.

Use the existing `manage` project permission for shell access. Developers, project admins, and instance admins may connect; viewers, automation tokens, and impersonated sessions may not. Explain in help that a shell uses the container's configured user and can modify writable runtime files. Such changes are temporary and do not update saved project configuration or deployment snapshots. Do not request a privileged exec or override the user to root.

### Authorization and transport

1. Add a typed tRPC shell-capability/grant procedure accepting project ID, deployment ID, optional shell executable, and terminal size. The server fixes the container role to `origin`; callers cannot request another role.
2. Resolve the container on the server from the immutable deployment ID. Check account/session state, project permission, deployment lifecycle, running state, and all ownership labels through `assertContainerOwned` before probes or exec creation.
3. Probe a small allowlist of shell paths with direct executable arguments, beginning with `/bin/sh`, then `/bin/bash` and `/bin/ash`. Validate an explicitly requested executable as an absolute path; it still runs only in the owned container. Do not assume all user images contain a shell or install one automatically.
4. If unsupported, return a clear message such as "This image has no supported shell." Reject stopped, removed, retained-only, or cleaned deployments without starting them automatically.
5. Issue an opaque, single-use, 30-second connection grant tied to the personal session, exact container ID, deployment, project, and selected executable. Keep it out of URLs and logs. Revalidate ownership and permission when consuming the grant; a restarted/replaced container requires a new grant.
6. Connect through a dedicated API WebSocket endpoint using the Node client's authorization header. tRPC handles discovery and authorization; the WebSocket transports binary terminal input/output and validated resize/exit/control messages.
7. Extend `DockerEngine` with an exec-start duplex HTTP upgrade/hijack connection over its existing Unix socket. Handle both daemon upgrade and response forms for the configured API version. Use `AttachStdin/Stdout/Stderr`, `Tty: true`, and `Detach: false`; forward terminal-size changes to Docker's exec-resize API.

The CLI needs no Docker daemon, host socket, or SSH access. Enable WebSocket support in the Nitro Node runtime and verify upgrades through the actual production ingress. Do not route shell traffic through public deployment preview URLs.

### Terminal lifecycle

- Require a local TTY for interactive shells. Enable raw mode, send initial dimensions and `TERM`, forward Ctrl-C to the remote terminal, and document a local detach escape sequence.
- Restore terminal mode and listeners on normal exit, local detach, transport failure, SIGTERM, and uncaught terminal errors. Do not reconnect automatically or silently launch a replacement shell.
- Bound frame sizes and queued bytes, honor backpressure, heartbeat connections, and enforce a proposed 15-minute idle timeout and two-hour maximum connection lifetime. Track connections per user/deployment with a bounded concurrency limit.
- Recheck authoritative authorization at least every five seconds and on account/session revocation events. Close promptly when the session expires, permission disappears, or the deployment stops/deletes/replaces the container.
- Docker has no generic exec-cancel endpoint. The transport spike must establish and test cleanup of the specific shell process on disconnect, without stopping the container or killing unrelated processes. A tracked in-container supervisor/process mechanism may be needed; socket closure alone is not an assumed cleanup guarantee.
- Inspect the exec on completion and propagate its exit status when available. Report lost transport or revocation as a CLI error rather than successful shell completion.
- Record shell-open, close, denied, timeout, and revocation events with actor, deployment, container role, time, and close reason. Do not record keystrokes, terminal output, or secrets in deployment audit logs.

## Implementation sequence

1. **Validate auth and terminal integration.** Prove the installed Better Auth device/bearer flow creates independent revocable sessions, confirm metadata hooks and disabled-account checks, and prototype Docker duplex exec, resize, exit, and cleanup through Nitro and production ingress. Record the selected transport and cleanup approach before building shell commands.
2. **Add CLI package and typed API adapters.** Implement Commander registration, instance/local-project selection, output/error conventions, credential storage, and packaging. Verify the packed executable works outside the monorepo.
3. **Implement login and session management.** Add device schema/metadata and migrations, authoritative session procedures, `/cli/authorize`, Profile sessions, and CLI auth commands. Preserve current login/signup/reset and query-cache recovery behavior.
4. **Add scoped automation credentials.** Implement hashed token storage, shared principal resolution, operation/project checks, reset/revocation handling, frontend management, and CLI token commands.
5. **Add project, deployment, and diagnostics commands.** Cover identity operations, upload/publication, lifecycle, tags, history/audit, resource watch, preview status, and forward-log polling.
6. **Add team and user-administration commands.** Reuse existing rules and delivery behavior, with pagination and explicit destructive confirmation. Add read-only instance statistics.
7. **Deliver shell access.** Add owned-container capabilities/grants, the proven streaming transport, CLI terminal behavior, lifecycle/authorization cleanup, and audit events.
8. **Validate and document distribution.** Add command examples, frontend CLI onboarding/install guidance, CI examples, logout/revocation semantics, shell limitations, package smoke checks, and required workspace checks. Publishing a package is a separate release action.

Use the repository's Better Auth schema-generation workflow, merge generated auth fields into the maintained schema modules, and generate Drizzle migrations. Review the actual migration baseline and document any required local database reset; do not discard existing database data as part of implementation without an explicit migration decision.

## Acceptance and verification

- Run commands against a real local API using an installed, packed CLI package. Cover separate API/frontend URLs, multiple instance profiles, public project-slug changes, and execution outside the repository.
- Exercise login success, existing-browser-session login, manual code entry, denial, expiry, replay/concurrent redemption, cancellation, pending/banned/deleted accounts, and impersonated approval. Tokens never appear in ordinary output, lists, or logs.
- Verify browser and CLI sessions are distinct, correctly labeled, revocable by ID, and isolated between accounts. Test current-session and revoke-others behavior, offline logout, expiry, password reset, and session-bound frontend cache clearing.
- Prove automation tokens cannot exceed their project or permission allowlist, open shells, reach Better Auth admin operations, or survive account reset/removal. Cover both tRPC and multipart uploads.
- Test deployment publication from a directory, supported archives, container image, and retained deployment. Cover upload bounds, unsafe paths, missing credentials, permission denial, failed publication, timeout, and mutation transport ambiguity.
- Test forward log polling across multiple pages and retention gaps without duplication or missed retained entries. Preserve existing backward pagination for the web client.
- Cover team/user permissions, verified-email invitation acceptance, expired invitations, signup delivery failure/resend, and last-instance-admin protections.
- Use real Docker integration tests for a nginx Alpine static-origin shell, a shell-bearing app image, and an image without a shell. Test TTY resize, input, remote exit, detach, disconnect cleanup, revocation, stopped/replaced deployments, ownership mismatch, and cross-instance/cross-project rejection. Verify deployment proxies, the host, and shared Traefik cannot be selected, including through crafted API requests.
- Run existing and new API/CLI tests, relevant Angular tests, builds, typechecks, formatting, and workspace checks. Add CLI tests to the root test inclusion/tasks because the current configuration includes only API and Drizzle tests.

Completion means the scoped commands, frontend authorization/session controls, automation credentials, and interactive shells work as specified, with no project-configuration or instance-defaults management commands added.

## References

The plan uses the installed Better Auth plugin implementation as the version-specific contract. Current documentation provides supporting guidance: [device authorization](https://better-auth.com/docs/plugins/device-authorization), [bearer authentication](https://better-auth.com/docs/plugins/bearer), [session management](https://better-auth.com/docs/concepts/session-management), and [Docker Engine API v1.45](https://docs.docker.com/reference/api/engine/version/v1.45/).
