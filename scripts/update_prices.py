"""
Daily WTI / Henry Hub price updater. Writes data/prices.json.

Usage:
    source .venv/bin/activate
    python scripts/update_prices.py --wti 78.42 --henry-hub 3.18 --date 2026-05-22

If --date is omitted, today's date is used. If --wti or --henry-hub is omitted,
the prior value is preserved with zero change. Deltas are computed against
the existing prices.json (prior close).

See docs/2026-05-22-data-model-spec.md §11.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
PRICES_PATH = PROJECT_ROOT / "data" / "prices.json"


def _load_prior(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.load(path.open("r", encoding="utf-8"))
    except Exception:
        return None


def _compute_delta(new_close: float, prior_close: Optional[float]) -> tuple[float, float]:
    """Return (change_usd, change_pct as decimal). Zero on first run."""
    if prior_close is None or prior_close == 0:
        return 0.0, 0.0
    change = new_close - prior_close
    pct = change / prior_close
    return round(change, 4), round(pct, 6)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wti", type=float, default=None,
                        help="Today's WTI closing price ($/bbl)")
    parser.add_argument("--henry-hub", type=float, default=None,
                        help="Today's Henry Hub closing price ($/MMBtu)")
    parser.add_argument("--date", type=str, default=None,
                        help="ISO date of the prices being recorded (default: today)")
    parser.add_argument("--source", type=str, default="EIA daily spot",
                        help="Free-text source label (default: 'EIA daily spot')")
    args = parser.parse_args(argv)

    as_of = args.date or dt.date.today().isoformat()
    try:
        dt.date.fromisoformat(as_of)
    except ValueError:
        print(f"ERROR: --date {as_of!r} is not a valid ISO date (YYYY-MM-DD)", file=sys.stderr)
        return 2

    if args.wti is None and args.henry_hub is None:
        print("ERROR: provide at least one of --wti or --henry-hub", file=sys.stderr)
        return 2

    prior = _load_prior(PRICES_PATH)
    prior_wti = (prior or {}).get("wti", {}).get("close_usd")
    prior_hh = (prior or {}).get("henry_hub", {}).get("close_usd_mmbtu")

    new_wti = args.wti if args.wti is not None else prior_wti
    new_hh = args.henry_hub if args.henry_hub is not None else prior_hh

    if new_wti is None or new_hh is None:
        print("ERROR: no prior prices.json — first run must provide BOTH --wti and --henry-hub", file=sys.stderr)
        return 2

    wti_change, wti_pct = _compute_delta(new_wti, prior_wti)
    hh_change, hh_pct = _compute_delta(new_hh, prior_hh)

    payload = {
        "as_of": as_of,
        "henry_hub": {
            "change_pct": hh_pct,
            "change_usd": hh_change,
            "close_usd_mmbtu": round(new_hh, 4),
        },
        "source": args.source,
        "updated_by": "scripts/update_prices.py",
        "wti": {
            "change_pct": wti_pct,
            "change_usd": wti_change,
            "close_usd": round(new_wti, 4),
        },
    }

    PRICES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PRICES_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")

    print(f"prices.json updated for {as_of}:")
    print(f"  WTI:        ${new_wti:.2f}/bbl   (Δ ${wti_change:+.2f} = {wti_pct*100:+.2f}%)")
    print(f"  Henry Hub:  ${new_hh:.2f}/MMBtu  (Δ ${hh_change:+.2f} = {hh_pct*100:+.2f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
