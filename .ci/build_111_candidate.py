from __future__ import annotations

import base64
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
EXPECTED_DELTA_SHA256 = "4138795bba6384709fb6f75d75ebd8cf6a7dcdfc44ba342f70cc217c013ed2bd"
EXPECTED_PARTS = {
    "upgrade_111_delta.b64.00": (8000, "91209135e5b00fe6baa427a7d2c6413c4167def72aca14a4f19da328a88f9249"),
    "upgrade_111_delta.b64.01": (8000, "fb48530a47360fc7367e7cd4a8f57e251ad57c2cb767e49e14820820dc0afcaf"),
    "upgrade_111_delta.b64.02": (8000, "e48ccf8f842a2d3b260a26b2d26b25032d48083b097052c20f1277aa9ade71bb"),
    "upgrade_111_delta.b64.03": (8000, "0238e309e3fcdfcbb7b48c2a28aa49c5a86e5d252fbdf842313ecda61dbbd4d0"),
    "upgrade_111_delta.b64.04": (8000, "8689e0debc285cef798a0ef372fe5f7855074df6a1ef8411dd791c985cc97c24"),
    "upgrade_111_delta.b64.05": (8000, "c7352ce1e014aef8a070e68934b69f7da894ea860c48822c2c48e3cb602f28bd"),
    "upgrade_111_delta.b64.06": (8000, "bbb7423d9a9f6c3067f8dc8fe03ba82a862c8b33b686e02bd11aae57352b1a99"),
    "upgrade_111_delta.b64.07": (8000, "7aeccd1fab266030efc7270fb35f6c44bb65dac2e6f4ca168867ffc330eeae7f"),
    "upgrade_111_delta.b64.08": (8000, "7c9a4ea4b999830107ce91c0b842d7cf12099e9444cdb7a39da721c4858adc3b"),
    "upgrade_111_delta.b64.09": (8000, "db2ecd98df65d7d8b256623c5cf5433893264544389c8805b1b57c1b85aae609"),
    "upgrade_111_delta.b64.10": (8000, "a9e0664a7403072ed0aa5e47fde6293567bcfadb2b34f98a71c6e5b9c567350e"),
    "upgrade_111_delta.b64.11": (8000, "7709bf59c497cfc6c174e1b02ae0e908e80e77c5b843aae2fa6bafb8299c4b94"),
    "upgrade_111_delta.b64.12": (8000, "64fad55d46ca50e94228d849c9bb2f899404b1f76a61817460b70d4ec16b182d"),
    "upgrade_111_delta.b64.13": (4000, "1bf15d32a89160e1ca9e231da6685deac37508878b752d767f3973d33e6d9d03"),
    "upgrade_111_delta.b64.14": (4000, "fa5074ba8f04261fbccffc6af2688fe0e1e6a4499083fa69a86ae183da93bbc5"),
    "upgrade_111_delta.b64.15": (4000, "3dbdc0a00261d628d11f00bedf5990528ae62a3d9ef504391426a349768d23f0"),
    "upgrade_111_delta.b64.16": (4000, "9cf714ed2df8475ec36b73d1a36b79ace19dc872404d553e6e5fa83e63be8c58"),
    "upgrade_111_delta.b64.17": (4000, "695321c112f051c302db7a3f58600e91946fba6b5336d190fb82c4b05d40577d"),
    "upgrade_111_delta.b64.18": (4000, "c81dd537a55e8d5510a5d8ca3835db0fdc182def5a58a3ea515876de5aa2cc22"),
    "upgrade_111_delta.b64.19": (1496, "612f8726f9ae38d104ce086e1fec4293b9667da226b666443daafb3f7c114de2"),
}


def replace_once(relative: str, old: str, new: str) -> None:
    path = WORK / relative
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"1.1.1 hardening transform expected one match in {relative}, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def insert_before_once(relative: str, marker: str, addition: str) -> None:
    path = WORK / relative
    text = path.read_text(encoding="utf-8")
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"1.1.1 hardening transform expected one marker in {relative}, found {count}: {marker[:100]!r}")
    path.write_text(text.replace(marker, addition + marker, 1), encoding="utf-8")


def append_once(relative: str, sentinel: str, addition: str) -> None:
    path = WORK / relative
    text = path.read_text(encoding="utf-8")
    if sentinel in text:
        raise SystemExit(f"1.1.1 hardening transform would duplicate {sentinel!r} in {relative}")
    path.write_text(text.rstrip() + "\n\n" + addition.rstrip() + "\n", encoding="utf-8")


# Start from the exact reviewed/certified 1.1.0 lineage. The existing
# materializer is itself part of that certified commit.
subprocess.run(
    [sys.executable, str(ROOT / ".ci" / "build_110_candidate.py")],
    cwd=ROOT,
    check=True,
)

parts = sorted((ROOT / ".ci").glob("upgrade_111_delta.b64.*"))
actual_names = [part.name for part in parts]
if actual_names != list(EXPECTED_PARTS):
    raise SystemExit(
        "1.1.1 delta part set incomplete or unexpected: "
        f"expected {list(EXPECTED_PARTS)!r}, got {actual_names!r}"
    )

encoded_parts = []
for part in parts:
    text = part.read_text(encoding="ascii").strip()
    expected_len, expected_sha256 = EXPECTED_PARTS[part.name]
    got_sha256 = hashlib.sha256(text.encode("ascii")).hexdigest()
    if len(text) != expected_len or got_sha256 != expected_sha256:
        raise SystemExit(
            f"1.1.1 delta part integrity failed for {part.name}: "
            f"length expected {expected_len}, got {len(text)}; "
            f"SHA-256 expected {expected_sha256}, got {got_sha256}"
        )
    encoded_parts.append(text)

encoded = "".join(encoded_parts)
try:
    payload = base64.b64decode(encoded, validate=True)
except Exception as exc:
    raise SystemExit(f"1.1.1 delta base64 decode failed: {exc}") from exc

got_sha256 = hashlib.sha256(payload).hexdigest()
if got_sha256 != EXPECTED_DELTA_SHA256:
    raise SystemExit(
        "1.1.1 delta SHA-256 mismatch: "
        f"expected {EXPECTED_DELTA_SHA256}, got {got_sha256}"
    )

with tarfile.open(fileobj=io.BytesIO(payload), mode="r:xz") as archive:
    for member in archive.getmembers():
        if not member.isfile():
            raise SystemExit(f"unsupported 1.1.1 delta member: {member.name}")
        relative = pathlib.PurePosixPath(member.name)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise SystemExit(f"unsafe 1.1.1 delta path: {member.name}")
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit(f"could not read 1.1.1 delta member: {member.name}")
        destination = WORK.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read())

# Final adversarial-review hardening applied after the reviewed delta. Every
# transform is exact and fail-closed so upstream drift cannot be silently
# accepted by the certification workflow.
replace_once(
    "scripts/configure-registry.mjs",
    "runWrangler(['d1','create',databaseName]);",
    "runWrangler(['d1','create',databaseName,'--update-config=false','--experimental-auto-create=false','--experimental-provision=false']);",
)

replace_once(
    "tests/node/configure-registry.test.mjs",
    "import test from 'node:test';",
    "import { readFile } from 'node:fs/promises';\nimport test from 'node:test';",
)
append_once(
    "tests/node/configure-registry.test.mjs",
    "registry creation explicitly disables Wrangler config auto-mutation",
    """test('registry creation explicitly disables Wrangler config auto-mutation', async () => {
  const source = await readFile(new URL('../../scripts/configure-registry.mjs', import.meta.url), 'utf8');
  assert.match(source, /d1','create',databaseName,'--update-config=false','--experimental-auto-create=false','--experimental-provision=false'/);
});""",
)

insert_before_once(
    "scripts/audit-lib.mjs",
    '    ,["guided Windows deployment configures Access then authenticated registry before final verification",',
    '    ,["registry D1 creation cannot auto-mutate Wrangler configuration", () => /d1\',\'create\',databaseName,\'--update-config=false\',\'--experimental-auto-create=false\',\'--experimental-provision=false\'/.test(s("scripts/configure-registry.mjs"))]\n',
)

replace_once(
    "scripts/audit-lib.mjs",
    '    ,["paste-once launcher is version-specific, unique-run and cmdlet-parameter safe", () => /\\$Version = [\'"]1\\.1\\.1[\'"]/.test(s("PASTE-ONCE-WINDOWS.ps1")) && /New-Item -ItemType Directory -Path \\$runRoot -Force/.test(s("PASTE-ONCE-WINDOWS.ps1")) && !/New-Item[^\\n]*-LiteralPath/.test(s("PASTE-ONCE-WINDOWS.ps1")) && /yyyyMMdd-HHmmss-fff/.test(s("PASTE-ONCE-WINDOWS.ps1")) && /run-\\$stamp/.test(s("PASTE-ONCE-WINDOWS.ps1"))]',
    '    ,["paste-once launcher is version-specific, unique-run and cmdlet-parameter safe", () => { const launcher=s("PASTE-ONCE-WINDOWS.ps1"), match=/\\$Version = [\'"]([^\'"]+)[\'"]/.exec(launcher), current=JSON.parse(s("package.json")).version; return match?.[1]===current && /New-Item -ItemType Directory -Path \\$runRoot -Force/.test(launcher) && !/New-Item[^\\n]*-LiteralPath/.test(launcher) && /yyyyMMdd-HHmmss-fff/.test(launcher) && /run-\\$stamp/.test(launcher) }]',
)

insert_before_once(
    "scripts/mutation-suite.mjs",
    "const mutations = [",
    'const currentVersion = JSON.parse(files["package.json"]).version;\nconst escapedVersion = currentVersion.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");\n\n',
)
for old, new in (
    ('["drift deployed APP_VERSION from package version", "wrangler.jsonc", /"APP_VERSION": "1\\.1\\.1"/, \'"APP_VERSION": "0.0.0"\']', '["drift deployed APP_VERSION from package version", "wrangler.jsonc", new RegExp(`"APP_VERSION": "${escapedVersion}"`), \'"APP_VERSION": "0.0.0"\']'),
    ('["drift Worker Vitest runtime APP_VERSION from package version", "tests/worker/wrangler.test.jsonc", /"APP_VERSION": "1\\.1\\.1"/, \'"APP_VERSION": "0.0.0"\']', '["drift Worker Vitest runtime APP_VERSION from packae version", "tests/worker/wrangler.test.jsonc", new RegExp(`"APP_VERSION": "${escapedVersion}"`), \'"APP_VERSION": "0.0.0"\']'),
    ('["drift integration runtime APP_VERSION from package version", "tests/integration/wrangler.test.jsonc", /"APP_VERSION":"1\\.1\\.1"/, \'"APP_VERSION":"0.0.0"\']', '["drift integration runtime APP_VERSION from packae version", "tests/integration/wrangler.test.jsonc", new RegExp(`"APP_VERSION":"${escapedVersion}"`), \'"APP_VERSION":"0.0.0"\']'),
    ('["drift E2E mock runtime version from package version", "tests/e2e/mock-server.mjs", /version:\'1\\.1\\.1\'/, "version:\'0.0.0\'"]', '["drift E2E mock runtime version from packae version", "tests/e2e/mock-server.mjs", new RegExp(`version:\'${escapedVersion}\'`), "version:\'0.0.0\'"]'),
):
    replace_once("scripts/mutation-suite.mjs", old, new)

insert_before_once(
    "scripts/mutation-suite.mjs",
    '  ["remove mutation-suite baseline guard",',
    '  ["allow Wrangler D1 create to mutate config", "scripts/configure-registry.mjs", /,\'--update-config=false\',\'--experimental-auto-create=false\',\'--experimental-provision=false\'/g, ""],\n',
)

replace_once(
    "docs/CHANGELOG.md",
    "- Adds additive D1 migration `0002_usage_result_receipts.sql`, regression tests, static safeguards and mutation tests for the repaired paths.",
    "- Prevents `wrangler d1 create` from auto-editing or auto-provisioning the certified Wrangler configuration by explicitly disabling config update, auto-create, and experimental provisioning during registry creation.\n- Adds additive D1 migration `0002_usage_result_receipts.sql`, regression tests, static safeguards and mutation tests for the repaired paths.",
)

# Generated Windows evidence is never source and must not survive into a new
# release candidate even if an older materializer happened to leave it behind.
for generated in (
    "windows-release-output.log",
    "windows-release-transcript.log",
    "windows-release-exit-code.txt",
):
    (WORK / generated).unlink(missing_ok=True)

package = json.loads((WORK / "package.json").read_text(encoding="utf-8"))
manifest = json.loads((WORK / "RELEASE_MANIFEST.json").read_text(encoding="utf-8"))
if package.get("version") != "1.1.1":
    raise SystemExit(f"materialized package version is not 1.1.1: {package.get('version')!r}")
if manifest.get("version") != "1.1.1":
    raise SystemExit(f"materialized manifest version is not 1.1.1: {manifest.get('version')!r}")
if manifest.get("releaseReady") is not False:
    raise SystemExit("1.1.1 review candidate must materialize with releaseReady:false")

print("1.1.1 delta per-part integrity PASS.")
print(f"1.1.1 reviewed delta SHA-256 PASS: {got_sha256}")
print("1.1.1 final adversarial-review hardening PASS.")
print("Materialized reviewe CosmicTranscriberWeb 1.1.1 candidate (releaseReady:false).")
