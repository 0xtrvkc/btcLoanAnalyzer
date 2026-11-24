(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.LoanEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.MarketClient=api;})(typeof window!=='undefined'?window:this,function(M){
  'use strict';
  const BASE='https://raw.githubusercontent.com/0xtrvkc/dynamic-btc-analytics-dashboard/main/';
  const PRICE_URL=BASE+'btc_daily_price.json';
  const COINTH_URL='https://cointh.com/api/v1/indicators/open-interest';
  async function request(url,options={},asText=false){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
    try{const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('Source returned HTTP '+response.status);return asText?await response.text():await response.json();}finally{clearTimeout(timer);}
  }
  async function dailySeries(){return M.priceSeries(await request(PRICE_URL));}
  // Price sources, freshest first: Hyperliquid mid (live) → CoinTH (cached up to 1h) → daily close.
  async function hyperliquid(){
    const mids=await request('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'allMids'})});
    const price=Number(mids?.BTC);if(!Number.isFinite(price)||price<=0)throw new Error('Invalid Hyperliquid quote');
    const at=new Date().toISOString();return {price,date:at.slice(0,10),fetchedAt:at,live:true,source:'Hyperliquid mid'};
  }
  async function cointh(now=Date.now()){
    const body=await request(COINTH_URL);
    const price=Number(body?.data?.price),stamp=String(body?.updatedAt||body?.asOf||'');
    if(body?.ok!==true||!Number.isFinite(price)||price<=0||!Number.isFinite(Date.parse(stamp)))throw new Error('Invalid CoinTH quote');
    if(now-Date.parse(stamp)>6*36e5)throw new Error('CoinTH quote is more than 6 hours old');
    return {price,date:new Date(Date.parse(stamp)).toISOString().slice(0,10),fetchedAt:new Date(Date.parse(stamp)).toISOString(),live:false,source:'CoinTH'};
  }
  async function quote(now=Date.now()){
    try{return await hyperliquid();}catch{}
    try{return await cointh(now);}catch{}
    const series=await dailySeries(),today=new Date(now).toISOString().slice(0,10);
    const dates=Object.keys(series).filter(d=>d<=today).sort();if(!dates.length)throw new Error('No current or historical daily quote');const date=dates.at(-1);
    return {price:series[date],date,fetchedAt:new Date().toISOString(),live:false,source:'Daily snapshot'};
  }
  async function summary(now=Date.now()){
    const dates=[0,1,2,3].map(i=>new Date(now-i*864e5).toISOString().slice(0,10));
    const reports=await Promise.allSettled(dates.map(async date=>{const raw=await request(BASE+'exports/mvrv_summary_'+date+'.txt',{},true);const data=M.parseSummary(raw);// Export filenames use generation day; observations may be from the prior day.
      if(data.date>date||data.date<dates.at(-1))throw new Error('Report observation date outside the allowed window');return data;}));
    const valid=reports.filter(r=>r.status==='fulfilled').map(r=>r.value).sort((a,b)=>b.date.localeCompare(a.date));
    if(!valid.length)throw new Error('No valid on-chain report in the last four days');return valid[0];
  }
  async function refresh(now=Date.now()){
    const [onchain,market]=await Promise.allSettled([summary(now),quote(now)]);
    let data=onchain.status==='fulfilled'?onchain.value:null;
    // Report omitted BTC Price: use the quote so downstream consumers still get a finite price, and flag it.
    if(data&&!Number.isFinite(data.btcPrice)&&market.status==='fulfilled')data={...data,btcPrice:market.value.price,btcPriceFromQuote:true};
    return {data,quote:market.status==='fulfilled'?market.value:null,
      reportError:onchain.status==='rejected'?String(onchain.reason?.message||onchain.reason):null,quoteError:market.status==='rejected'?String(market.reason?.message||market.reason):null};
  }
  return {refresh,quote,dailySeries,BASE,PRICE_URL,COINTH_URL};
});
