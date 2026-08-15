from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import posixpath
import re
import sys
import zipfile


def fail(message: str) -> None:
    raise SystemExit(f"FINAL ZIP AUDIT FAILED: {message}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Independent final Cosmic Transcriber Web release ZIP audit")
    parser.add_argument("zip_path")
    parser.add_argument("reviewed_lock_path")
    parser.add_argument("expected_version")
    args = parser.parse_args()

    zip_path = pathlib.Path(args.zip_path).resolve()
    reviewed_lock_path = pathlib.Path(args.reviewed_lock_path).resolve()
    version = args.expected_version
    if not zip_path.is_file():
        fail(f"certified ZIP missing: {zip_path}")
    if not reviewed_lock_path.is_file():
        fail(f"reviewed package-lock.json missing: {reviewed_lock_path}")
    reviewed_lock = reviewed_lock_path.read_bytes()
    expected_root = f"CosmicTranscriberWeb-{version}"

    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()
        if not infos:
            fail("archive is empty")
        names = [i.filename for i in infos]
        if len(names) != len(set(names)):
            fail("archive contains duplicate entry names")

        for info in infos:
            name = info.filename
            if "\x00" in name or "\\" in name:
                fail(f"unsafe/noncanonical archive name: {name!r}")
            if name.startswith("/") or re.match(r"^[A-Za-z]:/", name):
                fail(f"absolute archive path: {name}")
            parts = name.split("/")
            if any(part in ("", ".", "..") for part in parts):
                fail(f"noncanonical/traversal archive path: {name}")
            if parts[0] != expected_root:
                fail(f"unexpected top-level root for {name}; expected {expected_root}")
            forbidden_dirs = {"node_modules", "dist", "artifacts", ".git", ".wrangler", "playwright-report", "test-results"}
            if any(part in forbidden_dirs for part in parts[1:-1]):
                fail(f"forbidden release path: {name}")
            base = parts[-1]
            if base == ".dev.vars" or base == ".env" or base.startswith(".env."):
                fail(f"secret-like environment file present: {name}")
            # The custom stored ZIP format intentionally uses no compression and
            # marks every filename UTF-8 (general-purpose bit 11).
            if info.compress_type != zipfile.ZIP_STORED:
                fail(f"unexpected compression method for {name}: {info.compress_type}")
            if not (info.flag_bits & 0x800):
                fail(f"UTF-8 filename flag missing: {name}")

        required = {
            f"{expected_root}/package.json",
            f"{expected_root}/package-lock.json",
            f"{expected_root}/RELEASE_MANIFEST.json",
            f"{expected_root}/SHA256SUMS.txt",
            f"{expected_root}/wrangler.jsonc",
            f"{expected_root}/tests/fixtures/ID3 Unicode 東京.mp3",
        }
        missing = sorted(required - set(names))
        if missing:
            fail("required entries missing: " + ", ".join(missing))

        lock_name = f"{expected_root}/package-lock.json"
        lock_bytes = zf.read(lock_name)
        if lock_bytes != reviewed_lock:
            fail("certified package-lock.json is not byte-identical to the exact reviewed lock artifact")
        lock_sha = sha256(lock_bytes)

        package = json.loads(zf.read(f"{expected_root}/package.json"))
        if package.get("version") != version:
            fail(f"package.json version {package.get('version')!r} != {version!r}")

        manifest = json.loads(zf.read(f"{expected_root}/RELEASE_MANIFEST.json"))
        if manifest.get("product") != "Cosmic Transcriber Web":
            fail("release manifest product mismatch")
        if manifest.get("version") != version:
            fail("release manifest version mismatch")
        if manifest.get("releaseReady") is not True:
            fail("release manifest is not releaseReady:true")
        dep = manifest.get("dependencyLock")
        if not isinstance(dep, dict):
            fail("release manifest dependencyLock schema missing")
        if dep.get("status") != "verified" or dep.get("sha256") != lock_sha or dep.get("registry") != "https://registry.npmjs.org/":
            fail("release manifest dependencyLock provenance does not match the exact reviewed lock")
        if manifest.get("unicodeFixture") != "tests/fixtures/ID3 Unicode 東京.mp3":
            fail("release manifest Unicode fixture provenance mismatch")
        fp = manifest.get("wranglerReleaseFingerprint")
        if not isinstance(fp, str) or not re.fullmatch(r"[0-9a-f]{64}", fp):
            fail("wrangler release fingerprint is missing or malformed")
        # V1.1 introduces the Access-bound D1 registry and admin allow-list.
        # These are the only additional post-certification Wrangler fields that
        # the reviewed helper may fill after release packaging; keep the final
        # independent ZIP audit fail-closed on this exact ordered contract.
        expected_mutable = [
            "env.staging.vars.ACCESS_TEAM_DOMAIN",
            "env.staging.vars.ACCESS_AUDIENCE",
            "env.staging.vars.ADMIN_EMAILS",
            "env.staging.d1_databases.USER_DB.database_id",
            "env.production.vars.ACCESS_TEAM_DOMAIN",
            "env.production.vars.ACCESS_AUDIENCE",
            "env.production.vars.ADMIN_EMAILS",
            "env.production.d1_databases.USER_DB.database_id",
        ]
        if manifest.get("wranglerMutableAfterRelease") != expected_mutable:
            fail("wrangler post-release mutable-field provenance contract drifted")

        # Independently verify every SHA256SUMS row against bytes inside the ZIP,
        # require one row for every packaged file except SHA256SUMS.txt itself,
        # and reject duplicate/missing/extra rows.
        sums_name = f"{expected_root}/SHA256SUMS.txt"
        rows = zf.read(sums_name).decode("utf-8").splitlines()
        checks: dict[str, str] = {}
        for row in rows:
            m = re.fullmatch(r"([0-9a-f]{64})  (.+)", row)
            if not m:
                fail(f"malformed SHA256SUMS row: {row!r}")
            digest, rel = m.groups()
            if rel in checks:
                fail(f"duplicate SHA256SUMS path: {rel}")
            if rel.startswith("/") or "\\" in rel or any(p in ("", ".", "..") for p in rel.split("/")):
                fail(f"unsafe SHA256SUMS path: {rel}")
            member = f"{expected_root}/{rel}"
            if member == sums_name or member not in names:
                fail(f"SHA256SUMS references invalid member: {rel}")
            got = sha256(zf.read(member))
            if got != digest:
                fail(f"SHA-256 mismatch for {rel}")
            checks[rel] = digest

        expected_sum_paths = {
            name[len(expected_root) + 1 :]
            for name in names
            if name != sums_name
        }
        if set(checks) != expected_sum_paths:
            missing_sums = sorted(expected_sum_paths - set(checks))
            extra_sums = sorted(set(checks) - expected_sum_paths)
            fail(f"SHA256SUMS coverage mismatch; missing={missing_sums} extra={extra_sums}")

    archive_sha = sha256(zip_path.read_bytes())
    print(f"Independent final ZIP audit PASS: {len(names)} canonical UTF-8 stored entries.")
    print(f"Version: {version}")
    print(f"Exact reviewed package-lock SHA-256: {lock_sha}")
    print(f"Certified ZIP SHA-256: {archive_sha}")


if __name__ == "__main__":
    main()
