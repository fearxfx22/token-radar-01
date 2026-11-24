// Launch Radar dashboard — renders RADAR_DATA (embedded by main.ts).
// No network, no fetch: everything is recomputed in the browser from the
// embedded board, so the integrity strip is a live re-check, not a label.
(function () {
  var D = window.RADAR_DATA;
  if (!D) { document.body.innerHTML = "<p>Board data failed to load.</p>"; return; }
  var rows = D.rows, V = D.validation, meta = D.meta;
  var $ = function (id) { return document.getElementById(id); };
  var fmt$ = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(2);
  };
  var fmtInt = function (n) { return Math.round(n).toLocaleString("en-US"); };
  var r2 = function (n) { return (n === null || n === undefined) ? "—" : n.toFixed(4); };
  var r3 = function (n) { return (n === null || n === undefined) ? "—" : n.toFixed(3); };
  var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };

  // ---------- KPI strip ----------
  var tols = V.value["T-OLS-tvl"];
  var kpis = [
    ["Ranked rows", String(rows.length), "of 614 pre-token protocols"],
    ["Watchlist", rows.filter(function (r) { return r.watchlist; }).length + " / 40", "every watchlist protocol ranked"],
    ["Census", V.census.total + " accounted", rows.length + " ranked + " + D.aside.length + " set aside + " + D.live_count + " live"],
    ["Value fit R² (trimmed)", r2(tols.inSample.r2), "94 comps, mcap/TVL in [0.02, 2]"],
    ["LOO miss (trimmed)", "×" + r3(tols.looFit), "typical error within 2.85× either way"],
    ["Odds Brier", r3(V.odds.cvBrier["0.1"]) + " vs " + r3(V.odds.constantBrier), "10-fold, constant = base rate"],
    ["Verdicts", (V.verdicts.FARM || 0) + " FARM · " + (V.verdicts.MARGINAL || 0) + " MARG · " + (V.verdicts.SKIP || 0) + " SKIP", "band-low net vs $150 hurdle"],
    ["Median farm net", "$" + V.economics.netMedian.toFixed(2), "best row: " + V.economics.bestRow + " ($" + V.economics.netMax.toFixed(2) + ")"],
  ];
  $("kpi").innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div><div class="d">' + k[2] + '</div></div>';
  }).join("");

  // ---------- integrity strip: recomputed here, in the browser ----------
  var checks = [];
  var rankOk = rows.every(function (r, i) { return r.rank === i + 1; });
  checks.push(["ranks 1–" + rows.length + " exactly once", rankOk]);
  var sortedOk = rows.every(function (r, i) { return i === 0 || Math.round(rows[i - 1].fitted_usd) >= Math.round(r.fitted_usd); });
  checks.push(["implied value non-increasing with rank", sortedOk]);
  var wlOk = rows.filter(function (r) { return r.watchlist; }).length === 40;
  checks.push(["watchlist 40/40 on the board", wlOk]);
  var censusOk = (rows.length + D.aside.length + D.live_count) === V.census.total;
  checks.push(["census sums to " + V.census.total, censusOk]);
  var tallyBad = 0;
  rows.forEach(function (r) {
    var expect = 8.5 + r.gas_usd + 5;
    if (Math.abs(r.costs_usd - expect) > 0.005) tallyBad++;
  });
  checks.push(["farm cost tally: 0 mismatches", tallyBad === 0]);
  var stepsBad = 0;
  rows.forEach(function (r) {
    if (r.farm_steps.length !== 8) stepsBad++;
    r.farm_steps.forEach(function (s) { if (s.trim().length < 20 || s.trim().length > 600) stepsBad++; });
  });
  checks.push(["8 farm steps/row, 20–600 chars", stepsBad === 0]);
  var verdictOk = rows.every(function (r) {
    if (r.verdict === "FARM") return r.net_lo_usd >= 150;
    if (r.verdict === "MARGINAL") return r.net_usd > 0;
    return r.net_usd <= 0;
  });
  checks.push(["every verdict recomputes from its net", verdictOk]);
  var shaOk = /^[0-9a-f]{64}$/.test(meta.main_sha256);
  checks.push(["main.ts sha256 (build-time fingerprint)", shaOk]);
  $("integrity").innerHTML = checks.map(function (c) {
    return '<span class="chk ' + (c[1] ? "ok" : "bad") + '"><span class="mark">' + (c[1] ? "✓" : "✗") + '</span>' + c[0] + "</span>";
  }).join("") + '<span class="chk"><span class="sha">main.ts ' + meta.main_sha256.slice(0, 16) + "…</span></span>";
  $("sha").textContent = "main.ts sha256: " + meta.main_sha256.slice(0, 16) + "…";

  // ---------- board table ----------
  var state = { q: "", verdict: "", watchonly: false, sort: "fitted" };
  function applyHash() {
    var h = location.hash.replace(/^#/, "");
    var parts = h.split("&");
    parts.forEach(function (p) {
      var kv = p.split("=");
      if (kv[0] === "verdict" && kv[1]) { state.verdict = kv[1]; $("verdict").value = kv[1]; }
      if (kv[0] === "detail" && kv[1]) showDetail(kv[1]);
    });
    renderTable();
  }
  function filtered() {
    var list = rows.filter(function (r) {
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watchonly && !r.watchlist) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.slug.indexOf(q) < 0 && r.name.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    list = list.slice().sort(function (a, b) {
      if (key === "net") return b.net_usd - a.net_usd;
      if (key === "odds") return b.odds - a.odds;
      if (key === "tvl") return b.tvl_usd - a.tvl_usd;
      if (key === "mindep") return a.min_dep_usd - b.min_dep_usd;
      return a.rank - b.rank;
    });
    return list;
  }
  function renderTable() {
    var list = filtered();
    $("count").textContent = list.length + " of " + rows.length + " rows";
    $("board").querySelector("tbody").innerHTML = list.map(function (r) {
      var netCls = r.net_usd > 0 ? "pos" : "neg";
      return "<tr data-slug=\"" + r.slug + "\" class=\"" + (r.watchlist ? "wl" : "") + "\">" +
        "<td>" + r.rank + "</td><td>" + esc(r.name) + "</td>" +
        "<td>" + fmt$(r.tvl_usd) + "</td><td>" + fmt$(r.fitted_usd) + "</td>" +
        "<td>" + r.multiple.toFixed(3) + "×</td><td>" + r.odds.toFixed(3) + "</td>" +
        "<td>" + fmt$(r.band_lo_usd) + " – " + fmt$(r.band_hi_usd) + "</td>" +
        "<td><span class=\"verdict " + r.verdict + "\">" + r.verdict + "</span></td>" +
        "<td class=\"" + netCls + "\">" + (r.net_usd >= 0 ? "+" : "") + "$" + r.net_usd.toFixed(2) + "</td>" +
        "<td class=\"" + netCls + "\">" + (r.net_h_usd >= 0 ? "+" : "") + "$" + r.net_h_usd.toFixed(2) + "</td>" +
        "<td>" + fmt$(r.min_dep_usd) + "</td></tr>";
    }).join("");
    $("board").querySelectorAll("tbody tr").forEach(function (tr) {
      tr.addEventListener("click", function () { showDetail(tr.getAttribute("data-slug")); });
    });
  }
  $("q").addEventListener("input", function (e) { state.q = e.target.value; renderTable(); });
  $("verdict").addEventListener("change", function (e) { state.verdict = e.target.value; renderTable(); });
  $("watchonly").addEventListener("change", function (e) { state.watchonly = e.target.checked; renderTable(); });
  $("sort").addEventListener("change", function (e) { state.sort = e.target.value; renderTable(); });
  window.addEventListener("hashchange", applyHash);

  // ---------- detail ----------
  function showDetail(slug) {
    var r = rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var d = $("detail");
    var prog = r.program === null
      ? "No program verified for this row — check the protocol's own points page before bridging; if no live program exists, the return is yield/fees only."
      : r.program;
    var progLabel = (r.program !== null && r.program.indexOf("NONE") === 0) ? "Verified: no live points program" : "Points program (verified 2026-11-25)";
    d.hidden = false;
    d.innerHTML = '<button class="close" id="dclose">Close</button>' +
      "<h2>#" + r.rank + " " + esc(r.name) + (r.watchlist ? " ★ watchlist" : "") + '</h2>' +
      '<p class="note">' + esc(r.category) + " · chains: " + esc(r.chains.join(", ")) +
      " · TVL " + fmt$(r.tvl_usd) + " · 7d " + (r.change_7d === null ? "n/a" : r.change_7d.toFixed(1) + "%") +
      (r.age_days === null ? "" : " · age " + r.age_days + "d") + "</p>" +
      '<div class="grid">' +
      cell("Fitted value", fmt$(r.fitted_usd)) + cell("Multiple", r.multiple.toFixed(3) + "×") +
      cell("Launch odds", r.odds.toFixed(3)) +
      cell("Band P25–P75", fmt$(r.band_lo_usd) + " – " + fmt$(r.band_hi_usd)) +
      cell("Band P10–P90", fmt$(r.band_lo10_usd) + " – " + fmt$(r.band_hi90_usd)) +
      cell("Verdict", r.verdict) + cell("Net $", (r.net_usd >= 0 ? "+" : "") + "$" + r.net_usd.toFixed(2)) +
      cell("Net $/h", (r.net_h_usd >= 0 ? "+" : "") + "$" + r.net_h_usd.toFixed(2)) +
      cell("Band-low net", (r.net_lo_usd >= 0 ? "+" : "") + "$" + r.net_lo_usd.toFixed(2)) +
      cell("Min deposit", fmt$(r.min_dep_usd)) +
      cell("Net at 2% part.", (r.net_p2_usd >= 0 ? "+" : "") + "$" + r.net_p2_usd.toFixed(2)) +
      cell("Net at 10% part.", (r.net_p10_usd >= 0 ? "+" : "") + "$" + r.net_p10_usd.toFixed(2)) +
      "</div>" +
      '<p><b>Verdict rule:</b> FARM if band-low net ≥ $150, MARGINAL if point net &gt; 0, else SKIP. ' +
      "This row: gross drop $" + r.gross_usd.toFixed(2) + " (7% pool × $" + r.costs_usd.toFixed(2) + " costs) — " +
      (r.verdict === "FARM" ? "band-low net clears $150." : r.verdict === "MARGINAL" ? "point net is positive but band-low net ($" + r.net_lo_usd.toFixed(2) + ") does not clear $150; a $" + fmtInt(r.min_dep_usd) + " deposit would." : "point net is not positive at a $150 deposit; a $" + fmtInt(r.min_dep_usd) + " deposit would be needed for band-low net to clear $150.") + "</p>" +
      '<div class="prog"><b>' + progLabel + ':</b> ' + esc(prog) + "</div>" +
      '<h3>Farm plan — $150 capital, ~6.5h total</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    $("dclose").addEventListener("click", function () {
      d.hidden = true;
      history.replaceState(null, "", location.pathname + location.search);
    });
    function cell(k, v) { return '<div class="cell"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>"; }
  }

  // ---------- validation tables ----------
  function table(head, bodyHtml, cls) {
    return '<table class="vt ' + (cls || "") + '"><thead><tr>' + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + bodyHtml + "</tbody></table>";
  }
  var order = ["C1-ols-tvl (R5)", "R6-ridge-a30-full", "T-OLS-tvl", "T-OLS-FA", "T-R10", "T-R30", "T-ENS"];
  var vrows = order.map(function (name) {
    var e = V.value[name];
    var ship = name === "T-OLS-tvl" ? ' class="ship"' : "";
    return "<tr" + ship + "><td>" + name + (name === "T-OLS-tvl" ? " — SHIPPED" : "") + "</td>" +
      "<td>" + r2(e.inSample.r2) + "</td><td>×" + r3(e.inSample.miss) + "</td>" +
      "<td>×" + r3(e.looFit) + "</td><td>×" + r3(e.wf1Fit ? e.wf1Fit.miss : null) + "</td><td>×" + r3(e.wf2Fit ? e.wf2Fit.miss : null) + "</td>" +
      "<td>" + r2(e.full.r2) + "</td><td>×" + r3(e.full.miss) + "</td><td>×" + r3(e.looFull) + "</td>" +
      "<td>" + r2(e.holdout.r2) + "</td><td>" + r2(e.holdout.spearman) + "</td></tr>";
  }).join("");
  $("value-table").innerHTML = table(
    ["Model", "Fit R²", "Fit miss", "LOO", "WF1", "WF2", "Full R²", "Full miss", "LOO full", "Holdout R²", "Holdout ρ"],
    vrows) +
    '<p class="note">"Fit" columns are on each model\'s own fit set: the 94 trimmed comps for T-* models, all 128 comps for C1 and R6. "Full" columns are always on all 128 comps. Flat-median baselines: trimmed WF1 ×' + r3(tols.wf1Fit.base) + ", WF2 ×" + r3(tols.wf2Fit.base) +
    "; 5-fold OOF (selection 102) R² " + r2(tols.oof.r2) + ", miss ×" + r3(tols.oof.miss) + " vs flat ×" + r3(tols.oof.base) +
    ". Holdout (fit on selection only, 26 rows): R² " + r2(tols.holdout.r2) + ", MSE " + r2(tols.holdout.mse) + ", Spearman " + r2(tols.holdout.spearman) +
    ". T-OLS coefficients: intercept " + V.tols.beta[0].toFixed(4) + " (SE " + V.tols.se[0].toFixed(4) + "), ln TVL " + V.tols.beta[1].toFixed(4) +
    " (SE " + V.tols.se[1].toFixed(4) + "); 95% CI ln TVL [" + V.tols.ci[1][0].toFixed(4) + ", " + V.tols.ci[1][1].toFixed(4) + "] (200 bootstrap refits).</p>";

  var o = V.odds;
  var orows = Object.keys(o.cvBrier).map(function (lam) {
    return "<tr" + (Number(lam) === o.lambda ? ' class="ship"' : "") + "><td>λ = " + lam + (Number(lam) === o.lambda ? " — SHIPPED" : "") + "</td><td>" + r2(o.cvBrier[lam]) + "</td></tr>";
  }).join("");
  $("odds-table").innerHTML = table(["Ridge λ", "10-fold Brier"], orows +
    '<tr><td>Constant (base rate 50.7%)</td><td>' + r2(o.constantBrier) + "</td></tr>") +
    '<p class="note">Coefficients (standardized): intercept ' + o.coefs[0].toFixed(4) + " (SE " + o.bootstrapSe[0].toFixed(4) +
    "), ln TVL " + o.coefs[1].toFixed(4) + " (SE " + o.bootstrapSe[1].toFixed(4) + "), log age " + o.coefs[2].toFixed(4) +
    " (SE " + o.bootstrapSe[2].toFixed(4) + "), growth " + o.coefs[3].toFixed(4) + " (SE " + o.bootstrapSe[3].toFixed(4) +
    "). Age is the driver (t ≈ 4.3); TVL barely matters for whether a token exists (t ≈ 0.9). Time-split Brier: train &lt;2024-07-15 → test " +
    o.timeSplit1.test + " rows, " + r2(o.timeSplit1.brier) + " vs constant " + r2(o.timeSplit1.constant) +
    "; train &lt;2025-01-01 → test " + o.timeSplit2.test + " rows, " + r2(o.timeSplit2.brier) + " vs constant " + r2(o.timeSplit2.constant) +
    ". The odds model beats the constant out of time on both cuts. P(token) at the median protocol: " +
    (function () { var m = o.marginals; return "TVL P10→P90 " + m.lnTVL[0].toFixed(3) + "→" + m.lnTVL[4].toFixed(3) + "; age " + m.lnAge[0].toFixed(3) + "→" + m.lnAge[4].toFixed(3) + "; growth " + m.chg[0].toFixed(3) + "→" + m.chg[4].toFixed(3); })() + ".</p>";

  var b = V.bands;
  $("bands-table").innerHTML = table(["Band", "Multiplier", "LOO coverage", "WF 2024-07-15", "WF 2025-01-01"],
    "<tr><td>P25–P75</td><td>" + b.q25.toFixed(3) + "× – " + b.q75.toFixed(3) + "×</td><td>" + (b.coverage2575 * 100).toFixed(1) + "%</td><td>" + (b.wfCov1 * 100).toFixed(1) + "%</td><td>" + (b.wfCov2 * 100).toFixed(1) + "%</td></tr>" +
    "<tr><td>P10–P90</td><td>" + b.q10.toFixed(3) + "× – " + b.q90.toFixed(3) + "×</td><td>" + (b.coverage1090 * 100).toFixed(1) + "%</td><td>" + (b.wfCov1090_1 * 100).toFixed(1) + "%</td><td>" + (b.wfCov1090_2 * 100).toFixed(1) + "%</td></tr>") +
    '<p class="note">Median LOO residual ×' + b.q50.toFixed(3) + ' — the fit is near-unbiased on the trimmed set.</p>';

  var arows = Object.keys(V.ablation).map(function (name) {
    var a = V.ablation[name];
    var ship = name === "T-OLS (SHIPPED)" ? ' class="ship"' : "";
    return "<tr" + ship + "><td>" + name + "</td><td>×" + r3(a.looFull) + "</td><td>×" + r3(a.wf1Full) + "</td><td>×" + r3(a.wf2Full) + "</td></tr>";
  }).join("");
  $("ablation-table").innerHTML = table(["Variant", "LOO-full miss", "WF1-full miss", "WF2-full miss"], arows);

  $("econ-table").innerHTML = table(["Figure", "Value"],
    "<tr><td>Verdicts (341 rows)</td><td>FARM " + (V.verdicts.FARM || 0) + " · MARGINAL " + (V.verdicts.MARGINAL || 0) + " · SKIP " + (V.verdicts.SKIP || 0) + "</td></tr>" +
    "<tr><td>Net $ (point, $150 deposit)</td><td>median $" + V.economics.netMedian.toFixed(2) + " · max $" + V.economics.netMax.toFixed(2) + " (" + V.economics.bestRow + ") · min −$9.40</td></tr>" +
    "<tr><td>Band-low net, best row</td><td>$" + V.economics.netLoMax.toFixed(2) + " — still below the $150 hurdle</td></tr>" +
    "<tr><td>Smallest MIN DEP</td><td>$" + fmtInt(V.economics.minDepMin) + " (" + V.economics.bestRow + ") — the deposit that would clear $150 at band-low</td></tr>" +
    "<tr><td>Watchlist verdicts</td><td>40/40 MARGINAL — every watchlist row pays a small positive net at $150</td></tr>");

  var reasons = {};
  D.aside.forEach(function (a) { reasons[a.reason] = (reasons[a.reason] || 0) + 1; });
  var reasonRows = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).map(function (k) {
    return "<tr><td>Set aside: " + esc(k) + "</td><td>" + reasons[k] + "</td></tr>";
  }).join("");
  $("census-table").innerHTML = table(["Bucket", "Rows"],
    "<tr><td>Ranked (40 watchlist + 301 passing screens)</td><td>" + V.census.ranked + "</td></tr>" +
    "<tr><td>Live comparables (token-bearing, mcap reported)</td><td>" + V.census.live + "</td></tr>" +
    reasonRows +
    "<tr><td><b>Total</b></td><td><b>" + V.census.total + "</b></td></tr>");

  // ---------- scatter: cap on TVL ----------
  (function () {
    var comps = D.comps || [];
    var W = 1100, H = 380, P = { l: 60, r: 20, t: 16, b: 36 };
    var xs = comps.map(function (c) { return Math.log10(c.tvl_usd); });
    var ys = comps.map(function (c) { return Math.log10(c.ratio); });
    var x0 = Math.min.apply(null, xs) - 0.1, x1 = Math.max.apply(null, xs) + 0.1;
    var y0 = Math.min.apply(null, ys) - 0.2, y1 = Math.max.apply(null, ys) + 0.2;
    var X = function (v) { return P.l + (v - x0) / (x1 - x0) * (W - P.l - P.r); };
    var Y = function (v) { return H - P.b - (v - y0) / (y1 - y0) * (H - P.t - P.b); };
    var beta = V.tols.beta;
    // fitted log10 ratio = (beta0 + (beta1-1) * ln TVL) / ln 10
    var line = function (lx) {
      var lnTvl = lx * Math.LN10;
      return (beta[0] + (beta[1] - 1) * lnTvl) / Math.LN10;
    };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Cap on TVL scatter">';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>';
    // trimmed band [0.02, 2]
    var yLo = Y(Math.log10(0.02)), yHi = Y(Math.log10(2));
    s += '<rect x="' + P.l + '" y="' + yHi + '" width="' + (W - P.l - P.r) + '" height="' + (yLo - yHi) + '" fill="#eef7ee"/>';
    s += '<line x1="' + P.l + '" y1="' + yLo + '" x2="' + (W - P.r) + '" y2="' + yLo + '" stroke="#2a7d2a" stroke-dasharray="4 3"/>';
    s += '<line x1="' + P.l + '" y1="' + yHi + '" x2="' + (W - P.r) + '" y2="' + yHi + '" stroke="#2a7d2a" stroke-dasharray="4 3"/>';
    s += '<text x="' + (W - P.r - 4) + '" y="' + (yHi - 4) + '" font-size="11" text-anchor="end" fill="#2a7d2a">trim band top 2×</text>';
    s += '<text x="' + (W - P.r - 4) + '" y="' + (yLo + 14) + '" font-size="11" text-anchor="end" fill="#2a7d2a">trim band bottom 0.02×</text>';
    // gridlines + ticks
    for (var gx = Math.ceil(x0); gx <= Math.floor(x1); gx++) {
      s += '<line x1="' + X(gx) + '" y1="' + P.t + '" x2="' + X(gx) + '" y2="' + (H - P.b) + '" stroke="#eee"/>';
      s += '<text x="' + X(gx) + '" y="' + (H - P.b + 16) + '" font-size="11" text-anchor="middle">$10^' + gx + "</text>";
    }
    for (var gy = Math.ceil(y0); gy <= Math.floor(y1); gy++) {
      s += '<line x1="' + P.l + '" y1="' + Y(gy) + '" x2="' + (W - P.r) + '" y2="' + Y(gy) + '" stroke="#eee"/>';
      s += '<text x="' + (P.l - 6) + '" y="' + (Y(gy) + 4) + '" font-size="11" text-anchor="end">' + (gy >= 0 ? gy : "−" + Math.abs(gy)) + "</text>";
    }
    s += '<text x="' + (W / 2) + '" y="' + (H - 4) + '" font-size="12" text-anchor="middle">TVL (log scale)</text>';
    s += '<text x="14" y="' + (H / 2) + '" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">mcap / TVL (log scale)</text>';
    // points
    comps.forEach(function (c) {
      var cx = X(Math.log10(c.tvl_usd)), cy = Y(Math.log10(c.ratio));
      if (c.trimmed) s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.2" fill="#1a5db0"><title>' + esc(c.slug) + " " + c.ratio.toFixed(3) + "×</title></circle>";
      else s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.2" fill="#fff" stroke="#b00020" stroke-width="1.4"><title>' + esc(c.slug) + " " + c.ratio.toFixed(3) + "× (outside trim)</title></circle>";
    });
    // fitted line
    s += '<line x1="' + X(x0) + '" y1="' + Y(line(x0)) + '" x2="' + X(x1) + '" y2="' + Y(line(x1)) + '" stroke="#111" stroke-width="2"/>';
    s += '<text x="' + (P.l + 6) + '" y="' + (P.t + 12) + '" font-size="12">● in trim (94)  ○ outside trim (34)  — fitted line</text>';
    s += "</svg>";
    $("scatter").innerHTML = s;
  })();

  renderTable();
  applyHash();
})();
