# Data Model Specification — Oklahoma Mineral & ORRI Portal

**Version:** 2026-05-22 (supersedes 2026-05-19)
**Status:** Authoritative. Claude Code must conform to this spec exactly. Schema changes require explicit approval and an updated version of this document.

**Change log from 2026-05-19:**
- §2.4 — added ORRI-specific rule deriving `status_category` from lease fields; introduced `NON_PRODUCING` category.
- §4.4 — clarified that ORRI rows have no `STATUS` column; `status_raw` is always `null`; `status_category` is derived.
- §12 — added `aggregate_cells_skipped` to `meta.json.matching_report`.
- §13.1 — new section documenting the actual Inventory workbook layout for forward-protection of refresh scripts.

---

## 1. Conventions

### 1.1 Dates
- All dates stored as **ISO 8601 strings**: `"2027-12-14"` for dates, `"2026-05-19T14:32:00Z"` for timestamps.
- Lease and ORRI expiration may be `"HBP"` instead of a date — keep the string literal `"HBP"` exactly.
- Missing dates are `null`, not empty strings.

### 1.2 Numbers
- **Acreage** (NMA, NRA): stored as JSON numbers, **rounded to 4 decimal places**. Excel often carries 14-decimal float noise (e.g., `63.332999999999998` — that gets stored as `63.333`).
- **Royalty decimals**: JSON numbers, exact. `0.1875`, `0.25`, `0.2`. Do not convert to fractions.
- **Currency**: stored as JSON **numbers** in whole dollars (no cents), since the inventory uses whole-dollar pricing. If cents appear in any source, round to nearest dollar at ingestion and note in `meta.json`.
- **Percentages**: stored as decimals (0.1875), not percentages (18.75). Front-end formats for display.

### 1.3 Nulls vs. missing
- Use `null` for "data point known to be absent" (e.g., a leased tract has no expiration recorded yet).
- Use empty string `""` never. Either a value or `null`.
- Activity records with no tract match still appear in their respective JSON files; the `matched_tract_ids` array is `[]` (empty, not null).

### 1.4 Encoding
- All files UTF-8, LF line endings, two-space JSON indentation. Sorted keys in objects for git-diff friendliness.

---

## 2. Normalization rules

These run at ingestion. Every value that appears in a join key must pass through them. **The normalization functions live in `scripts/normalize.py` and are the only authority** — no script should reimplement these rules.

### 2.1 STR (Section-Township-Range)

**Canonical form:** `SS-TTd-RRd` where SS is 2-digit zero-padded section, TT is 2-digit zero-padded township number, d is direction (`N` or `S`), RR is 2-digit zero-padded range number, d is direction (`E` or `W`).

Examples:
| Raw | Canonical |
|---|---|
| `25-11N-11W` | `25-11N-11W` (already canonical) |
| `5-12N-16W` | `05-12N-16W` (section padded) |
| `8-12N-23W` | `08-12N-23W` |
| `1-12N-15W` | `01-12N-15W` |

**Algorithm:**
1. Strip whitespace.
2. Uppercase.
3. Split on `-`. Expect exactly 3 parts.
4. Part 1: integer, zero-pad to 2 digits.
5. Part 2: must match regex `^\d{1,3}[NS]$`. Strip direction, zero-pad number to 2, append direction.
6. Part 3: must match regex `^\d{1,3}[EW]$`. Strip direction, zero-pad number to 2, append direction.
7. Reassemble with `-`.

Any value that does not parse is an **ingestion error**: it goes into the matching report with the raw value preserved, and the record is excluded from joins. No silent guessing.

### 2.2 County

**Canonical spellings** (exact case, no variations):

```
Caddo, Custer, Dewey, Ellis, Roger Mills, Washita
```

Algorithm: strip whitespace, title-case, match against canonical list. Unknown counties go to the matching report as ingestion errors.

(Other counties may appear in Oseberg downloads if Gib widens scope; this list is for the current package. Updating this list is a deliberate edit to `normalize.py`, not a silent allowance.)

### 2.3 Deal slug

The deal name as written in the Inventory Excel is preserved verbatim in a `deal_name` field. A `deal_slug` is computed for URL safety and deduplication:

**Algorithm:**
1. Lowercase.
2. Replace `&` with ` and `.
3. Replace `/` with ` `.
4. Strip leading/trailing whitespace.
5. Collapse internal whitespace to single hyphens.
6. Remove any character that is not `a-z`, `0-9`, or `-`.
7. Collapse consecutive hyphens to a single hyphen.

Examples:
| Raw | Slug |
|---|---|
| `OPITZ` | `opitz` |
| `Napier/McClung` | `napier-mcclung` |
| `J&A Deal` | `j-and-a-deal` |
| `Weston Pass` | `weston-pass` |
| `Allen Family ` | `allen-family` |

### 2.4 Status normalization

The Inventory's `STATUS` field is preserved verbatim as `status_raw`. A normalized `status_category` is computed.

**For mineral rows** (which have a `STATUS` column):

| Raw value contains | `status_category` |
|---|---|
| `LEASED` | `LEASED` |
| `HBP` | `HBP` |
| `OPEN` | `OPEN` |
| `Reg` (case-insensitive, e.g., "Reign Reg", "Crawley Reg") | `PENDING` |
| Anything else non-empty | `OTHER` |
| Empty / null | `OPEN` (default) |

Matching is case-insensitive substring containment, in the order shown (first match wins).

**For ORRI rows** (no `STATUS` column — see §4.4):

`status_raw` is always `null`. `status_category` is derived from the lease fields:

| Condition | `status_category` |
|---|---|
| `date_of_lease == "HBP"` AND `lease_expiration == "HBP"` | `HBP` |
| Both `date_of_lease` and `lease_expiration` are real dates | `NON_PRODUCING` |
| Any other combination (one date and one HBP, or one null) | `OTHER` (and added to ingestion errors for review) |

The `NON_PRODUCING` category covers ORRIs carved out of a base oil-and-gas lease where no producing well has been drilled yet. The ORRI's life is bound to the underlying lease — if the lessee does not drill before `lease_expiration`, the ORRI expires.

**Full enum:** `LEASED | HBP | OPEN | PENDING | OTHER | NON_PRODUCING`.

Front-end filters use `status_category`. Detail pages display `status_raw` so the regulatory context (which reg case) is not lost. For ORRIs, the detail page shows the derived category along with the lease dates rather than a status string.

---

## 3. Tract ID assignment

### 3.1 Format
- Mineral tracts: `Min001`, `Min002`, … `Min999`
- ORRI tracts: `OR001`, `OR002`, … `OR999`
- Separate ID spaces. The same numeric is fine across types (Min001 and OR001 are different records).

### 3.2 Initial assignment (first refresh)
Sort all mineral rows by:
1. County (canonical, alphabetical)
2. STR (canonical, lexicographic on the padded form)
3. Deal slug (alphabetical)

Then assign Min001 → Min{n} in order. Repeat independently for ORRI rows → OR001 → OR{n}.

The current Inventory yields (mineral preview):
| ID | County | STR | Deal |
|---|---|---|---|
| Min001 | Caddo | 16-11N-11W | MOORE |
| Min002 | Caddo | 25-11N-11W | OPITZ |
| Min003 | Custer | 05-12N-16W | RIVERS |
| Min004 | Custer | 17-12N-18W | GILMORE |
| Min005 | Custer | 17-12N-18W | TACKITT |
| … | | | |

### 3.3 Frozen ID rule
Once assigned, **an ID never changes and is never reused**.

- New tracts added in a future refresh receive the next unused number.
- Tracts removed from the package leave their ID gapped (it does not become available for reassignment).
- The ID-to-row mapping is persisted in `data-raw/inventory/id-registry.json`, hand-maintained-by-script:

```json
{
  "minerals": {
    "Min001": { "county": "Caddo", "str": "16-11N-11W", "deal_slug": "moore", "first_seen": "2026-05-19" },
    "Min002": { "county": "Caddo", "str": "25-11N-11W", "deal_slug": "opitz", "first_seen": "2026-05-19" }
  },
  "orri": {
    "OR001": { "county": "Custer", "str": "14-15N-20W", "row_hash": "a3f...", "first_seen": "2026-05-19" }
  },
  "retired": []
}
```

The refresh script:
1. Loads `id-registry.json`.
2. For each row in the current Inventory, looks up an existing ID by `(county, str, deal_slug)` for minerals or by `(county, str, row_hash)` for ORRI.
3. If found, reuses the ID.
4. If not found, assigns the next unused number and appends to the registry.
5. Rows present in the registry but absent from the current Inventory get moved to `retired` (their ID is not reassigned).

`id-registry.json` is **the only file in `data-raw/` that the script may write to.** It is the bookkeeping that makes Hard Rule #1 work in practice without freezing the IDs in stone outside any tracking system.

### 3.4 ORRI row identity
ORRI rows lack a "deal" field but have duplicates on the same STR with different decimals and dates. The `row_hash` is computed as a SHA-1 hex digest (first 8 chars) of `county|str|nra|dol|exp` where:

- `county` is the canonical county name.
- `str` is the canonical STR.
- `nra` is the NRA rounded to 4 decimals (per §1.2), formatted as a decimal string without trailing zeros (`0.5` not `0.5000`, `0.1667` not `0.166700`).
- `dol` and `exp` are either the literal string `"HBP"` or an ISO date (`YYYY-MM-DD`), or empty string if null.

That uniquely identifies an ORRI grant within the Inventory and lets the registry find the same grant across refreshes. Two grants on the same STR with NRA values that differ even slightly (e.g., `0.1666` vs `0.1667`) round to different 4-decimal values and therefore produce different row hashes.

---

## 4. `tracts.json`

The spine. Both asset types in one file, distinguished by `type`.

### 4.1 File structure
```json
{
  "generated_at": "2026-05-19T14:32:00Z",
  "source_inventory": "2026-05-19-inventory.xlsx",
  "tracts": [
    { ...tract object... },
    { ...tract object... }
  ]
}
```

### 4.2 Common fields (both types)

| Field | Type | Notes |
|---|---|---|
| `tract_id` | string | `Min001` or `OR001` |
| `type` | string enum | `"mineral"` or `"orri"` |
| `county` | string | Canonical name |
| `str` | string | Canonical STR |
| `township_range` | string | Derived: STR without section, e.g., `11N-11W` |
| `nra` | number | Net Royalty Acres, 4 decimals |
| `status_raw` | string \| null | Verbatim from Inventory (always `null` for ORRI — see §4.4) |
| `status_category` | string | Normalized: `LEASED|HBP|OPEN|PENDING|OTHER|NON_PRODUCING` |
| `lease_expiration` | string \| null | ISO date or `"HBP"` or `null` |
| `lat` | number \| null | Section centroid latitude (populated at Phase 7) |
| `lon` | number \| null | Section centroid longitude (populated at Phase 7) |
| `section_polygon` | array \| null | GeoJSON-style coords (populated at Phase 7) |
| `first_seen` | string | ISO date the tract first appeared in any refresh |

### 4.3 Mineral-only fields

| Field | Type | Notes |
|---|---|---|
| `deal_name` | string | Verbatim, e.g., `"Napier/McClung"` |
| `deal_slug` | string | Normalized slug |
| `nma` | number | Net Mineral Acres, 4 decimals |
| `royalty` | number \| null | Decimal, e.g., `0.1875` |
| `sales_per_nma` | number \| null | Asking price per NMA in whole dollars |
| `sales_per_nra` | number \| null | Asking price per NRA in whole dollars |
| `sales_revenue` | number \| null | Implied total ask for this tract |

### 4.4 ORRI-only fields

| Field | Type | Notes |
|---|---|---|
| `date_of_lease` | string \| null | ISO date or `"HBP"` |
| `row_hash` | string | The 8-char hash used in the registry |

**ORRI status handling clarification.** ORRI rows in the Inventory have no `STATUS` column — only `COUNTY, STR, NRA, DOL, EXP`. Therefore:

- `status_raw` is always `null` for ORRI tracts.
- `status_category` is derived from `date_of_lease` and `lease_expiration` per §2.4.
- `lease_expiration` for ORRI is taken from the Inventory's `EXP` column (the underlying base OGL's expiration). When the EXP cell is `"HBP"`, `lease_expiration` is the literal string `"HBP"`.

### 4.5 Example records

```json
{
  "tract_id": "Min005",
  "type": "mineral",
  "county": "Custer",
  "str": "17-12N-18W",
  "township_range": "12N-18W",
  "deal_name": "TACKITT",
  "deal_slug": "tackitt",
  "nma": 20.0,
  "royalty": 0.25,
  "nra": 40.0,
  "status_raw": "Reign Reg",
  "status_category": "PENDING",
  "lease_expiration": null,
  "sales_per_nma": 8000,
  "sales_per_nra": 4000,
  "sales_revenue": 160000,
  "lat": null,
  "lon": null,
  "section_polygon": null,
  "first_seen": "2026-05-19"
}
```

```json
{
  "tract_id": "OR014",
  "type": "orri",
  "county": "Roger Mills",
  "str": "16-12N-23W",
  "township_range": "12N-23W",
  "nra": 3.0,
  "status_raw": null,
  "status_category": "NON_PRODUCING",
  "date_of_lease": "2024-12-14",
  "lease_expiration": "2027-12-14",
  "row_hash": "a3f7c2b1",
  "lat": null,
  "lon": null,
  "section_polygon": null,
  "first_seen": "2026-05-19"
}
```

```json
{
  "tract_id": "OR001",
  "type": "orri",
  "county": "Custer",
  "str": "14-15N-20W",
  "township_range": "15N-20W",
  "nra": 3.2258,
  "status_raw": null,
  "status_category": "HBP",
  "date_of_lease": "HBP",
  "lease_expiration": "HBP",
  "row_hash": "b1d2e3f4",
  "lat": null,
  "lon": null,
  "section_polygon": null,
  "first_seen": "2026-05-19"
}
```

---

## 5. `wells.json`

Every well in the six Anadarko counties, regardless of whether it touches an owned tract. Wells are the join hub for permits, completions, and production.

### 5.1 File structure
```json
{
  "generated_at": "2026-05-19T14:32:00Z",
  "source": "oseberg-2026-05-19",
  "wells": [ ... ]
}
```

### 5.2 Well object

| Field | Type | Notes |
|---|---|---|
| `well_id` | string | Stable internal ID. Use API number with hyphens stripped if available, otherwise `okwell-{sha8}`. |
| `api_number` | string \| null | 14-digit API if known |
| `well_name` | string | Operator's well name |
| `operator` | string | Current operator (most recent in Oseberg) |
| `operator_history` | array | `[{ operator, effective_date }]`, most recent last |
| `county` | string | Canonical |
| `sections` | array of strings | All canonical STRs this well touches. Vertical wells have one; horizontals have multiple (e.g., `["08-12N-23W", "07-12N-23W"]`). |
| `well_status` | string | Oseberg's current status (PRODUCING, SHUT-IN, P&A, DRILLING, PERMITTED, etc.) |
| `well_type` | string | `OIL`, `GAS`, `OIL_GAS`, `INJECTION`, etc. |
| `spud_date` | string \| null | ISO |
| `completion_date` | string \| null | ISO; most recent if multiple |
| `lat` | number \| null | Surface location |
| `lon` | number \| null | Surface location |
| `matched_tract_ids` | array | Tract IDs whose STR appears in `sections`. Computed at refresh; empty for wells with no owned-tract overlap. |
| `oseberg_url` | string \| null | Deep link if available |

### 5.3 The horizontal-well join
For horizontal wells, `sections[]` carries every section the bore touches per Oseberg's records. A tract joins to a well if `tract.str ∈ well.sections`. The same well can match multiple tracts; the same tract can match multiple wells. The front-end displays this fairly.

---

## 6. `permits.json`

Drilling permits (OCC Form 1000 / W-1 equivalents).

### 6.1 Permit object

| Field | Type | Notes |
|---|---|---|
| `permit_id` | string | Stable, from Oseberg if available |
| `permit_number` | string | OCC permit number |
| `well_id` | string | Foreign key to `wells.json` |
| `permit_date` | string | ISO |
| `permit_type` | string | New drill, recompletion, etc. (Oseberg's category) |
| `operator` | string | At time of permit |
| `county` | string | Canonical |
| `sections` | array of strings | Canonical STRs |
| `matched_tract_ids` | array | Tracts whose STR appears in `sections` |
| `oseberg_url` | string \| null | |
| `raw` | object | Unmodified subset of source fields for reference |

The `raw` object pattern (also used in completions, production, leasing, regulatory) keeps original field names accessible without polluting the canonical schema. The front-end never displays `raw` directly; it's an audit/debug aid.

---

## 7. `completions.json`

Completion reports (OCC 1002A).

### 7.1 Completion object

| Field | Type | Notes |
|---|---|---|
| `completion_id` | string | |
| `well_id` | string | Foreign key |
| `completion_date` | string | ISO |
| `completion_type` | string | Initial, recomplete, refrac, etc. |
| `formation` | string \| null | Producing formation reported |
| `ip_oil_bbl` | number \| null | Initial production, oil |
| `ip_gas_mcf` | number \| null | Initial production, gas |
| `ip_water_bbl` | number \| null | |
| `lateral_length_ft` | number \| null | For horizontals |
| `proppant_lbs` | number \| null | |
| `fluid_bbl` | number \| null | |
| `county` | string | |
| `sections` | array of strings | |
| `matched_tract_ids` | array | |
| `oseberg_url` | string \| null | |
| `raw` | object | |

---

## 8. `production.json`

**Well-level monthly production.** Tract-level rollups are computed in the front-end (`app.js` exposes a `productionByTract(tract_id)` helper) rather than precomputed and stored — this avoids stale data drift and keeps the file size predictable.

### 8.1 File structure
Production can be a large file. Structure it as one array of well-month records:

```json
{
  "generated_at": "2026-05-19T14:32:00Z",
  "earliest_month": "2018-01",
  "latest_month": "2026-04",
  "records": [
    {
      "well_id": "ok-3504520123",
      "month": "2026-04",
      "oil_bbl": 1245.0,
      "gas_mcf": 8420.0,
      "water_bbl": 312.0,
      "days_on": 30
    }
  ]
}
```

### 8.2 Size guidance
At ~50 wells × 12 months × 8 years ≈ 5,000 records, file size is small (< 1 MB). If production scope expands to all wells in the six counties (likely thousands), revisit with possible per-well file splitting. **Flag to Gib at Phase 3 if the file exceeds 5 MB.**

### 8.3 Tract roll-up logic (front-end)
For a given tract, the front-end:
1. Looks up `wells` where `matched_tract_ids` includes the tract.
2. For each matched well, pulls its production records.
3. Sums by month. **Note:** this is a gross production sum across wells; the front-end labels charts as "gross production from wells touching this tract" — not "net production attributable to this tract", which would require decimal interest math the portal does not attempt.

This distinction matters and must be clearly labeled on the UI to avoid misleading buyers.

---

## 9. `leasing.json`

Every lease recorded in the six counties, with overlap flagging.

### 9.1 Lease object

| Field | Type | Notes |
|---|---|---|
| `lease_id` | string | |
| `lessor` | string | |
| `lessee` | string | |
| `recording_date` | string | ISO |
| `instrument_date` | string \| null | The signing date if distinct from recording |
| `term_years` | number \| null | |
| `royalty` | number \| null | Decimal |
| `bonus_per_acre` | number \| null | If reported |
| `acres` | number \| null | |
| `county` | string | Canonical |
| `sections` | array of strings | Canonical STRs covered by the lease |
| `affects_owned_tracts` | boolean | True if any owned tract's STR appears in `sections` |
| `matched_tract_ids` | array | |
| `oseberg_url` | string \| null | |
| `book_page` | string \| null | County recording reference if available |
| `raw` | object | |

### 9.2 Privacy / source note
Leasing records come from public county recordings via Oseberg. No editorial filtering — the portal shows the market activity as recorded. Lessor names are public information.

---

## 10. `regulatory.json`

Unified OCC actions stream. All types in one file with a `type` discriminator.

### 10.1 Action types
`POOLING_ORDER`, `SPACING_APPLICATION`, `SPACING_ORDER`, `LOCATION_EXCEPTION`, `HEARING_NOTICE`, `COMPLETION_REPORT`, `DRILLING_PERMIT`, `TOO_FILING`, `OTHER`.

### 10.2 Common action object

| Field | Type | Notes |
|---|---|---|
| `action_id` | string | |
| `type` | string enum | One of the above |
| `cause_number` | string \| null | OCC cause number (e.g., `CD-202500123`) |
| `filing_date` | string | ISO |
| `effective_date` | string \| null | For orders |
| `applicant` | string \| null | |
| `summary` | string | One-line description from Oseberg |
| `county` | string | Canonical |
| `sections` | array of strings | |
| `matched_tract_ids` | array | |
| `affects_owned_tracts` | boolean | Derived |
| `oseberg_url` | string \| null | **Deep link to the underlying application/order document** |
| `oseberg_url_requires_login` | boolean | Default true; the UI displays a "login required" cue |
| `raw` | object | |

### 10.3 Front-end treatment
The Activity page sorts by `filing_date` desc. Filters: type, county, affects-owned-tracts toggle. Each row links out to `oseberg_url` with a small lock icon when `oseberg_url_requires_login` is true.

---

## 11. `prices.json`

Manually edited. Tiny by design.

```json
{
  "as_of": "2026-05-19",
  "wti": {
    "close_usd": 78.42,
    "change_usd": 0.31,
    "change_pct": 0.0040
  },
  "henry_hub": {
    "close_usd_mmbtu": 3.18,
    "change_usd": -0.05,
    "change_pct": -0.0155
  },
  "source": "EIA daily spot",
  "updated_by": "manual"
}
```

`change_usd` and `change_pct` are vs. prior close. `scripts/update_prices.py` accepts `--wti`, `--henry-hub`, and `--date` flags and computes the deltas against the prior `prices.json`. Daily update is one command.

---

## 12. `meta.json`

Refresh bookkeeping and the matching report.

```json
{
  "generated_at": "2026-05-19T14:32:00Z",
  "inventory_file": "2026-05-19-inventory.xlsx",
  "oseberg_folder": "2026-05-19",
  "counts": {
    "tracts_mineral": 36,
    "tracts_orri": 52,
    "wells": 487,
    "permits": 23,
    "completions": 18,
    "production_records": 4682,
    "leases": 312,
    "regulatory_actions": 67
  },
  "matching_report": {
    "wells_with_owned_tract": 41,
    "wells_without_owned_tract": 446,
    "permits_with_owned_tract": 5,
    "leases_affecting_owned_tracts": 28,
    "regulatory_affecting_owned_tracts": 14,
    "ingestion_errors": [],
    "aggregate_cells_skipped": []
  },
  "id_registry": {
    "minerals_assigned": 36,
    "minerals_retired": 0,
    "orri_assigned": 52,
    "orri_retired": 0,
    "new_this_refresh": []
  }
}
```

`ingestion_errors` carries any unparseable STRs, unknown counties, or other anomalies for human review.

`aggregate_cells_skipped` records spreadsheet cells that the ingest deliberately ignored because they were aggregate calculations rather than row-level data. Each entry has the form:

```json
{
  "sheet": "Inventory 4 Sale",
  "cell": "I46",
  "value": 58.66067,
  "interpretation": "non-producing ORRI total NRA"
}
```

This protects against accidentally surfacing aggregate values as tract-level data, while preserving a paper trail.

---

## 13. Inventory archive convention

The Inventory Excel is a **living document** (Status and Lease Expiration change between refreshes). Convention:

- **Current file:** `data-raw/inventory/inventory-current.xlsx` — always the latest.
- **Archive:** before any refresh that replaces `inventory-current.xlsx`, the refresh script copies the existing file to `data-raw/inventory/archive/YYYY-MM-DD-inventory.xlsx` using the file's mtime date.
- The archive folder is the audit trail of what the package looked like at each refresh point.
- **Date collision handling:** if two refreshes land on the same mtime date, append a sequence suffix (`-2`, `-3`, …) rather than overwriting.

This is the **one exception** to Hard Rule #1 (data-raw/ read-only): the refresh script may copy *out of* and *into* the inventory archive folder, and replace `inventory-current.xlsx`. Oseberg downloads remain strictly read-only — each download goes to a dated subfolder and is never modified.

### 13.1 Inventory workbook layout (forward-protection)

This section documents the actual Inventory layout observed at first ingestion (2026-05-22). Refresh scripts should detect headers by content rather than hard-coded row numbers, but knowing the layout helps debugging.

- **Sheet name:** `Inventory 4 Sale` (one sheet only).
- **Row 4:** Totals row (NMA total, NRA total, sales revenue total in columns F, J, L). **Skip.**
- **Row 5:** Mineral header. Columns B–M: `COUNTY, DEAL, STR, TR, NMA, ROYALTY, STATUS, LEASE EXP, NRA, SALES PER NRA, SALES REVENUE, SALES PER NMA`.
- **Rows 6 onward:** Mineral data rows until the first row where `COUNTY` (column B) is empty.
- **Blank row(s):** separator between mineral and ORRI sections (currently 4 blank rows, but the script should tolerate 1+).
- **Next non-blank row:** ORRI header. Columns C–G: `COUNTY, STR, NRA, DOL, EXP`. (Note: ORRI starts in column C, not column B.)
- **Following rows:** ORRI data rows until end-of-sheet.
- **Trailing junk:** the last row may contain a single stray cell (e.g., a space character). Skip rows where the entire COUNTY column for the section is empty.
- **Aggregate-calculation cells:** column I may contain values outside the documented ORRI columns. These are Gib's spreadsheet-level summary calculations (total NRA × $/acre = projected sale value), not per-row data. The ingest script must detect and skip them, recording each in `meta.json.matching_report.aggregate_cells_skipped`.

If the layout shifts in a future refresh (e.g., a new column inserted), the script's header-detection logic should still find the sections; if it can't, it should fail loudly with a clear error rather than silently mis-mapping columns.

---

## 14. Matching report — purpose and use

Every refresh writes `meta.json` with a matching report. This is the **single most important QA artifact** in the system: it tells Gib at a glance whether the refresh worked.

Critical signals:
- `ingestion_errors` non-empty → something in the Inventory or Oseberg data is malformed.
- `wells_with_owned_tract` dropping refresh-to-refresh → a normalization rule probably broke.
- `regulatory_affecting_owned_tracts = 0` when prior refreshes had > 0 → suspicious; investigate.

The refresh orchestrator (`scripts/refresh_all.py`) prints the matching report to stdout at the end of every run. Gib reviews before committing.

---

## 15. Worked example — end-to-end trace of Min005 (TACKITT)

To make the joins concrete, here is one mineral tract followed through every relevant file. (All numbers illustrative for non-Inventory values.)

### In `tracts.json`
```json
{
  "tract_id": "Min005",
  "type": "mineral",
  "county": "Custer",
  "str": "17-12N-18W",
  "deal_name": "TACKITT",
  "deal_slug": "tackitt",
  "nma": 20.0,
  "royalty": 0.25,
  "nra": 40.0,
  "status_raw": "Reign Reg",
  "status_category": "PENDING",
  "sales_revenue": 160000
}
```

### In `wells.json`
Two horizontal wells cross Section 17:
```json
{
  "well_id": "ok-3503920771",
  "well_name": "REIGN 17-18 1H",
  "operator": "Reign Resources",
  "sections": ["17-12N-18W", "08-12N-18W"],
  "matched_tract_ids": ["Min004", "Min005"]
}
```
Both Min004 (GILMORE) and Min005 (TACKITT) attach to this well because they share STR 17-12N-18W.

### In `permits.json`
```json
{
  "permit_id": "occ-2025-019442",
  "well_id": "ok-3503920771",
  "permit_date": "2025-11-08",
  "matched_tract_ids": ["Min004", "Min005"]
}
```

### In `production.json`
```json
{ "well_id": "ok-3503920771", "month": "2026-04", "oil_bbl": 4210, "gas_mcf": 18750 }
```
Front-end rolls this up under Min005's "wells touching this tract" production chart.

### In `regulatory.json`
The "Reign Reg" status traces back to a pooling matter:
```json
{
  "action_id": "occ-pool-2024-11823",
  "type": "POOLING_ORDER",
  "cause_number": "CD-202411823",
  "filing_date": "2024-09-14",
  "applicant": "Reign Resources",
  "summary": "Application to pool Section 17-12N-18W, Custer County",
  "sections": ["17-12N-18W"],
  "matched_tract_ids": ["Min004", "Min005"],
  "affects_owned_tracts": true,
  "oseberg_url": "https://app.oseberg.io/oklahoma/regulatory/CD-202411823",
  "oseberg_url_requires_login": true
}
```

### On the Min005 detail page
The buyer sees:
1. Tract header: Min005, Custer, 17-12N-18W, TACKITT, 20 NMA, 0.25 royalty, status "Reign Reg" (PENDING), asking $160,000.
2. **Wells:** REIGN 17-18 1H and any others touching Section 17.
3. **Recent activity:** the pooling order, the drilling permit, the completion — each linking to Oseberg.
4. **Production:** chart of monthly gross production across wells touching Section 17, with the disclaimer that this is well-level gross production, not net to the tract.
5. **Note that Min004 (GILMORE) shares this section** — cross-link.

That last cross-link is a nice buyer touch and worth building.

---

## 16. Open items deferred to later phases

These are noted here so the schema can accommodate them without rework:

- **Section centroid lat/lon and section polygon GeoJSON** — fields reserved, populated at Phase 7 from open BLM/Oklahoma PLSS data.
- **Decimal interest calculations** (net production to tract owner) — not in v1. Schema does not preclude adding later.
- **Per-well economic projections** — not in v1.
- **Multi-package support** (if Gib runs another sale alongside this one) — would require a `package_id` field on tracts. Not added now; would be a v2 migration.
- **Aggregate package valuation surface** — the ORRI aggregate cells captured in `meta.json.matching_report.aggregate_cells_skipped` could power a "package valuation summary" on the index page. Not in this phase's scope.

---

## End of Spec
