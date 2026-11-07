# Reproducible dependency workflow

PR44 integrated the committed-input workflow into main. The separately reviewed
2026-11-07 dependency refresh is a candidate until its own final certification
passes. No deployment, credentials, permissions, spending limit or live-test
admission changes are made by this workflow.

## Why dependency resolution is deliberate

Earlier CI refreshed registry latest releases during certification and could
validate different graphs for a PR and its main build. Current CI verifies the
committed package metadata, lock and snapshot; it never silently refreshes them.
An upstream direct release can still fail the strict freshness gate and requires
a new reviewed candidate, as happened on 2026-11-07.

The standalone `workerd@latest` tag is not evidence of the Workerd version
selected by Wrangler. Official Wrangler 4.158.0 and Miniflare
5.20261104.0-beta declare Workerd 1.20261104.1 exactly. Vitest plugin 1.6.0
declares that Wrangler and Miniflare pair. The candidate lock confirms this
supported combination without a Workerd override. Existing Undici and Zod
security overrides remain unchanged.

| Approach | Main risk | Treatment |
| --- | --- | --- |
| Refresh `@latest` inside each certification run | PR/main graphs drift; installer approvals race new releases | Replace with committed inputs |
| Force a Workerd override without its supported wrapper pair | Wrangler/Miniflare API compatibility can break | Not used |
| Commit the supported graph and keep strict audit/freshness | Later direct releases or advisories can still block a build, but cannot silently change its graph | Implemented |
| Wildcard installer approval or suppress audit/freshness | Unreviewed code executes or release failures are concealed | Not permitted |

## Verification flow

1. Resolve dependency changes deliberately in a development candidate with
   lifecycle scripts disabled. Review the complete package/lock diff, official
   installer metadata and exact script policy. This candidate selects Workerd
   1.20261104.1 through the supported wrapper pair. Its official tarball integrity
   and installer source require review before an exact-version policy addition;
   snapshot regeneration alone never approves execution. The exact-version
   policy was added after official SHA-512 tarball verification and independent
   installer-source comparison: only date/version strings changed from the prior
   reviewed installer, without new commands or destinations. Native platform binaries
   are not independently audited by an installer-source comparison.
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
This workflow makes the installed graph reproducible; it does not weaken or
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
6.2.15, @cloudflare/vitest-plugin 1.6.0, @playwright/test 1.65.0, msw 3.0.4,
vitest 5.1.0 and wrangler 4.158.0. These runtime/tooling changes require fresh
platform certification and a new source artifact. Earlier live acceptance does
not automatically certify the new graph. No old package may be presented as this
candidate. Native Safari remains FAIL/WAIVED under the separately documented
exception; this workflow cannot turn it into PASS.

If integration fails, retain the current main/release and its evidence. Repair
or revert the source candidate through normal review. Never work around a failure
with `--force`, legacy peer resolution, a Workerd override, audit suppression,
automatic approval of future installers, manually edited release flags, a paid
replay or an authentication/security change.
