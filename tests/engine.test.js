'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../assets/engine.js');
const Report=require('../assets/report.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/snapshot.js'),'utf8'),scope);const data=scope.window.BUNDLED_SNAPSHOT;
const base={...M.DEFAULTS,price:60000,target:90000,apr:6};
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const calc=changes=>M.calculate({...base,...changes},data,M.WEIGHTS);

test('loan balance, interest, and net equity reconcile independently',()=>{
 const d=calc();near(d.loan,24000);near(d.newBtc,.4);near(d.interestCost,1440);near(d.debtOwed,25440);
 near(d.totalValue,126000);near(d.equity,100560);near(d.netProfit,40560);near(d.leverageEdge,10560);
 near(d.mcPrice,24000/.85);near(d.liqPrice,24000/.9);near(d.liqPriceH,25440/.9);
});
test('partial deployment matches futures BTC and notional, with extra margin capital',()=>{
 const d=calc({deploy:25,deployPrice:50000}),f=M.futures(d);
 near(f.notionalUsd,6000);near(f.notionalBtc,.12);near(f.margin,1200);near(f.fundingCost,600);near(f.capital,61200);
 near(f.pnlFutAdj,30000+4800-600);near(f.legReturnPct,4200/1200*100);near(f.returnFutPct,34200/61200*100);
});
test('zero deployment does not create a futures position or free BTC',()=>{
 const d=calc({deploy:0}),f=M.futures(d);near(d.newBtc,0);near(d.undeployedUsd,24000);near(d.netProfit,30000-1440);
 near(f.margin,0);near(f.notionalUsd,0);near(f.fundingCost,0);assert.equal(f.liqPrice,null);assert.equal(f.legReturnPct,null);
 near(f.breakevenSimple,60000);near(f.pnlFutAdj,30000);
});
test('zero debt means no carry or loan liquidation',()=>{
 const d=calc({ltv:0});near(d.loan,0);near(d.pLiq90,0);near(d.liqPrice,0);near(d.netProfit,d.unlevProfit);assert.equal(M.scenario(d,1).status,'No debt');
});
test('flat price loses exactly financing costs; zero APR preserves equity',()=>{
 const d=calc({target:60000});near(d.netProfit,-1440);
 near(calc({target:60000,apr:0}).netProfit,0);
 near(calc({target:60000,months:0}).netProfit,0);
});
test('loan and futures breakeven prices actually zero the matching P/L equations',()=>{
 const d=calc({deploy:40,deployPrice:75000});const f=M.futures(d);
 near(M.scenario(d,d.breakevenPrice).pnl,0);
 near(d.btc*(f.breakevenAdj-d.price)+d.newBtc*(f.breakevenAdj-d.deployPrice)-f.fundingCost,0);
 near(d.newBtc*(d.borrowedBreakeven-d.deployPrice)-d.interestCost,0);
});
test('different collateral and deployed BTC cost bases are preserved',()=>{
 const d=calc({entry:40000,deployPrice:75000,deploy:50,target:90000});
 near(d.costBasisProfit,50000+.16*15000-1440);
 near(d.borrowedProfit,.16*15000-1440);
});
test('futures liquidation solves equity = maintenance margin',()=>{
 const d=calc(),f=M.futures(d),P=f.liqPrice;
 near(f.margin+d.newBtc*(P-d.deployPrice),f.mmRate*d.newBtc*P);
 assert.equal(M.futures(calc({target:30000})).targetLiquidated,true);
 assert.equal(M.futures(calc({leverage:1})).liqPrice,0);
});
test('negative funding is a receipt and reduces the cost-adjusted breakeven',()=>{
 const f=M.futures(calc({funding:-10}));near(f.fundingCost,-2400);assert.ok(f.breakevenAdj<f.breakevenSimple);
});
test('target thresholds are inclusive and higher interest shifts both barriers',()=>{
 const d=calc();assert.equal(M.scenario(d,d.liqPriceH).status,'Liquidation');assert.equal(M.scenario(d,d.mcPriceH).status,'Margin call');
 assert.equal(M.scenario(d,d.mcPriceH+1).status,'Active');assert.ok(d.liqPriceH>d.liqPrice);
});
test('invalid inputs cannot silently fall back to wrongly scaled thresholds',()=>{
 for(const x of [{mc:''},{liq:Infinity},{btc:0},{price:NaN},{ltv:85},{mc:95,liq:90},{apr:-1},{deploy:101},{deployPrice:-1},{months:''},{mm:20,leverage:5}]){
   const v=M.validate({...base,...x});assert.equal(v.valid,false,JSON.stringify(x));assert.throws(()=>calc(x));
 }
 assert.equal(M.validate({...base,mc:85,liq:90,entry:'',deployPrice:''}).valid,true);
});
test('normal CDF uses the correct sqrt(2) scaling and tails',()=>{
 near(M.normalCDF(0),.5);near(M.normalCDF(1),.841344746,1e-7);near(M.normalCDF(-2),.022750132,1e-7);
 near(M.normalCDF(-1)+M.normalCDF(1),1);assert.equal(M.normalCDF(Infinity),1);assert.equal(M.normalCDF(-Infinity),0);
 assert.ok(M.normalCDF(-7)>0);
});
test('barrier touch model uses reflection principle and handles edge cases',()=>{
 near(M.barrierProbability(100,100/Math.E,1,365),.317310508,2e-7);
 assert.equal(M.barrierProbability(100,100,0,0),1);assert.equal(M.barrierProbability(100,50,0,90),0);
 assert.equal(M.barrierProbability(100,0,1,90),0);assert.equal(M.barrierProbability(100,50,1,0),0);
 assert.ok(Number.isNaN(M.barrierProbability(0,50,1,90)));
 assert.ok(M.barrierProbability(100,50,1,180)>M.barrierProbability(100,50,1,90));
});
test('zero weights exclude a signal; all-zero weights use the documented default',()=>{
 const w=M.normalizeWeights({...M.WEIGHTS,mvrv:0});assert.equal(w.weights.mvrv,0);near(Object.values(w.weights).reduce((a,b)=>a+b),1);
 const zero=Object.fromEntries(Object.keys(M.WEIGHTS).map(k=>[k,0]));const all=M.normalizeWeights(zero);assert.equal(all.usedDefaults,true);near(all.weights.mvrv,.3);
 assert.equal(M.kellyIllustration(8,-.2,.5,.9),0);assert.ok(Number.isFinite(M.kellyIllustration(8,0,.5,.9)));
});
test('report parser rejects incomplete or corrupt reports without carrying old fields',()=>{
 const summary='Date: 2026-09-06\nMVRV: 1.5\nZ-score: -0.1\nBTC Price: $80,000\nHistorical mean MVRV: 1.8\nCycle position: 60%\nCeiling consensus midpoint: $120,000\nFloor consensus midpoint: $35,000\nROC 30d: 10%\nMA stack: Bullish\n';
 const d=M.parseSummary(summary);near(d.btcPrice,80000);assert.equal(d.c4Ath,undefined);
 assert.throws(()=>M.parseSummary(summary.replace('MVRV: 1.5','MVRV: NaN')));
 assert.throws(()=>M.parseSummary(summary.replace('Historical mean MVRV: 1.8','Historical mean MVRV: 0')));
 assert.throws(()=>M.parseSummary('Date: 2026-09-06\nMVRV: 1.5'));
 assert.throws(()=>M.parseSummary(summary.replace('2026-09-06','2026-02-30')));
 const multiple=M.parseSummary(summary+'C7 halving: 2036-01-10 [upcoming]\nC5 halving: 2028-03-26 [upcoming]\nC6 halving: 2032-02-03 [upcoming]');
 assert.equal(multiple.nextHalving,'2028-03-26');
});
test('daily quotes validate dates and find the nearest earlier UTC date',()=>{
 const p=M.priceSeries({'2026-09-01':70000,'2026-09-02':'71000','bad':10,'2026-09-03':0,'2026-09-04':null,'2026-02-30':80000});
 assert.deepEqual(Object.keys(p),['2026-09-01','2026-09-02']);
 assert.deepEqual(M.nearestPrice(p,'2026-09-04'),{date:'2026-09-02',price:71000,exact:false});
 assert.equal(M.nearestPrice(p,'2026-08-30'),null);assert.equal(M.nearestPrice(p,'2026-09-10'),null);
 assert.equal(M.dateValid('2026-02-29'),false);assert.equal(M.dateValid('2024-02-29'),true);assert.equal(M.ageHours('broken'),Infinity);
});
test('report suppresses liquidated target profits and distinguishes market/reference prices',()=>{
 const report=Report.build({input:{...base,target:1000},data,weights:M.WEIGHTS,quote:{price:80000,source:'Test',date:'2026-09-06'},generatedAt:'2026-09-07T00:00:00Z'});
 assert.match(report,/Net P\/L after interest: n\/a/);assert.match(report,/reference price used for loan sizing: \$60,000/);
 assert.match(report,/Market quote: \$80,000/);assert.doesNotMatch(report,/Borrow-Ready|NaN|Infinity/);
});
test('balance-sheet conservation holds over varied amounts, rates, and deployments',()=>{
 for(const btc of [.0001,.035,1,40])for(const deploy of [0,25,100])for(const apr of [0,6,30]){
  const d=calc({btc,deploy,apr});near(d.equity-d.collateral,d.netProfit,1e-5);near(d.deployedUsd+d.undeployedUsd,d.loan,1e-5);
  near(M.scenario(d,d.breakevenPrice).pnl,0,1e-5);const f=M.futures(d);near(f.pnlFutAdj-d.netProfit,d.interestCost-f.fundingCost,1e-5);
 }
});

test('two separate pots reconcile BTC, unused cash, and debt without inventing equity',()=>{
 for(const deploy of [0,25,100]){const d=calc({deploy});const p=M.twoPots(d);near(p.netAssets,M.scenario(d,d.price).equity);near(p.walletBtc,p.residualBtc+d.newBtc);near(p.netAssets,d.collateral-d.interestCost);assert.equal(p.available,true);}
 assert.equal(M.twoPots(calc({apr:100,months:120})).available,false);
});


test('collateral repayment restores original BTC at debt divided by additional BTC',()=>{
 const d=calc(),r=M.collateralRepayment(d);
 near(r.recoveryPrice,63600);near(r.soldBtc,25440/90000);near(r.residualBtc,1-25440/90000);
 near(r.walletBtc,1.4-25440/90000);near(r.pnl,40560);near(r.pnlPct,67.6);near(r.edgeVsHold,10560);
 const at=M.collateralRepayment(d,r.recoveryPrice);near(at.walletBtc,1);near(at.btcChange,0);
 near(at.pnl,3600); // Same BTC quantity does not mean zero dollar profit.
 near(M.collateralRepayment(d,r.valueRecoveryPrice).walletBtc*r.valueRecoveryPrice,d.collateral);
 near(M.collateralRepayment(d,d.breakevenPrice).pnl,0);
});
test('partial deployment keeps cash separate and reconciles with scenario net equity',()=>{
 const d=calc({deploy:25,deployPrice:50000}),r=M.collateralRepayment(d);
 near(r.recoveryPrice,212000);near(r.soldBtc,25440/90000);
 near(r.netAssets,M.scenario(d,90000).equity);near(r.pnl,M.scenario(d,90000).pnl);
 near(M.collateralRepayment(d,r.recoveryPrice).walletBtc,d.btc);
});
test('BTC recovery handles zero debt, no purchases, interest and liquidation',()=>{
 const noPurchases=M.collateralRepayment(calc({deploy:0}));assert.equal(noPurchases.recoveryPrice,null);assert.equal(noPurchases.recoveryStatus,'No finite price');assert.ok(noPurchases.btcChange<0);
 const noDebt=M.collateralRepayment(calc({ltv:0}));assert.equal(noDebt.recoveryStatus,'No debt');near(noDebt.walletBtc,1);near(noDebt.btcChange,0);
 near(M.collateralRepayment(calc({apr:0})).recoveryPrice,60000);
 near(M.collateralRepayment(calc({months:24})).recoveryPrice,67200);
 const d=calc();assert.equal(M.collateralRepayment(d,d.liqPriceH).available,false);
 const lowPurchase=M.collateralRepayment(calc({deployPrice:1000}));assert.equal(lowPurchase.recoveryStatus,'Liquidation');assert.equal(lowPurchase.recoveryAvailable,false);
 for(const price of [0,-1,NaN,Infinity])assert.throws(()=>M.collateralRepayment(d,price),RangeError);
});
test('collateral repayment reconciles across fractional sizes and horizons',()=>{
 for(const btc of [.00000001,.035,1,20])for(const deploy of [0,25,100])for(const months of [0,12,36]){
  const d=calc({btc,deploy,months}),r=M.collateralRepayment(d);
  near(r.netAssets,M.scenario(d,d.targetPrice).equity,1e-5);
  if(r.recoveryPrice!==null)near(M.collateralRepayment(d,r.recoveryPrice).walletBtc,btc);
 }
 const report=Report.build({input:base,data});assert.match(report,/REPAY WITH COLLATERAL/);assert.match(report,/BTC recovery price: \$63,600/);
});
