# Licensing audit — 21 October 2026

## Identity and scope

Reviewed public repository: https://github.com/sohweiyu2023/CosmicTranscriberWeb, main at `45c1ef4b1579d3870a3dbdd97b1701156d2b1e92`, web edition 1.2.0. This is distinct from the Windows desktop download linked by the Cosmic Transcriber blog post. This change does not license or replace that download.

Soh Wei Yu authorized MIT for his original work and the copyright line `Copyright (c) 2026 Soh Wei Yu`, after accepting commercial/modified/closed-source reuse. Recent reviewed Git commits are attributed to the owner's account. Owner confirmation and AI-assisted authorship do not establish rights in every possible incorporated snippet. This audit searched tracked source for copyright, license, adaptation and upstream provenance clues and reviewed runtime imports, the lock graph, fixture-generation documentation and packaging paths. It is a bounded repository audit, not a guarantee of undiscoverable provenance.

## Concrete findings

- No root project license was present at the reviewed main commit. MIT is now scoped to the owner's original code and documentation, excluding third-party components and binary/audio assets.
- Runtime imports use @noble/hashes 2.4.0 and jose 6.2.12. Their exact registry archives were SHA-512 verified against the lock. Both contain MIT grants, copied verbatim to `licenses/`. The browser build previously copied only JavaScript/JSON from Noble and omitted its LICENSE; build/package checks now require notices.
- The full lock graph has non-MIT development/optional packages, including Lightning CSS (MPL-2.0), libvips (LGPL-3.0-or-later) and Sharp platform packages with combined Apache/LGPL expressions. These are compatible with keeping the owner's original source MIT, but cannot be described as MIT or redistributed without their own conditions. No development/native binaries are added by this change. The inventory covers every lock entry with its version, declared license, registry integrity and development/optional flags. It is metadata evidence; full license texts and embedded native component obligations must be examined if those binaries are later shipped.
- The existing DEPENDENCIES_LICENSES.md describes an older refresh proposal; current lock metadata supersedes that historical version table for this audit. It remains historical release evidence, not a certification of this change.
- The Playwright reference in the Safari timestamp test documents behavior rather than an identified copied implementation. No other explicit third-party source header was found in application source. Absence of a header is not proof of originality.
- Synthetic tones have generation recipes. The repository identifies the source of the staging speech derivatives but does not establish rights in the original two-speaker recording. All binary fixtures/assets are excluded from the new grant. This is a specific unresolved media provenance limit, not a claim that an infringement exists.

## Distribution and verification

Source packaging excludes node_modules/dist/tooling and now checks required legal files in the resulting ZIP. Browser output includes the owner's LICENSE and both runtime grants; keep these alongside any separately distributed Worker bundle. An independent licensing CI job validates the exact checked-in graph without refreshing dependencies or deploying.

The existing release workflow intentionally refreshes dependencies and includes conditional deployment/paid staging jobs. It is separate from this focused licensing check. No release certification, staging acceptance, deployment, binary upload, installation or pricing change is authorized by this licensing PR. Existing release exceptions remain unchanged.
