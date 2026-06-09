BTC Loan Signal · MVRV Analyzer
================================
https://0xtrvkc.github.io/dynamic-btc-analytics-dashboard/

Single-file dashboard for deciding whether current BTC on-chain conditions
make it reasonable to take a collateralized loan (Binance Flexible Loan).

What it shows
-------------
- Current MVRV ratio vs historical mean + Z-score
- Cycle position estimate (where we are in C4)
- Loan math: LTV scenarios, margin call & liquidation prices
- Moving average stack (MA20/50/200)
- Floor/ceiling price models across 4 cycles (C1–C4)
- Pro/con breakdown for borrowing at current levels
- Composite signal score (out of 10)
- Upload-your-own MVRV .txt → Claude reads it and gives a fresh assessment

Stack
-----
Vanilla HTML/CSS/JS. No build step, no deps, no framework.
Claude API hit client-side for the upload analyzer section.
Fonts: Inter + DM Mono (Google Fonts).

Data
----
MVRV history: 2010–2026, ~838k data points
Snapshot baked in at build time (2026-06-05).
Not live — refresh the hardcoded values manually when you want an update.

Usage
-----
Just open the HTML. Or drop it on any static host / gh-pages.
For the AI analyzer to work the page needs to be served (not file://) 
since it calls the Anthropic API.

Notes
-----
Not financial advice. Obviously.
