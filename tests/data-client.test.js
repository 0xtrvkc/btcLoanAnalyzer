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
test('both source failures produce explicit errors instead of fabricated freshness',async()=>{
 const old=global.fetch;
 try{global.fetch=async()=>{throw new Error('network blocked');};const result=await Client.refresh();assert.equal(result.data,null);assert.equal(result.quote,null);assert.ok(result.reportError);assert.ok(result.quoteError);}
 finally{global.fetch=old;}
});
