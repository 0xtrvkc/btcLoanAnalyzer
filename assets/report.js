/* Plain-text analysis report. Uses the same engine and the same labels as the interface. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.LoanEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.LoanReport=api;})(typeof window!=='undefined'?window:this,function(M){
  'use strict';
  const num=(x,n=2)=>Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:n}):'n/a';
  const usd=(x,n=2)=>Number.isFinite(x)?(x<0?'-':'')+'$'+num(Math.abs(x),n):'n/a';
  const btc=x=>Number.isFinite(x)?num(x,8)+' BTC':'n/a';
  const pct=x=>Number.isFinite(x)?num(x)+'%':'n/a';
  const kv=obj=>Object.entries(obj).map(([k,v])=>k+': '+v);
  function repaySection(title,d,r){
    if(!d.loan)return [title,'No debt.'];
    return [title,...kv({
      'Repayment price':usd(r.price),'Status at this price':r.status,'Debt repaid':usd(r.debt),'Of which interest':usd(r.interest),
      'Paid from unused loan cash':usd(r.cashUsed),'Collateral sold':r.available?btc(r.soldBtc):'n/a — past liquidation',
      'Your BTC left':r.available?btc(r.residualBtc):'n/a','BTC bought with loan (kept)':btc(d.newBtc),
      'Final wallet':r.available?btc(r.walletBtc):'n/a',
      'Change vs. just holding':r.available?`${btc(r.btcChange)} (${pct(r.btcChangePct)}); ${usd(r.edgeVsHold)}`:'n/a',
      'Cash left over':usd(r.cashLeft),'Wallet value + cash':r.available?usd(r.netAssets):'n/a',
      [d.existing?'P/L since borrowing':'P/L vs. collateral today']:r.available?usd(r.pnlStart):'n/a',
      'P/L vs. cost basis':r.available?usd(r.costBasisPnl):'n/a',
      'Beat-holding price':r.beatHoldPrice===null?'n/a (no loan BTC)':usd(r.beatHoldPrice)
    })];
  }
  function build({input,data,weights,quote,source='Bundled snapshot',history=[],generatedAt=new Date().toISOString()}){
    const d=M.calculate(input,data,weights,Date.parse(generatedAt)),f=M.futures(d),s=d.at,dead=s.status==='Liquidation';
    const lines=['BTC LOAN — POSITION ANALYSIS',`Generated: ${generatedAt} (all dates UTC)`,'',
      'DATA',`On-chain report: ${data.date} (${source})${M.ageHours(data.date,Date.parse(generatedAt))>48?' — STALE, older than 48h':''}`,
      `Market quote: ${usd(quote?.price??data.btcPrice)} (${quote?.source||'report snapshot'}, ${quote?.date||data.date})`,
      `Current BTC price used: ${usd(d.price)}`,'',
      'POSITION',...kv({
        'Mode':d.existing?'Existing loan (principal, loan date and purchase price are fixed)':'New loan plan (opened today, sized from LTV)',
        'BTC collateral':btc(d.btc),'Loan principal':usd(d.loan),'Loan date':d.loanDate,'Days since loan':num(d.loanDays,0),
        'Exit date':`${d.exitDate} (in ${num(d.exitDays,0)} days)`,'APR':pct(d.apr*100),
        'BTC price when borrowed':usd(d.borrowPrice),'Initial LTV':pct(d.initialLtv*100),'LTV today (interest included)':pct(d.currentLtv*100),
        'Loan used to buy BTC':`${pct(d.deployPct*100)} at ${usd(d.deployPrice)}`,'BTC bought with loan':btc(d.newBtc),'Unused loan cash':usd(d.cash),
        'Total BTC exposure':btc(d.totalBtc),'Cost basis of your BTC':d.entrySet?usd(d.entry):`not set (using ${usd(d.entry)})`
      }),'','DEBT',...kv({
        'Interest so far':usd(d.accruedInterest),'Debt today':usd(d.debtToday),
        'Interest to exit date':usd(d.exitInterest),'Debt on exit date':usd(d.debtAtExit)
      }),'',
      ...repaySection('REPAY NOW (today’s price, today’s debt)',d,M.repayment(d,d.price,'now')),'',
      ...repaySection('REPAY AT TARGET (target price, debt on exit date)',d,M.repayment(d,d.target,'exit')),'',
      'TARGET SCENARIO (open position on exit date)',...kv({
        'Target price':usd(d.target),'Status':s.status,'Net equity':dead?'n/a — past liquidation':usd(s.equity),
        [d.existing?'P/L since borrowing':'P/L']:dead?'n/a':`${usd(s.pnlStart)} (${pct(s.returnStartPct)} on ${usd(d.startValue)})`,
        ...(d.existing?{'P/L from today':dead?'n/a':`${usd(s.pnlToday)} (${pct(s.returnTodayPct)} on today’s equity ${usd(d.equityNow)})`}:{}),
        'Just holding your BTC':usd(d.existing?s.holdStart:s.holdToday),'Loan trade (vs. holding)':dead?'n/a':usd(s.loanTrade),
        'P/L vs. cost basis':dead?'n/a':usd(s.costBasis),
        'Beat-holding price':d.beatHoldPrice==null?'n/a':usd(d.beatHoldPrice),
        [d.existing?'Break-even since borrowing':'Break-even']:usd(d.breakevenStart),
        ...(d.existing?{'Break-even from today':usd(d.breakevenToday)}:{})
      }),'','RISK',...kv({
        'Margin call / liquidation LTV':`${pct(d.mcLtv*100)} / ${pct(d.liqLtv*100)}`,
        'Margin-call price now':d.loan?usd(d.mcPrice):'n/a','Liquidation price now':d.loan?usd(d.liqPrice):'n/a',
        'Liquidation price on exit date':d.loan?usd(d.liqPriceExit):'n/a',
        'Drop to margin call':pct(d.bufferPct),
        '90-day liquidation touch probability':`${num(d.pLiq90*100,3)}% (barrier ${usd(d.liqPrice90)} = debt in 90 days; ${pct(d.vol*100)} vol, zero drift)`,
        'Reward/risk from today':d.rrRatio==null?'n/a':num(d.rrRatio)+' : 1',
        [`Margin-call response (restore to ${pct(d.restoreLtv*100)})`]:d.loan?`add ${btc(d.topUpBtc)} (${usd(d.topUpUsd)}) or repay ${usd(d.restoreRepayUsd)}`:'n/a'
      }),...M.stress(d).map(x=>`  -${x.drop}%: ${usd(x.price)} → LTV ${pct(x.ltv*100)} (${x.status})`),'',
      'FUTURES COMPARISON (same extra BTC, opened at your purchase price, loan date → exit date)',...kv({
        'Leverage / maintenance margin':`${d.leverage}x / ${pct(d.mm)}`,'Cash margin':usd(f.margin),
        'Futures liquidation price':f.liqPrice===null?'n/a':usd(f.liqPrice)+(f.liquidatedNow?' — already liquidated at today’s price':''),
        'Loan interest vs. futures funding':`${usd(d.exitInterest)} vs. ${usd(f.fundingCost)} over ${num(d.totalDays,0)} days`,
        'Beat-holding price, loan vs. futures':`${d.beatHoldPrice==null?'n/a':usd(d.beatHoldPrice)} vs. ${f.beatHoldPrice==null?'n/a':usd(f.beatHoldPrice)}`,
        'P/L since borrowing at target, loan vs. futures':`${dead?'n/a':usd(f.pnlLoan)} vs. ${f.targetLiquidated?'n/a':usd(f.pnlFut)}`
      }),'','PRICE LADDER (exit date)','Price | LTV | Status | Equity | P/L since borrowing | P/L from today | Loan trade | vs cost basis'];
    const prices=[d.liqPriceExit,d.mcPriceExit,data.floorPrice,d.price*.8,d.price,d.target,d.price*1.2,d.beatHoldPrice,d.breakevenStart,data.ceilPrice,data.c4Ath];
    for(const px of [...new Set(prices.filter(p=>Number.isFinite(p)&&p>0))].sort((a,b)=>a-b)){
      const x=M.scenario(d,px),alive=x.status!=='Liquidation';
      lines.push([usd(px),pct(x.ltv*100),x.status,...[x.equity,x.pnlStart,x.pnlToday,x.loanTrade,x.costBasis].map(v=>alive?usd(v):'n/a')].join(' | '));
    }
    lines.push('','ON-CHAIN SIGNALS',`Heuristic score: ${num(d.score)}/10 (market context, not a borrowing recommendation)`,
      ...Object.entries(d.signals.scores).map(([k,v])=>`  ${k}: ${num(v)}/10, weight ${pct(d.signals.weights[k]*100)}`),
      ...['mvrv','zscore','maStack','roc30','roc90','cyclePos','cycleName','floorPrice','ceilPrice','c4Ath'].map(k=>`  ${k}: ${data[k]??'n/a'}`),
      '','RECENT SNAPSHOTS',...(history.length?history.map(h=>`  ${h.date} | MVRV ${h.mvrv} | Z ${h.zscore} | BTC ${usd(h.btcPrice)}`):['  none']),
      '','MODEL LIMITS','Simple interest; fees, tax, slippage and compounding excluded. Open-position values assume no earlier liquidation.',
      'Repayment uses unused loan cash first, then sells collateral. Liquidation settlement is not modelled.',
      'Futures liquidation excludes funding drift, fees and margin tiers. On-chain scores are uncalibrated heuristics.',
      'Source: https://github.com/0xtrvkc/btcLoanAnalyzer','');
    return lines.join('\n');
  }
  return {build};
});
