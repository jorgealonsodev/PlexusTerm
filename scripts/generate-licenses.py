#!/usr/bin/env python3
"""Generates src/features/licenses/licenses.generated.json: the license notices of every library
shipped inside PlexusTerm, shown in Settings → Open-source licenses.

- Rust: the crates compiled into the app, that is the normal (not build or dev) dependencies
  reachable from the plexusterm package for every target, from `cargo metadata --locked`.
- npm: the production dependencies, from `pnpm licenses list --prod --json`.

Each package keeps the license files it ships (LICENSE*, LICENCE*, COPYING*, NOTICE*, UNLICENSE*).
A package that ships none gets the standard text of its declared license from scripts/spdx/
(SPDX license-list-data v3.27.0); for a choice ("MIT OR Apache-2.0") the first license of
PREFERRED that it offers.

Usage: pnpm licenses:generate   (run before every release; a test fails when it is out of date)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/features/licenses/licenses.generated.json"
SPDX = ROOT / "scripts/spdx"
LICENSE_FILE = re.compile(r"(?i)^(licen[cs]e|copying|notice|unlicense)")
# The license taken from a choice when the package ships no license file.
PREFERRED = ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "Zlib", "ISC", "0BSD", "MIT-0", "Unlicense", "BSL-1.0"]


def spdx_ids(expression: str) -> list[str]:
    return [t for t in re.split(r"[\s()/]+", expression or "") if t and t not in ("OR", "AND", "WITH")]


def fallback_ids(expression: str) -> list[str]:
    """The licenses whose standard text stands for a package that ships none."""
    ids = spdx_ids(expression)
    if " OR " in f" {expression} " or "/" in expression:
        for preferred in PREFERRED:
            if preferred in ids:
                return [preferred]
    return [i for i in ids if i != "LLVM-exception"]


def license_texts(folder: Path, expression: str, name: str) -> list[str]:
    files = sorted(f for f in folder.iterdir() if f.is_file() and LICENSE_FILE.match(f.name))
    texts = [f.read_text(encoding="utf-8", errors="replace").strip() for f in files]
    texts = [t for t in texts if t]
    if texts:
        return texts
    out = []
    for spdx_id in fallback_ids(expression):
        path = SPDX / f"{spdx_id}.txt"
        if not path.is_file():
            sys.exit(f"{name}: no license file and no scripts/spdx/{spdx_id}.txt for {expression!r}")
        out.append(path.read_text(encoding="utf-8").strip())
    return out


def rust_packages():
    metadata = json.loads(
        subprocess.run(
            ["cargo", "metadata", "--format-version", "1", "--locked", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    packages = {p["id"]: p for p in metadata["packages"]}
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    root = metadata["resolve"]["root"]
    shipped, stack = set(), [root]
    while stack:
        for dep in nodes[stack.pop()]["deps"]:
            normal = any(kind["kind"] is None for kind in dep["dep_kinds"])
            if normal and dep["pkg"] not in shipped:
                shipped.add(dep["pkg"])
                stack.append(dep["pkg"])
    for package_id in shipped:
        p = packages[package_id]
        if p.get("source") is None:  # a path dependency of this repository
            continue
        expression = p.get("license") or ""
        yield {
            "ecosystem": "rust",
            "name": p["name"],
            "version": p["version"],
            "license": expression,
            "source": p.get("repository") or f"https://crates.io/crates/{p['name']}",
            "texts": license_texts(Path(p["manifest_path"]).parent, expression, p["name"]),
        }


def npm_packages():
    listing = json.loads(
        subprocess.run(["pnpm", "licenses", "list", "--prod", "--json"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    )
    for expression, packages in listing.items():
        for p in packages:
            for version, path in zip(p["versions"], p["paths"]):
                yield {
                    "ecosystem": "npm",
                    "name": p["name"],
                    "version": version,
                    "license": expression,
                    "source": p.get("homepage") or f"https://www.npmjs.com/package/{p['name']}",
                    "texts": license_texts(Path(path), expression, p["name"]),
                }


def main() -> None:
    texts: list[str] = []
    index: dict[str, int] = {}
    packages = []
    for p in sorted([*rust_packages(), *npm_packages()], key=lambda p: (p["name"].lower(), p["version"], p["ecosystem"])):
        refs = []
        for text in p["texts"]:
            key = " ".join(text.split())
            if key not in index:
                index[key] = len(texts)
                texts.append(text)
            if index[key] not in refs:
                refs.append(index[key])
        packages.append({**p, "texts": refs})
    OUT.write_text(json.dumps({"packages": packages, "texts": texts}, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"{len(packages)} packages, {len(texts)} license texts written to {OUT}")


if __name__ == "__main__":
    main()
