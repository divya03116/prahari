"""Packages the project as a zip for handing over.

    python scripts/make_zip.py [out.zip]     (default: E:/Prahari-exports/PRAHARI-v3-complete.zip)

Everything that is source goes in. Left out: installed packages, build and
test output, caches, version-control data and every file that holds
project-specific settings or secrets (.env, .env.<anything>, .firebaserc).
`.env.example` stays in, and so does `functions/.env.local`, which only gives
the emulators an empty first-administrator address.
"""

from __future__ import annotations

import fnmatch
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "E:/Prahari-exports/PRAHARI-v3-complete.zip")

SKIP_DIRS = {
    "node_modules", "dist", "deploy", ".vercel", "test-results", "playwright-report",
    ".firebase", ".claude", ".git", "__pycache__", "Ultralytics",
}
SKIP_FILES = {".env", ".firebaserc", "PRAHARI-PROMPT.md"}
SKIP_GLOBS = ["*.log", "*.pyc"]


def wanted(dirpath: str, name: str) -> bool:
    if name in SKIP_FILES or any(fnmatch.fnmatch(name, g) for g in SKIP_GLOBS):
        return False
    if name.startswith(".env.") and name != ".env.example":
        return name == ".env.local" and os.path.basename(dirpath) == "functions"
    return True


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    count = raw = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            # functions/lib is compiled output; scripts/lib is source and must stay.
            dirnames[:] = [
                d for d in dirnames
                if d not in SKIP_DIRS and not (d == "lib" and os.path.basename(dirpath) == "functions")
            ]
            rel = os.path.relpath(dirpath, ROOT)
            for name in filenames:
                if not wanted(dirpath, name):
                    continue
                full = os.path.join(dirpath, name)
                parts = ["PRAHARI"] + ([] if rel == "." else rel.split(os.sep)) + [name]
                z.write(full, "/".join(parts))
                count += 1
                raw += os.path.getsize(full)
    print(f"{count} files, {raw / 1e6:.1f} MB -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
