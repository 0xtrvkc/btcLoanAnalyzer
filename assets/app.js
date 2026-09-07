/* Interface orchestration. Calculation and data parsing live in the shared engine. */
'use strict';
const M=window.LoanEngine, $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,dp=0)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp}):'—';
const usd=(n,dp=0)=>Number.isFinite(n)?(n<0?'−':'')+'$'+fmt(Math.abs(n),dp):'—';
const signed=n=>Number.isFinite(n)?(n>0?'+':'')+usd(n):'—';
const pct=(n,dp=1)=>Number.isFinite(n)?fmt(n,dp)+'%':'—';
const signedPct=n=>Number.isFinite(n)?(n>0?'+':'')+pct(n):'—';
const compact=n=>Math.abs(n)>=1e6?(n<0?'−':'')+'$'+fmt(Math.abs(n)/1e6,1)+'m':Math.abs(n)>=1000?(n<0?'−':'')+'$'+fmt(Math.abs(n)/1000,0)+'k':usd(n);
const tone=n=>n>0?'good':n<0?'bad':'muted';
const set=(id,text)=>{const node=$(id);if(node&&node.textContent!==String(text))node.textContent=text;};
const badge=(label,kind='')=>`<span class="badge ${kind}">${escapeHTML(label)}</span>`;
const row=(label,value,cls='')=>`<div class="key-row ${cls}"><span>${escapeHTML(label)}</span><strong>${value}</strong></div>`;
const STORAGE={position:'btc_terminal_position_v2',data:'btc_terminal_data_v2',history:'btc_loan_snapshots_v2',weights:'btc_terminal_weights_v2'};
function getStored(key,fallback){try{const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw);}catch{return fallback;}}
function putStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function validData(x){return x&&M.dateValid(x.date)&&['mvrv','zscore','btcPrice','histMeanMvrv','cyclePos','ceilPrice','floorPrice','roc30'].every(k=>Number.isFinite(x[k]))&&['mvrv','btcPrice','histMeanMvrv','ceilPrice','floorPrice'].every(k=>x[k]>0)&&x.cyclePos>=0&&x.cyclePos<=100&&typeof x.maStack==='string';}
let D=window.BUNDLED_SNAPSHOT;
const cached=getStored(STORAGE.data,null);
let dataSource='Bundled snapshot';
if(validData(cached)&&cached.date>=D.date){D=cached;dataSource='Cached report';}
let quote={price:D.btcPrice,date:D.date,source:'Report snapshot',live:false,fetchedAt:null};
let history=getStored(STORAGE.history,[]);
if(!Array.isArray(history))history=[];
history=history.filter(h=>h&&M.dateValid(h.date)&&['mvrv','zscore','btcPrice'].every(k=>Number.isFinite(h[k]))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14);
let rawWeights=getStored(STORAGE.weights,{...M.WEIGHTS});
if(!rawWeights||typeof rawWeights!=='object'||Array.isArray(rawWeights))rawWeights={...M.WEIGHTS};
for(const k of Object.keys(M.WEIGHTS)){const n=Number(rawWeights[k]);rawWeights[k]=Number.isFinite(n)?M.clamp(n,0,100):M.WEIGHTS[k];}
let currentView='overview',currentResult=null,validInput=null,refreshRunning=false,priceEdited=false,editRevision=0,quoteError=null,reportError=null,renderFrame=null,toastTimer=null;
let chartScale=null,chartPrice=null,chartAnimate=true;
const fields=[...document.querySelectorAll('[data-field]')];
function readInputs(){return Object.fromEntries(fields.map(n=>[n.dataset.field,n.value]));}
function weights(){return {...rawWeights};}
function calc(){return M.calculate(readInputs(),D,weights());}
function calcFutures(d){return M.futures(d);}
function toast(message){set('toast',message);$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function applyInput(input,{markPrice=true}={}){for(const [key,value]of Object.entries(input)){const node=$('inp-'+key);if(node&&value!=null)node.value=value===0&&(key==='entry'||key==='deployPrice')?'':value;}if(markPrice&&Object.hasOwn(input,'price'))priceEdited=true;editRevision++;render();}
function saveHistory(data){history=history.filter(h=>h.date!==data.date);history.push({date:data.date,mvrv:data.mvrv,zscore:data.zscore,btcPrice:data.btcPrice});history.sort((a,b)=>b.date.localeCompare(a.date));history=history.slice(0,14);putStored(STORAGE.history,history);}
function dateLabel(s){return M.dateValid(s)?new Date(s+'T00:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Unavailable';}
function updateMarket(){
  set('market-price',usd(quote.price));set('ticker-mvrv',fmt(D.mvrv,3));set('ticker-zscore',fmt(D.zscore,3));
  $('ticker-zscore').className='ticker-val '+(D.zscore<0?'good':'');
  set('ticker-trend',/bull/i.test(D.maStack)?'Bullish':/bear/i.test(D.maStack)?'Bearish':'Mixed');
  $('ticker-trend').className='ticker-val '+(/bull/i.test(D.maStack)?'good':'amber');
  set('ticker-cycle',pct(D.cyclePos));set('data-date',dateLabel(D.date));
  const quoteAge=quote.fetchedAt?(Date.now()-Date.parse(quote.fetchedAt))/6e4:Infinity;
  set('quote-source',quote.live?(quoteAge<5?'MID · ':'CACHED · ')+new Date(quote.fetchedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':quote.source);
  const notes=[];
  if(M.ageHours(D.date)>48)notes.push(`On-chain data is stale (${dateLabel(D.date)}).`);
  else if(dataSource==='Bundled snapshot'||dataSource==='Cached report')notes.push(`${dataSource} · ${dateLabel(D.date)}.`);
  if(reportError)notes.push('On-chain refresh unavailable; previous valid report retained.');
  if(quoteError)notes.push('Quote unavailable; previous price retained.');
  else if(!quote.live)notes.push(`BTC quote uses ${quote.date} report data.`);
  else if(quoteAge>=5)notes.push('Market quote is over five minutes old. Refresh to update.');
  $('data-notice').hidden=!notes.length;set('data-notice-text',notes.join(' '));
  set('data-provenance',`${dataSource} · on-chain ${dateLabel(D.date)} · quote ${quote.source}, ${quote.date}${quote.fetchedAt?' at '+new Date(quote.fetchedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':''}`);
}
function validateAndRead(){
  const validation=M.validate(readInputs());
  fields.forEach(node=>{const message=validation.errors[node.dataset.field]||'';node.setAttribute('aria-invalid',String(Boolean(message)));set('error-'+node.dataset.field,message);});
  $('validation-banner').hidden=validation.valid;
  $('workspace').classList.toggle('invalid-results',!validation.valid);
  if(!validation.valid){
    const message=Object.values(validation.errors)[0];set('validation-message',`${message} Results show the last valid inputs; export and save are paused.`);
    set('update-status','Check inputs');$('export-btn').disabled=true;$('save-position').disabled=true;
    if(Object.keys(validation.errors).some(k=>['leverage','mm','funding'].includes(k))&&currentView!=='futures')switchView('futures',false);
    return null;
  }
  $('export-btn').disabled=false;$('save-position').disabled=false;
  return validation.value;
}
function render(){
  const input=validateAndRead();if(!input)return;
  validInput=input;const d=M.calculate(input,D,weights());currentResult=d;
  const ltvMax=Math.max(0,Math.ceil(d.mcLtv*100)-1);$('ltv-range').max=ltvMax;$('ltv-range').value=d.ltvPct;set('ltv-max-label',ltvMax+'%');
  set('horizon-label',`${fmt(d.months)} month horizon · USD`);
  set('kpi-loan',usd(d.loan));set('kpi-loan-sub',`${pct(d.ltvPct,0)} initial LTV`);
  set('kpi-collateral',usd(d.collateral));set('kpi-collateral-sub',`${fmt(d.btc,Math.max(3,d.btc<0.001?8:3))} BTC pledged`);
  set('kpi-liq',d.loan?usd(d.liqPrice):'No debt');set('kpi-liq-sub',d.loan?`${pct(-d.liqDropPct)} drop from reference`:'No liquidation threshold');
  set('kpi-cost',usd(d.interestCost));set('kpi-cost-sub',`${pct(d.apr*100)} APR · ${fmt(d.months)} months`);
  document.querySelectorAll('[data-target]').forEach(button=>{const match=targetFor(button.dataset.target,d);button.setAttribute('aria-pressed',String(match>0&&Math.abs(d.targetPrice-Math.round(match))<1));});
  renderOverview(d);renderActive(d);
  set('update-status',refreshRunning?'Refreshing data…':'Inputs applied');
  window.__terminalReady=true;
}
function scheduleRender(){if(renderFrame!==null)cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>{renderFrame=null;render();});}
function renderOverview(d){
  const liquidated=d.targetStatus==='Liquidation',profit=d.netProfit;
  set('target-pnl',liquidated?'Unavailable':signed(profit));$('target-pnl').className='chart-result num '+(liquidated?'bad':tone(profit));
  set('target-return',liquidated?'Target crosses the liquidation threshold':`${signedPct(d.levReturnPct)} return on collateral`);
  set('target-value',usd(d.targetPrice));set('target-status',d.targetStatus.toUpperCase());
  $('target-status').className='badge '+(liquidated?'bad':d.targetStatus==='Margin call'?'amber':'good');
  set('overview-breakeven',usd(d.breakevenPrice));set('overview-edge',liquidated?'—':signed(d.leverageEdge));
  $('overview-edge').className='num '+(liquidated?'muted':tone(d.leverageEdge));
  set('score-number',fmt(d.score,1));set('score-date',D.date);
  const stale=M.ageHours(D.date)>48;set('score-badge',stale?'STALE MODEL':'HEURISTIC');
  set('score-title',d.score>=7?'Supportive cycle signals':d.score>=5?'Mixed cycle signals':'Cautious cycle signals');
  const delta=(D.mvrv/D.histMeanMvrv-1)*100;
  set('score-context',`MVRV sits ${pct(Math.abs(delta),0)} ${delta<0?'below':'above'} its historical mean. This score measures cycle context, not loan safety.`);
  $('score-track').innerHTML=Array.from({length:10},(_,i)=>`<i class="score-seg ${i<Math.round(d.score)?'on':''}"></i>`).join('');
  $('allocation-fill').style.width=d.deployPct*100+'%';
  set('allocation-deployed',usd(d.deployedUsd));set('allocation-cash',usd(d.undeployedUsd));set('allocation-btc','+'+fmt(d.newBtc,5));set('allocation-total',fmt(d.totalBtc,5)+' BTC');
  set('level-liq',d.loan?usd(d.liqPriceH):'No debt');set('level-liq-sub',d.loan?`${signedPct((d.liqPriceH/d.price-1)*100)} from reference`:'No liquidation');
  set('level-mc',d.loan?usd(d.mcPriceH):'No debt');set('level-mc-sub',d.loan?`${signedPct((d.mcPriceH/d.price-1)*100)} from reference`:'No margin call');
  set('level-floor',usd(D.floorPrice));set('level-ceiling',usd(D.ceilPrice));
  const title=liquidated?'Target crosses liquidation':d.mcPriceH>=d.price?'Interest pushes the horizon into margin call':d.leverageEdge>=0?'Added exposure improves this target outcome':'Borrowing reduces this target outcome';
  set('overview-insight-title',title);
  set('overview-insight',liquidated?`At ${usd(d.targetPrice)}, the model reaches your ${pct(d.liqLtv*100,0)} liquidation LTV. Open-position P/L is unavailable; sale execution, fees, and any residual balance determine the outcome.`:`At ${usd(d.targetPrice)}, the loan strategy produces ${signed(d.netProfit)} after ${usd(d.interestCost)} of interest, versus ${signed(d.unlevProfit)} from holding ${fmt(d.btc,3)} BTC. The extra ${fmt(d.newBtc,5)} BTC also increases downside exposure. Results require the position to survive the path to target.`);
  renderTwoPots(d);
  if(currentView==='overview')renderPayoff(d);
}
function renderTwoPots(d){
  const p=M.twoPots(d),btc=n=>fmt(n,6)+' BTC';
  $('pots-warning').hidden=p.available;
  set('pots-warning','The reference price falls in the horizon liquidation zone. Repayment and wallet totals are unavailable.');
  $('pot-original-details').innerHTML=row('Original collateral',btc(d.btc))+row('Sell to repay debt',btc(p.debtBtc))+row('Principal + interest',usd(d.debtOwed));
  set('pot-original-btc',p.available?btc(p.residualBtc):'Unavailable');set('pot-original-value',p.available?usd(p.residualValue):'Liquidation threshold crossed');
  set('pot-new-btc',btc(d.newBtc));set('pot-new-value',usd(p.newValue)+' at reference price');
  set('pots-total-btc',p.available?btc(p.walletBtc):'Unavailable');set('pots-total-note',p.available?usd(p.walletBtc*d.price)+' in BTC after repayment':'Liquidation settlement is not modeled.');
  set('pots-cash',usd(p.cash));set('pots-net-value',p.available?'BTC + cash = '+usd(p.netAssets):'Net assets unavailable');
  $('pots-quant-rows').innerHTML=row('Reference BTC price',usd(d.price))+row('Pledged BTC',btc(d.btc))+row('Principal + horizon interest',usd(d.debtOwed))+row('Debt in BTC at reference',btc(p.debtBtc))+row('Residual collateral BTC',p.available?btc(p.residualBtc):'Unavailable','total')+row('Loan-funded BTC',btc(d.newBtc))+row('BTC after repayment',p.available?btc(p.walletBtc):'Unavailable','total')+row('Unused loan cash',usd(p.cash))+row('Net assets, BTC + cash',p.available?usd(p.netAssets):'Unavailable');
}
function setTwoPotsMode(mode){
  if(!['simple','quant'].includes(mode))return;
  $('pots-simple').hidden=mode!=='simple';$('pots-quant').hidden=mode!=='quant';
  $('pots-simple-btn').setAttribute('aria-pressed',String(mode==='simple'));
  $('pots-quant-btn').setAttribute('aria-pressed',String(mode==='quant'));
}
function renderActive(d){if(currentView==='scenarios')renderScenarios(d);if(currentView==='risk')renderRisk(d);if(currentView==='signals')renderSignals(d);if(currentView==='futures')renderFutures(d);}
function domain(d){const points=[d.price,d.targetPrice,d.breakevenPrice,D.floorPrice,D.ceilPrice,d.liqPriceH,d.mcPriceH].filter(n=>Number.isFinite(n)&&n>0);let min=Math.max(1,Math.min(d.price*.4,...points)*.8),max=Math.max(...points,d.price*1.3)*1.08;return [min,max];}
function renderPayoff(d){
  const node=$('payoff-chart');if(!node||currentView!=='overview')return;
  const width=Math.max(310,node.clientWidth||600),height=width<400?265:285,L=58,R=20,T=25,B=38,W=width-L-R,H=height-T-B;
  const [min,max]=domain(d),sMin=M.scenario(d,min),sMax=M.scenario(d,max);
  const vals=[sMin.pnl,sMax.pnl,sMin.hold,sMax.hold,0],yMin=Math.min(...vals),yMax=Math.max(...vals),pad=Math.max(1,(yMax-yMin)*.08);
  const lo=yMin-pad,hi=yMax+pad,x=p=>L+(p-min)/(max-min)*W,y=p=>T+(hi-p)/(hi-lo)*H;
  const grid=Array.from({length:5},(_,i)=>{const value=lo+(hi-lo)*i/4;return `<line class="gridline" x1="${L}" x2="${width-R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L-9}" y="${y(value)+4}" text-anchor="end">${compact(value)}</text>`;}).join('');
  const tickCount=width<450?4:5;
  const ticks=Array.from({length:tickCount},(_,i)=>{const value=min+(max-min)*i/(tickCount-1);return `<text x="${x(value)}" y="${height-12}" text-anchor="middle">${compact(value)}</text>`;}).join('');
  const liqX=x(M.clamp(d.liqPriceH,min,max)),mcX=x(M.clamp(d.mcPriceH,min,max));
  const solidMin=Math.max(min,d.liqPriceH),solidS=M.scenario(d,solidMin);
  const alive=solidMin<=max;
  const curve=alive?`M ${x(solidMin)} ${y(solidS.pnl)} L ${x(max)} ${y(sMax.pnl)}`:'';
  const region=alive?`M ${x(solidMin)} ${y(0)} L ${x(solidMin)} ${y(solidS.pnl)} L ${x(max)} ${y(sMax.pnl)} L ${x(max)} ${y(0)} Z`:'';
  const target=M.scenario(d,d.targetPrice),targetAlive=target.status!=='Liquidation';
  const animated=chartAnimate?'':' style="animation:none"';
  node.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Scenario payoff. Breakeven ${escapeHTML(usd(d.breakevenPrice))}. Loan payoff is unavailable below ${escapeHTML(usd(d.liqPriceH))} liquidation at the selected horizon."><defs><linearGradient id="payoff-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".13"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient><clipPath id="plot-clip"><rect x="${L}" y="${T}" width="${W}" height="${H}"/></clipPath></defs>${grid}${ticks}<g clip-path="url(#plot-clip)"><rect x="${L}" y="${T}" width="${Math.max(0,liqX-L)}" height="${H}" fill="var(--red)" opacity=".055"/><rect x="${liqX}" y="${T}" width="${Math.max(0,mcX-liqX)}" height="${H}" fill="var(--accent)" opacity=".06"/><line class="zero" x1="${L}" x2="${width-R}" y1="${y(0)}" y2="${y(0)}"/><path d="M ${x(min)} ${y(sMin.hold)} L ${x(max)} ${y(sMax.hold)}" class="hold-line"/><path d="${region}" fill="url(#payoff-fill)"/><path d="${curve}" class="curve"${animated}/><line x1="${x(d.breakevenPrice)}" x2="${x(d.breakevenPrice)}" y1="${T}" y2="${height-B}" stroke="var(--accent)" opacity=".28" stroke-dasharray="3 4"/><line x1="${x(d.targetPrice)}" x2="${x(d.targetPrice)}" y1="${T}" y2="${height-B}" stroke="var(--muted)" opacity=".4" stroke-dasharray="3 5"/>${targetAlive?`<circle cx="${x(d.targetPrice)}" cy="${y(target.pnl)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`:''}<line id="inspect-line" x1="0" x2="0" y1="${T}" y2="${height-B}" stroke="var(--cyan)" stroke-width="1" opacity="0"/><circle id="inspect-point" cx="0" cy="0" r="3" fill="var(--cyan)" opacity="0"/></g><text x="${L}" y="14">NET P/L · USD</text>${d.liqPriceH>min?`<text class="red" x="${L+6}" y="${T+17}" style="font-size:12px">LIQ.</text>`:''}</svg><div class="chart-tooltip" id="payoff-tooltip" hidden></div>`;
  chartScale={x,y,min,max,L,R,width,height};chartAnimate=false;
  $('chart-scrub').min=Math.ceil(min);$('chart-scrub').max=Math.floor(max);$('chart-scrub').step=Math.max(1,Math.round((max-min)/200));
  const inspect=chartPrice===null?d.targetPrice:M.clamp(chartPrice,min,max);$('chart-scrub').value=inspect;set('scrub-output',usd(inspect));
}
function inspectChart(price,pointerX=null){
  if(!chartScale||!currentResult)return;
  const d=currentResult,s=chartScale,p=M.clamp(price,s.min,s.max),out=M.scenario(d,p);chartPrice=p;
  $('chart-scrub').value=p;set('scrub-output',usd(p));
  const line=$('inspect-line'),point=$('inspect-point'),tip=$('payoff-tooltip');if(!line||!tip)return;
  line.setAttribute('x1',s.x(p));line.setAttribute('x2',s.x(p));line.setAttribute('opacity','.6');
  point.setAttribute('cx',s.x(p));point.setAttribute('cy',s.y(out.pnl));point.setAttribute('opacity',out.status==='Liquidation'?'0':'1');
  tip.innerHTML=`<span class="muted">BTC ${usd(p)}</span><strong class="${out.status==='Liquidation'?'bad':tone(out.pnl)}">${out.status==='Liquidation'?'Liquidation zone':signed(out.pnl)}</strong><span class="dim">LTV ${pct(out.ltv*100)} · ${out.status}</span>`;
  tip.hidden=false;tip.style.top='35px';tip.style.left=M.clamp((pointerX??s.x(p))+12,8,Math.max(8,s.width-205))+'px';
}
function hideInspect(){const tip=$('payoff-tooltip');if(tip)tip.hidden=true;for(const id of ['inspect-line','inspect-point'])$(id)?.setAttribute('opacity','0');}
function ladder(d){
  const anchors=[{price:d.liqPriceH,label:'Liquidation'},{price:d.mcPriceH,label:'Margin call'},{price:D.floorPrice,label:'Model floor'},{price:d.price,label:'Reference'},{price:d.targetPrice,label:'Target'},{price:d.breakevenPrice,label:'Breakeven'},{price:D.ceilPrice,label:'Model ceiling'},{price:D.c4Ath,label:'Cycle ATH'}];
  const values=[.4,.6,.8,1.2,1.5,2].map(v=>({price:d.price*v,label:''}));
  const sorted=[...values,...anchors].filter(r=>Number.isFinite(r.price)&&r.price>0).sort((a,b)=>a.price-b.price);
  const merged=[];
  for(const r of sorted){const prev=merged.at(-1);if(prev&&Math.abs(prev.price-r.price)<.01){prev.labels.push(r.label);if(r.label)prev.price=r.price;}else merged.push({price:r.price,labels:[r.label]});}
  return merged.map(r=>({...M.scenario(d,r.price),labels:r.labels.filter(Boolean)}));
}
function renderScenarios(d){
  const basis=$('pnl-basis').value,rows=ladder(d),hasCost=d.entry>0;
  set('ladder-pnl-label',basis==='pnl'?'Net P/L':basis==='borrowed'?'Borrowed P/L':'Cost basis P/L');
  $('ladder-rows').innerHTML=rows.map(s=>{const dead=s.status==='Liquidation',value=s[basis];return `<tr class="${s.labels.includes('Target')?'target-row':''}"><td><span class="row-price">${usd(s.price)}</span>${s.labels.length?`<span class="row-label">${escapeHTML(s.labels.join(' · '))}</span>`:''}</td><td>${signedPct(s.change)}</td><td class="${dead?'bad':s.status==='Margin call'?'amber':''}">${pct(s.ltv*100)}</td><td>${badge(s.status,dead?'bad':s.status==='Margin call'?'amber':'')}</td><td>${dead?'—':usd(s.equity)}</td><td class="${dead?'muted':tone(value)}">${dead?'—':signed(value)}</td></tr>`;}).join('');
  set('ladder-note',basis==='cost'&&!hasCost?'Set your original BTC cost basis in Risk & cost basis to see this view. Loan-funded BTC uses its deployment price.':`All values include ${usd(d.interestCost)} of interest over ${fmt(d.months)} months. ${basis==='borrowed'?'Borrowed P/L isolates loan-funded BTC and subtracts the full loan interest.':basis==='cost'?'Cost-basis P/L uses each BTC holding’s actual purchase price.':'Net P/L is measured against the original collateral’s reference value.'} Values below liquidation are unavailable; an earlier barrier crossing can also invalidate a higher exit price.`);
  const dead=d.targetStatus==='Liquidation';
  $('decomposition').innerHTML=row('Original BTC at target',usd(d.btc*d.targetPrice))+row('Loan-funded BTC at target',usd(d.newBtc*d.targetPrice))+row('Undeployed loan cash',usd(d.undeployedUsd))+row('Principal + interest','−'+usd(d.debtOwed))+row('Net equity at target',dead?'Unavailable':usd(d.equity),'total')+row('Initial collateral value',usd(d.collateral))+row('Net P/L',dead?'Unavailable':signed(d.netProfit),'total')+`<p class="hint" style="margin-top:12px">${dead?'Liquidation threshold crossed. Net values require an execution and residual-balance model.':'Cash and loan-funded BTC are matched by debt. Borrowing itself creates no profit.'}</p>`;
  renderLadderChart(d,rows,basis);
}
function renderLadderChart(d,rows,basis){
  const node=$('ladder-chart'),width=Math.max(310,node.clientWidth||800),height=285,L=57,R=46,T=30,B=43,W=width-L-R,H=height-T-B;
  const values=rows.filter(r=>r.status!=='Liquidation').map(r=>r[basis]).filter(Number.isFinite),max=Math.max(1,...values.map(Math.abs))*1.15;
  const y=v=>T+H/2-v/max*H/2,x=i=>L+(i+.5)*W/rows.length,bw=Math.min(35,W/rows.length*.53);
  const ltvMax=Math.max(100,...rows.map(r=>r.ltv*100))*1.1,ly=v=>T+H-v/ltvMax*H;
  const grid=[-1,-.5,0,.5,1].map(k=>`<line class="gridline" x1="${L}" x2="${width-R}" y1="${y(max*k)}" y2="${y(max*k)}"/><text x="${L-8}" y="${y(max*k)+4}" text-anchor="end">${compact(max*k)}</text>`).join('');
  const bars=rows.map((r,i)=>{const dead=r.status==='Liquidation',v=r[basis],nullValue=!Number.isFinite(v);return `<g><title>${escapeHTML(usd(r.price)+' · '+r.status+' · '+(dead?'P/L unavailable':signed(v))+' · LTV '+pct(r.ltv*100))}</title>${dead?`<rect x="${x(i)-bw/2}" y="${T}" width="${bw}" height="${H}" fill="var(--red)" opacity=".06"/>`:nullValue?'':`<rect x="${x(i)-bw/2}" y="${Math.min(y(0),y(v))}" width="${bw}" height="${Math.max(1,Math.abs(y(v)-y(0)))}" fill="${v>=0?'var(--green)':'var(--red)'}" opacity=".7" rx="1"/>`}${i%Math.ceil(rows.length/(width<450?4:7))===0?`<text x="${x(i)}" y="${height-15}" text-anchor="middle">${compact(r.price)}</text>`:''}</g>`;}).join('');
  const line=rows.map((r,i)=>(i?'L':'M')+' '+x(i)+' '+ly(r.ltv*100)).join(' ');
  const ltvTicks=[0,.5,1].map(v=>`<text x="${width-R+8}" y="${ly(ltvMax*v)+4}" text-anchor="start">${fmt(ltvMax*v)}%</text>`).join('');
  node.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Price ladder. Bars show selected P/L basis; line shows horizon LTV. Exact values are available in the table below.">${grid}${bars}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${ly(r.ltv*100)}" r="2.3" fill="${r.status==='Liquidation'?'var(--red)':'var(--accent)'}"/>`).join('')}${ltvTicks}<text x="${L}" y="15">P/L · USD</text><text class="accent" x="${width-R}" y="15" text-anchor="end">LTV · %</text></svg>`;
}
function renderRisk(d){
  set('risk-buffer',d.loan?pct(d.bufferPct):'No debt');set('risk-buffer-note',d.loan?`${usd(d.buffer)} price buffer before ${usd(d.mcPrice)} margin call.`:'No margin call or liquidation threshold.');
  set('risk-probability',d.pLiq90>0&&d.pLiq90<.0001?'<0.01%':pct(d.pLiq90*100,2));$('risk-probability').className='big-metric '+(d.pLiq90<.05?'good':d.pLiq90<.15?'amber':'bad');
  set('risk-rr',Number.isFinite(d.rrRatio)?fmt(d.rrRatio,2)+' : 1':d.entry>0?'Undefined':'Set cost basis');
  set('risk-kelly',pct(d.kellyLtv*100,1));
  const callRepayLtv=Math.min(.7,d.mcLtv*.8),atCallCollateral=d.btc*d.mcPrice,topup=d.loan?Math.max(0,d.loan/callRepayLtv-atCallCollateral):0,repay=d.loan?Math.max(0,d.loan-callRepayLtv*atCallCollateral):0;
  $('risk-mechanics').innerHTML=row('Current LTV',pct(d.ltvPct))+row('Margin call LTV',pct(d.mcLtv*100))+row('Liquidation LTV',pct(d.liqLtv*100))+row('Current liquidation price',d.loan?usd(d.liqPrice):'No debt','total')+row('Horizon liquidation price',d.loan?usd(d.liqPriceH):'No debt')+row('Horizon LTV at reference',pct(d.debtOwed/d.collateral*100))+`<div class="risk-track" aria-hidden="true"><span style="width:${d.ltvPct}%;background:var(--accent)"></span><span style="width:${Math.max(0,d.mcLtv*100-d.ltvPct)}%;background:var(--surface3)"></span><span style="width:${(d.liqLtv-d.mcLtv)*100}%;background:var(--red);opacity:.45"></span><span style="flex:1;background:var(--red);opacity:.8"></span></div><p class="hint">Liquidation price = debt ÷ (collateral BTC × liquidation LTV). Unpledged BTC bought with the loan does not lower this threshold.</p>`;
  $('stress-test').innerHTML=row('Start at current margin call',d.loan?usd(d.mcPrice):'No debt')+row('After another −2% (24h)',d.loan?usd(d.mcPrice*.98):'—')+row('After −5%/day for 48h',d.loan?usd(d.mcPrice*.95**2):'—')+row('Collateral top-up at margin call',usd(topup),'total')+row('Or repay debt',usd(repay))+`<p class="hint" style="margin-top:12px">The two alternatives above restore LTV to ${pct(callRepayLtv*100,0)} at the principal-only margin-call price. A top-up adds collateral value; repayment reduces debt. No warning or grace period is assumed.</p>`;
}
function renderSignals(d){
  const cards=[['MVRV ratio',fmt(D.mvrv,3),D.mvrv<1?'Below realized value':D.mvrv<D.histMeanMvrv?'Below historical mean':'Above historical mean',`Historical mean ${fmt(D.histMeanMvrv,3)}`,D.mvrv<D.histMeanMvrv?'good':'amber'],['Z-score',fmt(D.zscore,3),D.zscore<0?'Below mean':'Above mean','From the source MVRV dataset',D.zscore<0?'good':'amber'],['MVRV moving averages',/bull/i.test(D.maStack)?'Bullish':/bear/i.test(D.maStack)?'Bearish':'Mixed','20 / 50 / 200',`${fmt(D.ma20,3)} / ${fmt(D.ma50,3)} / ${fmt(D.ma200,3)}`,/bull/i.test(D.maStack)?'good':'amber'],['30d MVRV momentum',signedPct(D.roc30),D.roc30>=0?'Positive momentum':'Negative momentum',`90d change ${signedPct(D.roc90)}`,D.roc30>=0?'good':'bad'],['Cycle position',pct(D.cyclePos),D.cyclePos<35?'Early cycle':D.cyclePos<65?'Mid cycle':'Later cycle',D.cycleName,'cyan'],['Price vs. cycle ATH',pct(d.athDropPct),'Price drawdown',`${usd(D.c4Ath)} · ${D.c4AthDate||'date unavailable'}`,'amber']];
  $('signal-cards').innerHTML=cards.map(([label,value,tag,note,color])=>`<div class="panel signal-card"><div class="panel-body"><div class="overline">${escapeHTML(label)}</div><div class="big-metric ${color}">${escapeHTML(value)}</div>${badge(tag,color)}<p class="hint">${escapeHTML(note)}</p></div></div>`).join('');
  for(const k of Object.keys(M.WEIGHTS)){set('weight-value-'+k,pct(d.signals.weights[k]*100,0));}
  set('weight-note',d.signals.usedDefaults?'All weights are zero: the default mix is used.':'Normalized to 100% · Composite score '+fmt(d.score,2)+' / 10');
  set('cycle-title',D.cycleName+' · context');
  $('cycle-context').innerHTML=`<div class="key-row"><span>Elapsed cycle</span><strong>${pct(D.cyclePos)}</strong></div><div class="cycle-track"><div class="cycle-fill" style="width:${M.clamp(D.cyclePos,0,100)}%"></div></div>`+row('MVRV cycle peak',fmt(D.cyclePeakMvrv,3))+row('MVRV drawdown from peak',pct(D.cycleDrawdown))+row('Model floor',usd(D.floorPrice))+row('Model ceiling',usd(D.ceilPrice))+row('Ceiling range',usd(D.ceilLow)+' – '+usd(D.ceilHigh))+row('Next estimated halving',escapeHTML(D.nextHalving||'Unavailable'))+`<p class="hint" style="margin-top:12px">MVRV drawdown is a ratio change, not BTC price drawdown. Model ranges are estimates.</p>`;
  const maBull=/bull/i.test(D.maStack),mvrvBelow=D.mvrv<D.histMeanMvrv;
  $('signal-reading').innerHTML=`<p><strong>Valuation:</strong> MVRV is ${mvrvBelow?'below':'above'} its historical mean by ${pct(Math.abs((D.mvrv/D.histMeanMvrv-1)*100))}. That ${mvrvBelow?'supports the lower-valuation component':'reduces the valuation component'} of the composite score.</p><p><strong>Trend:</strong> the MVRV moving-average stack is ${maBull?'bullish':'not bullish'}, while 30-day MVRV momentum is ${signedPct(D.roc30)}. These measures describe on-chain valuation, not a guarantee of BTC price direction.</p><p><strong>Risk context:</strong> current model floor ${usd(D.floorPrice)} and ceiling ${usd(D.ceilPrice)} are uncertain. Loan liquidation depends on your own LTV and terms, independently of the score. The worst reported historical MVRV drawdown is ${pct(D.worstCycleDrawdown)} (${escapeHTML(D.worstCycleTag||'unavailable')}).</p>`;
  $('history-rows').innerHTML=history.length?history.map(h=>`<tr><td>${escapeHTML(h.date)}</td><td>${fmt(h.mvrv,3)}</td><td>${fmt(h.zscore,3)}</td><td>${usd(h.btcPrice)}</td></tr>`).join(''):'<tr><td colspan="4" style="text-align:left">No refreshed snapshots yet. Refresh data to save a valid report on this device.</td></tr>';
  updateMarket();
}
function renderFutures(d){
  const f=M.futures(d),loanDead=d.targetStatus==='Liquidation',futDead=f.targetLiquidated,none=f.notionalUsd===0;
  const cell=(value,sub='')=>escapeHTML(value)+(sub?`<small>${escapeHTML(sub)}</small>`:'');
  const data=[
    ['Additional BTC',cell('+'+fmt(d.newBtc,5)),cell('+'+fmt(f.notionalBtc,5),'Matched deployed exposure')],
    ['Financed / traded notional',cell(usd(d.loan),'Full loan principal'),cell(usd(f.notionalUsd),'Only deployed capital')],
    ['Capital committed',cell(usd(d.collateral),'Pledged BTC'),cell(usd(f.capital),'Spot BTC + cash margin')],
    ['Collateral / margin exposed',cell(usd(d.collateral),'Original collateral subject to liquidation'),cell(usd(f.margin),'Isolated margin; spot BTC kept separate')],
    ['Liquidation price · now',cell(d.loan?usd(d.liqPrice):'No debt',d.loan?signedPct(d.liqDropPct)+' from reference':''),cell(none?'No position':usd(f.liqPrice),none?'':signedPct(f.liqDropPct)+' from reference')],
    ['Carry cost over '+fmt(d.months)+' months',cell(usd(d.interestCost),pct(d.apr*100)+' fixed APR'),cell(usd(f.fundingCost),pct(f.fundingApr*100)+' funding assumption')],
    ['Breakeven before carry',cell(usd(d.breakevenGross)),cell(usd(f.breakevenSimple))],
    ['Breakeven after carry',cell(usd(d.breakevenPrice)),cell(usd(f.breakevenAdj))],
    ['Net portfolio P/L at target',cell(loanDead?'Unavailable':signed(d.netProfit),loanDead?'Liquidation threshold crossed':'After loan interest'),cell(futDead?'Unavailable':signed(f.pnlFutAdj),futDead?'Liquidation threshold crossed':'After estimated funding')],
    ['Portfolio return',cell(loanDead?'—':signedPct(d.levReturnPct),'Denominator: pledged BTC value'),cell(futDead?'—':signedPct(f.returnFutPct),'Denominator: spot BTC + margin')],
    ['Futures leg return on margin',cell('—'),cell(futDead?'—':signedPct(f.legReturnPct),none?'No futures position':'Futures-leg P/L only')]
  ];
  $('comparison-rows').innerHTML=data.map(([label,a,b])=>`<tr><td>${escapeHTML(label)}</td><td>${a}</td><td>${b}</td></tr>`).join('');
  let insight=none?`At 0% deployment there is no futures leg. The loan still carries ${usd(d.interestCost)} interest on the cash you borrow. `:`Both add ${fmt(d.newBtc,5)} BTC. ${Math.abs(f.costDifference)<.005?'Carry costs are equal.':f.costDifference>0?'The loan costs '+usd(f.costDifference)+' less over this horizon.':'Futures cost '+usd(-f.costDifference)+' less over this horizon.'} `;
  if(d.loan&&!none){const loanBuffer=1-d.liqPrice/d.price,futBuffer=1-f.liqPrice/d.price;insight+=`${loanBuffer>futBuffer?'The loan':'Futures'} has the wider principal-only liquidation buffer at the reference price. Futures requires ${usd(f.margin)} in additional cash margin. `;}
  if(loanDead||futDead)insight+='At least one target crosses liquidation; a surviving-position P/L comparison is unavailable.';else insight+='These target payoffs assume neither position is liquidated along the way.';
  set('futures-insight',insight);
}
const VIEWS={overview:'Position overview',scenarios:'Scenario analysis',risk:'Risk & liquidation',signals:'On-chain signals',futures:'Loan vs. futures'};
function switchView(view,focus=false){
  if(!Object.hasOwn(VIEWS,view))return;
  currentView=view;chartAnimate=true;
  document.querySelectorAll('[role=tab]').forEach(button=>{const active=button.dataset.view===view;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  document.querySelectorAll('[role=tabpanel]').forEach(pane=>pane.hidden=pane.id!=='pane-'+view);
  set('page-title',VIEWS[view]);set('breadcrumb',view[0].toUpperCase()+view.slice(1));
  if(currentResult){if(view==='overview')renderOverview(currentResult);else renderActive(currentResult);}
  if(focus)$('tab-'+view).focus();
}
function targetFor(which,d){return which==='current'?d.price:which==='floor'?D.floorPrice:which==='ceiling'?D.ceilPrice:d.loan?d.liqPriceH:0;}
async function fetchLatestData(){
  if(refreshRunning)return;
  refreshRunning=true;$('refresh-btn').disabled=true;$('refresh-btn').classList.add('spin');$('refresh-btn').setAttribute('aria-busy','true');set('update-status','Refreshing data…');
  const revision=editRevision;
  try{
    const result=await window.MarketClient.refresh();reportError=result.reportError;quoteError=result.quoteError;
    if(result.data&&result.data.date>=D.date){D=result.data;dataSource='GitHub report';putStored(STORAGE.data,D);saveHistory(D);}
    else if(result.data){reportError='Older report returned';}
    if(result.quote){quote=result.quote;if(!priceEdited&&editRevision===revision)$('inp-price').value=quote.price;}
    updateMarket();render();
    const message=result.data&&result.quote?'Market and on-chain data refreshed':result.quote?'Market quote refreshed; previous on-chain report retained':result.data?'On-chain report refreshed; previous quote retained':'Sources unavailable; previous data retained';
    toast(message);
  }catch{reportError='Network request failed';quoteError='Network request failed';updateMarket();toast('Refresh failed. Previous data and inputs are preserved.');}
  finally{refreshRunning=false;$('refresh-btn').disabled=false;$('refresh-btn').classList.remove('spin');$('refresh-btn').setAttribute('aria-busy','false');set('update-status',reportError||quoteError?'Refresh incomplete':'Data refreshed');window.__refreshComplete=true;}
}
async function lookupEntryPrice(){
  const date=$('entry-date').value,button=$('lookup-entry');
  if(!M.dateValid(date)||date>new Date().toISOString().slice(0,10)){set('entry-lookup-status','Choose a valid date on or before today.');return;}
  const originalEntry=$('inp-entry').value;button.disabled=true;set('entry-lookup-status','Looking up daily BTC price…');
  try{const series=await window.MarketClient.dailySeries();const result=M.nearestPrice(series,date);if(!result)throw new Error('No daily price found within the preceding seven days.');
    if($('entry-date').value!==date||$('inp-entry').value!==originalEntry){set('entry-lookup-status','Inputs changed while loading; the lookup did not overwrite them.');return;}
    applyInput({entry:Math.round(result.price)});set('entry-lookup-status',`${usd(result.price)} · ${result.date}${result.exact?'':' (nearest earlier date)'}`);
  }catch(error){set('entry-lookup-status',error.message||'Price lookup unavailable.');}finally{button.disabled=false;}
}
function exportSnapshot(){
  const input=validateAndRead();if(!input)return;
  const report=window.LoanReport.build({input,data:D,weights:weights(),quote,source:dataSource,history});
  const blob=new Blob([report],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='btc-loan-analysis-'+new Date().toISOString().slice(0,10)+'.txt';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Full analysis exported.');
}
function setupWeights(){
  const labels={mvrv:'MVRV',zscore:'Z-score',ma:'MA stack',roc:'Momentum',cycle:'Cycle'};
  $('weight-controls').innerHTML=Object.keys(M.WEIGHTS).map(key=>`<div class="weight-row"><label for="weight-${key}">${labels[key]}</label><input id="weight-${key}" class="range" type="range" min="0" max="100" step="1" value="${rawWeights[key]}" data-weight="${key}"><output for="weight-${key}" id="weight-value-${key}">—</output></div>`).join('');
  document.querySelectorAll('[data-weight]').forEach(input=>input.addEventListener('input',()=>{rawWeights[input.dataset.weight]=Number(input.value);putStored(STORAGE.weights,rawWeights);scheduleRender();}));
}
function setTheme(theme){document.documentElement.dataset.theme=theme;$('theme-toggle').setAttribute('aria-label','Switch to '+(theme==='dark'?'light':'dark')+' theme');document.querySelector('meta[name=theme-color]').content=theme==='dark'?'#090c11':'#eaf0f5';try{localStorage.setItem('theme',theme);}catch{}if(currentResult){chartAnimate=false;renderActive(currentResult);if(currentView==='overview')renderPayoff(currentResult);}}
function restorePosition(){const stored=getStored(STORAGE.position,null);if(stored){const v=M.validate(stored);if(v.valid){applyInput(v.value);toast('Saved position restored from this device.');return;}toast('Saved inputs were invalid. The repository preset was loaded instead.');}else toast('Repository position preset loaded.');applyInput(M.SAVED_POSITION);}
let presetNoticeTimer=null;
function dismissPresetNotice(){clearTimeout(presetNoticeTimer);$('preset-notice').hidden=true;}
function runHiddenCommand(){
  applyInput(M.SAVED_POSITION);
  $('preset-values').innerHTML=[`BTC AMOUNT → ${fmt(M.SAVED_POSITION.btc,3)}`,`LTV → ${pct(M.SAVED_POSITION.ltv,0)}`,`ENTRY / DEPLOY → ${usd(M.SAVED_POSITION.entry)}`,`APR → ${pct(M.SAVED_POSITION.apr)}`,`TARGET (2× ENTRY) → ${usd(M.SAVED_POSITION.target)}`].map(line=>'<div>'+escapeHTML(line)+'</div>').join('');
  $('preset-notice').hidden=false;clearTimeout(presetNoticeTimer);presetNoticeTimer=setTimeout(dismissPresetNotice,4000);
}
function setupPresetShortcuts(){
  const keys=window.PresetShortcuts.keyHandler(runHiddenCommand);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissPresetNotice();keys(event);});
  const input=$('inp-btc'),wrap=$('btc-amount-wrap');
  const hold=window.PresetShortcuts.holdHandlers({activate:runHiddenCommand,charge:on=>wrap.classList.toggle('hold-charging',on),focus:()=>input.focus(),blur:()=>input.blur()});
  input.addEventListener('pointerdown',hold.down);
  window.addEventListener('pointermove',hold.move,{passive:true});
  window.addEventListener('pointerup',hold.up);
  window.addEventListener('pointercancel',hold.cancel);
  window.addEventListener('blur',hold.cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hold.cancel();});
  input.addEventListener('contextmenu',hold.context);
  $('preset-dismiss').addEventListener('click',dismissPresetNotice);
}
function updateClock(){set('utc-clock',new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC');}
$('inp-price').value=D.btcPrice;
$('entry-date').max=new Date().toISOString().slice(0,10);
fields.forEach(node=>node.addEventListener('input',()=>{if(node.dataset.field==='price')priceEdited=true;editRevision++;chartAnimate=false;chartPrice=null;scheduleRender();}));
$('ltv-range').addEventListener('input',event=>{applyInput({ltv:event.target.value});});
$('chart-scrub').addEventListener('input',event=>inspectChart(Number(event.target.value)));
$('chart-scrub').addEventListener('blur',hideInspect);
$('payoff-chart').addEventListener('pointermove',event=>{if(!chartScale)return;const rect=$('payoff-chart').getBoundingClientRect(),px=event.clientX-rect.left,scale=rect.width/chartScale.width;const x=px/scale;const price=chartScale.min+(x-chartScale.L)/(chartScale.width-chartScale.L-chartScale.R)*(chartScale.max-chartScale.min);inspectChart(price,x);});
$('payoff-chart').addEventListener('pointerleave',hideInspect);
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view,button.getAttribute('role')!=='tab')));
document.querySelector('[role=tablist]').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(VIEWS),index=keys.indexOf(currentView);switchView(keys[event.key==='Home'?0:event.key==='End'?keys.length-1:(index+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length],true);});
document.querySelectorAll('[data-target]').forEach(button=>button.addEventListener('click',()=>{if(!currentResult)return;const target=targetFor(button.dataset.target,currentResult);if(target>0)applyInput({target:button.dataset.target==='liq'?Math.floor(target):Math.round(target)});else toast('No liquidation price when there is no debt.');}));
$('pnl-basis').addEventListener('change',()=>currentResult&&renderScenarios(currentResult));
$('refresh-btn').addEventListener('click',fetchLatestData);
$('export-btn').addEventListener('click',exportSnapshot);
$('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('lookup-entry').addEventListener('click',lookupEntryPrice);
$('reset-weights').addEventListener('click',()=>{rawWeights={...M.WEIGHTS};putStored(STORAGE.weights,rawWeights);setupWeights();render();toast('Default signal weights restored.');});
$('save-position').addEventListener('click',()=>{const input=validateAndRead();if(!input)return;if(putStored(STORAGE.position,input)){set('restore-position','Load saved position');set('position-status','Saved on this device');toast('Position saved on this device.');}else toast('This browser blocked saving. Export your analysis instead.');});
$('restore-position').addEventListener('click',restorePosition);
set('restore-position',getStored(STORAGE.position,null)?'Load saved position':'Load repository position preset');
const quoteButton=document.createElement('button');quoteButton.className='button ghost small';quoteButton.type='button';quoteButton.textContent='Use market quote';quoteButton.style.marginTop='5px';quoteButton.addEventListener('click',()=>{priceEdited=false;applyInput({price:quote.price},{markPrice:false});toast('Reference price set to the displayed market quote.');});$('inp-price').closest('.field').appendChild(quoteButton);
setupWeights();
setupPresetShortcuts();
document.querySelectorAll('[data-pots-mode]').forEach(button=>button.addEventListener('click',()=>setTwoPotsMode(button.dataset.potsMode)));
try{setTheme(localStorage.getItem('theme')==='light'?'light':'dark');}catch{setTheme('dark');}
if(window.matchMedia('(max-width: 760px)').matches)$('position-panel').open=false;
updateClock();updateMarket();render();
setInterval(()=>{updateClock();updateMarket();},60000);
if(typeof ResizeObserver==='function'){let resizeFrame;const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(!currentResult)return;chartAnimate=false;if(currentView==='overview')renderPayoff(currentResult);if(currentView==='scenarios')renderScenarios(currentResult);});});observer.observe($('payoff-chart'));observer.observe($('ladder-chart'));}
// Explicit promise lets integrations wait for the complete refresh transaction.
window.terminalRefreshPromise=fetchLatestData();
