# Candidate reproducible dependency workflow

This proposal is local and unmerged. It changes no deployment, credentials,
permissions, spending limit or live-test admission. No dependency installer was
executed while preparing it. Full platform CI and independent review remain
required before integration.

## Why the current workflow moves

The current CI runs `scripts/deps-latest.mjs` on every PR and main build. That
rewrites package metadata and the lock from the registry before validation. The
PR and its later main build can therefore certify different graphs even when
source dependencies were not edited.

The standalone `workerd@latest` tag is not evidence of the Workerd version
selected by Wrangler. Official Wrangler 4.157.0 and Miniflare
5.20261103.0-beta declare Workerd 1.20261103.1 exactly. Vitest plugin 1.5.1
declares that Wrangler and Miniflare pair. The candidate lock confirms this
supported combination without a Workerd override. Existing Undici and Zod
security overrides remain unchanged.

| Approach | Main risk | Treatment |
| --- | --- | --- |
| Refresh `@latest` inside each certification run | PR/main graphs drift; installer approvals race new releases | Replace with committed inputs |
| Force a Workerd override without its supported wrapper pair | Wrangler/Miniflare API compatibility can break | Not used |
| Commit the supported graph and keep strict audit/freshness | Later direct releases or advisories can still block a build, but cannot silently change its graph | Proposed |
| Wildcard installer approval or suppress audit/freshness | Unreviewed code executes or release failures are concealed | Not permitted |

## Proposed flow

1. Resolve dependency changes deliberately in a development candidate with
   lifecycle scripts disabled. Review the complete package/lock diff, official
   installer metadata and exact script policy. This candidate uses the existing
   approved Workerd 1.20261103.1; it does not approve standalone latest 1.20261104.1.
2. Commit `package.json`, `package-lock.json` and `DEPENDENCY_GRAPH.json` together.
   The snapshot contains exact package/lock SHA256 values, Workerd version,
   official registry and Node 26.7.0 / npm 12.0.2. It is mechanical identity data,
   not a release certificate or a substitute for review.
3. CI verifies those bytes before `npm ci --ignore-scripts`. It does not resolve
   `@latest`. The existing lock-wide install-script gate, complete-tree check,
   audit, strict direct-dependency freshness check, fixtures and validation run.
4. The existing reviewed-input artifact carries one bounded stored ZIP containing
   only the exact package/lock and the 38 explicitly tracked fixture paths.
   Its SHA256 travels through a trusted producer job output. Consumers download
   outside the checkout, then authenticate the ZIP using checkout-owned code
   before parsing or copying anything. Complete paths, CRCs, entry types, sizes,
   metadata identity and immutable fixture Git identities are checked first.
   Only fixture data is copied; package metadata, code and Git state are never
   restored from an artifact. The 14 generated fixture paths are explicitly
   declared and compared with the committed generator's output policy. A new
   output requires a reviewed policy and tracked placeholder; it cannot vanish
   silently from the handoff. The expected snapshot stays in the source checkout,
   not the artifact.
   CI uses checkout-owned verifier code, with Git reads anchored to the protected
   GITHUB_WORKSPACE checkout rather than any extracted directory. macOS passes
   its native extraction as an explicit read-only target. An archive-supplied
   no-op verifier or nested .git directory cannot authenticate its own contents.
   CI compares the snapshot to the immutable GITHUB_SHA Git blob, so replacing all three
   working files cannot bless a different artifact graph. Each platform verifies the snapshot and
   script policy before its ordinary `npm ci`, then verifies unchanged bytes
   afterward. No new artifact action, credential or runner class is introduced.
5. Certified source packaging also requires `deps:graph:verify`; npm must be
   exactly 12.0.2. Existing Windows/native/browser, audit, mutation, licensing,
   archive integrity, provenance and external live-acceptance gates stay in force.

`npm outdated --depth=0` remains a strict CI check and `deps:check` remains a
release check. A new direct registry release can still fail freshness later.
This proposal makes the installed graph reproducible; it does not weaken or
relabel that freshness rule. An explicit reviewed dependency update is then
required instead of an automatic graph mutation. Security advisories can also
change and correctly cause the unchanged strict audit to fail.

## Editing the snapshot

After a deliberate reviewed package/lock update, compute their SHA256 hashes
using the fixed toolchain and update only the corresponding snapshot values.
Keep the exact required Workerd and toolchain versions under review. Do not
regenerate the snapshot during CI, source packaging, deployment or extraction:
doing so would bless changed bytes instead of detecting drift. Snapshot updates
do not grant installer approval; the independent lock-wide `allowScripts` gate
still rejects every unknown lifecycle script, including optional OS packages.

The test suite proves rejection of byte changes, nested mismatched Workerd,
unreviewed scripts, wildcard policy, credential-bearing/non-public registry URLs,
missing integrity, altered package identity and unexpected toolchains. CLI errors
are finite categories and never echo arbitrary malformed file contents.

## Scope and release qualifications

The candidate currently resolves direct versions: @noble/hashes 2.4.0, jose
6.2.15, @cloudflare/vitest-plugin 1.5.1, @playwright/test 1.64.1, msw 3.0.3,
vitest 5.1.0 and wrangler 4.157.0. These runtime/tooling changes require fresh
platform certification and a new source artifact. Earlier live acceptance does
not automatically certify the new graph. No old package may be presented as this
candidate. Native Safari remains FAIL/WAIVED under the separately documented
exception; this proposal cannot turn it into PASS.

If integration fails, retain the current main/release and its evidence. Repair
or revert the source candidate through normal review. Never work around a failure
with `--force`, legacy peer resolution, a Workerd override, audit suppression,
automatic approval of future installers, manually edited release flags, a paid
replay or an authentication/security change.
