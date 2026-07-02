"""
WTI / Henry Hub price updater. Writes data/prices.json.

Three modes:

  --fetch                 Pull NYMEX front-month closes from Yahoo Finance
                          (default). CL=F for WTI, NG=F for Henry Hub.
                          No API key required. Same-day data when the
                          futures market is open.

  --fetch --source eia    Pull EIA spot closes (RWTC + RNGWHHD). 1-day
                          publication lag. Requires EIA_API_KEY in the
                          environment or in .env at the project root.

  --wti X --henry-hub Y   Provide closing prices on the command line
                          (manual mode). Useful for backfills or when
                          neither source is available.

If --date is omitted, the source's most-recent reported date is used in
--fetch mode, or today's date is used in manual mode. Deltas are
computed against the existing prices.json (prior close).

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

# ---------------------------------------------------------------------------
# Yahoo Finance fetcher (default)
# ---------------------------------------------------------------------------

YAHOO_TICKERS = {
    "wti": "CL=F",   # NYMEX WTI Crude Oil front-month continuous contract
    "henry_hub": "NG=F",  # NYMEX Henry Hub Natural Gas front-month continuous contract
}


def fetch_via_yahoo() -> Tuple[str, float, float, Optional[float], Optional[float]]:
    """Return (as_of_iso, wti_close, hh_close, wti_prior, hh_prior) via yfinance.

    Pulls NYMEX front-month continuous futures: CL=F for WTI, NG=F for
    Henry Hub natural gas. yfinance handles Yahoo's cookies and rate
    limiting; direct curl calls get 429-rejected.
    """
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError(
            "yfinance is not installed. Run: pip install -r requirements.txt"
        ) from exc

    # Suppress noisy chained-assignment FutureWarnings from yfinance's
    # internals. They're informational about yfinance's compatibility
    # with future pandas releases, not actual problems.
    import warnings
    warnings.filterwarnings("ignore", category=FutureWarning)

    # Retry the ENTIRE fetch-and-validate flow up to 3 times with backoff.
    # yfinance stores cookies/rate-limit state in a SQLite DB under a cache
    # dir resolved via XDG_CACHE_HOME (or ~/.cache). In ephemeral CI runners
    # that DB occasionally hits `OperationalError('database is locked')` on
    # one ticker while the other succeeds — yielding a dataframe with a NaN
    # column, which our per-ticker validation catches and triggers a retry.
    #
    # Point each retry at a FRESH isolated cache directory (via XDG_CACHE_HOME
    # + explicit tz-cache location). Deleting the cache in place was tried
    # and made attempt 2+ fail with 'unable to open database file' because
    # yfinance couldn't recreate its internal structure mid-process — better
    # to hand it an empty, writable directory instead.
    import os, tempfile, time

    def _isnan(v):
        return isinstance(v, float) and v != v

    last_error = None
    for attempt in range(1, 4):
        # Fresh cache directory per attempt keeps yfinance's SQLite from
        # inheriting a locked or corrupt state.
        fresh_cache = tempfile.mkdtemp(prefix=f"yf-cache-attempt{attempt}-")
        os.environ["XDG_CACHE_HOME"] = fresh_cache
        try:
            yf.set_tz_cache_location(fresh_cache)
        except Exception:
            pass  # older yfinance versions may not expose this
        try:
            data = yf.download(
                list(YAHOO_TICKERS.values()),
                period="5d",
                interval="1d",
                progress=False,
                auto_adjust=False,
            )
            if data is None or data.empty:
                raise RuntimeError("yfinance returned empty dataframe")

            closes = data["Close"].dropna(how="all")
            if closes.empty:
                raise RuntimeError(
                    "yfinance returned no Close prices in the lookback window"
                )

            last_date = closes.index[-1]
            wti = closes[YAHOO_TICKERS["wti"]].iloc[-1]
            hh = closes[YAHOO_TICKERS["henry_hub"]].iloc[-1]

            if wti is None or _isnan(wti):
                raise RuntimeError(
                    f"No WTI close in last 5 days (partial download failure). "
                    f"Last attempted: {last_date}"
                )
            if hh is None or _isnan(hh):
                raise RuntimeError(
                    f"No Henry Hub close in last 5 days (partial download "
                    f"failure). Last attempted: {last_date}"
                )

            # Full success — break out of the retry loop.
            break

        except Exception as exc:
            last_error = exc
            # Wait longer than the previous attempt — SQLite locks tend to
            # clear on their own within 30 s, and yfinance's rate-limit
            # cookies age out over a similar horizon.
            if attempt < 3:
                delay = attempt * 20
                print(
                    f"  yfinance attempt {attempt} failed ({last_error}); "
                    f"retrying in {delay}s with a fresh cache dir …",
                    file=sys.stderr,
                )
                time.sleep(delay)
    else:
        # All 3 attempts failed — re-raise the last error.
        raise RuntimeError(
            f"yfinance failed after 3 attempts. Last error: {last_error}"
        )

    # Prior-day closes from the SAME fetch, for a proper 1-day delta.
    wti_prior = hh_prior = None
    if len(closes) >= 2:
        prev = closes.iloc[-2]
        wti_v = prev[YAHOO_TICKERS["wti"]]
        hh_v = prev[YAHOO_TICKERS["henry_hub"]]
        if wti_v is not None and not _isnan(wti_v):
            wti_prior = float(wti_v)
        if hh_v is not None and not _isnan(hh_v):
            hh_prior = float(hh_v)

    as_of = last_date.strftime("%Y-%m-%d") if hasattr(last_date, "strftime") else str(last_date)
    return as_of, float(wti), float(hh), wti_prior, hh_prior


# ---------------------------------------------------------------------------
# EIA fetcher (--source eia)
# ---------------------------------------------------------------------------

EIA_BASE = "https://api.eia.gov/v2"
WTI_SERIES = "RWTC"           # WTI spot price FOB at Cushing, OK ($/BBL)
WTI_PATH = "petroleum/pri/spt"
HH_PRODUCT = "EPG0"           # Natural Gas (returns Henry Hub spot RNGWHHD)
HH_PATH = "natural-gas/pri/fut"


def load_env_key(path: Path, key: str) -> Optional[str]:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == key:
            v = v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            return v
    return None


def resolve_eia_api_key() -> Optional[str]:
    return os.environ.get("EIA_API_KEY") or load_env_key(ENV_PATH, "EIA_API_KEY")


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
    qs = urllib.parse.urlencode(params, safe="")
    return f"{base}?{qs}"


def fetch_eia_latest(path: str, facets: dict, api_key: str, timeout: int = 20) -> Tuple[str, float]:
    url = _build_eia_url(path, api_key, facets)
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


def fetch_via_eia(api_key: str) -> Tuple[str, float, float]:
    wti_period, wti = fetch_eia_latest(WTI_PATH, {"series": [WTI_SERIES]}, api_key)
    hh_period, hh = fetch_eia_latest(HH_PATH, {"product": [HH_PRODUCT]}, api_key)
    as_of = max(wti_period, hh_period)
    return as_of, wti, hh


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
    wti_prior: Optional[float] = None,
    hh_prior: Optional[float] = None,
) -> dict:
    # Preferred: use prior-day closes from the SAME fetch (true 1-day delta).
    # Fallback only if the data source couldn't provide them: use the
    # previously-saved file. The fallback path can produce misleading deltas
    # when the file is stale, so the caller should always supply the prior
    # closes in the modern path.
    if wti_prior is None or hh_prior is None:
        prior = _load_prior(PRICES_PATH)
        if wti_prior is None:
            wti_prior = (prior or {}).get("wti", {}).get("close_usd")
        if hh_prior is None:
            hh_prior = (prior or {}).get("henry_hub", {}).get("close_usd_mmbtu")

    wti_change, wti_pct = _compute_delta(wti_close, wti_prior)
    hh_change, hh_pct = _compute_delta(hh_close, hh_prior)

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
                      help="Pull WTI and Henry Hub automatically. Default source is Yahoo Finance (NYMEX front-month). Use --source eia for EIA spot prices.")
    mode.add_argument("--source", choices=["yahoo", "eia"], default="yahoo",
                      help="Data source for --fetch mode. Default: yahoo.")
    mode.add_argument("--wti", type=float, default=None,
                      help="Today's WTI closing price ($/bbl) — manual mode.")
    mode.add_argument("--henry-hub", type=float, default=None,
                      help="Today's Henry Hub closing price ($/MMBtu) — manual mode.")
    parser.add_argument("--date", type=str, default=None,
                        help="ISO date for as_of (overrides the source's reported date).")
    parser.add_argument("--source-label", type=str, default=None,
                        help="Free-text 'source' field for prices.json. Default depends on mode.")
    args = parser.parse_args(argv)

    if args.fetch:
        try:
            if args.source == "yahoo":
                source_label = args.source_label or "Yahoo Finance (NYMEX front-month: CL=F + NG=F)"
                updated_by = "scripts/update_prices.py --fetch (yahoo)"
                as_of, wti_close, hh_close, wti_prior, hh_prior = fetch_via_yahoo()
            elif args.source == "eia":
                api_key = resolve_eia_api_key()
                if not api_key:
                    print("ERROR: EIA_API_KEY not found in environment or .env at the project root.",
                          file=sys.stderr)
                    print(f"  Add it at {ENV_PATH} or set in environment.", file=sys.stderr)
                    return 2
                source_label = args.source_label or "EIA Open Data v2 (RWTC + RNGWHHD spot)"
                updated_by = "scripts/update_prices.py --fetch (eia)"
                as_of, wti_close, hh_close = fetch_via_eia(api_key)
                wti_prior = hh_prior = None  # EIA fetch returns only the latest
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 3

        as_of = args.date or as_of
        payload = write_prices(
            as_of=as_of,
            wti_close=wti_close,
            hh_close=hh_close,
            source=source_label,
            updated_by=updated_by,
            wti_prior=wti_prior,
            hh_prior=hh_prior,
        )
        print(f"prices.json updated ({args.source}):")
        print(f"  WTI:       ${wti_close:.2f}/bbl   "
              f"(Δ ${payload['wti']['change_usd']:+.2f} = {payload['wti']['change_pct']*100:+.2f}%)   "
              f"period {as_of}")
        print(f"  Henry Hub: ${hh_close:.2f}/MMBtu  "
              f"(Δ ${payload['henry_hub']['change_usd']:+.2f} = {payload['henry_hub']['change_pct']*100:+.2f}%)  "
              f"period {as_of}")
        return 0

    # Manual mode
    if args.wti is None and args.henry_hub is None:
        print("ERROR: provide --fetch, or --wti and/or --henry-hub", file=sys.stderr)
        return 2

    as_of = args.date or dt.date.today().isoformat()
    try:
        dt.date.fromisoformat(as_of)
    except ValueError:
        print(f"ERROR: --date {as_of!r} is not a valid ISO date (YYYY-MM-DD)", file=sys.stderr)
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

    source_label = args.source_label or "Manual entry"
    payload = write_prices(
        as_of=as_of,
        wti_close=new_wti,
        hh_close=new_hh,
        source=source_label,
        updated_by="scripts/update_prices.py (manual)",
    )
    print(f"prices.json updated for {as_of}:")
    print(f"  WTI:       ${new_wti:.2f}/bbl   "
          f"(Δ ${payload['wti']['change_usd']:+.2f} = {payload['wti']['change_pct']*100:+.2f}%)")
    print(f"  Henry Hub: ${new_hh:.2f}/MMBtu  "
          f"(Δ ${payload['henry_hub']['change_usd']:+.2f} = {payload['henry_hub']['change_pct']*100:+.2f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
