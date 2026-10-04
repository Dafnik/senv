# UI and tooling audit

This is the baseline review ledger. Original proposed decisions are retained as review history. The [completed plan](refactor-plan.md), [size/resource follow-up](refactor-follow-up-plan.md), additions ledgers, and [final verification](refactor-verification.md) record the implemented result.

Baseline: `a09c951`. This audit covers 210 tracked files: all 187 files under `apps/app/libs/ui/**`, plus 23 repository-root, `.github/**`, and `docs/**` files. App implementation/configuration, API implementation, and `drizzle/**` were assigned elsewhere. The separately authored `docs/refactor-*` reports are excluded.

## Findings and ordered chunks

**U1, documentation alignment, completed.** Runtime publication in `apps/api/server/utils/deployment-publication.ts` creates 12-character deployment IDs from `abcdefghjkmnopqrstuvwxy2345679`. The prior glossary/spec text said six characters and named a different alphabet. The README also named `0003_member_inviter.sql`, which is absent: the tracked migration is `0000_init.sql`, and it creates `member.invitedById` and `member.invitedByName`. On invitation acceptance, the API captures the inviter ID and name; deleting that account sets the ID to null and leaves the stored name. The accepted correction updates `CONTEXT.md`, `docs/deployment-feature.md`, and `README.md`; it leaves the 21-character project ID alphabet and all runtime, routes, APIs, stored behavior, and Compose topology intact.

**U1 verification.** Read the deployment ID generator, schema, initial migration, and invitation-acceptance callback. Confirmed that the stale six-character wording and old migration filename no longer appear in README, CONTEXT, or docs. This is a documentation-only change, so no tests were run.

**U2, workspace/tooling metadata, keep.** The package manifests and lockfile importer metadata agree on the root and Helm peer versions and workspace links. `pnpm-lock.yaml` is a generated vendor-style lockfile, so the audit checked its header/settings/importers and the direct manifest versions rather than printing its 13,398-line package body. CI installs with `--frozen-lockfile`. No lockfile or dependency change is indicated.

**U3, GitHub Actions, keep.** Both workflows use full commit SHA action pins, declare least-privilege contents access, disable persisted checkout credentials, and avoid interpolating attacker-controlled event text into shell commands. The image publishing job grants `packages: write` only to the publishing job. No workflow change is indicated.

**U4, Helm component source, keep.** The 187 local package files are copied/generated Helm components and source-package infrastructure. I inspected every file. Entry-point barrels preserve exported APIs and `*Imports` tuples; component source composes Spartan Brain behavior with local Helm classes, semantics, and tokens. There is no focused bug or contract improvement that would justify a broad generated-code rewrite. Retain these files and target future changes at concrete component needs, keeping selectors, inputs, variants, styling, accessibility, and public exports stable.

**U5, remaining root/docs files, keep.** Read the deployment spec, glossary, ADRs, implementation record, README, compose files, and root task/TypeScript configuration. These document or encode the established Vite Plus, Angular CLI, pnpm, SQLite, Docker, and Traefik setup. I found no safe maintainability change that can be made without contradicting the requested stack, data behavior, or topology.

## Per-file ledger

The original inventory is recorded in [the copied spartan ledger](refactor-ui-files.md) and [the tooling ledger](refactor-tooling-files.md).

## T1 implementation record

**Problem.** The Angular `HttpClient` link used `any` for its transformer and response body, assigned an untyped `any` response in `HTTPResult.meta`, built equivalent metadata objects for successful and HTTP-error responses, and retained a PATCH branch that the public link rejects before request dispatch.

**Change.** `CombinedDataTransformer` now types the request serializer; response bodies stay `unknown` until the tRPC `transformResult` boundary; HTTP response metadata has concrete status, status text, Angular headers, URL, JSON/text accessors, and raw `responseJSON` types. One helper builds metadata for both success and HTTP-error paths. Request dispatch covers only GET queries and POST mutations or query overrides, with subscription rejection retained before dispatch.

**Behavior retained.** Scalar values including `false`, `0`, empty string, and `null` continue through SuperJSON. Async headers are resolved before the request starts. GET query input stays in the URL; method-overridden query input stays in the POST body. Cancellation keeps the operation abort reason, native/fallback AbortError behavior, HTTP subscription teardown, and abort-listener cleanup. HTTP error response bodies and the fallback response shape remain intact, and error metadata still includes status, headers, and the original `responseJSON`. Angular `HttpClient` remains in use, so the app's credential and SSR cookie interceptor path is unchanged.

**Files and verification.** This subsequent scoped task touched three app transport files outside the original 210-path UI/tooling audit inventory:

| Path                                              | Purpose and result                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/trpc/http-utils.ts`             | Types the local tRPC HTTP helpers, transformer, response body, metadata, and supported procedure types.                                           |
| `apps/app/src/app/trpc/trpc-link-angular.ts`      | Keeps the Angular `HttpClient` link and cancellation behavior while consolidating response metadata and removing unreachable PATCH dispatch.      |
| `apps/app/src/app/trpc/trpc-link-angular.spec.ts` | Retains the original 11 tests and adds structured HTTP-error metadata, async headers, POST query override, and pending-header cancellation cases. |

Validation: `pnpm --dir apps/app exec ng test app --watch=false --include src/app/trpc/trpc-link-angular.spec.ts` passed. The Angular test builder compiled the updated transport; all 15 tests passed. No broader app suite or full workspace checks were run in this chunk.

## H2 implementation record

**Plan.** Replace both old history lists with one domain-specific audit table. Keep TanStack v9 in manual server-sort/page mode, query with project ID, optional deployment ID, and current session, and offer search, event and actor filters, page-size controls, loading/error/empty states, and admin-only history removal. Keep old history endpoint and data method available for other existing callers. Reset table state as search/filter/sort/scope changes and correct a stale page if a later result total shrinks.

**Change.** `DeploymentHistory` now owns its Angular Query request and TanStack Table. The project page requests every audit row page-by-page; the deployment overview uses the identical table with deployment scoping. The deployment ID column stays visible and sortable in both scopes. Query keys carry session and project scope. The audit query polls every 10 seconds as before; deployments invalidation includes the audit prefix. Existing detail and preview-status/log invalidation prefixes are now named in `deploymentKeys` with their existing session/project matching. The table presents time, event, deployment ID, actor snapshots, non-secret JSON details, and admin-only `Forget history`; errors have retry controls. Search is length-limited to the API contract and scope changes clear local state.

**Files added or changed outside the original 210-path inventory.**

| Path                                                          | Result                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/projects/deployment-audit-columns.ts` | Adds sortable time, event, deployment, and actor column definitions with detail/action cells.                                                                                                             |
| `apps/app/src/app/pages/projects/deployment-history.ts`       | Owns the scoped audit query, table state, controls, pagination clamp, and authorized history action presentation.                                                                                         |
| `apps/app/src/app/pages/projects/deployment-history.html`     | Holds the extracted history card/table template without changing its rendered structure.                                                                                                                  |
| `apps/app/src/app/pages/projects/deployment-history.spec.ts`  | Protects server scope, sort and pagination requests, real sort/filter control interactions, details, empty/error behavior, state reset across scope/session switches, and admin/viewer action visibility. |
| `apps/app/src/app/pages/projects/deployment-list.ts`          | Passes project scope to the table and removes obsolete history array/status inputs.                                                                                                                       |
| `apps/app/src/app/pages/projects/deployment-overview.ts`      | Passes project/deployment scope to the same table and drops embedded limited history data.                                                                                                                |
| `apps/app/src/app/pages/projects/deployment-detail.ts`        | Stops passing deployment detail's old embedded history list.                                                                                                                                              |
| `apps/app/src/app/queries/deployments.ts`                     | Adds typed audit query options/key and explicit prefixes for detail, preview, logs, and audit invalidation while preserving poll/match scope.                                                             |

Validation: `pnpm exec ng test app --watch=false --include src/app/pages/projects/deployment-history.spec.ts` passed; Angular compiled the app and all 7 history tests passed. The tests exercise server pagination and sorting, rendered sort/filter controls, project/deployment/session scope reset and key isolation, retained details, empty/error states, total-shrink clamping, and admin/viewer history actions.

## T2 implementation record

**Problem and change.** Angular's dev-server dependency optimizer had cached an incomplete built copy of the workspace `@senv/api` package while shared Zod exports were changing. The installed dev-server schema confirms that excluding the package root also excludes its subpaths. `apps/app/angular.json` now sets `serve.options.prebundle.exclude` to `['@senv/api']`, so development serves workspace package exports directly. Other dependency prebundling, production build configuration, runtime API behavior, and the app/proxy topology are unchanged.

Validation: `apps/app/angular.json` parses as JSON; `ng serve app --port 4300` built both client and SSR bundles, and `curl http://localhost:4300/login` returned HTTP 200. The parent browser check confirmed shared validation exports load without optimizer errors and login form Zod errors appear for an invalid email and short password; valid fields enable submit. No submission or API write occurred. The alternate port's API CORS prevented authenticated UI verification; its temporary public-login-only route guard fixture was restored. I stopped only dev-server session 83737 after the check; existing ports 4200 and 3000 were untouched.

## R1 implementation record

**Plan.** Put a developer/admin-only Redeploy link beside the captured artifact. The link navigates to the existing project deployment page with `redeploy=<deploymentId>`. Only retained, non-removing deployment content may be reused. Keep artifact/image references, project defaults, and saved credential identifiers in the authorized app/API flow; never put secret values into a URL or browser draft.

**Change in this scope.** Added `canReuseDeployment` in `deployment-presentation.ts` to share the same retained-content policy between the source detail and frontend publication options. It allows failed/queued records when their matching static artifact or container digest remains, and rejects deleted, cleaned, removal-pending, or missing-content records. `DeploymentConfiguration` now shows the link only for managers with reusable content. The target page prefill is being wired by the frontend owner under the `redeploy` query parameter.

**Files added or changed outside the original 210-path inventory.**

| Path                                                               | Result                                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/projects/deployment-presentation.ts`       | Adds the narrow shared retained-content eligibility helper.                                                    |
| `apps/app/src/app/pages/projects/deployment-presentation.spec.ts`  | Covers static/container retained content, failed/queued states, terminal states, cleanup, and missing content. |
| `apps/app/src/app/pages/projects/deployment-configuration.ts`      | Adds the artifact-adjacent permission-aware Redeploy link.                                                     |
| `apps/app/src/app/pages/projects/deployment-configuration.spec.ts` | Checks the route/query value and developer/viewer/removed/missing-content visibility.                          |
| `apps/app/src/app/pages/projects/deployment-overview.ts`           | Passes manager permission to captured configuration for shortcut eligibility.                                  |

Validation will be recorded after the frontend's target-page prefill work is integrated and the focused test run passes.

## Z2 implementation record

**Change.** `DeploymentActions.assignTag` now trims and lowercases the typed draft as before, then calls the same `deploymentTagNameSchema` used by the API. Invalid labels retain the existing explanatory toast and never reach the mutation. The single shared schema lives at `apps/api/shared/deployment-tags.ts`; the backend implementation/audit ledger owns its recorded schema and API use.

**Files added or changed outside the original 210-path inventory.**

| Path                                                         | Result                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/projects/deployment-actions.ts`      | Uses shared Zod safe-parse before tag mutation; success and error behavior remain unchanged.                    |
| `apps/app/src/app/pages/projects/deployment-actions.spec.ts` | Confirms reserved-prefix rejection, unchanged error copy, and valid tag trimming/lowercasing before assignment. |

Validation: `pnpm exec ng test app --watch=false --include src/app/pages/projects/deployment-*.spec.ts` passed. Angular compiled the app and all 24 deployment tests passed across five files, including H2/R1 UI and helper coverage.

## Validation and limits

The 210-path inventory was derived from `git ls-files` at the recorded baseline. UI source was read in full; root/docs/workflow files were read in full. `pnpm-lock.yaml` package payload was intentionally inspected through generated metadata/importer consistency only, as requested. GitHub workflows were reviewed using the repository Actions hardening guidance. This audit did not run builds or tests; the parent is handling baseline checks. The only source-of-truth comparisons outside the assigned paths were read-only checks of the deployment ID generator, invitation callback, schema, and initial migration to verify U1.
