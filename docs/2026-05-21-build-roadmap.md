# Build Roadmap — WAB Package 1.0

**Version:** 2026-05-21 (supersedes 2026-05-19 build roadmap)
**How to use this document:** Each phase below is a discrete chunk of work for Claude Code. Feed the recommended kickoff prompt at the start of the phase, work through it interactively, and don't advance to the next phase until the acceptance criteria are met and you've reviewed the output.

**Local project folder:** `/Users/gibber/Downloads/Claude_Dev/wab-package.1.0/`
**GitHub remote:** `https://github.com/Soonerz-RC/wab-package.1.0.git`

---

## Overview

| # | Phase | Approx. effort | Status |
|---|---|---|---|
| 1 | Organize foundation docs + scaffold the repo | 30–60 min | Not started |
| 2 | Inventory ingestion → `tracts.json` | 1–2 hr | Not started |
| 3 | Wells ingestion → `wells.json` | 1–2 hr | Not started |
| 4 | Activity ingestion (permits, completions, production, leasing, regulatory) | 2–4 hr | Not started |
| 5 | Front-end shell (index + tract list + prices) | 2–3 hr | Not started |
| 6 | Tract detail pages | 2–3 hr | Not started |
| 7 | Activity page + Netlify deploy | 1–2 hr | Not started |
| 8 | *(deferred)* Map with PLSS overlays | 3–5 hr | Deferred |
| 9 | *(deferred)* Refresh skill packaging | 1–2 hr | Deferred |

Effort estimates assume one focused session per phase with Claude Code. Reality will vary.

---

## Phase 1 — Organize foundation docs + scaffold the repo

**Goal:** Take the foundation documents already sitting in the project folder, place them where they belong, build out the rest of the empty project structure per CLAUDE.md, and wire up git with the GitHub remote.

**Why this phase exists:** A clean scaffold means every later phase has a known landing place for its outputs. The foundation documents get committed to git so they're versioned alongside the code from the start.

**Inputs:**
- Local project folder already exists at `/Users/gibber/Downloads/Claude_Dev/wab-package.1.0/`
- Foundation documents already in that folder (Gib placed them there):
  - `2026-05-21-CLAUDE.md` (this is the working CLAUDE.md — supersedes any earlier drafts also in the folder)
  - `2026-05-19-data-model-spec.md`
  - `2026-05-21-build-roadmap.md` (this file)
  - `2026-05-21-starter-prompt.md`
- Earlier-dated drafts may also be present (e.g., 2026-05-19 CLAUDE.md and CLAUDE-amended.md). These are superseded; confirm with Gib before deleting any of them.
- GitHub repo already created at `https://github.com/Soonerz-RC/wab-package.1.0.git` (empty)

**Outputs:**
- `CLAUDE.md` in repo root (copied from `2026-05-21-CLAUDE.md` and renamed)
- `docs/` folder containing:
  - `docs/2026-05-19-data-model-spec.md`
  - `docs/2026-05-21-build-roadmap.md`
  - `docs/2026-05-21-starter-prompt.md`
- Empty subfolder tree per CLAUDE.md §6: `data-raw/inventory/archive/`, `data-raw/oseberg/`, `data/`, `scripts/`, `site/assets/`
- `README.md` — project overview, setup instructions, link to CLAUDE.md
- `.gitignore` — covers `.venv/`, `__pycache__/`, `.DS_Store`, `*.pyc`, `node_modules/`
- `requirements.txt` — pinned `pandas`, `openpyxl`
- Python venv at `.venv/` (not committed)
- Git initialized, remote `origin` set to `https://github.com/Soonerz-RC/wab-package.1.0.git`
- Initial commit made and pushed to `main`

**Acceptance criteria:**
1. `tree -L 2` matches CLAUDE.md §6.
2. `source .venv/bin/activate && pip install -r requirements.txt` succeeds with no errors.
3. `git log` shows one initial commit; `git remote -v` shows the GitHub remote.
4. Initial commit appears on github.com under `Soonerz-RC/wab-package.1.0`.
5. `CLAUDE.md` is in the repo root (not in `docs/`).
6. Earlier-dated foundation drafts have been removed (or moved to a clearly labeled archive folder outside the repo) — only after confirming with Gib.
7. End-of-task file list delivered.

**What Gib reviews:**
- Tree structure
- README content
- `.gitignore` choices
- That the initial commit shows up on GitHub
- That the right CLAUDE.md (the 2026-05-21 version) is at the repo root

**Recommended kickoff prompt:**

```
We're starting Phase 1 of the WAB Package 1.0 build roadmap. The project
folder already exists at /Users/gibber/Downloads/Claude_Dev/wab-package.1.0/
and four foundation documents are already in it.

Please:

  1. Read 2026-05-21-CLAUDE.md fully. This is the authoritative project
     constitution and supersedes any earlier-dated CLAUDE drafts you
     find in the folder.
  2. Read 2026-05-19-data-model-spec.md and 2026-05-21-build-roadmap.md
     for context.
  3. Identify any superseded files in the folder (earlier-dated CLAUDE
     drafts) and propose what to do with them. Wait for my approval
     before deleting or moving anything.
  4. Propose your full plan for Phase 1 per the roadmap, then wait for
     my approval before executing.

GitHub remote for this project (already created, empty):
  https://github.com/Soonerz-RC/wab-package.1.0.git

Do not advance to Phase 2. One phase at a time.
```

---

## Phase 2 — Inventory ingestion → `tracts.json`

**Goal:** Read the master Inventory Excel, normalize every field, assign tract IDs via the registry, and write `data/tracts.json` and `data/meta.json`.

**Why this phase exists:** Tracts are the spine. Every later activity ingestion joins to tract IDs. Getting normalization and ID assignment right here makes everything downstream possible; getting it wrong here corrupts the whole portal.

**Inputs:**
- Phase 1 complete
- `data-raw/inventory/inventory-current.xlsx` populated (Gib copies the Inventory file in)

**Outputs:**
- `scripts/normalize.py` — STR, county, deal slug, status normalization functions per spec §2. Importable; no side effects.
- `scripts/ingest_inventory.py` — reads `inventory-current.xlsx`, archives prior version per spec §13, applies normalization, assigns IDs via `id-registry.json`, writes `data/tracts.json` and partial `data/meta.json`.
- `data-raw/inventory/id-registry.json` — initial population
- `data-raw/inventory/archive/` — created (empty on first run)
- `data/tracts.json`
- `data/meta.json` (partial — counts and id_registry sections only; matching_report stays empty until Phase 4)

**Acceptance criteria:**
1. All 36 mineral rows from the current Inventory appear as `type: "mineral"` tract objects.
2. All 52 ORRI rows appear as `type: "orri"` tract objects.
3. STR `5-12N-16W` (RIVERS) is canonicalized to `05-12N-16W`.
4. Both TACKITT and GILMORE appear as separate tracts with the same STR but different deal slugs and different tract IDs.
5. `0.1666` and `0.16670000000000001` Roger Mills ORRI grants (close to identical) get **separate** row hashes and separate OR IDs — they are different grants.
6. `id-registry.json` has 36 mineral entries and 52 ORRI entries; `retired` is `[]`.
7. `meta.json.counts` matches the actual record counts.
8. No `ingestion_errors`.

**What Gib reviews:**
- Spot-check 3–5 tracts in `tracts.json` against the Excel by eye.
- Verify Tackitt and Gilmore are both present with separate IDs.
- Confirm the registry persisted correctly by running the ingest a **second time** with no changes — IDs should be identical, no new entries added.

**Recommended kickoff prompt:**

```
Phase 2: Inventory ingestion. Read CLAUDE.md and
docs/2026-05-19-data-model-spec.md if not already loaded; sections 2, 3,
and 4 of the spec are the core of this phase.

I have placed the master Inventory at:
  data-raw/inventory/inventory-current.xlsx

Please propose your plan for Phase 2 and wait for my approval before
writing any code. After approval, build in this order:
  1. scripts/normalize.py with unit-style sanity checks against the
     examples in spec §2.
  2. scripts/ingest_inventory.py.
  3. Run it. Show me meta.json and 3 sample tract records.

Do not advance to Phase 3.
```

---

## Phase 3 — Wells ingestion → `wells.json`

**Goal:** Read Oseberg's well export for the six Anadarko counties and produce `wells.json` with `matched_tract_ids` populated.

**Why this phase exists:** Wells are the join hub for permits, completions, and production. Building wells before any activity stream means activity ingestion has a foreign key to land on.

**Inputs:**
- Phases 1–2 complete
- An Oseberg well export covering Washita, Custer, Roger Mills, Caddo, Dewey, Ellis (Gib places in `data-raw/oseberg/YYYY-MM-DD/wells.<ext>`)

**Outputs:**
- `scripts/ingest_oseberg_wells.py` — reads Oseberg well file, normalizes, computes `sections[]` array and `matched_tract_ids`, writes `data/wells.json`.
- `data/wells.json`
- `data/meta.json` updated with `wells` count and `wells_with_owned_tract` matching stat.

**Acceptance criteria:**
1. Every well in the Oseberg export appears in `wells.json` (no silent drops).
2. Horizontal wells crossing multiple sections have all sections in `sections[]`.
3. `matched_tract_ids` is populated for any well whose section list overlaps with an owned tract.
4. Spot-check: a known well in Section 17-12N-18W should match Min004 and Min005.
5. `ingestion_errors` is empty (or non-empty with clear, human-readable error rows).

**Notes for Claude Code:**
- Oseberg's export format may be CSV, XLSX, or JSON depending on what Gib downloads. Be prepared for any of these and detect format from extension.
- The "sections this well touches" field name in Oseberg varies (`Spacing Unit`, `Section Footages`, `Survey Footages`, `Completion Sections`). Ask Gib to confirm the source field on first contact with the file rather than guessing.

**What Gib reviews:**
- Skim 5 wells across different counties.
- Verify the 17-12N-18W match worked.
- Look at `matching_report.wells_with_owned_tract` — does it make sense given the package?

**Recommended kickoff prompt:**

```
Phase 3: Wells ingestion. Spec §5.

I have placed today's Oseberg well export at:
  data-raw/oseberg/YYYY-MM-DD/wells.<ext>

Before writing any code, look at the file and tell me:
  1. What format it is and what columns are present.
  2. Which column you propose to use for the sections-touched array,
     and any alternatives.
  3. Your plan for Phase 3.

Wait for my approval before writing the ingestion script. Do not advance
to Phase 4.
```

---

## Phase 4 — Activity ingestion

**Goal:** Build the remaining ingestion scripts and produce `permits.json`, `completions.json`, `production.json`, `leasing.json`, and `regulatory.json`. Wire them all together into `scripts/refresh_all.py`.

**Why this phase exists:** This phase brings in everything that makes the portal valuable to buyers — the regulator and market intelligence around each tract. After this phase, all data files exist and a buyer would have something to look at if there were a front-end.

**Inputs:**
- Phases 1–3 complete
- Oseberg exports for: permits, completions, production, leases recorded in the six counties, OCC regulatory actions in the six counties
- Each placed in `data-raw/oseberg/YYYY-MM-DD/` with descriptive filenames

**Outputs:**
- `scripts/ingest_oseberg_permits.py`
- `scripts/ingest_oseberg_completions.py`
- `scripts/ingest_oseberg_production.py`
- `scripts/ingest_oseberg_leasing.py`
- `scripts/ingest_oseberg_regulatory.py`
- `scripts/refresh_all.py` — orchestrator: archives the prior inventory, runs all ingestion scripts in dependency order, writes complete `meta.json` with full matching report, prints summary
- `scripts/update_prices.py` — standalone, accepts `--wti`, `--henry-hub`, `--date`; writes `data/prices.json`
- All five activity JSON files in `data/`
- `data/prices.json` initialized

**Acceptance criteria:**
1. Each ingestion script can be run standalone and updates only its own JSON.
2. `refresh_all.py` runs the full pipeline cleanly end to end.
3. `meta.json` shows non-zero counts for every category that should have data.
4. `matching_report.regulatory_affecting_owned_tracts` is plausible (Gib judges).
5. Production records are well-month rows per spec §8.
6. Leasing records carry `affects_owned_tracts` correctly.
7. Regulatory records carry `oseberg_url` and `oseberg_url_requires_login`.
8. `update_prices.py --wti 78.42 --henry-hub 3.18 --date 2026-05-21` produces a valid `prices.json` with computed deltas (zero on first run, real on subsequent runs).

**What Gib reviews:**
- Pick one tract (e.g., Min005 / TACKITT) and trace it through all five files. Does the activity story make sense?
- Read the full matching report. Anything suspicious?
- Verify `prices.json` updater behaves correctly across two runs.

**Recommended kickoff prompt:**

```
Phase 4: Activity ingestion. Spec §§6–11.

Oseberg exports for permits, completions, production, leases, and OCC
regulatory actions are at:
  data-raw/oseberg/YYYY-MM-DD/

Before writing code, walk me through each file and confirm your column
mappings. Then propose a plan that builds the ingestion scripts in this
order: permits → completions → production → leasing → regulatory →
refresh_all → update_prices. Wait for my approval after the column
walkthrough and again after the plan.

Do not advance to Phase 5.
```

---

## Phase 5 — Front-end shell

**Goal:** Build the public-facing portal's foundation: home page, tract list, branding, price block, navigation. No tract detail pages yet.

**Why this phase exists:** Locks in the look and feel before committing to the more complex detail pages. Gib can see the brand and feel the navigation, give early feedback.

**Inputs:**
- Phases 1–4 complete (all JSON data populated)
- Oklahoma Minerals brand reference (oklahomaminerals.com — Claude Code can fetch the homepage to extract exact hex values and confirm typography)

**Outputs:**
- `site/index.html` — package overview: headline metrics (total tracts, total NMA, total NRA, total ask), price block (WTI + Henry Hub from `prices.json`), brief sale-process description, link to tract list
- `site/tracts.html` — sortable, filterable table of all tracts. Filters: type (mineral/ORRI), county, status category. Each row links to `tract.html?id=Min005`.
- `site/styles.css` — navy/gold theme matching Oklahoma Minerals
- `site/app.js` — data loading helpers (`loadJSON('data/tracts.json')`, `loadJSON('data/prices.json')`); shared rendering utilities
- `site/assets/` — logo placeholder until Gib provides the actual asset

**Acceptance criteria:**
1. `index.html` opens locally (`open site/index.html`) and displays package overview correctly.
2. Headline metrics match `meta.json` and `tracts.json`.
3. Price block reflects `prices.json`.
4. `tracts.html` lists all 88 tracts, sortable by every visible column, filterable by type/county/status.
5. Visual matches oklahomaminerals.com palette closely (Gib's judgment).
6. Tract rows link to `tract.html?id={tract_id}` — the link target is a 404 for now; that's fine.

**What Gib reviews:**
- Open both pages locally and judge the look.
- Try every filter and sort.
- Compare to oklahomaminerals.com side by side.

**Recommended kickoff prompt:**

```
Phase 5: Front-end shell. CLAUDE.md §§5 and 8, spec §11.

Before writing code:
  1. Fetch oklahomaminerals.com homepage and report back the exact navy
     and gold hex values, fonts in use, and any header treatments you
     plan to mirror.
  2. Propose your plan for index.html, tracts.html, styles.css, app.js
     and wait for my approval.

Build pages in this order: app.js (data loading helpers) → styles.css →
index.html → tracts.html. Show me index.html standalone before building
tracts.html. Do not advance to Phase 6.
```

---

## Phase 6 — Tract detail pages

**Goal:** Build `tract.html` — the per-tract drill-down page that brings together every JSON file for one tract. This is the page buyers will spend the most time on.

**Why this phase exists:** This is the portal's core value delivery. Everything before this phase exists to make this page possible.

**Inputs:**
- Phases 1–5 complete

**Outputs:**
- `site/tract.html` — reads `?id=Min005` query param, renders:
  1. Tract header (ID, county, STR, deal/row hash, NMA/NRA/royalty/status/expiration/ask)
  2. Wells touching this tract — list with operator, status, type, links to Oseberg
  3. Permits — recent first
  4. Completions — with IP and stim details when available
  5. Production chart — gross production across touching wells, labeled per spec §8.3
  6. Regulatory activity — with Oseberg deep links
  7. Cross-links to other tracts in the same section (the Tackitt ↔ Gilmore case)

**Acceptance criteria:**
1. `tract.html?id=Min001` through `Min036` and `OR001` through `OR052` all render without errors.
2. Min004 and Min005 each link to the other under "Other tracts in this section."
3. Production chart renders. Empty production states (no wells matched) show a clear "no production data" message, not a broken chart.
4. Every Oseberg link is clickable; the lock icon appears when `oseberg_url_requires_login` is true.
5. The "gross vs. net" production disclaimer is visible and clear.

**What Gib reviews:**
- Pick a Min and an OR and walk through them in detail.
- Pick a tract with no matched wells (likely several) and verify the empty state is professional.
- Check the cross-links.

**Recommended kickoff prompt:**

```
Phase 6: Tract detail pages. Spec §15 is your worked example.

Build site/tract.html. The page reads ?id={tract_id} from the URL and
renders the full tract record across all data files.

Propose your plan first — particularly how you'll structure the page
sections and the JS module organization. Wait for approval. Build
incrementally: render the header first, show me, then add wells, then
activity, then production chart, then cross-links.

Do not advance to Phase 7.
```

---

## Phase 7 — Activity page + Netlify deploy

**Goal:** Build the portal-wide activity feed and put the site live on Netlify with GitHub auto-deploy wired up.

**Why this phase exists:** Final piece of v1. The Activity page is a buyer's "what's happening across the package" view; Netlify deploy is what makes the URL shareable.

**Inputs:**
- Phases 1–6 complete
- GitHub repo `https://github.com/Soonerz-RC/wab-package.1.0` already connected to Netlify (Gib does the connect in the Netlify UI)

**Outputs:**
- `site/activity.html` — sortable, filterable feed combining `leasing.json` (where `affects_owned_tracts` is true) and `regulatory.json`. Default sort by date desc. Filters: type, county, owned-only toggle.
- `netlify.toml` — minimal Netlify config (publish directory = `site/`)
- Live deployed URL

**Acceptance criteria:**
1. `activity.html` renders feed correctly.
2. `netlify.toml` is committed.
3. Pushing to `main` triggers a Netlify build that succeeds.
4. The live URL renders all four pages: index, tracts, tract detail, activity.
5. Data files load over the network from `data/` correctly.

**What Gib reviews:**
- Open the live URL in a fresh browser.
- Test on phone.
- Confirm sharing the URL with a colleague behaves as expected (no auth wall, no broken links).

**Recommended kickoff prompt:**

```
Phase 7: Activity page + Netlify deploy.

Two pieces:
  1. Build site/activity.html — a unified feed of leases (filtered to
     affects_owned_tracts=true) and regulatory actions. Sortable and
     filterable per usual pattern.
  2. Create netlify.toml. I'll connect the GitHub repo to Netlify on my
     end. Walk me through what I need to do in the Netlify UI.

Propose your plan. Build activity.html first, deploy second. After
deploy, run through the final acceptance checklist with me.

This completes v1. Phases 8 (map) and 9 (skill packaging) are deferred.
```

---

## Phase 8 — *(Deferred)* Map with PLSS overlays

**Goal:** Add interactive Leaflet map with section polygons drawn from open Oklahoma PLSS data.

**When to revisit:** After v1 is in buyers' hands. The schema already reserves `lat`, `lon`, and `section_polygon` fields, so this is purely additive — no migration.

**High-level work:**
- Source open BLM/Oklahoma PLSS data (sections shapefile)
- Backfill `lat`, `lon`, `section_polygon` on all tracts via a one-time script
- Add Leaflet map to index, tract.html, and possibly tracts.html
- Color sections by status

---

## Phase 9 — *(Deferred)* Refresh skill packaging

**Goal:** Package the proven refresh process into a Claude skill so future cycles become one-instruction operations.

**When to revisit:** After two successful refresh cycles. Packaging too early codifies decisions that haven't been stress-tested.

**High-level work:**
- Author `SKILL.md` describing the refresh process Claude Code will execute
- Place in `~/.claude/skills/` or project-specific skills location
- Document inputs Gib provides and outputs the skill produces
- Test the skill on a real refresh cycle

**Reusability note:** A well-designed refresh skill should be largely portable to WAB Package 2.0 and beyond, since the data model is identical across packages. Plan the skill with that reuse in mind.

---

## Between phases — checklist

Before saying "next phase" to Claude Code, run this quick check:

- [ ] All acceptance criteria for the current phase are met
- [ ] Files-created/modified list received and reviewed
- [ ] Output spot-checked against the data model spec
- [ ] Anything surprising explained satisfactorily
- [ ] Git commit made for the phase's work, pushed to GitHub
- [ ] If anything was changed from the spec, the spec was updated too

This last item is important: if implementation reveals a spec error, **fix the spec** rather than letting code and spec drift apart.

---

## End of Roadmap
