'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Client=require('../assets/data-client.js');
const text=date=>`Date: ${date}\nMVRV: 1.5\nZ-score: 0\nBTC Price: $80,000\nHistorical mean MVRV: 1.8\nCycle position: 60%\nCeiling consensus midpoint: $120,000\nFloor consensus midpoint: $35,000\nROC 30d: 10%\nMA stack: Bullish\n`;
const response=(data,isText=false)=>({ok:true,text:async()=>isText?data:JSON.stringify(data),json:async()=>data});
test('invalid newest report falls through to a validated older report while quote remains independent',async()=>{
 const old=global.fetch;
 try{global.fetch=async url=>url.includes('hyperliquid')?response({BTC:'81000'}):url.includes('2026-09-06')?response(text('2026-09-06'),true):response('incomplete',true);
 const result=await Client.refresh(Date.parse('2026-09-07T12:00:00Z'));
 assert.equal(result.data.date,'2026-09-06');assert.equal(result.data.btcPrice,80000);assert.equal(result.quote.price,81000);assert.equal(result.quote.live,true);
 }finally{global.fetch=old;}
});
test('failed mid quote falls back to a dated daily snapshot, excluding future dates',async()=>{
 const old=global.fetch;
 try{global.fetch=async url=>{if(url.includes('hyperliquid'))throw new Error('offline');if(url.endsWith('.json'))return response({'2026-09-06':79946,'2099-01-01':999999});return response('bad',true);};
 const result=await Client.refresh(Date.parse('2026-09-07T12:00:00Z'));assert.equal(result.data,null);assert.equal(result.quote.price,79946);assert.equal(result.quote.date,'2026-09-06');assert.equal(result.quote.live,false);
 }finally{global.fetch=old;}
});
test('report lacking BTC Price is accepted and priced from the live quote, flagged as such',async()=>{
 const old=global.fetch;
 try{const noPrice=text('2026-09-06').replace('BTC Price: $80,000\n','');
 global.fetch=async url=>url.includes('hyperliquid')?response({BTC:'81000'}):url.includes('2026-09-06')?response(noPrice,true):response('incomplete',true);
 const result=await Client.refresh(Date.parse('2026-09-07T12:00:00Z'));
 assert.equal(result.data.date,'2026-09-06');assert.equal(result.data.btcPrice,81000);assert.equal(result.data.btcPriceFromQuote,true);assert.equal(result.reportError,null);
 }finally{global.fetch=old;}
});
test('both source failures produce explicit errors instead of fabricated freshness',async()=>{
 const old=global.fetch;
 try{global.fetch=async()=>{throw new Error('network blocked');};const result=await Client.refresh();assert.equal(result.data,null);assert.equal(result.quote,null);assert.ok(result.reportError);assert.ok(result.quoteError);}
 finally{global.fetch=old;}
});
test('when Hyperliquid fails, CoinTH supplies the price before the daily close',async()=>{
 const old=global.fetch;
 try{global.fetch=async url=>{if(url.includes('hyperliquid'))throw new Error('blocked');if(url.includes('cointh.com'))return response({ok:true,asOf:'2026-11-24T07:13:00.823Z',updatedAt:'2026-11-24T07:13:00.823Z',data:{price:60410.5}});if(url.endsWith('.json'))return response({'2026-11-23':61003});return response('bad',true);};
 const q=await Client.quote(Date.parse('2026-11-24T08:00:00Z'));assert.equal(q.source,'CoinTH');assert.equal(q.price,60410.5);assert.equal(q.live,false);
 const stale=await Client.quote(Date.parse('2026-11-25T08:00:00Z'));assert.equal(stale.source,'Daily snapshot');assert.equal(stale.price,61003);
 }finally{global.fetch=old;}
});
test('a real report in the new upstream format refreshes on-chain data',async()=>{
 const old=global.fetch,fs=require('node:fs');const report=fs.readFileSync(require.resolve('./fixtures/mvrv_summary_2026-11-23.txt'),'utf8');
 try{global.fetch=async url=>url.includes('hyperliquid')?response({BTC:'61432.5'}):url.includes('mvrv_summary_2026-11-23')?response(report,true):response('404: Not Found',true);
 const r=await Client.refresh(Date.parse('2026-11-24T08:00:00Z'));assert.equal(r.data.date,'2026-11-23');assert.equal(r.reportError,null);assert.equal(r.quote.price,61432.5);
 }finally{global.fetch=old;}
});
