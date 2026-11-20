"use strict";
// Token Radar dashboard. All data comes from ../data.js, which the entry's
// program generates from the sealed snapshot at run time. No network use.

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function money(v) {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + Math.round(v);
}
function pct(v) {
  if (v === null || v === undefined) return '<span class="na">no data</span>';
  const cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
  return `<span class="${cls}">${v > 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
}
function ageFmt(y) {
  if (y === null || y === undefined) return '<span class="na">unknown</span>';
  return y.toFixed(1) + "y";
}

function renderFunnel() {
  const m = R.meta;
  const stats = [
    [m.total_protocols, "protocols in snapshot"],
    [m.pre_token, "record no token"],
    [m.ranked, "ranked on the board"],
    [`${m.watchlist_covered}/${m.watchlist_total}`, "watchlist covered"],
  ];
  $("funnel").innerHTML = stats
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`)
    .join("");
  $("source-line").textContent = `Snapshot: ${m.source} · as of ${m.as_of} · watchlist floor ${money(m.floor_usd)}.`;
}

// ---------- board ----------
let sortKey = "rank";
let sortDir = 1;

function currentFilters() {
  return {
    q: $("q").value.trim().toLowerCase(),
    cat: $("f-cat").value,
    chain: $("f-chain").value,
    tvl: Number($("f-tvl").value),
    watch: $("f-watch").checked,
  };
}

function visibleRows() {
  const f = currentFilters();
  let out = rows.filter(
    (r) =>
      (f.q === "" || r.name.toLowerCase().includes(f.q) || r.slug.includes(f.q)) &&
      (f.cat === "" || r.category === f.cat) &&
      (f.chain === "" || r.chains.includes(f.chain)) &&
      r.tvl_usd >= f.tvl &&
      (!f.watch || r.watchlist),
  );
  const k = sortKey;
  out = [...out].sort((a, b) => {
    const av = a[k];
    const bv = b[k];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "string") return sortDir * av.localeCompare(bv);
    return sortDir * (av - bv);
  });
  return out;
}

function renderBoard() {
  const out = visibleRows();
  $("row-count").textContent = `${out.length} of ${rows.length} protocols`;
  $("board-body").innerHTML = out
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}">
        <td class="num">${r.rank}</td>
        <td class="name">${esc(r.name)}${r.watchlist ? '<span class="badge">watchlist</span>' : ""}${
          r.peer_count === 0 ? '<span class="badge orphan">no live peers</span>' : ""
        }</td>
        <td>${esc(r.category)}</td>
        <td>${esc(r.chains.slice(0, 2).join(", "))}${r.chains.length > 2 ? " +" + (r.chains.length - 2) : ""}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${pct(r.change_7d)}</td>
        <td class="num">${ageFmt(r.age_years)}</td>
        <td class="num"><b>${money(r.implied_value_usd)}</b></td>
        <td class="num range">${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</td>
        <td class="conf-${r.confidence}">${r.confidence}</td>
      </tr>`,
    )
    .join("");
  for (const tr of document.querySelectorAll("#board-body tr")) {
    tr.addEventListener("click", () => {
      location.hash = "#/p/" + tr.getAttribute("data-slug");
    });
  }
}

// ---------- detail ----------
function factorCell(label, value, note) {
  return `<div class="wf-cell"><b>×${value.toFixed(3)}</b><span>${label}<br>${note}</span></div>`;
}

function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  const catPeers = R.peers.filter((p) => p.category === r.category).slice(0, 5);
  const nullNotes = [];
  if (r.change_7d === null) nullNotes.push("7-day growth is not recorded: the growth factor is a neutral ×1.000 and the range is widened.");
  if (r.age_years === null) nullNotes.push("Listing date is not recorded: the maturity factor is a neutral ×1.000 and the range is widened.");
  $("detail-body").innerHTML = `
    <div class="detail-head">
      <h2>${esc(r.name)}</h2>
      <span class="small">${esc(r.category)} · rank #${r.rank} of ${rows.length}${r.watchlist ? " · on the house watchlist" : ""}</span>
    </div>
    <div class="kv">
      <div><b>${money(r.tvl_usd)}</b><span>TVL</span></div>
      <div><b>${r.change_7d === null ? "no data" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(1) + "%"}</b><span>7-day TVL change</span></div>
      <div><b>${r.age_years === null ? "unknown" : r.age_years.toFixed(1) + " years"}</b><span>tracked, no token recorded</span></div>
      <div><b>${esc(r.chains.join(", "))}</b><span>chains</span></div>
      <div><b class="conf-${r.confidence}">${r.confidence}</b><span>data confidence</span></div>
    </div>
    <div class="card">
      <h3>How this implied value is built</h3>
      <div class="waterfall">
        <div class="wf-cell"><b>${r.multiple.toFixed(3)}×</b><span>category multiple (shrunk)<br>median mcap/TVL of ${r.peer_count} live peers in ${esc(r.category)}, shrunk toward the global median</span></div>
        <div class="wf-cell"><b>${money(r.tvl_usd)}</b><span>TVL<br>the protocol's own locked value in the snapshot</span></div>
        ${factorCell("size factor", r.size_factor, "power-law scaling fitted on live peers; large TVL earns a lower multiple")}
        ${factorCell("growth factor", r.growth_factor, "bounded tanh of the 7-day TVL change, clamped to [-40%, +150%]")}
        ${factorCell("maturity factor", r.maturity_factor, "years tracked with no token recorded; very young and very old are discounted")}
        ${factorCell("chain-breadth factor", r.chain_factor, "multi-chain uplift measured on the live peers themselves")}
        <div class="wf-cell final"><b>${money(r.implied_value_usd)}</b><span>implied value<br>range ${money(r.implied_low_usd)} – ${money(r.implied_high_usd)} from the category's interquartile multiples</span></div>
      </div>
      ${nullNotes.map((n) => `<p class="small">${n}</p>`).join("")}
      ${
        r.peer_count === 0
          ? `<p class="small">No protocol in ${esc(r.category)} has a trading token in this snapshot, so the global median multiple is used and the range is the global interquartile range.</p>`
          : ""
      }
    </div>
    <div class="card">
      <h3>Live peers in ${esc(r.category)} (their tokens already trade)</h3>
      ${
        catPeers.length === 0
          ? '<p class="small">None in this snapshot.</p>'
          : `<table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap/TVL</th></tr></thead><tbody>${catPeers
              .map(
                (p) => `<tr><td>${esc(p.name)}</td><td class="num">${money(p.tvl_usd)}</td><td class="num">${money(p.actual_usd)}</td><td class="num">${p.multiple.toFixed(3)}×</td></tr>`,
              )
              .join("")}</tbody></table>`
      }
    </div>
    <div class="card">
      <h3>Farm plan</h3>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>`;
  showView("detail");
}

// ---------- methodology ----------
function renderMethod() {
  const m = R.meta;
  const p = m.params;
  $("method-body").innerHTML = `
    <h2 style="margin-top:0">Methodology</h2>
    <p>Every number on this page is computed by the entry's program from the one frozen snapshot
    (<code>${esc(m.source)}</code>, as of ${m.as_of}). No protocol name, multiple or ranking is written
    into the code: change the snapshot and the board changes.</p>
    <div class="card"><h3>The model</h3>
    <p class="mono">implied value = M(cat) × TVL × (TVL / TVL<sub>ref</sub>)<sup>β−1</sup> × growth × maturity × chain breadth</p>
    <p class="small">M(cat) is the median market-cap/TVL multiple of the category's live-token peers, winsorised at the
    peers' 5th–95th percentile and shrunk toward the global median in log space with weight n/(n+${p.shrink_k}), so a
    category with two peers — or one outlying peer — cannot dominate. β = ${p.beta.toFixed(2)} is the size exponent, chosen by back-test: the program values every
    live peer as if it were pre-token for each candidate β from 0.50 to 1.00 and keeps the one whose median error against
    the peers' recorded market caps is smallest (log-log fit R² = ${p.r_squared.toFixed(3)}, TVL<sub>ref</sub> = ${money(p.ref_tvl)}, the peers' median TVL).
    The range beside each value uses the category's interquartile multiples, widened 15% for each snapshot field
    (7-day change, listing date) that is missing. Calibration, honestly stated: at the median the model's estimate is
    within a factor of ${p.median_log_error_factor.toFixed(1)}× of a live peer's actual market cap, and the low–high range
    contains the actual market cap for ${(p.band_coverage * 100).toFixed(0)}% of live peers — see the calibration tab.
    Category multiples in this snapshot disperse widely, so the radar claims a defensible range, never a precise price.</p></div>
    <div class="card"><h3>Who is on the board</h3>
    <p class="small">The snapshot holds ${m.total_protocols} protocols; ${m.pre_token} record no token (both token fields empty).
    The board ranks ${m.ranked} of them. Left off, by the same rule the house's watchlist uses: wrapped, staked or bridged
    products of a token that already trades (bridge, liquid staking, restaking and exchange categories, names carrying a
    whole word wrapped/staked/staking or an exchange's name, and names ending in a version marker, whose earlier version
    may already have a token). All ${m.watchlist_total} watchlist protocols are ranked, and the board reaches far below the
    ${money(m.floor_usd)} watchlist floor, because the floor is where the house started reading, not where a radar should stop.</p></div>
    <div class="card"><h3>Category multiples fitted on the snapshot</h3>
    <table class="plain"><thead><tr><th>Category</th><th class="num">Live peers</th><th class="num">Median mcap/TVL</th><th class="num">Shrunk multiple used</th><th class="num">Shrinkage weight</th></tr></thead>
    <tbody>${p.categories
      .map(
        (c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${c.medianMultiple.toFixed(3)}×</td><td class="num">${c.shrunkMultiple.toFixed(3)}×</td><td class="num">${c.weight.toFixed(2)}</td></tr>`,
      )
      .join("")}</tbody></table>
    <p class="small">Global median multiple: ${p.global_median.toFixed(3)}× over ${p.peer_count} peers with a recorded market cap and at least $1M TVL.
    Multi-chain breadth uplift measured on the peers: ${(p.chain_uplift * 100).toFixed(1)}%.</p></div>
    <div class="card"><h3>Honesty rules</h3>
    <p class="small">A missing 7-day change or listing date is never silently read as zero: the factor is neutral,
    the row's confidence drops, and its range widens. An implied value is this radar's own claim about what a token
    would be worth if the protocol's record stayed as it is — it is not a prediction that a token will be issued,
    and a protocol is always described as recording no token, never as having none.</p></div>`;
}

// ---------- calibration ----------
function renderCalibration() {
  const p = R.meta.params;
  const W = 860;
  const H = 380;
  const pad = 46;
  const xs = R.peers.map((x) => x.log_tvl);
  const ys = R.peers.map((x) => x.log_mcap);
  const x0 = Math.floor(Math.min(...xs)) - 0.3;
  const x1 = Math.ceil(Math.max(...xs)) + 0.3;
  const y0 = Math.floor(Math.min(...ys)) - 0.3;
  const y1 = Math.ceil(Math.max(...ys)) + 0.3;
  const sx = (v) => pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad);
  const sy = (v) => H - pad - ((v - y0) / (y1 - y0)) * (H - 2 * pad);
  const dots = R.peers
    .map((x) => `<circle cx="${sx(x.log_tvl).toFixed(1)}" cy="${sy(x.log_mcap).toFixed(1)}" r="3" fill="#4cc2ff" opacity="0.75"/>`)
    .join("");
  const line = `<line x1="${sx(x0)}" y1="${sy(p.alpha + p.beta * x0)}" x2="${sx(x1)}" y2="${sy(p.alpha + p.beta * x1)}" stroke="#7ee2a8" stroke-width="2"/>`;
  const grid = [];
  for (let gx = Math.ceil(x0); gx <= x1; gx++) {
    grid.push(`<line x1="${sx(gx)}" y1="${pad}" x2="${sx(gx)}" y2="${H - pad}" stroke="#243145" stroke-width="1"/><text x="${sx(gx)}" y="${H - pad + 18}" fill="#64748f" font-size="11" text-anchor="middle">10^${gx}</text>`);
  }
  for (let gy = Math.ceil(y0); gy <= y1; gy++) {
    grid.push(`<line x1="${pad}" y1="${sy(gy)}" x2="${W - pad}" y2="${sy(gy)}" stroke="#243145" stroke-width="1"/><text x="${pad - 8}" y="${sy(gy) + 4}" fill="#64748f" font-size="11" text-anchor="end">10^${gy}</text>`);
  }
  $("calibration-body").innerHTML = `
    <h2 style="margin-top:0">Live peers &amp; calibration</h2>
    <p class="small">These ${R.peers.length} protocols already have a token: the snapshot records both their TVL and their
    market cap. The radar's board never ranks them — they are the evidence the model is fitted on. The table runs the
    board's own model back over each of them and prints the estimate beside the actual market cap, so the model's
    accuracy is checkable rather than asserted. Median error: a factor of ${p.median_log_error_factor.toFixed(2)}×.
    The board's low–high range contains the actual market cap for ${(p.band_coverage * 100).toFixed(0)}% of them.</p>
    <svg class="scatter" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Log-log scatter of peer TVL against market cap with the fitted line">
      ${grid.join("")}${line}${dots}
      <text x="${W - pad}" y="${pad - 12}" fill="#93a3b8" font-size="12" text-anchor="end">log market cap = ${p.alpha.toFixed(2)} + ${p.beta.toFixed(2)} × log TVL</text>
      <text x="${pad}" y="${H - 8}" fill="#64748f" font-size="11">TVL (log scale) →</text>
    </svg>
    <div class="table-wrap" style="margin-top:14px">
    <table class="plain"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Actual mcap</th><th class="num">Model estimate</th><th class="num">Estimate / actual</th></tr></thead>
    <tbody>${R.peers
      .map(
        (x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td class="num">${money(x.tvl_usd)}</td><td class="num">${money(x.actual_usd)}</td><td class="num">${money(x.estimate_usd)}</td><td class="num">${(x.estimate_usd / x.actual_usd).toFixed(2)}×</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

// ---------- views & wiring ----------
function showView(name) {
  for (const v of ["board", "calibration", "method", "detail"]) {
    $("view-" + v).hidden = v !== name;
  }
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t.getAttribute("data-view") === name);
  }
}

for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => {
    history.pushState(null, "", " ");
    showView(t.getAttribute("data-view"));
  });
}
$("back-btn").addEventListener("click", () => {
  history.pushState(null, "", " ");
  showView("board");
});
for (const id of ["q", "f-cat", "f-chain", "f-tvl", "f-watch"]) {
  $(id).addEventListener("input", renderBoard);
}
for (const th of document.querySelectorAll("#board th[data-sort]")) {
  th.addEventListener("click", () => {
    const k = th.getAttribute("data-sort");
    if (sortKey === k) sortDir = -sortDir;
    else {
      sortKey = k;
      sortDir = k === "rank" || k === "name" || k === "category" ? 1 : -1;
    }
    renderBoard();
  });
}

function fillFilterOptions() {
  const cats = [...new Set(rows.map((r) => r.category))].sort();
  $("f-cat").innerHTML =
    '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $("f-chain").innerHTML =
    '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join("");
}

function route() {
  const h = location.hash;
  if (h.startsWith("#/p/")) renderDetail(decodeURIComponent(h.slice(4)));
}

window.addEventListener("hashchange", route);
renderFunnel();
fillFilterOptions();
renderBoard();
renderMethod();
renderCalibration();
route();
