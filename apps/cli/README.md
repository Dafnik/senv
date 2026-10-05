# senv CLI

The `senv` executable uses the same API and permissions as the web app. It supports project identity, deployment publication and lifecycle, diagnostics, project membership and invitations, instance user administration, sessions, automation tokens, and origin-container shells. Project configuration, registry credential management, and instance-defaults management remain web workflows.

## Install and sign in

Use Node.js 24.20.0 or later. The operator supplies a packed CLI from this repository; this release does not publish it to npm.

```sh
# From the repository:
vp run @senv/cli#build
pnpm --filter @senv/cli pack --pack-destination /tmp

# On the developer's machine:
npm install -g /path/to/senv-cli-0.1.0.tgz
senv --help
senv --instance work auth login --api-url https://api.senv.example.com
```

Login opens the instance's frontend for an explicit browser approval. Compare the code, review the requesting terminal, then approve. `--no-browser` prints the same URL and code for manual use. No password is entered in the CLI. The resulting CLI session is independent of the browser session and follows the instance's existing session expiry policy. Log in again after expiry.

Credentials use the OS credential store when available. On POSIX, the fallback is a private `~/.config/senv` directory (0700) and configuration file (0600). `SENV_CONFIG_DIR` overrides the directory. Windows requires a working OS credential store for saved login; the CLI refuses an insecure file fallback. `SENV_TOKEN` supplies a process-only credential and is never saved.

`auth logout` revokes the stored CLI session before removing its local credential. `auth logout --local-only` removes local access while offline; the server session remains active until revoked from Profile. Browser logout leaves independent CLI sessions active. Profile lists browser and CLI sessions and lets you revoke either, or all other sessions. Completing password reset revokes sessions, automation tokens, and outstanding device authorizations.

## Select an instance and project

```sh
senv instances list
senv instances use work
senv --project website projects show
senv --project website projects link
senv deployments list
```

Selection order is `--instance` / `--project`, `SENV_INSTANCE` / `SENV_PROJECT`, the nearest parent `.senv.json`, then the active instance profile. The explicit `projects link` command writes only the instance name and immutable project ID to `.senv.json`. It stores no credentials or server settings. Slugs resolve to immutable IDs on the server.

## Publish and inspect

```sh
senv --project website deployments publish ./dist --branch main --wait
senv --project website deployments publish website.tar.gz --wait
senv --project website deployments publish --image ghcr.io/team/app:latest --port 8080 --wait
senv --project website deployments publish --reuse DEPLOYMENT_ID --kind static
senv --project website deployments show DEPLOYMENT_ID
senv --project website deployments logs DEPLOYMENT_ID --follow
senv --project website deployments logs DEPLOYMENT_ID --source proxy
senv --project website deployments resources DEPLOYMENT_ID --watch
senv --project website deployments tags set staging DEPLOYMENT_ID
senv --project website deployments stop DEPLOYMENT_ID
senv --project website deployments restart DEPLOYMENT_ID
```

Lists and detail output include fixed, current branch, and tag addresses. Publication captures the current server configuration. Use `--registry-credential ID` to reference an existing private-registry credential. Uploads preserve directory paths, exclude `.git`, `.senv.json`, `.env*`, and the CLI credential directory, and reject symlinks and special files. Supported archive formats and expansion limits are enforced by the API. The client streams files with a precomputed exact multipart length and rejects files that change during preparation or transfer.

`--wait --timeout 300` bounds publication waiting. A timeout reports the deployment ID: inspect that operation rather than automatically publishing again. Mutations are not retried after uncertain transport failures. Logs follow chronological sequence cursors and warn if retention removed unread entries. `--limit` counts stored log chunks rather than terminal lines.

`--json` emits JSON on stdout; follow/watch commands emit JSON Lines. Progress and errors use stderr. Destructive commands require confirmation; use `--yes --non-interactive` for explicit unattended confirmation. Exit codes: 0 success, 1 operation/transport failure, 2 invalid input, 3 authentication required, 4 permission denied, 5 missing resource, 130 local cancellation. Shells return the remote exit code when available.

## Full-screen terminal interface

```sh
senv tui
senv --instance work --project website tui
```

The TUI shares the CLI's profiles, selection rules, credentials, and permissions. Without a saved login, its Account form starts browser approval and displays a manual URL and code. Instances lets you register and switch API origins. Selecting a project changes the current view; Link working directory explicitly creates `.senv.json` and refuses to overwrite an existing link.

The sidebar contains Projects, Account, Administration, and Instances, with destinations limited by your access. Open a project to use its Deployments, History, Members, and Invitations tabs. Account has Profile, Sessions, and Automation tokens tabs; Administration has Users and Statistics. Narrow terminals show compact navigation above the content. Use Tab or Shift-Tab to move between navigation, tabs, and content, arrows to select, Enter to open, and `a` for the current view's actions. Left/Right or h/l switches visible tabs. j/k moves selection or scrolls, gg jumps to the top, and G jumps to the bottom. In Logs, G resumes automatic scrolling to new output. Scrolling up starts from the current output and pauses automatic scrolling; scrolling down to the bottom resumes it. Deployment details have Overview, Addresses, Logs, Resources, and History tabs. Esc closes details first, then returns from the project to Projects. `p` opens Projects and `i` opens Instances. Projects actions also offer invitation-ID lookup before membership. `[` and `]` page lists, `/` searches, `r` refreshes, `?` shows help, Esc returns, and `q` quits. Forms keep ordinary shortcut letters as text, use Tab to change fields, Left/Right for choices, and Ctrl-U to clear. Enter opens a target/input review; Enter again submits. Destructive confirmations initially select Cancel. Cancelling a discard prompt preserves the draft.

Projects, deployments, publication, tags, teams, invitations, account sessions, automation tokens, users, and instance statistics use the existing API. Actions show permission or lifecycle restrictions. Invitation-ID lookup works before project membership. Signup, verification, and password completion use the browser. Automation credentials show only their permitted project/deployment navigation; read-only credentials cannot submit mutations.

Publication accepts a directory, archive, image, or retained source. Review shows instance/project, inputs, and server upload bounds. Uploads show byte progress; successful submission reports the deployment ID. Esc or Ctrl-C stops local preparation, upload, or observation. A submitted deployment continues on the server. An uncertain response requires inspection before retrying. Automation secrets appear once in a dedicated view and disappear when it closes.

Deployment details use a health summary, source and retention sections, grouped preview addresses, CPU and memory meters, resource trends, and event timelines with actors and timestamps. Logs use compact UTC timestamps and format common JSON messages and levels. Long values wrap, and the line range beside the view title shows your scroll position. Use Up/Down or j/k and Page Up/Page Down to scroll, and gg/G or Home/End to jump. Resources shows live usage and historical trends together. History includes all deployment events with search, actor/event filters, and pagination.

`deployments history` provides the event page for both project and deployment scopes, with `--deployment`, `--offset`, and `--limit`. `deployments audit` is an alias of the same command. Web, CLI, and TUI use the single `deployments.history` endpoint, which also supports search, event and actor filters, sorting, and creation-time cursors.

Lists refresh every 30 seconds while active. Logs follow every second, drain sequence pages, retain a bounded buffer, and report retention gaps. Use actions to switch origin/proxy, load older chunks, or pause follow. Scrolling away from the latest log pauses automatic scrolling; resume through actions. Resource watch refreshes current usage and historical samples every five seconds. Searches on paginated project/member/session/token/user lists cover the loaded page; deployment, history, and invitation filters use the complete available API query.

Open origin shell hands the terminal to the shared shell transport and resumes the TUI after exit, detach, or disconnect. Ctrl-C goes to the remote shell and Ctrl-] detaches. Polling pauses during the shell; its remote exit code is shown after return. Personal project manage permission is required.

Both stdin and stdout must be TTYs, with a terminal supporting cursor movement. `TERM=dumb`, `--json`, `--yes`, and `--non-interactive` are rejected. Help/version work without a terminal or connection. The layout adapts to narrow windows and asks for resize below 40 columns or 10 rows without losing drafts. Set `NO_COLOR=1` to disable colors or `SENV_ASCII=1` for ASCII borders. Terminal control sequences in API names, logs, and errors are stripped. Project settings, registry credential management, and instance defaults remain browser workflows.

## CI and unattended automation

Create a token in **Profile → Automation tokens**, or with a personal CLI session:

```sh
senv --project website auth tokens create deploy-ci --permission manage --days 30 --json
```

Store the returned secret immediately in your CI secret store. Later lists show only safe metadata. `read` permits deployment inspection; `manage` adds publication and deployment lifecycle/tag changes. Tokens default to 30 days. Use `--seconds` or `--days` for another lifetime, or `--no-expiry` for a token that never expires. The web app and TUI also accept an empty lifetime for no expiry, with days, months (30 days), or years (365 days) as units. Tokens cannot administer users, manage members or credentials, change settings, create projects, or open shells. Owner ban, membership/permission removal, password reset, deletion, expiry, or revocation removes access.

A fresh CI machine can register the instance without an interactive login:

```sh
senv instances add ci --api-url https://api.senv.example.com
export SENV_INSTANCE=ci
export SENV_PROJECT=website
# Inject SENV_TOKEN from the CI secret store.
senv --non-interactive --json deployments publish ./dist --wait
```

Rotate by creating a replacement and revoking the old token. `auth tokens revoke ID --yes` revokes it immediately. Setting `SENV_TOKEN` never overwrites a saved personal credential.

## Teams and user administration

```sh
senv --project website members list
senv --project website invitations create developer@example.com --role developer
senv invitations accept INVITATION_ID
senv users list
senv users create 'New developer' developer@example.com
senv users resend-signup USER_ID
senv users send-password-reset USER_ID
senv instance stats
```

The API preserves project-admin and instance-admin permissions, invitation verification, email delivery reporting, and last-instance-admin safeguards. Use the browser to complete signup/password reset; administrators cannot choose another account's password. Run any command with `--help` for its options.

## Interactive shells

```sh
senv --project website shell DEPLOYMENT_ID
senv --project website shell DEPLOYMENT_ID --shell /bin/bash
```

Shells target only the running app/static origin, using the container's configured user. nginx Alpine provides `/bin/sh`; application images must contain a POSIX shell and `cat`, `tr`, `grep`, and `sleep` for session cleanup. Shell-less images return a capability error. There is no proxy/host/container-ID selector and no shell installation or automatic start of a stopped deployment.

A local TTY and a personal developer/project-admin/instance-admin session are required. Ctrl-C goes to the remote terminal; Ctrl-] detaches locally. Writable-file changes affect the running container and do not update project settings or deployment snapshots. Disconnect/revocation terminates processes carrying that shell session's random marker, escalating HUP → TERM → KILL, without stopping the container. The API records lifecycle events, never terminal input/output.

Authorization is checked every five seconds, with up to two additional seconds for process cleanup. Limits: four shells per user, eight per deployment, 15 minutes without input, and two hours total. The API WebSocket endpoint `/api/cli/shell` must support upgrades through the operator's API ingress. It does not use deployment preview ingress. Replaced containers require a fresh single-use grant; terminals never reconnect automatically.

## Development checks

```sh
pnpm exec vp test run apps/cli apps/api/server/features/auth/tests/cli-http.test.ts
pnpm --filter @senv/cli typecheck
pnpm --filter @senv/cli build
```

POSIX terminal tests run the built executable in a real PTY and require Python 3. They cover navigation, bounded scrolling, Vim keys, log following, resource history, exit, signal cleanup, resize, and suspend/resume. Ctrl-Z suspends the TUI on POSIX; `fg` resumes it. Docker-enabled shell tests use nginx Alpine and a shell-bearing Alpine origin, with an authenticated local WebSocket bridge, and verify resize, forwarded Ctrl-C, and remote cleanup without stopping the container. They skip if Docker or Python is unavailable. Backend shell tests independently cover authorization, ownership, grants, revocation, and unavailable shells. Operators should also verify WebSocket upgrades and terminal handoff through their deployed API ingress.

To smoke-test an outside-repository installation against the real HTTP handlers, set `SENV_PACKED_CLI` to its absolute `node_modules/@senv/cli/dist/senv.js` path when running `apps/api/server/features/auth/tests/cli-http.test.ts`. The test launches that executable in a PTY with an isolated profile and credential, verifies the authenticated project list, and checks terminal restoration.
