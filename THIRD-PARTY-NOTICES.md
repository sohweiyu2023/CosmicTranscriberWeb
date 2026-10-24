# Third-party notices

The root MIT license covers Soh Wei Yu's original code and documentation only.
These components retain their own grants; this document does not relicense them.

## Runtime components

| Component | Exact version | Copyright | License text | Distribution |
| --- | --- | --- | --- | --- |
| @noble/hashes | 2.4.0 | Copyright (c) 2022 Paul Miller (https://paulmillr.com) | [MIT](licenses/noble-hashes-MIT.txt) | Browser vendor JavaScript |
| jose | 6.2.13 | Copyright (c) 2018 Filip Skokan | [MIT](licenses/jose-MIT.txt) | Worker imports, bundled by the Worker build tool |

Texts were copied verbatim from archives verified against package-lock.json SHA-512 integrity values. Build output includes both texts and this notice under `dist/public/`; source packages include the root LICENSE, this file and `licenses/`. Preserve them in redistributed Worker and browser bundles, including separately packaged bundles.

## Development and test components

The complete locked graph, including optional platform packages, is recorded in [docs/DEPENDENCY_LICENSE_INVENTORY.json](docs/DEPENDENCY_LICENSE_INVENTORY.json). That inventory records package metadata, not substitute license grants. Installed dependencies and downloaded tools retain their own license/NOTICE files.

The locked development graph includes MIT, Apache-2.0, ISC, BSD, MPL-2.0 and LGPL-3.0-or-later components, among other declared expressions. In particular, Lightning CSS uses MPL-2.0 and Sharp/libvips platform packages declare LGPL obligations. They are not covered by the root MIT grant. The source packager excludes node_modules, dist and downloaded tooling. If redistributing development tools, native libraries, browser engines or their modified sources, first review and satisfy their complete upstream notices and source/relinking obligations; this source-only inventory does not clear redistribution of those binaries.

`tests/safari/native-file-contract.mjs` cites Microsoft Playwright as evidence of Linux WebKit timestamp behavior. That small behavior observation is not a vendored Playwright source file. Playwright itself is an Apache-2.0 development dependency and retains its upstream license.

## Media and services

All binary assets and audio fixtures are outside the new MIT grant. The fixture generator documents synthetic tone generation, but the original two-speaker recording's ownership/performer consent is not established by the repository. The staging speech files derive from it; see docs/STAGING_SPEECH_ACCEPTANCE.md. Preserve existing rights; obtain the relevant rights before redistributing recordings.

OpenAI and Cloudflare services, names and trademarks are not licensed by this project. System runtimes and separately downloaded encoders, browsers and toolchains have their own terms.

### Approved synthetic single-MP3 test sample

`tests/fixtures/approved-single-mp3/staging-speech.mp3` is a separately documented
offline synthetic SAPI David Desktop/Zira Desktop sample of original neutral
test dialogue. Its exact hash and preserved source provenance are recorded in
`docs/STAGING_SPEECH_ACCEPTANCE.md`. The owner approved publishing this exact
file on 23 October 2026. It remains outside the root MIT grant over original
code/documentation; no Microsoft voice/engine assets or third-party rights are
relicensed or supplied by this publication. It is distinct from the older
two-speaker repository recording discussed above. Preserve this notice and
its provenance when carrying this test fixture into another package.

### Approved synthetic eight-format acceptance samples

The eight files in `tests/fixtures/approved-remaining-eight/` are separately preserved offline SAPI David/Zira synthetic test dialogue, explicitly approved for public publication on24October2026. See their README for original source hash and provenance. They remain outside the root MIT grant; this is not a Microsoft voice/engine or third-party media licence. No private recording was used for these separate samples. Preserve these notices.
