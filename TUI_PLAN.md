# senv TUI implementation plan

## Goal and relationship to the CLI plan

Add a full-screen terminal interface launched with `senv tui`. Cover the functionality in [the CLI implementation plan](PLAN.md) through searchable lists, detail views, forms, and explicit actions. Reuse the CLI's typed clients, instance profiles, credential storage, authorization, uploads, and shell transport.

The CLI commands and TUI workflows are implemented. Local regression checks are recorded below; production acceptance remains conditional on the operator checks. The TUI consumes its shared services and typed backend contracts. `PLAN.md` remains the authority for feature scope and backend rules. This document records the TUI requirements and implementation approach.

### Implementation

`apps/cli/src/tui` implements navigation, forms, confirmation, diagnostics, and permission-aware actions. Ink 8 with React renders the full-screen interface and owns alternate-screen lifecycle, resize, and terminal suspension. Commander loads it only for `senv tui`. Shared context, login/logout, publication/upload, and origin-shell workflows live outside the renderer; ordinary CLI commands keep their output and exit behavior.

The backend queries `cli.access`, `deployments.status`, and `deployments.shellTarget` support effective permissions, lightweight wait polling, and shell target review. `cli.access` returns safe principal kind, project scope, permission, impersonation state, and current session ID. It uses the existing personal/automation authorization and never returns a credential. No schema migration is needed for the TUI.

Controller tests cover stale responses, preserved drafts, confirmation, duplicate and ambiguous submissions, identity caching, revocation, one-time secrets, automation restrictions, bounded log follow, and publication review. HTTP-handler tests exercise account and project workflows. Built-executable PTY tests cover exit, signals, resize, ASCII/Unicode output, control-sequence sanitization, and real Docker shell handoff through an authenticated local bridge. A separate test runs the built Nitro WebSocket route against Docker; the bridge tests do not stand in for route authorization. Deployment-specific production ingress remains an operator verification step. See [the CLI guide](apps/cli/README.md) and [the remediation record](FINDINGS.md).

Keep existing commands available for scripting, JSON output, and unattended use. Launching `senv` without a subcommand keeps its current behavior. The TUI requires an interactive terminal and does not add server configuration management.

### CLI dependency requirements

- Design, keyboard behavior, and isolated renderer prototypes with mock data can proceed while CLI development continues.
- Integrate each TUI workflow only after its corresponding CLI service, backend contract, and required tests are complete. Track readiness by feature rather than treating all files currently present as ready to reuse.
- Authentication, instance/project selection, credential storage, and typed transport must be tested before connecting the main TUI to a real instance. Token management, publication, diagnostics, and administration each depend on their corresponding tested CLI capabilities.
- Shell integration waits for the CLI's real Docker, authorization, transport, resize, exit, and disconnect-cleanup tests to pass. The TUI then tests its additional terminal handoff and renderer restoration.
- Keep current CLI development and testing independent of TUI work. Schedule any shared-service extraction after the affected CLI behavior has a passing test baseline; avoid refactoring modules while their implementation is still changing.
- Treat module paths below as proposed locations. Adapt them to the finalized CLI structure without duplicating clients, credentials, business rules, or backend endpoints.

Full TUI acceptance depends on completion of the CLI acceptance criteria in `PLAN.md` as well as the TUI-specific checks in this document.

## Feature scope

| Area                   | TUI screens and actions                                                                           | CLI plan coverage                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Authentication         | Instance picker, browser-approved login, manual URL/code fallback, account/status view, logout    | `auth login/logout/status/whoami`                             |
| Sessions               | Browser and CLI session list, current-session marker, revoke one, revoke all others               | `auth sessions list/revoke/revoke-others`                     |
| Automation credentials | Token list, create form, one-time secret view, revoke                                             | `auth tokens list/create/revoke`                              |
| Projects               | Searchable project picker, identity details, create, rename, explicit preview-slug change         | `projects list/show/create/rename/slug`                       |
| Local selection        | Instance switching and an explicit action to link the working directory to a project              | Instance profiles and local project selection                 |
| Deployments            | List, details, publication wizard, stop, restart, delete, pin, unpin                              | `deployments list/show/publish/stop/restart/delete/pin/unpin` |
| Addresses              | Fixed, branch, and tag preview URLs; assign or remove a tag                                       | `deployments tags set/remove`                                 |
| Diagnostics            | Origin/proxy logs, follow mode, current/historical resources, watch mode, preview status          | `deployments logs/resources/preview-status`                   |
| History and audit      | Paginated history and audit views; remove a deployment's history with project-admin authorization | `deployments history/history remove/audit`                    |
| Teams                  | Members, role changes, removal, invitation list/details/create/cancel/accept/reject               | `members` and `invitations`                                   |
| User administration    | User list/details/create/role/delete; resend signup and send password-reset emails                | `users`                                                       |
| Instance statistics    | Read-only statistics screen for authorized users                                                  | `instance stats`                                              |
| Interactive shell      | Open the selected deployment's origin shell, optionally using an absolute executable path         | `shell <deployment-id>`                                       |

### Exclusions

Carry forward every exclusion in `PLAN.md`:

- No project runtime configuration, environment-variable, secret, deployment-default, resource/retention-default, health-default, repository-default, or proxy-default management screens.
- No registry credential management. Publication can accept an existing credential ID supplied by the user.
- No instance deployment-default management. Server upload limits and defaults still apply.
- No initial instance setup, signup/password entry, password-reset completion, or impersonation. Direct users to the existing browser workflows when needed. Authorized admins can send the existing signup/reset emails.
- No browser terminal, proxy or host shells, arbitrary container access, Docker socket exposure, SSH infrastructure, local image builds, or shell installation into images.
- No additional project deletion, bulk mutation, or other remote management operations beyond the CLI plan.

Project names and preview slugs are identity operations. Local instance/project selection is client configuration. Publication-specific image, port, branch/commit, pinning, and existing credential ID inputs remain in scope. Publication uses existing server configuration without reading or editing it through settings screens.

## Entry point and shared architecture

Extend `apps/cli` and its `@senv/cli` executable instead of creating a second credential store or executable. Register `tui` with Commander and load the renderer only when that command runs. Ordinary commands, help, and version must not initialize terminal rendering.

Proposed invocation:

```sh
senv tui
senv tui --instance production --project my-project
senv tui --instance production --project <project-id>
```

Support the CLI's instance/project selection order: explicit flags, environment variables, an explicit local project link, then the active instance profile where applicable. Resolve project slugs through the shared authorized lookup and retain immutable IDs after resolution. Ignore a local project link when it belongs to a different selected instance.

Require both stdin and stdout to be TTYs and reject unsupported terminals before enabling raw mode. `senv tui --help` and version remain usable without a TTY or network. Reject `--json`, `--non-interactive`, and `--yes` for TUI launch with an actionable message pointing to ordinary commands. TUI actions always use their own confirmation controls.

Once the affected CLI workflows are tested, separate reusable client operations from Commander and terminal output where needed:

- Extract instance/project context resolution so it accepts plain options. Keep Commander as an adapter.
- Share typed tRPC/SuperJSON transport, Better Auth requests, error classification, credential persistence, upload validation, device login, and shell protocol handling.
- Put reusable workflows under `apps/cli/src/services`. Return typed results and accept cancellation signals and progress callbacks. Services must not print, prompt, render, or call `process.exit`.
- Put rendering, navigation, forms, focus, and screen-specific state under `apps/cli/src/tui`. Keep TUI output out of shared services.
- Adapt `src/terminal.ts` to a reusable terminal owner that reports connection and exit outcomes. Keep CLI exit-code behavior in the shell command adapter.
- Do not invoke CLI commands as subprocesses or parse their tables/JSON to drive the TUI.

Use `AppRouter` through type-only imports and shared validation contracts. Keep Better Auth as the authoritative account/session implementation. The client must have no runtime dependency on Angular, SQLite, Nitro initialization, or Docker access.

Select the Node-compatible full-screen rendering library during the terminal spike. Require keyboard and focus handling, terminal resize, suspend/resume for a shell, bounded rendering, Node engine compatibility, and a distributable ESM build. Record the choice before building screens. Commander continues to own command parsing.

## Screen structure and keyboard behavior

Use a persistent header with instance, account or credential kind, selected project, connection state, and last successful refresh. The body has a navigation column and a content pane. A footer shows shortcuts for the focused screen and a concise operation status.

History and Audit are intentionally merged into History, using the shared `deployments.history` endpoint with event and actor filters. Administration groups Users and Instance statistics. Navigation contains Projects, Deployments, History, Members, Invitations, Account, Sessions, Automation tokens, Users, and Instance statistics. Project sections require a selected project. Only show Users and Instance statistics when the current principal has access. Account-level invitation lookup must remain usable without membership in the invited project.

Deployment details provide Overview, Addresses, Logs, Resources, and History views. History includes audit events. Publication and identity changes open forms. Confirmations and the action menu appear as modal views with their own focus.

Example layout:

```text
senv | production | alex@example.com | docs | connected
+-------------------+----------------------------------------------------+
| Projects          | Deployments                          / search       |
| > Deployments     | ID         Source        Status      Pinned         |
| History           | ab12cd     static        healthy     yes            |
|                   | ef34gh     app:release   stopped     no             |
| Members           |                                                    |
| Invitations       | Selected: ab12cd                                    |
| Account           | Fixed URL: https://...                              |
| Sessions          |                                                    |
| Automation tokens |                                                    |
+-------------------+----------------------------------------------------+
Tab focus | Enter details | a actions | / search | ? help | q quit
```

Default keys outside text fields:

| Key                 | Behavior                                                           |
| ------------------- | ------------------------------------------------------------------ |
| `Tab` / `Shift-Tab` | Move focus between navigation, content, and controls               |
| Arrow keys          | Move through lists or controls                                     |
| `Enter`             | Open the selected row or activate the focused control              |
| `Esc`               | Close a modal, cancel a local form, or return to the previous view |
| `/`                 | Focus the current list's search field                              |
| `a`                 | Open actions available for the current selection                   |
| `r`                 | Refresh the active view                                            |
| `?`                 | Show contextual help and shortcuts                                 |
| `q`                 | Quit, with a discard prompt for unsaved drafts                     |
| `Ctrl-C`            | Cancel a cancellable local operation, or quit when idle            |

Text fields receive ordinary character input, including shortcut letters. Modals capture focus and disable actions behind them. The action menu prevents destructive one-key operations. Do not require mouse support.

At narrow sizes, replace the navigation column with a picker and show one content pane. Hide secondary table columns before hiding essential IDs, status, or actions. At unusably small dimensions, show a resize message while preserving drafts and navigation state.

Use text labels as well as colors for status, selection, and errors. Honor `NO_COLOR`, provide an ASCII fallback, and keep focused controls visible. Handle Unicode display width and long IDs/URLs without breaking layout; offer a detail view for full values. Screen-reader or unsupported-terminal users can use the ordinary CLI commands.

## Authentication and account workflows

If no usable instance profile exists, show an API-origin form and request trusted instance metadata for its frontend URL. Apply the CLI's HTTPS rule, with HTTP allowed only for loopback development. Show instance/account identity before starting actions.

Reuse browser-approved device login with the existing `senv-cli` public client ID and `/cli/authorize`. The TUI displays the verification URL, user code, device label, expiry countdown, and pending/approved/denied state. Browser opening has a manual URL/code fallback. Cancel stops polling; it does not report successful login or imply server-side cancellation of a pending code.

Respect the returned polling interval and `slow_down`. Preserve approval/redemption account checks, impersonation rejection, rate limits, and bounded expiry. Validate the new independent CLI session and persist its metadata and credential before marking login successful. Revoke a superseded session only after replacement storage succeeds.

Launching the TUI with a valid stored CLI session reuses it. It does not copy browser cookies or create an extra session on every launch. TUI-created sessions appear as CLI access in existing frontend session controls, with a descriptive device label and client version.

The Account view shows identity, role, credential kind, instance URLs, and authentication status without exposing bearer credentials. Reuse the OS credential store and the private-file fallback rules in `PLAN.md`. Never put credentials in repository files.

Logout revokes the personal CLI session before removing its local credential. Offer a separate, explicit local-only logout for offline use and explain that the server session remains active. `SENV_TOKEN` remains process-only and is never saved automatically; explain how to unset or revoke it rather than pretending to delete an environment variable from the parent shell.

The Sessions view shows safe metadata: type, device label, creation, expiry, last activity, and current-session indicator. Confirm individual revocation and revocation of all other sessions. Revoking the current session immediately clears authenticated screen state and returns to login. Never return tokens to list or revoke sessions.

## Automation credential workflow

Create credentials only from an authorized personal, non-impersonated session. The form asks for name, immutable target project, deployment-read or deployment-manage permission, and expiry. Default to 30 days; allow seconds, days, months (30 days), and years (365 days). An empty duration creates a token that never expires.

Show the returned secret once in a dedicated reveal view with a visible reminder to save it. Keep it out of global state, history, notifications, error output, and logs. Clear it when the user leaves the view. Do not write it to a file or clipboard automatically, and do not recreate a token after an ambiguous creation response.

List only safe token metadata, including prefix, project, permissions, expiry/revocation, and last use. Confirm revocation. Replacement means creating a new token and explicitly revoking the old one.

When launched with a project automation token, limit the UI to that project's allowed deployment workflows and minimum authorized project metadata. Disable account/session/token administration, project creation, teams, user administration, and shells. Read-only tokens cannot mutate deployments or upload artifacts. UI restrictions complement the backend's operation allowlist and current owner/account/project checks.

## Project and deployment workflows

### Project selection and identity

Use a paginated, searchable project picker with identity and permission information. Create and rename forms apply shared validation. Preview-slug changes use a separate explicit action and explain their effect on preview addresses. Keep selection by immutable ID when a slug changes.

Switching instance or account clears cached data, cancels old queries, and resets project selection unless the new context independently validates it. Switching project cancels project-specific polling and closes its details. Changing focus never writes a local project link. An explicit Link working directory action previews the instance and project ID and handles an existing link without silently overwriting it.

### Deployment list and details

Show source/kind, immutable ID, lifecycle status, creation time, and pinned state where the API supplies them. Support search, pagination, and status filters without claiming to search records that have not been fetched. Preserve the selected row across refreshes by ID.

Details show the deployment's safe metadata, publication progress or failure, preview addresses, and available actions. Keep configuration settings and secrets out of detail views. Disable unsupported lifecycle actions with a reason and let the backend recheck permission and state when invoked.

Confirm deployment deletion with the instance, project, deployment ID, and consequences supplied by the service. Stop, restart, pin, and unpin use explicit action selection. Show pending state and prevent duplicate submissions until the outcome is known.

### Publication wizard

1. Select exactly one source: local directory, supported archive, container image, or retained deployment artifact/image.
2. Enter a local path or image reference, or choose an authorized retained deployment with its kind. Validate availability before submission.
3. Enter applicable publication inputs: application port, optional existing registry credential ID, source branch/commit, and pinning. Do not request registry passwords or project defaults.
4. Review the target instance/project and source. Show upload bounds and the fact that the server applies its existing configuration.
5. Validate/package/upload static content with progress, then publish. Use the bounded multipart endpoint with determinable `Content-Length`, safe relative paths, credential-file exclusion, and the existing archive/file-count/size checks. Reject symlinks and special files.
6. Show the returned deployment ID immediately and optionally wait within a bounded timeout. Allow users to inspect the deployment or return to the list without submitting it again.

Distinguish cancelling local preparation/upload from stopping observation of a submitted deployment. Closing a progress view does not cancel server publication. If a mutation's response is lost, mark the outcome unknown, refresh relevant records, and offer inspection. Never automatically retry publication or claim that an aborted request rolled back remote work.

### Addresses, diagnostics, history, and audit

Show fixed, branch, and tag preview URLs as full selectable text. Browser opening is an explicit action with the manual URL as fallback. Tag assignment/removal follows existing validation and authorization. Show the current target before moving an existing tag.

Logs offer separate origin/proxy selection, older-page loading, search over loaded entries, and follow/pause controls. Older browsing uses the backward cursor; follow uses the typed forward query, chronological entries, `afterSequence`, and high-water semantics from `PLAN.md`. Drain available pages before polling again, avoid duplicates, and show retention gaps visibly. Scrolling away from the latest line pauses automatic scrolling without losing the follow cursor.

Resources show current values, units, sample time, and a bounded historical view with optional textual charts. Watch mode refreshes while visible. Preview status reports public HTTP status or connection errors and the check time, separately from container health. Provide explicit refresh.

History and audit use existing pagination and supported filters. Keep retained/cleaned records inspectable without implying a running container. History removal is a separate confirmed action under the existing project-admin rule; it is distinct from deployment deletion. Audit views never show shell keystrokes or terminal output.

## Teams, invitations, and administration

Members show account identity and project role. Role changes and confirmed removal use existing project permission checks and last-admin safeguards wherever applicable. Preserve project-admin and instance-admin distinctions.

Invitations show pending/expired/accepted/rejected/cancelled state, target account, role, and delivery information supplied by the API. Authorized project administrators can create/cancel invitations. Provide an invitation-ID lookup so recipients can inspect, accept, or reject an invitation before they belong to its project. Enforce account ownership, verified-email requirements, and expiry on the server. Link to browser verification when required.

The Users view is available only to instance administrators. Cover paginated list/details, creation with name/email, changing the singular `user`/`admin` role, confirmed deletion, resending signup, and sending password-reset emails. Show delivery failure and recovery actions without claiming that a failed email means account creation rolled back. Preserve self-deletion and last-instance-admin protections. Never ask admins to choose a user's password.

Instance statistics are read-only and use the existing authorized statistics procedure. This screen contains no instance-default controls.

## Interactive origin shell

Open shell is an explicit deployment action for an authorized personal, non-impersonated session with project `manage` permission. Support nginx Alpine static origins and user-selected images containing a usable shell. Offer an optional absolute executable path. Do not offer container-role or arbitrary container-ID selection.

Show the origin target and explain that the shell runs as the container's configured user and can modify writable runtime files. Those changes do not update saved configuration or deployment snapshots. Unsupported, stopped, retained-only, removed, or cleaned deployments receive a clear reason; the action does not start a container or install a shell.

Reuse the capability/grant procedure and dedicated authenticated API WebSocket in `PLAN.md`. Preserve owned-container validation before probing/exec and at grant consumption, a single-use 30-second grant, direct executable arguments, daemon duplex exec, and resize. Never send grants in URLs or route shells through preview addresses.

Give the remote shell exclusive control of the terminal:

1. Save navigation/focus state, pause TUI polling, and suspend the renderer and its input listeners.
2. Restore the renderer's terminal modes and leave its alternate screen before starting the shell. Transfer ownership to the shared shell handler, which sets raw mode and dimensions.
3. Forward input and `Ctrl-C` to the remote process. `Ctrl-]` detaches locally. TUI shortcuts and notifications must not intercept or corrupt shell input/output.
4. On remote exit, detach, timeout, revocation, or transport error, clean up the shell connection and terminal listeners, then resume the renderer and refresh deployment state.
5. Show the remote exit code or failure reason in the TUI. A shell outcome does not terminate the entire application; the ordinary `senv shell` command keeps its remote exit-code contract. Do not automatically reconnect or launch a replacement shell.

Keep the CLI plan's bounded frames/queues, backpressure, heartbeat, concurrency limits, proposed 15-minute idle and two-hour maximum duration, and authorization checks at least every five seconds plus revocation events. Stop on expiry, lost permission, or deployment/container replacement. Prove remote shell-process cleanup on disconnect without stopping the container or killing unrelated processes. Socket closure alone is insufficient evidence.

Reuse shell lifecycle audit events with actor, target, timestamps, and close reason. Never record keystrokes or terminal output. No TUI feature grants host Docker access or selects deployment proxies, shared Traefik, or API/frontend containers.

## State, refresh, errors, and terminal safety

- Key query state by instance, account/principal, project ID, deployment ID, and view parameters. Discard stale responses after context changes and never reuse one account's data in another account's screen.
- Fetch active views only. Use bounded pagination and memory for tables, logs, and resource samples. Limit concurrent requests; cancel reads and polling when views close.
- Start with bounded polling through existing procedures. Proposed visible-view intervals are one second for log follow/publication observation, five seconds for resource watch, and 30 seconds for deployment lists and preview status. Back off failed reads and expose stale/last-refresh state.
- Do not overwrite unsaved forms during background refresh. Warn if the authoritative value changed and require a fresh review before submission.
- Give views distinct loading, empty, stale, denied, not-found, and failed states. Keep recoverable errors visible with an appropriate retry or navigation action.
- An authentication failure stops authenticated polling, clears protected state, and offers login. Permission removal disables affected actions and exits inaccessible views. The server remains authoritative on every request.
- Reuse the CLI's error classification. Successful TUI quit exits with 0; fatal startup/auth/transport/input failures retain the relevant CLI exit code, and process interruption exits with 130. Recoverable action errors stay in the TUI.
- Retrying a read can use bounded backoff. Mutations never retry automatically after an ambiguous transport failure. A local cancellation must distinguish cancelled preparation from an unknown remote outcome.
- Sanitize remote names, log entries, audit text, and error messages before rendering. Strip terminal control sequences that could inject commands, change titles, or write to the clipboard. Only the explicit shell handoff passes remote terminal output through the shell transport.
- Redact credentials and connection grants from diagnostics. Keep intentionally displayed login codes and one-time token secrets confined to their dedicated views.
- Centralize terminal ownership and cleanup. Restore raw mode, cursor, alternate screen, listeners, and pending requests on normal quit, cancellation, signals, renderer failure, and shell-handoff failure. Handle suspension/resumption on platforms that support it.

## Implementation sequence

1. **Track CLI readiness and prototype the renderer.** Record which CLI capabilities are implemented and have passed their required tests. Select the renderer and prototype navigation, resize, and terminal ownership with mock data. Record unavailable dependencies instead of implementing them separately for the TUI.
2. **Reuse tested client workflows.** Confirm the finalized CLI structure. Where necessary, extract reusable context/auth/upload/shell operations from Commander, printing, prompting, and process-exit handling after the affected CLI tests pass. Rerun those tests after extraction and preserve error/output contracts.
3. **Build navigation and onboarding.** After the CLI auth/context foundation is tested, add `senv tui`, TTY checks, focus/help, adaptive layout, instance/project selection, login, account status, and logout. Reuse its credential/session metadata and browser authorization.
4. **Add sessions and automation credentials.** After the corresponding CLI workflows pass, implement safe lists, confirmed revocations, token forms and one-time reveal, current-session recovery, and automation-principal restrictions.
5. **Add project and deployment workflows.** Integrate tested identity, local-link, list/detail, publication, lifecycle/pinning, and address/tag services through TUI forms and actions.
6. **Add diagnostics and history.** Once their CLI contracts and tests are complete, add forward log follow and older browsing, bounded resource watch/history, preview status, paginated history/audit, and confirmed authorized history removal.
7. **Add teams and administration.** Integrate the tested member/invitation, invitation-ID lookup, user/email, and read-only statistics workflows.
8. **Integrate the origin shell.** After the CLI shell passes its real integration tests, use its transport and terminal owner. Prove TUI suspend/resume and failure cleanup in the built package, preserve detach/resize/exit semantics, and verify authorization/cleanup through real ingress.
9. **Verify and document distribution.** Add workflow and keyboard documentation, credential/confirmation semantics, terminal requirements, exclusions, packed-package smoke checks, and required workspace checks. Package publication remains a separate release action.

Reuse the backend contracts delivered by the CLI work. Report missing CLI-plan functionality to that work and integrate its tested implementation when ready. Do not create a separate TUI auth protocol or duplicate device/session/token/shell endpoints. Propose an additional typed procedure only for a confirmed TUI-specific need within the agreed scope, using authoritative services and authorization. Any schema change follows the CLI plan's Better Auth/Drizzle workflow and explicit migration decision.

## Acceptance and verification

- Confirm that every integrated CLI dependency has passed its required tests. Full TUI completion requires the CLI acceptance criteria in `PLAN.md` to pass too; mock-only screens do not count as delivered workflows.
- Map every feature-scope row to an implemented screen/action and verify that excluded settings and operations are absent.
- Install the packed CLI outside the repository and launch the TUI against a real API. Verify separate API/frontend URLs, multiple profiles/accounts, environment overrides, local links, slug changes, and immutable selection.
- Exercise keyboard navigation, text fields, modal focus, narrow/large resize, Unicode width, no-color/ASCII output, unsaved drafts, and non-TTY launch. Help/version work offline. Existing command help, JSON, non-interactive behavior, and exit codes remain intact.
- Test shared service extraction with existing CLI tests. Add focused navigation/state tests for context changes, stale responses, duplicate submission prevention, and cancellation. Use PTY integration tests for actual terminal ownership and restoration, rather than relying only on rendered snapshots.
- Cover device approval/denial/expiry/cancellation/slow-down, credential persistence failure, impersonation rejection, revoked/expired sessions, account reset/removal, current/other-session revocation, and offline local-only logout. Tokens and grants never appear in ordinary UI diagnostics or logs.
- Verify automation tokens cannot cross projects, exceed read/manage permissions, upload with read-only access, administer accounts/teams/credentials, or open shells. Test UI restrictions and authoritative tRPC/upload enforcement.
- Publish directories, supported archives, container images, and retained artifacts/images. Cover unsafe paths, symlinks/special files, upload bounds, known-length multipart, bad credential IDs, permission errors, failed publication, wait timeout, and lost mutation responses. Closing observation must not republish or imply cancellation.
- Test log follow across multiple forward pages, paused scrolling, source switching, older-page loading, retention gaps, duplication, and context changes. Confirm bounded memory and no background polling after view closure or logout.
- Cover project identity/tag operations, history removal permissions, member role/removal, invitation ownership/verification/expiry, email delivery failures and resend, user self-deletion safeguards, and last-instance-admin protection.
- Use real Docker and PTY tests for a nginx Alpine origin, a shell-bearing app, and an image without a shell. Cover resize, input, forwarded `Ctrl-C`, local detach, exit codes, renderer resumption, connection loss, timeout, revocation, stopped/replaced containers, ownership mismatch, and remote-process cleanup. Verify that proxy/host/arbitrary containers remain unreachable through crafted requests too.
- Inject control sequences into names, logs, and errors and verify safe rendering. Verify that exiting or failing the TUI restores the terminal and leaves no active polling, input listeners, or shell connection.
- Run relevant API/CLI/frontend tests, builds, typechecks, formatting, and workspace checks. Include TUI tests in CLI and root tasks, and verify the packed package loads no server runtime or Angular dependencies.

Completion means the TUI covers the CLI plan's authorized workflows with reliable keyboard navigation, shared credentials and backend rules, safe live diagnostics, and a working origin-shell handoff. No project-configuration or instance-default management is added.

## Verification record — 2026-10-05

The FINDINGS.md remediation adds auth/device/session isolation, upload authorization before body reads, project-ID precedence, shell readiness and quotas, immediate revocation, durable recovery, credential cleanup, read retries, shared publication waits and action services, safe linking, terminal cleanup, and frontend access metadata. The automated suites exercise the corresponding regressions and legitimate controls. The workspace build and typechecks cover API, CLI, and Angular contracts. Packaging CI installs an isolated archive without automatic peers and exercises it against HTTP handlers.

Local Docker checks cover generated Nginx cookie isolation and routing, the deployment lifecycle, the built Nitro shell upgrade, and marked-process restart recovery. PTY shell tests use real Docker with a local bridge. Shell-less images and bash/explicit-path selection are also checked at the grant boundary.

Remaining operator acceptance: run `senv shell <deployment-id>` and the TUI shell through the deployed HTTPS API ingress, verify upgrade authentication, input/resize, heartbeat loss, remote exit, stop/replacement/revocation, and terminal restoration. No deployed API origin or production ingress configuration was provided in this workspace, so local checks do not establish production ingress acceptance.
