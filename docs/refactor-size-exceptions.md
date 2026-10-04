# File size policy and exceptions

First-party source, templates, tests, fixture modules, and documentation should stay at or below 200 lines. Split by responsibility before reaching that size. A split should leave state ownership, transaction boundaries, and cleanup ordering explicit. Avoid moving a whole oversized file into a helper or hiding code in compressed lines.

The following tool-owned artifacts retain their complete generated form.

| File                                         | Reason                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm-lock.yaml`                             | pnpm records one dependency graph and workspace resolution in this file. Splitting it breaks frozen-lockfile installation and package-manager tooling.                                                                                           |
| `drizzle/migrations/meta/0000_snapshot.json` | Drizzle Kit requires one schema snapshot for this migration. Splitting the snapshot breaks migration metadata and future schema comparisons.                                                                                                     |
| `drizzle/migrations/0000_init.sql`           | This checked-in initial migration is one migration unit with journal and checksum identity. Splitting an already recorded migration would change its application history. The schema refactor preserves its 18 tables and requires no migration. |

Future `drizzle/auth-schema.generated.ts` output is a review artifact. Merge required auth changes into the small schema modules; do not export the generated review file from the schema facade.

The final verification record lists source-size results after formatting and any further exception requiring a concrete explanation.
