/* ============================================================
   Money tab - town finances across South County
   Real data only: MA DLS Municipal Databank (Schedule A actuals,
   FY2025 tax data). Loaded from data/money.json.
   ============================================================ */
(function(){
"use strict";

var TOWNS = ["Great Barrington","Sheffield","Egremont","New Marlborough","Monterey","Sandisfield","Otis","Tyringham","Becket","Alford","Richmond"];
var YEARS = ["2025","2024","2023"];
var FUNCS = [
  ["education","Education"],
  ["general_government","General Government"],
  ["public_safety","Public Safety"],
  ["public_works","Public Works"],
  ["fixed_costs","Fixed Costs"],
  ["debt_service","Debt Service"],
  ["human_services","Human Services"],
  ["culture_recreation","Culture & Recreation"],
  ["intergov","Intergov. Assessments"],
  ["other","Other"]
];
var FUNC_COLORS = ["#2b5ea6","#2f5d3f","#c08a1d","#b0483a","#6b8f71","#7a5ea6","#a66a2b","#4a8a8a","#8a8a7a","#a8a092"];

var state = {
  tab: "overview",
  towns: TOWNS.slice(),      // selected towns
  year: "2025",
  metric: "total",           // total | percapita | taxrate | taxbill
  data: null
};

function fmtM(n){ if(n==null) return "—"; var a=Math.abs(n); if(a>=1e6) return "$"+(n/1e6).toFixed(1)+"M"; if(a>=1e3) return "$"+(n/1e3).toFixed(0)+"K"; return "$"+n; }
function fmt$(n){ return n==null ? "—" : "$"+Number(n).toLocaleString("en-US"); }
function fmtN(n){ return n==null ? "—" : Number(n).toLocaleString("en-US"); }
function pct(n,dp){ return (n>=0?"+":"")+n.toFixed(dp==null?1:dp)+"%"; }
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }

function sel(){ return state.towns; }
function td(t){ return state.data.towns[t]; }
function expTotal(t,yr){ var e=td(t).expenditures[yr]; return e?e.total:null; }
function expPC(t,yr){ var e=td(t).exp_per_capita; return e?e[yr]:null; }
function yoy(t){ var a=expTotal(t,"2024"), b=expTotal(t,"2025"); return (a&&b)?(b/a-1)*100:null; }

function metricVal(t){
  if(state.metric==="percapita") return expPC(t,state.year);
  if(state.metric==="taxrate") return td(t).tax_rate_fy2025;
  if(state.metric==="taxbill") return td(t).avg_sf_bill_fy2025;
  return expTotal(t,state.year);
}
function metricFmt(v){
  if(state.metric==="taxrate") return v==null?"—":"$"+v.toFixed(2);
  if(state.metric==="total") return fmtM(v);
  return fmt$(v);
}

/* ---------- shell ---------- */
function render(){
  var host=document.getElementById("view");
  if(!state.data){ host.innerHTML='<div class="mny"><p style="padding:40px 16px;color:var(--muted)">Loading town finance data…</p></div>'; load(); return; }
  var h='<div class="mny">';
  h+='<div class="mny-hero"><h1>Money</h1><p>Budgets. Appropriations. Town finances across South County.</p></div>';
  h+=tabs();
  h+='<div class="mny-layout">';
  h+=rail();
  h+='<div class="mny-main">';
  if(state.tab==="overview") h+=overview();
  else if(state.tab==="budgets") h+=budgets();
  else if(state.tab==="compare") h+=compare();
  else if(state.tab==="approp") h+=approp();
  else if(state.tab==="docs") h+=docs();
  h+='<p class="mny-foot">Data: Massachusetts Division of Local Services Municipal Databank — Schedule A general fund actuals (FY2023–FY2025) and FY2025 tax data, pulled Sep 15, 2026. Figures are actual reported general fund expenditures, not adopted budgets. <a href="https://www.mass.gov/lists/schedule-a-reports-revenues-expenditures-and-more" target="_blank" rel="noopener">About Schedule A →</a></p>';
  h+='</div></div></div>';
  host.innerHTML=h;
}

function tabs(){
  var t=[["overview","Overview"],["budgets","Town Budgets"],["compare","Compare"],["approp","Appropriations"],["docs","Documents"]];
  var h='<div class="mny-tabs" role="tablist">';
  for(var i=0;i<t.length;i++) h+='<button class="mny-tab'+(state.tab===t[i][0]?" on":"")+'" data-mny="tab" data-v="'+t[i][0]+'" role="tab" type="button">'+t[i][1]+'</button>';
  return h+'</div>';
}

function rail(){
  var openOnLoad = !window.matchMedia || window.matchMedia("(min-width:900px)").matches;
  var h='<aside class="mny-rail"><details'+(openOnLoad?' open':'')+'><summary>Filters</summary>';
  h+='<div class="mny-fgroup"><h4>Towns</h4>';
  h+='<label class="mny-check"><input type="checkbox" data-mny="alltowns"'+(state.towns.length===TOWNS.length?" checked":"")+'> All towns (11)</label>';
  for(var i=0;i<TOWNS.length;i++){
    var t=TOWNS[i], on=state.towns.indexOf(t)>=0;
    h+='<label class="mny-check"><input type="checkbox" data-mny="town" data-v="'+esc(t)+'"'+(on?" checked":"")+'> '+esc(t)+'</label>';
  }
  h+='</div>';
  h+='<div class="mny-fgroup"><h4>Fiscal year</h4><select class="mny-select" data-mny="year">';
  for(var y=0;y<YEARS.length;y++) h+='<option value="'+YEARS[y]+'"'+(state.year===YEARS[y]?" selected":"")+'>FY'+YEARS[y].slice(2)+' (actual)</option>';
  h+='</select></div>';
  h+='<div class="mny-fgroup"><h4>Data type</h4>';
  h+='<label class="mny-check"><input type="checkbox" checked disabled> Actuals (DLS Schedule A)</label>';
  var soon=["Proposed budget","Adopted budget","Town meeting warrant","Annual report / audit","Finance committee","Capital plan"];
  for(var s=0;s<soon.length;s++) h+='<label class="mny-check soon"><input type="checkbox" disabled> '+soon[s]+'<span class="mny-soon">soon</span></label>';
  h+='</div>';
  h+='<div class="mny-fgroup"><h4>Metric</h4><select class="mny-select" data-mny="metric">';
  var m=[["total","Total expenditures"],["percapita","Per capita spending"],["taxrate","Tax rate (FY25)"],["taxbill","Avg SF tax bill (FY25)"]];
  for(var k=0;k<m.length;k++) h+='<option value="'+m[k][0]+'"'+(state.metric===m[k][0]?" selected":"")+'>'+m[k][1]+'</option>';
  h+='</select></div>';
  h+='<button class="mny-apply" data-mny="apply" type="button">Apply filters</button>';
  h+='<p class="mny-srcnote">Data comes from the Massachusetts DLS Municipal Databank (Schedule A actuals). Budget documents and warrants are being added. <a href="https://dlsgateway.dor.state.ma.us/reports/rdPage.aspx?rdReport=CommunityPage" target="_blank" rel="noopener">Source →</a></p>';
  h+='</details></aside>';
  return h;
}

/* ---------- overview ---------- */
function overview(){
  var ts=sel(), yr=state.year, prev=yr==="2025"?"2024":(yr==="2024"?"2023":null);
  var tot=0,n=0,pcs=[],bills=[];
  for(var i=0;i<ts.length;i++){ var v=expTotal(ts[i],yr); if(v!=null){tot+=v;n++;} var p=expPC(ts[i],yr); if(p!=null)pcs.push(p); var b=td(ts[i]).avg_sf_bill_fy2025; if(b!=null)bills.push(b); }
  var chg=null;
  if(prev){ var tp=0; for(var j=0;j<ts.length;j++){ var a=expTotal(ts[j],prev); if(a!=null)tp+=a; } if(tp) chg=(tot/tp-1)*100; }
  pcs.sort(function(a,b){return a-b;}); bills.sort(function(a,b){return a-b;});
  var medPc=pcs.length?pcs[Math.floor(pcs.length/2)]:null, medBill=bills.length?bills[Math.floor(bills.length/2)]:null;

  var h='<div class="mny-tiles">';
  h+=tile(ts.length,"Towns","in South County");
  h+=tile(fmtM(tot),"Total expenditures","FY"+yr.slice(2)+" GF actuals, selected towns");
  h+=tile(fmt$(medBill),"Median tax bill","FY25 avg single-family");
  h+=tile(chg==null?"—":pct(chg),"Avg. spending change",prev?("FY"+prev.slice(2)+" → FY"+yr.slice(2)):"",chg!=null&&chg>0);
  h+='</div>';

  h+='<div class="mny-grid2">';
  h+='<div class="mny-card">'+barCard()+'</div>';
  h+='<div class="mny-card">'+metricsCard()+'</div>';
  h+='</div>';
  h+='<div class="mny-grid2">';
  h+='<div class="mny-card">'+yoyCard()+'</div>';
  h+='<div class="mny-card">'+donutCard()+'</div>';
  h+='</div>';
  h+='<div class="mny-card">'+docsCard(true)+'</div>';
  h+='<div class="mny-navcards">';
  h+=navcard("budgets","Explore Town Budgets","Revenue and spending detail for each town","📄");
  h+=navcard("compare","Compare Towns","Side-by-side spending, tax rates, and more","📊");
  h+=navcard("approp","Appropriations Tracker","Where the money goes, by function","⚖");
  h+='</div>';
  return h;
}
function tile(v,l,s,up){ return '<div class="mny-tile"><div class="v'+(up?" up":"")+'">'+v+'</div><div class="l">'+l+'</div><div class="s">'+s+'</div></div>'; }
function navcard(tab,t,s,ic){ return '<button class="mny-navcard" data-mny="tab" data-v="'+tab+'" type="button"><span class="ic" aria-hidden="true">'+ic+'</span><span><span class="t">'+t+'</span><br><span class="s">'+s+'</span></span><span class="ar">→</span></button>'; }

function barCard(){
  var ts=sel().slice().sort(function(a,b){return (metricVal(b)||0)-(metricVal(a)||0);});
  var max=0,i; for(i=0;i<ts.length;i++){ var v=metricVal(ts[i]); if(v!=null&&v>max)max=v; }
  var title={total:"Total Expenditures by Town",percapita:"Per Capita Spending by Town",taxrate:"FY25 Residential Tax Rate by Town",taxbill:"FY25 Avg Single-Family Tax Bill"}[state.metric];
  var h='<h3>'+title+'</h3><p class="sub">FY'+state.year.slice(2)+' actual · Massachusetts DLS Schedule A</p><div class="mny-bars">';
  for(i=0;i<ts.length;i++){ var t=ts[i],v=metricVal(t); var w=max?Math.max(1.5,(v/max)*100):0;
    h+='<div class="mny-bar-row"><span class="nm">'+esc(t)+'</span><span class="mny-bar-track"><span class="mny-bar-fill" style="width:'+w.toFixed(1)+'%"></span></span><span class="val">'+metricFmt(v)+'</span></div>'; }
  return h+'</div>';
}

function metricsCard(){
  var h='<h3>Key Metrics (FY'+state.year.slice(2)+')</h3><p class="sub">General fund actuals · tax figures FY25</p><div class="mny-table-fitwrap"><table class="mny-table mny-table-fit"><thead><tr><th>Town</th><th>Total</th><th>Per cap.</th><th>Rate</th><th>Avg bill</th></tr></thead><tbody>';
  var ts=sel().slice().sort(function(a,b){return (expTotal(b,state.year)||0)-(expTotal(a,state.year)||0);});
  for(var i=0;i<ts.length;i++){ var t=ts[i];
    h+='<tr><td>'+esc(t)+'</td><td>'+fmtM(expTotal(t,state.year))+'</td><td>'+fmt$(expPC(t,state.year))+'</td><td>'+(td(t).tax_rate_fy2025!=null?"$"+td(t).tax_rate_fy2025.toFixed(2):"—")+'</td><td>'+fmt$(td(t).avg_sf_bill_fy2025)+'</td></tr>'; }
  return h+'</tbody></table></div>';
}

function yoyCard(){
  var h='<h3>Year-over-Year Change in Total Spending</h3><p class="sub">FY24 → FY25 · DLS Schedule A</p>';
  var ts=sel(),rows=[];
  for(var i=0;i<ts.length;i++){ var c=yoy(ts[i]); if(c!=null) rows.push([ts[i],c]); }
  rows.sort(function(a,b){return b[1]-a[1];});
  var max=0; for(i=0;i<rows.length;i++) max=Math.max(max,Math.abs(rows[i][1]));
  if(!max) max=1;
  for(i=0;i<rows.length;i++){ var t=rows[i][0],c=rows[i][1]; var w=(Math.abs(c)/max)*100;
    h+='<div class="mny-yoy-row"><span class="nm">'+esc(t)+'</span>'+
       '<span class="mny-yoy-l">'+(c<0?'<span class="mny-yoy-fill neg" style="width:'+w.toFixed(1)+'%"></span>':"")+'</span>'+
       '<span class="mny-yoy-r">'+(c>=0?'<span class="mny-yoy-fill pos" style="width:'+w.toFixed(1)+'%"></span>':"")+'</span>'+
       '<span class="val">'+pct(c)+'</span></div>'; }
  return h;
}

function donutCard(){
  var ts=sel(),yr=state.year,sums={},tot=0,i;
  for(i=0;i<FUNCS.length;i++) sums[FUNCS[i][0]]=0;
  for(i=0;i<ts.length;i++){ var e=td(ts[i]).expenditures[yr]; if(!e) continue; for(var f=0;f<FUNCS.length;f++){ sums[FUNCS[f][0]]+=e[FUNCS[f][0]]||0; } tot+=e.total||0; }
  var cx=90,cy=90,r=70,ir=42,a0=-Math.PI/2,paths="";
  var fr=sums["fixed_costs"]+sums["intergov"]+sums["other"];
  var cats=[]; for(i=0;i<7;i++) cats.push([FUNCS[i][0],FUNCS[i][1],FUNC_COLORS[i],sums[FUNCS[i][0]]]);
  cats.push(["otherx","Other (fixed costs, intergov., misc.)","#a8a092",fr]);
  for(i=0;i<cats.length;i++){ var frac=tot?cats[i][3]/tot:0; if(frac<=0) continue; var a1=a0+frac*2*Math.PI;
    var large=frac>0.5?1:0;
    var x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0),x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
    var xi1=cx+ir*Math.cos(a1),yi1=cy+ir*Math.sin(a1),xi0=cx+ir*Math.cos(a0),yi0=cy+ir*Math.sin(a0);
    paths+='<path d="M'+x0.toFixed(1)+' '+y0.toFixed(1)+' A'+r+' '+r+' 0 '+large+' 1 '+x1.toFixed(1)+' '+y1.toFixed(1)+' L'+xi1.toFixed(1)+' '+yi1.toFixed(1)+' A'+ir+' '+ir+' 0 '+large+' 0 '+xi0.toFixed(1)+' '+yi0.toFixed(1)+' Z" fill="'+cats[i][2]+'"/>';
    a0=a1; }
  var h='<h3>Spending by Function ('+(ts.length===11?"All Towns":ts.length+" Town"+(ts.length>1?"s":""))+')</h3><p class="sub">FY'+yr.slice(2)+' actual · DLS Schedule A</p>';
  h+='<div class="mny-donut-wrap"><svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Spending by function donut chart">'+paths+
     '<text x="90" y="86" text-anchor="middle" font-family="Georgia,serif" font-size="17" font-weight="700" fill="#24492f">'+fmtM(tot)+'</text>'+
     '<text x="90" y="102" text-anchor="middle" font-size="9.5" fill="#7a7263">total expenditures</text></svg>';
  h+='<div class="mny-legend">';
  cats.sort(function(a,b){return b[3]-a[3];});
  for(i=0;i<cats.length;i++){ if(cats[i][3]<=0) continue; h+='<span class="li"><span class="dot" style="background:'+cats[i][2]+'"></span>'+cats[i][1]+'<span class="pct">'+(tot?(cats[i][3]/tot*100).toFixed(1):"0")+'%</span></span>'; }
  return h+'</div></div>';
}

function docsCard(compact){
  var docs=(state.data.documents||[]);
  var h='<h3>Recent Finance Documents'+(compact?'':'')+'</h3><p class="sub">Verified official town sources · more being added</p>';
  if(!docs.length){ return h+'<p class="sub">Documents are being collected from town websites. The figures above are complete and official.</p>'; }
  for(var i=0;i<docs.length;i++){ var d=docs[i];
    h+='<a class="mny-doc" href="'+esc(d.url)+'" target="_blank" rel="noopener"><span class="ic">PDF</span><span><span class="t">'+esc(d.title)+'</span><span class="m">'+esc(d.town)+' · '+esc(d.date)+'</span></span></a>'; }
  return h;
}

/* ---------- town budgets ---------- */
function budgets(){
  var h='<div class="mny-card"><h3>Town Budgets</h3><p class="sub">FY'+state.year.slice(2)+' general fund actuals with FY25 revenue and tax detail · DLS</p></div>';
  var ts=sel();
  for(var i=0;i<ts.length;i++){ var t=ts[i],d=td(t),e=d.expenditures[state.year],r=d.revenues_fy2025;
    h+='<div class="mny-card"><h3>'+esc(t)+'</h3><p class="sub">Population '+fmtN(d.population)+' (2023) · FY25 tax rate '+(d.tax_rate_fy2025!=null?"$"+d.tax_rate_fy2025.toFixed(2):"—")+' · avg SF bill '+fmt$(d.avg_sf_bill_fy2025)+(d.bond_ratings&&d.bond_ratings.length?' · bond rating '+esc(d.bond_ratings.join(" / ")):'')+'</p>';
    h+='<div class="mny-scroll"><table class="mny-table"><thead><tr><th>Function</th><th>FY24</th><th>FY'+state.year.slice(2)+'</th><th>Per capita</th><th>Share</th></tr></thead><tbody>';
    if(e){ for(var f=0;f<FUNCS.length;f++){ var k=FUNCS[f][0]; var prev=d.expenditures["2024"];
      h+='<tr><td>'+FUNCS[f][1]+'</td><td>'+fmtM(prev?prev[k]:null)+'</td><td>'+fmtM(e[k])+'</td><td>'+fmt$(e[k]&&d.population?Math.round(e[k]/d.population):null)+'</td><td>'+(e.total?(e[k]/e.total*100).toFixed(1)+'%':"—")+'</td></tr>'; }
      h+='<tr><td><strong>Total</strong></td><td><strong>'+fmtM(d.expenditures["2024"]?d.expenditures["2024"].total:null)+'</strong></td><td><strong>'+fmtM(e.total)+'</strong></td><td><strong>'+fmt$(expPC(t,state.year))+'</strong></td><td></td></tr>'; }
    h+='</tbody></table></div>';
    if(r){ h+='<p class="sub" style="margin-top:12px">FY25 actual revenues: taxes '+fmtM(r.taxes)+' · state aid '+fmtM(r.state)+' · local & other '+fmtM((r.service_charges||0)+(r.licenses_permits||0)+(r.miscellaneous||0)+(r.fines||0)+(r.transfers||0)+(r.other_govts||0))+' · total '+fmtM(r.total)+'</p>'; }
    if(d.free_cash_2024_07_01!=null){ h+='<p class="sub">Free cash (7/1/2024): '+fmtM(d.free_cash_2024_07_01)+(d.stabilization_fy2024?' · stabilization fund FY24: '+fmtM(d.stabilization_fy2024):'')+'</p>'; }
    h+='</div>'; }
  return h;
}

/* ---------- compare ---------- */
function compare(){
  var metrics=[["expenditures","Total GF spending (FY"+state.year.slice(2)+")",function(t){return expTotal(t,state.year);},fmtM],
               ["percapita","Per capita spending (FY"+state.year.slice(2)+")",function(t){return expPC(t,state.year);},fmt$],
               ["taxrate","Residential tax rate (FY25)",function(t){return td(t).tax_rate_fy2025;},function(v){return v==null?"—":"$"+v.toFixed(2);}],
               ["taxbill","Avg single-family tax bill (FY25)",function(t){return td(t).avg_sf_bill_fy2025;},fmt$],
               ["sfvalue","Avg single-family home value (FY25)",function(t){return td(t).avg_sf_value_fy2025;},fmt$],
               ["income","DOR income per capita (2022)",function(t){return td(t).income_per_capita_2022;},fmt$]];
  var h='<div class="mny-card"><h3>Compare Towns</h3><p class="sub">'+sel().length+' towns selected in the filter rail</p></div>';
  for(var m=0;m<metrics.length;m++){
    var ts=sel().slice().sort(function(a,b){return (metrics[m][2](b)||0)-(metrics[m][2](a)||0);});
    var max=0,i; for(i=0;i<ts.length;i++){ var v=metrics[m][2](ts[i]); if(v!=null&&v>max)max=v; }
    h+='<div class="mny-card"><h3>'+metrics[m][1]+'</h3><div class="mny-bars">';
    for(i=0;i<ts.length;i++){ var t=ts[i],v=metrics[m][2](t); var w=max?Math.max(1.5,(v/max)*100):0;
      h+='<div class="mny-bar-row"><span class="nm">'+esc(t)+'</span><span class="mny-bar-track"><span class="mny-bar-fill" style="width:'+w.toFixed(1)+'%"></span></span><span class="val">'+metrics[m][3](v)+'</span></div>'; }
    h+='</div></div>'; }
  return h;
}

/* ---------- appropriations ---------- */
function approp(){
  var h='<div class="mny-card"><h3>Appropriations by Function</h3><p class="sub">FY'+state.year.slice(2)+' general fund expenditures, Schedule A actuals · select towns in the filter rail</p>';
  h+='<div class="mny-scroll"><table class="mny-table"><thead><tr><th>Function</th>';
  var ts=sel(); for(var i=0;i<ts.length;i++) h+='<th>'+esc(ts[i])+'</th>';
  h+='<th>Total</th></tr></thead><tbody>';
  for(var f=0;f<FUNCS.length;f++){ var k=FUNCS[f][0],row=0;
    h+='<tr><td>'+FUNCS[f][1]+'</td>';
    for(i=0;i<ts.length;i++){ var e=td(ts[i]).expenditures[state.year]; var v=e?e[k]:null; row+=v||0; h+='<td>'+fmtM(v)+'</td>'; }
    h+='<td><strong>'+fmtM(row)+'</strong></td></tr>'; }
  h+='<tr><td><strong>Total</strong></td>'; var g=0;
  for(i=0;i<ts.length;i++){ var e2=td(ts[i]).expenditures[state.year]; var tv=e2?e2.total:null; g+=tv||0; h+='<td><strong>'+fmtM(tv)+'</strong></td>'; }
  h+='<td><strong>'+fmtM(g)+'</strong></td></tr></tbody></table></div></div>';
  return h;
}

/* ---------- documents ---------- */
function docs(){ return '<div class="mny-card">'+docsCard(false)+'</div>'; }

/* ---------- events ---------- */
document.addEventListener("click",function(ev){
  var el=ev.target.closest("[data-mny]"); if(!el) return;
  var kind=el.getAttribute("data-mny");
  if(kind==="tab"){ state.tab=el.getAttribute("data-v"); render(); return; }
  if(kind==="alltowns"){ state.towns=el.checked?TOWNS.slice():[]; render(); return; }
  if(kind==="apply"){ render(); return; }
});
document.addEventListener("change",function(ev){
  var el=ev.target.closest("[data-mny]"); if(!el) return;
  var kind=el.getAttribute("data-mny");
  if(kind==="town"){
    var t=el.getAttribute("data-v"), i=state.towns.indexOf(t);
    if(el.checked&&i<0) state.towns.push(t);
    if(!el.checked&&i>=0) state.towns.splice(i,1);
    if(!state.towns.length) state.towns=[t], el.checked=true; // never zero towns
    render(); return;
  }
  if(kind==="year"){ state.year=el.value; render(); return; }
  if(kind==="metric"){ state.metric=el.value; render(); return; }
});

/* ---------- load ---------- */
var loaded=false;
function load(){
  if(loaded) return; loaded=true;
  fetch("data/money.json").then(function(r){ if(!r.ok) throw new Error("money.json "+r.status); return r.json(); })
    .then(function(j){ state.data=j; render(); })
    .catch(function(e){ var host=document.getElementById("view"); if(host) host.innerHTML='<div class="mny"><p style="padding:40px 16px;color:var(--rust)">Could not load town finance data ('+esc(e.message)+').</p></div>'; });
}

window.BMMoney={ render:render };
})();
