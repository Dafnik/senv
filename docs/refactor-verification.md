# Refactor verification

This record covers the changes planned in [the original plan](refactor-plan.md) and [the follow-up plan](refactor-follow-up-plan.md). The baseline is `a09c951`. Final checks ran after the implementation agents finished their edits.

## Stored-data compatibility

Drizzle's exported schema was compared with the checked-in initial migration using SQLite introspection. All 18 tables have matching columns, defaults, indexes, and foreign keys. The schema facade now reexports focused modules. No migration is required.

The auth generator writes a separate review artifact, `drizzle/auth-schema.generated.ts`, so it cannot overwrite the deployment tables or the schema facade. Required generated changes must be reviewed and merged into the schema modules.

## Coverage preserved during test splits

The original test declarations and assertion chains were compared with the split suites using the TypeScript parser. All original scenarios remain. Shared fixtures retain the same setup and cleanup boundaries. These deliberate assertion changes are reviewed separately.

| Original scenario                       | Reviewed change                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project routing captured at publication | Correct the stale six-character deployment-ID expectation to the existing twelve-character identifier.                                                          |
| Deployment detail title                 | Correct the stale preview heading expectation to the existing Browser Health check label.                                                                       |
| Equivalent proxy matchers               | Assert the shared Zod error message instead of the old custom validation error kind.                                                                            |
| Project section routing                 | Split project navigation and deployment logs/resources into separate scenarios. Retain the original breadcrumb, URL, accessibility, and detail-page assertions. |
| Deployment permissions                  | Expand the original permission checks into a named read/manage/admin matrix.                                                                                    |
| Container credential reuse              | Add explicit public and saved-credential override checks alongside captured-auth preservation.                                                                  |
| Docker lifecycle publication and stop   | Add real origin CPU/RAM reads and unavailable-state checks while preserving the deployment lifecycle assertions.                                                |

New tests cover audit search/filter/sort/pagination, redeploy prefill and edits, draft compatibility, shared validation, directory uploads, resource permissions and calculations, query cancellation, and resource loading/error/unavailable states.

## Final checks

| Check                         | Final result                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace formatting and lint | `pnpm run check` passes, including Angular Prettier. No lint warnings. `git diff --check` passes.                                              |
| API typecheck                 | `pnpm --filter @senv/api typecheck` passes.                                                                                                    |
| API/shared suite              | 136 tests pass across 39 files. The 12 Docker scenarios are gated in the normal run.                                                           |
| Angular suite                 | 184 tests pass across 56 files.                                                                                                                |
| API production build          | Passes. Existing optional tracing dependency and Nitro bundle warnings remain.                                                                 |
| Angular production build      | Passes. Existing 500 kB initial-bundle budget and devtools `dayjs` CommonJS warnings remain. Initial bundle is 684.53 kB.                      |
| Live Docker integration       | All 12 scenarios pass across lifecycle and nginx suites using the final API build.                                                             |
| Authenticated browser         | Login, audit search/filter/sort, redeploy publication, settings validation, live resources, stopped/restarted origins, and mobile layout pass. |

Docker checks use `SENV_DOCKER_TESTS=true` with the two integration test entry points. No tests are removed to make the suites pass. Split fixture modules register their hooks explicitly in every suite, avoiding import-order-dependent provider and cleanup failures.

The browser fixture uses its own API and frontend ports and `127.0.0.1` cookies. Existing user development servers and localhost sessions remain available. The fixture containers, network, temporary database, and copied workspace were removed. Cleanup targeted only its instance labels and exact server processes.

## Authenticated browser checks

The isolated instance publishes a healthy nginx container through the production API. The project audit table searches event details and filters a healthy event correctly. Deployment details link to the separate resource page. Its breadcrumbs lead to the deployment and project.

A fresh Docker sample reports finite CPU usage and the captured 512 MiB RAM limit. A ten-second load in the fixture's origin raises displayed CPU to 98.4%, and the sample time updates while the page is open. Stopping the deployment replaces usage with the stopped-origin explanation. Restarting restores CPU/RAM samples. The resource page fits desktop and 390-pixel mobile viewports without horizontal overflow.

The browser review found initial audit selectors displaying the internal `all` value. Their labels now use the select's display formatter; the final browser shows "All events" and "All actors". Time sorting changes row order and actor filtering returns only the selected actor's events.

Redeploy opens the publication card and prefills the immutable nginx image digest, port 80, branch, commit, and pin state. It consumes the query parameter. The settings page retains its desktop field layout and marks an invalid health path as invalid after interaction. Changing the isolated project's RAM default from 512 MiB to 768 MiB and publishing through Redeploy produces a healthy new origin whose resource page shows a 768 MiB limit. The previous publication retains its 512 MiB snapshot.

## File review and size

The baseline ledgers cover all 438 tracked files. The [backend](refactor-new-backend-files.md), [frontend](refactor-new-frontend-files.md), [publication](refactor-new-publication-files.md), and [documentation](refactor-new-document-files.md) additions ledgers cover every added module, template, fixture, test, and document. Path reconciliation covers 438 baseline paths and 224 added files, with no missing entries. The working tree contains 651 files after the superseded files are removed.

After formatting, every first-party source, template, style, test, fixture, configuration, and document is at most 200 lines. The only oversized text files are the 13,401-line pnpm lockfile, 1,750-line Drizzle snapshot, and 247-line initial migration. Their reasons are documented in [the size policy](refactor-size-exceptions.md).
