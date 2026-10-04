# Frontend audit and incremental refactor plan

This is the baseline review ledger. Original proposed decisions are retained as review history. The [completed plan](refactor-plan.md), [size/resource follow-up](refactor-follow-up-plan.md), additions ledgers, and [final verification](refactor-verification.md) record the implemented result.

## Scope and constraints

I audited the 140 tracked paths present at the start of the review under `apps/app/**`, excluding `apps/app/libs/ui/**`: 126 source files plus 14 app-level configuration and public-asset files. F2 adds one new sibling HTML template, which is also listed in the ledger. Baseline was `a09c9513264140e0e592809588bb3f074ff6822c`. There is no repository `AGENTS.md`. I read the Angular developer and unslop skills, `README.md`, `CONTEXT.md`, and the project/deployment feature documentation. I inspected the login image and both favicon SVGs.

The app is Angular 22 with signals and Signal Forms, TanStack Angular Query/Table, Better Auth, tRPC, Spartan UI, SSR/hydration and an Express Node server. Keep those choices, the current visual design, route and feature behavior, API contracts, and deployment setup. The app is built by Angular CLI through Vite Plus and served from the app image on port 4200. The API's Docker and proxy behavior lives outside this audit's scope. Approved changes are limited to session-query reuse, one stale test correction, behavior-preserving template/model extraction, shared Zod validation, and separately scoped audit/redeployment work.

The most useful rule for this tree is to make one small, reviewable change at a time. Several files look large because they contain a long inline Angular template. Moving a template to an HTML file is a low-risk readability change if the markup stays byte-for-byte equivalent. Splitting one user flow into many new components, introducing a shared CRUD/form framework, renaming identifiers for style alone, or changing the stack would add indirection without simplifying the behavior.

## Feature paths and behavior to retain

- Startup waits for Better Auth's first settled session state before routing, and clears TanStack Query data when the settled session ID changes. HTTP calls to the app API include browser credentials; SSR forwards the incoming cookie through the Angular interceptor. The tRPC client also uses Angular `HttpClient`.
- Setup guards distinguish first-instance setup from normal routes. Login, signup, reset, invitation verification, logout, impersonation and admin role changes confirm the resulting session before revealing protected data or navigating. Unsafe return URLs fall back to `/projects`.
- Project URLs use the editable project slug. Direct section/deployment/log links, breadcrumbs and slug changes must keep working. Instance admins can manage all projects. Project admin/developer/viewer access differs by action, and server-side authorization remains authoritative.
- Project settings are defaults captured by future deployments. Deployment configuration is an immutable publication snapshot. Uploads support archives or a directory, reuse retained artifacts, resolve image references, and preserve branch/tag, pin, retention, preview status, logs, and non-secret history behavior.
- Environment values and secret names are visible where permitted; secret values and saved registry credentials stay hidden. Project and deployment queries are session-keyed and invalidated after changes. Admin and project tables retain URL or local state, server pagination, sort/search behavior and accessible controls.

## Audit findings and recommended chunks

### F1, session query reuse (implemented)

`auth-client.ts` and `session-recovery.ts` called `auth.useSession()` more than once during a single logout/recovery operation. Each now captures the session query in the Angular injection context and reuses it for refetch and confirmation. This keeps the auth state machine intact: block identity, clear cached queries, mutate auth, refetch, verify the expected session, then unblock and navigate; failures still go to `/unavailable`. Existing adjacent auth tests passed before the later concurrent API edits described under verification.

### F1b, stale heading expectation (implemented)

`project-deployments.spec.ts` expected `Public preview`, while the rendered heading has been `Browser Health check`. The test now asserts the current heading. No user-facing text changed. The focused settings/deployment/auth run passed 56 tests after the test correction and template extraction.

### F2, settings template extraction (implemented)

`project-deployment-settings.ts` had a 600-line inline template followed by a focused settings state class. Its four settings sections are one coherent page, and the runtime and registry sections are already distinct child components. The template was moved verbatim to `project-deployment-settings.html`; the component class, inline styles, selector, IDs, text and bindings remain in place. Z1 uses Signal Forms metadata to preserve field constraints while retaining the extracted presentation.

### F3, settings draft mapping (implemented)

Pure API-to-form and form-to-API conversions now live in `project-deployment-settings.model.ts`; empty settings defaults derive from `deploymentSettingsSchema.parse({})` so they cannot drift from the API. `project-deployment-settings.form.ts` validates the structurally checked form draft against the canonical API schema and maps byte/compression issue paths back to the UI fields. This preserves byte/MiB conversion, blank rewrite handling, extension normalization, malformed-draft fallback, storage keys and save/session state without a generic settings framework.

### F4, tRPC link decision (recommend retaining the Angular link)

The local installed tRPC 11.18 `httpLink` is not a drop-in simplification. Its observable teardown is a no-op and its requester uses Fetch, while this app's Angular `HttpClient` interceptor forwards SSR cookies and the app's specs require cancellation to unsubscribe the HTTP request and remove abort listeners. Existing link tests also cover scalar inputs and SuperJSON. Keep `angularHttpLink` and its HTTP helper for now. A separate later chunk may tighten `any` and unsafe response casts, then factor the duplicated success/error response metadata construction inside the requester. That chunk needs to preserve response body/status metadata, abort handling, `TRPCClientError` causes, and transformed query and mutation behavior. Do not copy the full stock link into app code or adopt it without proving these requirements remain met.

### F5, remaining large templates (proposed, one file per chunk)

If F2 verifies cleanly, use the same exact-template extraction for `project-deployments.ts`, `project-runtime-settings.ts`, `project-page.page.ts`, `projects-page.page.ts`, then `user-table.ts`. Keep each component class, component-local styles, IDs, labels, DOM order, bindings, and accessibility attributes unchanged. Run that file's existing behavioral specs after each extraction. The project deployment and project list templates encode upload progress, draft persistence, virtual scrolling and invitation/project creation states, so do not combine this work with state-flow changes or visual cleanup. Leave small components inline.

### Z1, shared Zod validation in Signal Forms (in progress, small groups)

Angular 22's installed `validateStandardSchema` is stable and accepts Standard Schema validators such as Zod. Angular maps Zod issue paths onto nested Signal Forms fields, including array-item paths. Use it to avoid maintaining a second set of field validators in the UI.

1. Add narrowly scoped Zod schemas to `apps/api/shared/validation.ts` for account name/email/password/confirmation and project name/preview slug. Keep existing numeric constants where the API uses them, and preserve current error messages where the UI exposes them. Add the direct app dependency on the repository's existing Zod 4.5.4 and keep the lock update minimal.
2. Keep canonical deployment contracts in `apps/api/shared/deployments.ts`. Settings draft validation lives beside its converter in `project-deployment-settings.form.ts`, and publish validation in `project-deployments.form.ts`; both reuse canonical API schemas. Runtime line/secrets conversion lives in `project-runtime-settings.form.ts` and reuses the shared runtime API schemas.
3. Account/auth/project/invitation forms now adapt shared account/project schemas with `validateStandardSchema` in `form-validation.ts`; metadata preserves required, length and pattern attributes without duplicate validators. Existing submit, pending, error, redirect and toast flows remain in place.
4. Settings, runtime and publish forms now use Standard Schema; registry and admin-default forms are assigned to the backend owner after B5. UI-only disabled/readonly rules and local-storage draft behavior remain in component state/effects.
5. The current focused run passed 26 tests across six auth/account/project/settings/runtime files. Settings tests cover nested cache issue paths and compression-to-text mapping; runtime tests cover duplicate names, secret handling and API limits. Publish tests are being rerun after the schema update. Keep shared API tests as safeguards for unchanged server contracts.

`apps/api/server/**` currently has inline Zod validators for some auth and project inputs while the frontend imports only numeric limits. To make validation genuinely shared across server and browser, the backend owner must switch those corresponding inputs to the new shared schemas as part of their approved API work. Do not change constraints or acceptance behavior during that wiring. This audit owner is limited to the named shared schema files and frontend form files; coordinate server edits with the backend owner.

### F6, query invalidation (proposed after feature page work)

`DeploymentsData.invalidate` uses key factory functions for most query families but raw arrays for deployment details, preview checks and logs. A small, behavior-preserving follow-up can expose only the missing prefixes through the existing `deploymentKeys` object and use them in the invalidator. Preserve session and project key prefixes so invalidation remains scoped. Avoid adding generic key builders or replacing TanStack Query patterns.

### Keep stable

Keep route definitions lazy and explicit, the auth adapter that bridges Better Auth session signals to Angular, the `HttpClient` cookie interceptor, query/table features, and the domain-specific deployment helper functions. The app-wide CSS and existing Spartan wrappers define the current look. No Angular-version migration, API rewrite, permission redesign, route redesign, new state library, Dockerfile/proxy change, or broad naming pass is justified by this audit.

## Verification and current limits

The F2/F1b/auth run passed 56 tests across five files. The baseline production build passed with an initial bundle warning (674.70 kB against a 500 kB warning budget) and a Day.js devtools CommonJS warning. The current app TypeScript check passes after settings/runtime/publish schema integration. A recent focused spec compile was blocked by backend-owned admin-defaults metadata using incorrect `MIN`/`MAX` key types; the diagnostic has been sent to that owner. Re-run the combined focused suite when that form group is stable.

## Newly approved frontend requirements

The project/deployment audit table work belongs to the UI owner: project and deployment history lists should use searchable, sortable, filterable TanStack tables, with authorized-scope filter options and snapshot actor identities. Preserve the existing deployment history endpoint while adding the separate audit query contract.

R1 is approved after Z1. Use `?redeploy=<deploymentId>` to navigate to the project deployment route, open the publish card and prefill the draft once per session/project/deployment. Consume the query value after prefill so later user edits remain intact. Reuse the original retained artifact or immutable image digest, and prefill kind, image/reference or reuse ID, port, source commit/branch, pin state, and the captured registry credential ID where available. The `PublicDeployment.config.registryCredentialId` field must be optional and contain only the opaque ID; the backend owner will expose it from the captured snapshot. Reusable deployments may be queued, failed, starting, healthy, unhealthy or stopped if content remains; reject deleted, cleaned, removal-pending or missing content. Continue applying current project defaults to the new deployment, and never display or reconstruct registry secrets. The UI owner will add the artifact-adjacent button after the publish form accepts the query-driven prefill. The publish draft's old `reuseArtifactId` field stores a deployment ID for both static and container reuse; rename it to `reuseDeploymentId` and map the old local-storage key shape when loading so an existing browser draft survives.

## Per-file ledger

The complete original inventory is recorded in [the frontend file ledger](refactor-frontend-files.md).
