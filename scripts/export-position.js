#!/usr/bin/env node
/**
 * export-position.js
 *
 * Drives the real index.html in a headless browser so the exported numbers
 * are always produced by the SAME calc()/render() logic the site itself
 * uses — no separate re-implementation to keep in sync.
 *
 * Steps:
 *   1. Serve the repo root over local HTTP (fetch() of the live price/MVRV
 *      data needs a real origin, not file://).
 *   2. Load index.html and wait for its own window-load fetchLatestData()
 *      call to finish (that's what pulls in today's price + MVRV snapshot).
 *   3. Type the hidden "iii" command to restore SAVED_POSITION and re-render.
 *   4. Call the page's own calc() to grab the freshly computed numbers.
 *   5. Write a clean text report to data/position-analysis.txt, replacing
 *      whatever was there before.
 *
 * Run with:  node scripts/export-position.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'position-analysis.txt');
const PORT = 8791;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtUSD(n) {
  if (!isFinite(n)) return '\u2014';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtUSD2(n) {
  if (!isFinite(n)) return '\u2014';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtPct(n, digits = 1) {
  if (!isFinite(n)) return '\u2014';
  return Number(n).toFixed(digits) + '%';
}

/**
 * Floating PnL: unrealized change in collateral value since entry
 * (d.price vs d.entry, in BTC terms), net of interest accrued on the loan
 * so far. Uses only fields calc()/D already expose — does not
 * re-derive price or loan math independently.
 *
 * Interest accrual needs a start date. calc()'s d object doesn't appear to
 * carry one (only d.entry, the entry *price*), so this looks for an
 * optional D.entryDate / D.positionOpenedAt field and falls back to
 * "n/a" if neither exists. If your SAVED_POSITION / D object stores the
 * open date under a different key, change ENTRY_DATE_KEYS below.
 */
const ENTRY_DATE_KEYS = ['entryDate', 'positionOpenedAt', 'openedAt'];

function computeFloatingPnl(d, D) {
  if (!(d.entry > 0) || !isFinite(d.entry) || !isFinite(d.price) || !isFinite(d.btc)) {
    return null;
  }

  const collateralPnl = (d.price - d.entry) * d.btc;
  const collateralPnlPct = (d.price - d.entry) / d.entry * 100;

  const entryDateRaw = ENTRY_DATE_KEYS.map((k) => D[k]).find(Boolean);
  let daysHeld = null;
  let accruedInterest = null;
  let netPnl = collateralPnl;

  if (entryDateRaw && isFinite(d.loan) && isFinite(d.apr)) {
    daysHeld = (Date.now() - new Date(entryDateRaw).getTime()) / 86400000;
    if (daysHeld > 0) {
      accruedInterest = d.loan * d.apr * (daysHeld / 365);
      netPnl = collateralPnl - accruedInterest;
    }
  }

  return { collateralPnl, collateralPnlPct, daysHeld, accruedInterest, netPnl };
}

function buildReport({ d, D, uploadStatus, staleBannerVisible }) {
  const now = new Date().toISOString();
  const verdict = d.score >= 7 ? 'Borrow-Ready' : d.score >= 5 ? 'Proceed with Care' : 'Use Caution';
  const pnl = computeFloatingPnl(d, D);

  const lines = [
    'BTC LOAN ANALYZER \u2014 SAVED POSITION SNAPSHOT',
    `Generated: ${now}`,
    `Data source: ${uploadStatus || 'n/a'}${staleBannerVisible ? '  [STALE DATA WARNING]' : ''}`,
    '',
    '-- POSITION --',
    `BTC collateral:      ${d.btc} BTC`,
    `BTC price:           ${fmtUSD(d.price)}  (as of ${D.btcPriceDate || D.date})`,
    `Collateral value:    ${fmtUSD(d.collateral)}`,
    `LTV:                 ${d.ltvPct}%`,
    `Loan amount:         ${fmtUSD(d.loan)}`,
    `APR:                 ${(d.apr * 100).toFixed(1)}%  (~${fmtUSD(d.interest)}/yr)`,
    `Entry price:         ${fmtUSD(d.entry)}`,
    '',
    '-- FLOATING PNL --',
  ];

  if (!pnl) {
    lines.push('n/a (no entry price set)');
  } else {
    lines.push(
      `Collateral P&L:      ${pnl.collateralPnl >= 0 ? '+' : ''}${fmtUSD2(pnl.collateralPnl)}  (${pnl.collateralPnlPct >= 0 ? '+' : ''}${fmtPct(pnl.collateralPnlPct, 2)})`
    );
    if (pnl.accruedInterest !== null) {
      lines.push(`Accrued interest:    -${fmtUSD2(pnl.accruedInterest)}  (${pnl.daysHeld.toFixed(0)}d held)`);
      lines.push(`Net P&L:             ${pnl.netPnl >= 0 ? '+' : ''}${fmtUSD2(pnl.netPnl)}`);
    } else {
      lines.push('Accrued interest:    n/a (no entry date recorded)');
    }
  }

  lines.push(
    '',
    '-- RISK --',
    `Margin call price:   ${fmtUSD(d.mcPrice)}  (MC LTV ${(d.mcLtv * 100).toFixed(0)}%)`,
    `Liquidation price:   ${fmtUSD(d.liqPrice)}  (Liq LTV ${(d.liqLtv * 100).toFixed(0)}%)`,
    `Drop to liquidation: ${fmtPct(Math.abs(d.liqDropPct))}`,
    `Buffer to MC:        ${fmtUSD(d.buffer)}  (${fmtPct(d.bufferPct)})`,
    `P(liq within 90d):   ${isFinite(d.pLiq90) ? fmtPct(d.pLiq90 * 100) : '\u2014'}`,
    `Kelly-optimal LTV:   ${isFinite(d.kellyLtv) && d.kellyLtv > 0 ? fmtPct(d.kellyLtv * 100, 0) : 'No edge'}`,
    `Risk/Reward:         ${d.entry > 0 && isFinite(d.rrRatio) ? d.rrRatio.toFixed(2) + ':1' : 'n/a (no entry set)'}`,
    '',
    '-- ON-CHAIN CONTEXT --',
    `MVRV:                ${D.mvrv}  (hist. mean ${D.histMeanMvrv})`,
    `Z-score:             ${D.zscore}`,
    `Cycle:                ${D.cycleName}, ${D.cyclePos}% through`,
    `ATH:                 ${fmtUSD(D.c4Ath)} on ${D.c4AthDate}  (current price is ${fmtPct(d.athDropPct)} from ATH)`,
    '',
    '-- COMPOSITE SCORE --',
    `Score:               ${d.score.toFixed(1)} / 10`,
    `Verdict:             ${verdict}`,
    '',
    '-- SCENARIO (price at cycle ceiling) --',
    `Ceiling price:       ${fmtUSD(D.ceilPrice)}`,
    `Est. net gain:       ${d.netGain >= 0 ? '+' : ''}${fmtUSD(d.netGain)}`,
    '',
    '(auto-generated daily by scripts/export-position.js \u2014 do not edit by hand)',
    ''
  );
  return lines.join('\n');
}

async function main() {
  const server = await serveStatic(ROOT, PORT);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[page error]', e));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[console.error]', msg.text());
    });

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

    // The page itself calls fetchLatestData() on window 'load'. Wait for it
    // to report a result (success or failure) before we read any numbers.
    await page
      .waitForFunction(
        () => {
          const s = document.getElementById('upload-status');
          return !!(s && s.textContent && s.textContent.trim().length > 0);
        },
        { timeout: 20000 }
      )
      .catch(() => {
        console.warn('Timed out waiting for live-data fetch status; continuing with whatever loaded.');
      });

    // Small settle delay in case the status text lands slightly before D is updated.
    await sleep(500);

    // Make sure keyboard focus isn't inside a text field, then type the
    // hidden command exactly like a person would.
    await page.click('body');
    await page.keyboard.type('iii', { delay: 120 });

    // runHiddenCommand()'s render() call is synchronous; give the DOM a beat.
    await sleep(300);

    const snapshot = await page.evaluate(() => {
      const d = calc(); // the exact function the page uses to render
      return {
        d,
        D: { ...D },
        uploadStatus: document.getElementById('upload-status')?.textContent || '',
        staleBannerVisible:
          document.getElementById('stale-banner')?.classList.contains('visible') || false,
      };
    });

    const text = buildReport(snapshot);

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, text, 'utf8');
    console.log('Wrote', OUT_FILE);
    console.log('---');
    console.log(text);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
