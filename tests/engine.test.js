'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../assets/engine.js');
const Report=require('../assets/report.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/snapshot.js'),'utf8'),scope);const data=scope.window.BUNDLED_SNAPSHOT;
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

// The position from the 23 Nov 2026 daily export, reproduced exactly.
const NOV23=Date.parse('2026-11-23T08:48:25Z');
const real={...M.DEFAULTS,mode:'existing',btc:0.03565762,price:61487.5,loanPrincipal:1000,loanDate:'2026-09-27',deployPrice:84900.86,entry:84900.86,deploy:100,apr:5,mc:85,liq:90,vol:65,target:169801.72,exitDate:'2026-11-23'};
const NOW=Date.parse('2026-09-22T12:00:00Z');
const plan={...M.DEFAULTS,mode:'new',price:60000,ltv:40,apr:6,target:90000,exitDate:'2027-09-22'};
const calc=(changes,now=NOW)=>M.calculate({...plan,...changes},data,M.WEIGHTS,now);
const hold=(changes,now=NOV23)=>M.calculate({...real,...changes},data,M.WEIGHTS,now);

test('existing loan reproduces the 23 Nov export: interest, debt, thresholds, break-even',()=>{
 const d=hold({});
 assert.equal(d.loanDays,57);near(d.accruedInterest,7.808219,1e-6);near(d.debtToday,1007.808219,1e-6);
 near(d.liqPrice,31403.86,0.01);near(d.mcPrice,33251.15,0.01);
 near(d.currentLtv*100,45.97,0.01);
 const r=M.repayment(d,d.price,'now');near(r.walletBtc,0.03104561,1e-8);near(r.edgeVsHold,-283.58,0.01);near(r.beatHoldPrice,85563.78,0.01);
});
test('A1: initial LTV uses the price when you borrowed, not today’s price',()=>{
 const d=hold({});near(d.initialLtv*100,33.03,0.01);assert.ok(d.currentLtv>d.initialLtv);
 near(hold({borrowPrice:90000}).initialLtv,1000/(0.03565762*90000));
});
test('A2: P/L since borrowing uses the borrow-date value; P/L from today uses today’s equity',()=>{
 const d=hold({});
 near(d.startValue,0.03565762*84900.86,1e-6);
 near(d.at.pnlStart,4019.55,0.01);                       // was mislabelled as $4,854.42 in the old export
 near(d.at.pnlStart,d.at.costBasis,1e-9);                // entry = borrow price here
 near(M.scenario(d,d.price).pnlToday,0,1e-9);            // no time, no price move → nothing changes from today
 near(d.at.pnlToday,d.at.equity-d.equityNow,1e-9);
});
test('A3: target scenarios include interest up to the exit date; new plans are not free',()=>{
 const d=hold({exitDate:'2027-11-23'});
 assert.equal(d.totalDays,57+365);near(d.exitInterest,1000*0.05*(57+365)/365);
 near(d.at.equity,d.totalBtc*d.target-d.debtAtExit);assert.ok(d.liqPriceExit>d.liqPrice);
 const p=calc({});assert.equal(p.loanDays,0);assert.ok(p.exitInterest>0);near(p.exitInterest,p.loan*0.06);
 near(M.scenario(p,p.price).loanTrade,-p.exitInterest);
});
test('A4: an existing loan needs a purchase price, and loan BTC never moves with today’s price',()=>{
 const v=M.validate({...real,deployPrice:''},NOV23);assert.equal(v.valid,false);assert.ok(v.errors.deployPrice);
 near(hold({price:50000}).newBtc,hold({price:90000}).newBtc);near(hold({}).newBtc,1000/84900.86);
 // new plans may still default to buying at the current price
 near(calc({deployPrice:''}).newBtc,calc({}).loan/60000);
 // borrow price falls back to the purchase price; with nothing bought it is required
 near(hold({borrowPrice:''}).borrowPrice,84900.86);
 assert.ok(M.validate({...real,deploy:0,borrowPrice:''},NOV23).errors.borrowPrice);
});
test('A7: repayment spends unused loan cash first, then sells collateral',()=>{
 const d=hold({deploy:50});near(d.cash,500);
 const r=M.repayment(d,61487.5,'now');near(r.cashUsed,500);near(r.soldBtc,(d.debtToday-500)/61487.5);
 near(d.beatHoldPrice,(d.debtAtExit-500)/d.newBtc);near(r.beatHoldPrice,(d.debtToday-500)/d.newBtc);
 assert.ok(r.beatHoldPrice<2*84900.86/1.9);           // no longer ~2× the purchase price
 const cashOnly=hold({deploy:0,borrowPrice:84900.86});const c=M.repayment(cashOnly,61487.5,'now');
 near(c.cashUsed,1000);near(c.soldBtc,c.debtLeft/61487.5);assert.equal(c.beatHoldPrice,null);
});
test('A8: reward/risk is measured from today’s price',()=>{
 const d=hold({});near(d.rrRatio,(data.ceilPrice-61487.5)/(61487.5-d.liqPrice));
 assert.equal(hold({price:200000}).rrRatio,null);
});
test('A10: existing loans ignore the LTV field and warn on the real LTV instead',()=>{
 assert.equal(M.validate({...real,ltv:'abc'},NOV23).valid,true);
 const w=M.validate({...real,price:32500},NOV23);assert.equal(w.valid,true);assert.match(w.warnings.join(' '),/margin-call zone/);
 assert.match(M.validate({...real,price:30000},NOV23).warnings.join(' '),/liquidation/);
 assert.ok(M.validate({...plan,ltv:90},NOW).errors.ltv);
});
test('A11: “today” is the UTC calendar date everywhere',()=>{
 const bangkokEarlyMorning=Date.parse('2026-11-24T03:00:00+07:00');
 assert.equal(M.today(bangkokEarlyMorning),'2026-11-23');
 assert.equal(hold({},bangkokEarlyMorning).loanDays,57);
 assert.ok(M.validate({...real,loanDate:'2026-11-24'},bangkokEarlyMorning).errors.loanDate);
});
test('A13: the two break-evens zero their own equations',()=>{
 for(const d of [hold({exitDate:'2027-05-01'}),hold({deploy:40,exitDate:'2027-05-01'}),calc({deploy:70})]){
  near(M.scenario(d,d.beatHoldPrice).loanTrade,0,1e-6);
  near(M.scenario(d,d.breakevenStart).pnlStart,0,1e-6);
  near(M.scenario(d,d.breakevenToday).pnlToday,0,1e-6);
 }
});
test('balance sheet: repaying at the exit date equals open equity, and loan trade equals edge vs. holding',()=>{
 for(const [btc,apr,deploy,price,px] of [[0.1,3,100,60000,70000],[2,12,35,90000,150000],[0.75,0,0,50000,40000],[5,8,80,30000,100000]]){
  const d=hold({btc,apr,deploy,deployPrice:price*0.9,borrowPrice:price,price,exitDate:'2028-01-01'});
  const r=M.repayment(d,px,'exit'),s=M.scenario(d,px);
  if(!r.available)continue;
  near(r.netAssets,s.equity,1e-6);near(r.edgeVsHold,s.loanTrade,1e-6);near(r.walletBtc,d.totalBtc-r.soldBtc,1e-12);
 }
});
test('statuses are inclusive at the thresholds and use the debt for the right date',()=>{
 const d=hold({exitDate:'2027-11-23'});
 assert.equal(M.scenario(d,d.liqPriceExit).status,'Liquidation');assert.equal(M.scenario(d,d.mcPriceExit).status,'Margin call');
 assert.equal(M.repayment(d,d.liqPrice,'now').status,'Liquidation');assert.equal(M.repayment(d,d.liqPrice,'now').available,false);
 assert.equal(calc({ltv:0}).at.status,'No debt');
});
test('margin-call response restores the chosen LTV',()=>{
 const d=hold({restoreLtv:50});const atCall=d.btc*d.mcPrice;
 near(d.debtToday/(atCall+d.topUpUsd),0.5);near((d.debtToday-d.restoreRepayUsd)/atCall,0.5);near(d.topUpBtc*d.mcPrice,d.topUpUsd);
 assert.ok(M.validate({...real,restoreLtv:90},NOV23).errors.restoreLtv);
 assert.deepEqual(M.stress(d,[50]).map(s=>s.status),['Liquidation']);
});
test('90-day probability uses the debt owed in 90 days',()=>{
 const d=hold({});near(d.liqPrice90,1000*(1+0.05*(57+90)/365)/(d.btc*0.9));
 near(d.pLiq90,M.barrierProbability(d.price,d.liqPrice90,0.65,90));
});
test('futures: same window as the loan, liquidation solves equity = maintenance margin',()=>{
 const d=hold({exitDate:'2027-11-23',leverage:5,mm:0.5,funding:10}),f=M.futures(d);
 near(f.fundingCost,1000*0.10*d.totalDays/365);
 const q=f.notionalBtc,equity=f.margin+q*(f.liqPrice-d.deployPrice);near(equity,0.005*q*f.liqPrice,1e-9);
 near(M.futures(hold({exitDate:'2027-11-23',funding:-10})).beatHoldPrice,d.deployPrice-f.fundingCost/q);
 const z=M.futures(hold({deploy:0,borrowPrice:84900.86}));assert.equal(z.liqPrice,null);assert.equal(z.margin,0);
});
test('validation rejects inconsistent terms and dates',()=>{
 assert.ok(M.validate({...plan,mc:95,liq:90},NOW).errors.mc);
 assert.ok(M.validate({...plan,leverage:50,mm:5},NOW).errors.mm);
 assert.ok(M.validate({...plan,exitDate:'2020-01-01'},NOW).errors.exitDate);
 assert.equal(M.validate({...plan,exitDate:''},NOW).value.exitDate,'2027-09-22');
 assert.ok(M.validate({...real,loanPrincipal:''},NOV23).errors.loanPrincipal);
 assert.throws(()=>calc({btc:0}));
});
test('report labels match the engine and never print NaN',()=>{
 const text=Report.build({input:{...real,exitDate:'2027-11-23'},data,weights:M.WEIGHTS,quote:{price:61487.5,source:'test',date:'2026-11-23'},generatedAt:'2026-11-23T08:48:25.000Z'});
 assert.match(text,/Initial LTV: 33\.03%/);assert.match(text,/REPAY NOW/);assert.match(text,/REPAY AT TARGET/);
 assert.match(text,/P\/L since borrowing/);assert.doesNotMatch(text,/NaN|undefined/);
 const p=Report.build({input:plan,data,weights:M.WEIGHTS,generatedAt:'2026-09-22T12:00:00.000Z'});assert.doesNotMatch(p,/NaN|undefined/);
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
});
test('report without a BTC Price line still parses (upstream omits it when its price file lags), but a non-positive price is rejected',()=>{
 const base='Date: 2026-11-12\nMVRV: 1.37\nZ-score: -0.19\nHistorical mean MVRV: 1.849\nCycle position: 65.2%\nCeiling consensus midpoint: $111,822\nFloor consensus midpoint: $35,122\nROC 30d: -11.2%\nMA stack: Mixed\n';
 const d=M.parseSummary(base);assert.equal(d.btcPrice,null);near(d.cyclePos,65.2);
 assert.throws(()=>M.parseSummary(base+'BTC Price: $0\n'));
 near(M.parseSummary(base+'BTC Price: $77,000\n').btcPrice,77000);
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
test('parser reads the upstream format introduced on 2026-11-23',()=>{
 const d=M.parseSummary(fs.readFileSync(require.resolve('./fixtures/mvrv_summary_2026-11-23.txt'),'utf8'));
 assert.equal(d.date,'2026-11-23');near(d.mvrv,1.143);near(d.zscore,-1.535);assert.equal(d.zscoreKind,'rolling365');
 near(d.btcPrice,61003);near(d.histMeanMvrv,1.847);near(d.cyclePos,65.9);near(d.ceilPrice,180542);near(d.floorPrice,52374);
 near(d.roc30,-23.5);assert.match(d.maStack,/Mixed/);assert.equal(d.c4Ath,124728);assert.equal(d.nextHalving,'2028-03-26');
 assert.equal(d.ceilLow,77999);assert.equal(d.ceilHigh,308116);near(d.worstCycleDrawdown,-90.6);
});
