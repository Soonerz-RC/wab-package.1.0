"""
Orchestrate a full refresh of the WAB Package 1.0 portal data.

Runs each ingest script in dependency order:
  1. Inventory (data/tracts.json)
  2. Wells (data/wells.json) — depends on tracts
  3. Permits, Completions, Production, Leasing, Regulatory — depend on tracts

Each step is invoked as a subprocess via the same Python interpreter so
errors in one phase don't poison others. The final step prints the
consolidated matching report from meta.json.

Usage:
    source .venv/bin/activate
    python scripts/refresh_all.py [--oseberg-folder YYYY-MM-DD] [--skip-inventory] [--skip-oseberg]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import List

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
META_PATH = PROJECT_ROOT / "data" / "meta.json"

STEPS = [
    # (label, script_filename, takes_oseberg_folder_flag)
    ("Inventory",   "ingest_inventory.py",          False),
    ("Wells",       "ingest_oseberg_wells.py",      True),
    ("Permits",     "ingest_oseberg_permits.py",    True),
    ("Completions", "ingest_oseberg_completions.py",True),
    ("Production",  "ingest_oseberg_production.py", True),
    ("Leasing",     "ingest_oseberg_leasing.py",    True),
    ("Regulatory",  "ingest_oseberg_regulatory.py", True),
]


def run_step(label: str, script: str, args: List[str]) -> int:
    print(f"\n{'='*70}")
    print(f"=== {label}: {script} ===")
    print('='*70)
    start = time.time()
    cmd = [sys.executable, str(SCRIPTS_DIR / script)] + args
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    elapsed = time.time() - start
    print(f"--- {label} done in {elapsed:.1f}s (exit {result.returncode}) ---")
    return result.returncode


def print_consolidated_report() -> None:
    if not META_PATH.exists():
        print("WARNING: meta.json not present — cannot print consolidated report")
        return
    meta = json.load(META_PATH.open("r", encoding="utf-8"))
    print("\n" + "=" * 70)
    print("=== CONSOLIDATED MATCHING REPORT ===")
    print("=" * 70)
    print(f"Generated at:    {meta.get('generated_at')}")
    print(f"Inventory file:  {meta.get('inventory_file')}")
    print(f"Oseberg folder:  {meta.get('oseberg_folder')}")
    print()
    print("Counts:")
    for k, v in sorted(meta.get("counts", {}).items()):
        print(f"  {k:30s}  {v}")
    print()
    print("Matching report:")
    mr = meta.get("matching_report", {})
    for k in sorted(mr.keys()):
        v = mr[k]
        if isinstance(v, list):
            print(f"  {k:40s}  {len(v)} entries")
        else:
            print(f"  {k:40s}  {v}")
    print()
    print("ID registry:")
    for k, v in sorted(meta.get("id_registry", {}).items()):
        if isinstance(v, list):
            print(f"  {k:30s}  {len(v)} entries")
        else:
            print(f"  {k:30s}  {v}")


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--oseberg-folder", type=str, default=None,
                        help="Override auto-detected dated Oseberg folder (e.g. 2026-05-22).")
    parser.add_argument("--skip-inventory", action="store_true",
                        help="Skip inventory ingest. Useful when only Oseberg data has changed.")
    parser.add_argument("--skip-oseberg", action="store_true",
                        help="Skip all Oseberg ingests. Useful for inventory-only refreshes.")
    parser.add_argument("--continue-on-error", action="store_true",
                        help="Run all steps even if an earlier step fails. Default is to stop on first error.")
    args = parser.parse_args(argv)

    oseberg_args: List[str] = []
    if args.oseberg_folder:
        oseberg_args = ["--oseberg-folder", args.oseberg_folder]

    failures: List[str] = []
    for label, script, takes_oseberg in STEPS:
        if args.skip_inventory and label == "Inventory":
            print(f"Skipping {label} (--skip-inventory)")
            continue
        if args.skip_oseberg and takes_oseberg:
            print(f"Skipping {label} (--skip-oseberg)")
            continue
        step_args = oseberg_args if takes_oseberg else []
        rc = run_step(label, script, step_args)
        if rc != 0:
            failures.append(label)
            if not args.continue_on_error:
                print(f"\nSTOPPING: {label} failed with exit {rc}.")
                print(f"Re-run with --continue-on-error to attempt subsequent steps anyway.")
                print_consolidated_report()
                return rc

    print_consolidated_report()

    if failures:
        print(f"\nFAILED steps: {failures}")
        return 1
    print("\nAll steps completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
