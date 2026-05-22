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
  // Tract detail page bootstrap
  // -------------------------------------------------------------------------

  function _lockIcon() {
    // Tiny lock svg for "requires login" badges next to Oseberg URLs
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "lock-icon");
    svg.setAttribute("viewBox", "0 0 10 12");
    svg.setAttribute("aria-label", "Login required");
    const path = document.createElementNS(NS, "path");
    path.setAttribute(
      "d",
      "M2 5V3.5a3 3 0 0 1 6 0V5h1v7H1V5h1Zm1 0h4V3.5a2 2 0 1 0-4 0V5Z"
    );
    svg.appendChild(path);
    return svg;
  }

  function _extArrow() {
    const span = document.createElement("span");
    span.className = "ext-arrow";
    span.textContent = "↗";
    return span;
  }

  function _link(text, href, opts = {}) {
    if (!href) {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    }
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    if (opts.external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.appendChild(_extArrow());
    }
    if (opts.requiresLogin) {
      a.appendChild(_lockIcon());
    }
    return a;
  }

  function _makeMetric(value, label) {
    const wrap = document.createElement("div");
    wrap.className = "metric";
    const v = document.createElement("span");
    v.className = "metric__value";
    if (value instanceof Node) {
      v.appendChild(value);
    } else {
      v.textContent = value;
    }
    wrap.appendChild(v);
    const l = document.createElement("span");
    l.className = "metric__label";
    l.textContent = label;
    wrap.appendChild(l);
    return wrap;
  }

  function _statusPill(category, rawTitle) {
    const span = document.createElement("span");
    span.className = "pill pill--" + String(category || "").toLowerCase().replace(/_/g, "-");
    span.textContent = formatStatus(category);
    if (rawTitle) span.title = rawTitle;
    return span;
  }

  // Build a generic table given headers + rows of cells
  function _buildTable(headers, rowDataList) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const trH = document.createElement("tr");
    headers.forEach((h) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h.label;
      if (h.numeric) th.classList.add("data-table__th--num");
      trH.appendChild(th);
    });
    thead.appendChild(trH);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rowDataList.forEach((cells) => {
      const tr = document.createElement("tr");
      cells.forEach((cell) => {
        const td = document.createElement("td");
        if (cell && cell.cls) td.className = cell.cls;
        const content = cell && cell.content !== undefined ? cell.content : cell;
        if (content instanceof Node) {
          td.appendChild(content);
        } else {
          td.textContent = content === null || content === undefined ? "—" : String(content);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Replace contents of an element safely
  function _replaceContent(host, nodeOrNodes) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (Array.isArray(nodeOrNodes)) {
      nodeOrNodes.forEach((n) => host.appendChild(n));
    } else if (nodeOrNodes) {
      host.appendChild(nodeOrNodes);
    }
  }

  function _emptyMessage(text) {
    const p = document.createElement("p");
    p.className = "activity-section__empty";
    p.textContent = text;
    return p;
  }

  function _setCount(root, key, count) {
    const el = root.querySelector(`[data-count='${key}']`);
    if (el) el.textContent = formatNumber(count);
  }

  function _renderTractHeader(root, tract) {
    const isMineral = tract.type === "mineral";
    const eyebrow = `Tract · ${tract.tract_id}`;
    const title = isMineral
      ? `${tract.deal_name} · ${tract.str}`
      : `ORRI Grant · ${tract.str}`;
    _setText(root, "tract-eyebrow", eyebrow);
    _setText(root, "tract-title", title);
    _setText(
      root,
      "tract-subtitle",
      `${tract.county} County, Township-Range ${tract.township_range}`
    );
    document.title = `${tract.tract_id} · ${title} — WAB Package 1.0`;
  }

  function _renderTractSummary(root, tract) {
    const host = root.querySelector("[data-tract-summary]");
    if (!host) return;
    _replaceContent(host, []);

    const metrics = [];
    metrics.push(_makeMetric(tract.county, "County"));
    metrics.push(_makeMetric(tract.str, "STR"));

    if (tract.type === "mineral") {
      metrics.push(
        _makeMetric(formatNumber(tract.nma, { decimals: 2 }), "NMA")
      );
      metrics.push(
        _makeMetric(formatNumber(tract.nra, { decimals: 2 }), "NRA")
      );
      metrics.push(
        _makeMetric(formatPercent(tract.royalty), "Royalty")
      );
      metrics.push(_makeMetric(_statusPill(tract.status_category, tract.status_raw), "Status"));
      if (tract.lease_expiration) {
        metrics.push(
          _makeMetric(
            tract.lease_expiration === "HBP"
              ? _statusPill("HBP", "HBP")
              : formatDate(tract.lease_expiration),
            "Lease exp."
          )
        );
      }
      if (tract.sales_revenue) {
        metrics.push(
          _makeMetric(formatCurrency(tract.sales_revenue), "Asking")
        );
      }
    } else {
      metrics.push(_makeMetric(formatNumber(tract.nra, { decimals: 2 }), "NRA"));
      metrics.push(_makeMetric(_statusPill(tract.status_category, tract.status_raw), "Status"));
      const dolDisplay =
        tract.date_of_lease === "HBP"
          ? _statusPill("HBP", "HBP")
          : tract.date_of_lease
          ? formatDate(tract.date_of_lease)
          : "—";
      metrics.push(_makeMetric(dolDisplay, "Date of lease"));
      const expDisplay =
        tract.lease_expiration === "HBP"
          ? _statusPill("HBP", "HBP")
          : tract.lease_expiration
          ? formatDate(tract.lease_expiration)
          : "—";
      metrics.push(_makeMetric(expDisplay, "Lease expiration"));
    }

    metrics.forEach((m) => host.appendChild(m));
  }

  function _renderCrossLinks(root, currentTract, allTracts) {
    const section = root.querySelector("[data-cross-links-section]");
    const list = root.querySelector("[data-cross-link-list]");
    if (!section || !list) return;

    const sameSection = allTracts.filter(
      (t) => t.str === currentTract.str && t.tract_id !== currentTract.tract_id
    );

    if (sameSection.length === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    _replaceContent(list, []);
    sameSection.forEach((t) => {
      const li = document.createElement("li");
      const idCell = document.createElement("span");
      idCell.className = "cross-link-list__id";
      const a = document.createElement("a");
      a.href = "tract.html?id=" + encodeURIComponent(t.tract_id);
      a.textContent = t.tract_id;
      idCell.appendChild(a);
      li.appendChild(idCell);

      const detail = document.createElement("span");
      detail.className = "cross-link-list__detail";
      if (t.type === "mineral") {
        detail.textContent = `${t.deal_name} · Mineral · ${formatStatus(t.status_category)}`;
      } else {
        detail.textContent = `ORRI · ${formatStatus(t.status_category)}`;
      }
      li.appendChild(detail);
      list.appendChild(li);
    });
  }

  // ---- Activity renderers ----

  function _renderWells(root, wells) {
    const host = root.querySelector("[data-activity='wells']");
    _setCount(root, "wells", wells.length);
    if (!wells.length) {
      _replaceContent(host, _emptyMessage("No wells in this section in the current Oseberg export."));
      return;
    }
    const headers = [
      { label: "API" }, { label: "Well name" }, { label: "Operator" },
      { label: "Profile" }, { label: "Status" }, { label: "Sections" },
      { label: "Spud date" },
    ];
    const rows = wells.map((w) => {
      const apiCell = _link(w.well_id, w.oseberg_url, { external: !!w.oseberg_url });
      return [
        { content: apiCell, cls: "data-table__cell--id" },
        w.well_name || "—",
        w.operator || "—",
        w.wellbore_profile || "—",
        w.well_status || "—",
        (w.sections || []).join(", ") || "—",
        formatDate(w.spud_date),
      ];
    });
    _replaceContent(host, _buildTable(headers, rows));
  }

  function _renderPermits(root, permits) {
    const host = root.querySelector("[data-activity='permits']");
    _setCount(root, "permits", permits.length);
    if (!permits.length) {
      _replaceContent(host, _emptyMessage("No permits in this section in the current Oseberg export."));
      return;
    }
    const headers = [
      { label: "Permit #" }, { label: "Filed" }, { label: "Type" },
      { label: "Operator" }, { label: "Status" }, { label: "Source" },
    ];
    const rows = permits.map((p) => [
      p.permit_number || "—",
      formatDate(p.permit_date),
      p.permit_type || "—",
      p.operator || "—",
      p.approval_status || "—",
      p.source || "—",
    ]);
    _replaceContent(host, _buildTable(headers, rows));
  }

  function _renderCompletions(root, completions) {
    const host = root.querySelector("[data-activity='completions']");
    _setCount(root, "completions", completions.length);
    if (!completions.length) {
      _replaceContent(host, _emptyMessage("No completions in this section in the current Oseberg export."));
      return;
    }
    const headers = [
      { label: "API" }, { label: "Completion date" }, { label: "Type" },
      { label: "Formation" }, { label: "IP oil (BOPD)", numeric: true },
      { label: "IP gas (MCFPD)", numeric: true }, { label: "Lateral (ft)", numeric: true },
      { label: "Operator" },
    ];
    const rows = completions.map((c) => {
      const apiCell = _link(c.well_id || "—", c.oseberg_url, { external: !!c.oseberg_url });
      return [
        { content: apiCell, cls: "data-table__cell--id" },
        formatDate(c.completion_date || c.effective_date),
        c.completion_type || "—",
        c.formation || "—",
        { content: formatNumber(c.ip_oil_bopd, { decimals: 0 }), cls: "data-table__cell--num" },
        { content: formatNumber(c.ip_gas_mcfpd, { decimals: 0 }), cls: "data-table__cell--num" },
        { content: formatNumber(c.lateral_length_ft, { decimals: 0 }), cls: "data-table__cell--num" },
        c.operator || "—",
      ];
    });
    _replaceContent(host, _buildTable(headers, rows));
  }

  function _renderProductionCard(rec) {
    const card = document.createElement("div");
    card.className = "production-card";

    const header = document.createElement("div");
    header.className = "production-card__header";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "production-card__title";
    title.textContent = rec.lease_name || rec.production_id || "(Unnamed lease)";
    titleWrap.appendChild(title);
    const op = document.createElement("div");
    op.className = "production-card__operator";
    op.textContent = rec.operator || "—";
    titleWrap.appendChild(op);
    header.appendChild(titleWrap);
    if (rec.is_active) {
      header.appendChild(_statusPill("HBP", "Active producer"));
    } else {
      header.appendChild(_statusPill("OTHER", "Inactive / stale"));
    }
    card.appendChild(header);

    // Big-number block: cumulative oil and cumulative gas
    const big = document.createElement("div");
    big.className = "production-card__big";
    const _makeBig = (val, label) => {
      const w = document.createElement("div");
      const v = document.createElement("span");
      v.className = "production-card__big-value";
      v.textContent = val;
      w.appendChild(v);
      const l = document.createElement("span");
      l.className = "production-card__big-label";
      l.textContent = label;
      w.appendChild(l);
      return w;
    };
    big.appendChild(_makeBig(formatNumber(rec.cumulative_oil_bbl, { decimals: 0 }), "Cumulative oil (bbl)"));
    big.appendChild(_makeBig(formatNumber(rec.cumulative_gas_mcf, { decimals: 0 }), "Cumulative gas (Mcf)"));
    card.appendChild(big);

    // Supporting rows
    const rows = document.createElement("dl");
    rows.className = "production-card__rows";
    const _row = (label, value) => {
      const r = document.createElement("div");
      r.className = "production-card__row";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      if (value instanceof Node) dd.appendChild(value);
      else dd.textContent = value;
      r.appendChild(dt);
      r.appendChild(dd);
      return r;
    };
    rows.appendChild(_row("Last month oil / gas",
      `${formatNumber(rec.last_month_oil_bopm, { decimals: 0 })} BOPM · ${formatNumber(rec.last_month_gas_mcfpm, { decimals: 0 })} MCFPM`));
    rows.appendChild(_row("12-mo avg oil / gas",
      `${formatNumber(rec.avg_last_12_month_oil_bopm, { decimals: 0 })} BOPM · ${formatNumber(rec.avg_last_12_month_gas_mcfpm, { decimals: 0 })} MCFPM`));
    rows.appendChild(_row("Producing since",
      `${formatDate(rec.first_prod_date)} · ${rec.number_of_months_producing || "—"} months`));
    rows.appendChild(_row("Last production", formatDate(rec.last_prod_date)));
    if (rec.decline_rate_oil !== null && rec.decline_rate_oil !== undefined) {
      rows.appendChild(_row("Decline rate (oil)", formatPercent(rec.decline_rate_oil)));
    }
    if (rec.lateral_length_sum_ft) {
      rows.appendChild(_row("Lateral length (sum)",
        `${formatNumber(rec.lateral_length_sum_ft, { decimals: 0 })} ft`));
    }
    if (rec.gross_acres) {
      rows.appendChild(_row("Gross acres", formatNumber(rec.gross_acres, { decimals: 1 })));
    }
    if (rec.reservoir_name) {
      rows.appendChild(_row("Reservoir", rec.reservoir_name));
    }
    card.appendChild(rows);
    return card;
  }

  function _renderProduction(root, production) {
    const host = root.querySelector("[data-activity='production']");
    _setCount(root, "production", production.length);
    if (!production.length) {
      _replaceContent(host, _emptyMessage("No production records touching this section in the current Oseberg export."));
      return;
    }
    const grid = document.createElement("div");
    grid.className = "production-cards";
    production.forEach((rec) => grid.appendChild(_renderProductionCard(rec)));
    _replaceContent(host, grid);
  }

  function _renderLeasing(root, leases) {
    const host = root.querySelector("[data-activity='leasing']");
    _setCount(root, "leasing", leases.length);
    if (!leases.length) {
      _replaceContent(host, _emptyMessage("No recent recorded leases touching this section."));
      return;
    }
    const SHOW_INITIAL = 10;
    let expanded = false;

    const buildTable = () => {
      const visible = expanded ? leases : leases.slice(0, SHOW_INITIAL);
      const headers = [
        { label: "Recorded" }, { label: "Lessor" }, { label: "Lessee" },
        { label: "Royalty", numeric: true }, { label: "Term (yrs)", numeric: true },
        { label: "Source" },
      ];
      const rows = visible.map((l) => {
        const sourceCell = l.oseberg_url
          ? _link("OK Co. Records", l.oseberg_url, { external: true })
          : "—";
        return [
          formatDate(l.recording_date),
          l.lessor || "—",
          l.lessee || "—",
          { content: formatPercent(l.royalty), cls: "data-table__cell--num" },
          { content: formatNumber(l.term_years, { decimals: 1 }), cls: "data-table__cell--num" },
          sourceCell,
        ];
      });
      return _buildTable(headers, rows);
    };

    const render = () => {
      const nodes = [buildTable()];
      if (leases.length > SHOW_INITIAL) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "activity-section__show-all";
        btn.textContent = expanded
          ? `Show first ${SHOW_INITIAL} only`
          : `Show all ${leases.length} →`;
        btn.addEventListener("click", () => {
          expanded = !expanded;
          render();
        });
        nodes.push(btn);
      }
      _replaceContent(host, nodes);
    };
    render();
  }

  function _renderRegulatory(root, actions) {
    const host = root.querySelector("[data-activity='regulatory']");
    _setCount(root, "regulatory", actions.length);
    if (!actions.length) {
      _replaceContent(host, _emptyMessage("No regulatory activity touching this section."));
      return;
    }
    const headers = [
      { label: "Type" }, { label: "Filed" }, { label: "Cause #" },
      { label: "Applicant" }, { label: "Summary" },
    ];
    const rows = actions.map((a) => {
      const typePill = document.createElement("span");
      typePill.className = "pill pill--" + (
        a.type === "POOLING_ORDER" || a.type === "SPACING_ORDER" ? "hbp" :
        a.type === "POOLING_APPLICATION" || a.type === "SPACING_APPLICATION" ? "pending" :
        a.type === "LOCATION_EXCEPTION" ? "non-producing" :
        "other"
      );
      typePill.textContent = formatRegulatoryType(a.type);
      let causeContent = a.cause_number || "—";
      if (a.oseberg_url) {
        causeContent = _link(a.cause_number || "link",
          a.oseberg_url, { external: true, requiresLogin: !!a.oseberg_url_requires_login });
      }
      return [
        typePill,
        formatDate(a.filing_date),
        causeContent,
        a.applicant || "—",
        a.summary || "—",
      ];
    });
    _replaceContent(host, _buildTable(headers, rows));
  }

  function formatRegulatoryType(t) {
    if (!t) return "—";
    return t.replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function initTract() {
    const root = document.querySelector("[data-page='tract']");
    if (!root) return;

    const tractId = new URLSearchParams(window.location.search).get("id");
    if (!tractId) {
      renderError(root, new Error("No tract ID in URL. Use tract.html?id=Min001 (for example)."));
      return;
    }

    try {
      const [
        tractsDoc, wellsDoc, permitsDoc, completionsDoc,
        productionDoc, leasingDoc, regulatoryDoc, metaDoc,
      ] = await Promise.all([
        loadJSON("data/tracts.json"),
        loadJSON("data/wells.json"),
        loadJSON("data/permits.json"),
        loadJSON("data/completions.json"),
        loadJSON("data/production.json"),
        loadJSON("data/leasing.json"),
        loadJSON("data/regulatory.json"),
        loadJSON("data/meta.json").catch(() => null),
      ]);

      const allTracts = tractsDoc.tracts || [];
      const tract = allTracts.find((t) => t.tract_id === tractId);
      if (!tract) {
        renderError(root, new Error(`Tract ${tractId} not found in the data.`));
        return;
      }

      _renderTractHeader(root, tract);
      _renderTractSummary(root, tract);
      _renderCrossLinks(root, tract, allTracts);

      // Filter each activity stream to this tract
      const matchTo = (xs) => xs.filter((x) =>
        Array.isArray(x.matched_tract_ids) && x.matched_tract_ids.includes(tractId)
      );

      _renderWells(root, matchTo(wellsDoc.wells || []));
      _renderPermits(root, matchTo(permitsDoc.permits || []));
      _renderCompletions(root, matchTo(completionsDoc.completions || []));
      _renderProduction(root, matchTo(productionDoc.production || []));
      _renderLeasing(root, matchTo(leasingDoc.leases || []));
      _renderRegulatory(root, matchTo(regulatoryDoc.actions || []));

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
    initTract,
  };
})();
