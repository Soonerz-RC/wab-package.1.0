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

      // Asking-price components. Both mineral and ORRI tracts now carry
      // a sales_revenue field, so the package ask is a simple sum across
      // both types. (ORRI sales_revenue is computed at ingest time per
      // spec §4.4: NRA × $3500/NRA for HBP, NRA × $1500/NRA for non-HBP.)
      const mineralAsk = sumOf(minerals, "sales_revenue");
      const orriAsk = sumOf(orris, "sales_revenue");
      const packageAsk = mineralAsk + orriAsk;

      // Average price per NRA across the whole package (mineral NRA + all ORRI NRA).
      // Computed from package-level totals rather than averaging per-tract rates so
      // it reflects the blended $/NRA a buyer would pay on the package as offered.
      const totalPackageNRA = mineralNRA + hbpNRA + nonHbpNRA;
      const avgPricePerNRA = totalPackageNRA > 0 ? packageAsk / totalPackageNRA : 0;

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
      _setText(root, "avg-price-per-nra", "$" + formatNumber(avgPricePerNRA, { decimals: 0 }) + "/NRA");

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

    // (Deal/Type column removed per Gib's review — Notes column replaces it
    // below, after Status. Deal name is still surfaced on tract detail pages
    // and in the tract list's ID-link tooltip / title bar.)

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

    // Status pill (+ optional lease URL link + optional REG badge)
    const statusCell = document.createElement("td");
    statusCell.className = "data-table__cell--status";

    const pill = document.createElement("span");
    pill.className = _pillClassFor(t.status_category);
    pill.textContent = formatStatus(t.status_category);
    pill.title = t.status_raw || formatStatus(t.status_category);

    if (t.lease_url) {
      // Wrap the pill in an outbound link to county records
      const a = document.createElement("a");
      a.href = t.lease_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "pill-link";
      a.title = "View lease document at okcountyrecords.com (opens in new tab)";
      a.appendChild(pill);
      statusCell.appendChild(a);
    } else {
      statusCell.appendChild(pill);
    }

    // Regulatory badge: small "REG ↗" link next to status pill when present
    if (t.regulatory_status) {
      const badge = document.createElement(t.regulatory_url ? "a" : "span");
      badge.className = "reg-badge";
      badge.textContent = "REG";
      if (t.regulatory_url) {
        badge.href = t.regulatory_url;
        badge.target = "_blank";
        badge.rel = "noopener noreferrer";
        const arrow = document.createElement("span");
        arrow.className = "reg-badge__arrow";
        arrow.textContent = "↗";
        badge.appendChild(arrow);
      }
      badge.title = t.regulatory_status + (t.regulatory_url
        ? " — Oseberg filing (opens in new tab)"
        : "");
      statusCell.appendChild(badge);
    }
    tr.appendChild(statusCell);

    // Notes (free-form context from the inventory Notes column)
    if (t.notes) {
      tr.appendChild(_td(t.notes, { cls: "data-table__cell--notes" }));
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--notes data-table__cell--muted" }));
    }

    // Asking (mineral + ORRI both carry sales_revenue per spec §4.3, §4.4).
    // Show the per-NRA rate as a small secondary line beneath the price so
    // buyers can compare tract-level economics at a glance.
    if (t.sales_revenue !== null && t.sales_revenue !== undefined) {
      const priceCell = document.createElement("td");
      priceCell.className = "data-table__cell--num";
      const priceMain = document.createElement("div");
      priceMain.textContent = formatCurrency(t.sales_revenue);
      priceCell.appendChild(priceMain);
      if (t.sales_per_nra !== null && t.sales_per_nra !== undefined) {
        const priceSub = document.createElement("div");
        priceSub.className = "data-table__cell--subline";
        priceSub.textContent = "$" + formatNumber(t.sales_per_nra, { decimals: 0 }) + "/NRA";
        priceCell.appendChild(priceSub);
      }
      tr.appendChild(priceCell);
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

  // -------------------------------------------------------------------------
  // Chart palette (matches the rest of the site's brand tokens)
  // -------------------------------------------------------------------------

  const CHART_COLORS = {
    maroon: "#9b2c31",
    maroonLight: "#c4636a",
    green: "#2f6e3f",
    greenLight: "#4f8a55",
    gray: "#798e8f",
    grayLight: "#c7c7c0",
    bg: "#ffffff",
    bgAlt: "#fafaf8",
    text: "#222222",
    textSecondary: "#54595f",
  };

  // Status -> color mapping (consistent with pill colors elsewhere on the site)
  const STATUS_COLORS = {
    HBP: CHART_COLORS.green,
    LEASED: CHART_COLORS.greenLight,
    NON_PRODUCING: CHART_COLORS.maroon,
    PENDING: CHART_COLORS.maroonLight,
    OPEN: CHART_COLORS.gray,
    OTHER: CHART_COLORS.grayLight,
  };

  function _aggregateBy(rows, keyFn, valueFn) {
    const out = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (k === null || k === undefined) return;
      const v = valueFn(r);
      out.set(k, (out.get(k) || 0) + (v || 0));
    });
    return out;
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

      // Hold chart instances so we can update them on filter changes
      const charts = { status: null, county: null, asking: null };

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

      function _updateTractCharts(rows) {
        if (typeof window.Chart === "undefined") return;

        // --- Status donut: NRA aggregated by status_category ---
        // Ordered for visual stacking (HBP/LEASED first, then maroon group, then gray)
        const STATUS_ORDER = ["HBP", "LEASED", "NON_PRODUCING", "PENDING", "OPEN", "OTHER"];
        const statusBuckets = _aggregateBy(rows, (t) => t.status_category, (t) => t.nra || 0);
        const statusLabels = [];
        const statusData = [];
        const statusColors = [];
        STATUS_ORDER.forEach((s) => {
          if (statusBuckets.has(s) && statusBuckets.get(s) > 0) {
            statusLabels.push(formatStatus(s));
            statusData.push(Number(statusBuckets.get(s).toFixed(2)));
            statusColors.push(STATUS_COLORS[s] || CHART_COLORS.grayLight);
          }
        });
        const totalNRA = rows.reduce((s, t) => s + (t.nra || 0), 0);
        _setText(root, "status-total-nra", formatNumber(totalNRA, { decimals: 1 }));

        const statusCanvas = root.querySelector("#chart-status");
        if (statusCanvas) {
          if (charts.status) {
            charts.status.data.labels = statusLabels;
            charts.status.data.datasets[0].data = statusData;
            charts.status.data.datasets[0].backgroundColor = statusColors;
            charts.status.update();
          } else {
            charts.status = new window.Chart(statusCanvas, {
              type: "doughnut",
              data: {
                labels: statusLabels,
                datasets: [{
                  data: statusData,
                  backgroundColor: statusColors,
                  borderColor: CHART_COLORS.bg,
                  borderWidth: 2,
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "62%",
                plugins: {
                  legend: {
                    position: "bottom",
                    labels: {
                      font: { family: "Roboto, sans-serif", size: 11 },
                      color: CHART_COLORS.textSecondary,
                      boxWidth: 10,
                      boxHeight: 10,
                      padding: 8,
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${ctx.label}: ${formatNumber(ctx.parsed, { decimals: 1 })} NRA`,
                    },
                  },
                },
              },
            });
          }
        }

        // --- County horizontal bar: NRA by county, labelled with section count ---
        // Sections per county = count of unique STRs touching a county.
        const sectionsByCounty = new Map();
        {
          const seen = new Map();
          rows.forEach((t) => {
            if (!seen.has(t.county)) seen.set(t.county, new Set());
            seen.get(t.county).add(t.str);
          });
          seen.forEach((set, county) => sectionsByCounty.set(county, set.size));
        }
        const countyBuckets = _aggregateBy(rows, (t) => t.county, (t) => t.nra || 0);
        const countyEntries = Array.from(countyBuckets.entries())
          .sort((a, b) => b[1] - a[1]);
        const countyLabels = countyEntries.map(([c]) => {
          const sec = sectionsByCounty.get(c) || 0;
          return `${c} · ${sec} sec`;
        });
        const countyData = countyEntries.map(([, nra]) => Number(nra.toFixed(2)));

        const countyCanvas = root.querySelector("#chart-county");
        if (countyCanvas) {
          if (charts.county) {
            charts.county.data.labels = countyLabels;
            charts.county.data.datasets[0].data = countyData;
            charts.county.update();
          } else {
            charts.county = new window.Chart(countyCanvas, {
              type: "bar",
              data: {
                labels: countyLabels,
                datasets: [{
                  data: countyData,
                  backgroundColor: CHART_COLORS.maroon,
                  borderColor: CHART_COLORS.maroon,
                  borderWidth: 0,
                }],
              },
              options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${formatNumber(ctx.parsed.x, { decimals: 1 })} NRA`,
                    },
                  },
                },
                scales: {
                  x: {
                    grid: { color: "#e5e5e0", drawBorder: false },
                    ticks: {
                      font: { family: "Roboto, sans-serif", size: 10 },
                      color: CHART_COLORS.textSecondary,
                    },
                  },
                  y: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                      font: { family: "Roboto, sans-serif", size: 11 },
                      color: CHART_COLORS.text,
                    },
                  },
                },
              },
            });
          }
        }

        // --- Top 10 mineral deals by asking $ (horizontal bar) ---
        const top10Mineral = rows
          .filter((t) => t.type === "mineral" && t.sales_revenue)
          .sort((a, b) => b.sales_revenue - a.sales_revenue)
          .slice(0, 10);
        const top10Labels = top10Mineral.map((t) => `${t.deal_name} (${t.tract_id})`);
        const top10Data = top10Mineral.map((t) => t.sales_revenue);

        const askingCanvas = root.querySelector("#chart-asking");
        if (askingCanvas) {
          if (charts.asking) {
            charts.asking.data.labels = top10Labels;
            charts.asking.data.datasets[0].data = top10Data;
            charts.asking.update();
          } else {
            charts.asking = new window.Chart(askingCanvas, {
              type: "bar",
              data: {
                labels: top10Labels,
                datasets: [{
                  data: top10Data,
                  backgroundColor: CHART_COLORS.maroon,
                  borderWidth: 0,
                }],
              },
              options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => formatCurrency(ctx.parsed.x),
                    },
                  },
                },
                scales: {
                  x: {
                    grid: { color: "#e5e5e0", drawBorder: false },
                    ticks: {
                      font: { family: "Roboto, sans-serif", size: 10 },
                      color: CHART_COLORS.textSecondary,
                      callback: (v) => formatCurrency(v, { compact: true }),
                    },
                  },
                  y: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                      font: { family: "Roboto, sans-serif", size: 10 },
                      color: CHART_COLORS.text,
                      autoSkip: false,
                    },
                  },
                },
              },
            });
          }
        }
      }

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

        // Update orientation charts to reflect the filtered subset
        _updateTractCharts(rows);

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
          _makeMetric(formatCurrency(tract.sales_revenue), "Price")
        );
      }
      if (tract.sales_per_nra !== null && tract.sales_per_nra !== undefined) {
        metrics.push(
          _makeMetric("$" + formatNumber(tract.sales_per_nra, { decimals: 0 }), "$/NRA")
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
      if (tract.sales_revenue) {
        metrics.push(_makeMetric(formatCurrency(tract.sales_revenue), "Price"));
      }
      if (tract.sales_per_nra !== null && tract.sales_per_nra !== undefined) {
        metrics.push(
          _makeMetric("$" + formatNumber(tract.sales_per_nra, { decimals: 0 }), "$/NRA")
        );
      }
    }

    metrics.forEach((m) => host.appendChild(m));
  }

  function _renderRegulatoryCard(root, tract) {
    const section = root.querySelector("[data-regulatory-section]");
    const card = root.querySelector("[data-regulatory-card]");
    if (!section || !card) return;
    _replaceContent(card, []);

    const hasLeaseUrl = !!tract.lease_url;
    const hasReg = !!tract.regulatory_status;
    const hasNotes = !!tract.notes;
    if (!hasLeaseUrl && !hasReg && !hasNotes) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const addRow = (labelText, valueNode) => {
      const dt = document.createElement("dt");
      dt.textContent = labelText;
      card.appendChild(dt);
      const dd = document.createElement("dd");
      if (valueNode instanceof Node) dd.appendChild(valueNode);
      else dd.textContent = valueNode;
      card.appendChild(dd);
    };

    if (hasLeaseUrl) {
      addRow("Lease document", _link("View at okcountyrecords.com", tract.lease_url, { external: true }));
    }
    if (hasReg) {
      let regNode;
      if (tract.regulatory_url) {
        regNode = document.createElement("span");
        regNode.appendChild(document.createTextNode(tract.regulatory_status + " · "));
        regNode.appendChild(_link("View Oseberg filing", tract.regulatory_url, { external: true }));
      } else {
        regNode = document.createTextNode(tract.regulatory_status);
      }
      addRow("Regulatory", regNode);
    }
    if (hasNotes) {
      addRow("Notes", tract.notes);
    }
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
      _renderRegulatoryCard(root, tract);
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
  // Activity page bootstrap
  // -------------------------------------------------------------------------

  // Convert a lease record into a unified activity row
  function _leaseToActivity(l) {
    return {
      activity_id: l.lease_id,
      activity_date: l.recording_date || l.instrument_date || "",
      type: "LEASE",
      type_display: "Lease",
      county: l.county,
      sections: l.sections || [],
      sections_str: (l.sections || []).join(", "),
      parties: [l.lessor, l.lessee].filter(Boolean).join(" → ") || "—",
      summary: l.instrument_type || l.classification || "Lease",
      matched_tract_ids: l.matched_tract_ids || [],
      affects_owned: !!l.affects_owned_tracts,
      url: l.oseberg_url,
      url_label: "OK County Records",
      requires_login: false,
    };
  }

  // Convert a regulatory record into a unified activity row
  function _regToActivity(a) {
    return {
      activity_id: a.action_id,
      activity_date: a.filing_date || a.effective_date || "",
      type: a.type,
      type_display: formatRegulatoryType(a.type),
      county: a.county,
      sections: a.sections || [],
      sections_str: (a.sections || []).join(", "),
      parties: a.applicant || "—",
      summary: a.summary || "—",
      matched_tract_ids: a.matched_tract_ids || [],
      affects_owned: !!a.affects_owned_tracts,
      url: a.oseberg_url,
      url_label: a.cause_number || "view",
      requires_login: !!a.oseberg_url_requires_login,
    };
  }

  function _activityTypePillClass(type) {
    switch (type) {
      case "LEASE":
        return "pill pill--open";  // neutral gray
      case "POOLING_APPLICATION":
      case "SPACING_APPLICATION":
        return "pill pill--pending";  // maroon
      case "POOLING_ORDER":
      case "SPACING_ORDER":
        return "pill pill--hbp";  // green
      case "LOCATION_EXCEPTION":
        return "pill pill--non-producing";  // maroon
      default:
        return "pill pill--other";
    }
  }

  function _activityRow(item) {
    const tr = document.createElement("tr");

    tr.appendChild(_td(formatDate(item.activity_date)));

    const typeCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = _activityTypePillClass(item.type);
    pill.textContent = item.type_display;
    typeCell.appendChild(pill);
    tr.appendChild(typeCell);

    tr.appendChild(_td(item.county));
    tr.appendChild(_td(item.sections_str || "—", { cls: "data-table__cell--str" }));
    tr.appendChild(_td(item.parties));
    tr.appendChild(_td(item.summary));

    // Tracts affected
    if (item.matched_tract_ids && item.matched_tract_ids.length > 0) {
      const td = document.createElement("td");
      item.matched_tract_ids.forEach((tid, idx) => {
        if (idx > 0) td.appendChild(document.createTextNode(", "));
        const a = document.createElement("a");
        a.href = "tract.html?id=" + encodeURIComponent(tid);
        a.textContent = tid;
        a.className = "tract-link";
        td.appendChild(a);
      });
      tr.appendChild(td);
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--muted" }));
    }

    // Source link
    if (item.url) {
      const sourceCell = document.createElement("td");
      sourceCell.appendChild(
        _link(item.url_label, item.url, {
          external: true,
          requiresLogin: item.requires_login,
        })
      );
      tr.appendChild(sourceCell);
    } else {
      tr.appendChild(_td("—", { cls: "data-table__cell--muted" }));
    }

    return tr;
  }

  function _compareActivity(a, b, key, dir) {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
    return dir === "asc" ? cmp : -cmp;
  }

  async function initActivity() {
    const root = document.querySelector("[data-page='activity']");
    if (!root) return;

    try {
      const [leasingDoc, regDoc, metaDoc] = await Promise.all([
        loadJSON("data/leasing.json"),
        loadJSON("data/regulatory.json"),
        loadJSON("data/meta.json").catch(() => null),
      ]);

      // Owned-affecting items only by default. (leasing.json IS already
      // owned-affecting; regulatory.json contains all WAB regulatory and
      // we filter by affects_owned_tracts.)
      const ownedLeases = (leasingDoc.leases || []).map(_leaseToActivity);
      const ownedReg = (regDoc.actions || [])
        .filter((a) => a.affects_owned_tracts)
        .map(_regToActivity);
      const ownedItems = ownedLeases.concat(ownedReg);

      // Market items get lazy-loaded only when the user toggles them on.
      let marketLeases = null;          // null = not yet loaded
      let marketReg = null;
      const marketReg_unfiltered = (regDoc.actions || [])
        .filter((a) => !a.affects_owned_tracts)
        .map(_regToActivity);

      const state = {
        filters: { type: "", county: "", search: "", market: false },
        sort: { key: "activity_date", dir: "desc" },
      };

      // Build the union of counties present (across all loaded data)
      const populateCounties = () => {
        const sel = root.querySelector("select[data-filter='county']");
        // Clear existing (keep "All")
        Array.from(sel.querySelectorAll("option")).forEach((opt, idx) => {
          if (idx > 0) sel.removeChild(opt);
        });
        const collect = [];
        ownedItems.forEach((i) => collect.push(i.county));
        if (marketLeases) marketLeases.forEach((i) => collect.push(i.county));
        if (marketReg_unfiltered.length && state.filters.market) {
          marketReg_unfiltered.forEach((i) => collect.push(i.county));
        }
        const counties = Array.from(new Set(collect.filter(Boolean))).sort();
        counties.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          sel.appendChild(opt);
        });
      };
      populateCounties();

      const filterInputs = root.querySelectorAll("[data-filter]");
      filterInputs.forEach((el) => {
        const ev = el.type === "checkbox" ? "change" : "input";
        el.addEventListener(ev, async () => {
          if (el.dataset.filter === "market") {
            state.filters.market = el.checked;
            if (state.filters.market && !marketLeases) {
              const note = root.querySelector("[data-loading-note]");
              note.hidden = false;
              try {
                const marketDoc = await loadJSON("data/leasing_market.json");
                marketLeases = (marketDoc.leases || [])
                  .filter((l) => !l.affects_owned_tracts)   // owned ones are already in ownedItems
                  .map(_leaseToActivity);
                marketReg = marketReg_unfiltered;
                populateCounties();
              } catch (err) {
                renderError(root, err);
                return;
              } finally {
                note.hidden = true;
              }
            }
          } else {
            state.filters[el.dataset.filter] = el.value;
          }
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
            state.sort.dir = key === "activity_date" ? "desc" : "asc";
          }
          render();
        });
      });

      root.querySelector("[data-action='reset-filters']").addEventListener("click", () => {
        state.filters = { type: "", county: "", search: "", market: false };
        filterInputs.forEach((el) => {
          if (el.type === "checkbox") el.checked = false;
          else el.value = "";
        });
        render();
      });

      function render() {
        // Assemble the active dataset
        let items = ownedItems.slice();
        if (state.filters.market) {
          if (marketLeases) items = items.concat(marketLeases);
          if (marketReg) items = items.concat(marketReg);
        }

        // Apply filters
        const f = state.filters;
        const q = (f.search || "").trim().toLowerCase();
        const rows = items.filter((it) => {
          if (f.type && it.type !== f.type) return false;
          if (f.county && it.county !== f.county) return false;
          if (q) {
            const haystack = [
              it.activity_date, it.type_display, it.county, it.sections_str,
              it.parties, it.summary, (it.matched_tract_ids || []).join(" "),
            ].filter(Boolean).join(" ").toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        });

        // Sort
        rows.sort((a, b) => _compareActivity(a, b, state.sort.key, state.sort.dir));

        // Render tbody
        const tbody = root.querySelector("[data-activity-rows]");
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        rows.forEach((it) => tbody.appendChild(_activityRow(it)));

        // Count
        const total = items.length;
        _setText(
          root,
          "result-count",
          rows.length === total
            ? formatNumber(rows.length)
            : `${formatNumber(rows.length)} of ${formatNumber(total)}`
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
        if (empty) empty.hidden = rows.length !== 0;
      }

      // Set default sort indicator (date desc)
      const dateTh = root.querySelector("[data-sort='activity_date']");
      if (dateTh) dateTh.classList.add("is-sorted-desc");

      render();

      // Footer
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
  // Township coverage page (townships.html)
  // -------------------------------------------------------------------------

  // PLSS section numbering follows a snake pattern. Returns the section number
  // for the cell at logical grid position (row, col), both 0-indexed from
  // top-left.
  function _plssSectionAt(row, col) {
    const PLSS_GRID = [
      [6, 5, 4, 3, 2, 1],
      [7, 8, 9, 10, 11, 12],
      [18, 17, 16, 15, 14, 13],
      [19, 20, 21, 22, 23, 24],
      [30, 29, 28, 27, 26, 25],
      [31, 32, 33, 34, 35, 36],
    ];
    return PLSS_GRID[row][col];
  }

  function _statusToCellClass(category) {
    switch (category) {
      case "HBP": return "twp-cell--hbp";
      case "LEASED": return "twp-cell--leased";
      case "NON_PRODUCING": return "twp-cell--non-producing";
      case "PENDING": return "twp-cell--pending";
      case "OPEN": return "twp-cell--open";
      default: return "twp-cell--other";
    }
  }

  // Pick the most informative status when a section has multiple tracts
  function _dominantStatus(statuses) {
    const priority = ["HBP", "LEASED", "NON_PRODUCING", "PENDING", "OPEN", "OTHER"];
    for (const p of priority) {
      if (statuses.includes(p)) return p;
    }
    return statuses[0] || "OTHER";
  }

  async function initTownships() {
    const root = document.querySelector("[data-page='townships']");
    if (!root) return;

    try {
      const [tractsDoc, productionDoc, regDoc, leasingDoc, wellsDoc, permitsDoc, metaDoc] =
        await Promise.all([
          loadJSON("data/tracts.json"),
          loadJSON("data/production.json"),
          loadJSON("data/regulatory.json"),
          loadJSON("data/leasing.json"),
          loadJSON("data/wells.json"),
          loadJSON("data/permits.json"),
          loadJSON("data/meta.json").catch(() => null),
        ]);
      const allTracts = tractsDoc.tracts || [];

      // Index data by section STR for fast section panel lookups
      const productionBySection = {};
      (productionDoc.production || []).forEach((p) => {
        (p.sections || []).forEach((s) => {
          if (!productionBySection[s]) productionBySection[s] = [];
          productionBySection[s].push(p);
        });
      });
      const regBySection = {};
      (regDoc.actions || []).forEach((a) => {
        (a.sections || []).forEach((s) => {
          if (!regBySection[s]) regBySection[s] = [];
          regBySection[s].push(a);
        });
      });
      const leasingBySection = {};
      (leasingDoc.leases || []).forEach((l) => {
        (l.sections || []).forEach((s) => {
          if (!leasingBySection[s]) leasingBySection[s] = [];
          leasingBySection[s].push(l);
        });
      });
      const wellsBySection = {};
      (wellsDoc.wells || []).forEach((w) => {
        (w.sections || []).forEach((s) => {
          if (!wellsBySection[s]) wellsBySection[s] = [];
          wellsBySection[s].push(w);
        });
      });
      const permitsBySection = {};
      (permitsDoc.permits || []).forEach((p) => {
        (p.sections || []).forEach((s) => {
          if (!permitsBySection[s]) permitsBySection[s] = [];
          permitsBySection[s].push(p);
        });
      });

      // Aggregate tracts by (township_range), then by section number
      // township_range is "12N-23W"; section number parsed from str's leading "NN-"
      const byTownship = {};
      allTracts.forEach((t) => {
        const tr = t.township_range;
        const secNum = parseInt(t.str.split("-")[0], 10);
        if (!byTownship[tr]) {
          byTownship[tr] = { township_range: tr, county: t.county, sections: {} };
        }
        if (!byTownship[tr].sections[secNum]) {
          byTownship[tr].sections[secNum] = [];
        }
        byTownship[tr].sections[secNum].push(t);
      });

      // Populate county filter
      const counties = Array.from(new Set(Object.values(byTownship).map((tw) => tw.county))).sort();
      const countySel = root.querySelector("select[data-filter='county']");
      counties.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        countySel.appendChild(opt);
      });

      const state = { filters: { county: "", show: "" } };

      root.querySelectorAll("[data-filter]").forEach((el) => {
        el.addEventListener("change", () => {
          state.filters[el.dataset.filter] = el.value;
          render();
        });
      });
      root.querySelector("[data-action='reset-filters']").addEventListener("click", () => {
        state.filters = { county: "", show: "" };
        root.querySelectorAll("[data-filter]").forEach((el) => { el.value = ""; });
        render();
      });

      function _sectionPasses(sectionTracts, filter) {
        if (!filter) return true;
        if (filter === "HAS_REG") {
          return sectionTracts.some((t) => !!t.regulatory_status);
        }
        const statuses = sectionTracts.map((t) => t.status_category);
        return statuses.includes(filter);
      }

      function _townshipPasses(township, filters) {
        if (filters.county && township.county !== filters.county) return false;
        if (!filters.show) return true;
        // At least one section must pass the show filter
        return Object.values(township.sections).some(
          (st) => _sectionPasses(st, filters.show)
        );
      }

      function _renderTownshipCard(township, filters) {
        const card = document.createElement("article");
        card.className = "township-card";

        const header = document.createElement("div");
        header.className = "township-card__header";
        const title = document.createElement("h3");
        title.className = "township-card__title";
        title.textContent = township.township_range;
        const county = document.createElement("span");
        county.className = "township-card__county";
        county.textContent = township.county;
        header.appendChild(title);
        header.appendChild(county);
        card.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "twp-grid";
        // Render 6x6 cells in the PLSS snake order
        for (let r = 0; r < 6; r++) {
          for (let c = 0; c < 6; c++) {
            const sec = _plssSectionAt(r, c);
            const cell = document.createElement("div");
            cell.className = "twp-cell";
            const secTracts = township.sections[sec] || [];
            if (secTracts.length > 0) {
              const passes = _sectionPasses(secTracts, filters.show);
              const dominant = _dominantStatus(secTracts.map((t) => t.status_category));
              cell.classList.add("twp-cell--owned", _statusToCellClass(dominant));
              if (!passes && filters.show) {
                cell.classList.add("twp-cell--filtered");
              }
              const hasReg = secTracts.some((t) => !!t.regulatory_status);
              if (hasReg) cell.classList.add("twp-cell--has-reg");
              const tractCount = secTracts.length;
              cell.title = `Section ${sec} · ${tractCount} owned tract${tractCount > 1 ? "s" : ""} (${formatStatus(dominant)})`;
              cell.dataset.section = sec;
              cell.dataset.str = `${String(sec).padStart(2, "0")}-${township.township_range}`;
              cell.addEventListener("click", () => {
                if (!cell.classList.contains("twp-cell--filtered")) {
                  _openSectionPanel(cell.dataset.str, secTracts);
                }
              });
            } else {
              cell.title = `Section ${sec} · not owned`;
            }
            const num = document.createElement("div");
            num.className = "sec-num";
            num.textContent = String(sec);
            cell.appendChild(num);
            if (secTracts.length > 0) {
              const cnt = document.createElement("div");
              cnt.className = "sec-count";
              cnt.textContent = secTracts.length + " tr";
              cell.appendChild(cnt);
            }
            grid.appendChild(cell);
          }
        }
        card.appendChild(grid);

        // Footer stats
        const ownedSecs = Object.keys(township.sections).length;
        const allTractsInTwp = Object.values(township.sections).flat();
        const hbpCount = allTractsInTwp.filter((t) => t.status_category === "HBP").length;
        const totalNRA = allTractsInTwp.reduce((s, t) => s + (t.nra || 0), 0);
        const footer = document.createElement("div");
        footer.className = "township-card__footer";
        const left = document.createElement("span");
        left.textContent = `${ownedSecs}/36 sec · ${hbpCount} HBP`;
        const right = document.createElement("span");
        right.textContent = `${formatNumber(totalNRA, { decimals: 1 })} NRA`;
        footer.appendChild(left);
        footer.appendChild(right);
        card.appendChild(footer);
        return card;
      }

      function render() {
        const host = root.querySelector("[data-townships-grid]");
        _replaceContent(host, []);

        const townships = Object.values(byTownship)
          .filter((tw) => _townshipPasses(tw, state.filters))
          .sort((a, b) => {
            if (a.county !== b.county) return a.county.localeCompare(b.county);
            return a.township_range.localeCompare(b.township_range);
          });

        if (townships.length === 0) {
          const empty = root.querySelector("[data-text='empty-state']");
          empty.hidden = false;
          return;
        }
        root.querySelector("[data-text='empty-state']").hidden = true;
        townships.forEach((tw) => host.appendChild(_renderTownshipCard(tw, state.filters)));

        // Hero stats
        const totalSections = townships.reduce((s, tw) => s + Object.keys(tw.sections).length, 0);
        _setText(
          root,
          "hero-stats",
          `${formatNumber(totalSections)} owned sections across ${townships.length} unique township${townships.length === 1 ? "" : "s"} in ${new Set(townships.map((tw) => tw.county)).size} counties`
        );
      }

      // Slide-out panel
      function _openSectionPanel(str, sectionTracts) {
        const panel = root.parentNode.querySelector("[data-section-panel]") ||
                      document.querySelector("[data-section-panel]");
        const backdrop = document.querySelector("[data-section-panel-backdrop]");
        const content = document.querySelector("[data-section-panel-content]");
        if (!panel || !content) return;

        _replaceContent(content, []);

        // Header
        const t0 = sectionTracts[0];
        const h = document.createElement("h2");
        h.className = "section-panel__title";
        h.textContent = `Section ${parseInt(t0.str.split("-")[0], 10)} · ${t0.township_range}`;
        content.appendChild(h);

        const sub = document.createElement("p");
        sub.className = "section-panel__subtitle";
        sub.textContent = `${t0.county} County · STR ${t0.str}`;
        content.appendChild(sub);

        const _section = (heading, contentNodes) => {
          const sec = document.createElement("section");
          sec.className = "section-panel__section";
          const h3 = document.createElement("h3");
          h3.className = "section-panel__heading";
          h3.textContent = heading;
          sec.appendChild(h3);
          if (contentNodes.length === 0) {
            const e = document.createElement("p");
            e.className = "section-panel__empty";
            e.textContent = "None.";
            sec.appendChild(e);
          } else {
            const ul = document.createElement("ul");
            ul.className = "section-panel__list";
            contentNodes.forEach((n) => ul.appendChild(n));
            sec.appendChild(ul);
          }
          return sec;
        };

        // Owned tracts list
        const tractItems = sectionTracts.map((t) => {
          const li = document.createElement("li");
          const link = document.createElement("a");
          link.className = "section-panel__list-id";
          link.href = "tract.html?id=" + encodeURIComponent(t.tract_id);
          link.textContent = t.tract_id;
          li.appendChild(link);
          const meta = document.createElement("span");
          if (t.type === "mineral") {
            meta.textContent = `${t.deal_name} · ${formatNumber(t.nra, { decimals: 2 })} NRA · ${formatStatus(t.status_category)}`;
          } else {
            meta.textContent = `ORRI · ${formatNumber(t.nra, { decimals: 2 })} NRA · ${formatStatus(t.status_category)}`;
          }
          li.appendChild(meta);
          return li;
        });
        content.appendChild(_section(`Owned tracts (${sectionTracts.length})`, tractItems));

        // Producing leases
        const prod = productionBySection[str] || [];
        const prodItems = prod.map((p) => {
          const li = document.createElement("li");
          const name = document.createElement("strong");
          name.textContent = (p.lease_name || p.production_id) + " · " + (p.operator || "—");
          li.appendChild(name);
          li.appendChild(document.createElement("br"));
          const stats = document.createElement("span");
          stats.style.fontSize = "12px";
          stats.style.color = "var(--color-text-secondary)";
          stats.textContent = `Cum: ${formatNumber(p.cumulative_oil_bbl, { decimals: 0 })} bbl + ${formatNumber(p.cumulative_gas_mcf, { decimals: 0 })} mcf · Last prod ${formatDate(p.last_prod_date)}`;
          li.appendChild(stats);
          return li;
        });
        content.appendChild(_section(`Producing leases (${prod.length})`, prodItems));

        // Wells
        const wells = wellsBySection[str] || [];
        const wellItems = wells.slice(0, 10).map((w) => {
          const li = document.createElement("li");
          li.textContent = `${w.well_id} · ${w.well_name || "—"} · ${w.operator || "—"} (${w.well_status || "—"})`;
          return li;
        });
        if (wells.length > 10) {
          const more = document.createElement("li");
          more.className = "section-panel__empty";
          more.textContent = `… and ${wells.length - 10} more`;
          wellItems.push(more);
        }
        content.appendChild(_section(`Wells (${wells.length})`, wellItems));

        // Permits
        const perms = permitsBySection[str] || [];
        const permItems = perms.slice(0, 5).map((p) => {
          const li = document.createElement("li");
          li.textContent = `${p.permit_number || p.permit_id} · ${formatDate(p.permit_date)} · ${p.operator || "—"}`;
          return li;
        });
        if (perms.length > 5) {
          const more = document.createElement("li");
          more.className = "section-panel__empty";
          more.textContent = `… and ${perms.length - 5} more`;
          permItems.push(more);
        }
        content.appendChild(_section(`OCC / BLM permits (${perms.length})`, permItems));

        // Regulatory
        const regs = regBySection[str] || [];
        const regItems = regs.slice(0, 5).map((r) => {
          const li = document.createElement("li");
          li.textContent = `[${formatDate(r.filing_date)}] ${formatRegulatoryType(r.type)} · ${r.applicant || "—"} (cause ${r.cause_number || "—"})`;
          return li;
        });
        if (regs.length > 5) {
          const more = document.createElement("li");
          more.className = "section-panel__empty";
          more.textContent = `… and ${regs.length - 5} more`;
          regItems.push(more);
        }
        content.appendChild(_section(`OCC regulatory actions (${regs.length})`, regItems));

        // Recent leasing on owned tracts
        const leasesHere = (leasingBySection[str] || []).slice(0, 5);
        const leaseItems = leasesHere.map((l) => {
          const li = document.createElement("li");
          li.textContent = `[${formatDate(l.recording_date)}] ${l.lessor || "—"} → ${l.lessee || "—"}`;
          return li;
        });
        if ((leasingBySection[str] || []).length > 5) {
          const more = document.createElement("li");
          more.className = "section-panel__empty";
          more.textContent = `… and ${(leasingBySection[str] || []).length - 5} more`;
          leaseItems.push(more);
        }
        content.appendChild(_section(`Recent leasing on owned tracts (${(leasingBySection[str] || []).length})`, leaseItems));

        panel.hidden = false;
        panel.setAttribute("aria-hidden", "false");
        backdrop.hidden = false;
      }

      function _closeSectionPanel() {
        const panel = document.querySelector("[data-section-panel]");
        const backdrop = document.querySelector("[data-section-panel-backdrop]");
        if (panel) {
          panel.hidden = true;
          panel.setAttribute("aria-hidden", "true");
        }
        if (backdrop) backdrop.hidden = true;
      }

      document.querySelector("[data-section-panel-close]")?.addEventListener("click", _closeSectionPanel);
      document.querySelector("[data-section-panel-backdrop]")?.addEventListener("click", _closeSectionPanel);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") _closeSectionPanel();
      });

      render();

      // Footer
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
  // Wells page (wells.html)
  // -------------------------------------------------------------------------

  // Formation classification: normalize the raw formation/reservoir text from
  // completions.json (formation) or production.json (reservoir_name) into one
  // of the canonical categories the filter dropdown exposes. Matching is
  // substring-based and order-sensitive (Red Fork before Cherokee since Red
  // Fork is within the Cherokee Group nomenclature).
  function _classifyFormation(rawText) {
    if (!rawText) return "OTHER";
    const t = String(rawText).toUpperCase();
    if (t.includes("RED FORK") || t.includes("REDFORK")) return "REDFORK";
    if (t.includes("CHEROKEE")) return "CHEROKEE";
    if (t.includes("GRANITE WASH") || t.includes("GRANITE")) return "GRANITE_WASH";
    if (t.includes("CLEVELAND")) return "CLEVELAND";
    if (t.includes("TONKAWA")) return "TONKAWA";
    if (t.includes("ATOKA")) return "ATOKA";
    return "OTHER";
  }

  function _formationLabel(category) {
    switch (category) {
      case "CHEROKEE":     return "Cherokee";
      case "REDFORK":      return "Red Fork";
      case "GRANITE_WASH": return "Granite Wash";
      case "CLEVELAND":    return "Cleveland";
      case "TONKAWA":      return "Tonkawa";
      case "ATOKA":        return "Atoka";
      default:             return "Other / Unknown";
    }
  }

  function _formationColor(category) {
    switch (category) {
      case "CHEROKEE":     return "#9b2c31";  // maroon
      case "REDFORK":      return "#c4636a";  // maroon-light
      case "GRANITE_WASH": return "#2f6e3f";  // green
      case "CLEVELAND":    return "#4f8a55";  // green-mid
      case "TONKAWA":      return "#798e8f";  // teal-gray
      case "ATOKA":        return "#54595f";  // dark gray
      default:             return "#c7c7c0";  // light gray
    }
  }

  // Build a circle marker for a well, sized by lateral length and
  // colored by formation. "Key" wells (Cherokee/Red Fork in last 5 yrs)
  // get a thicker outline.
  function _wellMarker(well, isKey) {
    const color = _formationColor(well.formation_category);
    const ll = well.lateral_length_ft || 0;
    // Marker radius: 4 to 9 px based on lateral length
    const radius = ll ? Math.max(4, Math.min(9, 4 + (ll / 12000) * 5)) : 4;
    const opts = {
      radius: radius,
      color: isKey ? "#222222" : color,
      weight: isKey ? 2 : 1,
      fillColor: color,
      fillOpacity: 0.85,
    };
    return window.L.circleMarker([well.lat, well.lon], opts);
  }

  function _wellPopupHtml(well, ownedTractIds) {
    // Build the popup DOM safely (no innerHTML on untrusted data)
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "well-popup__title";
    title.textContent = well.well_name || well.well_id || "Well";
    wrap.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "well-popup__subtitle";
    sub.textContent = `API ${well.well_id || "—"} · ${well.county || "—"}`;
    wrap.appendChild(sub);

    const kv = document.createElement("dl");
    kv.className = "well-popup__kv";
    const row = (k, v) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      if (v instanceof Node) dd.appendChild(v);
      else dd.textContent = v == null ? "—" : String(v);
      kv.appendChild(dt);
      kv.appendChild(dd);
    };
    row("Operator", well.operator || "—");
    row("Formation", _formationLabel(well.formation_category));
    row("Profile", well.wellbore_profile || "—");
    row("Spud", formatDate(well.spud_date));
    row("Completion", formatDate(well.completion_date));
    row("Lateral length", well.lateral_length_ft ? formatNumber(well.lateral_length_ft) + " ft" : "—");
    row("Status", well.well_status || "—");
    if (well.cumulative_oil_bbl) row("Cum oil", formatNumber(well.cumulative_oil_bbl, { decimals: 0 }) + " bbl");
    if (well.cumulative_gas_mcf) row("Cum gas", formatNumber(well.cumulative_gas_mcf, { decimals: 0 }) + " mcf");
    wrap.appendChild(kv);

    const footer = document.createElement("div");
    footer.className = "well-popup__footer";
    if (ownedTractIds && ownedTractIds.length) {
      const span = document.createElement("span");
      span.style.color = "var(--color-text-secondary)";
      span.appendChild(document.createTextNode("Owned overlap: "));
      ownedTractIds.forEach((tid, i) => {
        if (i > 0) span.appendChild(document.createTextNode(", "));
        const a = document.createElement("a");
        a.href = "tract.html?id=" + encodeURIComponent(tid);
        a.textContent = tid;
        span.appendChild(a);
      });
      footer.appendChild(span);
    }
    if (well.oseberg_url) {
      if (footer.firstChild) footer.appendChild(document.createElement("br"));
      const a = _link("View OCC record", well.oseberg_url, { external: true });
      footer.appendChild(a);
    }
    if (footer.firstChild) wrap.appendChild(footer);
    return wrap;
  }

  async function initWells() {
    const root = document.querySelector("[data-page='wells']");
    if (!root) return;
    if (typeof window.L === "undefined") {
      renderError(root, new Error("Leaflet failed to load. Check network connectivity to unpkg.com."));
      return;
    }

    try {
      const [wellsDoc, completionsDoc, productionDoc, tractsDoc, metaDoc] = await Promise.all([
        loadJSON("data/wells.json"),
        loadJSON("data/completions.json"),
        loadJSON("data/production.json"),
        loadJSON("data/tracts.json"),
        loadJSON("data/meta.json").catch(() => null),
      ]);
      const allWells = wellsDoc.wells || [];
      const completions = completionsDoc.completions || [];
      const production = productionDoc.production || [];
      const tracts = tractsDoc.tracts || [];

      // Build owned-section -> tract IDs lookup
      const ownedByStr = {};
      tracts.forEach((t) => {
        if (!ownedByStr[t.str]) ownedByStr[t.str] = [];
        ownedByStr[t.str].push(t.tract_id);
      });

      // Build well -> formation lookup. Prefer completion's formation;
      // fall back to production's reservoir_name when no completion match.
      const formationByApi = {};
      completions.forEach((c) => {
        if (c.well_id && c.formation && !formationByApi[c.well_id]) {
          formationByApi[c.well_id] = c.formation;
        }
      });
      // Fallback: production lease records carry api_numbers[] and reservoir_name.
      production.forEach((p) => {
        const reservoir = p.reservoir_name;
        if (!reservoir) return;
        (p.api_numbers || []).forEach((api) => {
          if (!formationByApi[api]) formationByApi[api] = reservoir;
        });
      });

      // Build well -> {cum_oil, cum_gas} via the lease-level production data.
      // Note: per-well-per-month rate data isn't available; we use the lease
      // sums as a proxy when the well is the only one on the lease, otherwise
      // we just expose the lease totals as a contextual hint.
      const prodByApi = {};
      production.forEach((p) => {
        (p.api_numbers || []).forEach((api) => {
          if (!prodByApi[api]) {
            prodByApi[api] = {
              cumulative_oil_bbl: p.cumulative_oil_bbl,
              cumulative_gas_mcf: p.cumulative_gas_mcf,
              last_prod_date: p.last_prod_date,
              lease_name: p.lease_name,
            };
          }
        });
      });

      // Enrich each well with formation, owned-tract overlap, and cum production
      const enriched = allWells.map((w) => {
        const rawFormation = formationByApi[w.well_id] || null;
        const formation_category = _classifyFormation(rawFormation);
        const overlap = [];
        (w.sections || []).forEach((s) => {
          (ownedByStr[s] || []).forEach((tid) => {
            if (!overlap.includes(tid)) overlap.push(tid);
          });
        });
        const prod = prodByApi[w.well_id] || {};
        return {
          ...w,
          formation_raw: rawFormation,
          formation_category,
          owned_tract_ids: overlap,
          cumulative_oil_bbl: prod.cumulative_oil_bbl || null,
          cumulative_gas_mcf: prod.cumulative_gas_mcf || null,
        };
      });

      // Populate filter dropdowns
      const counties = Array.from(new Set(enriched.map((w) => w.county).filter(Boolean))).sort();
      const countySel = root.querySelector("select[data-filter='county']");
      counties.forEach((c) => {
        const o = document.createElement("option");
        o.value = c; o.textContent = c; countySel.appendChild(o);
      });
      const operators = Array.from(new Set(enriched.map((w) => w.operator).filter(Boolean))).sort();
      const opSel = root.querySelector("select[data-filter='operator']");
      operators.forEach((o) => {
        const el = document.createElement("option");
        el.value = o; el.textContent = o; opSel.appendChild(el);
      });

      // Initial filter state — defaults per Gib's prompt
      const state = {
        filters: {
          formation: "CHEROKEE_OR_REDFORK",
          vintage: "5",
          county: "",
          operator: "",
          "min-ll": "",
          search: "",
        },
      };

      const filterInputs = root.querySelectorAll("[data-filter]");
      filterInputs.forEach((el) => {
        const ev = el.tagName === "SELECT" ? "change" : "input";
        if (state.filters[el.dataset.filter] !== undefined && el.tagName === "SELECT") {
          el.value = state.filters[el.dataset.filter];
        }
        el.addEventListener(ev, () => {
          state.filters[el.dataset.filter] = el.value;
          render();
        });
      });
      root.querySelector("[data-action='reset-filters']").addEventListener("click", () => {
        state.filters = {
          formation: "CHEROKEE_OR_REDFORK",
          vintage: "5",
          county: "",
          operator: "",
          "min-ll": "",
          search: "",
        };
        filterInputs.forEach((el) => {
          if (state.filters[el.dataset.filter] !== undefined) {
            el.value = state.filters[el.dataset.filter];
          } else {
            el.value = "";
          }
        });
        render();
      });

      // Initialize Leaflet map. Center on the mean of well lat/lons.
      const validCoords = enriched.filter((w) => w.lat && w.lon);
      const meanLat = validCoords.reduce((s, w) => s + w.lat, 0) / Math.max(1, validCoords.length);
      const meanLon = validCoords.reduce((s, w) => s + w.lon, 0) / Math.max(1, validCoords.length);
      const map = window.L.map("wells-map", {
        center: [meanLat || 35.7, meanLon || -99.5],
        zoom: 9,
        scrollWheelZoom: true,
      });
      window.L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 18,
        }
      ).addTo(map);

      // Layer group for filtered well markers (cleared & re-added on each render)
      const markerLayer = window.L.layerGroup().addTo(map);

      function _wellPasses(w, f) {
        // Formation
        if (f.formation === "CHEROKEE_OR_REDFORK") {
          if (w.formation_category !== "CHEROKEE" && w.formation_category !== "REDFORK") return false;
        } else if (f.formation && w.formation_category !== f.formation) {
          return false;
        }
        // Vintage
        const years = parseInt(f.vintage, 10);
        if (years && w.spud_date) {
          const today = new Date();
          const spud = new Date(w.spud_date + "T00:00:00Z");
          const cutoff = new Date(today.getTime() - years * 365 * 24 * 3600 * 1000);
          if (spud < cutoff) return false;
        } else if (years && !w.spud_date) {
          // No spud date — drop when a vintage filter is active
          return false;
        }
        // County
        if (f.county && w.county !== f.county) return false;
        // Operator
        if (f.operator && w.operator !== f.operator) return false;
        // Min LL
        const minLl = parseFloat(f["min-ll"]);
        if (!isNaN(minLl) && minLl > 0) {
          if (!w.lateral_length_ft || w.lateral_length_ft < minLl) return false;
        }
        // Search
        const q = (f.search || "").trim().toLowerCase();
        if (q) {
          const haystack = [
            w.well_id, w.well_name, w.operator, w.county, w.formation_raw,
            (w.owned_tract_ids || []).join(" "),
          ].filter(Boolean).join(" ").toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      }

      function _renderMap(filteredWells) {
        markerLayer.clearLayers();
        const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000);
        filteredWells.forEach((w) => {
          if (!w.lat || !w.lon) return;
          const isCherryRF = w.formation_category === "CHEROKEE" || w.formation_category === "REDFORK";
          const isRecent = w.spud_date && new Date(w.spud_date + "T00:00:00Z") >= fiveYearsAgo;
          const isKey = isCherryRF && isRecent;
          const marker = _wellMarker(w, isKey);
          marker.bindPopup(_wellPopupHtml(w, w.owned_tract_ids));
          markerLayer.addLayer(marker);
        });
      }

      function _renderKPIs(filteredWells) {
        const total = filteredWells.length;
        const cherokee = filteredWells.filter((w) => w.formation_category === "CHEROKEE").length;
        const redfork = filteredWells.filter((w) => w.formation_category === "REDFORK").length;
        const ops = new Set(filteredWells.map((w) => w.operator).filter(Boolean)).size;
        const llVals = filteredWells.map((w) => w.lateral_length_ft).filter((v) => typeof v === "number" && v > 0);
        const avgLl = llVals.length ? llVals.reduce((s, v) => s + v, 0) / llVals.length : 0;
        const cumOilBbl = filteredWells.reduce((s, w) => s + (w.cumulative_oil_bbl || 0), 0);
        _setKpi(root, "total", formatNumber(total));
        _setKpi(root, "cherokee", formatNumber(cherokee));
        _setKpi(root, "redfork", formatNumber(redfork));
        _setKpi(root, "operators", formatNumber(ops));
        _setKpi(root, "avg-ll", avgLl ? formatNumber(avgLl, { decimals: 0 }) : "—");
        _setKpi(root, "cum-oil", cumOilBbl
          ? formatNumber(cumOilBbl / 1000, { decimals: 0 })  // MBBL
          : "—");
      }

      function _wellSortableValue(w, key) {
        if (key === "api") return w.well_id;
        if (key === "formation") return _formationLabel(w.formation_category);
        return w[key];
      }

      const tableSort = { key: "spud_date", dir: "desc" };
      root.querySelectorAll("[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const k = th.dataset.sort;
          if (tableSort.key === k) tableSort.dir = tableSort.dir === "asc" ? "desc" : "asc";
          else { tableSort.key = k; tableSort.dir = "asc"; }
          render();
        });
      });

      function _renderTable(filteredWells) {
        const rows = filteredWells.slice().sort((a, b) => {
          const av = _wellSortableValue(a, tableSort.key);
          const bv = _wellSortableValue(b, tableSort.key);
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (typeof av === "number" && typeof bv === "number") {
            return tableSort.dir === "asc" ? av - bv : bv - av;
          }
          const cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
          return tableSort.dir === "asc" ? cmp : -cmp;
        });
        const tbody = root.querySelector("[data-wells-rows]");
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        rows.forEach((w) => {
          const tr = document.createElement("tr");
          // API as link to OCC record
          const apiTd = document.createElement("td");
          apiTd.className = "data-table__cell--id";
          apiTd.appendChild(_link(w.well_id, w.oseberg_url, { external: !!w.oseberg_url }));
          tr.appendChild(apiTd);
          tr.appendChild(_td(w.well_name));
          tr.appendChild(_td(w.operator));
          // Formation cell with little color dot
          const fmCell = document.createElement("td");
          const dot = document.createElement("span");
          dot.style.cssText = `display:inline-block;width:9px;height:9px;background:${_formationColor(w.formation_category)};margin-right:6px;vertical-align:middle;`;
          fmCell.appendChild(dot);
          fmCell.appendChild(document.createTextNode(_formationLabel(w.formation_category)));
          tr.appendChild(fmCell);
          tr.appendChild(_td(w.county));
          tr.appendChild(_td(formatDate(w.spud_date)));
          tr.appendChild(_td(w.lateral_length_ft ? formatNumber(w.lateral_length_ft) : "—",
                             { cls: "data-table__cell--num" }));
          tr.appendChild(_td(w.cumulative_oil_bbl ? formatNumber(w.cumulative_oil_bbl, { decimals: 0 }) : "—",
                             { cls: "data-table__cell--num" }));
          tr.appendChild(_td(w.cumulative_gas_mcf ? formatNumber(w.cumulative_gas_mcf, { decimals: 0 }) : "—",
                             { cls: "data-table__cell--num" }));
          // Owned overlap
          if (w.owned_tract_ids && w.owned_tract_ids.length) {
            const td = document.createElement("td");
            w.owned_tract_ids.forEach((tid, i) => {
              if (i > 0) td.appendChild(document.createTextNode(", "));
              const a = document.createElement("a");
              a.href = "tract.html?id=" + encodeURIComponent(tid);
              a.textContent = tid;
              td.appendChild(a);
            });
            tr.appendChild(td);
          } else {
            tr.appendChild(_td("—", { cls: "data-table__cell--muted" }));
          }
          tbody.appendChild(tr);
        });
        // Sort indicator
        root.querySelectorAll("[data-sort]").forEach((th) => {
          th.classList.remove("is-sorted-asc", "is-sorted-desc");
          if (th.dataset.sort === tableSort.key) {
            th.classList.add(tableSort.dir === "asc" ? "is-sorted-asc" : "is-sorted-desc");
          }
        });
        _setText(root, "table-count", `${rows.length} of ${enriched.length}`);
      }

      function render() {
        const filtered = enriched.filter((w) => _wellPasses(w, state.filters));
        _renderKPIs(filtered);
        _renderMap(filtered);
        _renderTable(filtered);
        _setText(
          root,
          "hero-stats",
          `${formatNumber(filtered.length)} wells in current view — across ${new Set(filtered.map(w => w.operator).filter(Boolean)).size} operators`
        );
        const empty = root.querySelector("[data-text='empty-state']");
        if (empty) empty.hidden = filtered.length !== 0;
      }

      render();

      // Footer
      if (metaDoc) {
        _setText(root, "data-asof", formatDate(metaDoc.generated_at || ""));
        _setText(root, "inventory-file", metaDoc.inventory_file || "—");
        _setText(root, "oseberg-folder", metaDoc.oseberg_folder || "—");
      }
    } catch (err) {
      renderError(root, err);
    }
  }

  function _setKpi(root, key, val) {
    const el = root.querySelector(`[data-kpi='${key}']`);
    if (el) el.textContent = val;
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
    initActivity,
    initTownships,
    initWells,
  };
})();
