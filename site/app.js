/*
 * WAB Package 1.0 — front-end shared module
 *
 * Vanilla ES2020+. No framework, no bundler, no build step.
 *
 * Exports (attached to window.wab):
 *   loadJSON(path)           - fetch and parse a JSON file under data/
 *   formatNumber(n, opts)    - locale-aware number formatting
 *   formatCurrency(n, opts)  - whole-dollar currency formatting
 *   formatPercent(decimal)   - 0.1875 -> "18.75%"
 *   formatDate(iso)          - "2024-12-14" -> "Dec 14, 2024"
 *   formatStatus(category)   - friendly label for status_category enum
 *   initIndex()              - page bootstrap for index.html
 *   initTracts()             - page bootstrap for tracts.html (Phase 5 part 2)
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Fetch + cache
  // -------------------------------------------------------------------------

  const _cache = new Map();

  async function loadJSON(path) {
    if (_cache.has(path)) return _cache.get(path);
    const url = new URL(path, document.baseURI).toString();
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) {
      throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
    }
    const json = await res.json();
    _cache.set(path, json);
    return json;
  }

  // -------------------------------------------------------------------------
  // Formatters
  // -------------------------------------------------------------------------

  function formatNumber(n, opts = {}) {
    if (n === null || n === undefined) return "—";
    const { decimals = 0, thousands = true } = opts;
    if (typeof n !== "number" || isNaN(n)) return "—";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: thousands,
    });
  }

  function formatCurrency(n, opts = {}) {
    if (n === null || n === undefined) return "—";
    if (typeof n !== "number" || isNaN(n)) return "—";
    const { compact = false } = opts;
    if (compact && Math.abs(n) >= 1_000_000) {
      return "$" + (n / 1_000_000).toFixed(2) + "M";
    }
    if (compact && Math.abs(n) >= 1_000) {
      return "$" + (n / 1_000).toFixed(0) + "K";
    }
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function formatPercent(decimal, opts = {}) {
    if (decimal === null || decimal === undefined) return "—";
    if (typeof decimal !== "number" || isNaN(decimal)) return "—";
    const { decimals = 2 } = opts;
    return (decimal * 100).toFixed(decimals) + "%";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    if (iso === "HBP") return "HBP";
    const d = new Date(iso + (iso.length === 10 ? "T12:00:00Z" : ""));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function formatStatus(category) {
    const map = {
      LEASED: "Leased",
      HBP: "HBP",
      OPEN: "Open",
      PENDING: "Pending",
      OTHER: "Other",
      NON_PRODUCING: "Non-producing",
    };
    return map[category] || category || "—";
  }

  // -------------------------------------------------------------------------
  // Render error helper
  // -------------------------------------------------------------------------

  function renderError(el, err) {
    if (!el) return;
    // Safe DOM clearing (avoid innerHTML)
    while (el.firstChild) el.removeChild(el.firstChild);
    const msg = document.createElement("div");
    msg.className = "error-box";
    msg.textContent =
      "Could not load data: " +
      (err && err.message ? err.message : String(err));
    el.appendChild(msg);
    if (window.console) {
      console.error("[wab]", err);
    }
  }

  // -------------------------------------------------------------------------
  // Index page bootstrap
  // -------------------------------------------------------------------------

  async function initIndex() {
    const root = document.querySelector("[data-page='index']");
    if (!root) return;

    try {
      const [tractsDoc, pricesDoc, metaDoc] = await Promise.all([
        loadJSON("data/tracts.json"),
        loadJSON("data/prices.json").catch(() => null),
        loadJSON("data/meta.json"),
      ]);

      const tracts = tractsDoc.tracts || [];

      // Headline metrics — sections (deduplicated) rather than tract counts.
      const minerals = tracts.filter((t) => t.type === "mineral");
      const orris = tracts.filter((t) => t.type === "orri");
      const hbpOrris = orris.filter((t) => t.status_category === "HBP");
      const nonHbpOrris = orris.filter(
        (t) => t.status_category === "NON_PRODUCING"
      );

      const uniqStr = (rows) =>
        Array.from(new Set(rows.map((t) => t.str))).length;

      const totalSections = uniqStr(tracts);
      const mineralSections = uniqStr(minerals);
      const hbpOrriSections = uniqStr(hbpOrris);
      const nonHbpOrriSections = uniqStr(nonHbpOrris);

      const sumOf = (rows, key) =>
        rows.reduce((s, t) => s + (t[key] || 0), 0);
      const mineralNMA = sumOf(minerals, "nma");
      const mineralNRA = sumOf(minerals, "nra");
      const hbpNRA = sumOf(hbpOrris, "nra");
      const nonHbpNRA = sumOf(nonHbpOrris, "nra");

      // Asking-price components.
      //
      // Mineral ask comes from the tract-level sales_revenue fields (sum
      // across all mineral rows in the inventory).
      //
      // ORRI ask comes from Gib's spreadsheet-level valuation cells which
      // the inventory ingest captures into meta.json under
      // matching_report.aggregate_cells_skipped (per spec §13.1). The two
      // cells we want are I48 (non-HBP projected ask = total NRA x $/acre)
      // and I93 (HBP projected ask). Cell labels are positional — if Gib
      // reorganizes the inventory those positions could shift. Spec §13.1
      // documents this and the ingest reports the cells in meta.json, so a
      // mismatch would be visible in the matching report.
      const mineralAsk = sumOf(minerals, "sales_revenue");
      const aggregateCells = (metaDoc && metaDoc.matching_report
                              && metaDoc.matching_report.aggregate_cells_skipped) || [];
      const cellValue = (cellName) => {
        const c = aggregateCells.find((x) => x.cell === cellName);
        return c && typeof c.value === "number" ? c.value : 0;
      };
      const orriNonHbpAsk = Math.round(cellValue("I48"));
      const orriHbpAsk = Math.round(cellValue("I93"));
      const orriAsk = orriNonHbpAsk + orriHbpAsk;
      const packageAsk = mineralAsk + orriAsk;

      // Big-number values
      _setMetric(root, "total-sections", formatNumber(totalSections));
      _setMetric(root, "mineral-sections", formatNumber(mineralSections));
      _setMetric(root, "hbp-orri-sections", formatNumber(hbpOrriSections));
      _setMetric(root, "nonhbp-orri-sections", formatNumber(nonHbpOrriSections));
      _setMetric(root, "package-ask", formatCurrency(packageAsk, { compact: true }));

      // Sub-number values (label/value pairs inside each card)
      _setText(root, "mineral-nma", formatNumber(mineralNMA, { decimals: 1 }));
      _setText(root, "mineral-nra", formatNumber(mineralNRA, { decimals: 1 }));
      _setText(root, "hbp-orri-nra", formatNumber(hbpNRA, { decimals: 1 }));
      _setText(root, "nonhbp-orri-nra", formatNumber(nonHbpNRA, { decimals: 1 }));
      _setText(root, "mineral-ask", formatCurrency(mineralAsk));
      _setText(root, "orri-ask", formatCurrency(orriAsk));

      // Hero subtitle counties — dynamic from data
      const counties = Array.from(new Set(tracts.map((t) => t.county))).sort();
      _setText(root, "county-count-word", _countWord(counties.length));
      _setText(root, "county-list", _formatList(counties));

      // Price block
      if (pricesDoc) {
        const wti = pricesDoc.wti;
        const hh = pricesDoc.henry_hub;
        _setText(root, "price-asof", "as of " + formatDate(pricesDoc.as_of));
        _setText(root, "wti-close", "$" + formatNumber(wti.close_usd, { decimals: 2 }));
        _setText(root, "wti-delta", _deltaLabel(wti.change_usd, wti.change_pct));
        _setDeltaClass(root, "wti-delta", wti.change_usd);
        _setText(root, "hh-close", "$" + formatNumber(hh.close_usd_mmbtu, { decimals: 2 }));
        _setText(root, "hh-delta", _deltaLabel(hh.change_usd, hh.change_pct));
        _setDeltaClass(root, "hh-delta", hh.change_usd);
      } else {
        _setText(root, "wti-close", "—");
        _setText(root, "hh-close", "—");
      }

      // Activity summary from meta.json
      const mr = (metaDoc && metaDoc.matching_report) || {};
      _setMetric(
        root,
        "activity-permits",
        formatNumber(mr.permits_affecting_owned_tracts || 0)
      );
      _setMetric(
        root,
        "activity-production",
        formatNumber(mr.production_affecting_owned_tracts || 0)
      );
      _setMetric(
        root,
        "activity-leasing",
        formatNumber(mr.leases_affecting_owned_tracts || 0)
      );
      _setMetric(
        root,
        "activity-regulatory",
        formatNumber(mr.regulatory_affecting_owned_tracts || 0)
      );
      _setText(
        root,
        "activity-asof",
        "as of " + formatDate((metaDoc && metaDoc.generated_at) || "")
      );

      // Footer source markers
      _setText(
        root,
        "data-asof",
        formatDate((metaDoc && metaDoc.generated_at) || "")
      );
      _setText(
        root,
        "inventory-file",
        (metaDoc && metaDoc.inventory_file) || "—"
      );
      _setText(
        root,
        "oseberg-folder",
        (metaDoc && metaDoc.oseberg_folder) || "—"
      );
    } catch (err) {
      renderError(root, err);
    }
  }

  function _setMetric(root, key, value) {
    const el = root.querySelector(`[data-metric='${key}']`);
    if (el) el.textContent = value;
  }

  function _setText(root, key, value) {
    const el = root.querySelector(`[data-text='${key}']`);
    if (el) el.textContent = value;
  }

  function _setDeltaClass(root, key, changeUsd) {
    const el = root.querySelector(`[data-text='${key}']`);
    if (!el) return;
    el.classList.remove("delta-up", "delta-down", "delta-flat");
    if (changeUsd > 0) el.classList.add("delta-up");
    else if (changeUsd < 0) el.classList.add("delta-down");
    else el.classList.add("delta-flat");
  }

  function _countWord(n) {
    const words = ["zero", "one", "two", "three", "four", "five", "six",
                   "seven", "eight", "nine", "ten"];
    return words[n] || String(n);
  }

  function _formatList(items) {
    // Oxford comma: "A and B", "A, B, and C", "A, B, C, and D"
    if (!items || items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function _deltaLabel(changeUsd, changePct) {
    if (changeUsd === null || changeUsd === undefined) return "—";
    const sign = changeUsd > 0 ? "+" : changeUsd < 0 ? "" : "±";
    const usd =
      sign +
      "$" +
      Math.abs(changeUsd).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const pct =
      (changePct > 0 ? "+" : changePct < 0 ? "" : "±") +
      (changePct * 100).toFixed(2) +
      "%";
    return `${usd} (${pct})`;
  }

  // -------------------------------------------------------------------------
  // Tracts page bootstrap
  // -------------------------------------------------------------------------

  // Sortable column keys -> getter that returns a comparable value.
  // Numbers stay numeric; strings become lowercased strings; nulls sort last.
  function _comparable(tract, key) {
    let v;
    if (key === "deal_name") {
      v = tract.deal_name || (tract.type === "orri" ? "ORRI" : "");
    } else if (key === "lease_expiration") {
      // "HBP" should sort apart from real dates. Treat HBP as "9999-99-99".
      v = tract.lease_expiration === "HBP" ? "9999-99-99" : (tract.lease_expiration || "");
    } else {
      v = tract[key];
    }
    if (v === null || v === undefined) return null;
    return v;
  }

  function _compareTracts(a, b, key, dir) {
    const av = _comparable(a, key);
    const bv = _comparable(b, key);
    // Nulls always sort last regardless of direction
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    const cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
    return dir === "asc" ? cmp : -cmp;
  }

  function _pillClassFor(category) {
    const c = String(category || "").toLowerCase().replace(/_/g, "-");
    return "pill pill--" + c;
  }

  function _td(textOrNode, opts = {}) {
    const cell = document.createElement("td");
    if (opts.cls) cell.className = opts.cls;
    if (textOrNode instanceof Node) {
      cell.appendChild(textOrNode);
    } else {
      cell.textContent = (textOrNode === null || textOrNode === undefined) ? "—" : String(textOrNode);
    }
    return cell;
  }

  function _renderTractRow(t) {
    const tr = document.createElement("tr");

    // ID — link to tract.html (target may 404 until Phase 6 ships)
    const idCell = document.createElement("td");
    idCell.className = "data-table__cell--id";
    const idLink = document.createElement("a");
    idLink.href = "tract.html?id=" + encodeURIComponent(t.tract_id);
    idLink.textContent = t.tract_id;
    idCell.appendChild(idLink);
    tr.appendChild(idCell);

    // County
    tr.appendChild(_td(t.county));

    // STR
    tr.appendChild(_td(t.str, { cls: "data-table__cell--str" }));

    // Deal / Type
    if (t.type === "mineral") {
      tr.appendChild(_td(t.deal_name || "—"));
    } else {
      const span = document.createElement("span");
      span.className = "data-table__cell--muted";
      span.textContent = "ORRI";
      tr.appendChild(_td(span));
    }

    // NMA (mineral only)
    if (t.type === "mineral") {
      tr.appendChild(_td(formatNumber(t.nma, { decimals: 2 }), { cls: "data-table__cell--num" }));
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--num data-table__cell--muted" }));
    }

    // NRA (both)
    tr.appendChild(_td(formatNumber(t.nra, { decimals: 2 }), { cls: "data-table__cell--num" }));

    // Royalty (mineral only)
    if (t.type === "mineral") {
      tr.appendChild(_td(formatPercent(t.royalty), { cls: "data-table__cell--num" }));
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--num data-table__cell--muted" }));
    }

    // Status pill
    const pill = document.createElement("span");
    pill.className = _pillClassFor(t.status_category);
    pill.textContent = formatStatus(t.status_category);
    pill.title = t.status_raw || formatStatus(t.status_category);
    tr.appendChild(_td(pill));

    // Asking (mineral only)
    if (t.type === "mineral" && t.sales_revenue !== null && t.sales_revenue !== undefined) {
      tr.appendChild(_td(formatCurrency(t.sales_revenue), { cls: "data-table__cell--num" }));
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--num data-table__cell--muted" }));
    }

    // Lease expiration
    if (t.lease_expiration === "HBP") {
      const span = document.createElement("span");
      span.className = "pill pill--hbp";
      span.textContent = "HBP";
      tr.appendChild(_td(span));
    } else if (t.lease_expiration) {
      tr.appendChild(_td(formatDate(t.lease_expiration)));
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--muted" }));
    }

    return tr;
  }

  async function initTracts() {
    const root = document.querySelector("[data-page='tracts']");
    if (!root) return;

    try {
      const [tractsDoc, metaDoc] = await Promise.all([
        loadJSON("data/tracts.json"),
        loadJSON("data/meta.json").catch(() => null),
      ]);
      const allTracts = tractsDoc.tracts || [];

      // Populate the county filter
      const counties = Array.from(new Set(allTracts.map((t) => t.county))).sort();
      const countySel = root.querySelector("select[data-filter='county']");
      counties.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        countySel.appendChild(opt);
      });

      // Populate the status filter
      const statuses = Array.from(
        new Set(allTracts.map((t) => t.status_category).filter(Boolean))
      ).sort();
      const statusSel = root.querySelector("select[data-filter='status']");
      statuses.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = formatStatus(s);
        statusSel.appendChild(opt);
      });

      const state = {
        filters: { type: "", county: "", status: "", search: "" },
        sort: { key: "tract_id", dir: "asc" },
      };

      const filterInputs = root.querySelectorAll("[data-filter]");
      filterInputs.forEach((el) => {
        el.addEventListener("input", () => {
          state.filters[el.dataset.filter] = el.value;
          render();
        });
      });

      root.querySelectorAll("[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (state.sort.key === key) {
            state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
          } else {
            state.sort.key = key;
            state.sort.dir = "asc";
          }
          render();
        });
      });

      root.querySelector("[data-action='reset-filters']").addEventListener("click", () => {
        state.filters = { type: "", county: "", status: "", search: "" };
        filterInputs.forEach((el) => { el.value = ""; });
        render();
      });

      function render() {
        // Apply filters
        const f = state.filters;
        const q = (f.search || "").trim().toLowerCase();
        const rows = allTracts.filter((t) => {
          if (f.type && t.type !== f.type) return false;
          if (f.county && t.county !== f.county) return false;
          if (f.status && t.status_category !== f.status) return false;
          if (q) {
            const haystack = [t.tract_id, t.county, t.str, t.deal_name, t.status_raw]
              .filter(Boolean).join(" ").toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        });

        // Sort
        rows.sort((a, b) => _compareTracts(a, b, state.sort.key, state.sort.dir));

        // Render tbody
        const tbody = root.querySelector("[data-tract-rows]");
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        rows.forEach((t) => tbody.appendChild(_renderTractRow(t)));

        // Result count
        _setText(root, "result-count",
          rows.length === allTracts.length
            ? formatNumber(allTracts.length)
            : `${formatNumber(rows.length)} of ${formatNumber(allTracts.length)}`
        );

        // Sort indicators
        root.querySelectorAll("[data-sort]").forEach((th) => {
          th.classList.remove("is-sorted-asc", "is-sorted-desc");
          if (th.dataset.sort === state.sort.key) {
            th.classList.add(state.sort.dir === "asc" ? "is-sorted-asc" : "is-sorted-desc");
          }
        });

        // Empty state
        const empty = root.querySelector("[data-text='empty-state']");
        if (empty) {
          empty.hidden = rows.length !== 0;
        }
      }

      render();

      // Footer metadata
      if (metaDoc) {
        _setText(root, "data-asof", formatDate(metaDoc.generated_at || ""));
        _setText(root, "inventory-file", metaDoc.inventory_file || "—");
        _setText(root, "oseberg-folder", metaDoc.oseberg_folder || "—");
      }
    } catch (err) {
      renderError(root, err);
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  window.wab = {
    loadJSON,
    formatNumber,
    formatCurrency,
    formatPercent,
    formatDate,
    formatStatus,
    initIndex,
    initTracts,
  };
})();
