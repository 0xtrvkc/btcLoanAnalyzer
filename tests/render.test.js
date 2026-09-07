/* Render-logic smoke tests against source IDs; these do not replace browser QA. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../assets/engine.js');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const code=fs.readFileSync(require.resolve('../assets/app.js'),'utf8').split("\n$('inp-price').value=D.btcPrice;")[0];
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/snapshot.js'),'utf8'),scope);
function harness(width,storageThrows=false){
 const nodes=new Map();
 for(const m of html.matchAll(/<([a-z0-9]+)\b([^>]*\bid="[^\"]+"[^>]*)>/gi)){
   const attrs=Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^\"]*)"/g)].map(a=>[a[1],a[2]]));
   const n={attrs,tag:m[1],value:attrs.value??(m[1]==='select'?'pnl':''),dataset:{},clientWidth:width,textContent:'',innerHTML:'',style:{},hidden:false,classList:{toggle(){},add(){},remove(){}},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},focus(){}};
   for(const[k,v]of Object.entries(attrs))if(k.startsWith('data-'))n.dataset[k.slice(5)]=v;
   nodes.set(attrs.id,n);
 }
 const query=selector=>[...nodes.values()].filter(n=>selector==='[data-field]'?n.dataset.field:selector==='[data-target]'?n.dataset.target:selector==='[role=tab]'?n.attrs.role==='tab':selector==='[role=tabpanel]'?n.attrs.role==='tabpanel':false);
 const context={window:{LoanEngine:M,BUNDLED_SNAPSHOT:scope.window.BUNDLED_SNAPSHOT},document:{getElementById:id=>nodes.get(id),querySelectorAll:query},localStorage:{getItem(){if(storageThrows)throw new Error('blocked');return null;},setItem(){if(storageThrows)throw new Error('blocked');}},console,setTimeout,clearTimeout,URL,Blob};
 vm.createContext(context);vm.runInContext(code,context);return {context,nodes,run:s=>vm.runInContext(s,context)};
}
test('all five views render finite chart geometry and values at narrow and wide widths',()=>{
 for(const width of [320,600,1000]){
  const app=harness(width);app.run('render()');
  for(const view of ['overview','scenarios','risk','signals','futures'])app.run(`switchView('${view}')`);
  for(const id of ['payoff-chart','ladder-chart','comparison-rows','risk-mechanics','signal-cards']){
    const output=app.nodes.get(id).innerHTML;assert.ok(output.length>100,id);assert.doesNotMatch(output,/NaN|Infinity|undefined/,id);
  }
  assert.equal(app.nodes.get('kpi-loan').textContent,'$31,978');
 }
});
test('invalid input freezes visible calculations and prevents export',()=>{
 const app=harness(600);app.run('render()');const before=app.nodes.get('kpi-loan').textContent;
 app.nodes.get('inp-mc').value='';app.run('render()');
 assert.equal(app.nodes.get('kpi-loan').textContent,before);assert.equal(app.nodes.get('export-btn').disabled,true);assert.equal(app.nodes.get('validation-banner').hidden,false);
 app.nodes.get('inp-mc').value='85';app.run('render()');assert.equal(app.nodes.get('export-btn').disabled,false);
});
test('storage restrictions do not block the initial calculation or views',()=>{
 const app=harness(320,true);app.run('render()');app.run("switchView('signals')");assert.ok(app.nodes.get('signal-cards').innerHTML.includes('MVRV'));
});
test('liquidated targets and zero-deployment futures render explicit states',()=>{
 const app=harness(600);app.nodes.get('inp-target').value='1000';app.run('render()');assert.equal(app.nodes.get('target-pnl').textContent,'Unavailable');
 app.nodes.get('inp-deploy').value='0';app.run('render()');app.run("switchView('futures')");assert.match(app.nodes.get('comparison-rows').innerHTML,/No position/);assert.doesNotMatch(app.nodes.get('comparison-rows').innerHTML,/NaN|Infinity/);
});

test('iii restores the original fixed preset and both pots modes render',()=>{
 const app=harness(600);app.run('render()');app.run('runHiddenCommand()');
 assert.equal(Number(app.nodes.get('inp-btc').value),.035);assert.equal(Number(app.nodes.get('inp-ltv').value),36);assert.equal(Number(app.nodes.get('inp-apr').value),6);assert.equal(Number(app.nodes.get('inp-target').value),158844);
 app.run('dismissPresetNotice()');app.run("setTwoPotsMode('quant')");assert.equal(app.nodes.get('pots-simple').hidden,true);assert.equal(app.nodes.get('pots-quant').hidden,false);assert.match(app.nodes.get('pots-quant-rows').innerHTML,/Unused loan cash/);
});
