/* Shared, dependency-free calculation engine. Used by the UI, the report and the scheduled export.
 *
 * Two loan modes:
 *  - new:      plan a loan opened today. Principal = collateral × current price × LTV.
 *  - existing: a loan you already hold. Principal, loan date and purchase price are fixed inputs and
 *              never move with the market.
 *
 * Two clocks:
 *  - today:     debt = principal + interest accrued from the loan date to today (repay-now, current risk).
 *  - exit date: debt = principal + interest accrued to the planned exit date (target scenarios, ladder).
 *
 * Two P/L baselines (existing loans; they coincide for a new loan):
 *  - since borrowing: against the collateral's value at the BTC price when you borrowed.
 *  - from today:      against today's net equity, so only future price moves and future interest count.
 *
 * All dates are UTC calendar days.
 */
(function (root, factory) {
  const preset = typeof module === 'object' && module.exports ? require('./user-config.js') : root.USER_POSITION_PRESET;
  const api = factory(preset);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoanEngine = api;
})(typeof window !== 'undefined' ? window : this, function (userPreset) {
  'use strict';
  const DAY = 864e5;
  const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
  const addDays = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

  const DEFAULTS = Object.freeze({
    mode: 'new', btc: 1, price: 80000, ltv: 40, loanPrincipal: '', loanDate: '', borrowPrice: '',
    apr: 5, mc: 85, liq: 90, restoreLtv: 50, vol: 65, entry: '', deployPrice: '', deploy: 100,
    target: 120000, exitDate: '', leverage: 5, mm: 0.5, funding: 10
  });
  const SAVED_POSITION = Object.freeze({ ...(userPreset || {}) });
  const WEIGHTS = Object.freeze({ mvrv: 30, zscore: 25, ma: 20, roc: 10, cycle: 15 });

  // [min, max, label, optional]
  const FIELDS = {
    btc: [0.00000001, 1e6, 'BTC collateral'],
    price: [1, 1e9, 'Current BTC price'],
    ltv: [0, 99, 'Initial LTV'],
    loanPrincipal: [0.01, 1e10, 'Loan principal'],
    borrowPrice: [1, 1e9, 'BTC price when you borrowed', true],
    apr: [0, 100, 'Loan APR'],
    mc: [1, 99.9, 'Margin call LTV'],
    liq: [1, 99.99, 'Liquidation LTV'],
    restoreLtv: [1, 99, 'Restore-to LTV'],
    vol: [0, 300, 'Annualized volatility'],
    entry: [1, 1e9, 'Original BTC cost basis', true],
    deployPrice: [1, 1e9, 'Purchase price', true],
    deploy: [0, 100, 'Loan used to buy BTC'],
    target: [1, 1e9, 'Target price'],
    leverage: [1, 50, 'Futures leverage'],
    mm: [0, 20, 'Maintenance margin'],
    funding: [-100, 200, 'Funding APR']
  };
  const MODE_ONLY = { ltv: 'new', loanPrincipal: 'existing', borrowPrice: 'existing' };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const blank = v => v === '' || v == null;

  function validate(input, now = Date.now()) {
    const value = {}, errors = {}, warnings = [];
    const mode = input.mode === 'existing' ? 'existing' : 'new';
    value.mode = mode;
    const asOf = today(now);
    for (const [key, [min, max, label, optional]] of Object.entries(FIELDS)) {
      if (MODE_ONLY[key] && MODE_ONLY[key] !== mode) continue;
      const raw = input[key];
      if (blank(raw) && optional) { value[key] = null; continue; }
      const n = blank(raw) ? NaN : Number(raw);
      if (!Number.isFinite(n) || n < min || n > max)
        errors[key] = blank(raw) ? `${label} is required.` : `${label} must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.`;
      else value[key] = n;
    }
    // Loan date: today for a new loan, a required past-or-today date for an existing loan.
    if (mode === 'new') value.loanDate = asOf;
    else if (!dateValid(input.loanDate)) errors.loanDate = 'Loan date is required.';
    else if (input.loanDate > asOf) errors.loanDate = 'Loan date cannot be after today (UTC).';
    else value.loanDate = input.loanDate;
    // Exit date: blank means one year from today.
    const exit = blank(input.exitDate) ? addDays(asOf, 365) : input.exitDate;
    if (!dateValid(exit)) errors.exitDate = 'Exit date must be a valid date.';
    else if (exit < asOf) errors.exitDate = 'Exit date cannot be before today.';
    else if (exit > addDays(asOf, 365 * 30)) errors.exitDate = 'Exit date must be within 30 years.';
    else value.exitDate = exit;
    if (mode === 'existing' && value.deploy > 0 && value.deployPrice == null)
      errors.deployPrice = 'Purchase price is required for an existing loan, so the BTC you bought does not move with today’s price.';
    if (mode === 'existing' && value.deploy === 0 && value.borrowPrice == null && !errors.deploy)
      errors.borrowPrice = 'Enter the BTC price when you borrowed (no purchase price to fall back on).';
    if (!errors.mc && !errors.liq && value.mc >= value.liq) errors.mc = 'Margin call LTV must be below liquidation LTV.';
    if (!errors.restoreLtv && !errors.mc && value.restoreLtv >= value.mc) errors.restoreLtv = 'Restore-to LTV must be below margin call LTV.';
    if (mode === 'new' && !errors.ltv && !errors.mc && value.ltv >= value.mc) errors.ltv = 'Initial LTV must be below margin call LTV.';
    if (!errors.mm && !errors.leverage && value.mm / 100 >= 1 / value.leverage) errors.mm = 'Maintenance margin must be below initial margin (100 ÷ leverage).';
    // Effective LTV checks for an existing loan are warnings: the position is real and must still render.
    if (mode === 'existing' && !Object.keys(errors).length) {
      const borrowPrice = value.borrowPrice ?? value.deployPrice;
      const initial = value.loanPrincipal / (value.btc * borrowPrice) * 100;
      const debt = value.loanPrincipal * (1 + value.apr / 100 * daysBetween(value.loanDate, asOf) / 365);
      const current = debt / (value.btc * value.price) * 100;
      if (initial >= value.mc) warnings.push(`Initial LTV of ${initial.toFixed(1)}% was already at or above your ${value.mc}% margin call.`);
      if (current >= value.liq) warnings.push(`Today’s LTV is ${current.toFixed(1)}%, past your ${value.liq}% liquidation level.`);
      else if (current >= value.mc) warnings.push(`Today’s LTV is ${current.toFixed(1)}%, inside the margin-call zone (${value.mc}%).`);
    }
    return { valid: Object.keys(errors).length === 0, value, errors, warnings };
  }

  function status(ltv, d) {
    if (d.loan === 0) return 'No debt';
    if (ltv >= d.liqLtv - 1e-10) return 'Liquidation';
    if (ltv >= d.mcLtv - 1e-10) return 'Margin call';
    return 'Active';
  }

  function calculate(input, data, weights, now = Date.now()) {
    const v = validate(input, now);
    if (!v.valid) throw Object.assign(new Error(Object.values(v.errors)[0]), { errors: v.errors });
    const p = v.value, existing = p.mode === 'existing';
    const asOfDate = today(now);
    const btc = p.btc, price = p.price, apr = p.apr / 100;
    const mcLtv = p.mc / 100, liqLtv = p.liq / 100, restoreLtv = p.restoreLtv / 100;
    const loan = existing ? p.loanPrincipal : btc * price * p.ltv / 100;
    const deployPct = p.deploy / 100;
    const deployPrice = p.deployPrice ?? (existing ? p.borrowPrice : price);
    const borrowPrice = existing ? (p.borrowPrice ?? p.deployPrice) : price;
    const entry = p.entry ?? borrowPrice;
    const loanDays = daysBetween(p.loanDate, asOfDate), exitDays = daysBetween(asOfDate, p.exitDate);
    const totalDays = loanDays + exitDays;
    const accruedInterest = loan * apr * loanDays / 365, debtToday = loan + accruedInterest;
    const exitInterest = loan * apr * totalDays / 365, debtAtExit = loan + exitInterest;
    const futureInterest = exitInterest - accruedInterest;
    const deployedUsd = loan * deployPct, cash = loan - deployedUsd;
    const newBtc = deployPrice > 0 ? deployedUsd / deployPrice : 0, totalBtc = btc + newBtc;
    const startValue = btc * borrowPrice, collateral = btc * price;
    const equityNow = totalBtc * price + cash - debtToday;
    const d = {
      mode: p.mode, existing, input: p, asOfDate, loanDate: p.loanDate, exitDate: p.exitDate, loanDays, exitDays, totalDays,
      btc, price, borrowPrice, deployPrice, entry, entrySet: p.entry != null, target: p.target, vol: p.vol / 100,
      apr, mcLtv, liqLtv, restoreLtv, leverage: p.leverage, mm: p.mm, funding: p.funding,
      loan, deployPct, deployedUsd, cash, newBtc, totalBtc,
      initialLtv: startValue ? loan / startValue : 0,
      currentLtv: collateral ? debtToday / collateral : 0,
      collateral, startValue, equityNow,
      accruedInterest, debtToday, exitInterest, debtAtExit, futureInterest,
      mcPrice: debtToday / (btc * mcLtv), liqPrice: debtToday / (btc * liqLtv),
      mcPriceExit: debtAtExit / (btc * mcLtv), liqPriceExit: debtAtExit / (btc * liqLtv),
      warnings: v.warnings
    };
    d.currentStatus = status(d.currentLtv, d);
    d.bufferPct = (1 - d.mcPrice / price) * 100;
    d.liqDropPct = (d.liqPrice / price - 1) * 100;
    // Break-evens at the exit date.
    d.beatHoldPrice = newBtc > 0 ? Math.max(0, (debtAtExit - cash) / newBtc) : null;  // loan trade P/L = 0
    d.breakevenStart = (startValue + debtAtExit - cash) / totalBtc;                   // since-borrowing P/L = 0
    d.breakevenToday = (equityNow + debtAtExit - cash) / totalBtc;                    // from-today P/L = 0
    d.at = scenario(d, p.target);
    // Risk.
    const debt90 = loan * (1 + apr * (loanDays + 90) / 365);
    d.liqPrice90 = debt90 / (btc * liqLtv);
    d.pLiq90 = d.loan ? barrierProbability(price, d.liqPrice90, d.vol, 90) : 0;
    d.rrRatio = d.loan && data && price > d.liqPrice && data.ceilPrice > price ? (data.ceilPrice - price) / (price - d.liqPrice) : null;
    d.topUpUsd = d.loan ? debtToday / restoreLtv - debtToday / mcLtv : 0;
    d.topUpBtc = d.loan ? d.topUpUsd / d.mcPrice : 0;
    d.restoreRepayUsd = d.loan ? debtToday * (1 - restoreLtv / mcLtv) : 0;
    const signals = data ? scoreSignals(data, weights) : null;
    d.signals = signals; d.score = signals ? signals.composite : null;
    d.athDropPct = data && data.c4Ath > 0 ? (price / data.c4Ath - 1) * 100 : null;
    return d;
  }

  // Open position at the exit date, valued at `px`.
  function scenario(d, px) {
    const ltv = d.debtAtExit / (d.btc * px);
    const equity = d.totalBtc * px + d.cash - d.debtAtExit;
    const loanTrade = d.newBtc * (px - d.deployPrice) - d.exitInterest;
    return {
      price: px, ltv, status: status(ltv, d), change: (px / d.price - 1) * 100, equity,
      pnlStart: equity - d.startValue,               // since borrowing
      pnlToday: equity - d.equityNow,                // from today
      holdStart: d.btc * (px - d.borrowPrice),
      holdToday: d.btc * (px - d.price),
      loanTrade,                                     // = edge vs simply holding the collateral
      costBasis: d.btc * (px - d.entry) + loanTrade,
      returnStartPct: d.startValue ? (equity - d.startValue) / d.startValue * 100 : null,
      returnTodayPct: d.equityNow > 0 ? (equity - d.equityNow) / d.equityNow * 100 : null
    };
  }

  // Repay the debt at `px`: unused loan cash first, then sell collateral for the rest.
  // when = 'now' uses today's debt; 'exit' uses the debt at the exit date.
  function repayment(d, px, when = 'now') {
    if (!Number.isFinite(px) || px <= 0) throw new RangeError('Repayment price must be positive and finite.');
    const debt = when === 'exit' ? d.debtAtExit : d.debtToday;
    const ltv = debt / (d.btc * px), st = status(ltv, d);
    const cashUsed = Math.min(d.cash, debt), debtLeft = debt - cashUsed, cashLeft = d.cash - cashUsed;
    const soldBtc = debtLeft / px, residualBtc = d.btc - soldBtc, walletBtc = residualBtc + d.newBtc;
    const btcChange = walletBtc - d.btc, netAssets = walletBtc * px + cashLeft;
    const beatHoldPrice = d.newBtc > 0 ? Math.max(0, debtLeft / d.newBtc) : null;
    return {
      price: px, when, debt, ltv, status: st, available: st !== 'Liquidation' && residualBtc >= 0,
      cashUsed, cashLeft, debtLeft, soldBtc, residualBtc, walletBtc, btcChange,
      btcChangePct: btcChange / d.btc * 100, netAssets,
      edgeVsHold: netAssets - d.btc * px,
      pnlStart: netAssets - d.startValue,
      costBasisPnl: netAssets - d.btc * d.entry,
      loanTradeGross: d.newBtc * (px - d.deployPrice),
      interest: debt - d.loan,
      beatHoldPrice
    };
  }

  // Spot + isolated futures with the same extra BTC, opened at the same purchase price on the loan date,
  // held over the same loan-date → exit-date window as the loan.
  function futures(d) {
    const notionalUsd = d.deployedUsd, notionalBtc = d.newBtc, margin = notionalUsd / d.leverage;
    const mmRate = d.mm / 100, fundingApr = d.funding / 100;
    const fundingCost = notionalUsd * fundingApr * d.totalDays / 365;
    const liqPrice = notionalUsd > 0 ? d.deployPrice * (1 - 1 / d.leverage) / (1 - mmRate) : null;
    const T = d.target, s = d.at;
    const legPnl = d.newBtc * (T - d.deployPrice) - fundingCost;
    const pnlFut = d.btc * (T - d.borrowPrice) + legPnl;
    const capital = d.startValue + margin;
    return {
      notionalUsd, notionalBtc, margin, mmRate, fundingApr, fundingCost, liqPrice, capital, legPnl,
      liqDropPct: liqPrice !== null ? (liqPrice / d.price - 1) * 100 : null,
      pnlLoan: s.pnlStart, pnlFut,
      returnLoanPct: s.returnStartPct, returnFutPct: capital ? pnlFut / capital * 100 : null,
      legReturnPct: margin > 0 ? legPnl / margin * 100 : null,
      beatHoldPrice: notionalBtc > 0 ? d.deployPrice + fundingCost / notionalBtc : null,
      liquidatedNow: liqPrice !== null && d.price <= liqPrice,
      targetLiquidated: liqPrice !== null && (T <= liqPrice || d.price <= liqPrice),
      costDifference: fundingCost - d.exitInterest
    };
  }

  function stress(d, drops = [10, 20, 30, 40, 50]) {
    return drops.map(drop => {
      const px = d.price * (1 - drop / 100), ltv = d.debtToday / (d.btc * px);
      return { drop, price: px, ltv, status: status(ltv, d) };
    });
  }

  function normalCDF(z) {
    if (z===Infinity) return 1;
    if (z===-Infinity) return 0;
    if (!Number.isFinite(z)) return NaN;
    if (z===0) return 0.5;
    const x=Math.abs(z)/Math.SQRT2, t=1/(1+0.3275911*x);
    const erfc=t*(0.254829592+t*(-0.284496736+t*(1.421413741+t*(-1.453152027+t*1.061405429))))*Math.exp(-x*x);
    return clamp(z<0?erfc/2:1-erfc/2,0,1);
  }
  // Reflection principle for log(Pt/P0) = sigma * Wt: fixed barrier, zero log drift.
  function barrierProbability(price,barrier,vol,days) {
    if (![price,barrier,vol,days].every(Number.isFinite)||price<=0||barrier<0||vol<0||days<0) return NaN;
    if (barrier>=price) return 1;
    if (barrier===0||days===0||vol===0) return 0;
    return clamp(2*normalCDF(Math.log(barrier/price)/(vol*Math.sqrt(days/365))),0,1);
  }
  function normalizeWeights(raw=WEIGHTS) {
    const out={};
    for (const key of Object.keys(WEIGHTS)) {
      const v=Number(raw[key]);
      out[key]=Number.isFinite(v)&&v>=0?v:WEIGHTS[key];
    }
    const sum=Object.values(out).reduce((a,b)=>a+b,0);
    for (const key of Object.keys(out)) out[key]=sum?out[key]/sum:WEIGHTS[key]/100;
    return {weights:out,usedDefaults:sum===0};
  }
  function scoreSignals(data,raw) {
    const {weights,usedDefaults}=normalizeWeights(raw);
    const scores={
      mvrv:clamp(10*(1-data.mvrv/(data.histMeanMvrv*2)),0,10),
      zscore:clamp(10*(1-(data.zscore+2)/5),0,10),
      ma:/bull/i.test(data.maStack)?8:/bear/i.test(data.maStack)?3:5,
      roc:data.roc30>10?9:data.roc30>0?6:data.roc30>-10?4:2,
      cycle:data.cyclePos<35?9:data.cyclePos<65?7:4
    };
    return {scores,weights,usedDefaults,composite:Object.keys(weights).reduce((s,k)=>s+weights[k]*scores[k],0)};
  }
  function dateValid(s) {
    return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  }
  function ageHours(date,now=Date.now()) {return dateValid(date)?Math.max(0,(now-Date.parse(date+'T00:00:00Z'))/36e5):Infinity;}
  // Accepts both the original report labels and the format introduced upstream on 2026-11-23.
  function parseSummary(text) {
    if (typeof text!=='string'||text.length>2e6) throw new Error('Invalid MVRV report.');
    const lines=text.split(/\r?\n/).map(s=>s.trim());
    const map=new Map();
    for(const line of lines){const i=line.indexOf(':');if(i>0&&!map.has(line.slice(0,i).toLowerCase()))map.set(line.slice(0,i).toLowerCase(),line.slice(i+1).trim());}
    const str=(...keys)=>{for(const k of keys){const v=map.get(k.toLowerCase());if(v!=null)return v;}return undefined;};
    const num=(...keys)=>{const raw=str(...keys);if(raw==null)return null;const clean=raw.replace(/[$,%]/g,'').replace(/−/g,'-');const m=clean.match(/^[-+]?\d+(?:\.\d+)?/);return m?Number(m[0]):null;};
    const data={date:str('MVRV date','Date'),signal:str('Signal')||'Unclassified',maStack:str('MA stack','MA alignment')||'Unknown',cycleName:str('Current cycle')||'Unknown'};
    const mapping={mvrv:['MVRV'],zscore:['Z-score','Rolling MVRV z (365d)'],ma20:['MA20'],ma50:['MA50'],ma200:['MA200'],roc30:['ROC 30d','MVRV ROC 30d'],roc90:['ROC 90d','MVRV ROC 90d'],
      btcPrice:['BTC Price','BTC price on MVRV date'],histMeanMvrv:['Historical mean MVRV','Dataset mean MVRV'],cyclePos:['Cycle position'],
      ceilPrice:['Ceiling consensus midpoint','Ceiling ensemble (median)'],floorPrice:['Floor consensus midpoint','Floor ensemble (median)'],
      cycleDrawdown:['Current drawdown from cycle peak','Current drawdown from cycle MVRV peak'],mvrvVsCyclePeak:['Current MVRV vs cycle peak']};
    for(const [key,labels]of Object.entries(mapping))data[key]=num(...labels);
    data.zscoreKind=str('Z-score')!=null?'standard':str('Rolling MVRV z (365d)')!=null?'rolling365':null;
    // btcPrice is optional: the upstream generator omits it when its daily price file lags the report date.
    const required=['mvrv','zscore','histMeanMvrv','cyclePos','ceilPrice','floorPrice','roc30'];
    if(!dateValid(data.date)||required.some(k=>!Number.isFinite(data[k]))||['mvrv','histMeanMvrv','ceilPrice','floorPrice'].some(k=>data[k]<=0)||(data.btcPrice!==null&&data.btcPrice<=0)||data.cyclePos<0||data.cyclePos>100||data.maStack==='Unknown')throw new Error('Incomplete or invalid MVRV report; previous data retained.');
    data.totalPoints=str('Total data points','Daily observations')||null;data.dataRange=str('Data range')||null;
    const peak=str('Cycle peak so far','Cycle MVRV peak so far')?.match(/([\d.]+)\s+on\s+(\d{4}-\d{2}-\d{2})/);
    data.cyclePeakMvrv=peak?Number(peak[1]):null;data.cyclePeakDate=peak?peak[2]:null;
    const range=str('Ceiling consensus range','Ceiling model spread')?.match(/\$([\d,]+)\s*[–—-]\s*\$([\d,]+)/);
    data.ceilLow=range?Number(range[1].replaceAll(',','')):null;data.ceilHigh=range?Number(range[2].replaceAll(',','')):null;
    const cycleNumber=data.cycleName.match(/C(?:ycle)?\s*(\d+)/i)?.[1];let currentCycle=null,worst=0;
    for(const line of lines){
      const cycle=line.match(/^Cycle\s+(\d+)\b/i);if(cycle)currentCycle=cycle[1];
      const ath=line.match(/(?:BTC ATH|BTC price high):\s*\$([\d,]+)\s+on\s+(\d{4}-\d{2}-\d{2})/i);
      if(ath&&currentCycle===cycleNumber){const v=Number(ath[1].replaceAll(',',''));if(!(data.c4Ath>=v)){data.c4Ath=v;data.c4AthDate=ath[2];}}
      const dd=line.match(/Max drawdown:\s*(-[\d.]+)%/i);if(dd&&Number(dd[1])<worst){worst=Number(dd[1]);data.worstCycleTag='C'+currentCycle;}
      for(const [key,label]of [['mvrvUpside','Upside'],['mvrvDownside','Downside']]){const m=line.match(new RegExp('MVRV '+label+':\\s*\\$([\\d,]+)','i'));if(m)data[key]=Number(m[1].replaceAll(',',''));}
      const halving=line.match(/C\d+ halving:\s*~?(\d{4}-\d{2}-\d{2}).*\[(?:upcoming|estimated)/i);
      if(halving&&dateValid(halving[1])&&halving[1]>data.date&&(!data.nextHalving||halving[1]<data.nextHalving))data.nextHalving=halving[1];
    }
    data.worstCycleDrawdown=worst||null;
    return data;
  }
  function priceSeries(raw) {
    if (!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('Invalid daily price series.');
    const result={};
    for(const [date,value]of Object.entries(raw))if(dateValid(date)&&typeof value!=='boolean'&&value!==null&&Number.isFinite(Number(value))&&Number(value)>0)result[date]=Number(value);
    if(!Object.keys(result).length)throw new Error('No valid daily prices.');return result;
  }
  function nearestPrice(series,date) {
    if(!dateValid(date))return null;
    const start=Date.parse(date+'T00:00:00Z');
    for(let i=0;i<=7;i++){const probe=new Date(start-i*864e5).toISOString().slice(0,10);if(Number.isFinite(series[probe])&&series[probe]>0)return {date:probe,price:series[probe],exact:i===0};}return null;
  }
  return {DEFAULTS,SAVED_POSITION,WEIGHTS,FIELDS,clamp,today,addDays,daysBetween,validate,normalCDF,barrierProbability,normalizeWeights,scoreSignals,calculate,scenario,repayment,futures,stress,dateValid,ageHours,parseSummary,priceSeries,nearestPrice};
});
