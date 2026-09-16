/* Berkshire Meetings — Money
   Interactive municipal-finance analysis. No dependencies. */
(function(){
"use strict";

var state={data:null,activeTown:"",unit:"pc",mixKey:"",compareTown:"Sheffield"};
var C={ink:"#17212b",muted:"#65727e",grid:"#dce2e6",blue:"#2878b5",red:"#c84d43",gold:"#bd8427",green:"#3c7d68",paper:"#fbfbf8",other:"#aeb8bf"};
var MIX={education:"#2878b5",public_safety:"#c84d43",public_works:"#bd8427",general_government:"#6f7f8c",fixed_costs:"#866eaa",debt_service:"#43918d",community:"#cf7c43",other:"#bcc3c7"};

function esc(v){return String(v==null?"":v).replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c];});}
function money(v){return v==null?"—":"$"+Math.round(v).toLocaleString("en-US");}
function compact(v){if(v==null)return "—";var a=Math.abs(v),s=v<0?"−":"";if(a>=1e6)return s+"$"+(a/1e6).toFixed(a>=10e6?1:2).replace(/\.0+$/,"")+"M";if(a>=1e3)return s+"$"+(a/1e3).toFixed(a>=100e3?0:1).replace(/\.0$/,"")+"K";return s+"$"+Math.round(a);}
function pct(v,d){return (v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(d==null?1:d)+"%";}
function median(a){var b=a.slice().sort(function(x,y){return x-y;}),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2;}
function sum(a,fn){return a.reduce(function(n,d){return n+fn(d);},0);}
function byName(name){return state.data.towns.filter(function(d){return d.name===name;})[0]||null;}
function scale(d0,d1,r0,r1){return function(v){return d0===d1?(r0+r1)/2:r0+(v-d0)/(d1-d0)*(r1-r0);};}
function svgEl(tag,attrs,parent){var e=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.keys(attrs||{}).forEach(function(k){e.setAttribute(k,attrs[k]);});if(parent)parent.appendChild(e);return e;}
function svgText(p,x,y,t,a){a=a||{};a.x=x;a.y=y;var n=svgEl("text",a,p);n.textContent=t;return n;}
function mark(el,tip,town){el.setAttribute("data-tip",tip);el.setAttribute("tabindex","0");if(town){el.setAttribute("data-town",town);el.setAttribute("role","button");el.setAttribute("aria-label",tip+". Select "+town+".");}return el;}
function chartHost(label){var d=document.createElement("div");d.className="m-chart";d.setAttribute("role","group");d.setAttribute("aria-label",label);return d;}
function source(kind){return '<p class="m-source">MA Division of Local Services Municipal Databank · '+kind+' · FY2023–25 actuals · retrieved Sep. 15, 2026</p>';}

function render(){
  var host=document.getElementById("view");
  if(!state.data){host.innerHTML='<div class="m-loading">Loading municipal finance data…</div>';load();return;}
  if(state.activeTown&&!byName(state.activeTown))state.activeTown="";
  var t=state.data.towns,top=t.slice().sort(function(a,b){return b.spend_per_capita-a.spend_per_capita;})[0];
  var low=t.slice().sort(function(a,b){return a.spend_per_capita-b.spend_per_capita;})[0];
  var spread=(top.spend_per_capita/low.spend_per_capita-1)*100;
  host.innerHTML='<div class="mny" id="money-analysis">'
    +'<header class="m-hero"><div class="m-kicker">South County town finance</div>'
    +'<h1>The same dollar buys a different town.</h1>'
    +'<p>Eleven towns. Three fiscal years. Follow the tax levy through the budget.</p>'
    +'<div class="m-data-strip">'
      +stat(compact(state.data.agg.fy25_total),"FY2025 spending","11 general funds")
      +stat(pct(state.data.agg.change_pct),"one-year change","combined")
      +stat(money(state.data.agg.median_bill),"median tax bill","single-family")
      +stat(Math.round(spread)+"%","spending spread","per resident")
    +'</div></header>'
    +controls()
    +'<main class="m-story" id="m-story"></main>'
    +methodology()+'<div class="m-tooltip" id="m-tooltip" role="status"></div></div>';

  var story=document.getElementById("m-story");
  story.appendChild(block("spending","Population changes the ranking.",chartRank,"wide"));
  story.appendChild(block("rank","Big budgets are not always expensive towns.",chartRankShift,"half"));
  story.appendChild(block("trend",trendHeadline(),chartTrends,"half"));
  story.appendChild(block("mix",mixHeadline(),chartMix,"wide"));
  story.appendChild(block("change","A $2.3 million increase hid large offsets.",chartWaterfall,"half"));
  story.appendChild(block("tax",taxHeadline(),chartTaxSpend,"half"));
  story.appendChild(block("headroom","Great Barrington has $18,144 left under its levy limit.",chartHeadroom,"half"));
  story.appendChild(block("reserves","Cash cushions vary more than tax bills do.",chartReserves,"half"));
  story.appendChild(block("compare","Put two towns on the same ledger.",chartCompare,"wide"));
  bind(document.getElementById("money-analysis"));
}

function stat(value,label,note){return '<div class="m-stat"><strong>'+value+'</strong><span>'+label+'</span><small>'+note+'</small></div>';}
function controls(){
  var opts='<option value="">All towns</option>'+state.data.towns.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(d){return '<option value="'+esc(d.name)+'"'+(state.activeTown===d.name?' selected':'')+'>'+esc(d.name)+'</option>';}).join("");
  return '<div class="m-controlbar"><label>Highlight a town<select id="m-town-select">'+opts+'</select></label>'
    +'<div class="m-control-note">'+(state.activeTown?'<strong>'+esc(state.activeTown)+'</strong> is selected across the page.':'Hover for exact values. Click any town to trace it.')+'</div>'
    +(state.activeTown?'<button type="button" class="m-clear" data-action="clear-town">Clear highlight</button>':'')+'</div>';
}
function block(id,title,fn,size){var s=document.createElement("section");s.className="m-block m-"+size;s.id="m-"+id;s.innerHTML='<header><h2>'+title+'</h2></header>';var h=fn();s.appendChild(h);s.insertAdjacentHTML("beforeend",source(id==="tax"||id==="headroom"||id==="reserves"?"Community Snapshots + Schedule A":"Schedule A general fund"));return s;}

function chartRank(){
  var h=chartHost("Ranked town spending chart"),t=state.data.towns.slice(),pc=state.unit==="pc";
  t.sort(function(a,b){return (pc?b.spend_per_capita:b.fy25_total)-(pc?a.spend_per_capita:a.fy25_total);});
  h.innerHTML='<div class="m-switch" role="group" aria-label="Spending unit"><button type="button" data-action="unit" data-value="pc" class="'+(pc?'on':'')+'">Per resident</button><button type="button" data-action="unit" data-value="total" class="'+(!pc?'on':'')+'">Total dollars</button></div>';
  var W=940,L=145,R=95,T=16,row=34,H=T+t.length*row+35,max=Math.max.apply(null,t.map(function(d){return pc?d.spend_per_capita:d.fy25_total;})),X=scale(0,max,0,W-L-R);
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h),med=median(t.map(function(d){return pc?d.spend_per_capita:d.fy25_total;}));
  var mx=L+X(med);svgEl("line",{x1:mx,y1:4,x2:mx,y2:H-24,stroke:C.red,"stroke-width":1.5,"stroke-dasharray":"3 4"},s);svgText(s,mx+6,H-7,"11-town median",{fill:C.red,"font-size":11});
  t.forEach(function(d,i){var v=pc?d.spend_per_capita:d.fy25_total,y=T+i*row,active=!state.activeTown||state.activeTown===d.name,fill=state.activeTown===d.name?C.blue:(i===0||i===t.length-1?C.ink:C.other);svgText(s,L-12,y+21,d.name,{fill:active?C.ink:C.other,"font-size":13,"font-weight":state.activeTown===d.name?700:500,"text-anchor":"end"});var r=svgEl("rect",{x:L,y:y+6,width:Math.max(2,X(v)),height:20,rx:2,fill:fill,opacity:active?1:.24},s);mark(r,d.name+": "+(pc?money(v)+" per resident":compact(v)+" total spending"),d.name);svgText(s,L+X(v)+9,y+21,pc?money(v):compact(v),{fill:active?C.ink:C.other,"font-size":12,"font-weight":600});});
  return h;
}

function chartRankShift(){
  var h=chartHost("Total spending rank compared with per-resident rank"),t=state.data.towns.slice();
  var total=t.slice().sort(function(a,b){return b.fy25_total-a.fy25_total;}),pc=t.slice().sort(function(a,b){return b.spend_per_capita-a.spend_per_capita;}),W=610,H=430,L=125,R=485,T=36,B=24,Y=scale(0,t.length-1,T,H-B),s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h);
  svgText(s,L,T-17,"Total spending",{fill:C.muted,"font-size":12,"font-weight":700,"text-anchor":"middle"});svgText(s,R,T-17,"Per resident",{fill:C.muted,"font-size":12,"font-weight":700,"text-anchor":"middle"});
  t.forEach(function(d){var a=total.indexOf(d),b=pc.indexOf(d),active=!state.activeTown||state.activeTown===d.name,color=state.activeTown===d.name?C.blue:(b<a?C.green:b>a?C.red:C.muted);var path=svgEl("path",{d:"M"+L+","+Y(a)+" C250,"+Y(a)+" 360,"+Y(b)+" "+R+","+Y(b),fill:"none",stroke:color,"stroke-width":state.activeTown===d.name?4:2,opacity:active?.85:.14},s);mark(path,d.name+": #"+(a+1)+" in total spending, #"+(b+1)+" per resident",d.name);svgEl("circle",{cx:L,cy:Y(a),r:3,fill:color,opacity:active?1:.2},s);svgEl("circle",{cx:R,cy:Y(b),r:3,fill:color,opacity:active?1:.2},s);svgText(s,L-9,Y(a)+4,(a+1)+"  "+d.name,{fill:active?C.ink:C.other,"font-size":10.5,"text-anchor":"end"});svgText(s,R+9,Y(b)+4,(b+1)+"  "+d.name,{fill:active?C.ink:C.other,"font-size":10.5});});
  return h;
}

function trendHeadline(){var t=state.data.towns.slice().sort(function(a,b){return b.change_pct-a.change_pct;});return t[0].name+" rose "+Math.abs(t[0].change_pct).toFixed(1)+"%; "+t[t.length-1].name+" fell "+Math.abs(t[t.length-1].change_pct).toFixed(1)+"%.";}
function chartTrends(){
  var h=chartHost("Spending per resident from FY2023 through FY2025"),t=state.data.towns.slice(),W=610,H=430,L=58,R=88,T=26,B=43,years=[2023,2024,2025],all=[];t.forEach(function(d){all.push(d.fy23_total/d.population,d.fy24_total/d.population,d.fy25_total/d.population);});var Y=scale(Math.min.apply(null,all)*.94,Math.max.apply(null,all)*1.05,H-B,T),X=scale(0,2,L,W-R),s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h);
  [3000,4000,5000,6000].forEach(function(v){if(Y(v)>T&&Y(v)<H-B){svgEl("line",{x1:L,y1:Y(v),x2:W-R,y2:Y(v),stroke:C.grid},s);svgText(s,L-8,Y(v)+4,"$"+v/1000+"k",{fill:C.muted,"font-size":10,"text-anchor":"end"});}});years.forEach(function(y,i){svgText(s,X(i),H-16,"FY"+String(y).slice(2),{fill:C.muted,"font-size":11,"text-anchor":"middle"});});
  t.sort(function(a,b){return a.fy25_total-b.fy25_total;}).forEach(function(d){var vals=[d.fy23_total/d.population,d.fy24_total/d.population,d.fy25_total/d.population],active=!state.activeTown||state.activeTown===d.name,color=state.activeTown===d.name?C.blue:(d.change_pct<0?C.red:C.ink),path="M"+vals.map(function(v,i){return X(i)+","+Y(v);}).join(" L");var p=svgEl("path",{d:path,fill:"none",stroke:color,"stroke-width":state.activeTown===d.name?4:1.8,opacity:active?.7:.1},s);mark(p,d.name+": "+money(vals[0])+" in FY2023 to "+money(vals[2])+" in FY2025 ("+pct((vals[2]/vals[0]-1)*100)+")",d.name);vals.forEach(function(v,i){var c=svgEl("circle",{cx:X(i),cy:Y(v),r:state.activeTown===d.name?5:3.3,fill:color,opacity:active?1:.15},s);mark(c,d.name+", FY"+String(years[i]).slice(2)+": "+money(v)+" per resident",d.name);});svgText(s,W-R+7,Y(vals[2])+4,d.name,{fill:active?color:C.other,"font-size":9.5,"font-weight":state.activeTown===d.name?700:500});});
  return h;
}

function mixHeadline(){var e=state.data.towns.map(function(d){return {n:d.name,p:d.mix.education/d.fy25_total*100};}).sort(function(a,b){return b.p-a.p;});return "Education ranges from "+Math.round(e[e.length-1].p)+"% to "+Math.round(e[0].p)+"% of town spending.";}
function chartMix(){
  var h=chartHost("Spending composition by town"),bands=state.data.agg.bands,t=state.data.towns.slice().sort(function(a,b){return b.spend_per_capita-a.spend_per_capita;});
  var legend=document.createElement("div");legend.className="m-legend";bands.forEach(function(b){legend.innerHTML+='<button type="button" data-action="mix" data-value="'+b.key+'" class="'+(state.mixKey===b.key?'on':'')+'"><i style="background:'+MIX[b.key]+'"></i>'+esc(b.label)+'</button>';});if(state.mixKey)legend.innerHTML+='<button type="button" data-action="mix" data-value="" class="m-reset">Show all</button>';h.appendChild(legend);
  var W=940,L=145,R=42,T=14,row=35,H=T+t.length*row+24,s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h);
  t.forEach(function(d,i){var y=T+i*row,x=L,active=!state.activeTown||state.activeTown===d.name;svgText(s,L-12,y+22,d.name,{fill:active?C.ink:C.other,"font-size":13,"font-weight":state.activeTown===d.name?700:500,"text-anchor":"end"});bands.forEach(function(b){var v=d.mix[b.key]||0,share=v/d.fy25_total,w=share*(W-L-R),chosen=!state.mixKey||state.mixKey===b.key;var r=svgEl("rect",{x:x,y:y+5,width:Math.max(w,.5),height:23,fill:MIX[b.key],opacity:active&&chosen?1:.15,stroke:C.paper,"stroke-width":.6},s);mark(r,d.name+" · "+b.label+": "+compact(v)+" ("+(share*100).toFixed(1)+"%)",d.name);x+=w;});});
  svgText(s,L,H-3,"0%",{fill:C.muted,"font-size":10});svgText(s,W-R,H-3,"100%",{fill:C.muted,"font-size":10,"text-anchor":"end"});return h;
}

function chartWaterfall(){
  var h=chartHost("Category contribution to spending change"),items=state.data.agg.waterfall.slice().sort(function(a,b){return Math.abs(b.delta)-Math.abs(a.delta);}),W=610,H=420,L=150,R=74,T=22,row=35,max=Math.max.apply(null,items.map(function(d){return Math.abs(d.delta);})),X=scale(-max,max,L,W-R),zero=X(0),s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h);svgEl("line",{x1:zero,y1:T-7,x2:zero,y2:H-32,stroke:C.ink,"stroke-width":1},s);
  items.forEach(function(d,i){var y=T+i*row,x=Math.min(zero,X(d.delta)),w=Math.abs(X(d.delta)-zero),color=d.delta>=0?C.blue:C.red;svgText(s,L-12,y+20,d.label,{fill:C.ink,"font-size":11.5,"text-anchor":"end"});var r=svgEl("rect",{x:x,y:y+5,width:Math.max(w,2),height:21,fill:color},s);mark(r,d.label+": "+(d.delta>=0?"added ":"reduced ")+compact(Math.abs(d.delta)));svgText(s,d.delta>=0?X(d.delta)+7:X(d.delta)-7,y+20,(d.delta>=0?"+":"−")+compact(Math.abs(d.delta)).slice(1),{fill:color,"font-size":11,"font-weight":700,"text-anchor":d.delta>=0?"start":"end"});});
  svgText(s,zero,H-8,"← reduced spending   |   increased spending →",{fill:C.muted,"font-size":10.5,"text-anchor":"middle"});return h;
}

function regression(t){var n=t.length,sx=sum(t,function(d){return d.levy_per_capita;}),sy=sum(t,function(d){return d.spend_per_capita;}),sxx=sum(t,function(d){return d.levy_per_capita*d.levy_per_capita;}),sxy=sum(t,function(d){return d.levy_per_capita*d.spend_per_capita;}),m=(n*sxy-sx*sy)/(n*sxx-sx*sx),b=(sy-m*sx)/n,mean=sy/n,ssTot=sum(t,function(d){return Math.pow(d.spend_per_capita-mean,2);}),ssRes=sum(t,function(d){return Math.pow(d.spend_per_capita-(m*d.levy_per_capita+b),2);});return {m:m,b:b,r2:1-ssRes/ssTot};}
function taxHeadline(){var r=regression(state.data.towns);return "Tax levy explains "+Math.round(r.r2*100)+"% of the variation in spending.";}
function chartTaxSpend(){
  var h=chartHost("Property tax levy and general fund spending per resident scatterplot"),t=state.data.towns,W=610,H=420,L=58,R=38,T=25,B=55,xv=t.map(function(d){return d.levy_per_capita;}),yv=t.map(function(d){return d.spend_per_capita;}),xmin=Math.min.apply(null,xv)*.94,xmax=Math.max.apply(null,xv)*1.04,ymin=Math.min.apply(null,yv)*.94,ymax=Math.max.apply(null,yv)*1.05,X=scale(xmin,xmax,L,W-R),Y=scale(ymin,ymax,H-B,T),s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h),reg=regression(t);
  [3000,3500,4000,4500].forEach(function(v){if(X(v)>L&&X(v)<W-R){svgEl("line",{x1:X(v),y1:T,x2:X(v),y2:H-B,stroke:C.grid},s);svgText(s,X(v),H-B+17,"$"+(v/1000).toFixed(1)+"k",{fill:C.muted,"font-size":10,"text-anchor":"middle"});}});[4000,4500,5000,5500].forEach(function(v){if(Y(v)>T&&Y(v)<H-B){svgEl("line",{x1:L,y1:Y(v),x2:W-R,y2:Y(v),stroke:C.grid},s);svgText(s,L-8,Y(v)+4,"$"+(v/1000).toFixed(1)+"k",{fill:C.muted,"font-size":10,"text-anchor":"end"});}});
  svgEl("line",{x1:X(xmin),y1:Y(reg.m*xmin+reg.b),x2:X(xmax),y2:Y(reg.m*xmax+reg.b),stroke:C.red,"stroke-width":2,"stroke-dasharray":"5 4"},s);svgText(s,(L+W-R)/2,H-9,"Property-tax levy per resident →",{fill:C.muted,"font-size":11,"text-anchor":"middle"});var yl=svgText(s,13,(T+H-B)/2,"Spending per resident →",{fill:C.muted,"font-size":11,"text-anchor":"middle"});yl.setAttribute("transform","rotate(-90 13 "+((T+H-B)/2)+")");
  t.forEach(function(d){var active=!state.activeTown||state.activeTown===d.name,color=state.activeTown===d.name?C.blue:C.ink,r=state.activeTown===d.name?8:5.5,c=svgEl("circle",{cx:X(d.levy_per_capita),cy:Y(d.spend_per_capita),r:r,fill:color,opacity:active?.85:.15,stroke:C.paper,"stroke-width":2},s);mark(c,d.name+": "+money(d.levy_per_capita)+" levy and "+money(d.spend_per_capita)+" spending per resident",d.name);svgText(s,X(d.levy_per_capita)+(d.name==="Richmond"?-8:8),Y(d.spend_per_capita)+(d.name==="Richmond"?-8:4),d.name,{fill:active?color:C.other,"font-size":9.5,"text-anchor":d.name==="Richmond"?"end":"start"});});return h;
}

function chartHeadroom(){
  var h=chartHost("Proposition 2 and a half levy headroom by town"),t=state.data.towns.slice().sort(function(a,b){return a.headroom_pct-b.headroom_pct;}),W=610,H=420,L=135,R=65,T=16,row=33,max=20,X=scale(0,max,L,W-R),s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h);[0,5,10,15,20].forEach(function(v){svgEl("line",{x1:X(v),y1:T,x2:X(v),y2:H-35,stroke:C.grid},s);svgText(s,X(v),H-14,v+"%",{fill:C.muted,"font-size":10,"text-anchor":"middle"});});
  t.forEach(function(d,i){var y=T+i*row+15,active=!state.activeTown||state.activeTown===d.name,color=d.headroom_pct<3?C.red:(state.activeTown===d.name?C.blue:C.ink);svgText(s,L-10,y+4,d.name,{fill:active?C.ink:C.other,"font-size":11.5,"font-weight":state.activeTown===d.name?700:500,"text-anchor":"end"});svgEl("line",{x1:L,y1:y,x2:X(d.headroom_pct),y2:y,stroke:color,"stroke-width":2,opacity:active?.65:.12},s);var c=svgEl("circle",{cx:X(d.headroom_pct),cy:y,r:6,fill:color,opacity:active?1:.16},s);mark(c,d.name+": "+d.headroom_pct.toFixed(2)+"% headroom ("+compact(d.excess_capacity)+")",d.name);svgText(s,X(d.headroom_pct)+9,y+4,d.headroom_pct.toFixed(2)+"%",{fill:active?color:C.other,"font-size":10.5,"font-weight":700});});return h;
}

function chartReserves(){
  var h=chartHost("Free cash and stabilization funds as a share of spending"),t=state.data.towns.slice();t.forEach(function(d){d._free=d.free_cash/d.fy25_total*100;d._stab=d.stabilization/d.fy25_total*100;d._reserve=d._free+d._stab;});t.sort(function(a,b){return b._reserve-a._reserve;});var W=610,H=420,L=135,R=62,T=14,row=33,max=Math.max.apply(null,t.map(function(d){return d._reserve;}))*1.08,X=scale(0,max,L,W-R),s=svgEl("svg",{viewBox:"0 0 "+W+" "+H},h);svgText(s,L,T-2,"■ Free cash",{fill:C.blue,"font-size":10.5});svgText(s,L+85,T-2,"■ Stabilization",{fill:C.gold,"font-size":10.5});
  t.forEach(function(d,i){var y=T+9+i*row,active=!state.activeTown||state.activeTown===d.name;svgText(s,L-10,y+21,d.name,{fill:active?C.ink:C.other,"font-size":11.5,"font-weight":state.activeTown===d.name?700:500,"text-anchor":"end"});var a=svgEl("rect",{x:L,y:y+6,width:X(d._free)-L,height:20,fill:C.blue,opacity:active?1:.15},s);mark(a,d.name+" free cash: "+compact(d.free_cash)+" ("+d._free.toFixed(1)+"% of spending)",d.name);var b=svgEl("rect",{x:X(d._free),y:y+6,width:X(d._reserve)-X(d._free),height:20,fill:C.gold,opacity:active?1:.15},s);mark(b,d.name+" stabilization: "+compact(d.stabilization)+" ("+d._stab.toFixed(1)+"% of spending)",d.name);svgText(s,X(d._reserve)+7,y+21,d._reserve.toFixed(1)+"%",{fill:active?C.ink:C.other,"font-size":10.5,"font-weight":700});});return h;
}

function chartCompare(){
  var h=chartHost("Town comparison table"),a=byName(state.activeTown)||state.data.towns[0],b=byName(state.compareTown);if(!b||b===a){b=state.data.towns.filter(function(d){return d!==a;})[0];state.compareTown=b.name;}var options=state.data.towns.slice().sort(function(x,y){return x.name.localeCompare(y.name);}).map(function(d){return '<option value="'+esc(d.name)+'"'+(b.name===d.name?' selected':'')+'>'+esc(d.name)+'</option>';}).join("");h.innerHTML='<div class="m-compare-head"><div><span>Selected</span><strong>'+esc(a.name)+'</strong></div><div class="m-versus">compared with</div><label><span>Comparison town</span><select id="m-compare-select">'+options+'</select></label></div>';
  var signedNumber=function(v){return (v>0?"+":v<0?"−":"")+Math.abs(Math.round(v)).toLocaleString("en-US");};
  var signedMoney=function(v){return (v>0?"+":v<0?"−":"")+compact(Math.abs(v));};
  var signedPoints=function(v){return (v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(1)+" pts";};
  var rows=[
    ["Population",a.population,b.population,function(v){return Math.round(v).toLocaleString("en-US");},signedNumber],
    ["FY2025 spending",a.fy25_total,b.fy25_total,compact,signedMoney],
    ["Spending per resident",a.spend_per_capita,b.spend_per_capita,money,signedMoney],
    ["Average single-family tax bill",a.avg_sf_bill,b.avg_sf_bill,money,signedMoney],
    ["Tax levy per resident",a.levy_per_capita,b.levy_per_capita,money,signedMoney],
    ["One-year spending change",a.change_pct,b.change_pct,function(v){return pct(v);},signedPoints],
    ["Prop 2½ headroom",a.headroom_pct,b.headroom_pct,function(v){return v.toFixed(2)+"%";},signedPoints],
    ["Free cash",a.free_cash,b.free_cash,compact,signedMoney],
    ["Stabilization",a.stabilization,b.stabilization,compact,signedMoney]
  ];
  var table=document.createElement("div");table.className="m-compare-table";table.innerHTML='<div class="m-compare-row m-compare-labels"><span>Measure</span><b>'+esc(a.name)+'</b><b>'+esc(b.name)+'</b><span>Difference</span></div>'+rows.map(function(r){var diff=r[1]-r[2];return '<div class="m-compare-row"><span>'+r[0]+'</span><b>'+r[3](r[1])+'</b><b>'+r[3](r[2])+'</b><span class="'+(diff>0?'m-up':diff<0?'m-down':'')+'">'+r[4](diff)+'</span></div>';}).join("");h.appendChild(table);
  var details=document.createElement("details");details.className="m-drill";details.open=!!state.activeTown;details.innerHTML='<summary>Drill into '+esc(a.name)+'’s FY2025 budget</summary><div class="m-drill-grid">'+state.data.agg.bands.map(function(k){var v=a.mix[k.key]||0;return '<div><span>'+esc(k.label)+'</span><strong>'+compact(v)+'</strong><i><em style="width:'+(v/a.fy25_total*100)+'%;background:'+MIX[k.key]+'"></em></i><small>'+(v/a.fy25_total*100).toFixed(1)+'%</small></div>';}).join("")+'</div>';h.appendChild(details);return h;
}

function bind(root){
  var tip=root.querySelector("#m-tooltip");
  root.addEventListener("change",function(e){if(e.target.id==="m-town-select"){state.activeTown=e.target.value;render();}if(e.target.id==="m-compare-select"){state.compareTown=e.target.value;render();}});
  root.addEventListener("click",function(e){var a=e.target.closest("[data-action]");if(a){var action=a.getAttribute("data-action"),v=a.getAttribute("data-value")||"";if(action==="clear-town")state.activeTown="";if(action==="unit")state.unit=v;if(action==="mix")state.mixKey=v;render();return;}var town=e.target.closest("[data-town]");if(town){state.activeTown=town.getAttribute("data-town");render();}});
  function show(e){var m=e.target.closest("[data-tip]");if(!m)return;tip.textContent=m.getAttribute("data-tip");tip.classList.add("show");position(e,m);}
  function position(e,m){var x=e.clientX||0,y=e.clientY||0;if(!x&&!y){var r=m.getBoundingClientRect();x=r.left+r.width/2;y=r.top;}var tw=tip.offsetWidth||220,th=tip.offsetHeight||50;tip.style.left=Math.max(8,Math.min(window.innerWidth-tw-8,x+14))+"px";tip.style.top=Math.max(8,Math.min(window.innerHeight-th-8,y+14))+"px";}
  root.addEventListener("pointerover",show);root.addEventListener("pointermove",function(e){if(tip.classList.contains("show"))position(e,e.target);});root.addEventListener("pointerout",function(e){if(e.target.closest("[data-tip]"))tip.classList.remove("show");});root.addEventListener("focusin",show);root.addEventListener("focusout",function(){tip.classList.remove("show");});
}

function methodology(){return '<details class="m-method" id="mny-method"><summary>Data, definitions and limitations</summary><div><p><strong>Scope:</strong> Great Barrington, Sheffield, Egremont, New Marlborough, Monterey, Sandisfield, Otis, Tyringham, Becket, Alford and Richmond.</p><p><strong>General fund:</strong> Schedule A actuals. Enterprise funds such as water, sewer and ambulance are excluded. Education includes regional-school assessments.</p><p><strong>Population:</strong> Per-resident measures use DLS 2023 estimates for every year. The average tax bill is the DLS average single-family bill, not the levy divided by population.</p><p><strong>Prop 2½:</strong> Headroom is excess levy capacity divided by the maximum levy limit. It is not a forecast of a town’s tax increase.</p><p><strong>Reserves:</strong> Free cash and stabilization are shown separately and compared with annual general-fund spending; they are not interchangeable in municipal accounting.</p><p><strong>Source:</strong> Massachusetts Division of Local Services Municipal Databank, Schedule A FY2023–25 and FY2025 Community Snapshots. Data retrieved September 15, 2026.</p></div></details>';}
function load(){fetch("data/money.json?v=20260915-3").then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){state.data=d;render();}).catch(function(){document.getElementById("view").innerHTML='<div class="m-loading">The finance data could not be loaded.</div>';});}

window.BMMoney={render:render};
})();
