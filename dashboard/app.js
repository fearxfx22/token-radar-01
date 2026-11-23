// Token Radar, the page. Renders window.RADAR (written by main.ts from the
// sealed snapshot), sorts and filters the board, and opens one protocol's
// detail: the model breakdown recomputed in the page and the farm plan the
// board itself carries, so the page and board.json can never disagree.
//
// Hash state, so a view is a link: #view=board|live|setaside, #q=<text>,
// #category=<name>, #chain=<name>, #p=<slug> opens the detail dialog.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** $404.0M, $1.23B, $477K, $199: the board's whole-dollar values, readable at a glance. */
function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
function moneyFull(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function pct(n) {
  if (n === null || n === undefined) return '<span class="muted">—</span>';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null || days === undefined) return '<span class="muted">unknown</span>';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${(days / 30).toFixed(0)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

// ---------------------------------------------------------------- stats and filters

const topImplied = D.rows.length ? D.rows[0].implied_value_usd : 0;
$('stats').innerHTML = [
  ['Ranked', D.board_size],
  ['Watchlist', D.watchlist_size],
  ['Early, below floor', D.early_size],
  ['Top implied value', money(topImplied)],
  ['Snapshot', D.as_of],
].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

const categories = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
for (const c of categories) $('category').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
for (const c of chains) $('chain').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);

// ---------------------------------------------------------------- the board

let sortKey = 'rank';
let sortDir = 1;
const SORTABLE = { rank: (r) => r.rank, name: (r) => r.name.toLowerCase(), tvl_usd: (r) => r.tvl_usd, change_7d: (r) => r.change_7d ?? -1e9, age_days: (r) => r.age_days ?? -1, implied_value_usd: (r) => r.implied_value_usd };

function filteredRows() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('category').value;
  const chain = $('chain').value;
  return D.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    return true;
  });
}

function renderBoard() {
  const rows = filteredRows();
  const key = SORTABLE[sortKey];
  rows.sort((a, b) => {
    const av = key(a), bv = key(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return cmp * sortDir || (a.rank - b.rank);
  });
  $('rows').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td><strong>${esc(r.name)}</strong> <span class="slug">${esc(r.slug)}</span><br><span class="cat">${esc(r.category ?? 'Uncategorized')}</span></td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td>${r.chains.slice(0, 3).map(esc).join(', ')}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num"><strong>${money(r.implied_value_usd)}</strong><div class="bar"><i style="width:${Math.max(2, (r.implied_value_usd / topImplied) * 100).toFixed(1)}%"></i></div></td>
    </tr>`).join('');
  $('count').textContent = rows.length === D.rows.length
    ? `${D.rows.length} protocols ranked: the full watchlist plus every clean pre-token protocol below the floor.`
    : `${rows.length} of ${D.rows.length} protocols match.`;
  document.querySelectorAll('#board th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.sort === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '');
  });
}

document.querySelectorAll('#board th[data-sort]').forEach((th) => {
  const sort = () => {
    if (sortKey === th.dataset.sort) sortDir *= -1;
    else { sortKey = th.dataset.sort; sortDir = sortKey === 'rank' ? 1 : -1; }
    renderBoard();
  };
  th.addEventListener('click', sort);
  th.setAttribute('tabindex', '0');
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); }
  });
});
$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});

// ---------------------------------------------------------------- live and set-aside views

$('live-rows').innerHTML = D.live.map((r) => `
  <tr>
    <td><strong>${esc(r.name)}</strong> <span class="slug">${esc(r.slug)}</span><br><span class="cat">${esc(r.category ?? 'Uncategorized')}</span></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${r.mcap_usd === null ? '<span class="muted">—</span>' : money(r.mcap_usd)}</td>
    <td class="num">${r.mcap_usd === null ? '<span class="muted">—</span>' : (r.mcap_usd / r.tvl_usd).toFixed(3)}</td>
    <td class="num">${pct(r.change_7d)}</td>
  </tr>`).join('');

$('setaside-rows').innerHTML = D.set_aside.map((r) => `
  <tr>
    <td><strong>${esc(r.name)}</strong> <span class="slug">${esc(r.slug)}</span><br><span class="cat">${esc(r.category ?? 'Uncategorized')}</span></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td>${esc(r.reason)}</td>
  </tr>`).join('');

// ---------------------------------------------------------------- tabs and hash state

const VIEWS = ['board', 'live', 'setaside'];
function showView(view) {
  if (!VIEWS.includes(view)) view = 'board';
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('board-panel').classList.toggle('hidden', view !== 'board');
  $('live-panel').classList.toggle('hidden', view !== 'live');
  $('setaside-panel').classList.toggle('hidden', view !== 'setaside');
  document.querySelector('.controls .filters').style.display = view === 'board' ? '' : 'none';
  $('count').style.display = view === 'board' ? '' : 'none';
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { syncHash({ view: t.dataset.view }); }));

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { view: h.get('view') || 'board', q: h.get('q') || '', category: h.get('category') || '', chain: h.get('chain') || '', p: h.get('p') || '' };
}
function syncHash(patch) {
  const cur = readHash();
  const next = { ...cur, ...patch };
  const h = new URLSearchParams();
  if (next.view !== 'board') h.set('view', next.view);
  if (next.q) h.set('q', next.q);
  if (next.category) h.set('category', next.category);
  if (next.chain) h.set('chain', next.chain);
  if (next.p) h.set('p', next.p);
  history.replaceState(null, '', h.toString() ? `#${h}` : location.pathname + location.search);

applyHash();
}
function applyHash() {
  const h = readHash();
  showView(h.view);
  if ($('q').value !== h.q) $('q').value = h.q;
  if ($('category').value !== h.category) $('category').value = h.category;
  if ($('chain').value !== h.chain) $('chain').value = h.chain;
  renderBoard();
  if (h.p) openDetail(h.p, false);
}
let qTimer = null;
$('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => syncHash({ q: $('q').value.trim() }), 200); });
$('category').addEventListener('change', () => syncHash({ category: $('category').value }));
$('chain').addEventListener('change', () => syncHash({ chain: $('chain').value }));
$('reset').addEventListener('click', () => syncHash({ view: 'board', q: '', category: '', chain: '', p: '' }));
window.addEventListener('hashchange', applyHash);

// ---------------------------------------------------------------- detail dialog

function openDetail(slug, push = true) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  // The breakdown, recomputed here from the row's own figures. The product
  // must equal the implied value the board carries.
  const recomputed = Math.max(1, Math.round(r.tvl_usd * r.fitted_multiple * r.launch_odds));
  const agree = recomputed === r.implied_value_usd;
  // Where the fitted multiple comes from: the line fitted on the snapshot's
  // live market, evaluated at this protocol's TVL. A bigger TVL gets a
  // smaller multiple, because the market pays less per TVL dollar for the
  // biggest protocols: the fitted slope is D.fit.beta1.
  const atMedian = Math.exp(D.fit.beta0);
  const multipleNote = `<p>The fitted multiple ${r.fitted_multiple.toFixed(4)} comes from a line fitted on ${D.fit.n} live protocols with a market cap: ln(market cap / TVL) = ${D.fit.beta0} + ${D.fit.beta1} × (ln TVL − ${D.fit.median_log_tvl}). At the median TVL ($${D.fit.median_tvl_usd.toLocaleString('en-US')}) the multiple is ${atMedian.toFixed(4)}; at this protocol's TVL of ${moneyFull(r.tvl_usd)} it is ${r.fitted_multiple.toFixed(4)}. The line's residual spread is ${D.fit.residual_sd} and its R² is ${D.fit.r_squared}, so most of the multiple is still idiosyncratic: the fit is a pricing rule, not a prediction.</p>`;
  // Where the launch odds come from: the category's eventual launch share
  // and this protocol's age band, both from peer history in the snapshot.
  const oddsRow = D.odds_by_category.find((c) => c.category === (r.category ?? 'Uncategorized'));
  const ageBand = r.age_days === null ? 'unknown' : r.age_days < 365 ? 'under a year' : r.age_days < 1095 ? 'one to three years' : 'over three years';
  const oddsNote = oddsRow
    ? `<p>The launch odds ${r.launch_odds.toFixed(2)} are the forward odds that a ${esc(r.category ?? 'Uncategorized')} protocol listed ${ageBand} ago ever launches a token: among comparable protocols, ${Math.round(oddsRow.eventual_share * 100)}% eventually launch, and the share already launched by this age band is subtracted. The odds are a peer-history estimate, not a validated prediction: the snapshot records no launch dates, so no held-out launch exists to test them against.</p>`
    : `<p>The launch odds ${r.launch_odds.toFixed(2)} are the forward odds that a protocol listed ${ageBand} ago ever launches a token, from peer history in the snapshot. The odds are a peer-history estimate, not a validated prediction: the snapshot records no launch dates, so no held-out launch exists to test them against.</p>`;
  // What could be wrong: honest flags from the row's own figures, so the
  // implied value is read with its uncertainty attached.
  const flags = [];
  if (r.launch_odds <= 0.35) flags.push(`Only about ${Math.round(r.launch_odds * 100)}% of comparable protocols ever launch a token, so most of the value-if-launched is discounted away.`);
  if (r.change_7d !== null && r.change_7d < 0) flags.push(`TVL fell ${Math.abs(r.change_7d).toFixed(1)}% in the last 7 days, the protocol is shrinking, not growing. The model does not use the 7-day change: it was unstable across time, so it is shown as a fact, not priced.`);
  if (r.change_7d === null) flags.push('No 7-day TVL figure is recorded for this protocol.');
  if (r.age_days !== null && r.age_days < 180) flags.push(`Listed only ${r.age_days} days ago, a short record, so the launch odds rest on very little history.`);
  const watch = flags.length
    ? `<h3>What to watch</h3><ul class="steps">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '';
  $('detail-body').innerHTML = `
    <p class="detail-kicker">Rank #${r.rank}, ${esc(r.category ?? 'Uncategorized')}, ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}</p>
    <h2>${esc(r.name)}</h2>
    <p class="muted">${esc(r.slug)}, listed ${r.listed_at ?? 'date unknown'}, snapshot ${esc(D.as_of)}, records no token.</p>
    <h3>How the implied value is worked out</h3>
    <table class="math">
      <tr><td>TVL</td><td>${moneyFull(r.tvl_usd)}</td></tr>
      <tr><td>× fitted multiple (TVL ${money(r.tvl_usd)})</td><td>× ${r.fitted_multiple.toFixed(4)}</td></tr>
      <tr><td>× launch odds (${esc(r.category ?? 'Uncategorized')}, ${ageBand})</td><td>× ${r.launch_odds.toFixed(2)}</td></tr>
      <tr class="total"><td>Implied value (expected value)</td><td>${moneyFull(r.implied_value_usd)}</td></tr>
    </table>
    <p class="fine">${agree ? 'The page recomputes the product above and it matches the board.' : 'Note: the recomputed product differs from the board, see board.json.'}</p>
    ${multipleNote}
    ${oddsNote}
    ${watch}
    <h3>Farm plan, eight steps</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="fine">No token is confirmed for this protocol. The plan is a way to be positioned if one comes, not a promise that one will.</p>
    <button id="detail-close" type="button">Close</button>`;
  const dlg = $('detail');
  if (!dlg.open) dlg.showModal();
  if (push) syncHash({ p: slug });
}
$('detail').addEventListener('click', (e) => {
  if (e.target.id === 'detail-close') { $('detail').close(); syncHash({ p: '' }); }
});
$('detail').addEventListener('close', () => { const h = readHash(); if (h.p) syncHash({ p: '' }); });

// ---------------------------------------------------------------- the model, drawn
//
// One factor chain for the top-ranked protocol: each box is the running
// product after one factor, so the last box is the implied value itself.
// Every figure comes from the row the board already carries.
function renderDiagram() {
  const r = D.rows[0];
  if (!r) return;
  const p1 = r.tvl_usd * r.fitted_multiple;
  const nodes = [
    { label: 'TVL', value: money(r.tvl_usd) },
    { label: 'Fitted multiple', value: money(p1), factor: `× ${r.fitted_multiple.toFixed(4)}` },
    { label: 'Implied value', value: money(r.implied_value_usd), factor: `× ${r.launch_odds.toFixed(2)} odds`, result: true },
  ];
  const W = 150, H = 62, Y = 58, GAP = 90;
  const xs = nodes.map((_, i) => 85 + i * (W + GAP));
  const mid = (i) => xs[i] + W / 2;
  const chain = `Factor chain for ${r.name}: TVL ${money(r.tvl_usd)} times the fitted multiple ${r.fitted_multiple.toFixed(4)}, times the launch odds ${r.launch_odds.toFixed(2)}, gives an expected value of ${money(r.implied_value_usd)}.`;
  const svg = [
    `<svg viewBox="0 0 800 176" width="800" height="176" role="img" aria-label="${esc(chain)}">`,
    `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="diagram-arrowhead"/></marker></defs>`,
    `<text class="diagram-title" x="8" y="22" font-size="15">${esc(r.name)}, the top-ranked protocol</text>`,
    ...nodes.map((n, i) => {
      const cls = n.result ? 'diagram-node-result' : 'diagram-node';
      const vcls = n.result ? 'diagram-value-result' : 'diagram-value';
      return `<rect class="${cls}" x="${xs[i]}" y="${Y}" width="${W}" height="${H}"/>` +
        `<text class="diagram-label" x="${mid(i)}" y="${Y + 24}" text-anchor="middle" font-size="11">${esc(n.label)}</text>` +
        `<text class="${vcls}" x="${mid(i)}" y="${Y + 46}" text-anchor="middle" font-size="13">${esc(n.value)}</text>`;
    }),
    ...nodes.slice(1).map((n, j) => {
      const x1 = xs[j] + W, x2 = xs[j + 1];
      return `<line class="diagram-arrow" x1="${x1}" y1="${Y + 31}" x2="${x2}" y2="${Y + 31}" marker-end="url(#arr)"/>` +
        `<text class="diagram-factor" x="${(x1 + x2) / 2}" y="${Y - 8}" text-anchor="middle" font-size="12">${esc(n.factor)}</text>`;
    }),
    `<text class="diagram-note" x="8" y="150" font-size="12">Each box is the running product after one factor, from the snapshot’s own figures. The last box is the implied value on the board.</text>`,
    `</svg>`,
  ].join('');
  const el = $('diagram');
  el.innerHTML = svg;
  el.setAttribute('aria-label', chain);
}
renderDiagram();

applyHash();
