#!/usr/bin/env node
/* Use the same dependency-free engine and report formatter as the UI. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const M=require('../assets/engine.js');
const Market=require('../assets/data-client.js');
const Report=require('../assets/report.js');
const root=path.resolve(__dirname,'..');
async function main(){
  const bundled={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/snapshot.js'),'utf8'),bundled);
  let data=bundled.window.BUNDLED_SNAPSHOT,quote=null,source='Bundled snapshot';
  const offline=process.argv.includes('--offline');
  if(!offline){
    const result=await Market.refresh();
    if(result.data){data=result.data;source='GitHub report';}
    quote=result.quote;
    // Do not replace a valid scheduled report with stale fallback figures.
    if(!result.data||!result.quote)throw new Error('Market refresh incomplete. Existing position-analysis.txt was preserved.');
  }
  const input={...M.DEFAULTS,...M.SAVED_POSITION,price:quote?.price||data.btcPrice};
  const text=Report.build({input,data,weights:M.WEIGHTS,quote,source});
  const dir=path.join(root,'data');fs.mkdirSync(dir,{recursive:true});
  const out=path.join(dir,offline?'position-analysis-offline.txt':'position-analysis.txt');
  const temp=out+'.tmp';fs.writeFileSync(temp,text,'utf8');fs.renameSync(temp,out);
  console.log('Wrote '+path.relative(root,out)+' using '+source+' from '+data.date+'.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
