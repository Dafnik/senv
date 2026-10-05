# CLI and TUI review findings

Review of commit `8870f15` ("Add CLI and TUI workflows for access and deployments") against `PLAN.md` and `TUI_PLAN.md`.

## Remediation — 2026-10-05

T1–T50 implementation changes are complete in this working tree. The checked tasks below retain the original review details; paths and line numbers in that historical text describe the reviewed revision. This record supersedes its old failing-suite status.

The security fixes enforce explicit bearer credentials, safe session metadata, immutable project resolution, authorization before upload reads, and personal origin-shell access. Browser sign-in and independent device-issued CLI sessions still work. Remote mutations are sent once, credentials remain private, and TUI drafts and one-time secrets survive the relevant refresh failures.

An independent read-only review found two alternate paths during remediation: bearer-only CLI impersonation before plugin normalization and Better Auth project leave bypassing membership hooks. Both were reproduced, fixed at the auth boundary, and covered by regressions.

Production HTTPS API ingress verification remains an operator acceptance step. No deployed origin or ingress configuration was supplied. Local tests use the real built Nitro route and Docker, but do not establish production ingress acceptance. No commit, deployment, or remote publication was performed.

### Resolution map

| Tasks               | Changes                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1–T2               | Remove/ignore local project links; isolate PTY child cwd; assert Administration in both positive and negative permission cases.                                                                                                                                                                                                                                                |
| T3, T7–T11, T13–T14 | Disable unsafe session endpoints; redact browser bearer material; enforce explicit bearer/cookie separation and JSON cookie mutations; enable device limits; guard approval reservation and error semantics; reject CLI impersonation; preserve timed-ban and token revocation behavior.                                                                                       |
| T4                  | Resolve exact IDs before slugs and reject slug/ID collisions in creation and updates.                                                                                                                                                                                                                                                                                          |
| T5, T15–T23         | Ready-gated input; authenticated native upgrades; bounded adapter frames and early stream-error listeners; immediate connection/grant invalidation; durable recovery and owned-container marker scans; distinct audits/limits; client heartbeat, exit and terminal restoration. Docker recovery failure keeps the API available and blocks new shells until recovery succeeds. |
| T6                  | Declare the runtime peer dependency; CI packs, installs without automatic peers, runs help/version and exercises the packed executable against HTTP handlers in a PTY.                                                                                                                                                                                                         |
| T12, T29–T30        | Project header and early automation authorization; upload progress idle timeout; documented credential denylist and canonical credential-directory exclusion.                                                                                                                                                                                                                  |
| T24–T26, T32–T34    | Preserve retained kind/port; clean superseded credentials; reread config before writes; explain malformed/missing link selection; unsigned auth status, accurate/local-only logout and instance-bound environment credentials; bounded login polling and local-link selection.                                                                                                 |
| T27–T28, T35–T40    | Correct retention gaps and persistent markers; bounded query retries; terminal-safe width-aware output; numeric/pagination validation; server addresses; package version source; command help/removal and lightweight waits.                                                                                                                                                   |
| T41–T45             | Cache identity between polls; keep/replace nearest links; immediately refresh unknown mutation outcomes and offer inspection; keep secrets outside snapshots and defer teardown; extract shared workflows and per-feature action modules; use server project permissions.                                                                                                      |
| T46–T48             | Restrict input on the resize screen; review actual shell user/target; refresh preview status; merge/document audit history; show login state/label; compare draft initial values; reset account state; preserve stale drafts; keep TUI instance choice in memory; operation-specific cancellation; locale/sanitization fixes and shared instance row loading.                  |
| T49                 | Show project labels, expiry badges, creation/last-use dates and device expiry; hide expired-token revocation; verify session revocation/refetch and cache clearing.                                                                                                                                                                                                            |
| T50                 | Replace unconditional completion claims with local verification and the explicit production ingress acceptance step in `TUI_PLAN.md` and the CLI guide.                                                                                                                                                                                                                        |

### Verification

Final local checks passed:

| Check                                               | Result                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Root `pnpm exec vp test run`                        | 337 tests passed; 14 gated integration tests skipped in this invocation and passed separately below.      |
| CLI `pnpm exec vp test run` from `apps/cli`         | 118 tests passed across 13 files.                                                                         |
| Frontend `pnpm exec vp run @senv/app#test`          | 230 tests passed across 71 files.                                                                         |
| Live Docker Nginx and deployment lifecycle suites   | All 14 tests passed, including authenticated upgrades through the built Nitro shell route.                |
| Live Docker shell recovery                          | All 3 tests passed, covering explicit marker paths, Bash-only containers, and containers without a shell. |
| Workspace production build, API and CLI typechecks  | Passed.                                                                                                   |
| Workspace format/lint and Angular formatting checks | Passed without lint warnings or errors.                                                                   |
| Isolated packed CLI installation                    | Help, version, and the real HTTP/device-auth PTY smoke test passed.                                       |
| `git diff --check`                                  | Passed.                                                                                                   |

Build warnings for Angular bundle size/CommonJS and optional Better Auth OpenTelemetry tracing remain; they did not fail these checks. Production HTTPS ingress acceptance is still the operator step described above.

## Scope and method

- Reviewed the backend auth, session, token, and shell code under `apps/api`; the frontend authorize and profile pages under `apps/app`; and all of `apps/cli`, including `src/tui`.
- Ran `vp check` (format and lint pass), `tsc --noEmit` in `apps/cli` (passes), the CLI test suite, and the API and Drizzle test suites.
- Line numbers refer to the tree at `9c380c6`.

## Original review snapshot

Every command in the `PLAN.md` feature table exists. Every row in the `TUI_PLAN.md` feature table has a screen or action. Extra commands are `tui`, `instances add/list/use`, and `projects link`.

At the reviewed revision, the suites did not pass, even though `TUI_PLAN.md` describes the work as complete and tested:

| Suite                                      | Result               | Cause                                                                                                                                                                     |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli` (`vp test run` from `apps/cli`) | 4 failed, 82 passed  | The committed `apps/cli/.senv.json` selects instance `default`. The PTY tests run in that directory, so the TUI starts signed out. All 4 pass after moving the file away. |
| Root API tests                             | 1 failed, 191 passed | `cli-http.test.ts:117` expects `navigation` to contain `Users`. The TUI now groups admin screens under `Administration`, and the test was not updated.                    |

## P0: fix before further work

- [x] **T1. Remove the committed local project link.** Delete `apps/cli/.senv.json` and add `.senv.json` to `.gitignore`. The file holds a real project ID and breaks every CLI command run from `apps/cli` ("Unknown instance default", exit 2).
  - In `scripts/test-terminal.py`, `os.chdir(directory)` in the child before `execve`, so PTY tests never read the developer's working tree.
  - Test: run `vp test run` from both the repo root and `apps/cli`.

- [x] **T2. Fix the stale TUI assertion in the API suite.** `apps/api/server/features/auth/tests/cli-http.test.ts:117` should assert `Administration` in `navigation`, or assert `Users` in `snapshot().screens`. Line 103 has the same problem: it passes only because `Users` never appears in `navigation`, so it no longer tests anything.

- [x] **T3. Stop Better Auth from returning bearer tokens in session lists.** `bearer()` is enabled (`auth.ts:93`) and no paths are disabled. `GET /api/auth/list-sessions` returns the raw `token` of every session. `/admin/list-user-sessions` lets an instance admin read any user's CLI token and act as that user without an impersonation marker, which bypasses the shell and token-creation impersonation bans. `PLAN.md` says lists "never [return] bearer tokens".
  - Add `disabledPaths: ['/list-sessions', '/revoke-session', '/admin/list-user-sessions']`, or strip `token` in an after hook. The frontend uses the typed `cli.sessions` procedure instead.
  - Test that no `/api/auth/*` response contains a session token.

- [x] **T4. Fix project resolution so a slug cannot take over a project ID.** `cli.router.ts:46` resolves the input as a preview slug first and as an ID second. Project IDs are valid slugs, and nothing prevents a slug equal to another project's ID. An admin of project A can set A's slug to B's ID. A user who belongs to both and runs `--project <B-id>`, or has a local link to B, then acts on A.
  - Look up by exact ID first, or accept `{ id } | { slug }` explicitly and send `{ id }` from local links and stored selections.
  - Reject preview slugs that equal an existing project ID.
  - Test both cases.

- [x] **T5. Fix the shell input race that kills new sessions.** `routes/api/cli/shell.ts:87-89,105-106` throws when an input or resize frame arrives before `execution.start()` finishes. The CLI starts forwarding stdin immediately after sending `open` (`apps/cli/src/services/shell.ts:109-127`). A paste, a terminal auto-reply, or input buffered in the TUI closes the socket with 1008.
  - Have the server send `{type:'ready'}` after `start()` and the `shell.opened` audit. The CLI attaches the stdin and resize listeners only after `ready`.
  - Add a test that exercises the real WebSocket route (see T21).

- [x] **T6. Declare `@trpc/server` as a CLI dependency.** `@trpc/client@11.18.0` imports `@trpc/server/*` at runtime but lists it only as a peer. pnpm and yarn installs without automatic peer installation fail at import time. Add `"@trpc/server": "11.18.0"` to `apps/cli/package.json` `dependencies`.
  - Make the pack, install outside the repo, and `senv --version` smoke test run in CI. It currently runs only when `SENV_PACKED_CLI` is set.

## P1: security and correctness

### Auth, sessions, and tokens

- [x] **T7. Reject an invalid explicit bearer without falling back to the cookie.** `request-principal.ts:17-21,39` passes non-`senv_at_` tokens to `auth.api.getSession(headers)`. When a dotted token fails the HMAC check, the bearer plugin leaves the headers alone, and the request authenticates through the cookie. Example: `Authorization: Bearer a.b` plus a valid cookie. When an `Authorization` header is present, remove `cookie` from a cloned `Headers` before calling `getSession`. Treat an empty header as invalid. The existing test (`cli-auth.test.ts:118`) uses `Bearer invalid`, which has no dot, so it misses this case.

- [x] **T8. Add CSRF protection to input-less cookie mutations.** The tRPC adapter accepts `multipart/form-data` POSTs, which are CORS simple requests. `cli.revokeOtherSessions` (`cli.router.ts:124`) takes no input, so a page on a preview host under the cookie domain can sign a visitor out of every other session. Require `application/json` or check `Origin`/`Sec-Fetch-Site` for cookie-authenticated mutations.
  - Separately, confirm whether preview containers receive the session cookie, because the cookie domain is `ROOT_DOMAIN` and `nginx-config.ts` does not strip `Cookie`. This is unverified and predates the commit.

- [x] **T9. Strip `set-auth-token` from browser responses.** The bearer plugin adds this header, and exposes it through CORS, on every response that sets the session cookie, including browser sign-in. Page JavaScript can then read the HttpOnly session token. The CLI reads its token from the `/device/token` body, so it does not need the header.

- [x] **T10. Finish device endpoint rate limiting.** `auth.ts:46-49` limits `/device/code`, `/device/token`, `/device/approve`, and `/device/deny`. It does not limit `GET /device` or the tRPC `cli.device` query (`cli.router.ts:52-83`), which reveals whether a user code exists. Better Auth also enables rate limiting only in production by default. Add both limits and a test with `rateLimit.enabled: true`.

- [x] **T11. Fix approval bookkeeping.**
  - `cli-auth-options.ts:74-85` writes `approvingSessionId` before the plugin checks status and expiry. A second approve call from another session overwrites it on an already approved code. Write only when `status === 'pending'` and the code has not expired.
  - `afterCliAuth` (`cli-auth-options.ts:111-139`) throws a plain `Error` (500) on failure. Throw `APIError('FORBIDDEN', { error: 'access_denied' })`.
  - Document that signing out of the approving browser session before the CLI redeems the code makes CLI login fail. The FK cascade at `schema-cli.ts:22-26` causes this.

- [x] **T12. Reject read-only tokens before reading the upload body.** `artifacts.post.ts:52-76` buffers the multipart body, up to the limit plus 8 MB, before rejecting a read-only or wrong-project token. Return 403 first when `principal.automation?.permission !== 'manage'` or the project does not match.

- [x] **T13. Block impersonation from CLI sessions.** `/admin/impersonate-user` accepts a personal CLI bearer session. `PLAN.md` keeps impersonation browser-only. Reject the call in the before hook when the actor's session has a `cliSession` row.

- [x] **T14. Small auth fixes.**
  - `revokeToken` (`cli.router.ts:189-198`) overwrites `revokedAt` on an already revoked token. Add `isNull(revokedAt)` to the where clause.
  - `eligibleCliAccount` and `resolvePrincipal` ignore `banExpires`, so automation tokens stay rejected after a timed ban ends. Match Better Auth's behaviour.

### Interactive shell

- [x] **T15. Reject failed WebSocket authentication at the upgrade.** When the hooks factory in `shell.ts:30-36` throws, Nitro falls back to empty hooks and crossws completes the upgrade. The client never sees 401 or 403, waits forever on an empty socket, and nothing records the failure. Authenticate in an `upgrade(request)` hook that returns a 401 or 403 `Response`, and pass the principal through `peer.context`. Also reject upgrades that carry an `Origin` header; the CLI never sends one.

- [x] **T16. Close shells as soon as access is revoked.** `PLAN.md` requires closing on revocation events and on deployment stop, delete, or replacement. Only the 5 second poll exists today (`shell.ts:164-192`). Export a registry such as `closeShells({ userId?, sessionId?, deploymentId? }, reason)` backed by `connections`. Call it from session revocation, password reset, account deletion, ban, membership changes, deployment stop, delete, and restart, and a Nitro `close` hook. Drop matching grants as well.

- [x] **T17. Clean up shell processes after an API restart.** Cleanup state lives only in API memory (`runtime/shell-exec.ts:84-106`). On SIGTERM or a crash, in-container shells may keep running. On startup and in the Nitro `close` hook, scan running owned origin containers for `/tmp/.senv-shell-<marker>` pid files and run the existing cleanup script for each marker.

- [x] **T18. Keep the real exit code when input arrives after exit.** Input that arrives after the stream ends (`shell.ts:88-91,131-148`) can raise EPIPE. The `error` handler then closes with `transport_error` before the `exit` frame goes out, and the CLI reports exit 1. Drop input when `ending`, `writableEnded`, or `destroyed` is set, and return early from the `error` and `close` handlers when `ending` is set.

- [x] **T19. Prevent crashes and oversized frames in the shell transport.**
  - `docker-engine.ts:102-107` returns the hijacked stream with no `error` listener, and `start()` then awaits `resize()`. An error in that window crashes the process. Attach a listener inside `attachExec`.
  - The crossws Node adapter uses the `ws` default `maxPayload` of 100 MiB, and the 64 KB check at `shell.ts:85` runs only after the frame is fully buffered. Set `maxPayload: 64 * 1024` if Nitro accepts crossws server options. Otherwise use a dedicated adapter. This is unverified.

- [x] **T20. Record distinct shell audit reasons.** All timeouts, revocations, stops, and replacements close with `revoked_or_timeout` (`shell.ts:164-191`). A rejected grant is never audited because `grant` is undefined. `PLAN.md` asks for open, close, denied, timeout, and revocation events with a close reason.
  - Use typed reasons: `idle_timeout`, `max_lifetime`, `heartbeat_timeout`, `session_revoked`, `permission_lost`, `deployment_stopped`, `container_replaced`, `docker_error`.
  - Emit `shell.timeout` and `shell.revoked` events.
  - Audit `shell.denied` for rejected grants and for the concurrency limit.
  - Include `impersonatedBy` where present.

- [x] **T21. Test the real WebSocket route.** The TUI shell PTY test uses a mock `WebSocketServer`, and `deployment-shell.test.ts` mocks `DockerEngine.request`. `TUI_PLAN.md` line 15 describes this as real Docker coverage, which overstates it. Add tests for:
  - auth rejection for missing headers, automation tokens, and impersonated sessions
  - grant replay and the 30 second expiry
  - concurrency limits; idle, lifetime, and heartbeat timeouts
  - closing within 5 seconds on revocation, stop, and replacement
  - audit rows and their reasons
  - the input-before-ready race (T5)
  - an image without a shell, a bash-only image, and an explicit `--shell` path
  - rejection of relative executable paths and of a deployment ID from another project
  - the Docker 200-response hijack form

- [x] **T22. Make the CLI shell client detect connection loss and restore the terminal.**
  - The CLI never notices a half-open connection (`apps/cli/src/services/shell.ts:128-163`). Track the last server ping and fail with exit 1 after about 30 seconds without one.
  - Restore the terminal on SIGINT, SIGHUP, and uncaught exceptions as well as SIGTERM (`:124`).
  - A send-buffer overflow (`:102-104`) reports exit 130 "Cancelled". Report it as a transport failure, exit 1.
  - Show the server's close reason instead of a generic message (`:157-162`).
  - Report a deployment stop as an error, not as a remote exit code such as 137 (`shell.ts:135-142` on the server).
  - Clamp resize values above 1000 instead of closing the session (`shell.ts:21-23`).
  - In the TUI, call `process.stdin.setEncoding(null)` while the shell owns the terminal, so non-UTF-8 input is not replaced with U+FFFD.

- [x] **T23. Limit shell grants and probes per user.** The 128-grant cap in `services/shell.ts:121-122` is global, so one user can exhaust it. Every `shellGrant` call runs up to three Docker exec probes and writes a `shell.denied` row on failure. Cap grants per user, rate-limit `shellGrant` per user and deployment, and throttle denial audit rows.

### CLI behaviour

- [x] **T24. Keep the original port and kind when reusing a deployment.** `--port` defaults to 80 and is always sent (`commands/deployments.ts:39`, `services/publication.ts:47`). The server uses the submitted port, so reusing an app that listens on 8080 publishes it on 80 and fails health checks. With `--reuse`, read `deployments.detail` and take port and kind from the original unless the user supplies them.

- [x] **T25. Clean up the superseded credential on re-login.** In `services/auth.ts:97-128`, when the account or API URL changes, the old keyring or file entry stays forever, and with a changed API URL the old session is never revoked. A failed read of the old keyring entry fails the whole login. When `SENV_TOKEN` is set, the code treats the environment token as the old token. Read the old credential straight from the store, ignore `SENV_TOKEN`, tolerate read errors, and call `removeCredential` for the old key.

- [x] **T26. Re-read the config before writing it.** `removeCredential` and logout write back the configuration read at connect time (`tui/controller.ts:1731-1736`, `services/auth.ts`, `profiles.ts:93-101`). Profiles added since then, by the TUI's "Add instance" or by another process, are lost. Re-read inside every read-modify-write. Clean up the temporary file if `rename` fails.

- [x] **T27. Fix retention-gap detection and reporting.** The server reports a gap whenever the row at `afterSequence` is gone (`repositories/logs.ts:39-46`). With no new rows the cursor does not move, so `logs --follow` prints the warning every second. The check also fires falsely when `afterSequence + 1` still exists. Compute the gap as `min(retained sequence) > afterSequence + 1`. Warn once per cursor in the CLI, and emit a `{"type":"gap"}` JSON Lines record under `--json`. In the TUI, put a gap marker in the log instead of a status message that the next update replaces (`controller.ts:546`).

- [x] **T28. Retry reads with bounded backoff.** `PLAN.md` allows bounded retry for reads, but there is none. One failed read ends `--wait`, `--follow`, and `--watch` (`commands/deployments.ts:55-69,135-152,161-170`). Retry queries, not mutations. If `--wait` fails, print `{ id, status: "unknown" }` on stdout under `--json`. In the TUI, replace the fixed 30 second retry (`controller.ts:319-338`) with capped exponential backoff.

- [x] **T29. Replace the fixed upload timeout.** `api/upload.ts:127-130` aborts any upload that takes longer than 120 seconds. 500 MB at 10 Mbit/s takes about 400 seconds. Use an idle timeout based on progress.

- [x] **T30. Exclude more credential files from directory uploads.** `api/upload.ts:9,48` skips only `.env`, `.env.*`, `.git`, and `.senv.json`. It uploads `.envrc`, `.npmrc`, `.netrc`, `.aws/`, and `*.pem`. Use a documented denylist, and use `realpath` for the credential directory check.

- [x] **T31. Fix CLI exit codes.**
  - Ctrl-C at a `confirm` prompt exits 1 instead of 130 (`output.ts:39-45`). Map `AbortError` to `CliError('Cancelled.', 130)` there and in `index.ts`.
  - Device `access_denied` and `expired_token` map to 2 (`api/client.ts:103-111`). Map them to 4 and 3.
  - Upload 400 and 413 map to 1 (`api/upload.ts:143`). Map them to 2.
  - Add "Run `senv auth login`" to exit-3 errors.
  - Include the cause and the API URL in "fetch failed" messages.

## P2: plan gaps and cleanup

### CLI

- [x] **T32. Name the source of an unknown instance.** When `.senv.json` names an instance that is not configured, the error does not say which file selected it. Include the link path. Validate the file's shape, and replace the raw `SyntaxError` with a clear message. In the TUI, `connect()` clears the error by calling `navigate` after it (`controller.ts:258-264,649`), so the user sees only "Signed out". Navigate first, then set the error.
- [x] **T33. Fix the gaps in `auth status`, logout, and `SENV_TOKEN` handling.**
  - `auth status` needs authentication, so it exits 3 instead of reporting "not signed in". Make it work without auth and show the credential source: env, keyring, or file.
  - Logout reports `serverRevoked: true` when the profile has no `sessionId` (`services/auth.ts:137-140`).
  - When the session has expired, logout should suggest `--local-only`.
  - `--local-only` should not read the keyring.
  - `SENV_TOKEN` goes to whichever instance is selected (`profiles.ts:57`). Bind it to `SENV_INSTANCE`, or warn when another instance is selected. In the TUI, disable instance switching and "Add instance" while `SENV_TOKEN` is set.
- [x] **T34. Fix the remaining `auth login` gaps.**
  - Login ignores the local link (`services/auth.ts:29-31`).
  - With no profile and no `--api-url`, it uses `http://localhost:3000` without saying so.
  - Add a client-side cap on polling.
- [x] **T35. Fix output formatting.**
  - Sanitize API strings and log content in CLI tables and log output with `tui/safety.ts`. Only the TUI strips control sequences today.
  - Use `string-width` for column widths, and stop cutting values at 80 characters, which hides addresses.
  - `deployments logs --json` without `--follow` emits JSON Lines. Emit one JSON document, like the other non-follow commands.
- [x] **T36. Fix pagination and input validation.** `deployments history` and `invitations list` ignore pagination cursors. `--offset abc` becomes `NaN`. Validate numeric options.
- [x] **T37. Use server-provided addresses.** `api/addresses.ts` builds alias URLs on the client. If a tag is not a valid hostname label, the hostname assignment is silently ignored and the fixed URL is shown as the tag URL.
- [x] **T38. Use one version string.** The version appears in `program.ts:12`, `services/auth.ts:48` (`x-senv-cli-version`), and `package.json`. Inject it from `package.json` at build time.
- [x] **T39. Add help text.** Most subcommands have no description. `shell` help lacks the `PLAN.md` explanation: the shell runs as the container's configured user, and its changes are temporary. Add `instances remove`.
- [x] **T40. Lighten `--wait` polling.** `--wait` polls `deployments.detail`, which includes 100 history rows, every second. Poll a smaller query.

### TUI

- [x] **T41. Stop revalidating identity on every poll.** `controller.ts:363-371` runs `me`, `cli.access`, `cli.project`, and `projects.detail` on every tick. Log follow at 1 second therefore makes about 5 requests per second. Revalidate on a 30 second cadence or after an error.
- [x] **T42. Make linking the working directory safe.** `controller.ts:1936-1959` shows a raw `EEXIST` for an existing link and never displays it. It also writes in `cwd`, which can shadow a link in a parent directory. Move linking into `services/link.ts`, shared with `projects link`. Show the nearest existing link and offer keep or replace.
- [x] **T43. Handle unknown mutation outcomes as planned.** After a lost response, `perform` waits 30 seconds to refresh and offers no inspection action (`controller.ts:919-933,1133`). It also labels definite server rejections such as CONFLICT as "unknown". Refresh immediately, offer inspection, and treat only transport and abort failures as unknown.
- [x] **T44. Keep the one-time token secret out of shared state.** The secret lives in `State.modal.lines` (`controller.ts:1789-1798`), and a test asserts it is in the snapshot. A background auth failure (`clearAccount`) can close the reveal before the user saves it. Hold the secret outside `State`, clear it on close, and delay auth teardown while the reveal is open.
- [x] **T45. Split `controller.ts` and remove duplication.** The controller is 2214 lines, and `actions()` alone is about 740. It duplicates CLI logic: instance add and use, project link, the publish wait loop with different terminal states and timeouts, token lifetime parsing, Better Auth endpoint paths, and role and shell eligibility rules (`workspace.ts:84-90`, `controller.ts:153-163,1556`). `TUI_PLAN.md` asks for shared services. Extract `services/{instances,link,publication-wait,tokens,users,invitations}` and per-feature action modules. Have `cli.access` return the effective project permission.
- [x] **T46. Ignore keys while the resize message shows.** On the too-small screen, input stays live, so pressing `q` types into an open form (`app.tsx:260-266`). Accept only `q` and Ctrl-C, and send `q` to `requestQuit`.
- [x] **T47. Explain the shell before launch.** The review shows only instance and project (`controller.ts:1541-1559`). Add the deployment ID, the origin target, the configured user, and the note that changes are temporary.
- [x] **T48. Close the smaller TUI plan gaps.**
  - Preview status is a one-shot message. Make it a refreshable view.
  - Audit is merged into History, and `deployments.history` is never called. Document the merge or add an Audit tab.
  - The login modal lacks the device label and the pending, approved, or denied state.
  - `dirty()` treats prefilled fields as unsaved, so untouched login and publish forms prompt on quit. Compare against the initial values.
  - `clearAccount` keeps filters, query, tab, and log cursor across accounts. Reset them.
  - A background 403 drops an open draft. Keep the form and mark it stale.
  - Switching instance writes `config.active`, which changes the default for CLI commands in other shells. Keep it in memory or confirm.
  - Cancelling login says "Submitted deployments continue on the server." Use a message for each operation.
  - ASCII fallback checks only `SENV_ASCII` and `LANG=C`. Also check `LC_ALL`, `LC_CTYPE`, and non-UTF-8 character sets.
  - `safety.ts` leaves U+200E, U+200F, U+061C, U+2028, and U+2029, and deletes tabs. Strip the marks and expand tabs.
  - Remove dead work: the width-80 `detailDocument` layout that `loadLogs` overwrites, and `showInstances`, which duplicates `loadScreen('Instances')`.

### Frontend

- [x] **T49. Fill the profile and authorize page gaps.** The token list shows the raw `projectId` (`access-management.html:333`). Expired tokens have no badge and still show Revoke. `lastUsedAt` and `createdAt` are not shown. The authorize page does not show the code's expiry, although `cli.device` returns `expiresAt`.

### Documentation and plans

- [x] **T50. Correct the status claims in `TUI_PLAN.md`.** Line 7 says "The CLI implementation is complete", and line 15 says the tests cover a real Docker shell handoff. Both suites currently fail (T1, T2), and the shell handoff runs against a mock WebSocket server (T21). Record which `PLAN.md` acceptance items are verified and which remain, including production ingress verification for the WebSocket upgrade. Nothing in the repo shows that check.

## Regression coverage after remediation

The following tests cover the fixes and their legitimate controls. The original review's broad acceptance matrix remains in `PLAN.md` and `TUI_PLAN.md`; it is not a claim that every platform, ingress, image, or failure combination has been exercised.

| Area                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device and session boundaries | `cli-auth.test.ts`: invalid clients and bindings, pending/slow-down, denial, expiry, one successful concurrent redemption, approval bookkeeping, impersonation, pending/banned/deleted accounts, token privacy, explicit bearer rejection, rate limits, session isolation/revocation and cookie mutation content types.                                                                   |
| Automation and multipart      | `artifact-api.test.ts`: read/wrong-project rejection without consuming the body, matching manage upload, forbidden account/project/token administration, membership demotion/removal, expired bans and account deletion. Existing API permission tests remain in place.                                                                                                                   |
| Shell route and transport     | `shell-route.test.ts`: real upgrades, personal versus automation/impersonated/browser credentials, input-before-ready, exact exit, frame bound, expiry/replay, quotas, revocation/leave, timeout and denial audit reasons, shell fallback/explicit paths and project isolation. `docker-engine.test.ts` covers the Docker 200 hijack form.                                                |
| Live Docker and built API     | `deployment-lifecycle.integration.test.ts`: actual built Nitro upgrade/auth, Docker shell readiness/output/exit/audit plus deployment lifecycle. `shell-recovery.integration.test.ts`: safe marked-process recovery, explicit paths, bash-only and shell-less images. `nginx.integration.test.ts`: cookie isolation and existing routing/cache/upgrade checks.                            |
| CLI                           | `behavior.test.ts`, `context.test.ts`, `profiles.test.ts`, `auth.test.ts`, `publication.test.ts`, and `shell.test.ts`: exit/output/help contracts, resolution precedence, credential binding/fresh writes, device polling/storage, retained port/kind, retry boundaries, waits, terminal readiness/heartbeat/overflow/signals and restoration. HTTP-handler tests exercise real commands. |
| Upload                        | `upload.test.ts`: credential denylist, canonical credential directory, exact multipart length, archives, byte/file limits, symlinks/FIFOs and changed files. Server artifact tests cover archive formats and expansion limits.                                                                                                                                                            |
| TUI                           | `controller.test.ts` and PTY tests: stale reads, preserved drafts, one-time reveal teardown, definite/unknown outcomes, identity caching, sessions/logout, bounded forward/older logs, source changes, member/invitation actions, failed grants and renderer resumption, publication review, terminal signals/resize/non-TTY, ASCII/Unicode and control-sequence sanitization.            |
| Frontend                      | Access management tests verify current-session cache clearing/login redirect, revoke-others/refetch, safe token project labels, expiry, creation and one-time secret lifecycle. Authorize tests and the Angular build cover the expiry display contract.                                                                                                                                  |

## Verified as implemented

These plan items match the code and need no action:

- **Device flow.** The `senv-cli` client ID is validated, `scope` and `user_id` are rejected, the verification URL comes from `APP_URL`, and impersonated approval is rejected. Eligibility is checked at approval and at redemption, and the plugin's `consumeOne` prevents replay.
- **Sessions.** Metadata lives in a 1:1 `cliSession` table. `cli.sessions` returns no tokens and marks the current session. Revoke checks ownership, and revoke-others keeps the current session.
- **Automation tokens.**
  - Format and storage: `senv_at_` prefix, 256-bit secret, SHA-256 hash behind a unique index, and the secret is shown once.
  - Lifetime: 30-day default, null means no expiry, and positive lifetimes have no cap.
  - Access: a per-path allowlist with a project match, and owner, membership, and ban checks on every request. No Better Auth session is created for a token.
  - Throttled `lastUsedAt` updates.
- **Credential invalidation.** Password reset removes sessions, tokens, and claimed device codes in one transaction. Account deletion cascades.
- **CLI.**
  - Selection: flags, env, link, then active profile. `SENV_TOKEN` is never saved, and `projects link` writes only `{ instance, projectId }` without overwriting.
  - Output: JSON on stdout, diagnostics on stderr, ISO dates, and JSON Lines for follow and watch.
  - Mutations are never retried, and `--wait` reports the deployment ID on timeout.
  - Confirmations and `--yes` work. Help and version work offline.
  - Uploads reject symlinks and special files, send an exact `Content-Length`, and enforce limits before sending.
  - Login validates the new session before switching to it and revokes the old one only after storing the new one.
  - Credentials go to the keyring, or to a 0600 file in a 0700 directory with an atomic rename.
  - `AppRouter` is a type-only import, so no server code is bundled.
- **Shell.**
  - Targeting: origin only, enforced on the server, with no role flag. It requires `manage` and a personal session.
  - Ownership: `assertContainerOwned` runs before probes and again when the grant is used. Probes run `/bin/sh`, `/bin/bash`, `/bin/ash`, in that order.
  - Grant: single use, 30 seconds, bound to session, container, deployment, project, and executable, and sent in a frame, not the URL.
  - Exec: TTY exec with resize and no privilege override.
  - Limits: frame and queue limits, heartbeat, 15-minute idle and 2-hour maximum, 4 shells per user and 8 per deployment, and a 5-second recheck.
  - Cleanup: a marker-based kill of the shell process, and the exit code from exec inspect.
- **TUI.**
  - Launch: `--json`, `--non-interactive`, and `--yes` are rejected, and the TTY check runs before render. Admin screens are hidden from non-admins, and automation principals are restricted.
  - State: an epoch counter discards stale responses. Polling runs at 1, 5, and 30 seconds and stops on close. A busy guard prevents duplicate submissions.
  - Exit and cleanup: exit codes are 0, 130, and 1, with terminal restoration and SIGTSTP/SIGCONT handling. `NO_COLOR` is honoured. The `safety.ts` sanitizer has no escape-sequence bypass.
