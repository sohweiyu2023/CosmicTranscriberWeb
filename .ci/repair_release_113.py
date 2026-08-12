from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
OLD = "1.0.12"
NEW = "1.0.13"

# Registry @latest graph resolved with lifecycle scripts disabled in hosted run
# 31551303711. package.json keeps upgrade-friendly caret ranges, while the
# resolve-lock certification job produces one exact package-lock.json that every
# platform reuses byte-for-byte.
LATEST_DIRECT = {
    "dependencies": {
        "@noble/hashes": "^2.3.0",
        "jose": "^6.2.8",
    },
    "devDependencies": {
        "@cloudflare/vitest-pool-workers": "^0.21.1",
        "@playwright/test": "^1.62.1",
        "msw": "^2.15.0",
        "vitest": "^4.1.10",
        "wrangler": "^4.121.0",
    },
}
EXPECTED_BASE_DIRECT = {
    "dependencies": {
        "@noble/hashes": "^2.3.0",
        "jose": "^6.2.8",
    },
    "devDependencies": {
        "@cloudflare/vitest-pool-workers": "^0.21.0",
        "@playwright/test": "^1.62.1",
        "msw": "^2.15.0",
        "vitest": "^4.1.10",
        "wrangler": "^4.120.0",
    },
}


def fail(message: str) -> None:
    raise SystemExit(message)


def read(rel: str) -> str:
    path = WORK / rel
    if not path.is_file():
        fail(f"1.0.13 release derivation required file missing: {rel}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"1.0.13 release derivation expected UTF-8 file: {rel}")
        raise


def write(rel: str, text: str) -> None:
    (WORK / rel).write_text(text, encoding="utf-8", newline="")


def replace_exact(rel: str, old: str, new: str, expected: int | None = None) -> None:
    text = read(rel)
    count = text.count(old)
    if expected is not None and count != expected:
        fail(f"{rel}: expected {expected} occurrence(s) of {old!r}; found {count}")
    if count == 0:
        fail(f"{rel}: release derivation anchor missing: {old!r}")
    write(rel, text.replace(old, new))


# JSON release surfaces and exact reviewed latest direct ranges.
package = json.loads(read("package.json"))
if package.get("version") != OLD:
    fail(f"package.json baseline version drifted: {package.get('version')!r}")
for section, expected in EXPECTED_BASE_DIRECT.items():
    actual = package.get(section)
    if actual != expected:
        fail(f"package.json {section} baseline drifted: expected {expected!r}, got {actual!r}")
package["version"] = NEW
for section, latest in LATEST_DIRECT.items():
    package[section] = latest.copy()
write("package.json", json.dumps(package, indent=2, ensure_ascii=False) + "\n")

manifest = json.loads(read("RELEASE_MANIFEST.json"))
if manifest.get("version") != OLD:
    fail(f"RELEASE_MANIFEST.json baseline version drifted: {manifest.get('version')!r}")
manifest["version"] = NEW
# A new release must be re-certified; never inherit release-ready state.
manifest["releaseReady"] = False
write("RELEASE_MANIFEST.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

wrangler = json.loads(read("wrangler.jsonc"))
for label, vars_obj in (
    ("top-level", wrangler.get("vars")),
    ("staging", wrangler.get("env", {}).get("staging", {}).get("vars")),
    ("production", wrangler.get("env", {}).get("production", {}).get("vars")),
):
    if not isinstance(vars_obj, dict) or vars_obj.get("APP_VERSION") != OLD:
        fail(f"wrangler.jsonc {label} APP_VERSION baseline drifted")
    vars_obj["APP_VERSION"] = NEW
write("wrangler.jsonc", json.dumps(wrangler, indent=2, ensure_ascii=False) + "\n")

for rel in ("tests/worker/wrangler.test.jsonc", "tests/integration/wrangler.test.jsonc"):
    obj = json.loads(read(rel))
    if obj.get("vars", {}).get("APP_VERSION") != OLD:
        fail(f"{rel} APP_VERSION baseline drifted")
    obj["vars"]["APP_VERSION"] = NEW
    write(rel, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

# Exact text release/runtime surfaces required by version-consistency.mjs.
replace_exact("public/js/models.js", f'APP_VERSION = "{OLD}"', f'APP_VERSION = "{NEW}"', 1)
replace_exact("public/index.html", OLD, NEW, 2)
replace_exact("README.md", f"# Cosmic Transcriber Web {OLD}", f"# Cosmic Transcriber Web {NEW}", 1)
replace_exact("tests/worker/runtime.test.js", f"APP_VERSION:'{OLD}'", f"APP_VERSION:'{NEW}'", 1)
replace_exact("tests/e2e/mock-server.mjs", OLD, NEW, 2)
replace_exact("PASTE-ONCE-WINDOWS.ps1", f"$Version = '{OLD}'", f"$Version = '{NEW}'", 1)
replace_exact("tests/node/version-consistency.test.mjs", OLD, NEW, 4)

# Packaged CI is a live release surface, not historical evidence. Update only
# the workflow text inside the derived source; historical Windows transcripts
# and prior audit logs intentionally retain their original 1.0.12 evidence.
ci = read(".github/workflows/ci.yml")
ci_count = ci.count(OLD)
if ci_count < 1:
    fail("Packaged CI contains no 1.0.12 release label to promote")
write(".github/workflows/ci.yml", ci.replace(OLD, NEW))

# Add a concise changelog entry while preserving prior release history.
changelog = read("docs/CHANGELOG.md")
heading = f"## {NEW} — current dependency refresh"
if heading not in changelog:
    insertion = (
        f"{heading}\n\n"
        "- Refreshed all direct production/development dependencies from the npm registry `latest` tag before certification.\n"
        "- Updated `@cloudflare/vitest-pool-workers` from the reviewed 0.21.0 range to `^0.21.1`.\n"
        "- Updated Wrangler from `^4.120.0` to `^4.121.0`.\n"
        "- Other direct dependencies were already current: `@noble/hashes ^2.3.0`, `jose ^6.2.8`, `@playwright/test ^1.62.1`, `msw ^2.15.0`, and `vitest ^4.1.10`.\n"
        "- Preserve one exact `package-lock.json` for the dependency graph that passes release certification, while keeping caret ranges in `package.json` for the next refresh.\n"
        "- Re-run Linux, Windows, macOS WebKit, native Safari, browser, security, packaging and independent ZIP gates on the refreshed graph.\n\n"
    )
    first_h2 = changelog.find("## ")
    if first_h2 >= 0:
        changelog = changelog[:first_h2] + insertion + changelog[first_h2:]
    else:
        changelog = changelog.rstrip() + "\n\n" + insertion
    write("docs/CHANGELOG.md", changelog)

# Fail closed on exact version and dependency surfaces we own here.
final_package = json.loads(read("package.json"))
checks = {
    "package.json version": final_package.get("version") == NEW,
    "package.json dependencies": final_package.get("dependencies") == LATEST_DIRECT["dependencies"],
    "package.json devDependencies": final_package.get("devDependencies") == LATEST_DIRECT["devDependencies"],
    "RELEASE_MANIFEST.json": json.loads(read("RELEASE_MANIFEST.json")).get("version") == NEW,
    "README.md": read("README.md").startswith(f"# Cosmic Transcriber Web {NEW}\n"),
    "public/js/models.js": f'APP_VERSION = "{NEW}"' in read("public/js/models.js"),
    "public/index.html": read("public/index.html").count(NEW) >= 2,
    "tests/worker/runtime.test.js": f"APP_VERSION:'{NEW}'" in read("tests/worker/runtime.test.js"),
    "tests/e2e/mock-server.mjs": read("tests/e2e/mock-server.mjs").count(NEW) >= 2,
    "PASTE-ONCE-WINDOWS.ps1": f"$Version = '{NEW}'" in read("PASTE-ONCE-WINDOWS.ps1"),
}
bad = [name for name, ok in checks.items() if not ok]
if bad:
    fail("1.0.13 release derivation verification failed: " + ", ".join(bad))

print("Cosmic Transcriber Web 1.0.13 release derivation PASS.")
print("Historical 1.0.12 logs remain untouched; live release/version surfaces are now 1.0.13.")
print("Reviewed registry-latest direct ranges are frozen into the 1.0.13 package surface.")
