# BTC Loan Terminal (0xtrvkc.github.io/btcLoanAnalyzer)

A static BTC-backed loan scenario planner with a quant terminal interface. Build a position, compare exits, stress test liquidation, inspect MVRV signals, and compare a loan with a spot-plus-futures position of equal additional BTC exposure.

## Run

Open `index.html`, or serve this directory with any static web server. The interface works from its bundled, explicitly dated snapshot if external sources cannot be reached. A local or hosted HTTP origin is preferable for live data requests.

```sh
node --test tests/*.test.js
node scripts/build-static.js
node scripts/export-position.js --offline
```

No dependency installation is required for these commands. The pre-existing Puppeteer dependency is retained for compatibility, but the daily export no longer launches a browser.

`dist/index.html` embeds the styles, calculation engine, and interface scripts. Deploy `dist/` as a static site, or continue serving the repository root on GitHub Pages. The icons and manifest support installation as a standalone app; no service-worker offline cache is claimed.

## Workspace

- **Overview:** principal, collateral, liquidation, carry cost, interactive payoff curve, deployment allocation, Two Separate Pots (Simple / Quant), and price checkpoints.
- **Scenarios:** a price ladder, LTV overlay, P/L by reference price / borrowed capital / actual cost basis, and position decomposition.
- **Risk:** current and horizon thresholds, collateral top-up versus repayment, a 90-day barrier model, and assumptions.
- **Signals:** on-chain indicators, cycle context, adjustable weights, source timestamps, and 14 local snapshots.
- **Futures:** matched deployed BTC exposure, isolated margin, funding, liquidation, portfolio return, and futures-leg return.

Inputs update immediately when valid. Invalid entries keep the last valid result visible with an explicit warning and disable export/save. Controls remain keyboard accessible. The left panel participates in normal page scrolling, with no fixed height cap or hidden nested scroll area. On mobile, summary metrics appear first and position inputs expand beneath them. Motion respects `prefers-reduced-motion`.

The hidden **`iii`** shortcut restores the original repository preset when typed outside an editable field. On mobile, **press and hold BTC Amount for 800 ms** to restore the same preset. A quick tap edits normally; scrolling or cancelling the gesture aborts the hold. The **Load repository position preset** button is also available. Saving a position stores it only in the current browser and changes the button to **Load saved position**. The repository preset is in `LoanEngine.SAVED_POSITION`; changing a browser-saved position does not update the scheduled report's preset.

## Calculation corrections

- Removed silently substituted input values, including the 100× LTV fallback error. Enforced initial LTV < margin call LTV < liquidation LTV and valid maintenance margin.
- Corrected the normal CDF's missing `sqrt(2)` scaling. The 90-day model now explicitly estimates a fixed-barrier touch using the reflection principle, rather than mislabeling an endpoint probability as a liquidation-within-period probability.
- Made zero signal weights effective and documented the fallback when all weights are zero.
- Applied the selected horizon's simple interest consistently to scenario P/L, debt, equity, breakeven, and horizon thresholds.
- Matched futures notional to **deployed** loan capital, including partial and zero deployment. Corrected futures breakeven, isolated-long liquidation, portfolio return denominators, and the liquidation-buffer comparison.
- Kept original collateral and loan-funded BTC cost bases separate. Holding unused loan cash does not create profit.
- Stopped displaying open-position P/L below liquidation. Actual liquidation proceeds require execution, fees, and residual-balance assumptions.
- Replaced the stale-field-merging parser with validation of each report. Quotes and on-chain data retain separate dates; a refreshed quote cannot make an old report current.
- Added bounded requests, a single refresh transaction, fallback validation, UTC date lookup, preservation of edits during requests, and safe handling of blocked/corrupt local storage.
- Replaced CDN chart loading with native SVG plots. No external chart or font request is needed to render the interface.
- Replaced keyboard-driven daily exports with the same calculation engine and report formatter used by the UI. An incomplete online refresh preserves the existing scheduled report.

## Financial model

This is a **new-loan scenario planner**, not a fixed-debt loan tracker. Changing the reference BTC price re-sizes the loan at the chosen initial LTV. It must not be used to infer outstanding debt for an existing position.

Loan principal = collateral BTC × reference price × initial LTV. Simple interest = principal × APR × months / 12. Horizon debt includes that interest. Newly purchased BTC = deployed principal / deployment price. Net P/L = total BTC × exit price + unused loan cash − horizon debt − initial collateral value.

Borrowed-capital P/L measures the newly purchased BTC's change from its own purchase price, less all loan interest. Actual-cost-basis P/L applies the user's original purchase price only to the original collateral.

Loan-funded BTC is assumed to remain separate from pledged collateral. Futures margin is additional cash; spot BTC is outside the isolated futures position. Funding is a flat entry-notional estimate. Fees, slippage, tax, compounding, margin tiers, and funding-driven liquidation changes are not modeled.

Targets above liquidation remain conditional on the position surviving the intervening path. The on-chain score and half-Kelly illustration use uncalibrated heuristics and are not borrowing recommendations.

Math references: [NIST normal distribution](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3661.htm), [reflection principle derivation](https://almostsuremath.com/2023/04/18/the-maximum-of-brownian-motion-and-the-reflection-principle/).

## Data and export

On-chain reports and daily prices use the original [dynamic BTC analytics repository](https://github.com/0xtrvkc/dynamic-btc-analytics-dashboard). Market quotes use the existing Hyperliquid public mids endpoint, with a dated daily-price fallback. Refresh does not overwrite a manually edited reference price. **Use market quote** explicitly copies the displayed quote into loan sizing.

`Export` downloads the complete analysis as text. `node scripts/export-position.js` updates `data/position-analysis.txt` only after both market and on-chain refreshes succeed. `--offline` writes a separately named snapshot report and leaves the scheduled report untouched. The daily GitHub workflow retains its 01:00 UTC schedule and runs regression tests before exporting.

## Source map

| File | Purpose |
| --- | --- |
| `index.html` | Semantic interface and accessible controls |
| `assets/terminal.css` | Responsive terminal theme and reduced-motion-aware animation |
| `assets/engine.js` | Shared input validation, financial formulas, signal scoring, and parsing |
| `assets/app.js` | UI state, rendering, SVG charts, and user actions |
| `assets/shortcuts.js` | Hidden keyboard command and cancellable mobile hold gesture |
| `assets/data-client.js` | Bounded market and report refreshes |
| `assets/report.js` | Shared text report formatter |
| `assets/snapshot.js` | Explicitly dated fallback report |
| `scripts/build-static.js` | Standalone static packaging |
| `scripts/export-position.js` | Scheduled saved-preset report |
| `tests/` | Calculation, data failure, and render-logic regressions |

Validation: 31 automated tests pass, including balance-sheet conservation, breakeven roots, partial/zero deployment, probability values, parser rejection, network fallbacks, and view rendering at multiple widths. Render-logic tests use source-backed stubs; actual browser layout, pointer behavior, and live CORS requests have not been visually verified in this environment.
