(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.LoanEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.LoanReport=api;})(typeof window!=='undefined'?window:this,function(M){
  'use strict';
  const num=(x,n=2)=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:n}):'n/a';
  const usd=x=>Number.isFinite(x)?'$'+num(x):'n/a';
  function build({input,data,weights,quote,source='Bundled snapshot',history=[],generatedAt=new Date().toISOString()}){
    const d=M.calculate(input,data,weights),f=M.futures(d),r=M.collateralRepayment(d);
    const lines=['BTC LOAN TERMINAL — POSITION ANALYSIS',`Generated: ${generatedAt}`,'',
      'DATA PROVENANCE',`On-chain report: ${data.date} (${source})`,
      `Quote: ${quote?.source||'Report snapshot'}; date ${quote?.date||data.date}; fetched ${quote?.fetchedAt||'not live-fetched'}`,
      `Market quote: ${usd(quote?.price||data.btcPrice)}; reference price used for loan sizing: ${usd(d.price)}`,
      'A new loan is sized at the reference price. This is not a fixed-debt position tracker.',
      M.ageHours(data.date,Date.parse(generatedAt))>48?'ON-CHAIN DATA IS STALE (older than 48h).':'On-chain date is within 48 hours of report generation.',
      '', 'POSITION & FINANCING',...Object.entries({
        'BTC collateral':num(d.btc,8),'Reference BTC price':usd(d.price),'Collateral value':usd(d.collateral),'Initial LTV':num(d.ltvPct)+'%',
        'Loan principal':usd(d.loan),'APR assumption':num(d.apr*100)+'%','Horizon':num(d.months)+' months',
        'Simple interest over horizon':usd(d.interestCost),'Debt at horizon':usd(d.debtOwed),'Deployment':num(d.deployPct*100)+'%',
        'Deployment BTC price':usd(d.deployPrice),'Loan cash held':usd(d.undeployedUsd),'Additional BTC':num(d.newBtc,8),'Total BTC exposure':num(d.totalBtc,8),
        'Original collateral cost basis':d.entry?usd(d.entry):'unset'
      }).map(([k,v])=>k+': '+v),'','TARGET SCENARIO',`Target BTC price: ${usd(d.targetPrice)}`,`Target status: ${d.targetStatus}`,
      `Net equity: ${d.targetStatus==='Liquidation'?'n/a — liquidation threshold crossed':usd(d.equity)}`,
      `Net P/L after interest: ${d.targetStatus==='Liquidation'?'n/a — open-position model no longer applies':usd(d.netProfit)}`,
      `Return on pledged collateral: ${d.targetStatus==='Liquidation'?'n/a':num(d.levReturnPct)+'%'}`,
      `Spot-only P/L: ${usd(d.unlevProfit)}`,`Leverage edge: ${d.targetStatus==='Liquidation'?'n/a':usd(d.leverageEdge)}`,
      `Breakeven including interest: ${usd(d.breakevenPrice)}`,`P/L vs actual cost basis: ${d.targetStatus==='Liquidation'?'n/a':usd(d.costBasisProfit)}`,
      '', 'REPAY WITH COLLATERAL (AT TARGET)',
      `Original BTC benchmark (loan-funded BTC excluded): ${num(d.btc,8)} BTC`,
      `BTC recovery price: ${d.debtOwed===0?'already matched; no debt':r.recoveryPrice===null?'no finite price; no loan-funded BTC':usd(r.recoveryPrice)}`,
      `Recovery threshold status: ${r.recoveryStatus}`,
      `Repayment target status: ${r.status}`,
      `BTC sold for principal + interest: ${r.available?num(r.soldBtc,8):'n/a'}`,
      `Original collateral remaining: ${r.available?num(r.residualBtc,8):'n/a'} BTC`,
      `Loan-funded BTC retained separately: ${num(d.newBtc,8)} BTC`,
      `Final wallet after repayment: ${r.available?num(r.walletBtc,8):'n/a'} BTC`,
      `BTC change vs original amount: ${r.available?num(r.btcChange,8)+' BTC ('+num(r.btcChangePct)+'%)':'n/a'}`,
      `Unused cash (not applied to repayment): ${usd(d.undeployedUsd)}`,
      `Debt-free net assets, BTC + cash: ${r.available?usd(r.netAssets):'n/a'}`,
      `Net P/L vs borrowing-date collateral value: ${r.available?usd(r.pnl):'n/a'}`,
      `P/L % on original collateral value: ${r.available?num(r.pnlPct)+'%':'n/a'}`,
      `Dollar edge vs holding original BTC: ${r.available?usd(r.edgeVsHold):'n/a'}`,
      `Remaining BTC dollar-value recovery price (cash excluded): ${usd(r.valueRecoveryPrice)}`,
      'BTC recovery includes loan-funded BTC in the final wallet, but not in the starting benchmark.',
      'With positive debt, the original collateral pot alone cannot recover its original BTC quantity at any finite sale price.',
      'Full debt is paid from collateral; unused cash stays separate. Requires lender support and no earlier liquidation; fees excluded.',
      '', 'LIQUIDATION & RISK',`Margin call LTV: ${num(d.mcLtv*100)}%; liquidation LTV: ${num(d.liqLtv*100)}%`,
      `Current margin call price (principal only): ${d.loan?usd(d.mcPrice):'n/a — no debt'}`,
      `Current liquidation price (principal only): ${d.loan?usd(d.liqPrice):'n/a — no debt'}`,
      `Horizon margin call price (interest included): ${d.loan?usd(d.mcPriceH):'n/a — no debt'}`,
      `Horizon liquidation price (interest included): ${d.loan?usd(d.liqPriceH):'n/a — no debt'}`,
      `90d fixed-barrier touch probability: ${num(d.pLiq90*100,4)}%`,
      'Probability assumes constant annual volatility, zero log drift, no jumps, and no barrier changes due to interest.',
      `Annualized volatility assumption: ${num(d.vol*100)}%`,
      `Reward/risk from cost basis: ${num(d.rrRatio)}`,
      `Illustrative half-Kelly output: ${num(d.kellyLtv*100)}% (uncalibrated heuristic; not an optimal LTV)`,
      '', 'ON-CHAIN SIGNALS',`Heuristic score: ${num(d.score)}/10 (not a lending recommendation)`,
      ...Object.entries(d.signals.scores).map(([k,v])=>`${k}: score ${num(v)}/10; weight ${num(d.signals.weights[k]*100)}%`),
      ...Object.entries(data).map(([k,v])=>`${k}: ${v??'unavailable'}`),
      '', 'MATCHED-EXPOSURE FUTURES COMPARISON',
      `Additional BTC exposure on both sides: ${num(f.notionalBtc,8)}`,
      `Futures entry notional: ${usd(f.notionalUsd)}; isolated leverage: ${d.leverage}x`,
      `Additional cash margin: ${usd(f.margin)}; spot plus margin capital: ${usd(f.capital)}`,
      `Futures liquidation price (approximate): ${usd(f.liqPrice)}`,
      `Loan interest: ${usd(d.interestCost)}; futures funding assumption: ${usd(f.fundingCost)}`,
      `Loan net P/L at target: ${d.targetStatus==='Liquidation'?'n/a — liquidation threshold crossed':usd(f.pnlLoanAdj)}`,
      `Spot + futures net P/L at target: ${f.targetLiquidated?'n/a — liquidation threshold crossed':usd(f.pnlFutAdj)}`,
      `Futures portfolio return on spot + margin: ${f.targetLiquidated?'n/a':num(f.returnFutPct)+'%'}`,
      `Futures leg return on margin: ${f.targetLiquidated?'n/a':num(f.legReturnPct)+'%'}`,
      `Futures portfolio breakeven: ${usd(f.breakevenAdj)}`,
      '', 'PRICE LADDER (interest included)',
      'Exit USD | LTV | Status | Net equity | Net P/L | Borrowed P/L | Cost basis P/L'];
    const prices=[d.liqPriceH,d.mcPriceH,data.floorPrice,d.price*.8,d.price,d.targetPrice,d.price*1.2,d.breakevenPrice,data.ceilPrice,data.c4Ath];
    for(const price of [...new Set(prices.filter(p=>Number.isFinite(p)&&p>0))].sort((a,b)=>a-b)){
      const s=M.scenario(d,price),alive=s.status!=='Liquidation';
      lines.push([usd(price),num(s.ltv*100)+'%',s.status,alive?usd(s.equity):'n/a',alive?usd(s.pnl):'n/a',alive?usd(s.borrowed):'n/a',alive?usd(s.cost):'n/a'].join(' | '));
    }
    lines.push('','RECENT ON-CHAIN SNAPSHOTS',...history.map(h=>`${h.date} | MVRV ${h.mvrv} | Z ${h.zscore} | Report BTC ${usd(h.btcPrice)}`),
      '','MODEL LIMITS','Open-position scenario values are conditional on no earlier liquidation. A later rebound does not restore a liquidated position.',
      'Interest is simple, APR and funding are flat assumptions; fees, taxes, slippage, and compounding are excluded.',
      'On-chain model targets and heuristic scores are uncertain. Original and borrowed BTC keep separate cost bases.',
      'Futures margin is extra cash. Futures liquidation excludes funding deductions and exchange-specific tiers.',
      'Normal CDF: https://www.itl.nist.gov/div898/handbook/eda/section3/eda3661.htm',
      'Reflection principle: https://almostsuremath.com/2023/04/18/the-maximum-of-brownian-motion-and-the-reflection-principle/',
      'Source: https://github.com/0xtrvkc/btcLoanAnalyzer','');
    return lines.join('\n');
  }
  return {build};
});
