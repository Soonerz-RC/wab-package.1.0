# CLAUDE.md — WAB Package 1.0

> When this file is placed in the repo root, its filename must be exactly `CLAUDE.md`. Claude Code reads it automatically at the start of every session.

> **Version:** 2026-05-21. Supersedes earlier drafts (2026-05-19 CLAUDE.md and 2026-05-19 CLAUDE-amended.md). Reflects final naming: GitHub repo `wab-package.1.0`, local folder `/Users/gibber/Downloads/Claude_Dev/wab-package.1.0/`, project name `wab-package.1.0`.

---

## 1. Project purpose

This repo builds a static, link-gated data room for buyers evaluating the **WAB Package 1.0** — a mineral and ORRI package in the Western Anadarko Basin owned by GBK International Group, Ltd. (Oklahoma Minerals).

The "WAB Package 1.0" name reflects an intentional versioning model: future packages assembled from different underlying assets will follow as WAB Package 2.0, 3.0, and so on. Each package gets its own repo (`wab-package.2.0`, etc.) cloned from this one as a template. The architecture should be portable enough to support that without modification.

The portal must:

- Present the package cleanly, tract by tract, with the credibility a buyer expects.
- Surface OCC permit, completion, production, leasing, and regulatory activity tied to the legals where assets are owned.
- Display a daily-updated WTI and Henry Hub closing price block.
- Be regenerable from raw Oseberg data every 14–30 days during the sale process, with minimal manual intervention.

The portal is **for sale-process use**. It is not a production application. Optimize for clarity, durability, and ease of refresh — not for features.

---

## 2. Owner & business context

- **Owner:** Gib, ~45 years oil and gas industry experience; deep expertise in mineral title, OCC processes, and non-operated working interests.
- **Companies:** GBK International Group, Ltd. (parent); Oklahoma Minerals (DBA); TPC Minerals LLC (partner entity).
- **Broader business operational areas:** Anadarko Basin — Washita, Custer, Roger Mills, Caddo, Dewey, Ellis counties (Oklahoma); Panola County (Texas).
- **Portal scope for WAB 1.0:** **Oklahoma only.** The package being sold consists of tracts in the six Anadarko counties listed above. Texas tracts are not in scope for v1. The data model is designed so Texas (or any other state) could be added later without schema migration, but no Texas data should appear in any JSON file this portal produces.
- **Brand:** navy / gold, consistent with oklahomaminerals.com.
- **Distribution model:** Private Netlify URL shared directly with vetted buyers. No password gate; security is via link obscurity. Gib controls the process and deals with buyers directly.

---

## 3. Hard rules — never violate

1. **`data-raw/` is read-only — with two narrowly defined exceptions.** Never modify, rename, or delete files in this folder. It holds the master Inventory Excel and Oseberg downloads. Treat it as evidence of record. **The two exceptions, both authorized by the data model spec, are:**
   - **Inventory living-document pattern.** `data-raw/inventory/inventory-current.xlsx` is replaced when Gib provides an updated Inventory. Before replacement, the refresh script archives the prior version to `data-raw/inventory/archive/YYYY-MM-DD-inventory.xlsx` based on the file's mtime. Oseberg downloads remain strictly read-only and are never modified or moved.
   - **ID registry.** `data-raw/inventory/id-registry.json` is updated by `scripts/ingest_inventory.py` to record newly assigned tract IDs and retired tracts. This is the bookkeeping that enforces frozen IDs. No other file in `data-raw/` may be written.

2. **`data/` is generated output.** Never hand-edit JSON in `data/`. It is regenerated entirely by scripts in `scripts/`. If a value looks wrong, fix the source data or the script — never the JSON. The one exception is `data/prices.json`, which is updated by `scripts/update_prices.py` via command-line flags, not by editing the file directly.

3. **Never invent numbers.** Every figure on the portal must trace to `data-raw/`. If source data is missing for a field, leave it blank or null. Do not estimate, interpolate, or backfill from general knowledge.

4. **Match activity records by normalized `STR + county`.** Permits, completions, production, leasing, and regulatory records join to tracts via this normalized key, defined in spec §2. A single record can match multiple tracts when several deals share a section (e.g., a permit on `17-12N-18W` matches both Min004 GILMORE and Min005 TACKITT). Both sides of the join must pass through `scripts/normalize.py` before comparison. The deal-level uniqueness rule applies to **tract identity assignment**, not to activity matching.

5. **Production is gross, not net.** The portal shows gross well-level production summed across wells touching a tract. Do not implement net-to-tract decimal interest math — it is explicitly out of scope for v1 and would require assumptions the portal does not make. The UI must label this clearly per spec §8.3. If Gib later requests net production, treat it as a scope change and propose a plan before implementing.

6. **Confirm before destructive actions.** Before deleting, overwriting, or renaming any existing file (except the two carve-outs in Rule #1), show what will change and wait for explicit confirmation from Gib.

7. **Stay within the project folder.** Never modify files outside the `wab-package.1.0/` project folder unless explicitly asked.

8. **No autonomous sprints.** Do not chain multiple roadmap phases in one session. One phase at a time, with approval between.

---

## 4. Working preferences

- **Context first.** Before starting any task, state what additional context would help and ask any questions needed to be sure of the instructions.
- **Plan-then-approve.** For any multi-step task, outline the plan first and wait for approval before executing.
- **Step summaries.** After each major step, briefly state what was done and what's next.
- **End-of-task file list.** End every task with a list of files created or modified, with absolute paths.
- **File naming for new documents and dated artifacts:** `YYYY-MM-DD-descriptive-kebab-case-name.ext`. Code files in `scripts/` and `site/` follow standard project conventions (no date prefix — these are living project files, not dated artifacts).
- **Brevity over flourish.** Gib is technically literate but not a programmer. Explanations should be clear and concrete; avoid jargon when plain English works.

---

## 5. Tech stack — locked

| Layer | Choice | Notes |
|---|---|---|
| Front-end markup | Standalone HTML | One file per page; no SPA. |
| Front-end styling | Plain CSS in `site/styles.css` | No Tailwind compiler, no SASS, no PostCSS. |
| Front-end scripting | Vanilla JavaScript (ES2020+) | No React, Vue, Svelte, or any framework. No build step. |
| Charts | Chart.js via CDN | Matches Gib's existing dashboard pattern. |
| Map (Phase 8) | Leaflet via CDN + OpenStreetMap tiles | Free, no API key. PLSS section overlays from open BLM data. |
| Backend | None | Site is static. |
| Data processing | Python 3.11+ | Always run inside a venv at `.venv/` (gitignored). |
| Required Python libs | `pandas`, `openpyxl` | Pin all dependencies in `requirements.txt`. Add `geopandas`/`shapely` only at map phase. |
| Hosting | Netlify | Auto-deploy from connected GitHub repo. |
| Version control | Git / GitHub | Remote: `https://github.com/Soonerz-RC/wab-package.1.0.git`. Commit after each completed phase with a descriptive message. |

**Forbidden without explicit approval:** Node/npm tooling, build pipelines, databases, runtime API calls from the site, any framework that requires compilation.

---

## 6. Repo structure

```
wab-package.1.0/
├── CLAUDE.md                    ← this file
├── README.md                    ← human-facing project overview
├── .gitignore                   ← ignores .venv/, __pycache__, .DS_Store
├── requirements.txt             ← pinned Python deps
│
├── docs/                        ← foundation documents and notes
│   ├── 2026-05-19-data-model-spec.md   ← historical; superseded by 2026-05-22
│   ├── 2026-05-22-data-model-spec.md   ← CURRENT spec
│   ├── 2026-05-21-build-roadmap.md
│   └── 2026-05-21-starter-prompt.md
│
├── data-raw/                    ← READ-ONLY inputs (see Hard Rule #1 for carve-outs)
│   ├── inventory/
│   │   ├── inventory-current.xlsx       ← living document, replaced each refresh
│   │   ├── id-registry.json             ← maintained by ingest_inventory.py
│   │   └── archive/                     ← prior inventory versions, dated
│   │       └── YYYY-MM-DD-inventory.xlsx
│   └── oseberg/                 ← Oseberg downloads, dated subfolders, strictly read-only
│       ├── 2026-05-21/
│       └── ...
│
├── data/                        ← GENERATED JSON the site reads (see Hard Rule #2)
│   ├── tracts.json
│   ├── wells.json
│   ├── permits.json
│   ├── completions.json
│   ├── production.json
│   ├── leasing.json
│   ├── regulatory.json
│   ├── prices.json              ← updated by update_prices.py only
│   └── meta.json                ← refresh timestamp, source files, matching report
│
├── scripts/                     ← Python that transforms data-raw → data
│   ├── normalize.py             ← STR/county/deal/status normalization (the single authority)
│   ├── ingest_inventory.py
│   ├── ingest_oseberg_wells.py
│   ├── ingest_oseberg_permits.py
│   ├── ingest_oseberg_completions.py
│   ├── ingest_oseberg_production.py
│   ├── ingest_oseberg_leasing.py
│   ├── ingest_oseberg_regulatory.py
│   ├── refresh_all.py           ← orchestrator
│   └── update_prices.py         ← daily one-shot
│
└── site/                        ← static front-end deployed to Netlify
    ├── index.html               ← package overview, headline metrics, price block
    ├── tracts.html              ← sortable / filterable tract list
    ├── tract.html               ← per-tract detail (driven by ?id= query param)
    ├── activity.html            ← regulator and leasing activity feed
    ├── styles.css
    ├── app.js                   ← shared JS: data loading, rendering helpers
    └── assets/                  ← logo, icons, images
```

---

## 7. Data model summary

The full specification lives in `docs/2026-05-22-data-model-spec.md` (supersedes 2026-05-19). Key points only here:

- **Two asset types:** `mineral` and `orri`. They share a common identity model but carry different fields.
- **Public tract IDs:** `Min001…Min{n}` for minerals, `OR001…OR{n}` for ORRI. Separate ID spaces. **Frozen once assigned** — removed tracts leave gaps; new tracts receive the next unused number. The mapping is persisted in `data-raw/inventory/id-registry.json`.
- **Initial sort order:** county (alphabetical) → STR (lexicographic on the canonical padded form) → deal slug (alphabetical) for minerals; same minus deal for ORRI, which uses an 8-char `row_hash` to disambiguate multiple grants on the same STR.
- **Internal match key for activity records:** normalized `STR + county`. A record can attach to multiple tracts when several deals share a section (e.g., Min004 GILMORE and Min005 TACKITT both sit on `17-12N-18W`). Deal-level uniqueness applies to identity assignment, not to activity matching.
- **Status normalization:** raw status preserved verbatim in `status_raw`; a normalized `status_category` (`LEASED | HBP | OPEN | PENDING | OTHER | NON_PRODUCING`) is added for filtering. For minerals: "Reign Reg", "Crawley Reg", and any value containing "Reg" map to `PENDING`. For ORRI: `status_raw` is always null (no STATUS column in the Inventory); `status_category` is derived from the lease fields — `HBP` if DOL/EXP are both "HBP", `NON_PRODUCING` if both are real dates.
- **Inventory Excel is a living document.** Status and lease expirations change between refreshes. The refresh script archives the prior `inventory-current.xlsx` before replacement, per the carve-out in Hard Rule #1.
- **Wells are a first-class entity.** Permits, completions, and production reference `well_id`. Tracts join to wells via STR overlap (`tract.str ∈ well.sections`). Horizontal wells crossing multiple sections carry all sections in `sections[]`.
- **Coordinate fields reserved on every tract from day one** (`lat`, `lon`, `section_polygon` — null until Phase 8 populates them). This prevents a schema migration when the map is added.
- **Production is well-level monthly.** Tract-level rollups are computed in the front-end, not precomputed. The UI clearly labels rollups as gross production across wells touching the section, not net to the tract owner. See Hard Rule #5.
- **Oseberg deep links** carry on every regulatory and leasing record where available, with a `oseberg_url_requires_login` boolean so the UI can flag gated sources.

---

## 8. Branding

**Confirmed at Phase 5 by inspecting the live oklahomaminerals.com (2026-05-22):** the live site is maroon + peach, not navy + gold as originally anticipated. The data-room portal mirrors the live site's brand color thread but executes with a more restrained, McKinsey-publication aesthetic to fit the B2B sale-process context.

**Palette:**
- **Primary accent:** `#9B2C31` maroon — used for header underline, link color, status-pill outlines, table header underlines, key-metric underlines. Never as a filled background.
- **Background:** `#FFFFFF` white (primary), `#FAFAF8` warm off-white (sectional differentiation).
- **Body text:** `#222222` near-black for primary content; `#54595F` mid-gray for labels/metadata.
- **Hairlines / dividers:** `#E5E5E0` warm light gray (1 px borders).
- **Peach `#FFBC7D`** is intentionally NOT used in the portal palette — too soft for the McKinsey-publication feel.

**Typography:**
- **Headlines / wordmark:** `Roboto Slab` (matches the live site's slab-serif authoritative feel). Weights 400, 500, 700.
- **Body / tables / navigation:** `Roboto`. Weights 400, 500, 700.
- **Tabular figures** enabled on all numeric content (`font-variant-numeric: tabular-nums`).
- Both loaded from Google Fonts via `<link>` (no font self-hosting in v1).

**Wordmark:** text-only, no image. Header reads `OKLAHOMA MINERALS / WAB PACKAGE 1.0` in Roboto Slab. No logo file required.

**Tone:** professional, factual, investor-grade. No marketing hype. Buyers should feel they are reading a data room, not a brochure. **Lots of white space.** Big-number-with-uppercase-label treatment for headline metrics (McKinsey publication style).

---

## 9. Glossary

- **WAB** — Western Anadarko Basin
- **NMA** — Net Mineral Acres
- **NRA** — Net Royalty Acres
- **ORRI** — Overriding Royalty Interest: a non-cost-bearing share of production carved out of the working interest, distinct from a mineral fee interest
- **STR** — Section-Township-Range (e.g., `25-11N-11W` = Section 25, Township 11 North, Range 11 West). Canonical form pads section to 2 digits: `05-12N-16W`.
- **HBP** — Held By Production: a lease with no expiration so long as production continues. Stored as the literal string `"HBP"` in date fields.
- **DEAL** — internal name for the acquisition or seller family group from which a mineral tract originated. ORRI rows have no deal field.
- **OCC** — Oklahoma Corporation Commission (Oklahoma's oil and gas regulator)
- **Force pooling / Spacing** — OCC processes that compel mineral owners into a drilling unit; nearby filings are signals of development pressure
- **TOO** — Transfer of Ownership filing
- **Gross vs. net production** — Gross is total well production. Net is the share attributable to a specific interest owner after applying their decimal interest. The portal shows gross only (see Hard Rule #5).

---

## 10. What "done" looks like

Each phase has explicit acceptance criteria in `docs/2026-05-21-build-roadmap.md`. Do not advance to the next phase without Gib's explicit approval. A phase is "done" when:

1. Code runs cleanly in the venv with pinned deps.
2. Outputs match the schema spec.
3. The matching report in `meta.json` is plausible and reviewed.
4. The end-of-task file list has been delivered.
5. Gib has reviewed and said "next phase."

---

## 11. When in doubt

Ask. Cost of a clarifying question is small; cost of building the wrong thing on an asset-sale timeline is large. If implementation reveals an error or ambiguity in this document or the data model spec, **propose a fix to the document first** — code and spec should not drift apart.


<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

*No recent activity*
</claude-mem-context>