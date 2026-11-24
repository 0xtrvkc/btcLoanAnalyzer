# BTC Loan

Plan a new BTC-backed loan or track one you already hold. The app shows the payoff against just holding, what you'd keep if you repaid now or at your target, your liquidation risk, on-chain context, and a matched futures comparison. It is a static site with no dependencies.

Live: [0xtrvkc.github.io/btcLoanAnalyzer](https://0xtrvkc.github.io/btcLoanAnalyzer/)

## Run

Open `index.html`, or serve the folder with any static server. A local HTTP origin works best for live data requests.

```sh
npm test                  # 42 regression tests (node --test, no install needed)
npm run build             # dist/index.html with everything inlined (git-ignored)
npm run export:example    # offline text report for the public example position
```

## Two modes

**New loan** plans a loan opened today:
- principal = collateral × current price × LTV;
- the loan BTC is bought at the current price unless you enter another one.

**Existing loan** tracks a loan you hold. These inputs stay fixed while the market moves:
- principal
- loan date
- price you paid for the loan BTC
- BTC price when you borrowed (optional; defaults to the purchase price)

## Clocks and baselines

| | Uses |
|---|---|
| **Today** | Debt = principal + interest from the loan date to today. Drives the KPIs, repay-now, current liquidation and risk. |
| **Exit date** | Debt = principal + interest to your planned exit (default: one year out). Drives the target payoff, ladder, break-evens and repay-at-target. |
| **P/L since borrowing** | Equity at exit − your BTC × price when you borrowed. |
| **P/L from today** | Equity at exit − today's equity (only future moves and future interest). |
| **Loan trade** | Loan BTC × (price − purchase price) − all interest. This equals your advantage over just holding. |

There are two break-evens:
- **Beat holding** = (debt − unused cash) ÷ loan BTC. Above this price, the loan leaves you with more BTC than holding.
- **Break-even** is the price where total P/L for the chosen baseline is zero.

Repayment spends unused loan cash first, then sells collateral at the repayment price. All dates are UTC calendar days.

## Your position stays private

Nothing about your real loan lives in this repository:

- **In the app:** enter your loan and press **Save on this device**. It loads automatically next time; **Load saved** (or typing `iii`) restores it, with Undo. Positions saved by the previous version are migrated.
- **Daily report:** add a `POSITION_JSON` repository secret with the same fields, for example:

  ```json
  {"mode":"existing","btc":0.5,"loanPrincipal":15000,"loanDate":"2026-06-01","deployPrice":100000,"deploy":100,"apr":8,"target":150000}
  ```

  The workflow runs at 01:00 UTC and uploads the report as a private Actions artifact. It no longer commits anything.
- **Local run:** put the same JSON in `position.local.json` (git-ignored) and run `npm run export`.

`assets/user-config.js` holds only a fictional example used by **Load example**.

## Model limits

- Simple interest only. Fees, tax, slippage and compounding are excluded.
- Open-position values assume you weren't liquidated earlier. Liquidation settlement isn't modelled.
- The 90-day liquidation probability uses the reflection principle for a driftless log-price, with the debt owed in 90 days. It is illustrative, not a forecast.
- The futures comparison opens the same extra BTC at your purchase price over the same loan-date-to-exit window. Funding is a flat estimate. Margin tiers and fees are excluded.
- On-chain scores are uncalibrated heuristics, not borrowing advice.

## Data

On-chain reports and daily prices come from [dynamic-btc-analytics-dashboard](https://github.com/0xtrvkc/dynamic-btc-analytics-dashboard). Prices come from the Hyperliquid mid (live). If that fails, the app uses [CoinTH](https://cointh.com/api-docs) (cached up to 1 hour), then the daily close. The parser accepts both the original report labels and the format introduced upstream on 23 Nov 2026. A refresh never overwrites a price you typed; **Use live quote** puts it back.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Interface markup |
| `assets/terminal.css` | macOS-style theme: brushed steel, frosted glass, light/dark |
| `assets/engine.js` | Validation, loan maths, signal scoring, report parsing |
| `assets/app.js` | UI state, rendering, SVG charts |
| `assets/report.js` | Text report (same engine, same labels) |
| `assets/data-client.js` | Market and on-chain refresh with timeouts |
| `assets/snapshot.js` | Dated fallback on-chain report |
| `assets/user-config.js` | Public example position |
| `scripts/export-position.js` | Scheduled / local report |
| `tests/` | Engine, render, data-client and shortcut regressions |
