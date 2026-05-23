# Data Model Specification — Oklahoma Mineral & ORRI Portal

**Version:** 2026-05-22 (supersedes 2026-05-19)
**Status:** Authoritative. Claude Code must conform to this spec exactly. Schema changes require explicit approval and an updated version of this document.

**Change log from 2026-05-19:**
- §2.4 — added ORRI-specific rule deriving `status_category` from lease fields; introduced `NON_PRODUCING` category.
- §4.4 — clarified that ORRI rows have no `STATUS` column; `status_raw` is always `null`; `status_category` is derived.
- §12 — added `aggregate_cells_skipped` to `meta.json.matching_report`.
- §13.1 — new section documenting the actual Inventory workbook layout for forward-protection of refresh scripts.

**In-place additions (Phase 3 prep, same 2026-05-22 date):**
- §5.4 — new section documenting how `sections[]` is derived from `Surface Hole Legal` and `Bottom Hole Legal` in the Oseberg wells export, the known long-horizontal limitation, and the long-lateral flagging convention.
- §5.5 — new section documenting the actual `wells_wab.xlsx` columns observed at first ingestion.
- §12 — added `wells_long_laterals_flagged` to `meta.json.matching_report` for the long-horizontal hit-list.

**In-place additions (Phase 4 prep, same 2026-05-22 date):**
- §6 — clarified that `well_id` may be `null` for permits with no API number assigned yet.
- §7 — renamed `ip_oil_bbl`/`ip_gas_mcf`/`ip_water_bbl` → `ip_oil_bopd`/`ip_gas_mcfpd`/`ip_water_bwpd` to reflect Oseberg gives daily rates not totals.
- §8 — **major rewrite.** Production is now lease-level lifetime summaries (one record per active lease), not monthly well-records. Reflects the actual shape of Oseberg's `production_wab.xlsx`. Front-end roll-up logic in §8.3 simplified to cumulative + recent-month per lease touching the tract.
- §9.3 — new section. Two output files: `leasing.json` carries owned-tract-affecting leases (small, default-loaded); `leasing_market.json` carries the full WAB market set (loaded on demand).
- §10 — added `POOLING_APPLICATION` and `SPACING_APPLICATION` to the type enum; documented that `oseberg_url` is currently `null` for OCC regulatory records (no URL field in the Oseberg exports).
- §12 — added `permits_affecting_owned_tracts`, `completions_affecting_owned_tracts`, `production_affecting_owned_tracts`, and `leasing_market_count` to `matching_report`.

**In-place additions (post-Phase-7 inventory schema upgrade, same 2026-05-22 date):**
- §2.4 — dropped the `"Reg" → PENDING` mineral rule. The inventory's STATUS column is now clean (`LEASED | HBP | OPEN`); regulatory state is captured in its own column. Anything containing `Reg` that still appears in STATUS now falls through to `OTHER`.
- §4.3 — added mineral fields: `lease_url` (county-records hyperlink embedded in the STATUS cell when LEASED), `regulatory_status` (text from the new REGULATORY column), `regulatory_url` (Oseberg hyperlink embedded in that cell), `notes` (free text from the new Notes column).
- §4.4 — added the same `regulatory_status` / `regulatory_url` / `notes` fields to ORRI tracts. ORRI tracts do not carry `lease_url` (no STATUS column in the ORRI section).
- §13.1 — updated mineral header to reflect the inserted columns (H=STATUS, I=REGULATORY, J=Notes, K=LEASE EXP, L=NRA, M=SALES PER NRA, N=SALES REVENUE, O=SALES PER NMA). Aggregate-valuation cells moved from column I to column K (K46–K48 non-HBP; K91–K93 HBP). The ORRI header was extended with `REGULATORY` (col I) and `Notes` (col J).

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

ORRI rows lack a "deal" field but have duplicates on the same STR with different decimals and dates. The `row_hash` is computed as a SHA-1 hex digest (first 8 chars) of `county|str|nra|dol|exp` (the **identity tuple**) where:

- `county` is the canonical county name.
- `str` is the canonical STR.
- `nra` is the NRA rounded to 4 decimals (per §1.2), formatted as a decimal string without trailing zeros (`0.5` not `0.5000`, `0.1667` not `0.166700`).
- `dol` and `exp` are either the literal string `"HBP"` or an ISO date (`YYYY-MM-DD`), or empty string if null.

Two grants on the same STR with NRA values that differ even slightly (e.g., `0.1666` vs `0.1667`) round to different 4-decimal values and therefore produce different row hashes.

**Occurrence-counter tiebreaker (added 2026-05-23).** Real inventories carry multiple ORRI grants from different lessors that happen to share an identical identity tuple — e.g., four separate `0.33334 NRA` grants on `7-12N-23W` with identical lease dates. Each of those rows is a distinct ORRI grant, not a duplicate of the same grant. To preserve one tract_id per source row:

- The **first occurrence** of any identity tuple (in the inventory's natural row order) uses the original 5-field hash key: `county|str|nra|dol|exp`. Its row_hash is unchanged from earlier versions of this spec, so existing IDs assigned to first occurrences remain frozen per §3.3.
- The **2nd, 3rd, …** occurrence of the same identity tuple appends an occurrence counter (1-indexed: `1`, `2`, …) to the hash key: `county|str|nra|dol|exp|1`, `county|str|nra|dol|exp|2`, etc. Each yields a fresh row_hash and therefore a fresh tract_id from the registry.

The occurrence count is determined per inventory file at ingest time by traversing ORRI rows top-to-bottom and maintaining a counter keyed by the 5-field identity tuple. As long as the row order in the Excel doesn't shuffle, the counter assignments are stable across refreshes.

If Gib later rearranges ORRI rows such that what used to be the "first occurrence" is no longer first, that earlier-first-now-second row would acquire a new row_hash and be assigned a new tract_id (with the original ID retired). To avoid that, the row order of ORRI grants in the inventory should be treated as part of the identity model — once a row is positioned, don't move it within its group.

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
| `sales_per_nra` | number \| null | Owner-assigned valuation rate, $/NRA. Per Gib's pricing: `3500` for HBP ORRIs (producing today), `1500` for NON_PRODUCING ORRIs (non-producing; held by underlying OGL). `null` for any ORRI with a non-standard status_category. |
| `sales_revenue` | number \| null | `nra × sales_per_nra`, rounded to whole dollars. `null` if either input is missing. |

The ORRI `sales_per_nra` and `sales_revenue` fields are the line-item complement to the aggregate valuation cells (I47/I48 for non-HBP totals; I92/I93 for HBP totals) the inventory carries in column I. The aggregate cells are still captured in `meta.json.matching_report.aggregate_cells_skipped` as Gib's documented per-acre assumptions; the tract-level fields make per-tract asking visible to buyers in the tract list, tract detail pages, and package-level rollups. If Gib later updates either per-acre rate, the canonical place to change it is the constants in `scripts/ingest_inventory.py` (one location, two values).

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

### 5.4 How `sections[]` is computed from the Oseberg wells export

The Oseberg `wells_wab.xlsx` export **does not contain an explicit "sections-touched" column.** No `Spacing Unit`, `Section Footages`, `Survey Footages`, or `Completion Sections` field is present. The only section-bearing fields are two endpoints:

- `Surface Hole Legal` — the section where the wellbore enters the ground.
- `Bottom Hole Legal` — the section where the wellbore terminates.

Both values come in the form `SS-TTd-RRd-IM` (the `-IM` suffix is the Indian Meridian — Oklahoma's principal meridian). The ingest script strips the meridian suffix and normalizes the remainder via `normalize_str()`.

**`sections[]` is computed as:**

```
sections = sorted(unique({ normalize_str(strip_meridian(SHL)),
                            normalize_str(strip_meridian(BHL)) }) - {None})
```

For vertical wells (or wells with unknown profile where SHL == BHL), `sections[]` has 1 entry. For horizontals where the lateral starts and ends in different sections, `sections[]` has 2 entries.

**Known limitation — long horizontals miss intermediate sections.** A long lateral (e.g., 10,000+ ft / ~2 miles) can physically cross 3 or more sections, but only the two endpoint sections will appear in `sections[]`. A tract sitting in a middle section that the lateral physically crosses will **not** match such a well via the endpoint-based logic.

This is acceptable for v1 because:
- The vast majority (>95%) of horizontals in the WAB have laterals ≤ 10,560 ft and fit within 2 sections.
- The proper fix requires PLSS section polygons + the actual lateral line geometry, which is deferred to Phase 8 (map).

**Long-lateral flagging.** During Phase 3 ingestion, any well with `Lateral Length (Ft) ≥ 5,280` (one mile — the length at which a lateral can cross more than 2 sections) is appended to `meta.json.matching_report.wells_long_laterals_flagged` as a hit-list to revisit at Phase 8. Each entry records the `well_id`, `lateral_length_ft`, `surface_section`, `bottom_hole_section`, and `operator` so the gap can be diagnosed when the map phase lands.

**Data quality fallback.** If `Surface Hole Legal` is missing or unparseable (e.g., one well in the 2026-05-22 export has the literal string `L. LANDAUER` in the meridian slot — clearly a data entry error), the well is still included in `wells.json` with `sections[]` containing whatever endpoint(s) did parse cleanly. The unparseable value is captured in `meta.json.matching_report.ingestion_errors`. A well with both SHL and BHL unparseable gets `sections: []` and cannot match any owned tract.

### 5.5 Wells export layout — forward-protection

The 2026-05-22 Oseberg `wells_wab.xlsx` has one sheet (`Sheet 1`) with 67 columns. The columns the ingest uses, by name:

| Spec field | Oseberg column |
|---|---|
| `well_id` | `API Number` (10-digit, hyphens already absent) |
| `api_number` | `API Number 12 Digit` |
| `well_name` | `Well Name` |
| `operator` | `Operator` |
| `operator_history` | `[{operator: Operator, effective_date: null}, {operator: Original Operator, effective_date: null}]` (deduped if same; no full history dates in this export) |
| `county` | `County` (normalized via `normalize_county()`) |
| `well_status` | `Well Status` |
| `well_type` | `Well Type` |
| `spud_date` | `Spud Date` |
| `completion_date` | `Latest Completion Date` |
| `lat` | `Surface Latitude` |
| `lon` | `Surface Longitude` |
| `sections` | derived from `Surface Hole Legal` + `Bottom Hole Legal` per §5.4 |
| `oseberg_url` | `State URL` (deep link to OCC well record) |

Additional Oseberg columns that carry summary data already joined in from permits/completions/production (`Latest Permit Date`, `Earliest Completion Date`, `Latest Completion IP Oil`, `Cumulative Oil`, `First Production Date`, etc.) are **deliberately ignored** in `wells.json` — those line items belong in their dedicated JSON files (`permits.json`, `completions.json`, `production.json`) built from the dedicated Oseberg exports.

**County filtering.** The Oseberg export may include wells outside the six WAB counties (the 2026-05-22 export carries 128 wells across Blaine, Canadian, Major, Beckham, Wheeler). Per CLAUDE.md §2 (Oklahoma-only WAB scope), the ingest filters to the six canonical counties and reports the dropped count in `meta.json.matching_report.wells_dropped_out_of_scope`.

---

## 6. `permits.json`

Drilling permits (OCC Form 1000 / W-1 equivalents).

### 6.1 Permit object

| Field | Type | Notes |
|---|---|---|
| `permit_id` | string | Stable, from Oseberg if available; derived `permit-{permit_number}` or `permit-{county}-{filed_date}-{idx}` fallback |
| `permit_number` | string \| null | OCC / BLM permit number (Oseberg's `Drilling Permit Num`) |
| `well_id` | string \| null | Foreign key to `wells.json`. **May be `null`** for permits with no API number assigned yet (e.g., permit filed but well not yet spudded). |
| `permit_date` | string | ISO. Oseberg's `Filed Date`. |
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
| `ip_oil_bopd` | number \| null | Initial production, oil — **daily rate** (barrels of oil per day), not total |
| `ip_gas_mcfpd` | number \| null | Initial production, gas — **daily rate** (Mcf of gas per day), not total |
| `ip_water_bwpd` | number \| null | Initial production, water — **daily rate** (barrels of water per day) |
| `lateral_length_ft` | number \| null | For horizontals — from Oseberg's `Bottom Hole Total Length` |
| `proppant_lbs` | number \| null | |
| `fluid_bbl` | number \| null | |
| `county` | string | |
| `sections` | array of strings | |
| `matched_tract_ids` | array | |
| `oseberg_url` | string \| null | |
| `raw` | object | |

---

## 8. `production.json`

**Lease-level lifetime summaries.** Each record represents one producing lease unit's lifetime production stats (cumulative volumes, recent-month rates, IP figures, decline rate). This reflects the shape of Oseberg's `production_wab.xlsx` export, which delivers aggregated summary data per lease rather than per-well-per-month time series.

This is the **single most important file for demonstrating HBP (Held By Production) status** — any lease with a recent `last_prod_date` and meaningful `cumulative_oil_bbl + cumulative_gas_mcf` is currently producing and therefore holding its underlying lease.

### 8.1 File structure
```json
{
  "generated_at": "2026-05-22T14:32:00Z",
  "source": "oseberg-2026-05-22",
  "production": [
    { ...lease production object... },
    { ...lease production object... }
  ]
}
```

### 8.2 Lease production object

| Field | Type | Notes |
|---|---|---|
| `production_id` | string | Stable internal ID. `lease-{lease_number}` if `lease_number` present, otherwise `lease-{county}-{legal_canonical}-{operator_slug}` |
| `lease_name` | string \| null | Oseberg `Lease Name` |
| `lease_number` | string \| null | Oseberg `Lease Number` (also stored as `lease_unit_id`) |
| `api_numbers` | array of strings | All API numbers associated with this lease. Oseberg stores these as a semicolon-separated string in one cell; the ingest script splits on `;` and trims. |
| `well_ids` | array of strings | Same as `api_numbers` — kept for compatibility with the spec §5 `well_id` foreign-key pattern. |
| `operator` | string \| null | Current operator |
| `county` | string | Canonical |
| `legal_raw` | string \| null | The Oseberg `Legal` field verbatim (e.g., `22-10N-11W-IM`) |
| `sections` | array of strings | Canonical STRs derived from `legal_raw` (with meridian suffix stripped, normalized via `normalize_str()`). Single section per lease in this export. |
| `reservoir_name` | string \| null | |
| `field_name` | string \| null | |
| `active_date` | string \| null | ISO. Oseberg `Active Date` — when the lease unit became active. |
| `first_prod_date` | string \| null | ISO. Oseberg `First Prod Date`. |
| `last_prod_date` | string \| null | ISO. **Most important freshness signal** — recent date here means the lease is actively producing today. |
| `latest_completion_date` | string \| null | ISO |
| `number_of_months_producing` | number \| null | Total months with production reported |
| `number_of_completions` | number \| null | |
| `cumulative_oil_bbl` | number \| null | Lifetime cumulative oil, barrels |
| `cumulative_gas_mcf` | number \| null | Lifetime cumulative gas, Mcf |
| `last_month_oil_bopm` | number \| null | Most recent month's oil production (barrels of oil per month) |
| `last_month_gas_mcfpm` | number \| null | Most recent month's gas production (Mcf per month) |
| `month_over_month_oil` | number \| null | Delta vs prior month (BOPM) |
| `month_over_month_gas` | number \| null | Delta vs prior month (MCFPM) |
| `year_over_year_oil` | number \| null | Delta vs same month prior year (BOPM) |
| `year_over_year_gas` | number \| null | |
| `avg_last_12_month_oil_bopm` | number \| null | Average over the last 12 months |
| `avg_last_12_month_gas_mcfpm` | number \| null | |
| `sum_last_12_month_oil_bopm` | number \| null | Sum over the last 12 months (barrels) |
| `sum_last_12_month_gas_mcfpm` | number \| null | Sum over the last 12 months (Mcf) |
| `best_30_oil_bopm` | number \| null | Best single-30-day window (oil) |
| `best_30_gas_mcfpm` | number \| null | Best single-30-day window (gas) |
| `ip30_oil_bopd` / `ip30_gas_mcfpd` | number \| null | 30-day initial production, daily rate |
| `ip60_oil_bopd` / `ip60_gas_mcfpd` | number \| null | 60-day IP |
| `ip90_oil_bopd` / `ip90_gas_mcfpd` | number \| null | 90-day IP |
| `first_completion_ip_oil` / `_gas` / `_water` | number \| null | Reported IP at first completion |
| `latest_completion_ip_oil` / `_gas` / `_water` | number \| null | Reported IP at most recent completion |
| `decline_rate_oil` | number \| null | Annual decline rate, decimal (e.g., 0.45 = 45%/yr) |
| `decline_rate_gas` | number \| null | |
| `lateral_length_sum_ft` | number \| null | Sum of all wells' lateral lengths on this lease |
| `gross_acres` | number \| null | Lease acreage |
| `is_active` | boolean | Derived: `last_prod_date` within 12 months of `generated_at` |
| `matched_tract_ids` | array | Tract IDs whose STR appears in `sections` |
| `affects_owned_tracts` | boolean | Derived |
| `raw` | object | Unmapped Oseberg columns (decline rate detail, tax rate, split percentage, etc.) |

### 8.3 Tract roll-up logic (front-end)

For a given tract, the front-end:
1. Looks up `production` records where `matched_tract_ids` includes the tract OR where the tract's STR appears in `sections`.
2. For each matched lease, displays: lease name, operator, cumulative oil/gas, last-month production, last-12-month average, decline rate, lateral length.
3. **Aggregate header (optional):** sums cumulative oil + gas across all leases touching this tract for a single-number "production touching this section" headline.

**Important labeling.** As with the prior wells-based design, this is **gross production from leases touching the section**, not net to the tract owner. The UI must say so. Decimal interest math is out of scope per Hard Rule #5.

### 8.4 Source-format note (forward-protection)

The `production_wab.xlsx` export observed at first ingestion is **lease-level aggregate**, not month-level. If a future Oseberg refresh delivers true month-level production data (separate file or schema change), it would be added as a sibling `production_monthly.json` rather than replacing this schema. Spec §8 would extend at that point.

### 8.5 Size guidance
At ~8,000 lease records × ~30 fields ≈ 5 MB. **Flag to Gib if production.json exceeds 10 MB.** If size becomes a concern, filtering to `affects_owned_tracts == true` is the obvious lever — though the buyer story benefits from showing nearby market activity, not just owned-section production.

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

### 9.3 Dual-file output (size management)

The Oseberg `leasing_wab.xlsx` export is large (43,704 rows at first ingestion). Loading the full dataset into a static page on every visit is wasteful. The ingest produces two files:

- **`data/leasing.json`** — leases where `affects_owned_tracts == true`. Loaded by default on all portal pages. Typically a few hundred rows.
- **`data/leasing_market.json`** — the full WAB market set, including leases that don't touch owned tracts. Loaded on demand when a buyer clicks "show all market leasing activity" on the Activity page.

Both files use the same lease object schema (§9.1). The `meta.json.counts.leases` counts the owned-affecting set; `meta.json.matching_report.leasing_market_count` counts the full market set.

This pattern (default-small + on-demand-full) is the size-management lever for any other future activity stream that grows past comfortable load.

---

## 10. `regulatory.json`

Unified OCC actions stream. All types in one file with a `type` discriminator.

### 10.1 Action types
`POOLING_APPLICATION`, `POOLING_ORDER`, `SPACING_APPLICATION`, `SPACING_ORDER`, `LOCATION_EXCEPTION`, `HEARING_NOTICE`, `COMPLETION_REPORT`, `DRILLING_PERMIT`, `TOO_FILING`, `OTHER`.

**Source mapping** (Phase 4 ingest):
- `pooling_wab.xlsx` → `POOLING_APPLICATION` when `App or Order = "App"`; `POOLING_ORDER` when `App or Order = "Order"`.
- `spacing_wab.xlsx` → `SPACING_APPLICATION` / `SPACING_ORDER` analogous.
- `le_wab.xlsx` (location exceptions) → `LOCATION_EXCEPTION` (with sub-distinction in `raw.app_or_order` for applications vs orders).

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
| `oseberg_url` | string \| null | **Deep link to the underlying application/order document.** Currently `null` for all records — the Oseberg `pooling_wab.xlsx`, `spacing_wab.xlsx`, and `le_wab.xlsx` exports do not carry a URL column. To be populated when the URL construction pattern (from cause number) is confirmed. |
| `oseberg_url_requires_login` | boolean | Default `true`; the UI displays a "login required" cue when URL is present. |
| `raw` | object | Includes `app_or_order` for pooling/spacing distinction; all unmapped source columns. |

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
    "wells_dropped_out_of_scope": 128,
    "wells_long_laterals_flagged": [],
    "permits_with_owned_tract": 5,
    "permits_affecting_owned_tracts": 5,
    "completions_affecting_owned_tracts": 3,
    "production_affecting_owned_tracts": 12,
    "leases_affecting_owned_tracts": 28,
    "leasing_market_count": 43704,
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

`wells_dropped_out_of_scope` counts wells in the Oseberg export that were filtered out because their county is not in the canonical six-county WAB list. The dropped wells are not preserved individually; the count alone is enough for sanity-checking.

`wells_long_laterals_flagged` carries the hit-list of horizontals long enough (≥ 5,280 ft) to potentially cross more than 2 sections — i.e., wells where the endpoint-based `sections[]` may undercount actual coverage. Each entry has the form:

```json
{
  "well_id": "3512900014",
  "lateral_length_ft": 10149,
  "surface_section": "03-13N-22W",
  "bottom_hole_section": "34-14N-22W",
  "operator": "..."
}
```

This is the diagnostic list to revisit when Phase 8 (map) adds true lateral-line-vs-section-polygon intersection.

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
