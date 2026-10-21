# Exact workerd qualification — 21 October 2026

The owner authorized review and execution of `workerd@1.20261019.1` after qualification. This adds only `allowScripts["workerd@1.20261019.1"] = true`; no package-wide/future-version approval or other policy relaxation is introduced. `strict-allow-scripts=true`, `strict-npmrc=true`, fsevents denial and the unchanged release/platform gates remain enforced. No deployment is authorized.

## Source and native artifact review

The registry archive for workerd has SHA-512 integrity `UUYRUq/7DmeCl11YriNbcVbjUZVLtt8uuCXFu+nz77hGFf8d4DEVXoCYtnA+MlBatE4+wxoj47DVqzK3xGBAiw==`. The complete installer source was inspected. Compared with approved 1.20261012.1, its changes are limited to expected version/date literals. It selects the OS/CPU package, uses the installed optional dependency when available, can fall back to npm/HTTPS acquisition of the same exact version, and validates the binary with `--version`. Its upstream version validator can log some execution failures without a nonzero exit; therefore a separate explicit native version/startup assertion is required after rebuild.

The npm registry signature was cryptographically verified for workerd and all five native packages. Each native tarball matched its registry SHA-512 integrity. Each official GitHub release gzip matched the digest reported by the release API; its decompressed executable matched the npm executable byte-for-byte. All native package metadata has the same source commit `781048bc05cb205c92e503c1062ef3266ab959b5`, which is also the upstream `v1.20261019.1` tag. These checks establish origin/integrity, not a proof that compiled software has no defects. Exact archive, release and binary hashes are in [the evidence inventory](WORKERD_QUALIFICATION_2026-10-21.json).

Full `npm audit signatures` passed for the refreshed Windows installation: 123 packages have verified registry signatures and 64 have verified provenance attestations. These counts cover the installed platform graph; the five-platform workerd checks above additionally cover optional packages for other supported hosts. The package and native distributions declare Apache-2.0 and retain upstream grants. No native executables are added to the source repository.

## Documented dependency resolution

Used private, checksum/integrity-verified Node 26.7.0 and npm 12.0.2. Ran the existing `scripts/deps-latest.mjs` with lifecycle scripts disabled, as required by the release workflow. Direct changes: jose 6.2.12 to 6.2.13, @cloudflare/vitest-plugin 1.4.4 to 1.4.6, wrangler 4.151.1 to 4.151.3. Other direct versions remain unchanged. The only newly selected lifecycle version requiring approval is workerd 1.20261019.1; esbuild 0.28.2 remains approved, fsevents 2.3.3 remains denied.

The jose 6.2.13 full MIT grant is byte-identical to the preserved 6.2.12 text. Updated its exact version in notices and the license verifier, and regenerated the complete lock license inventory. No runtime dependency has been relicensed. The source manifest binds the new lock hash while retaining `releaseReady:false` and `present-unverified`; platform certification and live acceptance are separate gates.

The exact installer is eligible to run only after the integrity/provenance checks above and the unchanged lock-wide policy verifier pass. Runtime execution and full CI results are reported in the PR; source qualification alone is not a release PASS. PR branch runs cannot invoke the workflow's push-only staging deployment job.
