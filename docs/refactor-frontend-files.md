# Frontend file audit ledger

This is the baseline review ledger. Original proposed decisions are retained as review history. The [completed plan](refactor-plan.md), [size/resource follow-up](refactor-follow-up-plan.md), additions ledgers, and [final verification](refactor-verification.md) record the implemented result.

`Keep` means the file has a clear domain purpose and should remain unless a listed narrow chunk needs it. `Extract template` means a possible F5 presentation-only move. Specs are kept as behavioral safeguards. Every tracked in-scope path appears once.

### App config and public assets (14 files)

| Path                               | Purpose and audit decision                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/app/.postcssrc.json`         | Tailwind v4 PostCSS plugin; keep with the existing CSS toolchain.                                   |
| `apps/app/.prettierignore`         | Excludes generated/dependency output; keep.                                                         |
| `apps/app/Dockerfile`              | Runs the built SSR bundle on port 4200; preserve runtime command and image assumptions.             |
| `apps/app/angular.json`            | Angular build, SSR, budgets and unit-test targets; keep the current build shape.                    |
| `apps/app/components.json`         | Spartan generator aliases/style; keep aligned with `libs/ui`.                                       |
| `apps/app/package.json`            | Angular, Spartan, TanStack and tRPC dependencies/scripts; keep stack and pinned workspace versions. |
| `apps/app/prettier.config.mjs`     | Import ordering and Tailwind class formatting; keep.                                                |
| `apps/app/public/favicon-dark.svg` | White senv mascot favicon; keep as a distinct dark-theme asset.                                     |
| `apps/app/public/favicon.svg`      | Black senv mascot favicon; keep as a distinct light-theme asset.                                    |
| `apps/app/public/login-image.webp` | Abstract blurred warm gradient used by the auth layout; inspected and keep.                         |
| `apps/app/vite.config.ts`          | Vite Plus build task/cache inputs; keep because app/API shared sources participate in builds.       |
| `apps/app/tsconfig.json`           | Strict Angular TS config and local Spartan aliases; keep.                                           |
| `apps/app/tsconfig.app.json`       | App source compilation and diagnostics; keep strict checks.                                         |
| `apps/app/tsconfig.spec.json`      | Test globals and spec compilation; keep.                                                            |

### Bootstrap, routing, auth and layouts (26 files)

| Path                                                | Purpose and audit decision                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/app.config.server.ts`             | Merges browser config with SSR providers; keep.                                                                         |
| `apps/app/src/app/app.config.ts`                    | Router, HTTP, query, SEO, devtools and settled-session initializer; keep ordering and session wait.                     |
| `apps/app/src/app/app.routes.server.ts`             | SSR render mode for all routes; keep explicit.                                                                          |
| `apps/app/src/app/app.routes.ts`                    | Lazy routes and guards for setup, auth, projects, invitation and admin; preserve route order and direct-link semantics. |
| `apps/app/src/app/app.spec.ts`                      | Root shell/toaster smoke coverage; keep.                                                                                |
| `apps/app/src/app/app.ts`                           | Root outlet and deferred toaster; keep.                                                                                 |
| `apps/app/src/app/auth/account-password.ts`         | Password request/self/admin reset/completion HTTP calls; keep explicit operation names.                                 |
| `apps/app/src/app/auth/account-signup.ts`           | Signup details/completion/resend HTTP calls; keep distinct from project invitations.                                    |
| `apps/app/src/app/auth/auth-client.ts`              | Better Auth plugins/session signals/logout; F1 captures the session query once without changing the flow.               |
| `apps/app/src/app/auth/auth-guard.spec.ts`          | Role denial and retry destination coverage; keep.                                                                       |
| `apps/app/src/app/auth/auth-guard.ts`               | Session and role route guards; keep pending/error distinctions and safe redirect.                                       |
| `apps/app/src/app/auth/auth-result.ts`              | Converts Better Auth result objects into useful failures; keep central helper.                                          |
| `apps/app/src/app/auth/auth-state.ts`               | Shared blocked-session signal; keep small and explicit.                                                                 |
| `apps/app/src/app/auth/better-auth-adapter.ts`      | Angular signal/RxJS adapter around Better Auth; high-risk integration, keep absent targeted defects.                    |
| `apps/app/src/app/auth/cookies.interceptor.ts`      | Browser credentials and SSR cookie forwarding for custom API HTTP calls; keep API/auth exclusions.                      |
| `apps/app/src/app/auth/instance-setup.spec.ts`      | First-admin setup guard and outage coverage; keep.                                                                      |
| `apps/app/src/app/auth/instance-setup.ts`           | Setup-status/setup HTTP methods and guards; keep.                                                                       |
| `apps/app/src/app/auth/session-query-cache.spec.ts` | Session change clears query cache; keep.                                                                                |
| `apps/app/src/app/auth/session-query-cache.ts`      | Clears identity-scoped TanStack cache on session changes; keep.                                                         |
| `apps/app/src/app/auth/session-recovery.spec.ts`    | Redirect safety, retries, logout confirmation and cache clearing; keep.                                                 |
| `apps/app/src/app/auth/session-recovery.ts`         | Recovery expectation/block/unblock logic; F1 now reuses its session query and retains failed expectations for retry.    |
| `apps/app/src/app/layouts/auth.layout.ts`           | Auth shell, brand and inspected background image; keep appearance.                                                      |
| `apps/app/src/app/layouts/base.layout.ts`           | Minimal public/error page shell; keep unless a caller demonstrates unused API.                                          |
| `apps/app/src/app/layouts/dashboard-header.ts`      | Dashboard title/profile/logout controls; keep.                                                                          |
| `apps/app/src/app/layouts/dashboard.layout.ts`      | Sidebar, admin links, navigation title and blocked-session outlet; keep route state.                                    |
| `apps/app/src/app/layouts/header.ts`                | Public header based on current auth user; keep.                                                                         |
| `apps/app/src/app/layouts/impersonation-banner.ts`  | Stops impersonation then verifies recovered session; keep confirmation and redirect.                                    |

### Admin and account pages (23 files)

| Path                                                                                  | Purpose and audit decision                                                                |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/404.page.ts`                                                  | Not-found page; keep.                                                                     |
| `apps/app/src/app/pages/forbidden.page.ts`                                            | Access-denied page; keep distinct from 404.                                               |
| `apps/app/src/app/pages/unavailable.page.ts`                                          | Retry/logout recovery page; keep destination and setup checks.                            |
| `apps/app/src/app/pages/admin/admin-deployment-defaults/admin-deployment-defaults.ts` | Instance upload/proxy/log defaults form; keep admin-only bounds and byte conversion.      |
| `apps/app/src/app/pages/admin/admin-stats.spec.ts`                                    | User-stat rendering/error states; keep.                                                   |
| `apps/app/src/app/pages/admin/admin-stats.ts`                                         | Admin user counts and trends; keep.                                                       |
| `apps/app/src/app/pages/admin/admin-users.page.ts`                                    | Admin users page composition and query-param inputs; keep.                                |
| `apps/app/src/app/pages/admin/create-user/create-user.spec.ts`                        | Create-user and signup-email outcomes; keep.                                              |
| `apps/app/src/app/pages/admin/create-user/create-user.ts`                             | Admin account creation form; keep signup/resend messaging.                                |
| `apps/app/src/app/pages/admin/user-table/columns.ts`                                  | User table columns and cell renderers; keep.                                              |
| `apps/app/src/app/pages/admin/user-table/user-action-dropdown.spec.ts`                | Role, reset, impersonation and delete safeguards; keep.                                   |
| `apps/app/src/app/pages/admin/user-table/user-action-dropdown.ts`                     | Per-user admin actions; keep guarded actions and session recovery.                        |
| `apps/app/src/app/pages/admin/user-table/user-role-badge.ts`                          | Instance role badge; keep small renderer.                                                 |
| `apps/app/src/app/pages/admin/user-table/user-table-features.ts`                      | TanStack table features/types; keep explicit extension config.                            |
| `apps/app/src/app/pages/admin/user-table/user-table.spec.ts`                          | Search, sort, pagination, selection and bulk deletion coverage; keep.                     |
| `apps/app/src/app/pages/admin/user-table/user-table.ts`                               | URL-backed server table and bulk actions; optional F5 template-only extraction.           |
| `apps/app/src/app/pages/admin/user-table/user-verified-badge.ts`                      | Email verification badge; keep small renderer.                                            |
| `apps/app/src/app/pages/auth/forgot-password.page.ts`                                 | Password reset request form; preserve non-disclosing success message.                     |
| `apps/app/src/app/pages/auth/login.page.spec.ts`                                      | Login success/session/error coverage; keep.                                               |
| `apps/app/src/app/pages/auth/login.page.ts`                                           | Login and safe redirect; keep flow.                                                       |
| `apps/app/src/app/pages/auth/reset-password.page.ts`                                  | Token completion and post-reset session recovery; keep.                                   |
| `apps/app/src/app/pages/auth/setup/setup.page.ts`                                     | First admin setup flow; preserve create-then-sign-in behavior.                            |
| `apps/app/src/app/pages/auth/signup/signup.page.spec.ts`                              | Signup token loading and completion behavior; keep.                                       |
| `apps/app/src/app/pages/auth/signup/signup.page.ts`                                   | Invited account signup, verification and login; keep distinct from invitation acceptance. |
| `apps/app/src/app/pages/profile/profile-page/profile-page.page.ts`                    | Profile and password verification email; keep.                                            |
| `apps/app/src/app/pages/profile/profile-page/profile-page.spec.ts`                    | Profile identity and reset email states; keep.                                            |

### Project, membership and invitation pages (22 files)

| Path                                                                                              | Purpose and audit decision                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/projects/invitation-page/invitation-page.page.ts`                         | Verify-email gate, switch account and invitation acceptance; preserve invitation return URL.                                                                         |
| `apps/app/src/app/pages/projects/invite-form/invite-form.spec.ts`                                 | Invitation form role/email and submit coverage; keep.                                                                                                                |
| `apps/app/src/app/pages/projects/invite-form/invite-form.ts`                                      | Project invitation form using shared role validation; keep.                                                                                                          |
| `apps/app/src/app/pages/projects/project-invitations/invitation-columns.ts`                       | Typed invitation table columns and formatting; keep.                                                                                                                 |
| `apps/app/src/app/pages/projects/project-invitations/project-invitations.spec.ts`                 | Sort/search/pagination/cancellation coverage; keep.                                                                                                                  |
| `apps/app/src/app/pages/projects/project-invitations/project-invitations.ts`                      | Server-paginated open invitation table; keep server sorting and last-page correction.                                                                                |
| `apps/app/src/app/pages/projects/project-members/member-columns.ts`                               | Typed member table columns; keep.                                                                                                                                    |
| `apps/app/src/app/pages/projects/project-members/project-members.spec.ts`                         | Member visibility, search, sort and role controls; keep.                                                                                                             |
| `apps/app/src/app/pages/projects/project-members/project-members.ts`                              | Local searchable/sortable member table and role/removal actions; keep role gates.                                                                                    |
| `apps/app/src/app/pages/projects/project-page/project-page.page.ts`                               | Project section tabs, project rename, member actions and child panels; optional F5 template-only extraction.                                                         |
| `apps/app/src/app/pages/projects/project-sections.ts`                                             | Canonical valid section names and route guard predicate; keep shared route contract.                                                                                 |
| `apps/app/src/app/pages/projects/project-routing.spec.ts`                                         | Direct section/deployment/log links, lazy data, breadcrumbs and tab navigation coverage; keep.                                                                       |
| `apps/app/src/app/pages/projects/projects-page/projects-page.page.ts`                             | Virtualized/infinite project list, slug suggestion and creation; optional F5 template-only extraction.                                                               |
| `apps/app/src/app/pages/projects/projects.spec.ts`                                                | Project creation/list, slug, settings and membership coverage; keep.                                                                                                 |
| `apps/app/src/app/pages/projects/project-registry-credentials/project-registry-credentials.ts`    | Manage project registry credentials; preserve hidden secret values and credential clearing.                                                                          |
| `apps/app/src/app/pages/projects/project-runtime-settings/project-runtime-settings.ts`            | Runtime env/secrets draft parsing and save flow; optional F5 template-only extraction, keep secret values hidden.                                                    |
| `apps/app/src/app/pages/projects/project-runtime-settings/project-runtime-settings.spec.ts`       | Runtime key validation, secret add/replace/remove and read-only behavior; keep.                                                                                      |
| `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.ts`      | Settings validation, local draft/save, slug changes and state; F2 template and F3 pure model mapping are complete; Z1 will move validation to the shared Zod schema. |
| `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.html`    | F2 extracted settings page markup; preserve as exact presentation equivalent.                                                                                        |
| `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.spec.ts` | Extensive settings permissions, validation, draft and save coverage; keep as primary F2/F3/Z1 safeguard.                                                             |
| `apps/app/src/app/pages/projects/project-deployments/project-deployments.ts`                      | Static/container publish form, artifact reuse, browser draft and deployment lists; optional F5 template-only extraction.                                             |
| `apps/app/src/app/pages/projects/project-deployments/project-deployments.spec.ts`                 | Publish/list/detail preview behavior; F1b updates only the stale preview heading assertion.                                                                          |

### Deployment pages and helpers (22 files)

| Path                                                              | Purpose and audit decision                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/projects/deployment-actions.ts`           | Session/project-scoped deployment mutation state and confirmations; keep lifecycle race guards. |
| `apps/app/src/app/pages/projects/deployment-configuration.ts`     | Captured config and non-secret environment display; keep.                                       |
| `apps/app/src/app/pages/projects/deployment-detail.ts`            | Detail/log route data, role and breadcrumbs; keep lazy view behavior.                           |
| `apps/app/src/app/pages/projects/deployment-history.ts`           | Retained audit history and admin removal control; keep privacy boundaries.                      |
| `apps/app/src/app/pages/projects/deployment-lifecycle-actions.ts` | Stop/restart/delete visibility rules; keep predicates.                                          |
| `apps/app/src/app/pages/projects/deployment-list-item.ts`         | Deployment summary row/actions; keep IDs, status, tags and links.                               |
| `apps/app/src/app/pages/projects/deployment-list.ts`              | Deployment list/history loading and empty states; keep.                                         |
| `apps/app/src/app/pages/projects/deployment-logs.ts`              | Origin/proxy log source, URL state and cursor loading; keep query cancellation/paging.          |
| `apps/app/src/app/pages/projects/deployment-overview.ts`          | Deployment summary, config, source and retention contexts; keep coherent page composition.      |
| `apps/app/src/app/pages/projects/deployment-pin.ts`               | Pin action control; keep accessible pressed state.                                              |
| `apps/app/src/app/pages/projects/deployment-presentation.ts`      | Pure status, URL and retention presentation rules; keep domain-specific helpers.                |
| `apps/app/src/app/pages/projects/deployment-preview-actions.ts`   | Open/copy preview actions; keep healthy/terminal gates.                                         |
| `apps/app/src/app/pages/projects/deployment-preview-status.ts`    | Public-root HTTP check, refresh and status; keep its current `Browser Health check` heading.    |
| `apps/app/src/app/pages/projects/deployment-retention.ts`         | Retention label/context rendering; keep derived helper use.                                     |
| `apps/app/src/app/pages/projects/deployment-source-links.spec.ts` | Repository/provider URL behavior coverage; keep.                                                |
| `apps/app/src/app/pages/projects/deployment-source-links.ts`      | Safe source URLs for GitHub/GitLab/Forgejo/Gitea; keep schema gate and encoding.                |
| `apps/app/src/app/pages/projects/deployment-tags.ts`              | Preview aliases/tags and assignment controls; keep healthy target and role gates.               |

### Queries, upload, utilities and tables (19 files)

| Path                                                        | Purpose and audit decision                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/queries/deployment-upload.spec.ts`        | Directory path preservation and upload response validation; keep.                                                                                                            |
| `apps/app/src/app/queries/deployment-upload.ts`             | Archive/directory multipart upload and response validation; keep directory-root checks.                                                                                      |
| `apps/app/src/app/queries/deployments.ts`                   | Deployment queries/mutations/key invalidation; F6 may add missing prefixes to current keys.                                                                                  |
| `apps/app/src/app/queries/projects.ts`                      | Project queries/mutations and slug invalidation; keep session-scoped keys.                                                                                                   |
| `apps/app/src/app/queries/users.ts`                         | Better Auth user admin data and tRPC stats; keep the distinct providers.                                                                                                     |
| `apps/app/src/app/query-client.ts`                          | Shared TanStack Query defaults and SSR retry behavior; keep per-platform difference.                                                                                         |
| `apps/app/src/app/tools/form-validation.ts`                 | Shared account/project/password Signal Forms schemas; keep shared domain bounds.                                                                                             |
| `apps/app/src/app/tools/query-devtools.ts`                  | Lazy dev query panel; keep development-only wiring.                                                                                                                          |
| `apps/app/src/app/tools/seo.ts`                             | Meta/canonical URL updates; keep. Strategy and imperative methods intentionally differ for resolved image URLs, so do not merge writers without preserving that distinction. |
| `apps/app/src/app/tools/seo.types.ts`                       | SEO config token and typed route metadata helper; keep.                                                                                                                      |
| `apps/app/src/app/tools/table/pagination.ts`                | Last-page index helper for server tables; keep pure function.                                                                                                                |
| `apps/app/src/app/tools/table/sort.ts`                      | URL sort serialization/parsing; keep URL contract.                                                                                                                           |
| `apps/app/src/app/tools/title.strategy.ts`                  | Route title/meta aggregation; keep child-over-parent metadata behavior.                                                                                                      |
| `apps/app/src/app/ui/breadcrumbs.ts`                        | Accessible breadcrumb renderer; keep.                                                                                                                                        |
| `apps/app/src/app/ui/duration-input/duration-input.spec.ts` | Duration control accessibility and value conversion; keep.                                                                                                                   |
| `apps/app/src/app/ui/duration-input/duration-input.ts`      | Reusable seconds/duration input; keep labels and Signal Forms integration.                                                                                                   |
| `apps/app/src/app/ui/format-bytes.ts`                       | Small byte formatter shared by deployment views; keep.                                                                                                                       |
| `apps/app/src/app/ui/initials-pipe.ts`                      | Avatar initials pipe; keep simple pure formatting.                                                                                                                           |
| `apps/app/src/app/ui/password-input.ts`                     | Accessible show/hide password input; keep control contract.                                                                                                                  |
| `apps/app/src/app/ui/table/pagination.ts`                   | TanStack pagination controls; keep interaction; avoid name-only churn despite the existing `TablePaginaton` export spelling.                                                 |
| `apps/app/src/app/ui/table/search-input.ts`                 | Search input with clear action; keep accessible control.                                                                                                                     |
| `apps/app/src/app/ui/table/selection-actions.ts`            | Bulk delete confirmation; keep pending-state and confirmation behavior.                                                                                                      |
| `apps/app/src/app/ui/table/selection-column.ts`             | Select-all and row checkboxes; keep page-scoped selection semantics.                                                                                                         |
| `apps/app/src/app/ui/table/sort-header-button.ts`           | TanStack sort toggle and icon; keep metadata label behavior.                                                                                                                 |

### tRPC, runtime entry and global styles (12 files)

| Path                                                   | Purpose and audit decision                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/trpc/http-utils.ts`                  | Narrow copy of tRPC HTTP serialization/URL helpers; keep only as long as Angular transport requires, document upstream version when changing.                           |
| `apps/app/src/app/trpc/trpc-link-angular.spec.ts`      | Scalar/SuperJSON, abort, teardown and listener coverage; keep as required F4 safeguards.                                                                                |
| `apps/app/src/app/trpc/trpc-link-angular.ts`           | Angular `HttpClient` tRPC transport and cancellation; retain pending a behavior-equivalent simplification.                                                              |
| `apps/app/src/app/trpc/trpc.service.ts`                | Typed tRPC client, logger and Angular link; keep.                                                                                                                       |
| `apps/app/src/environments/environment.development.ts` | Local API/base URL and default project route; keep aligned with proxy/dev setup.                                                                                        |
| `apps/app/src/environments/environment.ts`             | Production API/base URL and default route; keep.                                                                                                                        |
| `apps/app/src/index.html`                              | Document metadata, canonical link and icon references; keep in sync with SEO service.                                                                                   |
| `apps/app/src/main.server.ts`                          | SSR bootstrap; keep.                                                                                                                                                    |
| `apps/app/src/main.ts`                                 | Browser bootstrap; keep.                                                                                                                                                |
| `apps/app/src/server.ts`                               | Express SSR/static handler and 4200 default; behavior is correct, but the startup comment still says 4000 and can be corrected as a trivial documentation-only cleanup. |
| `apps/app/src/styles.css`                              | Tailwind, dark/light theme tokens and base styles; preserve as the visual system.                                                                                       |
