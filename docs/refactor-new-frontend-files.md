# New frontend files

This ledger covers the 62 currently untracked `apps/app` files in this frontend scope. It excludes the publication, deployment settings, runtime settings, and registry credential folders owned by the other frontend worker. Each entry records the file's concrete responsibility and the review focus.

## UI class utilities

| Full path                                                       | Purpose and review                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/libs/ui/utils/src/lib/class-normalization.ts`         | Keeps the public Tailwind-aware `hlm` merge and cached class-token parsing together; reviewed cache bounds and input normalization.                                                     |
| `apps/app/libs/ui/utils/src/lib/element-class-manager.types.ts` | Defines the shared per-element manager and source-registration state; reviewed the state needed for multiple class sources and transition restoration.                                  |
| `apps/app/libs/ui/utils/src/lib/element-class-manager.ts`       | Registers, updates, and removes class sources, including hydration transition suppression; reviewed cleanup when destruction occurs before the restore frame.                           |
| `apps/app/libs/ui/utils/src/lib/element-class-observer.ts`      | Tracks managed elements and reconciles external class mutations while preserving source ordering; reviewed browser-only observer setup and final observer cleanup.                      |
| `apps/app/src/app/ui/hlm.spec.ts`                               | Exercises public `classes()` behavior when an element is destroyed before its first paint; verifies class application, RAF cancellation, and restoration of inline transition priority. |

## Auth helpers

| Full path                                  | Purpose and review                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/auth/auth-atom-proxy.ts` | Adapts Better Auth atoms to Angular signals and observables and owns atom subscription cleanup; reviewed server pending-task behavior and unknown-typed cache values. |
| `apps/app/src/app/auth/auth-http-utils.ts` | Converts Fetch headers and normalizes successful/error auth responses; reviewed body and response-header preservation.                                                |

## Admin forms and user table

| Full path                                                                                       | Purpose and review                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/admin/admin-deployment-defaults/admin-deployment-defaults.form.ts`      | Defines the Zod-backed admin draft, API conversion, and server-error field mapping; reviewed MiB-to-byte conversion and schema boundaries.               |
| `apps/app/src/app/pages/admin/admin-deployment-defaults/admin-deployment-defaults.form.spec.ts` | Covers MiB conversion and API validation-error mapping.                                                                                                  |
| `apps/app/src/app/pages/admin/admin-deployment-defaults/admin-deployment-defaults.html`         | Holds the instance defaults form markup extracted from the component; reviewed field labels, units, and submit state.                                    |
| `apps/app/src/app/pages/admin/user-table/delete-selected-users.ts`                              | Handles ordered bulk deletion, partial failures, selection cleanup, toast feedback, and cache invalidation; reviewed the busy guard and `finally` reset. |
| `apps/app/src/app/pages/admin/user-table/user-table-route-effects.ts`                           | Synchronizes user search, sorting, and pagination with route parameters; reviewed page-bound repair and merge-preserving navigation.                     |
| `apps/app/src/app/pages/admin/user-table/user-table.spec-support.ts`                            | Supplies user/session/query fixtures and an explicit per-suite hook-registration function; reviewed isolation and teardown for each split spec.          |
| `apps/app/src/app/pages/admin/user-table/user-table-deletion.spec.ts`                           | Covers successful deletion after row order changes, partial failures, and preserving selection when deletion is blocked.                                 |
| `apps/app/src/app/pages/admin/user-table/user-table-query.spec.ts`                              | Covers query errors/retry and clearing cached users/selection when the session changes.                                                                  |
| `apps/app/src/app/pages/admin/user-table/user-table-routing.spec.ts`                            | Covers route-backed page size and repairing pagination after deleting the last user on a page.                                                           |
| `apps/app/src/app/pages/admin/user-table/user-table.html`                                       | Holds the user table template extracted from its component; reviewed search, selection, pagination, and empty/error states.                              |
| `apps/app/src/app/pages/admin/user-table/user-action-dropdown.html`                             | Holds the per-user action menu template; reviewed its accessible trigger and action labels.                                                              |
| `apps/app/src/app/pages/auth/setup/setup.page.html`                                             | Holds the setup account form template; reviewed field/error bindings and submit-state messaging.                                                         |

## Deployment and project pages

| Full path                                                                      | Purpose and review                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/pages/projects/deployment-actions.spec.ts`                   | Covers shared tag validation, rejection messaging, normalization, assignment, and draft clearing.                                                                   |
| `apps/app/src/app/pages/projects/deployment-audit-columns.ts`                  | Defines TanStack audit columns, search/filter/sort behavior, and cell values; reviewed event, actor, deployment, and detail accessors.                              |
| `apps/app/src/app/pages/projects/deployment-configuration.spec.ts`             | Covers the retained-artifact redeploy link and its visibility for viewers, removed deployments, and missing artifacts.                                              |
| `apps/app/src/app/pages/projects/deployment-context.ts`                        | Presents source, retention, tags, preview status, dates, and artifact context; reviewed the component's focused inputs and derived display helpers.                 |
| `apps/app/src/app/pages/projects/deployment-context.html`                      | Holds the deployment context markup extracted from its parent; reviewed failure/retention states and source links.                                                  |
| `apps/app/src/app/pages/projects/deployment-detail-routing.spec.ts`            | Covers resource/log direct routes, breadcrumbs, origin/proxy switching, and overview navigation; retains safeguards for detail-only data and controls.              |
| `apps/app/src/app/pages/projects/deployment-history-empty-state.ts`            | Encapsulates audit loading, error, filtered-empty, and no-history state inputs plus retry output.                                                                   |
| `apps/app/src/app/pages/projects/deployment-history-empty-state.html`          | Renders the accessible audit empty/loading/error states and retry action.                                                                                           |
| `apps/app/src/app/pages/projects/deployment-history.html`                      | Holds the searchable, filterable, sortable audit table template; reviewed sort semantics, filter controls, row actions, and pagination.                             |
| `apps/app/src/app/pages/projects/deployment-history.test-support.ts`           | Supplies audit/session fixtures and a per-suite hook-registration function; reviewed query setup and fixture cleanup.                                               |
| `apps/app/src/app/pages/projects/deployment-history-table.spec.ts`             | Covers server-scoped pagination/sorting, search, event/actor filters, and "All events"/"All actors" trigger labels.                                                 |
| `apps/app/src/app/pages/projects/deployment-history-permissions.spec.ts`       | Covers project-wide audit scope and admin-only history removal.                                                                                                     |
| `apps/app/src/app/pages/projects/deployment-history-refresh.spec.ts`           | Covers filter/page reset on scope changes and session-aware audit query keys.                                                                                       |
| `apps/app/src/app/pages/projects/deployment-history-pagination.spec.ts`        | Covers viewer action restrictions and correcting the current page after a shrinking result set.                                                                     |
| `apps/app/src/app/pages/projects/deployment-history-errors.spec.ts`            | Covers audit error alerting, retry, and retained filters.                                                                                                           |
| `apps/app/src/app/pages/projects/deployment-list-item.html`                    | Holds the deployment list-row template extracted from its component; reviewed status, source, preview, and action display.                                          |
| `apps/app/src/app/pages/projects/deployment-overview.html`                     | Holds the deployment overview template; reviewed status/configuration information and links to logs and origin resources for every deployment kind.                 |
| `apps/app/src/app/pages/projects/deployment-presentation.spec.ts`              | Covers which active deployments with retained artifacts or image digests may be reused and which terminal/removing states may not.                                  |
| `apps/app/src/app/pages/projects/deployment-resources.ts`                      | Implements the origin resource page query, browser-only polling guard, and display helpers; reviewed route inputs and unavailable-reason mapping.                   |
| `apps/app/src/app/pages/projects/deployment-resources.html`                    | Renders live CPU and memory values, timestamp, accessible memory meter, loading/error/unavailable states, and retry; stale samples are hidden after refresh errors. |
| `apps/app/src/app/pages/projects/deployment-resources.spec.ts`                 | Covers sampled values, unavailable-without-zero, loading, and error-first refresh behavior.                                                                         |
| `apps/app/src/app/pages/projects/project-routing.fixture.ts`                   | Provides deployment/resource/log and project query fixtures for route tests; reviewed the behavior returned for deployment details, audit, logs, and resources.     |
| `apps/app/src/app/pages/projects/project-routing.test-support.ts`              | Builds the routed project harness and registers per-suite cleanup explicitly; reviewed query-client and global-stub teardown.                                       |
| `apps/app/src/app/pages/projects/project-sections-routing.spec.ts`             | Covers direct project section links and the default Deployments section.                                                                                            |
| `apps/app/src/app/pages/projects/project-invitation-flows.spec.ts`             | Covers returning to Projects after acceptance and unverified-user email verification flow.                                                                          |
| `apps/app/src/app/pages/projects/project-navigation.spec.ts`                   | Covers lazy member controls and viewer read-only project/member/settings behavior.                                                                                  |
| `apps/app/src/app/pages/projects/project-rename-create.spec.ts`                | Covers rename cache/navigation behavior and editable DNS-safe preview-slug creation.                                                                                |
| `apps/app/src/app/pages/projects/project-settings.spec.ts`                     | Covers dirty-draft protection, instance-admin recovery, late rename cache isolation, and self-removal navigation.                                                   |
| `apps/app/src/app/pages/projects/projects-list.spec.ts`                        | Covers virtual list paging, cursor submission, end-of-list behavior, and retry after next-page failure.                                                             |
| `apps/app/src/app/pages/projects/projects.spec-setup.ts`                       | Centralizes project fixtures/mocks and explicit per-suite setup/teardown; reviewed router, auth, query, and deployment providers.                                   |
| `apps/app/src/app/pages/projects/project-invitations/project-invitations.html` | Holds the invitations panel template extracted from its component; reviewed invite, resend, revoke, and empty states.                                               |
| `apps/app/src/app/pages/projects/project-members/project-members.html`         | Holds the member table template extracted from its component; reviewed role controls, invites, and viewer states.                                                   |
| `apps/app/src/app/pages/projects/project-page/project-page.page.html`          | Holds the project page template extracted from its component; reviewed section navigation and child-page rendering.                                                 |
| `apps/app/src/app/pages/projects/projects-page/projects-page.page.html`        | Holds the projects list/create template extracted from its component; reviewed creation, search, pagination, and empty/loading states.                              |

## Query and transport helpers

| Full path                                               | Purpose and review                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/src/app/queries/deployment-keys.ts`           | Centralizes session/project/deployment query keys, including audit and resource scopes; reviewed key isolation dimensions.                        |
| `apps/app/src/app/queries/deployment-queries.ts`        | Holds deployment query-option builders; reviewed enabled/session gates, refresh intervals, and forwarded cancellation signals.                    |
| `apps/app/src/app/queries/deployment-mutations.ts`      | Holds deployment/project mutation calls; reviewed the distinct mutation collaborator contract.                                                    |
| `apps/app/src/app/queries/deployment-resources.spec.ts` | Uses `QueryClient.fetchQuery` to verify resource key scope, disabled states, 2-second foreground interval, and AbortSignal forwarding.            |
| `apps/app/src/app/trpc/abort-utils.ts`                  | Provides abort checks and an AbortError fallback for environments without native helpers.                                                         |
| `apps/app/src/app/trpc/angular-http-requester.ts`       | Implements the Angular `HttpClient` request/response path for tRPC; reviewed method override, headers, cancellation, and error metadata handling. |
| `apps/app/src/app/trpc/trpc-link.test-support.ts`       | Provides HTTP test client setup and per-suite hooks; reviewed request matching and cancelled-request teardown.                                    |
| `apps/app/src/app/trpc/trpc-link-input.spec.ts`         | Covers scalar mutation/query input serialization and POST method override behavior.                                                               |
| `apps/app/src/app/trpc/trpc-link-lifecycle.spec.ts`     | Covers abort cleanup, HTTP errors/metadata, asynchronous headers, and cancellation while headers are pending.                                     |

## Validation

The Angular suite passed **56 files / 184 tests**. The production Angular build passed; it reports the configured 500 kB initial-bundle budget warning at 684.53 kB and a CommonJS `dayjs` warning. Scoped Oxlint and direct strict TypeScript checks for the extracted `hlm` and auth helpers passed. Test-support modules register `beforeEach`/`afterEach` through explicit setup functions called by each split spec, avoiding module-import side-effect ordering.

The shared `apps/app/src/app/pages/projects/test-resize-observer.ts` helper is omitted from this ownership ledger: it is used by the other worker's excluded deployment/settings specs.
