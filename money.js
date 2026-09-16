/* ============================================================
   Money tab v2 - "Find a story" front page for South County
   town budgets. Chart-forward: visuals lead, text serves.
   Real data only: MA DLS Municipal Databank (Schedule A
   general-fund actuals FY2023-25, FY2025 Community Snapshot
   tax data), pulled 2026-09-15. Loaded from data/money.json.
   ============================================================ */
(function(){
"use strict";

var state = { data:null, topic:"all" };

function fmtM(n){ if(n==null) return "\u2014"; var a=Math.abs(n); if(a>=1e6) return "$"+(n/1e6).toFixed(1)+"M"; if(a>=1e3) return "$"+(n/1e3).toFixed(0)+"K"; return "$"+n; }
function fmt$(n){ return n==null ? "\u2014" : "$"+Math.round(n).toLocaleString("en-US"); }
function fmtN(n){ return n==null ? "\u2014" : Math.round(n).toLocaleString("en-US"); }
function pct(n,dp){ return (n>=0?"+":"")+n.toFixed(dp==null?1:dp)+"%"; }
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
function median(a){ var b=a.slice().sort(function(x,y){return x-y;}); var m=b.length>>1; return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function svgEl(tag,attrs,parent){ var e=document.createElementNS("http://www.w3.org/2000/svg",tag); for(var k in attrs) e.setAttribute(k,attrs[k]); if(parent) parent.appendChild(e); return e; }
function svgText(parent,x,y,str,attrs){ var t=svgEl("text",attrs||{},parent); t.setAttribute("x",x); t.setAttribute("y",y); t.textContent=str; return t; }

var MIX_COLORS = {
  education:"#2b5ea6", public_safety:"#b0483a", public_works:"#c08a1d",
  general_government:"#6b8f71", fixed_costs:"#7a5ea6", debt_service:"#4a8a8a",
  community:"#a66a2b", other:"#b3ab9e"
};
var INK="#1c1a17", FAINT="#8a8578", LINE="#d8d2c4", GREEN="#2f5d3f", RUST="#b0483a";

/* ================= shell ================= */
function render(){
  var host=document.getElementById("view");
  if(!state.data){
    host.innerHTML='<div class="mny"><p style="padding:40px 16px;color:var(--muted)">Loading town finance data\u2026</p></div>';
    load(); return;
  }
  var d=state.data;
  var h='<div class="mny">';
  h+='<header class="mny-hero"><div class="mny-eyebrow">Town money \u00b7 South County</div>'
    +'<h1>Find a story in the numbers.</h1>'
    +'<p>General-fund budgets of the 11 South County towns this site covers, FY2023\u201325. Every figure from the Massachusetts Division of Local Services, pulled Sep 15, 2026.</p></header>';
  h+='<nav class="mny-pills" id="mny-pills">'
    +pill("all","All questions")+pill("spending","Spending")+pill("taxes","Taxes")
    +pill("change","Change over time")+pill("prop25","Prop 2\u00bd")+pill("profiles","Town profiles")
    +'<a class="mny-pill mny-pill-link" href="#mny-method">Methodology</a></nav>';
  h+='<main id="mny-stories"></main>';
  h+=methodology();
  h+='</div>';
  host.innerHTML=h;

  var stories=document.getElementById("mny-stories");
  stories.appendChild(story(1,"spending",headlineSpend(),"Per-capita figures divide each town\u2019s FY2025 general-fund spending by its 2023 population estimate.",srcSchedA(),chartPerCapita));
  stories.appendChild(story(2,"taxes",headlineScatter(),"Taxes are the FY2025 total property-tax levy per capita; spending is FY2025 general-fund spending per capita. Dashed lines mark the 11-town medians.",srcSnapshot(),chartScatter));
  stories.appendChild(story(3,"change",headlineChange(),"Dumbbells show general-fund spending per capita, FY2024 \u2192 FY2025. The waterfall breaks the towns\u2019 combined FY2024\u2192FY2025 change into DLS spending categories; small categories are grouped and figures may not sum exactly due to rounding.",srcSchedA(),chartChange));
  stories.appendChild(story(4,"spending",headlineMix(),"Each bar is 100% of one town\u2019s FY2025 general-fund spending, split by DLS category. Education includes assessments to regional school districts.",srcSchedA(),chartMix));
  stories.appendChild(story(5,"prop25",headlineProp25(),"Excess levy capacity as a share of each town\u2019s FY2025 maximum levy limit under Proposition 2\u00bd.",srcSnapshot(),chartProp25,calloutProp25));
  stories.appendChild(story(6,"profiles","Town profiles","General-fund spending, FY2023\u201325, with FY2025 tax and reserve figures. \u201c\u2014\u201d means no bond rating on file with DLS.",srcSnapshot(),chartProfiles));

  var pills=document.getElementById("mny-pills");
  pills.addEventListener("click",function(e){
    var b=e.target.closest("button.mny-pill"); if(!b) return;
    state.topic=b.getAttribute("data-topic");
    var bs=pills.querySelectorAll("button.mny-pill");
    for(var i=0;i<bs.length;i++) bs[i].classList.toggle("on",bs[i]===b);
    var ss=stories.querySelectorAll(".story");
    for(var j=0;j<ss.length;j++){
      var t=ss[j].getAttribute("data-topic");
      ss[j].style.display=(state.topic==="all"||t===state.topic)?"":"none";
    }
  });
}
function pill(t,l){ return '<button type="button" class="mny-pill'+(t==="all"?" on":"")+'" data-topic="'+t+'">'+l+'</button>'; }

function story(num,topic,headline,caption,source,chartFn,calloutFn){
  var s=document.createElement("section");
  s.className="story"; s.setAttribute("data-topic",topic);
  s.innerHTML='<div class="story-head-row"><span class="story-num">'+num+'</span>'
    +'<h2 class="story-head">'+headline+'</h2></div>'
    +'<div class="story-chart"></div>'
    +'<p class="story-cap">'+caption+'</p>'
    +'<p class="story-src">'+source+'</p>';
  var box=s.querySelector(".story-chart");
  chartFn(box);
  if(calloutFn){ var c=calloutFn(); if(c) s.insertBefore(c,s.querySelector(".story-cap")); }
  return s;
}
function srcSchedA(){ return 'SOURCE: MA DLS MUNICIPAL DATABANK \u00b7 SCHEDULE A GENERAL FUND, FY2023\u201325 ACTUALS \u00b7 PULLED SEP 15, 2026'; }
function srcSnapshot(){ return 'SOURCE: MA DLS MUNICIPAL DATABANK \u00b7 COMMUNITY SNAPSHOTS & SCHEDULE A, FY2023\u201325 \u00b7 PULLED SEP 15, 2026'; }

/* ================= headlines (computed from data) ================= */
function headlineSpend(){
  var t=state.data.towns.slice().sort(function(a,b){return b.spend_per_capita-a.spend_per_capita;});
  var top=t[0], bot=t[t.length-1];
  return esc(top.name)+' spends '+fmt$(top.spend_per_capita)+' per resident \u2014 '+esc(bot.name)+', '+fmt$(bot.spend_per_capita)+'.';
}
function headlineScatter(){ return 'More taxes don\u2019t always buy more spending.'; }
function headlineChange(){
  var t=state.data.towns.slice().sort(function(a,b){return b.change_pct-a.change_pct;});
  var up=t[0], down=t[t.length-1];
  return esc(up.name)+' grew its budget '+up.change_pct.toFixed(1)+'% in one year; '+esc(down.name)+' cut '+Math.abs(down.change_pct).toFixed(1)+'%.';
}
function headlineMix(){
  var t=state.data.towns.slice().sort(function(a,b){return (b.mix.education/b.fy25_total)-(a.mix.education/a.fy25_total);});
  var hi=t[0], lo=t[t.length-1];
  return 'Education is the biggest slice everywhere \u2014 from '+Math.round(lo.mix.education/lo.fy25_total*100)+'% in '+esc(lo.name)+' to '+Math.round(hi.mix.education/hi.fy25_total*100)+'% in '+esc(hi.name)+'.';
}
function headlineProp25(){
  var t=state.data.towns.slice().sort(function(a,b){return a.headroom_pct-b.headroom_pct;});
  return esc(t[0].name)+' has almost no room left under Prop 2\u00bd.';
}

/* ================= chart 1: per-capita ranked bars ================= */
function chartPerCapita(box){
  var t=state.data.towns.slice().sort(function(a,b){return b.spend_per_capita-a.spend_per_capita;});
  var med=state.data.agg.median_spend_pc;
  var W=640, rowH=30, padL=118, padR=64, padT=10;
  var H=padT+t.length*rowH+26;
  var max=t[0].spend_per_capita*1.02;
  var x=function(v){return padL+(v/max)*(W-padL-padR);};
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":"FY2025 general-fund spending per resident, ranked"},box);
  for(var i=0;i<t.length;i++){
    var y=padT+i*rowH;
    var hl=(i===0||i===t.length-1);
    svgText(s,padL-8,y+rowH/2+4,t[i].name,{fill:INK,"font-size":"12.5","text-anchor":"end","font-weight":hl?"700":"400"});
    svgEl("rect",{x:padL,y:y+5,width:x(t[i].spend_per_capita)-padL,height:rowH-10,rx:7,fill:hl?INK:"#b9b2a4"},s);
  }
  var mx=x(med);
  // median drawn only in the gaps between bars so it never crosses a label
  svgEl("line",{x1:mx,y1:padT-2,x2:mx,y2:padT+4,stroke:RUST,"stroke-width":"1.5"},s);
  for(var g=0;g<t.length-1;g++){
    var gy=padT+(g+1)*rowH;
    svgEl("line",{x1:mx,y1:gy-4,x2:mx,y2:gy+4,stroke:RUST,"stroke-width":"1.5"},s);
  }
  var lastY=padT+t.length*rowH;
  svgEl("line",{x1:mx,y1:lastY-4,x2:mx,y2:H-24,stroke:RUST,"stroke-width":"1.5"},s);
  svgText(s,mx+5,H-8,"South County median "+fmt$(med),{fill:RUST,"font-size":"11.5","font-weight":"600"});
  for(var i2=0;i2<t.length;i2++){
    var y2=padT+i2*rowH;
    var hl2=(i2===0||i2===t.length-1);
    svgText(s,x(t[i2].spend_per_capita)+7,y2+rowH/2+4,fmt$(t[i2].spend_per_capita),{fill:INK,"font-size":"12","font-weight":hl2?"700":"400"});
  }
}

/* ================= chart 2: tax vs spend scatter ================= */
function chartScatter(box){
  var t=state.data.towns;
  var medX=state.data.agg.median_levy_pc, medY=state.data.agg.median_spend_pc;
  var W=640,H=400,padL=56,padR=16,padT=18,padB=42;
  var xs=t.map(function(d){return d.levy_per_capita;}), ys=t.map(function(d){return d.spend_per_capita;});
  var xMin=Math.min.apply(null,xs)*0.94, xMax=Math.max.apply(null,xs)*1.04;
  var yMin=Math.min.apply(null,ys)*0.94, yMax=Math.max.apply(null,ys)*1.05;
  var X=function(v){return padL+(v-xMin)/(xMax-xMin)*(W-padL-padR);};
  var Y=function(v){return H-padB-(v-yMin)/(yMax-yMin)*(H-padT-padB);};
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":"Tax levy per capita versus spending per capita by town"},box);
  // quadrant labels
  svgText(s,padL+8,padT+14,"Good deal?",{fill:FAINT,"font-size":"13","font-style":"italic"});
  svgText(s,W-padR-8,padT+14,"Worth it?",{fill:FAINT,"font-size":"13","font-style":"italic","text-anchor":"end"});
  svgText(s,padL+8,H-padB-10,"Lean and cheap",{fill:FAINT,"font-size":"13","font-style":"italic"});
  svgText(s,W-padR-8,H-padB-10,"Red flag?",{fill:FAINT,"font-size":"13","font-style":"italic","text-anchor":"end"});
  // median lines
  svgEl("line",{x1:X(medX),y1:padT,x2:X(medX),y2:H-padB,stroke:LINE,"stroke-width":"1.5","stroke-dasharray":"5 4"},s);
  svgEl("line",{x1:padL,y1:Y(medY),x2:W-padR,y2:Y(medY),stroke:LINE,"stroke-width":"1.5","stroke-dasharray":"5 4"},s);
  // axes ticks
  for(var i=0;i<=4;i++){
    var xv=xMin+(xMax-xMin)*i/4, yv=yMin+(yMax-yMin)*i/4;
    svgText(s,X(xv),H-padB+16,"$"+Math.round(xv/100)/10+"k",{fill:FAINT,"font-size":"10.5","text-anchor":"middle"});
    svgText(s,padL-8,Y(yv)+4,"$"+Math.round(yv/100)/10+"k",{fill:FAINT,"font-size":"10.5","text-anchor":"end"});
  }
  svgText(s,(padL+W-padR)/2,H-6,"FY2025 tax levy per resident \u2192",{fill:FAINT,"font-size":"11.5","text-anchor":"middle"});
  var ylab=svgText(s,14,(padT+H-padB)/2,"FY2025 spending per resident \u2192",{fill:FAINT,"font-size":"11.5","text-anchor":"middle"});
  ylab.setAttribute("transform","rotate(-90 14 "+((padT+H-padB)/2)+")");
  // dots + labels (nudge labels that collide)
  var placed=[];
  t.forEach(function(d){
    var cx=X(d.levy_per_capita), cy=Y(d.spend_per_capita);
    svgEl("circle",{cx:cx,cy:cy,r:5.5,fill:GREEN,"fill-opacity":"0.9",stroke:"#fff","stroke-width":"1.5"},s);
    var dy=-9, dx=0, anchor="middle";
    for(var i=0;i<placed.length;i++){ var p=placed[i]; if(Math.abs(p[0]-cx)<58&&Math.abs(p[1]-(cy+dy))<13){ dy=17; } }
    placed.push([cx,cy+dy]);
    svgText(s,cx+dx,cy+dy,d.name,{fill:INK,"font-size":"11","text-anchor":anchor});
  });
}

/* ================= chart 3: change dumbbells + waterfall ================= */
function chartChange(box){
  var t=state.data.towns.map(function(d){
    return {name:d.name, pc24:d.fy24_total/d.population, pc25:d.spend_per_capita, chg:d.change_pct};
  }).sort(function(a,b){return b.chg-a.chg;});
  var W=640,rowH=27,padL=118,padR=72,padT=8;
  var H1=padT+t.length*rowH+18;
  var all=[]; t.forEach(function(d){all.push(d.pc24,d.pc25);});
  var vMin=Math.min.apply(null,all)*0.96, vMax=Math.max.apply(null,all)*1.03;
  var X=function(v){return padL+(v-vMin)/(vMax-vMin)*(W-padL-padR);};
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H1,role:"img","aria-label":"Change in per-capita spending, FY2024 to FY2025"},box);
  t.forEach(function(d,i){
    var y=padT+i*rowH+rowH/2;
    var up=d.chg>=0;
    svgText(s,padL-8,y+4,d.name,{fill:INK,"font-size":"12","text-anchor":"end"});
    svgEl("line",{x1:X(d.pc24),y1:y,x2:X(d.pc25),y2:y,stroke:up?GREEN:RUST,"stroke-width":"2.5","stroke-opacity":"0.55"},s);
    svgEl("circle",{cx:X(d.pc24),cy:y,r:4.5,fill:"#fff",stroke:INK,"stroke-width":"1.5"},s);
    svgEl("circle",{cx:X(d.pc25),cy:y,r:4.5,fill:up?GREEN:RUST},s);
    svgText(s,W-6,y+4,pct(d.chg),{fill:up?GREEN:RUST,"font-size":"11.5","font-weight":"700","text-anchor":"end"});
  });
  var leg=svgText(s,padL,H1-3,"\u25cb FY2024   \u25cf FY2025 (per resident)",{fill:FAINT,"font-size":"11"});

  // waterfall of combined FY24->FY25 change
  var wf=state.data.agg.waterfall.slice();
  var top=wf.slice(0,6), rest=wf.slice(6);
  var restDelta=rest.reduce(function(a,w){return a+w.delta;},0);
  if(Math.abs(restDelta)>1) top.push({label:"All other",delta:restDelta});
  var start=state.data.agg.fy24_total, end=state.data.agg.fy25_total;
  var steps=[{label:"FY2024",total:start}];
  var cum=start;
  top.forEach(function(w){ steps.push({label:w.label,delta:w.delta,from:cum,to:cum+w.delta}); cum+=w.delta; });
  steps.push({label:"FY2025",total:end});
  var lo=Math.min(start,end,cum)*0.985, hi=Math.max(start,end)*1.012;
  var n=steps.length, W2=640, H2=250, pL=52, pR=10, pT=14, pB=46;
  var bw=(W2-pL-pR)/n*0.62;
  var Y=function(v){return pT+(hi-v)/(hi-lo)*(H2-pT-pB);};
  var s2=svgEl("svg",{viewBox:"0 0 "+W2+" "+H2,role:"img","aria-label":"What drove the combined change, FY2024 to FY2025"},box);
  steps.forEach(function(st,i){
    var cx=pL+(W2-pL-pR)*(i+0.5)/n;
    if(st.total!=null){
      svgEl("rect",{x:cx-bw/2,y:Y(st.total),width:bw,height:Y(lo)-Y(st.total),rx:4,fill:INK},s2);
      svgText(s2,cx,Y(st.total)-6,fmtM(st.total),{fill:INK,"font-size":"11","font-weight":"700","text-anchor":"middle"});
    } else {
      var y0=Y(Math.max(st.from,st.to)), hgt=Math.abs(Y(st.from)-Y(st.to));
      svgEl("rect",{x:cx-bw/2,y:y0,width:bw,height:Math.max(hgt,2),rx:3,fill:st.delta>=0?GREEN:RUST},s2);
      svgText(s2,cx,y0-5,(st.delta>=0?"+":"\u2212")+fmtM(Math.abs(st.delta)).slice(0),{fill:st.delta>=0?GREEN:RUST,"font-size":"10.5","font-weight":"600","text-anchor":"middle"});
      if(i>0) svgEl("line",{x1:pL+(W2-pL-pR)*(i-0.5)/n+bw/2,y1:Y(st.from),x2:cx-bw/2,y2:Y(st.from),stroke:LINE,"stroke-width":"1","stroke-dasharray":"3 3"},s2);
    }
    var words=st.label.split(" ");
    svgText(s2,cx,H2-pB+16,words[0],{fill:FAINT,"font-size":"10.5","text-anchor":"middle"});
    if(words[1]) svgText(s2,cx,H2-pB+28,words.slice(1).join(" "),{fill:FAINT,"font-size":"10.5","text-anchor":"middle"});
  });
  var cap=document.createElement("div");
  cap.className="story-subhead";
  cap.textContent="What drove the combined change";
  box.appendChild(cap);
  box.appendChild(s2);
}

/* ================= chart 4: spending mix ================= */
function chartMix(box){
  var bands=state.data.agg.bands;
  var t=state.data.towns.slice().sort(function(a,b){return (b.mix.education/b.fy25_total)-(a.mix.education/a.fy25_total);});
  var W=640,rowH=26,padL=118,padR=10,padT=30;
  var H=padT+t.length*rowH+8;
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":"Spending mix by town, FY2025"},box);
  // legend, two rows
  var lx=padL, ly=6;
  bands.forEach(function(b){
    var est=14+b.label.length*6.1+14;
    if(lx+est>W-padR){ lx=padL; ly+=15; }
    svgEl("rect",{x:lx,y:ly,width:10,height:10,rx:3,fill:MIX_COLORS[b.key]},s);
    svgText(s,lx+14,ly+9,b.label,{fill:FAINT,"font-size":"10.5"});
    lx+=est;
  });
  t.forEach(function(d,i){
    var y=padT+i*rowH;
    svgText(s,padL-8,y+rowH/2+4,d.name,{fill:INK,"font-size":"11.5","text-anchor":"end"});
    var x=padL;
    bands.forEach(function(b){
      var share=(d.mix[b.key]||0)/d.fy25_total;
      var w=share*(W-padL-padR);
      if(w>0) svgEl("rect",{x:x,y:y+4,width:w,height:rowH-8,fill:MIX_COLORS[b.key]},s);
      x+=w;
    });
    var ed=Math.round((d.mix.education||0)/d.fy25_total*100);
    svgText(s,padL+6,y+rowH/2+4,ed+"% ed.",{fill:"#fff","font-size":"10","font-weight":"600"});
  });
}

/* ================= chart 5: Prop 2.5 headroom ================= */
function chartProp25(box){
  var t=state.data.towns.slice().sort(function(a,b){return a.headroom_pct-b.headroom_pct;});
  var W=640,rowH=30,padL=118,padR=56,padT=8;
  var H=padT+t.length*rowH+10;
  var max=Math.max.apply(null,t.map(function(d){return d.headroom_pct;}))*1.05;
  var X=function(v){return padL+v/max*(W-padL-padR);};
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":"Levy headroom under Proposition 2 and a half, by town"},box);
  t.forEach(function(d,i){
    var y=padT+i*rowH;
    var low=d.headroom_pct<3;
    svgText(s,padL-8,y+rowH/2+4,d.name,{fill:INK,"font-size":"12.5","text-anchor":"end","font-weight":low?"700":"400"});
    svgEl("rect",{x:padL,y:y+5,width:Math.max(X(d.headroom_pct)-padL,2),height:rowH-10,rx:7,fill:low?RUST:"#b9b2a4"},s);
    svgText(s,X(d.headroom_pct)+7,y+rowH/2+4,d.headroom_pct.toFixed(2)+"%",{fill:low?RUST:INK,"font-size":"12","font-weight":low?"700":"400"});
  });
}
function calloutProp25(){
  var gb=null;
  state.data.towns.forEach(function(d){ if(d.name==="Great Barrington") gb=d; });
  if(!gb) return null;
  var c=document.createElement("div");
  c.className="story-callout";
  c.innerHTML='<strong>Great Barrington can raise just $'+fmtN(gb.excess_capacity)+' more under its levy limit</strong>'
    +' \u2014 '+gb.headroom_pct.toFixed(2)+'% of the maximum \u2014 leaving almost no room to raise additional revenue under Prop 2\u00bd without an override vote.';
  return c;
}

/* ================= chart 6: town profiles ================= */
function chartProfiles(box){
  var grid=document.createElement("div");
  grid.className="mny-profiles";
  state.data.towns.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).forEach(function(d){
    var card=document.createElement("div");
    card.className="mny-profile";
    var spark=sparkline([d.fy23_total,d.fy24_total,d.fy25_total]);
    card.innerHTML='<h3>'+esc(d.name)+'</h3>'
      +'<div class="mny-spark"></div>'
      +'<dl>'
      +row("Population",fmtN(d.population))
      +row("FY25 spending",fmtM(d.fy25_total))
      +row("Per resident",fmt$(d.spend_per_capita))
      +row("Avg tax bill",fmt$(d.avg_sf_bill))
      +row("Levy per resident",fmt$(d.levy_per_capita))
      +row("Prop 2\u00bd headroom",d.headroom_pct.toFixed(2)+"%")
      +row("Free cash",fmtM(d.free_cash))
      +row("Stabilization",fmtM(d.stabilization))
      +row("Bond rating",d.bond_rating?esc(d.bond_rating):"\u2014")
      +'</dl>';
    card.querySelector(".mny-spark").appendChild(spark);
    grid.appendChild(card);
  });
  box.appendChild(grid);
  function row(k,v){ return '<div><dt>'+k+'</dt><dd>'+v+'</dd></div>'; }
}
function sparkline(vals){
  var W=200,H=44,p=6;
  var lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals);
  var X=function(i){return p+i*(W-2*p)/(vals.length-1);};
  var Y=function(v){return hi===lo?H/2:H-p-(v-lo)/(hi-lo)*(H-2*p);};
  var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H});
  var path="M"+vals.map(function(v,i){return X(i).toFixed(1)+","+Y(v).toFixed(1);}).join(" L");
  svgEl("path",{d:path,fill:"none",stroke:INK,"stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round"},s);
  vals.forEach(function(v,i){ svgEl("circle",{cx:X(i),cy:Y(v),r:3,fill:i===vals.length-1?GREEN:"#fff",stroke:INK,"stroke-width":"1.5"},s); });
  svgText(s,X(vals.length-1),Y(vals[vals.length-1])-7,fmtM(vals[vals.length-1]),{fill:INK,"font-size":"10.5","font-weight":"700","text-anchor":"end"});
  svgText(s,X(0),Y(vals[0])+14,fmtM(vals[0]),{fill:FAINT,"font-size":"10"});
  return s;
}

/* ================= methodology ================= */
function methodology(){
  return '<section class="mny-method" id="mny-method"><h2>Methodology</h2><ul>'
    +'<li><strong>Scope.</strong> The 11 South County towns covered by this site: Great Barrington, Sheffield, Egremont, New Marlborough, Monterey, Sandisfield, Otis, Tyringham, Becket, Alford, Richmond.</li>'
    +'<li><strong>General fund only.</strong> Spending and revenue figures are Schedule A general-fund actuals; enterprise funds (water, sewer, ambulance) are excluded.</li>'
    +'<li><strong>Education</strong> includes assessments paid to regional school districts, not just in-town schools.</li>'
    +'<li><strong>Per-capita figures</strong> divide by DLS 2023 population estimates for all years shown.</li>'
    +'<li><strong>Tax figures are FY2025.</strong> \u201cLevy per resident\u201d is the total property-tax levy (all classes) divided by population; \u201cavg tax bill\u201d is the average single-family tax bill.</li>'
    +'<li><strong>Prop 2\u00bd headroom</strong> is excess levy capacity as a share of the maximum levy limit reported to DLS.</li>'
    +'<li><strong>Source.</strong> Massachusetts Division of Local Services, Municipal Databank \u2014 Schedule A (FY2023\u201325) and Community Snapshots (FY2025). Pulled Sep 15, 2026; DLS states its data is current as of 09/15/2026. Town budget documents: <a href="https://www.townofgb.org/600/Town-Budgets">Great Barrington town budgets</a> \u00b7 <a href="https://www.townofgbma.gov/592/FY2027-Budget">FY2027 budget</a> \u00b7 <a href="https://www.townofgbma.gov/619/FY2027-Proposed-Operating-Budget">FY2027 proposed operating budget</a>.</li>'
    +'</ul></section>';
}

/* ================= data ================= */
function load(){
  fetch("data/money.json").then(function(r){return r.json();}).then(function(j){
    state.data=j; render();
  }).catch(function(){
    var host=document.getElementById("view");
    host.innerHTML='<div class="mny"><p style="padding:40px 16px;color:var(--muted)">Could not load town finance data.</p></div>';
  });
}

window.BMMoney={render:render};
})();
