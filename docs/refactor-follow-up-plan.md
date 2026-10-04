# Refactor follow-up chunks

This continues [the original plan](refactor-plan.md). The user added a general 200-line file limit and a live CPU/RAM page for origin containers. Existing styling, features, stored-data compatibility, and the Docker/proxy setup remain fixed. GPT-6 Luna at high reasoning effort implements each chunk; the primary agent reviews the results.

## R2. Finish publication reuse and validation

Complete R1, R1a, R1b, Z1 and F7 before splitting their affected components. Resolve the source deployment using authorized project data. Prefill source, retained content, immutable image, HTTP port, credential choice, and pin state. Open the publication card on arrival. Changing the image changes the publication input. An omitted credential preserves captured authentication; an explicit public choice sends null. Saved drafts retain the legacy reuseArtifactId alias during loading and contain no secrets.

Keep schema validation shared through Zod and Angular Signal Forms. Test nested errors, malformed drafts, reuse after cleanup, viewer restrictions, and edited prefill fields. Validate directory paths before dereferencing entries, including empty selection and missing relative paths.

Owner: publication_forms. Status: implemented and reviewed. The focused 58-test run and full 184-test Angular suite pass; authenticated browser redeploy and settings checks pass.

## M1. Read live origin-container resources

Add a read-only deployments.resources procedure scoped by projectId/deploymentId. Apply the same project access and deployment existence checks as logs, and verify Docker ownership labels before reading stats. Read only the origin container; never report proxy usage as origin usage. Do not add a background collector or change container/network configuration.

Return available/unavailable state, sample timestamp, CPU percentage, memory usage in bytes, and memory limit in bytes. Calculate CPU from Docker CPU/system deltas and online CPUs, allowing usage above 100% on multiple cores. Subtract inactive file cache from Linux memory usage consistently with Docker's working-set convention. Missing counters produce unavailable values rather than fabricated zero measurements. Handle stopped, removed, missing, or restarting origins explicitly. Keep Docker failure handling distinguishable from a valid zero-usage sample.

Test CPU delta edge cases, memory counters, unavailable containers, ownership checks, project isolation, and read permissions. Include a real Docker resource-read check in final integration verification.

Owner: backend_resources. Status: implemented and reviewed. Permission, ownership, unavailable-state, and calculation tests pass. A live nginx origin reports finite CPU and its captured RAM limit. All 12 final Docker integration scenarios pass.

## M2. Show live CPU and RAM on a separate page

Add a resources route beside deployment logs, using the same project/deployment breadcrumbs. Link it from deployment details. Use existing spartan components and the current theme. Show CPU percentage and RAM used/limit with units and the last sample time. Explain CPU percentages above 100% in concise UI copy. Include loading, API-error, and origin-unavailable states.

Use a session/project/deployment-scoped TanStack query with cancellation and a short browser-only refresh interval. Stop refreshing when the page unmounts; avoid background polling while hidden. An unavailable measurement must not look like zero. Verify navigation, permissions inherited from project routing, query isolation, refreshing, and all display states.

Owner: frontend_resources. Status: implemented and reviewed. Authenticated browser navigation shows project/deployment breadcrumbs and refreshing samples. A brief load produces 98.4% CPU; stopping the origin replaces the values with the stopped-container explanation. The full Angular suite and production build pass.

## S1. Split backend runtime and domain modules

Review every backend source file exceeding 200 lines. Separate responsibilities such as schema families, publication preparation, routing transactions, artifact archive validation, container setup, runtime health checks, and removal. Preserve the existing exported facades where callers depend on them. Keep locks, transactions, rollback behavior, and cleanup ordering visible at their owning operation; avoid generic wrappers that hide these rules.

Split oversized backend tests by domain with small shared fixture modules. Preserve every original test and assertion unless a stale assertion is documented. Separate Docker integration scenarios while retaining isolated cleanup and gating. Run API typecheck and all API tests, followed by live Docker suites.

Owner: backend_resources. Status: implemented and reviewed. Full API suite and typecheck pass. All 12 live Docker scenarios pass after the runtime and ordered test-suite splits.

## S2. Split publication and settings components

Separate form model conversion, schema validation, draft persistence, publication payload construction, and content upload where these have independent responsibilities. Break settings/publication templates into focused sections using explicit inputs and existing Signal Forms. Preserve control IDs, text, accessibility, permissions, drafts, and submission behavior.

Split oversized tests into focused suites with shared fixture factories. Keep each file below 200 lines unless splitting would obscure one indivisible operation; document such exceptions individually. Verify the original scenarios and added redeploy/validation regressions.

Owner: publication_forms. Status: implemented and reviewed. The focused 58-test run and full 184-test Angular suite pass; authenticated browser redeploy and settings checks pass.

## S3. Split remaining frontend components and suites

Extract long templates and separate domain-specific query modules, auth conversion helpers, transport request/response handling, and admin table actions where needed. Preserve HTTP interceptors, SSR cookies, cancellation, TanStack cache identity, sorting/filtering, and existing spartan APIs.

Compose the deployment query and mutation collaborators through the existing injectable facade. Do not introduce a query-to-mutation inheritance chain just to meet the file limit. Keep auth subscription cleanup as explicit calls and use typed property access where practical.

Split project, routing, audit, admin, and transport test suites by behavior. Preserve fixtures and all prior test coverage. Keep the copied spartan components unchanged unless a concrete readability change is warranted; record a precise exception for any large upstream-derived file. Run the full Angular suite and production build after integration.

Owner: frontend_resources. Status: implemented and reviewed. All 184 Angular tests and the production build pass. Explicit fixture hook registration preserves isolation across split suites.

## S4. Reconcile coverage and exceptions

Check all tracked and newly created files against the audit ledgers. Extend coverage for every new module and test file. Record every file above 200 lines, its responsibility, and why a split is inappropriate. Generated lockfiles, Drizzle metadata, and generated schema files may retain their tool-owned structure. Documentation ledgers should be split by subject if they exceed the limit.

Run formatting/lint, API typecheck, full API/Angular tests, production builds, and Docker integration suites. Review diffs against behavior constraints and check the resource page in the collaborative browser.

Owner: primary agent. Status: implemented and reviewed. The ledgers cover all baseline and added files. Final formatting, lint, suites, builds, Docker checks, browser checks, and the three generated-artifact exceptions are recorded in the verification document.
