# Added documentation ledger

The original audit covers 438 baseline files at `a09c951`. The new backend, frontend, and publication ledgers cover added application files. This ledger covers the added documentation, including the ledgers themselves. These records describe reviewed changes and preserved behavior, with final evidence in the verification record.

| File                                     | Purpose and review result                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/deployment-operations.md`          | Deployment operations extracted from the feature guide. Preserves cleanup, resource limits, storage, logs, and proxy instructions.                  |
| `docs/origin-resources.md`               | Describes the separate CPU/RAM page, calculation semantics, polling, permissions, and unavailable states. Checked against the resource API and UI.  |
| `docs/projects-and-invitations.md`       | Project and invitation guide extracted from README. Preserves roles, invitation workflow, and project routes.                                       |
| `docs/refactor-backend-audit.md`         | File-by-file baseline backend/schema review and original findings. Implementation decisions resolve through the plans and backend additions ledger. |
| `docs/refactor-frontend-audit.md`        | Baseline Angular flow review, including auth, publication, settings, and query ownership. Links the frontend file inventory.                        |
| `docs/refactor-frontend-files.md`        | Exact baseline frontend file inventory and review decisions. Scope reconciled with the baseline Git tree.                                           |
| `docs/refactor-ui-tooling-audit.md`      | Baseline spartan and build/deployment/tooling review. Keeps the existing deployment topology and UI APIs.                                           |
| `docs/refactor-ui-files.md`              | Exact baseline copied UI file inventory. The long class utility now has focused modules and a transition-cleanup regression test.                   |
| `docs/refactor-tooling-files.md`         | Exact baseline root/config/assets/documentation inventory, including generated artifact decisions.                                                  |
| `docs/refactor-plan.md`                  | Original detailed implementation chunks, constraints, and review results. Updated to reflect completed feature integration.                         |
| `docs/refactor-follow-up-plan.md`        | Detailed resource-page and 200-line-limit chunks. Records ownership and final validation.                                                           |
| `docs/refactor-size-exceptions.md`       | Three tool-owned exceptions and why splitting each would break its owning tool or migration identity.                                               |
| `docs/refactor-verification.md`          | Records preserved test scenarios, schema compatibility, final checks, and isolated browser evidence.                                                |
| `docs/refactor-new-backend-files.md`     | Exact new backend/schema file inventory with review results and test coverage.                                                                      |
| `docs/refactor-new-frontend-files.md`    | Exact new frontend/UI file inventory with review results and test fixture registration.                                                             |
| `docs/refactor-new-publication-files.md` | Exact new publication/settings/runtime/credential file inventory with form and draft review results.                                                |
| `docs/refactor-new-document-files.md`    | This added-document inventory, included in the final coverage reconciliation.                                                                       |

Existing documentation links were checked after extraction. Source-size checks include every new ledger. Configuration and lockfile edits remain covered by the baseline tooling ledger and the implementation plans.
