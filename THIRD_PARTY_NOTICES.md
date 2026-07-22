# Third-Party Notices

This file summarizes direct dependencies for convenience. It is not a
substitute for the license shipped with each exact package version. Transitive
dependencies may add further notices.

## Node.js development dependencies

| Package | Declared license in `package-lock.json` |
| --- | --- |
| `@cloudflare/workers-types` | MIT OR Apache-2.0 |
| `@types/node` | MIT |
| `typescript` | Apache-2.0 |
| `vitest` | MIT |
| `wrangler` | MIT OR Apache-2.0 |

These packages are development and deployment dependencies; their code is not
relicensed under this project's MIT License.

## Python core dependencies

| Package | License family |
| --- | --- |
| NumPy | BSD-3-Clause and bundled permissive component licenses |
| pandas | BSD-3-Clause and bundled component licenses |
| SciPy | BSD-3-Clause and bundled component licenses |

Consult the license files installed with each distribution before
redistributing binaries.

## Optional vectorbt adapter

The `portfolio` extra installs vectorbt 1.x. The `vectorbt 1.0.0` distribution
resolved by the current lockfile identifies its license as **Apache 2.0 with
Commons Clause**. The Commons Clause restricts selling the software, or a
product or service whose value derives entirely or substantially from its
functionality.

This restriction means vectorbt 1.x should be treated as source-available, not
as an ordinary OSI-approved permissive dependency. It is not part of the
default installation, and it is not covered by this repository's MIT License.

Before enabling the optional adapter:

1. inspect `vectorbt-*.dist-info/licenses/LICENSE.md` in the installed package;
2. review the [vectorbt package page](https://pypi.org/project/vectorbt/); and
3. obtain legal advice before commercializing a product or service that relies
   substantially on vectorbt.

The canonical event-study tables do not require vectorbt. The adapter remains
optional because its shared-position portfolio semantics can also ignore
overlapping signals.
