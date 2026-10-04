# Publication and settings file ledger

This ledger records all 58 untracked app files in the publication, deployment settings, runtime settings, and registry credential groups at review time. It is a reconciliation companion to the repository refactor plan; the pre-existing `apps/app/src/app/queries/deployment-upload.ts` source is tracked and therefore listed separately below.

## Project deployment settings

- `apps/app/src/app/pages/projects/project-deployment-settings/deployment-settings-fields.css`. Shared fieldset/legend layout; the source section keeps its original top-aligned legend while other sections retain the desktop offset. Reviewed against the split fieldset markup.
- `apps/app/src/app/pages/projects/project-deployment-settings/preview-slug-draft.ts`. Hydrates, persists, discards, and clears the preview-slug draft under a session/project-scoped key. Reviewed for storage-unavailable fallback and route slug restoration.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings-editor.spec.ts`. Covers route rewriting preview, cache matcher labels, discard behavior, and viewer read-only state. Uses explicit settings test setup.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings-form.spec.ts`. Covers deployment settings rendering, proxy validation, provider selection, and admin defaults. Uses explicit settings test setup.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings-slug.spec.ts`. Covers slug updates, navigation, read-only visibility, and slug draft discard. Uses explicit settings test setup.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings-validation.spec.ts`. Covers API-aligned field validation, duplicate route/cache rules, draft shape restoration, and malformed nested drafts. Uses explicit settings test setup.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.form.ts`. Defines the Zod settings draft shape, maps API schema errors to form paths, and validates slug input; draft restoration overlays valid partial drafts onto defaults.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.html`. Settings page shell with section navigation and child settings sections. Reviewed for section order and preserved anchor IDs.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.model.ts`. Converts between the API settings DTO and editable model, including MiB, route rewrite, and compression text representations.
- `apps/app/src/app/pages/projects/project-deployment-settings/project-deployment-settings.spec-setup.ts`. Shared settings fixtures, mocks, storage, and fixture factory; `setupSettingsTests()` explicitly registers hooks per spec file.
- `apps/app/src/app/pages/projects/project-deployment-settings/save-settings.ts`. Performs scoped settings and slug updates, invalidation, draft clearing, and error/success reporting with explicit dependencies.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/cache-fields.html`. Cache-rule and compression controls. Reviewed for existing form IDs, event bindings, and field layout.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/cache-fields.ts`. Typed signal-form inputs and cache/compression change outputs for the cache section.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/health-fields.html`. Health-check controls. Reviewed for existing field IDs and validation feedback placement.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/health-fields.ts`. Typed field-tree input for health-check fields.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/identity.html`. Project identity card shell and projected identity content. Reviewed for the existing identity anchor and section position.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/identity.ts`. Identity section wrapper with explicit settings and permission inputs plus forwarded events/content.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/limits-fields.html`. Retention and origin resource controls. Reviewed for existing control IDs and numeric validation display.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/limits-fields.ts`. Typed field-tree input for retention/resource controls.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/routes-fields.html`. Proxy route editor and route preview. Reviewed for route IDs, add/remove ordering, and preview output location.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/routes-fields.ts`. Typed field-tree input and route add/remove/preview outputs.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/source-fields.html`. Repository source and static fallback controls. Reviewed for source-field IDs and original first-section legend positioning.
- `apps/app/src/app/pages/projects/project-deployment-settings/sections/source-fields.ts`. Typed field-tree input for repository/source controls.
- `apps/app/src/app/pages/projects/project-deployment-settings/settings-draft-controller.ts`. Restores safe draft values, persists edits per session/project, and resets from server settings on discard.
- `apps/app/src/app/pages/projects/project-deployment-settings/settings-editor.ts`. Owns route/cache list edits, compression updates, and route-preview formatting outside the page coordinator.
- `apps/app/src/app/pages/projects/project-deployment-settings/settings-form-fields.ts`. Reusable Signal Forms schema functions for metadata and Zod validation of deployment defaults and preview slugs.

## Project publication

- `apps/app/src/app/pages/projects/project-deployments/project-deployment-details.spec.ts`. Covers deployment detail presentation, provider-specific source links, retention explanations, and list expiry dates. Uses explicit publication test setup for app providers.
- `apps/app/src/app/pages/projects/project-deployments/project-deployment-previews.spec.ts`. Covers preview status/recheck behavior, stopped deployment behavior, and preview copy controls. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-access.spec.ts`. Covers viewer read-only access, terminal snapshots, and removal-pending presentation. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-actions.spec.ts`. Covers session switching, tag validation, pin actions, and failed tag draft preservation. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-draft.spec.ts`. Covers valid incomplete draft restoration, legacy `reuseArtifactId` migration, and malformed draft fallback.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-list.spec.ts`. Covers directory upload and deployment/log links. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-publishing.spec.ts`. Covers ZIP publishing, retained artifact reuse, container drafts, validation-related UI, and upload failures. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-redeploy-static.spec.ts`. Covers retained static artifact redeploy prefill and publish without re-uploading. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments-redeploy.spec.ts`. Covers container redeploy prefill, digest selection, captured versus Public credential payloads, image edits, field touch feedback, and unavailable credentials/viewer access. Uses explicit publication test setup.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments.form.ts`. Defines publication form/draft types, shared Zod validation, default values, captured credential sentinel, safe restoration, and legacy reuse-key migration.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments.html`. Publication page shell and form actions. Reviewed for original control IDs and DOM order around the extracted form sections.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments.spec-data.ts`. Shared deployment, session, settings, storage, audit, and registry credential fixtures.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments.spec-mocks.ts`. Typed deployment query/mutation and upload mocks shared by the split specs.
- `apps/app/src/app/pages/projects/project-deployments/project-deployments.spec-setup.ts`. Fixture factory, test providers, and component access helper; `setupProjectDeploymentTests()` explicitly registers hooks per spec file and installs the test ResizeObserver.
- `apps/app/src/app/pages/projects/project-deployments/publication/container-source-fields.html`. Container image, registry credential, and port controls. Reviewed for field binding, touch/error feedback, and captured-credential option visibility.
- `apps/app/src/app/pages/projects/project-deployments/publication/container-source-fields.ts`. Typed inputs and image/credential selection outputs for container controls.
- `apps/app/src/app/pages/projects/project-deployments/publication/draft-controller.ts`. Coordinates publication draft state, artifact choices, captured credentials, source selection, and form reset behavior.
- `apps/app/src/app/pages/projects/project-deployments/publication/draft-storage.ts`. Persists and restores project/session-scoped publication drafts through the safe Zod-backed restore function.
- `apps/app/src/app/pages/projects/project-deployments/publication/form-fields.ts`. Configures publication field metadata, disabled state, and the shared draft schema.
- `apps/app/src/app/pages/projects/project-deployments/publication/redeploy-prefill.ts`. Resolves and consumes the redeploy query, prefills retained deployment fields, and waits for credential query resolution when required.
- `apps/app/src/app/pages/projects/project-deployments/publication/source-details-fields.html`. Source branch/commit, pin, and related details controls. Reviewed for preserved IDs and order.
- `apps/app/src/app/pages/projects/project-deployments/publication/source-details-fields.ts`. Typed source form input and settings signal for the details section.
- `apps/app/src/app/pages/projects/project-deployments/publication/source-files.ts`. Owns archive/directory selection state and selected file label calculation.
- `apps/app/src/app/pages/projects/project-deployments/publication/static-source-fields.html`. Static archive/directory source and reusable artifact selection. Reviewed for file/reuse IDs and control ordering.
- `apps/app/src/app/pages/projects/project-deployments/publication/static-source-fields.ts`. Typed inputs and outputs for static source selection.
- `apps/app/src/app/pages/projects/project-deployments/publication/submit-publication.ts`. Uploads when needed, builds the publish payload, preserves credential omission versus explicit `null`, and handles scope changes/errors/busy state.

## Runtime settings, registry credentials, and test support

- `apps/app/src/app/pages/projects/project-registry-credentials/project-registry-credentials.form.spec.ts`. Verifies shared credential normalization and field-path validation for invalid host/secret input.
- `apps/app/src/app/pages/projects/project-registry-credentials/project-registry-credentials.form.ts`. Central Signal Forms/Zod credential schema and typed input normalization helper.
- `apps/app/src/app/pages/projects/project-registry-credentials/project-registry-credentials.html`. Credential list and add form, including validation messages and hidden-secret messaging. Reviewed for form IDs and redaction copy.
- `apps/app/src/app/pages/projects/project-runtime-settings/project-runtime-settings.form.ts`. Validates environment text and secret drafts, duplicate names, and maps a valid draft into the API runtime update.
- `apps/app/src/app/pages/projects/project-runtime-settings/project-runtime-settings.html`. Runtime variable/secret editor and viewer read-only presentation. Reviewed for stable field IDs, accessible labels, and save/discard controls.
- `apps/app/src/app/pages/projects/test-resize-observer.ts`. Minimal ResizeObserver test double for Spartan components under the app test DOM.

## Tracked upload helper

`apps/app/src/app/queries/deployment-upload.ts` is an existing tracked file, not part of the untracked-file count. Its update rejects empty selections before reading a file, validates missing/empty relative paths, and checks directory roots in one pass. The focused upload test is included in the verification below.

## Review and verification

I reviewed the added files listed above for ownership boundaries, form/data flow, template bindings, and split-test coverage. All 58 focused Angular tests passed across 16 files, including the upload, publication/redeploy, deployment settings, runtime settings, and registry credential groups. Scoped lint passed with no warnings. The explicit per-spec hook registration prevents fixture providers and cleanup from being owned only by the first spec that imports a shared setup module. After the Angular formatter, every owned project-page file is at most 200 lines; there are no exceptions.
