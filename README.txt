# btcLoanAnalyzer

Single-page tool for sizing Binance Flexible Loan positions against MVRV cycle data.

**Live → [0xtrvkc.github.io/btcLoanAnalyzer](https://0xtrvkc.github.io/btcLoanAnalyzer/)**

---

## What it does

Pulls the latest MVRV summary from this repo's `/exports/` folder on load, then runs the loan math in-browser. No backend, no API keys, no build step.

Given your BTC amount, price, and target LTV it gives you:

- Margin call and liquidation prices (Binance rules: MC at 85% LTV, liq at 90%)
- Interest estimate at ~1% APR
- Upside/downside scenarios vs cycle consensus models
- MVRV signals: ratio, Z-score, MA stack, ROC, cycle position
- Pro/con read and a quant summary box

Everything recalculates live as you adjust inputs.

---

## Data pipeline

A script generates `exports/mvrv_summary_YYYY-MM-DD.txt` every hour and pushes to this repo. The app fetches today's file on load, falls back up to 3 days if it's not there yet.

File format is plain text — key: value pairs the parser knows how to read. If parsing fails, it falls back to a hardcoded snapshot so the UI never breaks.

---

## Run locally

```bash
git clone https://github.com/0xtrvkc/btcLoanAnalyzer
cd btcLoanAnalyzer
open index.html   # or just drag it into a browser
```

No dependencies. No npm install. It's one HTML file.

---

## Loan math

Binance Flexible Loan, BTC collateral → USDT:

```
Collateral value  = BTC × price
Loan              = collateral × LTV
Margin call price = loan / (BTC × 0.85)
Liquidation price = loan / (BTC × 0.90)
```

Keep LTV ≤ 50% if you're not watching the screen. At 40% you need a ~37% BTC drop before any margin call triggers.

---

## Disclaimer

Not financial advice. MVRV models have wide error bars — the backtest section in the data file shows exactly how wide. Read it before borrowing anything.
