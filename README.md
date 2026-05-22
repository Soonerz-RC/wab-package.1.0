# WAB Package 1.0

A static, link-gated data room for buyers evaluating **WAB Package 1.0** — a mineral and ORRI package in the Western Anadarko Basin owned by GBK International Group, Ltd and TPC Minerals, LLC.

The portal presents the package tract-by-tract with OCC permit, completion, production, leasing, and regulatory activity tied to the legals where assets are owned, plus a daily-updated WTI and Henry Hub closing price block.

The portal is built to be regenerable from raw Oseberg data every 14–30 days during the sale process, with minimal manual intervention.

---

## How this repo is organized

| Folder | Purpose |
|---|---|
| `CLAUDE.md` | Project constitution. Read first. Defines hard rules, working preferences, repo structure, tech stack, glossary. |
| `docs/` | Foundation documents: data model spec, build roadmap, starter prompt. |
| `data-raw/` | **Read-only** inputs: master Inventory Excel and Oseberg downloads. See CLAUDE.md §3 Hard Rule #1 for the two narrowly defined exceptions. |
| `data/` | **Generated** JSON the site reads. Never hand-edit. See CLAUDE.md §3 Hard Rule #2. |
| `scripts/` | Python that transforms `data-raw/` into `data/`. |
| `site/` | Static front-end deployed to Netlify. |

---

## Setup (first time)

```bash
cd /Users/gibber/Downloads/Claude_Dev/wab-package.1.0/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Python 3.11+ required.

---

## Refresh cycle (every 14–30 days during sale process)

1. Replace `data-raw/inventory/inventory-current.xlsx` with the latest Inventory file. The refresh script archives the prior version to `data-raw/inventory/archive/YYYY-MM-DD-inventory.xlsx`.
2. Drop the latest Oseberg downloads into a new dated subfolder: `data-raw/oseberg/YYYY-MM-DD/`.
3. From the activated venv:
   ```bash
   python scripts/refresh_all.py
   ```
4. Review `data/meta.json` — the matching report tells you whether the refresh was clean.
5. Commit and push. Netlify auto-deploys.

For daily price updates only:

**Automatic (recommended):** pulls WTI and Henry Hub from the EIA Open Data API.
```bash
python scripts/update_prices.py --fetch
```
This reads `EIA_API_KEY` from `.env` at the repo root. Copy `.env.example` to `.env` and paste your key in. Register for a free key at https://www.eia.gov/opendata/register.php. `.env` is gitignored.

**Manual fallback** (e.g., if EIA is unavailable, or for backfills):
```bash
python scripts/update_prices.py --wti 78.42 --henry-hub 3.18 --date 2026-05-21
```

---

## For Claude Code sessions

`CLAUDE.md` is loaded automatically at the start of every session in this folder. Phase work follows `docs/2026-05-21-build-roadmap.md` one phase at a time, with approval between phases.

---

## Tech stack

Static HTML / CSS / vanilla JS front-end. Python 3.11+ for data processing (`pandas`, `openpyxl`). Chart.js for charts. Leaflet for the map (Phase 8). No build step, no framework, no backend.

See `CLAUDE.md` §5 for the full locked stack.

---

## License & distribution

Private. The portal URL is shared directly with vetted buyers. No public links.
