/* Render-logic smoke tests against the real index.html IDs and app.js, in a minimal fake DOM.
   Browser layout is checked separately; these catch NaN, missing nodes and wrong labels. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../assets/engine.js');
const NOW=Date.parse('2026-11-23T08:48:25Z');
const engine={...M,today:(n=NOW)=>M.today(n),validate:i=>M.validate(i,NOW),calculate:(i,d,w)=>M.calculate(i,d,w,NOW)};
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const code=fs.readFileSync(require.resolve('../assets/app.js'),'utf8').split('/* ---------- wiring ---------- */')[0];
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/snapshot.js'),'utf8'),scope);
const real={mode:'existing',btc:0.03565762,loanPrincipal:1000,loanDate:'2026-09-27',deployPrice:84900.86,entry:84900.86,deploy:100,apr:5,target:169801.72,exitDate:'2027-11-23',price:61487.5};
function harness(width=900,storageThrows=false){
 const nodes=new Map();
 for(const m of html.matchAll(/<([a-z0-9]+)\b([^>]*\bid="[^"]+"[^>]*)>/gi)){
  const attrs=Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]));
  const n={attrs,tag:m[1],value:attrs.value??(m[1]==='select'?'pnlStart':''),placeholder:attrs.placeholder||'',dataset:{},clientWidth:width,textContent:'',innerHTML:'',style:{},hidden:'hidden' in attrs,disabled:false,
   classList:{set:new Set(),toggle(c,on){on?this.set.add(c):this.set.delete(c);},add(c){this.set.add(c);},remove(c){this.set.delete(c);}},
   setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k];},focus(){},closest(){return null;}};
  for(const[k,v]of Object.entries(attrs))if(k.startsWith('data-'))n.dataset[k.slice(5).replace(/-(\w)/g,(_,c)=>c.toUpperCase())]=v;
  nodes.set(attrs.id,n);
 }
 const query=sel=>{const all=[...nodes.values()];const m=sel.match(/^\[(data-[\w-]+|role)(?:=(\w+))?\]$/);if(!m)return [];return all.filter(n=>m[2]?n.attrs[m[1]]===m[2]:m[1] in n.attrs);};
 const store=new Map();
 const context={window:{LoanEngine:engine,BUNDLED_SNAPSHOT:scope.window.BUNDLED_SNAPSHOT},document:{getElementById:id=>nodes.get(id),querySelectorAll:query,querySelector:s=>query(s)[0]},
  localStorage:{getItem(k){if(storageThrows)throw new Error('blocked');return store.has(k)?store.get(k):null;},setItem(k,v){if(storageThrows)throw new Error('blocked');store.set(k,v);}},
  console,setTimeout,clearTimeout,URL,Blob,requestAnimationFrame:f=>setTimeout(f,0),cancelAnimationFrame:clearTimeout};
 vm.createContext(context);vm.runInContext(code,context);
 const run=s=>vm.runInContext(s,context),text=id=>nodes.get(id).textContent,inner=id=>nodes.get(id).innerHTML;
 return {nodes,run,text,inner,store};
}
const VIEWS=['overview','scenarios','risk','signals','futures'];
const CHECK=['verdict-text','target-pnl','repay-flow','repay-rows','checkpoints','payoff-chart','ladder-rows','ladder-chart','decomposition','risk-mechanics','margin-response','stress-rows','signal-cards','comparison-rows','futures-insight'];
function assertClean(app,label){for(const id of CHECK){const out=app.inner(id)||app.text(id);assert.doesNotMatch(out,/NaN|Infinity|undefined/,label+' '+id);}}

test('new and existing modes render every view without NaN at narrow and wide widths',()=>{
 for(const width of [320,900,1400]){
  const app=harness(width);app.run('render()');
  for(const v of VIEWS)app.run(`switchView('${v}')`);assertClean(app,'new '+width);
  assert.equal(app.text('plan-status'),'New loan plan');
  app.run(`applyInput(${JSON.stringify(real)},{keepPrice:false})`);
  for(const v of VIEWS)app.run(`switchView('${v}')`);assertClean(app,'existing '+width);
  assert.match(app.text('plan-status'),/Existing loan · day 57/);
 }
});
test('B1/A1: existing loan shows its real starting LTV and debt today',()=>{
 const app=harness();app.run(`applyInput(${JSON.stringify(real)},{keepPrice:false})`);
 assert.equal(app.text('kpi-debt'),'$1,007.81');assert.match(app.text('kpi-ltv-sub'),/Started at 33\.0%/);
 assert.equal(app.text('kpi-liq'),'$31,404');
});
test('repay switch: now uses today’s price and debt, target uses the exit-date debt',()=>{
 const app=harness();app.run(`applyInput(${JSON.stringify(real)},{keepPrice:false})`);app.run("setRepay('now')");
 assert.match(app.text('repay-sub'),/today’s \$61,488, paying \$1,007\.81/);assert.equal(app.text('repay-badge'),'Behind holding');
 app.run("setRepay('exit')");assert.match(app.text('repay-sub'),/\$169,802 target on 23 Nov 2027/);assert.equal(app.text('repay-badge'),'Ahead of holding');
 assert.match(app.inner('repay-flow'),/Final wallet/);assert.match(app.inner('repay-rows'),/Paid from unused loan cash/);
});
test('basis switch changes the headline from since-borrowing to from-today',()=>{
 const app=harness();app.run(`applyInput(${JSON.stringify(real)},{keepPrice:false})`);
 const since=app.text('target-pnl');app.run("setBasis('today')");
 assert.notEqual(app.text('target-pnl'),since);assert.match(app.text('target-pnl-label'),/from today/);
});
test('invalid input freezes results, blocks export, and points to the field',()=>{
 const app=harness();app.run('render()');const before=app.text('kpi-debt');
 app.nodes.get('inp-mc').value='';app.run('render()');
 assert.equal(app.text('kpi-debt'),before);assert.equal(app.nodes.get('export-btn').disabled,true);assert.equal(app.nodes.get('validation-banner').hidden,false);
 assert.equal(app.run('firstErrorKey'),'mc');
 app.nodes.get('inp-mc').value='85';app.run('render()');assert.equal(app.nodes.get('export-btn').disabled,false);
});
test('existing loan without a purchase price is rejected instead of drifting with the market',()=>{
 const app=harness();app.run(`applyInput(${JSON.stringify({...real,deployPrice:''})},{keepPrice:false})`);
 assert.equal(app.nodes.get('validation-banner').hidden,false);assert.match(app.text('error-deployPrice'),/required/);
});
test('liquidated target and zero-deployment futures render explicit states',()=>{
 const app=harness();app.nodes.get('inp-target').value='1000';app.run('render()');assert.equal(app.text('target-pnl'),'Unavailable');
 app.nodes.get('inp-deploy').value='0';app.run('render()');app.run("switchView('futures')");assert.match(app.inner('comparison-rows'),/No position/);assertClean(app,'zero deploy');
});
test('save, load and undo round-trip through device storage without storing the price',()=>{
 const app=harness();app.run(`applyInput(${JSON.stringify(real)},{keepPrice:false})`);app.run('savePosition()');
 const saved=JSON.parse(app.store.get('btc_loan_position_v3'));assert.equal(Number(saved.loanPrincipal),1000);assert.equal('price' in saved,false);
 app.run("applyInput(M.SAVED_POSITION,{undo:true,message:'x'})");assert.equal(app.nodes.get('inp-loanPrincipal').value,15000);
 app.run('applyInput(undoInputs)');assert.equal(Number(app.nodes.get('inp-loanPrincipal').value),1000);
});
test('legacy v2 saved positions migrate to existing-loan mode',()=>{
 const app=harness();app.store.set('btc_terminal_position_v2',JSON.stringify({btc:0.5,price:1,loanPrincipal:20000,loanDate:'2026-01-01',deployPrice:90000,deploy:100,apr:5,ltv:40,mc:85,liq:90,vol:65,entry:0,target:150000,leverage:5,mm:0.5,funding:10}));
 assert.equal(app.run('loadSaved({silent:true})'),true);assert.equal(app.run('mode'),'existing');assert.equal(app.nodes.get('validation-banner').hidden,true);
});
test('blocked storage does not stop the first render',()=>{
 const app=harness(320,true);app.run('render()');app.run("switchView('signals')");assert.match(app.inner('signal-cards'),/MVRV/);
});
