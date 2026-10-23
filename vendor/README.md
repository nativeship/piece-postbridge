# Vendored Activepieces framework

The source of the four packages every Activepieces piece is built with,
copied unchanged from [activepieces/activepieces](https://github.com/activepieces/activepieces)
at commit `55134042a88da01be2229e06302a78c80f209ea0` (2026-10-15):

| Folder | Package | Version | Upstream path |
| --- | --- | --- | --- |
| `pieces-framework/` | `@activepieces/pieces-framework` | 0.40.0 | `packages/pieces/framework` |
| `pieces-common/` | `@activepieces/pieces-common` | 0.15.0 | `packages/pieces/common` |
| `core-utils/` | `@activepieces/core-utils` | 0.10.3 | `packages/core/utils` |
| `core-piece-types/` | `@activepieces/core-piece-types` | 0.12.3 | `packages/core/piece-types` |

Only `src/` and `package.json` are kept; tests are dropped. These paths are
outside `packages/ee`, so they are MIT licensed (`LICENSE`, Activepieces'
own, which says so).

Why vendored: since pieces became self-contained bundles, Activepieces no
longer publishes these packages to npm -- the last published framework is
0.32.0 (June 2026), which lacks `classification`, `getConnectionIdentifier`,
`advanced`, `placeholder`, `propertyGroups` and the polling helper's
republish handling that Activepieces' piece guidelines now require. Its own
CLI bundles them from this source the same way.

`../prepare.mjs` compiles them into `node_modules/@activepieces/*` after
`bun install`. To update: copy the four folders' `src/` and `package.json`
from a newer commit, update this table, run `node prepare.mjs`, and run the
Activepieces toolchain tests.
