from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys

MARKER = "CTW_VITEST_WINDOWS_RUNTIME_CASE_REPAIR_10843"
EXPECTED_VERSION = "4.1.10"


def fail(message: str) -> None:
    raise SystemExit(message)


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        fail(f"Expected exactly one {label}; found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    if os.name != "nt":
        fail("Vitest Windows runtime compatibility patch must run on Windows")

    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    pkg_path = root / "node_modules" / "vitest" / "package.json"
    if not pkg_path.is_file():
        fail(f"Missing installed Vitest package: {pkg_path}")
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    if pkg.get("version") != EXPECTED_VERSION:
        fail(f"Expected vitest {EXPECTED_VERSION}; found {pkg.get('version')!r}")

    dist = root / "node_modules" / "vitest" / "dist"
    hits: list[tuple[pathlib.Path, str]] = []
    for path in dist.rglob("*.js"):
        text = path.read_text(encoding="utf-8")
        if "const normalizedDistDir = normalize(distDir);" in text and "function getCachedVitestImport(id, state)" in text:
            hits.append((path, text))
    if len(hits) != 1:
        fail("Expected exactly one compiled Vitest cached resolver; found " + str(len(hits)) + ": " + ", ".join(str(p) for p, _ in hits))

    path, text = hits[0]
    if MARKER in text:
        fail(f"Vitest compatibility patch unexpectedly already present in {path}")

    helper_anchor = "const externalizeMap = /* @__PURE__ */ new Map();\n"
    helper = f'''const externalizeMap = /* @__PURE__ */ new Map();
// {MARKER}: exact compiled equivalent of upstream vitest-dev/vitest#10843.
// Windows path spellings are case-insensitive, but Node's ESM registry keys by URL string.
// Preserve the spelling Vitest itself was loaded with so tests never import a second runtime.
const ctwVitestRuntimeIsWindows = process.platform === "win32";
const ctwVitestRuntimeDistDirUrl = pathToFileURL(distDir).href;
const ctwVitestRuntimeLowerDistDir = distDir.toLowerCase();
const ctwVitestRuntimeLowerNormalizedDistDir = normalizedDistDir.toLowerCase();
const ctwVitestRuntimeLowerDistDirUrl = ctwVitestRuntimeDistDirUrl.toLowerCase();
function ctwVitestRuntimeIsDistId(id) {{
\tif (id.includes(distDir) || id.includes(normalizedDistDir)) return true;
\tif (!ctwVitestRuntimeIsWindows) return false;
\tconst lowerId = id.toLowerCase();
\treturn lowerId.includes(ctwVitestRuntimeLowerDistDir) || lowerId.includes(ctwVitestRuntimeLowerNormalizedDistDir) || lowerId.includes(ctwVitestRuntimeLowerDistDirUrl);
}}
function ctwVitestRuntimeWithLoadedCasing(externalize) {{
\tif (!ctwVitestRuntimeIsWindows) return externalize;
\tconst index = externalize.toLowerCase().indexOf(ctwVitestRuntimeLowerDistDirUrl);
\tif (index === -1) return externalize;
\treturn externalize.slice(0, index) + ctwVitestRuntimeDistDirUrl + externalize.slice(index + ctwVitestRuntimeDistDirUrl.length);
}}
'''
    text = replace_once(text, helper_anchor, helper, "compiled resolver helper anchor")
    text = replace_once(
        text,
        "\tif (id.includes(distDir) || id.includes(normalizedDistDir)) {",
        "\tif (ctwVitestRuntimeIsDistId(id)) {",
        "Vitest own-dist match",
    )
    text = replace_once(
        text,
        '\t\tconst externalize = id.startsWith("file://") ? id : `${pathToFileURL(file)}${postfix}`;',
        '\t\tconst externalize = id.startsWith("file://") ? ctwVitestRuntimeWithLoadedCasing(id) : `${ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)}${postfix}`;',
        "Vitest dist externalization",
    )
    text = replace_once(
        text,
        '\t\tconst externalize = `${pathToFileURL(join(root, file))}${postfix}`;',
        '\t\tconst externalize = `${ctwVitestRuntimeWithLoadedCasing(pathToFileURL(join(root, file)).href)}${postfix}`;',
        "Vitest relative-root externalization",
    )

    if text.count(MARKER) != 1:
        fail("Compatibility marker postcondition failed")
    for stale in (
        "\tif (id.includes(distDir) || id.includes(normalizedDistDir)) {",
        '\t\tconst externalize = id.startsWith("file://") ? id : `${pathToFileURL(file)}${postfix}`;',
        '\t\tconst externalize = `${pathToFileURL(join(root, file))}${postfix}`;',
    ):
        if stale in text:
            fail("Old Vitest resolver form remains after patch")

    before = sha256(path)
    path.write_text(text, encoding="utf-8", newline="")
    after = sha256(path)
    if before == after:
        fail("Vitest resolver SHA-256 did not change")
    print(f"Vitest {EXPECTED_VERSION} Windows runtime compatibility patch PASS")
    print(f"target={path.relative_to(root).as_posix()}")
    print(f"before_sha256={before}")
    print(f"after_sha256={after}")
    print("upstream_semantics=vitest-dev/vitest#10843")


if __name__ == "__main__":
    main()
