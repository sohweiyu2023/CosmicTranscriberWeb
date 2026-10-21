# Dependency and Licensing Notices

## Current 21 October 2026 qualification

The checked-in graph was refreshed through the documented lifecycle-disabled workflow for the owner-approved exact `workerd@1.20261019.1` qualification. See [the source/native provenance review](WORKERD_QUALIFICATION_2026-10-21.md), [artifact hashes](WORKERD_QUALIFICATION_2026-10-21.json), and [complete current lock inventory](DEPENDENCY_LICENSE_INVENTORY.json). The historical proposal below is retained as dated evidence; its version table does not describe the current graph. Only the new exact workerd version was added to positive script approvals; strict policy and the fsevents denial remain unchanged.

## V1.2 dependency refresh under review

The 2026-10-11 V1.2 refresh uses the exact reviewed **Node 26.7.0 / npm 12.0.2** toolchain. The package engine ranges are compatibility bounds, not permission to substitute a different runtime during certification. Use the private toolchain; do not replace the machine's global Node/npm installation.

The following direct versions are resolved in the refresh proposal. `package.json` declares compatible ranges; `package-lock.json` records the exact transitive graph and registry integrity values that must be installed and tested. A dependency refresh changes the candidate and invalidates prior test evidence for the old graph.

| Package | Declared range | Resolved version | Purpose | License metadata |
| --- | --- | --- | --- | --- |
| `@noble/hashes` | `^2.4.0` | `2.4.0` | Streaming source/chunk fingerprints | MIT |
| `jose` | `^6.2.12` | `6.2.12` | Cloudflare Access JOSE/JWT/JWK verification | MIT |
| `@cloudflare/vitest-plugin` | `^1.4.0` | `1.4.0` | Worker-runtime test integration | MIT |
| `@playwright/test` | `^1.64.0` | `1.64.0` | Browser regression tests | Apache-2.0 |
| `msw` | `^3.0.3` | `3.0.3` | Mocked upstream HTTP in integration tests | MIT |
| `vitest` | `^5.0.3` | `5.0.3` | Worker/integration test runner | MIT |
| `wrangler` | `^4.149.0` | `4.149.0` | Local Worker harness and deployment tooling | MIT OR Apache-2.0 |

The first two packages are runtime dependencies; the rest are development/test dependencies. License identifiers above come from the resolved package metadata. Preserve shipped license/notice files and review the complete installed transitive graph before release; this table is not a completed transitive license inventory. Runtime assets are bundled locally rather than loaded from a third-party CDN.

The refresh replaces `@cloudflare/vitest-pool-workers` with `@cloudflare/vitest-plugin`. The reviewed plugin metadata accepts Vitest `^4.1.0 || ^5.0.0`; configuration and D1 test setup must use the plugin API. The Vitest 5 / MSW 3 migrations require actual Worker and integration execution, not merely successful package resolution.

Vitest 5.0.3's mocker still declares an MSW 2 peer. The exact-version npm 12 `packageExtensions` entry gives that Vitest installation its own compatible MSW 2 dependency, while application integration tests use MSW 3. This preserves the published peer constraint; it does not widen it or suppress peer errors. Clean installation and `npm ls --all` must pass. Reassess this narrowly scoped extension when upgrading Vitest.

## Audit and lifecycle-script evidence

The saved public-registry audit of the 2026-10-11 proposal reports **zero known vulnerabilities**. This is a dated audit result for that resolved graph, not a release-certification result or a guarantee about future advisories. Clean installation, native binding startup, full tests, browser/platform gates and final package verification remain independent requirements. Rerun the audit against the exact final lock.

Keep `strict-allow-scripts=true` and `strict-npmrc=true`. The install-script verifier examines the entire lock, including optional dependencies for other supported operating systems. The active lifecycle-script decisions for this proposal are:

- Allow `esbuild@0.28.2` after review of the exact registry tarball and its platform-binary installer.
- Allow `workerd@1.20261006.1` after review of the exact registry tarball and its platform-binary installer.
- Retain the existing exact `msw@2.15.0` approval for Vitest's compatible nested dependency.
- Deny the optional `fsevents` lifecycle script; the resolved version is `2.3.3`.

The reviewed esbuild/workerd tarball integrity values match the lock. Review covered the installer source; it does not replace the clean-install and executable startup checks. The current MSW 3 package has no install lifecycle hook, so its historical MSW 2 permission is not evidence for a new hook. Any additional or changed lifecycle script requires a new exact-version allow/deny decision; never weaken the verifier or enable all scripts to complete an install.

An optional native dependency can be omitted even when `npm ci` exits successfully. Verify that the resolved Rolldown, esbuild and workerd binaries actually load/start on the target platform. Manually restoring an exact-integrity package can unblock development tests, but does not itself satisfy the fresh-install release gate.

## Release policy

Release certification must bind one exact source snapshot and dependency lock to clean `npm ci`, `npm run deps:lock:verify`, the install-script policy, `npm audit`, dependency-tree/license review, full functional/static/security/mutation checks, Worker/integration tests, required Linux/macOS/Safari/Windows browser gates, and fresh-ZIP extraction/revalidation. A green audit or an earlier product's green tests cannot certify this changed graph.

V1.2 remains `releaseReady:false`. A staging-certified package remains non-final until genuine staging API/browser acceptance and every required release gate pass. Production deployment requires separate authorization.

Useful commands, run with the reviewed private runtime:

- `npm run deps:check` reports dependency drift.
- `npm run deps:update` deliberately updates compatible dependencies, reviews install policy, rebuilds, audits and runs validation.
- `npm run deps:latest` deliberately queries current direct dependencies and creates a new graph requiring fresh review and tests.
- `npm run deps:verify` checks the complete installed tree, audit, install policy, tool versions and full validation; it does not replace the separate release/platform/staging gates.
