# Deployment implementation tickets

Source: [deployment feature](deployment-feature.md), [domain language](../CONTEXT.md), and accepted [architecture decisions](adr/).

Review baseline: `46f861cff2eac5511e3549f828e791d02cc4466a`.

All implementation tickets are assigned to GPT-6 Luna with high reasoning effort. Implement in the existing Drizzle, Nitro, tRPC, Angular signal forms, TanStack Query, and spartan/ui patterns. Keep stateful services, builds, CI credentials, remote Docker hosts, and command overrides outside this work.

## DEP-001: Deployment model and management API

Status: complete

Implement schema and migrations for separate readable project slugs, project deployment defaults, instance allowances, fixed artifacts and deployment snapshots, runtime secrets, registry credentials, lifecycle history, branch aliases, and manual tags. Preserve immutable project and Better Auth organization identities.

Implement authenticated management operations with the documented viewer/developer/admin permissions. Capture configuration at publication; allow artifact reuse with independent retention; support stop, restart, delete, admin history removal, bounded logs, healthy-only selections, submission-order branch promotion, fresh retention clocks when final protection is lost, and recalculation after retention changes. Hide saved secret values in responses and erase runtime secrets on deletion. Validate slugs, generated hostnames, proxy/cache rules, and settings before persistence.

Acceptance: migration and API tests cover role boundaries, snapshot immutability, branch ordering, tag protection, retention, history, artifact references, and secret redaction. Publish precise API/type contracts to DEP-002 and DEP-003 early.

## DEP-002: Local Docker execution, artifacts, and preview routing

Status: complete

Implement local Docker orchestration with one owned origin and one Nginx proxy per deployment behind Traefik. Resolve image references to digests, use image startup commands, apply captured resource and log limits, and support WebSockets and streaming. Add ZIP and directory ingestion with root index validation, uploaded/extracted limits, safe extraction, interrupted-upload cleanup, and reusable fixed storage.

Generate validated proxy configuration with route/path/file-type precedence, rewrites, timeouts, compression, safe optional caching, and deployment cache isolation. Probe owned origin and proxy without cache/external-route false positives; implement startup deadlines, consecutive failures, recovery, explicit stopped intent, API/Docker restart reconciliation, timed cleanup, and visible failures. Restore/publish routing atomically for deployment, branch, tag, and project slug changes. Integrate Docker socket, persistent artifacts, Traefik, and operator configuration in production Compose and development documentation.

Acceptance: meaningful artifact, proxy, Docker adapter, and lifecycle tests plus available live Docker smoke verification. Coordinate runtime contracts with DEP-001. Do not operate unrelated host containers or reset user data.

## DEP-003: Deployment and settings UI

Status: complete

Replace the deployment empty state with real publication and management UI. Support ZIP/directory static uploads, container images and registry credentials, artifact reuse, pinning, source metadata, port and project runtime settings, SPA behavior, progress/failure states, status/configuration/history/log inspection, preview links, tags, stop/restart/delete, and admin history removal.

Expose project repository, name and preview slug in one bottom identity card, separate retention and resources, project runtime settings, registry credentials, health settings, proxy routes/rewrites/timeouts, cache rules, and compression as validated forms. Add instance-admin upload/proxy/log defaults on a dedicated sidebar page. Suggest editable unique DNS-safe slugs at project creation. Respect viewer/developer/admin access, preserve drafts on refresh, keep secrets hidden after entry, and follow existing session-scoped query invalidation, accessible spartan composition, and Angular 22 signal-form patterns.

Acceptance: Angular build and meaningful UI tests cover permission distinctions, publication and upload flows, settings validation, status/errors, and secret handling. Coordinate contracts with DEP-001 and DEP-002.

## Review loop

After integration, review the complete diff separately for repository standards and specification coverage. Record findings below, return concrete corrections to the implementing agents, and repeat review and required checks until acceptance criteria pass. Update ticket status with actual verification evidence; do not mark blocked checks as passed.

### Baseline verification

- `vp test run`: 65 API/database tests passed.
- `vp run @senv/app#test`: 86 Angular tests passed.
- `vp run @senv/api#typecheck`: passed.
- `vp run build`: passed. Existing warnings include Angular bundle size, the devtools CommonJS dependency, and an optional Better Auth OpenTelemetry import.
- Docker Desktop started for live runtime verification. No existing deployment containers were present.

### Implementation review, first pass

- DEP-002: frame artifact hash inputs with lengths and entry types so different binary trees cannot share a digest input. Fix static file permissions for the Nginx worker and attach Docker response listeners before streaming uploads. Corrected and covered by artifact, Docker adapter, and live static-origin checks.
- DEP-001/002: content-addressed bytes can be shared by different projects. Keep artifact ownership project-scoped and check global storage references before deleting shared bytes.
- DEP-001: expose captured health/proxy/resource settings in non-secret configuration summaries. Validate positive CPU limits, environment names, proxy syntax, and complete DNS names before persistence.
- DEP-001: preserve assigned branch labels across resource deletion and retain the optional single project repository in source metadata snapshots.
- DEP-002: correct default compression, extension matching, prefix rewrites, and cache buffering. Verify actual Nginx responses instead of relying on configuration string assertions.
- DEP-001: allocate branch labels before readiness without selecting queued targets. Clear retention when tags protect a target; changing retention must only recalculate existing clocks.
- DEP-001/002: await serialized atomic route updates before reporting successful slug/tag/stop/delete operations.
- DEP-001: permanently forgetting retained history must remove its deployment summary as well as lifecycle events; retained summaries keep secret names without secret values.

### Standards review and corrections

- Cross-reviewed the API, runtime, and UI work against existing Drizzle migrations, Nitro plugins, tRPC authorization, session-scoped TanStack queries, Angular signal forms, and spartan components. Reviewed the integrated diff from the recorded baseline.
- Kept Docker execution behind the API boundary. Extracted lightweight storage helpers so frontend type checking does not traverse Node-only runtime implementations; retained strict TypeScript and Angular compiler settings.
- Replaced unsafe broad transaction types with the repository's typed Drizzle handles, formatted the implementation, and generated the native-select component through the existing spartan layout.
- Corrected project-creation signal updates that could repeatedly write unchanged slug suggestions. Added regression coverage for editable suggestions, reserved slugs, and routing after creation.
- Changed log inspection to readable content with cursor pagination. Kept secret values and browser file selections out of persisted drafts and public configuration summaries.

### Specification review and corrections

- Checked permission boundaries, instance-admin authority without project membership, cross-project artifact and credential ownership, immutable publication snapshots, digest reuse, and registry credentials surviving deployment removal.
- Corrected branch alias normalization/collision handling, submission-order promotion, and watermarks surviving selected deployment deletion. Losing the final tag or branch protection starts a fresh retention clock; retention changes use recorded starts.
- Serialized route mutations and added rollback after routing failures. Slug changes, stop, tag changes, and deletion wait for Traefik acknowledgement. Live testing found that explicit empty router/service maps leave stale Traefik routes; the final snapshot now omits those maps and retains an unused middleware so old URLs return 404.
- Verified actual Nginx caching, upstream cache-control and Set-Cookie handling, authenticated request bypass, rewrite precedence, gzip allowlists, streaming, and WebSockets. Fixed configuration errors exposed by these checks.
- Corrected readiness probes to require the owned origin's direct successful response and a valid running proxy. Added startup deadlines, restart reconciliation, explicit stop preservation, and guards against late readiness/log callbacks during removal.
- Fixed content permissions and production read-only artifact mounting. Shared bytes remain until their final deployment reference disappears; upload and cleanup share a storage lock.
- Persisted delete/cleanup intent and action before removing resources. Startup completes interrupted removals; one failed retry preserves its data without preventing later pending removals from completing. Pending removal is visible in the UI and disables unavailable actions and links.
- Removed premature log line-count truncation, bounded Docker stream batches, and trimmed captured quotas on UTF-8 boundaries. Deletion removes raw logs and runtime secrets while retaining non-secret history; admin history removal erases the retained summary too.
- Corrected artifact reuse to permit a retained container with no newly entered image. Removed duplicate branch URL prefixes and terminal-row lifecycle actions. Real browser checks exercised directory publication and project creation with a custom preview slug.

All recorded findings were returned to the assigned implementing agents and reviewed again after correction.

### Final integrated validation

Validated on 2026-10-03 against the integrated worktree:

- `vp test run`: 99 tests passed across 12 files. The 10 opt-in Docker cases are skipped by this default command and were run separately below.
- `vp run @senv/app#test`: 104 tests passed across 21 files, including pending removal, publication/reuse, permissions, settings, drafts, secret handling, and project creation/routing.
- `vp run @senv/api#typecheck`: passed.
- `vp run check`: formatting and lint passed without warnings; Angular formatting check passed.
- `vp run build`: API and production Angular builds passed. Existing warnings remain for the Angular initial bundle budget, the devtools CommonJS dependency, and Better Auth's optional OpenTelemetry import.
- `SENV_DOCKER_TESTS=true vp test run apps/api/server/deployment-lifecycle.integration.test.ts apps/api/server/utils/deployment-runtime/nginx.integration.test.ts`: all 10 live cases passed. These use the built API, a migrated temporary SQLite database, real Docker origins/proxies, and Traefik. They verify static directory upload, captured limits and secret redaction, immutable image digests, independent content reuse, immediate slug/tag/stop/delete URL retirement, restart recovery, explicit stopped intent, production read-only volume mounts, interrupted deletion recovery, final artifact/log/secret cleanup, admin history removal, proxy precedence, cache safety, compression, streaming, and WebSockets.
- T3 browser acceptance: created a project with an editable custom preview slug and published a built directory through the actual upload form; the resulting deployment became healthy.
- Production Compose configuration and `git diff --check`: passed. Temporary API/dev processes, databases, and Docker containers/networks/volumes created for acceptance checks were removed; unrelated host resources were preserved.
