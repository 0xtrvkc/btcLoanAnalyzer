/* Shared, dependency-free calculation engine. Used by the UI and daily export. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoanEngine = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({btc:1,price:61042,ltv:40,apr:1,mc:85,liq:90,vol:65,entry:0,deployPrice:0,deploy:100,target:100000,months:12,leverage:5,mm:0.5,funding:10});
  const SAVED_POSITION = Object.freeze({btc:0.035,ltv:36,entry:79422,deployPrice:79422,apr:6,target:158844});
  const WEIGHTS = Object.freeze({mvrv:30,zscore:25,ma:20,roc:10,cycle:15});
  const FIELDS = {
    btc:[0.00000001,1000000,'BTC collateral'],price:[1,1e9,'Reference price'],ltv:[0,99,'Initial LTV'],
    apr:[0,100,'Loan APR'],mc:[1,99.9,'Margin call LTV'],liq:[1,99.99,'Liquidation LTV'],
    vol:[0,300,'Annualized volatility'],entry:[0,1e9,'Cost basis'],deployPrice:[0,1e9,'Deployment price'],
    deploy:[0,100,'Deployment'],target:[1,1e9,'Target price'],months:[0,120,'Holding period'],
    leverage:[1,50,'Futures leverage'],mm:[0,20,'Maintenance margin'],funding:[-100,200,'Funding APR']
  };
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  function validate(input) {
    const value={}, errors={};
    for (const [key,[min,max,label]] of Object.entries(FIELDS)) {
      const raw=input[key];
      const optional=key==='entry'||key==='deployPrice';
      const n=(raw===''||raw==null)?(optional?0:NaN):Number(raw);
      if (!Number.isFinite(n)||n<min||n>max) errors[key]=`${label} must be between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.`;
      else value[key]=n;
    }
    if (!errors.mc&&!errors.liq&&value.mc>=value.liq) errors.mc='Margin call LTV must be below liquidation LTV.';
    if (!errors.ltv&&!errors.mc&&value.ltv>=value.mc) errors.ltv='Initial LTV must be below margin call LTV.';
    if (!errors.mm&&!errors.leverage&&value.mm/100>=1/value.leverage) errors.mm='Maintenance margin must be below initial margin (100 ÷ leverage).';
    return {valid:Object.keys(errors).length===0,value,errors};
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
  function kellyIllustration(score,up,down,liq) {
    if (![score,up,down,liq].every(Number.isFinite)||up<=0||down<=0) return 0;
    const p=0.4+score/10*0.3,odds=up/down;
    return clamp((p-(1-p)/odds)*0.5,0,Math.max(0,liq-0.05));
  }
  function calculate(input,data,weights) {
    const validation=validate(input);
    if (!validation.valid) throw Object.assign(new Error(Object.values(validation.errors)[0]),{errors:validation.errors});
    const p=validation.value;
    const btc=p.btc,price=p.price,ltv=p.ltv/100,apr=p.apr/100,mcLtv=p.mc/100,liqLtv=p.liq/100;
    const collateral=btc*price,loan=collateral*ltv,years=p.months/12;
    const interest=loan*apr,interestCost=interest*years,debtOwed=loan+interestCost;
    const deployPrice=p.deployPrice||price,deployedUsd=loan*p.deploy/100,undeployedUsd=loan-deployedUsd;
    const newBtc=deployedUsd/deployPrice,totalBtc=btc+newBtc;
    const mcPrice=loan/(btc*mcLtv),liqPrice=loan/(btc*liqLtv);
    const mcPriceH=debtOwed/(btc*mcLtv),liqPriceH=debtOwed/(btc*liqLtv);
    const grossProfit=btc*(p.target-price)+newBtc*(p.target-deployPrice);
    const netProfit=grossProfit-interestCost,unlevProfit=btc*(p.target-price);
    const breakevenPrice=(collateral+debtOwed-undeployedUsd)/totalBtc;
    const signals=scoreSignals(data,weights),score=signals.composite;
    const rrRatio=p.entry>liqPrice&&data.ceilPrice>p.entry?(data.ceilPrice-p.entry)/(p.entry-liqPrice):null;
    const d={...p,btc,price,ltv,ltvPct:p.ltv,apr,mcLtv,liqLtv,vol:p.vol/100,collateral,loan,years,interest,interestCost,
      debtOwed,deployPct:p.deploy/100,deployPrice,deployedUsd,undeployedUsd,newBtc,totalBtc,mcPrice,liqPrice,mcPriceH,liqPriceH,
      buffer:price-mcPrice,bufferPct:(1-mcPrice/price)*100,liqDropPct:(liqPrice/price-1)*100,
      targetPrice:p.target,grossProfit,netProfit,unlevProfit,unlevReturnPct:unlevProfit/collateral*100,levReturnPct:netProfit/collateral*100,
      leverageEdge:netProfit-unlevProfit,breakevenPrice,breakevenGross:(collateral+loan-undeployedUsd)/totalBtc,
      totalValue:totalBtc*p.target+undeployedUsd,equity:totalBtc*p.target+undeployedUsd-debtOwed,
      costBasisProfit:p.entry>0?btc*(p.target-p.entry)+newBtc*(p.target-deployPrice)-interestCost:null,
      borrowedProfit:newBtc*(p.target-deployPrice)-interestCost,
      borrowedBreakeven:newBtc>0?deployPrice+interestCost/newBtc:null,
      pLiq90:barrierProbability(price,liqPrice,p.vol/100,90),score,signals,rrRatio,
      kellyLtv:kellyIllustration(score,(data.ceilPrice-price)/price,(price-liqPrice)/price,liqLtv),
      athDropPct:data.c4Ath>0?(price/data.c4Ath-1)*100:null,
      netGain:btc*(data.ceilPrice-price)+newBtc*(data.ceilPrice-deployPrice)-interestCost
    };
    d.targetStatus=scenario(d,p.target).status;
    return d;
  }
  function scenario(d,price) {
    const ltv=d.debtOwed/(d.btc*price),equity=d.totalBtc*price+d.undeployedUsd-d.debtOwed;
    return {price,ltv,change:(price/d.price-1)*100,equity,pnl:equity-d.collateral,
      hold:d.btc*(price-d.price),borrowed:d.newBtc*(price-d.deployPrice)-d.interestCost,
      cost:d.entry>0?d.btc*(price-d.entry)+d.newBtc*(price-d.deployPrice)-d.interestCost:null,
      status:d.loan===0?'No debt':ltv>=d.liqLtv-1e-10?'Liquidation':ltv>=d.mcLtv-1e-10?'Margin call':'Active'};
  }
  function futures(d) {
    const notionalUsd=d.deployedUsd,notionalBtc=d.newBtc,margin=notionalUsd/d.leverage;
    const mmRate=d.mm/100,fundingApr=d.funding/100,fundingCost=notionalUsd*fundingApr*d.years;
    const liqPrice=notionalUsd>0?d.deployPrice*(1-1/d.leverage)/(1-mmRate):null;
    const pnlFutAdj=d.grossProfit-fundingCost,legPnl=d.newBtc*(d.targetPrice-d.deployPrice)-fundingCost;
    const capital=d.collateral+margin;
    return {notionalUsd,notionalBtc,margin,mmRate,fundingApr,fundingCost,liqPrice,capital,legPnl,
      liqDropPct:liqPrice!==null?(liqPrice/d.price-1)*100:null,
      pnlLoanAdj:d.netProfit,pnlFutAdj,returnLoanPct:d.netProfit/d.collateral*100,returnFutPct:pnlFutAdj/capital*100,
      legReturnPct:margin>0?legPnl/margin*100:null,
      breakevenSimple:(d.collateral+d.deployedUsd)/d.totalBtc,
      breakevenAdj:(d.collateral+d.deployedUsd+fundingCost)/d.totalBtc,
      targetLiquidated:liqPrice!==null&&(d.targetPrice<=liqPrice||d.price<=liqPrice),
      costDifference:fundingCost-d.interestCost};
  }
  function twoPots(d) {
    const debtBtc=d.debtOwed/d.price;
    const residualBtc=d.btc-debtBtc,walletBtc=residualBtc+d.newBtc;
    const cash=d.undeployedUsd,netAssets=walletBtc*d.price+cash;
    return {debtBtc,residualBtc,walletBtc,cash,netAssets,newValue:d.newBtc*d.price,residualValue:residualBtc*d.price,
      available:scenario(d,d.price).status!=='Liquidation'};
  }
  // Repay the full horizon debt from original collateral; leave loan cash untouched.
  // The recovery benchmark excludes BTC purchased with borrowed money.
  function collateralRepayment(d,price=d.targetPrice) {
    if (!Number.isFinite(price)||price<=0) throw new RangeError('Repayment price must be positive and finite.');
    const status=scenario(d,price).status;
    const soldBtc=d.debtOwed/price,residualBtc=d.btc-soldBtc;
    const walletBtc=residualBtc+d.newBtc,btcChange=d.newBtc-soldBtc;
    const netAssets=walletBtc*price+d.undeployedUsd;
    const recoveryPrice=d.newBtc>0?d.debtOwed/d.newBtc:null;
    const recoveryStatus=d.debtOwed===0?'No debt':recoveryPrice===null?'No finite price':scenario(d,recoveryPrice).status;
    return {price,status,available:status!=='Liquidation'&&residualBtc>=0,soldBtc,residualBtc,walletBtc,
      btcChange,btcChangePct:btcChange/d.btc*100,netAssets,pnl:netAssets-d.collateral,
      pnlPct:(netAssets-d.collateral)/d.collateral*100,
      edgeVsHold:netAssets-d.btc*price,recoveryPrice,recoveryStatus,
      recoveryAvailable:recoveryPrice!==null&&recoveryStatus!=='Liquidation',
      recoveryChangePct:recoveryPrice===null?null:(recoveryPrice/d.price-1)*100,
      valueRecoveryPrice:(d.collateral+d.debtOwed)/d.totalBtc};
  }
  function dateValid(s) {
    return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  }
  function ageHours(date,now=Date.now()) {return dateValid(date)?Math.max(0,(now-Date.parse(date+'T00:00:00Z'))/36e5):Infinity;}
  function parseSummary(text) {
    if (typeof text!=='string'||text.length>2e6) throw new Error('Invalid MVRV report.');
    const lines=text.split(/\r?\n/).map(s=>s.trim());
    const map=new Map();
    for(const line of lines){const i=line.indexOf(':');if(i>0&&!map.has(line.slice(0,i).toLowerCase()))map.set(line.slice(0,i).toLowerCase(),line.slice(i+1).trim());}
    const str=k=>map.get(k.toLowerCase());
    const num=k=>{const raw=str(k);if(raw==null)return null;const clean=raw.replace(/[$,%]/g,'').replace(/−/g,'-');const m=clean.match(/^[-+]?\d+(?:\.\d+)?/);return m?Number(m[0]):null;};
    const data={date:str('Date'),signal:str('Signal')||'Unclassified',maStack:str('MA stack')||'Unknown',cycleName:str('Current cycle')||'Unknown'};
    const mapping={mvrv:'MVRV',zscore:'Z-score',ma20:'MA20',ma50:'MA50',ma200:'MA200',roc30:'ROC 30d',roc90:'ROC 90d',btcPrice:'BTC Price',histMeanMvrv:'Historical mean MVRV',cyclePos:'Cycle position',ceilPrice:'Ceiling consensus midpoint',floorPrice:'Floor consensus midpoint',cycleDrawdown:'Current drawdown from cycle peak',mvrvVsCyclePeak:'Current MVRV vs cycle peak'};
    for(const [key,label]of Object.entries(mapping))data[key]=num(label);
    const required=['mvrv','zscore','btcPrice','histMeanMvrv','cyclePos','ceilPrice','floorPrice','roc30'];
    if(!dateValid(data.date)||required.some(k=>!Number.isFinite(data[k]))||['mvrv','btcPrice','histMeanMvrv','ceilPrice','floorPrice'].some(k=>data[k]<=0)||data.cyclePos<0||data.cyclePos>100||data.maStack==='Unknown')throw new Error('Incomplete or invalid MVRV report; previous data retained.');
    data.totalPoints=str('Total data points')||null;data.dataRange=str('Data range')||null;
    const peak=str('Cycle peak so far')?.match(/([\d.]+)\s+on\s+(\d{4}-\d{2}-\d{2})/);
    data.cyclePeakMvrv=peak?Number(peak[1]):null;data.cyclePeakDate=peak?peak[2]:null;
    const range=str('Ceiling consensus range')?.match(/\$([\d,]+)\s*[–—-]\s*\$([\d,]+)/);
    data.ceilLow=range?Number(range[1].replaceAll(',','')):null;data.ceilHigh=range?Number(range[2].replaceAll(',','')):null;
    const cycleNumber=data.cycleName.match(/C(?:ycle)?\s*(\d+)/i)?.[1];let currentCycle=null,worst=0;
    for(const line of lines){
      const cycle=line.match(/^Cycle\s+(\d+):/i);if(cycle)currentCycle=cycle[1];
      const ath=line.match(/BTC ATH:\s*\$([\d,]+)\s+on\s+(\d{4}-\d{2}-\d{2})/i);
      if(ath&&currentCycle===cycleNumber){data.c4Ath=Number(ath[1].replaceAll(',',''));data.c4AthDate=ath[2];}
      const dd=line.match(/Max drawdown:\s*(-[\d.]+)%/i);if(dd&&Number(dd[1])<worst){worst=Number(dd[1]);data.worstCycleTag='C'+currentCycle;}
      for(const [key,label]of [['mvrvUpside','Upside'],['mvrvDownside','Downside']]){const m=line.match(new RegExp('MVRV '+label+':\\s*\\$([\\d,]+)','i'));if(m)data[key]=Number(m[1].replaceAll(',',''));}
      const halving=line.match(/C\d+ halving:\s*(\d{4}-\d{2}-\d{2}).*\[upcoming/i);
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
  return {DEFAULTS,SAVED_POSITION,WEIGHTS,FIELDS,clamp,validate,normalCDF,barrierProbability,normalizeWeights,scoreSignals,kellyIllustration,calculate,scenario,futures,twoPots,collateralRepayment,dateValid,ageHours,parseSummary,priceSeries,nearestPrice};
});
