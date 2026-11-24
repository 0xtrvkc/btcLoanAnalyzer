/* Interface orchestration. All calculation lives in engine.js; this file only reads inputs and renders. */
'use strict';
const M = window.LoanEngine, $ = id => document.getElementById(id);
const escapeHTML = v => String(v ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, dp = 0) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
const usd = (n, dp) => { if (!Number.isFinite(n)) return '—'; const d = dp ?? (Math.abs(n) < 10000 ? 2 : 0); return (n < 0 ? '−' : '') + '$' + fmt(Math.abs(n), d); };
const signed = (n, dp) => { if (!Number.isFinite(n)) return '—'; if (Math.abs(n) < 0.005) n = 0; return (n > 0 ? '+' : '') + usd(n, dp); };
const pct = (n, dp = 1) => Number.isFinite(n) ? (n < 0 ? '−' : '') + fmt(Math.abs(n), dp) + '%' : '—';
const signedPct = (n, dp = 1) => Number.isFinite(n) ? (n > 0 ? '+' : '') + pct(n, dp) : '—';
const btcAmt = (n, dp = 6) => Number.isFinite(n) ? fmt(n, dp) + ' BTC' : '—';
const sats = n => { if (!Number.isFinite(n)) return '—'; const s = Math.round(n * 1e8); return (s > 0 ? '+' : s < 0 ? '−' : '') + fmt(Math.abs(s)) + ' sats'; };
const compact = n => !Number.isFinite(n) ? '—' : Math.abs(n) >= 1e6 ? (n < 0 ? '−' : '') + '$' + fmt(Math.abs(n) / 1e6, 1) + 'm' : Math.abs(n) >= 1000 ? (n < 0 ? '−' : '') + '$' + fmt(Math.abs(n) / 1000, Math.abs(n) < 10000 ? 1 : 0) + 'k' : usd(n, 0);
const tone = n => n > 1e-9 ? 'good' : n < -1e-9 ? 'bad' : 'muted';
const statusTone = s => s === 'Liquidation' ? 'bad' : s === 'Margin call' ? 'warn' : s === 'No debt' ? '' : 'good';
const set = (id, text) => { const n = $(id); if (n && n.textContent !== String(text)) n.textContent = text; };
const badge = (label, kind = '') => `<span class="badge ${kind}">${escapeHTML(label)}</span>`;
const row = (label, value, cls = '') => `<div class="key-row ${cls}"><span>${escapeHTML(label)}</span><strong>${value}</strong></div>`;
const dateLabel = s => M.dateValid(s) ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const utcTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

const STORAGE = { position: 'btc_loan_position_v3', legacy: 'btc_terminal_position_v2', data: 'btc_terminal_data_v2', history: 'btc_loan_snapshots_v2', weights: 'btc_terminal_weights_v2', theme: 'btc_loan_theme' };
function getStored(key, fallback) { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function putStored(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function validData(x) { return x && M.dateValid(x.date) && ['mvrv', 'zscore', 'btcPrice', 'histMeanMvrv', 'cyclePos', 'ceilPrice', 'floorPrice', 'roc30'].every(k => Number.isFinite(x[k])) && ['mvrv', 'btcPrice', 'histMeanMvrv', 'ceilPrice', 'floorPrice'].every(k => x[k] > 0) && x.cyclePos >= 0 && x.cyclePos <= 100 && typeof x.maStack === 'string'; }

let D = window.BUNDLED_SNAPSHOT, dataSource = 'Bundled snapshot';
const cached = getStored(STORAGE.data, null);
if (validData(cached) && cached.date >= D.date) { D = cached; dataSource = 'Cached report'; }
let quote = { price: D.btcPrice, date: D.date, source: 'Report snapshot', live: false, fetchedAt: null };
let history = getStored(STORAGE.history, []);
if (!Array.isArray(history)) history = [];
history = history.filter(h => h && M.dateValid(h.date) && ['mvrv', 'zscore', 'btcPrice'].every(k => Number.isFinite(h[k]))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
let rawWeights = getStored(STORAGE.weights, { ...M.WEIGHTS });
if (!rawWeights || typeof rawWeights !== 'object' || Array.isArray(rawWeights)) rawWeights = { ...M.WEIGHTS };
for (const k of Object.keys(M.WEIGHTS)) { const n = Number(rawWeights[k]); rawWeights[k] = Number.isFinite(n) ? M.clamp(n, 0, 100) : M.WEIGHTS[k]; }

let mode = 'new', basis = 'start', repayWhen = 'now', currentView = 'overview', currentResult = null;
let refreshRunning = false, priceEdited = false, editRevision = 0, quoteError = null, reportError = null;
let renderFrame = null, toastTimer = null, chartScale = null, chartPrice = null, firstErrorKey = null, undoInputs = null;
const fields = [...document.querySelectorAll('[data-field]')];
const FUTURES_FIELDS = ['leverage', 'mm', 'funding'];

function readInputs() { return { mode, ...Object.fromEntries(fields.map(n => [n.dataset.field, n.value])) }; }
function weights() { return { ...rawWeights }; }

/* ---------- toast with optional undo ---------- */
function toast(message, undo = null) {
  set('toast-text', message); $('toast').classList.add('show');
  const action = $('toast-action'); action.hidden = !undo; undoInputs = undo;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').classList.remove('show'); undoInputs = null; }, undo ? 7000 : 3500);
}

/* ---------- inputs ---------- */
function applyInput(input, { keepPrice = true, undo = false, message = null } = {}) {
  const before = readInputs();
  if (input.mode) setMode(input.mode, false);
  for (const [key, value] of Object.entries(input)) {
    if (key === 'mode' || (key === 'price' && keepPrice)) continue;
    const node = $('inp-' + key);
    if (node && value != null) node.value = value;
  }
  editRevision++; chartPrice = null; render();
  if (message) toast(message, undo ? before : null);
}
function setMode(next, rerender = true) {
  mode = next === 'existing' ? 'existing' : 'new';
  $('position-panel').dataset.mode = mode;
  document.querySelectorAll('[data-mode-btn]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.modeBtn === mode)));
  set('mode-hint', mode === 'new' ? 'Plan a loan opened today. Principal is sized from LTV.' : 'Track a loan you hold. Principal, dates and purchase price stay fixed as the market moves.');
  $('inp-deployPrice').placeholder = mode === 'new' ? 'Current price' : 'Required';
  set('note-deployPrice', mode === 'new' ? 'Blank buys at the current price.' : 'What you actually paid per BTC.');
  $('basis-switch').hidden = mode !== 'existing';
  if (mode === 'new') basis = 'start';
  setRepay(mode === 'new' ? 'exit' : 'now');
  if (rerender) { editRevision++; render(); }
}
function setBasis(next) { basis = next; document.querySelectorAll('[data-basis]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.basis === basis))); chartPrice = null; if (currentResult) renderOverview(currentResult); }
function setRepay(next) { repayWhen = next === 'exit' ? 'exit' : 'now'; document.querySelectorAll('[data-repay]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.repay === repayWhen))); if (currentResult) renderRepay(currentResult); }

function validateAndRead() {
  const v = M.validate(readInputs());
  fields.forEach(node => { const msg = v.errors[node.dataset.field] || ''; node.setAttribute('aria-invalid', String(Boolean(msg))); set('error-' + node.dataset.field, msg); });
  $('validation-banner').hidden = v.valid;
  $('content').classList.toggle('invalid-results', !v.valid);
  $('export-btn').disabled = !v.valid; $('save-position').disabled = !v.valid;
  $('warning-banner').hidden = !v.warnings.length; set('warning-message', v.warnings.join(' '));
  if (!v.valid) {
    firstErrorKey = Object.keys(v.errors)[0];
    set('validation-message', `${v.errors[firstErrorKey]} Results show the last valid inputs; export and save are paused.`);
    set('update-status', 'Check inputs');
    return null;
  }
  firstErrorKey = null;
  return v.value;
}
function gotoError() {
  if (!firstErrorKey) return;
  if (FUTURES_FIELDS.includes(firstErrorKey)) switchView('futures');
  else { $('position-panel').open = true; const node = $('inp-' + firstErrorKey); node?.closest('details.disclosure')?.setAttribute('open', ''); }
  $('inp-' + firstErrorKey)?.focus();
}

/* ---------- render ---------- */
function render() {
  if (!validateAndRead()) return;
  const d = M.calculate(readInputs(), D, weights()); currentResult = d;
  const range = $('ltv-range'); range.max = Math.max(0, d.mcLtv * 100 - 0.5); if (mode === 'new') range.value = d.input.ltv;
  set('horizon-label', d.existing
    ? `Borrowed ${dateLabel(d.loanDate)} · ${fmt(d.loanDays)} days ago · exit ${dateLabel(d.exitDate)} (in ${fmt(d.exitDays)} days)`
    : `Opened today · exit ${dateLabel(d.exitDate)} (in ${fmt(d.exitDays)} days) · dates in UTC`);
  set('plan-status', d.existing ? `Existing loan · day ${fmt(d.loanDays)}` : 'New loan plan');
  $('plan-status').className = 'badge ' + (d.existing ? 'info' : '');
  set('position-summary', `${fmt(d.btc, 4)} BTC · ${usd(d.loan, 0)} loan`);
  // KPIs
  set('kpi-debt', d.loan ? usd(d.debtToday) : 'No debt');
  set('kpi-debt-sub', d.loan ? `${usd(d.loan)} principal + ${usd(d.accruedInterest, 2)} interest` : 'Nothing borrowed');
  set('kpi-ltv', pct(d.currentLtv * 100)); $('kpi-ltv').className = 'kpi-value ' + statusTone(d.currentStatus);
  set('kpi-ltv-sub', d.existing ? `Started at ${pct(d.initialLtv * 100)} · margin call ${pct(d.mcLtv * 100, 0)}` : `Margin call at ${pct(d.mcLtv * 100, 0)}`);
  set('kpi-liq', d.loan ? usd(d.liqPrice, 0) : 'No debt');
  set('kpi-liq-sub', d.loan ? `${pct(-d.liqDropPct)} below today’s price` : 'No liquidation threshold');
  set('kpi-interest', d.existing ? usd(d.accruedInterest, 2) : usd(d.exitInterest));
  set('kpi-interest-sub', d.existing ? `so far · ${usd(d.exitInterest)} by exit date` : `by exit date · ${pct(d.apr * 100)} APR`);
  document.querySelectorAll('[data-target]').forEach(b => { const t = targetFor(b.dataset.target, d); b.setAttribute('aria-pressed', String(t > 0 && Math.abs(d.target - Math.round(t)) < 1)); b.disabled = !(t > 0); });
  renderOverview(d); renderActive(d);
  set('update-status', refreshRunning ? 'Refreshing data…' : 'Up to date');
  window.__terminalReady = true;
}
function scheduleRender() { if (renderFrame !== null) cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); }); }
function renderActive(d) { if (currentView === 'scenarios') renderScenarios(d); if (currentView === 'risk') renderRisk(d); if (currentView === 'signals') renderSignals(d); if (currentView === 'futures') renderFutures(d); }

const pnlKey = () => basis === 'today' ? 'pnlToday' : 'pnlStart';
const holdKey = () => basis === 'today' ? 'holdToday' : 'holdStart';

function renderOverview(d) {
  renderVerdict(d);
  const s = d.at, dead = s.status === 'Liquidation', pnl = s[pnlKey()], ret = basis === 'today' ? s.returnTodayPct : s.returnStartPct;
  set('target-pnl-label', basis === 'today' ? 'P/L from today, at target' : (d.existing ? 'P/L since borrowing, at target' : 'P/L at target'));
  set('target-pnl', dead ? 'Unavailable' : signed(pnl)); $('target-pnl').className = 'hero-num num ' + (dead ? 'bad' : tone(pnl));
  set('target-return', dead ? 'Target is past your liquidation price.' : `${signedPct(ret)} · holding alone: ${signed(s[holdKey()])} · loan adds ${signed(s.loanTrade)}`);
  set('target-value', usd(d.target, 0)); set('target-status', s.status); $('target-status').className = 'badge ' + statusTone(s.status);
  set('payoff-sub', `Valued on ${dateLabel(d.exitDate)}, after ${usd(d.exitInterest)} total interest.`);
  // Signal card
  if (d.score != null) {
    set('score-number', fmt(d.score, 1));
    const stale = M.ageHours(D.date) > 48; set('score-badge', stale ? 'Stale data' : 'Heuristic'); $('score-badge').className = 'badge ' + (stale ? 'warn' : '');
    set('score-title', d.score >= 7 ? 'Supportive cycle signals' : d.score >= 5 ? 'Mixed cycle signals' : 'Cautious cycle signals');
    const delta = (D.mvrv / D.histMeanMvrv - 1) * 100;
    set('score-context', `MVRV is ${pct(Math.abs(delta), 0)} ${delta < 0 ? 'below' : 'above'} its long-run mean. This is market context, not loan safety.`);
    $('score-track').innerHTML = Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.round(d.score) ? 'on' : ''}"></i>`).join('');
  }
  $('allocation-fill').style.width = d.deployPct * 100 + '%';
  set('allocation-deployed', usd(d.deployedUsd)); set('allocation-cash', usd(d.cash));
  set('allocation-btc', d.newBtc ? '+' + btcAmt(d.newBtc) : '—'); set('allocation-total', btcAmt(d.totalBtc));
  renderRepay(d); renderCheckpoints(d);
  if (currentView === 'overview') renderPayoff(d);
}

function renderVerdict(d) {
  let label, kind, text;
  if (!d.loan) { label = 'No debt'; kind = ''; text = 'No loan is modelled. Set an LTV above 0% (new loan) or enter your principal (existing loan).'; }
  else if (d.existing) {
    const r = M.repayment(d, d.price, 'now');
    if (!r.available) { label = 'Liquidation zone'; kind = 'bad'; text = `At ${usd(d.price, 0)} your LTV is ${pct(d.currentLtv * 100)}, past your ${pct(d.liqLtv * 100, 0)} liquidation level. Check your lender’s position now.`; }
    else {
      const ahead = r.btcChange > 1e-12, behind = r.btcChange < -1e-12;
      label = ahead ? 'Ahead of holding' : behind ? 'Behind holding' : 'Even with holding'; kind = ahead ? 'good' : behind ? 'bad' : '';
      text = `Repaying today would leave ${btcAmt(r.walletBtc)}: ${sats(Math.abs(r.btcChange)).replace(/^[+−]/, '')} ${ahead ? 'more' : behind ? 'fewer' : 'difference'} than just holding (${signed(r.edgeVsHold)}).`;
      if (r.beatHoldPrice !== null) text += ` The loan starts beating holding above ${usd(r.beatHoldPrice, 0)} (${signedPct((r.beatHoldPrice / d.price - 1) * 100)} from now).`;
      text += ` Liquidation sits at ${usd(d.liqPrice, 0)}, ${pct(-d.liqDropPct)} below today.`;
      if (d.currentStatus === 'Margin call') { label = 'Margin call zone'; kind = 'warn'; }
    }
  } else {
    label = 'Plan'; kind = 'info';
    text = `Borrowing ${usd(d.loan)} at ${pct(d.initialLtv * 100)} LTV`;
    text += d.newBtc ? ` buys ${btcAmt(d.newBtc)}. By ${dateLabel(d.exitDate)} you’ll owe ${usd(d.debtAtExit)}. The trade beats just holding if BTC is above ${usd(d.beatHoldPrice, 0)} then (${signedPct((d.beatHoldPrice / d.price - 1) * 100)} from now).` : ` and holding it as cash costs ${usd(d.exitInterest)} by ${dateLabel(d.exitDate)} with no upside.`;
    text += ` Liquidation would start at ${usd(d.liqPrice, 0)} (${pct(-d.liqDropPct)}).`;
  }
  set('verdict-badge', label); $('verdict-badge').className = 'badge ' + kind; set('verdict-text', text);
}

function renderRepay(d) {
  const when = repayWhen, px = when === 'now' ? d.price : d.target, r = M.repayment(d, px, when);
  set('repay-sub', when === 'now'
    ? `At today’s ${usd(d.price, 0)}, paying ${usd(r.debt)} (principal + interest to date).`
    : `At your ${usd(d.target, 0)} target on ${dateLabel(d.exitDate)}, paying ${usd(r.debt)} (interest to exit date).`);
  const rows = [
    row('Debt to repay', usd(r.debt)), row('of which interest', usd(r.interest)),
    row('Paid from unused loan cash', usd(r.cashUsed)),
    row(`Collateral sold at ${usd(px, 0)}`, r.available ? btcAmt(r.soldBtc, 8) : '—'),
    row('Your BTC left', r.available ? btcAmt(r.residualBtc, 8) : '—'),
    row('BTC bought with loan (kept)', btcAmt(d.newBtc, 8)),
    row('Final wallet', r.available ? btcAmt(r.walletBtc, 8) : '—', 'total'),
    row('Cash left over', usd(r.cashLeft)),
    row('Wallet value + cash', r.available ? usd(r.netAssets) : '—'),
    row(d.existing ? 'P/L since borrowing' : 'P/L vs. collateral today', r.available ? signed(r.pnlStart) : '—'),
    row('P/L vs. your cost basis', r.available ? signed(r.costBasisPnl) : '—'),
    row('Advantage vs. just holding', r.available ? signed(r.edgeVsHold) : '—', 'total'),
    row('Beat-holding price', r.beatHoldPrice === null ? 'n/a (no loan BTC)' : usd(r.beatHoldPrice, 0))
  ];
  $('repay-rows').innerHTML = rows.join('');
  $('repay-formula').innerHTML = 'Cash used = min(unused loan cash, debt)<br>Collateral sold = (debt − cash used) ÷ price<br>Final BTC = your BTC − collateral sold + loan BTC<br>Beat-holding price = (debt − cash) ÷ loan BTC';
  if (!d.loan) {
    set('repay-wallet', btcAmt(d.btc)); set('repay-change', 'No debt to repay.'); set('repay-badge', 'No debt'); $('repay-badge').className = 'badge';
    $('repay-flow').innerHTML = ''; $('compose-track').innerHTML = ''; set('compose-total', btcAmt(d.btc)); set('repay-note', ''); return;
  }
  if (!r.available) {
    set('repay-wallet', 'Unavailable'); $('repay-wallet').className = 'hero-num num bad';
    set('repay-change', `At ${usd(px, 0)} the LTV is ${pct(r.ltv * 100)}, past liquidation.`);
    set('repay-badge', 'Liquidation zone'); $('repay-badge').className = 'badge bad';
    $('repay-flow').innerHTML = '<p class="hint">Lender liquidation settlement (fees, residual balance) is not modelled.</p>';
    $('compose-track').innerHTML = ''; set('compose-total', '—'); set('repay-note', ''); return;
  }
  const ahead = r.btcChange > 1e-12, behind = r.btcChange < -1e-12;
  set('repay-wallet', btcAmt(r.walletBtc)); $('repay-wallet').className = 'hero-num num ' + (ahead ? 'good' : behind ? 'bad' : '');
  set('repay-change', `${sats(r.btcChange)} (${signedPct(r.btcChangePct)}) vs. holding ${btcAmt(d.btc)} · ${signed(r.edgeVsHold)} in dollars`);
  const label = r.status === 'Margin call' ? 'Margin call zone' : ahead ? 'Ahead of holding' : behind ? 'Behind holding' : 'Even with holding';
  set('repay-badge', label); $('repay-badge').className = 'badge ' + (r.status === 'Margin call' ? 'warn' : ahead ? 'good' : behind ? 'bad' : '');
  const node = (title, amount, cls = '', sub = '') => `<div class="flow-node ${cls}"><span>${escapeHTML(title)}</span><strong>${escapeHTML(btcAmt(amount))}</strong><em>${escapeHTML(sub || usd(amount * px) + ' at this price')}</em></div>`;
  $('repay-flow').innerHTML = node('Your BTC', d.btc) + '<div class="flow-op" aria-label="minus">−</div>'
    + node('Sold to repay', r.soldBtc, 'sold', r.cashUsed > 0 ? `after ${usd(r.cashUsed)} paid from cash` : usd(r.soldBtc * px) + ' at this price')
    + '<div class="flow-op" aria-label="equals">=</div>' + node('Your BTC left', r.residualBtc)
    + '<div class="flow-op" aria-label="plus">+</div>' + node('Bought with loan', d.newBtc, 'funded')
    + '<div class="flow-op" aria-label="equals">=</div>' + node('Final wallet', r.walletBtc, 'final');
  const scale = Math.max(d.btc, r.walletBtc) * 1.06, ww = r.walletBtc / scale * 100;
  const oShare = r.walletBtc ? Math.max(0, r.residualBtc) / r.walletBtc * 100 : 0, fShare = r.walletBtc ? d.newBtc / r.walletBtc * 100 : 0;
  $('compose-track').innerHTML = `<div class="compose-wallet" style="width:${ww}%"><i class="compose-original" style="width:${oShare}%"></i><i class="compose-funded" style="width:${fShare}%"></i></div><i class="compose-benchmark" style="left:${d.btc / scale * 100}%"></i>`;
  set('compose-total', `${btcAmt(r.walletBtc)} · ${usd(r.netAssets)}`);
  const notes = [];
  if (r.cashUsed > 0) notes.push(`${usd(r.cashUsed)} of unused loan cash pays the debt first${r.cashLeft > 0 ? `; ${usd(r.cashLeft)} cash is left over` : ''}.`);
  if (r.beatHoldPrice !== null) notes.push(`You end with more BTC than holding whenever BTC is above ${usd(r.beatHoldPrice, 0)} at repayment.`);
  if (r.status === 'Margin call') notes.push('This price is inside the margin-call zone; your lender may act first.');
  notes.push('Fees, slippage and tax are excluded.');
  set('repay-note', notes.join(' '));
}

function renderCheckpoints(d) {
  const be = basis === 'today' ? d.breakevenToday : d.breakevenStart;
  const items = [
    ['Liquidation', d.loan ? usd(d.liqPrice, 0) : 'No debt', d.loan ? `${signedPct(d.liqDropPct)} · ${usd(d.liqPriceExit, 0)} by exit` : '', 'bad'],
    ['Margin call', d.loan ? usd(d.mcPrice, 0) : 'No debt', d.loan ? `${signedPct((d.mcPrice / d.price - 1) * 100)} · ${usd(d.mcPriceExit, 0)} by exit` : '', 'warn'],
    ['Beat holding', d.beatHoldPrice != null ? usd(d.beatHoldPrice, 0) : 'n/a', d.beatHoldPrice != null ? `${signedPct((d.beatHoldPrice / d.price - 1) * 100)} · loan trade breaks even` : 'No BTC bought with the loan', 'info'],
    [basis === 'today' ? 'Break-even from today' : (d.existing ? 'Break-even since borrowing' : 'Break-even'), usd(be, 0), `${signedPct((be / d.price - 1) * 100)} · total P/L = 0`, ''],
    ['Model floor', usd(D.floorPrice, 0), 'MVRV model estimate', 'muted'],
    ['Model ceiling', usd(D.ceilPrice, 0), 'MVRV model estimate', 'good']
  ];
  $('checkpoints').innerHTML = items.map(([label, value, sub, kind]) => `<div class="level-item"><div class="level-label"><i class="level-bar ${kind}"></i>${escapeHTML(label)}</div><div class="num strong ${kind}">${escapeHTML(value)}</div><p class="hint">${escapeHTML(sub)}</p></div>`).join('');
  set('checkpoints-sub', 'Liquidation and margin call use today’s debt; break-evens use the debt on your exit date.');
}

/* ---------- payoff chart ---------- */
function domain(d) {
  const pts = [d.price, d.target, d.beatHoldPrice, d.breakevenStart, D.floorPrice, D.ceilPrice, d.liqPriceExit, d.mcPriceExit].filter(n => Number.isFinite(n) && n > 0);
  return [Math.max(1, Math.min(d.price * 0.4, ...pts) * 0.85), Math.max(...pts, d.price * 1.3) * 1.08];
}
function renderPayoff(d) {
  const node = $('payoff-chart'); if (!node || currentView !== 'overview') return;
  const width = Math.max(300, node.clientWidth || 600), height = width < 420 ? 250 : 290, L = 56, R = 16, T = 18, B = 34, W = width - L - R, H = height - T - B;
  const [min, max] = domain(d), pk = pnlKey(), hk = holdKey(), sMin = M.scenario(d, min), sMax = M.scenario(d, max);
  const vals = [sMin[pk], sMax[pk], sMin[hk], sMax[hk], 0], lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = Math.max(1, (hi0 - lo0) * 0.08), lo = lo0 - pad, hi = hi0 + pad;
  const x = p => L + (p - min) / (max - min) * W, y = v => T + (hi - v) / (hi - lo) * H;
  const grid = Array.from({ length: 5 }, (_, i) => { const v = lo + (hi - lo) * i / 4; return `<line class="gridline" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`; }).join('');
  const tc = width < 460 ? 4 : 6, ticks = Array.from({ length: tc }, (_, i) => { const v = min + (max - min) * i / (tc - 1); return `<text x="${x(v)}" y="${height - 10}" text-anchor="middle">${compact(v)}</text>`; }).join('');
  const liq = d.loan ? d.liqPriceExit : 0, mc = d.loan ? d.mcPriceExit : 0;
  const liqX = x(M.clamp(liq, min, max)), mcX = x(M.clamp(mc, min, max));
  const from = Math.max(min, liq), sFrom = M.scenario(d, from), alive = from <= max;
  const curve = alive ? `M ${x(from)} ${y(sFrom[pk])} L ${x(max)} ${y(sMax[pk])}` : '';
  const area = alive ? `M ${x(from)} ${y(0)} L ${x(from)} ${y(sFrom[pk])} L ${x(max)} ${y(sMax[pk])} L ${x(max)} ${y(0)} Z` : '';
  const tgt = d.at, tAlive = tgt.status !== 'Liquidation';
  const vline = (p, cls, label, ly) => Number.isFinite(p) && p > min && p < max ? `<line class="${cls}" x1="${x(p)}" x2="${x(p)}" y1="${T}" y2="${T + H}"/><text class="marker-label" x="${x(p) + 4}" y="${ly}">${label}</text>` : '';
  node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Payoff at the exit date. Beat-holding price ${escapeHTML(usd(d.beatHoldPrice, 0))}. Liquidation below ${escapeHTML(usd(liq, 0))}."><defs><linearGradient id="payoff-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient><clipPath id="plot-clip"><rect x="${L}" y="${T}" width="${W}" height="${H}"/></clipPath></defs>${grid}${ticks}<g clip-path="url(#plot-clip)"><rect x="${L}" y="${T}" width="${Math.max(0, liqX - L)}" height="${H}" class="zone-liq"/><rect x="${liqX}" y="${T}" width="${Math.max(0, mcX - liqX)}" height="${H}" class="zone-mc"/><line class="zero" x1="${L}" x2="${width - R}" y1="${y(0)}" y2="${y(0)}"/><path d="M ${x(min)} ${y(sMin[hk])} L ${x(max)} ${y(sMax[hk])}" class="hold-line"/><path d="${area}" fill="url(#payoff-fill)"/><path d="${curve}" class="curve"/>${vline(d.beatHoldPrice, 'marker', 'Beat holding', T + 12)}${vline(d.price, 'marker now', 'Now', T + H - 6)}${tAlive ? `<circle cx="${x(d.target)}" cy="${y(tgt[pk])}" r="5" class="target-dot"/>` : ''}<line id="inspect-line" x1="0" x2="0" y1="${T}" y2="${T + H}" class="inspect"/><circle id="inspect-point" cx="0" cy="0" r="4" class="inspect-dot"/></g></svg><div class="chart-tooltip" id="payoff-tooltip" hidden></div>`;
  chartScale = { x, y, min, max, L, R, width };
  const scrub = $('chart-scrub'); scrub.min = Math.ceil(min); scrub.max = Math.floor(max); scrub.step = Math.max(1, Math.round((max - min) / 200));
  const p = chartPrice === null ? d.target : M.clamp(chartPrice, min, max); scrub.value = p; set('scrub-output', usd(p, 0));
}
function inspectChart(price, pointerX = null) {
  if (!chartScale || !currentResult) return;
  const d = currentResult, s = chartScale, p = M.clamp(price, s.min, s.max), out = M.scenario(d, p), pk = pnlKey(); chartPrice = p;
  $('chart-scrub').value = p; set('scrub-output', usd(p, 0));
  const line = $('inspect-line'), point = $('inspect-point'), tip = $('payoff-tooltip'); if (!line || !tip) return;
  line.setAttribute('x1', s.x(p)); line.setAttribute('x2', s.x(p)); line.classList.add('on');
  point.setAttribute('cx', s.x(p)); point.setAttribute('cy', s.y(out[pk])); point.classList.toggle('on', out.status !== 'Liquidation');
  const dead = out.status === 'Liquidation';
  tip.innerHTML = `<span class="muted">BTC ${usd(p, 0)}</span><strong class="${dead ? 'bad' : tone(out[pk])}">${dead ? 'Liquidation zone' : signed(out[pk])}</strong><span class="muted">${dead ? '' : 'vs. holding ' + signed(out.loanTrade) + ' · '}LTV ${pct(out.ltv * 100)}</span>`;
  tip.hidden = false; tip.style.left = M.clamp((pointerX ?? s.x(p)) + 12, 8, Math.max(8, s.width - 200)) + 'px';
}
function hideInspect() { const tip = $('payoff-tooltip'); if (tip) tip.hidden = true; $('inspect-line')?.classList.remove('on'); $('inspect-point')?.classList.remove('on'); }

/* ---------- scenarios ---------- */
const LADDER_LABELS = { pnlStart: 'P/L since borrowing', pnlToday: 'P/L from today', loanTrade: 'Loan trade', costBasis: 'P/L vs. cost basis' };
function ladder(d) {
  const anchors = [[d.loan ? d.liqPriceExit : null, 'Liquidation'], [d.loan ? d.mcPriceExit : null, 'Margin call'], [D.floorPrice, 'Model floor'], [d.price, 'Now'], [d.target, 'Target'], [d.beatHoldPrice, 'Beat holding'], [d.breakevenStart, 'Break-even'], [D.ceilPrice, 'Model ceiling'], [D.c4Ath, 'Cycle ATH']].map(([price, label]) => ({ price, label }));
  const steps = [0.4, 0.6, 0.8, 1.2, 1.5, 2].map(v => ({ price: d.price * v, label: '' }));
  const sorted = [...steps, ...anchors].filter(r => Number.isFinite(r.price) && r.price > 0).sort((a, b) => a.price - b.price), merged = [];
  for (const r of sorted) { const prev = merged.at(-1); if (prev && Math.abs(prev.price - r.price) / r.price < 0.002) { if (r.label) { prev.labels.push(r.label); prev.price = r.price; } } else merged.push({ price: r.price, labels: [r.label] }); }
  return merged.map(r => ({ ...M.scenario(d, r.price), labels: r.labels.filter(Boolean) }));
}
function renderScenarios(d) {
  const key = $('pnl-basis').value, rows = ladder(d);
  set('ladder-pnl-label', LADDER_LABELS[key]);
  set('ladder-sub', `Every row is valued on ${dateLabel(d.exitDate)} with ${usd(d.debtAtExit)} owed (${usd(d.exitInterest)} interest).`);
  $('ladder-rows').innerHTML = rows.map(s => { const dead = s.status === 'Liquidation', v = s[key]; return `<tr class="${s.labels.includes('Target') ? 'target-row' : ''}"><td><span class="row-price">${usd(s.price, 0)}</span>${s.labels.length ? `<span class="row-label">${escapeHTML(s.labels.join(' · '))}</span>` : ''}</td><td>${signedPct(s.change)}</td><td class="${statusTone(s.status)}">${pct(s.ltv * 100)}</td><td>${badge(s.status, statusTone(s.status))}</td><td>${dead ? '—' : usd(s.equity)}</td><td class="${dead ? 'muted' : tone(v)}">${dead ? '—' : signed(v)}</td></tr>`; }).join('');
  const notes = { pnlStart: d.existing ? 'Against your BTC’s value when you borrowed.' : 'Against your collateral’s value today.', pnlToday: 'Against today’s net equity: only future price moves and future interest count.', loanTrade: 'The loan’s contribution alone: loan BTC gain minus all interest. Positive means the loan beat just holding.', costBasis: d.entrySet ? 'Your BTC against your cost basis, plus the loan trade.' : 'No cost basis set, so your BTC uses the price when you borrowed. Add it under Lender terms & cost basis.' };
  set('ladder-note', notes[key] + ' Rows past liquidation are unavailable; an earlier dip can also liquidate before a higher exit.');
  const s = d.at, dead = s.status === 'Liquidation';
  set('decomp-badge', s.status); $('decomp-badge').className = 'badge ' + statusTone(s.status);
  $('decomposition').innerHTML = row('Your BTC at target', usd(d.btc * d.target)) + row('Loan BTC at target', usd(d.newBtc * d.target)) + row('Unused loan cash', usd(d.cash)) + row('Debt on exit date', '−' + usd(d.debtAtExit)) + row('Net equity', dead ? 'Unavailable' : usd(s.equity), 'total') + row(d.existing ? 'Your BTC when you borrowed' : 'Your BTC today', usd(d.startValue)) + row(d.existing ? 'P/L since borrowing' : 'P/L', dead ? '—' : signed(s.pnlStart), 'total') + (d.existing ? row('P/L from today', dead ? '—' : signed(s.pnlToday)) : '') + row('Loan trade (vs. holding)', dead ? '—' : signed(s.loanTrade));
  renderLadderChart(d, rows, key);
}
function renderLadderChart(d, rows, key) {
  const node = $('ladder-chart'), width = Math.max(300, node.clientWidth || 800), height = 270, L = 56, R = 44, T = 22, B = 36, W = width - L - R, H = height - T - B;
  const values = rows.filter(r => r.status !== 'Liquidation').map(r => r[key]).filter(Number.isFinite), max = Math.max(1, ...values.map(Math.abs)) * 1.15;
  const y = v => T + H / 2 - v / max * H / 2, x = i => L + (i + 0.5) * W / rows.length, bw = Math.min(30, W / rows.length * 0.55);
  const ltvMax = Math.max(100, ...rows.map(r => Math.min(r.ltv * 100, 400))) * 1.05, ly = v => T + H - Math.min(v, ltvMax) / ltvMax * H;
  const grid = [-1, -0.5, 0, 0.5, 1].map(k => `<line class="gridline" x1="${L}" x2="${width - R}" y1="${y(max * k)}" y2="${y(max * k)}"/><text x="${L - 8}" y="${y(max * k) + 4}" text-anchor="end">${compact(max * k)}</text>`).join('');
  const every = Math.ceil(rows.length / (width < 460 ? 4 : 8));
  const bars = rows.map((r, i) => { const dead = r.status === 'Liquidation', v = r[key]; return `<g><title>${escapeHTML(usd(r.price, 0) + ' · ' + r.status + ' · ' + (dead ? 'unavailable' : signed(v)))}</title>${dead ? `<rect x="${x(i) - bw / 2}" y="${T}" width="${bw}" height="${H}" class="zone-liq"/>` : `<rect x="${x(i) - bw / 2}" y="${Math.min(y(0), y(v))}" width="${bw}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="3" class="${v >= 0 ? 'bar-good' : 'bar-bad'}"/>`}${i % every === 0 ? `<text x="${x(i)}" y="${height - 10}" text-anchor="middle">${compact(r.price)}</text>` : ''}</g>`; }).join('');
  const line = rows.map((r, i) => (i ? 'L' : 'M') + ' ' + x(i) + ' ' + ly(r.ltv * 100)).join(' ');
  const ltvTicks = [0, 0.5, 1].map(v => `<text x="${width - R + 6}" y="${ly(ltvMax * v) + 4}">${fmt(ltvMax * v)}%</text>`).join('');
  node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Price ladder: bars show ${escapeHTML(LADDER_LABELS[key])}; the line shows LTV at exit. Exact values are in the table below.">${grid}${bars}<path d="${line}" class="ltv-line"/>${rows.map((r, i) => `<circle cx="${x(i)}" cy="${ly(r.ltv * 100)}" r="2.5" class="${r.status === 'Liquidation' ? 'dot-bad' : 'dot-accent'}"/>`).join('')}${ltvTicks}<text x="${width - R}" y="12" text-anchor="end" class="axis-accent">LTV %</text></svg>`;
}

/* ---------- risk ---------- */
function renderRisk(d) {
  set('risk-buffer', d.loan ? pct(d.bufferPct) : 'No debt'); $('risk-buffer').className = 'big-metric ' + (d.bufferPct < 15 ? 'bad' : d.bufferPct < 35 ? 'warn' : 'good');
  set('risk-buffer-note', d.loan ? `BTC can fall ${usd(d.price - d.mcPrice, 0)} to ${usd(d.mcPrice, 0)} before a margin call.` : 'No margin call or liquidation.');
  set('risk-probability', !d.loan ? '—' : d.pLiq90 > 0 && d.pLiq90 < 0.0001 ? '<0.01%' : pct(d.pLiq90 * 100, 2));
  $('risk-probability').className = 'big-metric ' + (d.pLiq90 < 0.05 ? 'good' : d.pLiq90 < 0.15 ? 'warn' : 'bad');
  set('risk-probability-note', d.loan ? `Barrier ${usd(d.liqPrice90, 0)} (debt in 90 days) at ${pct(d.vol * 100, 0)} volatility.` : '');
  set('risk-rr', Number.isFinite(d.rrRatio) ? fmt(d.rrRatio, 2) + ' : 1' : '—');
  set('risk-rr-note', Number.isFinite(d.rrRatio) ? `Up ${usd(D.ceilPrice - d.price, 0)} to the ${usd(D.ceilPrice, 0)} ceiling vs. down ${usd(d.price - d.liqPrice, 0)} to liquidation.` : 'Needs a loan and a model ceiling above today’s price.');
  const cur = M.clamp(d.currentLtv * 100, 0, 100), mc = d.mcLtv * 100, lq = d.liqLtv * 100;
  $('risk-mechanics').innerHTML = row('Debt today', usd(d.debtToday)) + row('Days since loan', fmt(d.loanDays)) + row('LTV today (interest included)', pct(d.currentLtv * 100)) + (d.existing ? row('LTV when you borrowed', pct(d.initialLtv * 100)) : '') + row('Margin call / liquidation LTV', `${pct(mc, 0)} / ${pct(lq, 0)}`) + row('Liquidation price now', d.loan ? usd(d.liqPrice, 0) : 'No debt', 'total') + row('Liquidation price on exit date', d.loan ? usd(d.liqPriceExit, 0) : 'No debt')
    + `<div class="risk-track" aria-hidden="true"><span class="fill" style="width:${cur}%"></span><i class="mark warn" style="left:${mc}%"></i><i class="mark bad" style="left:${lq}%"></i></div><p class="hint">Bar: today’s LTV against your margin-call and liquidation levels. BTC bought with the loan is not pledged, so it does not lower these thresholds.</p>`;
  $('margin-response').innerHTML = d.loan ? `<p class="hint">If BTC falls to ${usd(d.mcPrice, 0)}, your lender asks you to bring LTV back to ${pct(d.restoreLtv * 100, 0)}. Either:</p>` + row('Add collateral', `${btcAmt(d.topUpBtc)} <span class="muted">(${usd(d.topUpUsd)})</span>`, 'total') + row('Or repay', usd(d.restoreRepayUsd)) + `<p class="hint">Uses today’s debt and your restore-to LTV (Lender terms). No grace period is assumed.</p>` : '<p class="hint">No debt, so no margin call.</p>';
  $('stress-rows').innerHTML = M.stress(d).map(s => `<tr><td>−${s.drop}%</td><td>${usd(s.price, 0)}</td><td class="${statusTone(s.status)}">${pct(s.ltv * 100)}</td><td>${badge(s.status, statusTone(s.status))}</td></tr>`).join('');
}

/* ---------- signals ---------- */
function renderSignals(d) {
  const bull = /bull/i.test(D.maStack), bear = /bear/i.test(D.maStack);
  const cards = [
    ['MVRV ratio', fmt(D.mvrv, 3), D.mvrv < 1 ? 'Below realized value' : D.mvrv < D.histMeanMvrv ? 'Below long-run mean' : 'Above long-run mean', `Long-run mean ${fmt(D.histMeanMvrv, 3)}`, D.mvrv < D.histMeanMvrv ? 'good' : 'warn'],
    ['Z-score', fmt(D.zscore, 3), D.zscore < 0 ? 'Below average' : 'Above average', 'Standard deviations from the MVRV mean', D.zscore < 0 ? 'good' : 'warn'],
    ['MVRV moving averages', bull ? 'Bullish' : bear ? 'Bearish' : 'Mixed', '20 / 50 / 200 day', `${fmt(D.ma20, 3)} / ${fmt(D.ma50, 3)} / ${fmt(D.ma200, 3)}`, bull ? 'good' : bear ? 'bad' : 'warn'],
    ['30-day MVRV momentum', signedPct(D.roc30), D.roc30 >= 0 ? 'Rising' : 'Falling', `90-day ${signedPct(D.roc90)}`, D.roc30 >= 0 ? 'good' : 'bad'],
    ['Cycle position', pct(D.cyclePos), D.cyclePos < 35 ? 'Early cycle' : D.cyclePos < 65 ? 'Mid cycle' : 'Late cycle', D.cycleName, 'info'],
    ['Price vs. cycle high', pct(d.athDropPct), 'Drawdown from ATH', `${usd(D.c4Ath, 0)} · ${D.c4AthDate || 'date unavailable'}`, 'warn']
  ];
  $('signal-cards').innerHTML = cards.map(([label, value, tag, note, kind]) => `<div class="card signal-card"><div class="overline">${escapeHTML(label)}</div><div class="big-metric ${kind}">${escapeHTML(value)}</div>${badge(tag, kind)}<p class="hint">${escapeHTML(note)}</p></div>`).join('');
  for (const k of Object.keys(M.WEIGHTS)) set('weight-value-' + k, pct(d.signals.weights[k] * 100, 0));
  set('weight-note', d.signals.usedDefaults ? 'All weights are zero, so the default mix is used.' : `Composite score ${fmt(d.score, 2)} / 10`);
  set('cycle-title', D.cycleName + ' · context');
  $('cycle-context').innerHTML = `<div class="key-row"><span>Elapsed cycle</span><strong>${pct(D.cyclePos)}</strong></div><div class="cycle-track"><div class="cycle-fill" style="width:${M.clamp(D.cyclePos, 0, 100)}%"></div></div>` + row('MVRV cycle peak', fmt(D.cyclePeakMvrv, 3)) + row('MVRV drop from peak', pct(D.cycleDrawdown)) + row('Model floor', usd(D.floorPrice, 0)) + row('Model ceiling', usd(D.ceilPrice, 0)) + row('Ceiling range', usd(D.ceilLow, 0) + ' – ' + usd(D.ceilHigh, 0)) + row('Next halving (est.)', escapeHTML(D.nextHalving || '—')) + '<p class="hint">MVRV drop is a ratio change, not a BTC price drop. Model ranges are estimates.</p>';
  const below = D.mvrv < D.histMeanMvrv;
  $('signal-reading').innerHTML = `<p><strong>Valuation:</strong> MVRV is ${below ? 'below' : 'above'} its long-run mean by ${pct(Math.abs((D.mvrv / D.histMeanMvrv - 1) * 100))}, which ${below ? 'lifts' : 'lowers'} the valuation part of the score.</p><p><strong>Trend:</strong> the MVRV moving averages are ${bull ? 'bullish' : 'not bullish'} and 30-day momentum is ${signedPct(D.roc30)}. These describe on-chain valuation, not where price goes next.</p><p><strong>Risk:</strong> the model floor (${usd(D.floorPrice, 0)}) and ceiling (${usd(D.ceilPrice, 0)}) are uncertain. Your liquidation risk depends on your LTV and lender, not on this score. Worst historical MVRV drawdown: ${pct(D.worstCycleDrawdown)} (${escapeHTML(D.worstCycleTag || '—')}).</p>`;
  $('history-rows').innerHTML = history.length ? history.map(h => `<tr><td>${escapeHTML(h.date)}</td><td>${fmt(h.mvrv, 3)}</td><td>${fmt(h.zscore, 3)}</td><td>${usd(h.btcPrice, 0)}</td></tr>`).join('') : '<tr><td colspan="4" class="left">No refreshed snapshots yet. Refresh data to save one on this device.</td></tr>';
  updateMarket();
}

/* ---------- futures ---------- */
function renderFutures(d) {
  const f = M.futures(d), s = d.at, loanDead = s.status === 'Liquidation', futDead = f.targetLiquidated, none = f.notionalUsd === 0;
  const cell = (value, sub = '') => escapeHTML(value) + (sub ? `<small>${escapeHTML(sub)}</small>` : '');
  const days = fmt(d.totalDays);
  const rows = [
    ['Extra BTC', cell(d.newBtc ? '+' + btcAmt(d.newBtc) : '—'), cell(none ? '—' : '+' + btcAmt(f.notionalBtc), 'Same exposure')],
    ['Borrowed / traded', cell(usd(d.loan), 'Full principal accrues interest'), cell(usd(f.notionalUsd), 'Notional of the futures position')],
    ['Your capital', cell(usd(d.startValue), 'Your BTC, pledged'), cell(usd(f.capital), 'Your BTC + cash margin')],
    ['What can be liquidated', cell(usd(d.collateral), 'Your pledged BTC today'), cell(usd(f.margin), 'Only the margin; spot BTC stays yours')],
    ['Liquidation price', cell(d.loan ? usd(d.liqPrice, 0) : 'No debt', d.loan ? signedPct(d.liqDropPct) + ' from now' : ''), cell(none ? 'No position' : usd(f.liqPrice, 0), none ? '' : signedPct(f.liqDropPct) + ' from now')],
    [`Carry over ${days} days`, cell(usd(d.exitInterest), pct(d.apr * 100) + ' APR, loan date → exit'), cell(usd(f.fundingCost), pct(f.fundingApr * 100) + ' funding, same window')],
    ['Beat-holding price', cell(d.beatHoldPrice != null ? usd(d.beatHoldPrice, 0) : '—'), cell(f.beatHoldPrice != null ? usd(f.beatHoldPrice, 0) : '—')],
    ['P/L since borrowing, at target', cell(loanDead ? 'Unavailable' : signed(f.pnlLoan), loanDead ? 'Past liquidation' : 'After all interest'), cell(futDead ? 'Unavailable' : signed(f.pnlFut), futDead ? 'Past liquidation' : 'After funding')],
    ['Return on your capital', cell(loanDead ? '—' : signedPct(f.returnLoanPct)), cell(futDead ? '—' : signedPct(f.returnFutPct))],
    ['Futures leg on margin', cell('—'), cell(futDead || none ? '—' : signedPct(f.legReturnPct), none ? 'No futures position' : '')]
  ];
  $('comparison-rows').innerHTML = rows.map(([label, a, b]) => `<tr><td>${escapeHTML(label)}</td><td>${a}</td><td>${b}</td></tr>`).join('');
  let text = none ? `With 0% of the loan used, there is no futures leg. The loan still costs ${usd(d.exitInterest)} in interest on cash you hold. ` : `Both add ${btcAmt(d.newBtc)}. ${Math.abs(f.costDifference) < 0.005 ? 'Carry costs are equal.' : f.costDifference > 0 ? `The loan costs ${usd(f.costDifference)} less over ${days} days.` : `Futures cost ${usd(-f.costDifference)} less over ${days} days.`} `;
  if (d.loan && !none) text += f.liquidatedNow ? 'The futures position would already be liquidated at today’s price. ' : `${d.liqPrice < f.liqPrice ? 'The loan' : 'Futures'} has the lower liquidation price today. Futures needs ${usd(f.margin)} of extra cash margin. `;
  text += loanDead || futDead ? 'At least one side is past liquidation at your target.' : 'Both target results assume neither side is liquidated on the way.';
  set('futures-insight', text);
}

/* ---------- views ---------- */
const VIEWS = { overview: 'Overview', scenarios: 'Scenarios', risk: 'Risk & liquidation', signals: 'On-chain signals', futures: 'Loan vs. futures' };
function switchView(view, focus = false) {
  if (!Object.hasOwn(VIEWS, view)) return;
  currentView = view;
  document.querySelectorAll('[role=tab]').forEach(b => { const on = b.dataset.view === view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('[role=tabpanel]').forEach(p => p.hidden = p.id !== 'pane-' + view);
  set('page-title', VIEWS[view]);
  if (currentResult) { if (view === 'overview') renderOverview(currentResult); else renderActive(currentResult); }
  if (focus) $('tab-' + view).focus();
}
function targetFor(which, d) {
  return which === 'now' ? d.price : which === 'beat' ? d.beatHoldPrice ?? 0 : which === 'ceiling' ? D.ceilPrice : which === 'ath' ? D.c4Ath ?? 0 : which === 'double' ? (d.entrySet ? d.entry : d.borrowPrice) * 2 : 0;
}

/* ---------- market data ---------- */
function updateMarket() {
  set('market-price', usd(quote.price, 0)); set('ticker-mvrv', fmt(D.mvrv, 3)); set('ticker-zscore', fmt(D.zscore, 3));
  $('ticker-zscore').className = 'market-value ' + (D.zscore < 0 ? 'good' : '');
  const bull = /bull/i.test(D.maStack);
  set('ticker-trend', bull ? 'Bullish' : /bear/i.test(D.maStack) ? 'Bearish' : 'Mixed'); $('ticker-trend').className = 'market-value ' + (bull ? 'good' : 'warn');
  set('ticker-cycle', pct(D.cyclePos)); set('data-date', dateLabel(D.date));
  const age = quote.fetchedAt ? (Date.now() - Date.parse(quote.fetchedAt)) / 6e4 : Infinity;
  const src = quote.live ? (age < 5 ? 'Live' : 'Cached') + ' · ' + utcTime(quote.fetchedAt) : quote.source === 'CoinTH' ? `CoinTH · ${utcTime(quote.fetchedAt)}` : quote.source === 'Daily snapshot' ? `Daily close · ${dateLabel(quote.date)}` : `Snapshot · ${dateLabel(quote.date)}`;
  set('quote-source', src); $('quote-source').className = 'live-dot ' + (quote.live && age < 5 ? 'on' : '');
  const inputPrice = Number($('inp-price').value);
  set('price-source', Number.isFinite(inputPrice) && Math.abs(inputPrice - quote.price) < 0.005 ? src : 'Edited manually');
  $('use-quote').hidden = Number.isFinite(inputPrice) && Math.abs(inputPrice - quote.price) < 0.005;
  const notes = [];
  if (M.ageHours(D.date) > 48) notes.push(`On-chain data is from ${dateLabel(D.date)} (over 48 hours old).`);
  if (reportError) notes.push('On-chain refresh failed; the previous report is kept.');
  if (quoteError) notes.push('Price refresh failed; the previous price is kept.');
  else if (quote.live && age >= 5) notes.push('The live price is over 5 minutes old. Refresh to update.');
  $('data-notice').hidden = !notes.length; set('data-notice-text', notes.join(' '));
  set('data-provenance', `${dataSource} · on-chain ${dateLabel(D.date)} · price ${quote.source}, ${quote.date}${quote.fetchedAt ? ' at ' + utcTime(quote.fetchedAt) : ''}`);
}
async function fetchLatestData() {
  if (refreshRunning) return;
  refreshRunning = true; const btn = $('refresh-btn'); btn.disabled = true; btn.classList.add('spin'); btn.setAttribute('aria-busy', 'true'); set('update-status', 'Refreshing data…');
  const revision = editRevision;
  let result = null, failure = null;
  try { result = await window.MarketClient.refresh(); } catch (e) { failure = e; }
  try {
    if (result) {
      reportError = result.reportError; quoteError = result.quoteError;
      if (result.data && validData(result.data) && result.data.date >= D.date) { D = result.data; dataSource = 'GitHub report'; putStored(STORAGE.data, D); saveHistory(D); }
      else if (result.data) reportError = 'Older or incomplete report returned';
      if (result.quote) { quote = result.quote; if (!priceEdited && editRevision === revision) $('inp-price').value = quote.price; }
    } else reportError = quoteError = 'Network request failed';
  } catch (e) { failure = failure || e; }
  try { updateMarket(); render(); } catch (e) { failure = failure || e; }
  if (failure) { console.error('Refresh error', failure); toast(`Refresh error: ${failure?.message || failure}. Your inputs are unchanged.`); }
  else toast(result.data && result.quote ? `Price (${quote.source}) and on-chain data refreshed` : result.quote ? `Price refreshed (${quote.source}); on-chain report unavailable` : result.data ? 'On-chain report refreshed; price unavailable' : 'Sources unavailable; previous data kept');
  refreshRunning = false; btn.disabled = false; btn.classList.remove('spin'); btn.setAttribute('aria-busy', 'false');
  set('update-status', failure ? 'Refresh error' : reportError || quoteError ? 'Refresh incomplete' : 'Data refreshed'); window.__refreshComplete = true;
}
function saveHistory(data) { history = history.filter(h => h.date !== data.date); history.push({ date: data.date, mvrv: data.mvrv, zscore: data.zscore, btcPrice: data.btcPrice }); history.sort((a, b) => b.date.localeCompare(a.date)); history = history.slice(0, 14); putStored(STORAGE.history, history); }
async function lookupEntryPrice() {
  const date = $('entry-date').value, button = $('lookup-entry');
  if (!M.dateValid(date) || date > M.today()) { set('entry-lookup-status', 'Choose a valid date on or before today (UTC).'); return; }
  const original = $('inp-entry').value; button.disabled = true; set('entry-lookup-status', 'Looking up the daily close…');
  try {
    const series = await window.MarketClient.dailySeries(), result = M.nearestPrice(series, date);
    if (!result) throw new Error('No daily price within the 7 days before that date.');
    if ($('entry-date').value !== date || $('inp-entry').value !== original) { set('entry-lookup-status', 'Inputs changed while loading, so nothing was overwritten.'); return; }
    applyInput({ entry: Math.round(result.price) }, { undo: true, message: 'Cost basis filled from the daily close.' });
    set('entry-lookup-status', `${usd(result.price, 0)} · ${result.date}${result.exact ? '' : ' (nearest earlier date)'}`);
  } catch (e) { set('entry-lookup-status', e.message || 'Price lookup unavailable.'); } finally { button.disabled = false; }
}
function exportSnapshot() {
  if (!validateAndRead()) return;
  const report = window.LoanReport.build({ input: readInputs(), data: D, weights: weights(), quote, source: dataSource, history });
  const blob = new Blob([report], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'btc-loan-analysis-' + M.today() + '.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); toast('Analysis exported.');
}

/* ---------- saved positions ---------- */
function savedPosition() {
  const v3 = getStored(STORAGE.position, null); if (v3 && typeof v3 === 'object') return v3;
  const v2 = getStored(STORAGE.legacy, null);   // migrate the previous single-mode format
  if (v2 && typeof v2 === 'object') { const { price, ...rest } = v2; return { ...rest, mode: Number(v2.loanPrincipal) > 0 ? 'existing' : 'new', deployPrice: v2.deployPrice || '', entry: v2.entry || '', loanPrincipal: v2.loanPrincipal || '', exitDate: '' }; }
  return null;
}
function loadSaved({ silent = false } = {}) {
  const saved = savedPosition();
  if (!saved) { if (!silent) toast('Nothing saved on this device yet.'); return false; }
  applyInput(saved, silent ? {} : { undo: true, message: 'Saved position loaded.' });
  if (silent) set('position-status', 'Loaded your saved position');
  return true;
}
function savePosition() {
  if (!validateAndRead()) return;
  const { price, ...input } = readInputs();
  if (putStored(STORAGE.position, input)) { set('position-status', 'Saved on this device'); toast('Position saved on this device.'); }
  else toast('This browser blocked saving. Export your analysis instead.');
}

/* ---------- appearance ---------- */
function effectiveTheme() { return document.documentElement.dataset.theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function setTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  $('theme-toggle').setAttribute('aria-label', 'Switch to ' + (effectiveTheme() === 'dark' ? 'light' : 'dark') + ' appearance');
  if (currentResult) { renderActive(currentResult); if (currentView === 'overview') renderPayoff(currentResult); }
}
function setupWeights() {
  const labels = { mvrv: 'MVRV', zscore: 'Z-score', ma: 'MA trend', roc: 'Momentum', cycle: 'Cycle' };
  $('weight-controls').innerHTML = Object.keys(M.WEIGHTS).map(k => `<div class="weight-row"><label for="weight-${k}">${labels[k]}</label><input id="weight-${k}" class="range" type="range" min="0" max="100" step="1" value="${rawWeights[k]}" data-weight="${k}"><output for="weight-${k}" id="weight-value-${k}">—</output></div>`).join('');
  document.querySelectorAll('[data-weight]').forEach(i => i.addEventListener('input', () => { rawWeights[i.dataset.weight] = Number(i.value); putStored(STORAGE.weights, rawWeights); scheduleRender(); }));
}
function updateClock() { set('utc-clock', new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'); }

/* ---------- wiring ---------- */
$('inp-price').value = D.btcPrice;
$('entry-date').max = M.today(); $('inp-loanDate').max = M.today(); $('inp-exitDate').min = M.today();
fields.forEach(n => n.addEventListener('input', () => { if (n.dataset.field === 'price') priceEdited = true; editRevision++; chartPrice = null; scheduleRender(); }));
$('ltv-range').addEventListener('input', e => { $('inp-ltv').value = e.target.value; editRevision++; scheduleRender(); });
document.querySelectorAll('[data-mode-btn]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.modeBtn)));
document.querySelectorAll('[data-basis]').forEach(b => b.addEventListener('click', () => setBasis(b.dataset.basis)));
document.querySelectorAll('[data-repay]').forEach(b => b.addEventListener('click', () => setRepay(b.dataset.repay)));
for (const group of document.querySelectorAll('[role=radiogroup]')) group.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; const opts = [...group.querySelectorAll('[role=radio]')], i = opts.findIndex(o => o.getAttribute('aria-checked') === 'true');
  const next = opts[(i + (e.key === 'ArrowRight' ? 1 : -1) + opts.length) % opts.length]; e.preventDefault(); next.click(); next.focus();
});
$('chart-scrub').addEventListener('input', e => inspectChart(Number(e.target.value)));
$('chart-scrub').addEventListener('blur', hideInspect);
$('payoff-chart').addEventListener('pointermove', e => { if (!chartScale) return; const rect = $('payoff-chart').getBoundingClientRect(), px = (e.clientX - rect.left) / (rect.width / chartScale.width); inspectChart(chartScale.min + (px - chartScale.L) / (chartScale.width - chartScale.L - chartScale.R) * (chartScale.max - chartScale.min), px); });
$('payoff-chart').addEventListener('pointerleave', hideInspect);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view, b.getAttribute('role') !== 'tab')));
document.querySelector('[role=tablist]').addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const keys = Object.keys(VIEWS), i = keys.indexOf(currentView); switchView(keys[e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length], true); });
document.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => { if (!currentResult) return; const t = targetFor(b.dataset.target, currentResult); if (t > 0) applyInput({ target: Math.round(t) }); }));
$('pnl-basis').addEventListener('change', () => currentResult && renderScenarios(currentResult));
$('refresh-btn').addEventListener('click', fetchLatestData);
$('export-btn').addEventListener('click', exportSnapshot);
$('goto-error').addEventListener('click', gotoError);
$('use-quote').addEventListener('click', () => { priceEdited = false; $('inp-price').value = quote.price; editRevision++; render(); updateMarket(); });
$('theme-toggle').addEventListener('click', () => { const next = effectiveTheme() === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(STORAGE.theme, next); } catch { } setTheme(next); });
$('lookup-entry').addEventListener('click', lookupEntryPrice);
$('reset-weights').addEventListener('click', () => { rawWeights = { ...M.WEIGHTS }; putStored(STORAGE.weights, rawWeights); setupWeights(); render(); toast('Default signal weights restored.'); });
$('save-position').addEventListener('click', savePosition);
$('restore-position').addEventListener('click', () => loadSaved());
$('load-example').addEventListener('click', () => applyInput(M.SAVED_POSITION, { undo: true, message: 'Example position loaded.' }));
$('toast-action').addEventListener('click', () => { if (!undoInputs) return; const prev = undoInputs; undoInputs = null; applyInput(prev); toast('Restored your previous inputs.'); });
document.addEventListener('keydown', window.PresetShortcuts.keyHandler(() => loadSaved()));
setupWeights();
try { const t = localStorage.getItem(STORAGE.theme); setTheme(t === 'light' || t === 'dark' ? t : null); } catch { setTheme(null); }
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => setTheme(document.documentElement.dataset.theme || null));
const narrow = window.matchMedia?.('(max-width: 900px)');
if (narrow?.matches) $('position-panel').open = false;
narrow?.addEventListener?.('change', e => { if (!e.matches) $('position-panel').open = true; });
setMode('new', false);
if (!loadSaved({ silent: true })) render();
updateClock(); updateMarket();
setInterval(() => { updateClock(); updateMarket(); }, 60000);
if (typeof ResizeObserver === 'function') { let f; const o = new ResizeObserver(() => { cancelAnimationFrame(f); f = requestAnimationFrame(() => { if (!currentResult) return; if (currentView === 'overview') renderPayoff(currentResult); if (currentView === 'scenarios') renderScenarios(currentResult); }); }); o.observe($('payoff-chart')); o.observe($('ladder-chart')); }
window.terminalRefreshPromise = fetchLatestData();
