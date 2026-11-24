#!/usr/bin/env node
/* Scheduled/offline report using the same engine and formatter as the UI.
 *
 * Your position is read, in order, from:
 *   1. the POSITION_JSON environment variable (set it as a GitHub Actions secret), or
 *   2. position.local.json in the repo root (git-ignored), or
 *   3. the public example in assets/user-config.js (only with --example).
 * The report is written to data/position-analysis*.txt, which is git-ignored: it is never committed.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const M=require('../assets/engine.js');
const Market=require('../assets/data-client.js');
const Report=require('../assets/report.js');
const root=path.resolve(__dirname,'..');
function loadPosition(){
  if(process.env.POSITION_JSON)return {position:JSON.parse(process.env.POSITION_JSON),from:'POSITION_JSON'};
  const local=path.join(root,'position.local.json');
  if(fs.existsSync(local))return {position:JSON.parse(fs.readFileSync(local,'utf8')),from:'position.local.json'};
  if(process.argv.includes('--example'))return {position:M.SAVED_POSITION,from:'public example'};
  throw new Error('No position found. Set POSITION_JSON, create position.local.json, or pass --example.');
}
async function main(){
  const {position,from}=loadPosition();
  const bundled={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/snapshot.js'),'utf8'),bundled);
  let data=bundled.window.BUNDLED_SNAPSHOT,quote=null,source='Bundled snapshot';
  const offline=process.argv.includes('--offline');
  if(!offline){
    const result=await Market.refresh();
    if(!result.data||!result.quote)throw new Error('Market refresh incomplete; no report written.');
    data=result.data;quote=result.quote;source='GitHub report';
  }
  const input={...M.DEFAULTS,...position,price:quote?.price||data.btcPrice};
  const v=M.validate(input);
  if(!v.valid)throw new Error('Position is invalid: '+Object.values(v.errors).join(' '));
  const text=Report.build({input,data,weights:M.WEIGHTS,quote,source});
  const dir=path.join(root,'data');fs.mkdirSync(dir,{recursive:true});
  const out=path.join(dir,offline?'position-analysis-offline.txt':'position-analysis.txt');
  const temp=out+'.tmp';fs.writeFileSync(temp,text,'utf8');fs.renameSync(temp,out);
  console.log(`Wrote ${path.relative(root,out)} from ${from}, using ${source} (${data.date}).`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
