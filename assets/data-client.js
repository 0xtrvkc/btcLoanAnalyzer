(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.LoanEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.MarketClient=api;})(typeof window!=='undefined'?window:this,function(M){
  'use strict';
  const BASE='https://raw.githubusercontent.com/0xtrvkc/dynamic-btc-analytics-dashboard/main/';
  const PRICE_URL=BASE+'btc_daily_price.json';
  async function request(url,options={},asText=false){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
    try{const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('Source returned HTTP '+response.status);return asText?await response.text():await response.json();}finally{clearTimeout(timer);}
  }
  async function dailySeries(){return M.priceSeries(await request(PRICE_URL));}
  async function quote(now=Date.now()){
    try{const mids=await request('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'allMids'})});
      const price=Number(mids?.BTC);if(!Number.isFinite(price)||price<=0)throw new Error('Invalid BTC quote');
      return {price,date:new Date(now).toISOString().slice(0,10),fetchedAt:new Date().toISOString(),live:true,source:'Hyperliquid mid'};
    }catch{
      const series=await dailySeries(),today=new Date(now).toISOString().slice(0,10);
      const dates=Object.keys(series).filter(d=>d<=today).sort();if(!dates.length)throw new Error('No current or historical daily quote');const date=dates.at(-1);
      return {price:series[date],date,fetchedAt:new Date().toISOString(),live:false,source:'Daily snapshot'};
    }
  }
  async function summary(now=Date.now()){
    const dates=[0,1,2,3].map(i=>new Date(now-i*864e5).toISOString().slice(0,10));
    const reports=await Promise.allSettled(dates.map(async date=>{const raw=await request(BASE+'exports/mvrv_summary_'+date+'.txt',{},true);const data=M.parseSummary(raw);if(data.date!==date)throw new Error('Report date mismatch');return data;}));
    const valid=reports.find(r=>r.status==='fulfilled');if(!valid)throw new Error('No valid on-chain report in the last four days');return valid.value;
  }
  async function refresh(now=Date.now()){
    const [onchain,market]=await Promise.allSettled([summary(now),quote(now)]);
    return {data:onchain.status==='fulfilled'?onchain.value:null,quote:market.status==='fulfilled'?market.value:null,
      reportError:onchain.status==='rejected'?onchain.reason.message:null,quoteError:market.status==='rejected'?market.reason.message:null};
  }
  return {refresh,dailySeries,BASE,PRICE_URL};
});
