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
      const totalAsk = sumOf(minerals, "sales_revenue");

      // Big-number values
      _setMetric(root, "total-sections", formatNumber(totalSections));
      _setMetric(root, "mineral-sections", formatNumber(mineralSections));
      _setMetric(root, "hbp-orri-sections", formatNumber(hbpOrriSections));
      _setMetric(root, "nonhbp-orri-sections", formatNumber(nonHbpOrriSections));
      _setMetric(root, "total-ask", formatCurrency(totalAsk, { compact: true }));

      // Sub-number values (label/value pairs inside each card)
      _setText(root, "mineral-nma", formatNumber(mineralNMA, { decimals: 1 }));
      _setText(root, "mineral-nra", formatNumber(mineralNRA, { decimals: 1 }));
      _setText(root, "hbp-orri-nra", formatNumber(hbpNRA, { decimals: 1 }));
      _setText(root, "nonhbp-orri-nra", formatNumber(nonHbpNRA, { decimals: 1 }));

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
  // Tracts page bootstrap (placeholder — built in Phase 5 part 2)
  // -------------------------------------------------------------------------

  async function initTracts() {
    // Implemented when tracts.html is built.
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
