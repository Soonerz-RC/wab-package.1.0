"""
WTI / Henry Hub price updater. Writes data/prices.json.

Two modes:

  --fetch                 Pull WTI (RWTC) and Henry Hub (RNGWHHD) from
                          the EIA Open Data API v2 automatically.
                          Requires EIA_API_KEY in the environment or in
                          a .env file at the project root.

  --wti X --henry-hub Y   Provide closing prices on the command line
                          (the original manual mode). Useful if EIA is
                          unavailable or for backfills.

If --date is omitted, EIA's reported period is used in --fetch mode, or
today's date is used in manual mode. Deltas are computed against the
existing prices.json (prior close).

See docs/2026-05-22-data-model-spec.md §11.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
PRICES_PATH = PROJECT_ROOT / "data" / "prices.json"
ENV_PATH = PROJECT_ROOT / ".env"

EIA_BASE = "https://api.eia.gov/v2"

# Series we pull. Verified active as of 2026-05-22.
WTI_SERIES = "RWTC"        # WTI spot price FOB at Cushing, OK ($/BBL)
WTI_PATH = "petroleum/pri/spt"

HH_PRODUCT = "EPG0"        # Natural Gas (returns Henry Hub spot RNGWHHD)
HH_PATH = "natural-gas/pri/fut"


# ---------------------------------------------------------------------------
# .env loader (no external dependency)
# ---------------------------------------------------------------------------


def load_env_key(path: Path, key: str) -> Optional[str]:
    """Look up a KEY=VALUE entry in a simple .env file. Returns None if absent."""
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == key:
            v = v.strip()
            # Allow optional surrounding quotes
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            return v
    return None


def resolve_api_key() -> Optional[str]:
    """Look in os.environ first, then .env at the project root."""
    return os.environ.get("EIA_API_KEY") or load_env_key(ENV_PATH, "EIA_API_KEY")


# ---------------------------------------------------------------------------
# EIA fetcher
# ---------------------------------------------------------------------------


def _build_eia_url(path: str, api_key: str, facets: dict) -> str:
    base = f"{EIA_BASE}/{path}/data/"
    params = [
        ("api_key", api_key),
        ("frequency", "daily"),
        ("data[0]", "value"),
        ("sort[0][column]", "period"),
        ("sort[0][direction]", "desc"),
        ("length", "1"),
    ]
    for facet_key, values in facets.items():
        for v in values:
            params.append((f"facets[{facet_key}][]", v))
    # Use urlencode with safe='' to ensure brackets are percent-encoded
    qs = urllib.parse.urlencode(params, safe="")
    return f"{base}?{qs}"


def fetch_eia_latest(path: str, facets: dict, api_key: str, timeout: int = 20) -> Tuple[str, float]:
    """Return (period_iso, value) of the most recent data point for the series.

    Raises RuntimeError on EIA error response, network failure, or empty result.
    """
    url = _build_eia_url(path, api_key, facets)
    # Sanitize URL for any error messages (don't leak key)
    safe_url = url.replace(api_key, "***KEY***")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = "<unreadable>"
        raise RuntimeError(f"EIA HTTP {e.code}: {body}  (url: {safe_url})")
    except Exception as e:
        raise RuntimeError(f"EIA fetch failed: {e}  (url: {safe_url})")

    if isinstance(payload, dict) and "error" in payload:
        raise RuntimeError(f"EIA error: {payload['error']}  (url: {safe_url})")
    rows = payload.get("response", {}).get("data", [])
    if not rows:
        raise RuntimeError(f"EIA returned no data  (url: {safe_url})")
    row = rows[0]
    period = str(row.get("period") or "")
    value = row.get("value")
    if value is None:
        raise RuntimeError(f"EIA latest row has null value: {row}  (url: {safe_url})")
    return period, float(value)


def fetch_wti(api_key: str) -> Tuple[str, float]:
    """Fetch latest WTI spot close ($/BBL) and its period."""
    return fetch_eia_latest(WTI_PATH, {"series": [WTI_SERIES]}, api_key)


def fetch_henry_hub(api_key: str) -> Tuple[str, float]:
    """Fetch latest Henry Hub spot close ($/MMBtu) and its period."""
    return fetch_eia_latest(HH_PATH, {"product": [HH_PRODUCT]}, api_key)


# ---------------------------------------------------------------------------
# Prices file handling
# ---------------------------------------------------------------------------


def _load_prior(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.load(path.open("r", encoding="utf-8"))
    except Exception:
        return None


def _compute_delta(new_close: float, prior_close: Optional[float]) -> Tuple[float, float]:
    if prior_close is None or prior_close == 0:
        return 0.0, 0.0
    change = new_close - prior_close
    pct = change / prior_close
    return round(change, 4), round(pct, 6)


def write_prices(
    *,
    as_of: str,
    wti_close: float,
    hh_close: float,
    source: str,
    updated_by: str,
) -> dict:
    """Compute deltas vs. the existing prices.json, then write the new payload."""
    prior = _load_prior(PRICES_PATH)
    prior_wti = (prior or {}).get("wti", {}).get("close_usd")
    prior_hh = (prior or {}).get("henry_hub", {}).get("close_usd_mmbtu")

    wti_change, wti_pct = _compute_delta(wti_close, prior_wti)
    hh_change, hh_pct = _compute_delta(hh_close, prior_hh)

    payload = {
        "as_of": as_of,
        "henry_hub": {
            "change_pct": hh_pct,
            "change_usd": hh_change,
            "close_usd_mmbtu": round(hh_close, 4),
        },
        "source": source,
        "updated_by": updated_by,
        "wti": {
            "change_pct": wti_pct,
            "change_usd": wti_change,
            "close_usd": round(wti_close, 4),
        },
    }

    PRICES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PRICES_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    return payload


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_argument_group("mode")
    mode.add_argument("--fetch", action="store_true",
                      help="Pull WTI and Henry Hub from EIA Open Data API v2.")
    mode.add_argument("--wti", type=float, default=None,
                      help="Today's WTI closing price ($/bbl) — manual mode.")
    mode.add_argument("--henry-hub", type=float, default=None,
                      help="Today's Henry Hub closing price ($/MMBtu) — manual mode.")
    parser.add_argument("--date", type=str, default=None,
                        help="ISO date for as_of (default: today in manual mode; "
                             "EIA's reported period in --fetch mode).")
    parser.add_argument("--source", type=str, default=None,
                        help="Free-text source label. Default depends on mode.")
    args = parser.parse_args(argv)

    if args.fetch:
        api_key = resolve_api_key()
        if not api_key:
            print("ERROR: EIA_API_KEY not found in environment or .env at the project root.",
                  file=sys.stderr)
            print("Register at https://www.eia.gov/opendata/register.php and put the key in",
                  file=sys.stderr)
            print(f"  {ENV_PATH}", file=sys.stderr)
            return 2
        try:
            wti_period, wti_close = fetch_wti(api_key)
            hh_period, hh_close = fetch_henry_hub(api_key)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 3
        # Choose the more recent period as the headline as_of
        as_of = args.date or max(wti_period, hh_period)
        source = args.source or "EIA Open Data v2 (RWTC + RNGWHHD spot)"
        updated_by = "scripts/update_prices.py --fetch"
        payload = write_prices(
            as_of=as_of,
            wti_close=wti_close,
            hh_close=hh_close,
            source=source,
            updated_by=updated_by,
        )
        print(f"prices.json updated from EIA:")
        print(f"  WTI ({WTI_SERIES})   ${wti_close:.2f}/bbl   "
              f"(Δ ${payload['wti']['change_usd']:+.2f} = {payload['wti']['change_pct']*100:+.2f}%)   "
              f"period {wti_period}")
        print(f"  Henry Hub (RNGWHHD)  ${hh_close:.2f}/MMBtu  "
              f"(Δ ${payload['henry_hub']['change_usd']:+.2f} = {payload['henry_hub']['change_pct']*100:+.2f}%)  "
              f"period {hh_period}")
        return 0

    # Manual mode
    if args.wti is None and args.henry_hub is None:
        print("ERROR: provide --fetch, or --wti and/or --henry-hub", file=sys.stderr)
        return 2

    as_of = args.date or dt.date.today().isoformat()
    try:
        dt.date.fromisoformat(as_of)
    except ValueError:
        print(f"ERROR: --date {as_of!r} is not a valid ISO date (YYYY-MM-DD)",
              file=sys.stderr)
        return 2

    prior = _load_prior(PRICES_PATH)
    prior_wti = (prior or {}).get("wti", {}).get("close_usd")
    prior_hh = (prior or {}).get("henry_hub", {}).get("close_usd_mmbtu")
    new_wti = args.wti if args.wti is not None else prior_wti
    new_hh = args.henry_hub if args.henry_hub is not None else prior_hh
    if new_wti is None or new_hh is None:
        print("ERROR: no prior prices.json — first manual run must provide BOTH "
              "--wti and --henry-hub", file=sys.stderr)
        return 2

    source = args.source or "EIA daily spot"
    updated_by = "scripts/update_prices.py (manual)"
    payload = write_prices(
        as_of=as_of,
        wti_close=new_wti,
        hh_close=new_hh,
        source=source,
        updated_by=updated_by,
    )
    print(f"prices.json updated for {as_of}:")
    print(f"  WTI:        ${new_wti:.2f}/bbl   "
          f"(Δ ${payload['wti']['change_usd']:+.2f} = {payload['wti']['change_pct']*100:+.2f}%)")
    print(f"  Henry Hub:  ${new_hh:.2f}/MMBtu  "
          f"(Δ ${payload['henry_hub']['change_usd']:+.2f} = {payload['henry_hub']['change_pct']*100:+.2f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
