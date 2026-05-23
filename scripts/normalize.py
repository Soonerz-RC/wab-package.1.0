"""
Normalization functions — the single authority for STR, county, deal slug,
status, and ORRI row-hash transformations.

All values that participate in a join key MUST pass through this module first.
No script may reimplement these rules. See docs/2026-05-22-data-model-spec.md
§2 and §3.4.

Importable with no side effects. Run directly to execute self-tests:

    python scripts/normalize.py
"""

from __future__ import annotations

import hashlib
import re
import sys
import datetime as dt
from typing import Optional, Tuple, Union

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CANONICAL_COUNTIES = {"Caddo", "Custer", "Dewey", "Ellis", "Roger Mills", "Washita"}

# Status categories per spec §2.4
STATUS_CATEGORIES = {
    "LEASED",
    "HBP",
    "OPEN",
    "PENDING",
    "OTHER",
    "NON_PRODUCING",
}

# Acreage precision per spec §1.2
ACRE_PRECISION = 4


class NormalizationError(ValueError):
    """Raised when an input cannot be parsed into its canonical form.

    Callers should catch this, preserve the raw value in the matching report,
    and exclude the affected record from joins. Never swallow silently.
    """


# ---------------------------------------------------------------------------
# STR — Section-Township-Range  (spec §2.1)
# ---------------------------------------------------------------------------

_TWP_RE = re.compile(r"^(\d{1,3})([NS])$")
_RNG_RE = re.compile(r"^(\d{1,3})([EW])$")


def normalize_str(raw) -> str:
    """Return canonical STR ``SS-TTd-RRd`` (zero-padded section/township/range).

    Examples:
        ``25-11N-11W`` -> ``25-11N-11W`` (already canonical)
        ``5-12N-16W``  -> ``05-12N-16W``
        ``8-12N-23W``  -> ``08-12N-23W``

    Raises NormalizationError on any value that doesn't parse.
    """
    if raw is None:
        raise NormalizationError("STR is None")
    s = str(raw).strip().upper()
    if not s:
        raise NormalizationError("STR is empty")
    parts = s.split("-")
    if len(parts) != 3:
        raise NormalizationError(
            f"STR {raw!r}: expected 3 hyphen-separated parts, got {len(parts)}"
        )
    sec_str, twp_str, rng_str = parts
    try:
        section = int(sec_str)
    except ValueError as exc:
        raise NormalizationError(
            f"STR {raw!r}: section {sec_str!r} is not an integer"
        ) from exc
    twp_match = _TWP_RE.match(twp_str)
    if not twp_match:
        raise NormalizationError(
            f"STR {raw!r}: township {twp_str!r} doesn't match \\d{{1,3}}[NS]"
        )
    rng_match = _RNG_RE.match(rng_str)
    if not rng_match:
        raise NormalizationError(
            f"STR {raw!r}: range {rng_str!r} doesn't match \\d{{1,3}}[EW]"
        )
    twp_num = int(twp_match.group(1))
    twp_dir = twp_match.group(2)
    rng_num = int(rng_match.group(1))
    rng_dir = rng_match.group(2)
    return f"{section:02d}-{twp_num:02d}{twp_dir}-{rng_num:02d}{rng_dir}"


def township_range_from_str(canonical_str: str) -> str:
    """Strip the section from a canonical STR. ``25-11N-11W`` -> ``11N-11W``."""
    return canonical_str.split("-", 1)[1]


# ---------------------------------------------------------------------------
# County  (spec §2.2)
# ---------------------------------------------------------------------------


def normalize_county(raw) -> str:
    """Return canonical county name. Raises NormalizationError if unrecognized."""
    if raw is None:
        raise NormalizationError("county is None")
    s = str(raw).strip()
    if not s:
        raise NormalizationError("county is empty")
    # Title-case while preserving the canonical "Roger Mills" two-word form
    candidate = s.title()
    if candidate not in CANONICAL_COUNTIES:
        raise NormalizationError(
            f"county {raw!r} not in canonical list {sorted(CANONICAL_COUNTIES)}"
        )
    return candidate


# ---------------------------------------------------------------------------
# Operator-name normalization — currently targeted only at Upland.
# County-records data is full of clerk-typed typos. We do not attempt
# global operator-name cleanup; this function only collapses the 18+
# observed misspellings of Upland Operating LLC / Upland Exploration
# Oklahoma LLC into a single canonical "Upland Operating LLC" so the
# operator name reads cleanly on tract detail pages and in filters.
# ---------------------------------------------------------------------------

UPLAND_CANONICAL = "Upland Operating LLC"


def _is_upland_variant(token: str) -> bool:
    """Detect any spelling of Upland Operating / Upland Exploration."""
    if not token:
        return False
    upper = token.upper().strip()
    # Direct matches and the most common typos
    if "UPLAND" in upper:
        return True
    if "ULPLAND" in upper:    # ULPLAND -> UPLAND swap
        return True
    if "EUPLAND" in upper:    # EUPLAND -> stray-E prefix
        return True
    return False


def normalize_upland_in_string(s):
    """Replace any Upland-variant token in a multi-operator string with the canonical form.

    The source data sometimes packs multiple operators into one cell with
    `;` separators (e.g. ``"SAND CREEK OKLAHOMA LLC; UPLAND EXPLORATION OKLAHOMA LLC"``).
    We split on `;`, replace Upland-variant tokens with the canonical
    name (deduplicating if multiple Upland variants appear in the same
    cell), and rejoin. Non-Upland tokens pass through unchanged.

    Returns the input unchanged if it's None / empty / contains no Upland
    variants.
    """
    if not s:
        return s
    parts = [p.strip() for p in str(s).split(";")]
    out = []
    seen_canonical = False
    for part in parts:
        if _is_upland_variant(part):
            if not seen_canonical:
                out.append(UPLAND_CANONICAL)
                seen_canonical = True
        elif part:
            out.append(part)
    return "; ".join(out) if out else s


# ---------------------------------------------------------------------------
# Deal slug  (spec §2.3)
# ---------------------------------------------------------------------------


def normalize_deal_slug(raw) -> str:
    """Compute a URL-safe slug from a deal name."""
    if raw is None:
        raise NormalizationError("deal name is None")
    s = str(raw).lower()
    s = s.replace("&", " and ")
    s = s.replace("/", " ")
    s = s.strip()
    s = re.sub(r"\s+", "-", s)            # collapse whitespace -> hyphen
    s = re.sub(r"[^a-z0-9\-]", "", s)     # strip anything non-slug-safe
    s = re.sub(r"-+", "-", s)             # collapse repeated hyphens
    s = s.strip("-")
    if not s:
        raise NormalizationError(f"deal name {raw!r} produced empty slug")
    return s


# ---------------------------------------------------------------------------
# Status — mineral variant  (spec §2.4)
# ---------------------------------------------------------------------------


def normalize_status_mineral(raw) -> Tuple[Optional[str], str]:
    """Normalize a mineral row's STATUS cell.

    Returns ``(status_raw, status_category)``. ``status_raw`` preserves the
    original value verbatim (or None if missing). ``status_category`` is one
    of LEASED, HBP, OPEN, or OTHER.

    Regulatory state (formerly captured by clerk-typed strings like
    ``"Reign Reg"`` / ``"Crawley Reg"`` in this column) was moved to a
    separate REGULATORY column in the 2026-05-22 inventory refresh. Any
    leftover ``"Reg"``-pattern strings still in STATUS fall through to
    OTHER per the dropped mapping.
    """
    if raw is None:
        return None, "OPEN"
    if isinstance(raw, str) and not raw.strip():
        return None, "OPEN"
    s_raw = raw if isinstance(raw, str) else str(raw)
    upper = s_raw.upper()
    if "LEASED" in upper:
        return s_raw, "LEASED"
    if "HBP" in upper:
        return s_raw, "HBP"
    if "OPEN" in upper:
        return s_raw, "OPEN"
    return s_raw, "OTHER"


# ---------------------------------------------------------------------------
# Status — ORRI variant  (spec §2.4, amended 2026-05-22)
# ---------------------------------------------------------------------------


def derive_orri_status_category(date_of_lease, lease_expiration) -> str:
    """Derive an ORRI's status_category from its lease fields.

    Inputs are expected to be already-normalized values: either the literal
    string ``"HBP"`` or an ISO date string (or None).

    Returns one of: ``HBP``, ``NON_PRODUCING``, ``OTHER``.
    """
    def _is_hbp(v):
        return isinstance(v, str) and v.strip().upper() == "HBP"

    def _is_iso_date(v):
        if not isinstance(v, str):
            return False
        try:
            dt.date.fromisoformat(v)
            return True
        except ValueError:
            return False

    if _is_hbp(date_of_lease) and _is_hbp(lease_expiration):
        return "HBP"
    if _is_iso_date(date_of_lease) and _is_iso_date(lease_expiration):
        return "NON_PRODUCING"
    return "OTHER"


# ---------------------------------------------------------------------------
# ORRI row hash  (spec §3.4)
# ---------------------------------------------------------------------------


def _format_nra_for_hash(nra) -> str:
    """Format NRA for the row-hash key: round to 4 decimals, strip trailing zeros."""
    if nra is None:
        return ""
    rounded = round(float(nra), ACRE_PRECISION)
    # repr-based formatting keeps minimal-decimal form; e.g. 0.1666, 0.5, 3.0 -> "3.0"
    s = f"{rounded:.{ACRE_PRECISION}f}"
    # Trim trailing zeros but keep at least "0.0" for readability
    if "." in s:
        s = s.rstrip("0").rstrip(".") or "0"
    return s


def _format_date_for_hash(v) -> str:
    """Format a date value for the row-hash key. ``"HBP"`` and ISO date pass through."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if hasattr(v, "isoformat"):
        # datetime or date
        if hasattr(v, "date") and not isinstance(v, dt.date):
            return v.date().isoformat()
        return v.isoformat()
    return str(v)


def orri_row_hash(county: str, str_canonical: str, nra, dol, exp) -> str:
    """Return the 8-char SHA-1 prefix used as ORRI row identity (spec §3.4)."""
    key = "|".join(
        [
            county,
            str_canonical,
            _format_nra_for_hash(nra),
            _format_date_for_hash(dol),
            _format_date_for_hash(exp),
        ]
    )
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return digest[:8]


# ---------------------------------------------------------------------------
# Helpers for ingestion
# ---------------------------------------------------------------------------


def round_acres(value) -> Optional[float]:
    """Round an acreage value to 4 decimals per spec §1.2. None passes through."""
    if value is None:
        return None
    return round(float(value), ACRE_PRECISION)


def to_iso_date_or_hbp(value) -> Optional[str]:
    """Convert a cell value into an ISO date string, the literal "HBP", or None."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if s.upper() == "HBP":
            return "HBP"
        # Attempt to parse as ISO; reject otherwise
        try:
            dt.date.fromisoformat(s)
            return s
        except ValueError:
            raise NormalizationError(f"date value {value!r} is not ISO or 'HBP'")
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    raise NormalizationError(f"date value {value!r} is not a date or string")


# ---------------------------------------------------------------------------
# Self-tests  (run with `python scripts/normalize.py`)
# ---------------------------------------------------------------------------


def _selftest():
    failures = []

    def check(label, got, want):
        if got != want:
            failures.append(f"  {label}: got {got!r}, want {want!r}")

    # --- STR examples from spec §2.1 ---
    check("STR 25-11N-11W",    normalize_str("25-11N-11W"), "25-11N-11W")
    check("STR 5-12N-16W",     normalize_str("5-12N-16W"),  "05-12N-16W")
    check("STR 8-12N-23W",     normalize_str("8-12N-23W"),  "08-12N-23W")
    check("STR 1-12N-15W",     normalize_str("1-12N-15W"),  "01-12N-15W")
    check("STR with spaces",   normalize_str("  17-12N-18W  "), "17-12N-18W")
    check("STR lowercase",     normalize_str("17-12n-18w"), "17-12N-18W")
    check("STR 3-digit twp",   normalize_str("12-100N-9W"), "12-100N-09W")

    # STR errors
    for bad in ["", "17", "17-12N", "17-12N-18W-extra", "X-12N-18W", "17-12X-18W",
                "17-12N-18Z", None]:
        try:
            normalize_str(bad)
            failures.append(f"  STR {bad!r}: expected NormalizationError")
        except NormalizationError:
            pass

    # --- township_range derivation ---
    check("TR from 25-11N-11W", township_range_from_str("25-11N-11W"), "11N-11W")
    check("TR from 05-12N-16W", township_range_from_str("05-12N-16W"), "12N-16W")

    # --- County  spec §2.2 ---
    for canon in CANONICAL_COUNTIES:
        check(f"county {canon}", normalize_county(canon), canon)
    check("county lowercase 'custer'",   normalize_county("custer"),     "Custer")
    check("county 'roger mills'",        normalize_county("roger mills"),"Roger Mills")
    check("county with whitespace",      normalize_county("  Caddo  "),  "Caddo")

    for bad in ["Oklahoma", "Tulsa", "", None]:
        try:
            normalize_county(bad)
            failures.append(f"  county {bad!r}: expected NormalizationError")
        except NormalizationError:
            pass

    # --- Deal slug  spec §2.3 ---
    check("slug OPITZ",          normalize_deal_slug("OPITZ"),           "opitz")
    check("slug Napier/McClung", normalize_deal_slug("Napier/McClung"),  "napier-mcclung")
    check("slug J&A Deal",       normalize_deal_slug("J&A Deal"),        "j-and-a-deal")
    check("slug Weston Pass",    normalize_deal_slug("Weston Pass"),     "weston-pass")
    check("slug 'Allen Family '",normalize_deal_slug("Allen Family "),   "allen-family")
    check("slug TACKITT",        normalize_deal_slug("TACKITT"),         "tackitt")
    check("slug GILMORE",        normalize_deal_slug("GILMORE"),         "gilmore")
    check("slug MOORE",          normalize_deal_slug("MOORE"),           "moore")
    check("slug RIVERS",         normalize_deal_slug("RIVERS"),          "rivers")

    # --- Status mineral  spec §2.4 ---
    check("status LEASED",       normalize_status_mineral("LEASED"),     ("LEASED", "LEASED"))
    check("status HBP",          normalize_status_mineral("HBP"),        ("HBP",    "HBP"))
    check("status OPEN",         normalize_status_mineral("OPEN"),       ("OPEN",   "OPEN"))
    check("status Reign Reg (now OTHER)",   normalize_status_mineral("Reign Reg"),  ("Reign Reg",   "OTHER"))
    check("status Crawley Reg (now OTHER)", normalize_status_mineral("Crawley Reg"),("Crawley Reg", "OTHER"))
    check("status weird",                   normalize_status_mineral("Foo Bar"),    ("Foo Bar","OTHER"))
    check("status None",         normalize_status_mineral(None),         (None,     "OPEN"))
    check("status empty string", normalize_status_mineral(""),           (None,     "OPEN"))
    check("status whitespace",   normalize_status_mineral("   "),        (None,     "OPEN"))

    # --- Status ORRI derivation  spec §2.4 (amended) ---
    check("orri-status HBP/HBP",     derive_orri_status_category("HBP","HBP"),                       "HBP")
    check("orri-status date/date",   derive_orri_status_category("2024-12-14","2027-12-14"),          "NON_PRODUCING")
    check("orri-status HBP/date",    derive_orri_status_category("HBP","2027-12-14"),                "OTHER")
    check("orri-status None/date",   derive_orri_status_category(None,"2027-12-14"),                 "OTHER")
    check("orri-status None/None",   derive_orri_status_category(None, None),                        "OTHER")

    # --- ORRI row hash  spec §3.4 ---
    # Same identity tuple -> same hash (idempotence)
    h1 = orri_row_hash("Roger Mills", "16-12N-23W", 3.0, "2024-12-14", "2027-12-14")
    h2 = orri_row_hash("Roger Mills", "16-12N-23W", 3.0, "2024-12-14", "2027-12-14")
    check("orri-hash idempotent", h1, h2)
    check("orri-hash length 8",    len(h1), 8)

    # 0.1666 vs 0.1667 -> different hashes (spec §3.2 sanity check #5)
    ha = orri_row_hash("Roger Mills", "17-12N-23W", 0.1666, "2024-12-20", "2027-12-20")
    hb = orri_row_hash("Roger Mills", "17-12N-23W", 0.16670000000000001, "2024-12-20", "2027-12-20")
    if ha == hb:
        failures.append(f"  ORRI hash 0.1666 vs 0.1667 should differ: both = {ha}")

    # Float noise normalization: 3.0 vs 2.9999999999999996 (rounded to 4 decimals) -> same hash
    hc = orri_row_hash("Roger Mills", "16-12N-23W", 3.0,                 "2024-12-14", "2027-12-14")
    hd = orri_row_hash("Roger Mills", "16-12N-23W", 2.9999999999999996,  "2024-12-14", "2027-12-14")
    check("orri-hash absorbs float noise (3.0)", hc, hd)

    # HBP variant
    he = orri_row_hash("Custer", "14-15N-20W", 3.2258, "HBP", "HBP")
    check("orri-hash HBP length 8", len(he), 8)

    # --- round_acres ---
    check("round 63.332999999999998", round_acres(63.332999999999998), 63.333)
    check("round 0.16670000000000001", round_acres(0.16670000000000001), 0.1667)
    check("round 20",                  round_acres(20),                 20.0)
    check("round None",                round_acres(None),               None)

    # --- normalize_upland_in_string ---
    check("upland canonical passthrough",   normalize_upland_in_string("UPLAND OPERATING LLC"),   "Upland Operating LLC")
    check("upland exploration variant",     normalize_upland_in_string("UPLAND EXPLORATION OKLAHOMA LLC"), "Upland Operating LLC")
    check("upland typo OKALHOMA",           normalize_upland_in_string("UPLAND EXPLORATION OKALHOMA LLC"), "Upland Operating LLC")
    check("upland typo EXPLRATION",         normalize_upland_in_string("UPLAND EXPLRATION OKLAHOMA LLC"),  "Upland Operating LLC")
    check("upland typo ULPLAND",            normalize_upland_in_string("ULPLAND EX"),                      "Upland Operating LLC")
    check("upland typo EUPLAND",            normalize_upland_in_string("EUPLAND EXPLORATION OKLAHOMA LLC"),"Upland Operating LLC")
    check("upland multi-operator cell",     normalize_upland_in_string("SAND CREEK OKLAHOMA LLC; UPLAND EXPLORATION OKLAHOMA LLC"),
                                            "SAND CREEK OKLAHOMA LLC; Upland Operating LLC")
    check("upland multi w/ presidio",       normalize_upland_in_string("PRESIDIO FINANCE NOMINEE CORP; UPLAND EXPLORATION LLC; UPLAND OPERATING LLC"),
                                            "PRESIDIO FINANCE NOMINEE CORP; Upland Operating LLC")
    check("non-upland passthrough",         normalize_upland_in_string("DEVON ENERGY PRODUCTION COMPANY LP"),
                                            "DEVON ENERGY PRODUCTION COMPANY LP")
    check("None passthrough",               normalize_upland_in_string(None),  None)
    check("empty passthrough",              normalize_upland_in_string(""),    "")

    # --- to_iso_date_or_hbp ---
    check("date None",        to_iso_date_or_hbp(None),                  None)
    check("date 'HBP'",       to_iso_date_or_hbp("HBP"),                 "HBP")
    check("date 'hbp'",       to_iso_date_or_hbp("hbp"),                 "HBP")
    check("date empty",       to_iso_date_or_hbp(""),                    None)
    check("date datetime",    to_iso_date_or_hbp(dt.datetime(2024,12,14)), "2024-12-14")
    check("date date",        to_iso_date_or_hbp(dt.date(2024,12,14)),     "2024-12-14")
    check("date iso string",  to_iso_date_or_hbp("2024-12-14"),          "2024-12-14")

    try:
        to_iso_date_or_hbp("not-a-date")
        failures.append("  date 'not-a-date': expected NormalizationError")
    except NormalizationError:
        pass

    # ---------- report ----------
    total = 0  # rough count for headline; not all checks increment but the structure is fine
    if failures:
        print("FAIL — normalize.py self-test failures:")
        for f in failures:
            print(f)
        sys.exit(1)
    print("PASS — normalize.py self-tests OK")


if __name__ == "__main__":
    _selftest()
