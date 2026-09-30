/* Berkshire Meetings — Property
   Who owns South County: the MassGIS assessment snapshot for the eleven towns,
   told as a story. Region-wide figures come precomputed from
   property-insights.json (built by property-insights.py); the map, the
   sale-versus-assessment scatter and the records table load one town's file
   at a time. Classification rules here mirror property-insights.py — change
   both together. See property-method.md. No dependencies beyond Leaflet. */
(function(){
"use strict";

var V="20260930";
var state={ins:null,loading:false,failed:false,town:"Great Barrington",mode:"density",isolate:"",sel:null,
  market:"region",find:"",tq:"",tuse:"",tmail:"",tsort:"value",tlimit:60};
var cache={},pending={},map=null,layer=null,layerIndex={};

var C={ink:"#17212b",ink2:"#344039",muted:"#65727e",grid:"#dce2e6",line:"#c9d0d4",paper:"#f2f1e9",blue:"#2f72b8",red:"#c84d43",gold:"#d9a232",green:"#3d8b57",purple:"#8060b8",other:"#b3bcc2"};
var USES=["Residential","Commercial / industrial","Vacant land","Farm, forest & recreation","Exempt","Other / mixed"];
var USE_C={"Residential":C.blue,"Commercial / industrial":C.red,"Vacant land":C.gold,"Farm, forest & recreation":C.green,"Exempt":C.purple,"Other / mixed":C.other};
var MAIL=["This town","Elsewhere in MA","New York","Connecticut","Other states","Not listed"];
var MAIL_C={"This town":"#7d888f","Elsewhere in MA":"#c2c9cc","New York":C.blue,"Connecticut":C.gold,"Other states":C.purple,"Not listed":"#e4e7e3","Several owners":"#d6d0c4"};
var AWAY=["New York","Connecticut","Other states"];
var OWN=["Public","Nonprofit / conservation","Private, out of state","Private, local or MA","Private, address not listed"];
var OWN_C={"Public":C.purple,"Nonprofit / conservation":C.green,"Private, out of state":C.blue,"Private, local or MA":"#a8b2b8","Private, address not listed":"#e4e7e3","Private":"#a8b2b8"};
var ALIASES={"Great Barrington":["HOUSATONIC","GT BARRINGTON","GT. BARRINGTON","GREAT BARRINGTON MA"],"Sheffield":["ASHLEY FALLS"],"New Marlborough":["SOUTHFIELD","MILL RIVER","HARTSVILLE"],"Egremont":["SOUTH EGREMONT","NORTH EGREMONT","SO EGREMONT","NO EGREMONT"],"Becket":["NORTH BECKET"],"Otis":["EAST OTIS"]};

/* Map modes. Each classifies one boundary from its linked records. */
var DENSITY=[[0,"Under $10K"],[1e4,"$10K–50K"],[5e4,"$50K–250K"],[2.5e5,"$250K–1M"],[1e6,"$1M–3M"],[3e6,"$3M and up"]];
var DENSITY_C=["#e4edf6","#bcd3ea","#86afd8","#4f89c3","#27609f","#123a66"];
var SALE=[["Before 2000","#efe5d6"],["2000–2009","#e2c49d"],["2010–2019","#cf9663"],["2020–2022","#b25c2c"],["2023 or later","#6e2e12"]];
var BUILT=[["Before 1900","#173f30"],["1900–1949","#2f6e52"],["1950–1979","#5e9a7a"],["1980–1999","#9cc3aa"],["2000 or later","#d7e8dc"]];
var MODES={
  density:{label:"Value per acre",note:"Assessed value divided by mapped parcel area. Dense, valuable land is dark; big, lightly assessed tracts are pale."},
  mail:{label:"Owner’s mailing address",note:"Where the owner of record receives the tax bill. A mailing address is not proof of residency."},
  use:{label:"Land use",note:"Broad group from the state use code on the assessment record."},
  sale:{label:"Last recorded sale",note:"Year of the most recent recorded sale or transfer, including nominal transfers."},
  built:{label:"Year built",note:"Year built on the assessment record. Boundaries with no building recorded have no fill."}
};

/* ---------------------------------------------------------------- helpers */
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function money(v){return v==null?"—":"$"+Math.round(v).toLocaleString("en-US");}
function compact(v){if(v==null)return "—";var a=Math.abs(v);if(a>=1e9)return "$"+(v/1e9).toFixed(2).replace(/0$/,"")+"B";if(a>=1e6)return "$"+(v/1e6).toFixed(a>=1e8?0:1).replace(/\.0$/,"")+"M";if(a>=1e3)return "$"+Math.round(v/1e3)+"K";return "$"+Math.round(v);}
function num(v){return Math.round(v).toLocaleString("en-US");}
function pct(v,d){return (v==null||isNaN(v))?"—":v.toFixed(d==null?0:d)+"%";}
function acres(v){return v>=100?num(v):v>=1?v.toFixed(1):v.toFixed(2);}
function norm(x){return String(x||"").toUpperCase().split(/\s+/).filter(Boolean).join(" ");}
function titleCase(s){return String(s||"").toLowerCase().replace(/\b[a-z]/g,function(c){return c.toUpperCase();});}
function median(a){var b=a.slice().sort(function(x,y){return x-y;}),m=Math.floor(b.length/2);return b.length?(b.length%2?b[m]:(b[m-1]+b[m])/2):null;}
function scale(d0,d1,r0,r1){return function(v){return d0===d1?(r0+r1)/2:r0+(v-d0)/(d1-d0)*(r1-r0);};}
function svgEl(tag,attrs,parent){var e=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.keys(attrs||{}).forEach(function(k){e.setAttribute(k,attrs[k]);});if(parent)parent.appendChild(e);return e;}
function svgText(p,x,y,t,a){a=a||{};a.x=x;a.y=y;if(!a.fill)a.fill=C.ink2;if(!a["font-size"])a["font-size"]=11;var n=svgEl("text",a,p);n.textContent=t;return n;}
function tip(el,text,town){el.setAttribute("data-tip",text);el.setAttribute("tabindex","0");if(town){el.setAttribute("data-town",town);el.setAttribute("role","button");el.setAttribute("aria-label",text.replace(/\n/g,". ")+". Focus "+town+".");}return el;}
function chartHost(label){var d=document.createElement("div");d.className="m-chart";d.setAttribute("role","group");d.setAttribute("aria-label",label);return d;}
function svg(host,W,H,label){var s=svgEl("svg",{viewBox:"0 0 "+W+" "+H,role:"img","aria-label":label},host);svgEl("title",{},s).textContent=label;return s;}
function bar(p,x,y,w,h,fill,round){/* 4px rounded data end, square baseline */var r=Math.min(round==null?3:round,w/2,h/2);if(w<=0)return svgEl("rect",{x:x,y:y,width:0,height:h,fill:fill},p);return svgEl("path",{d:"M"+x+","+y+"h"+(w-r)+"a"+r+","+r+" 0 0 1 "+r+","+r+"v"+(h-2*r)+"a"+r+","+r+" 0 0 1 -"+r+","+r+"h-"+(w-r)+"z",fill:fill},p);}
function legend(items,colors){return '<div class="m-legend p-key">'+items.map(function(k){return '<span><i style="background:'+colors[k]+'"></i>'+esc(k)+'</span>';}).join("")+'</div>';}
function source(extra){var d=state.ins;return '<p class="m-source">MassGIS Property Tax Parcels (assessment table and parcel boundaries) · town fiscal years FY2025–27 · observed '+esc(fmtDate(d.retrieved.slice(0,10)))+(extra?' · '+extra:'')+'</p>';}
function fmtDate(iso){if(!iso)return "";var p=iso.split("-");return ["Jan.","Feb.","March","April","May","June","July","Aug.","Sept.","Oct.","Nov.","Dec."][+p[1]-1]+" "+(+p[2])+", "+p[0];}
function townOf(name){return state.ins.towns.filter(function(t){return t.name===name;})[0];}
function sum(a,f){return a.reduce(function(n,d){return n+f(d);},0);}

/* ------------------------------------------------- classification rules */
function useGroup(code){
  var s=String(code||"").slice(0,3);if(!/^\d{3}$/.test(s))return "Other / mixed";var c=+s;
  if(c>=900)return "Exempt";
  if(c===130||c===131||c===132||(c>=390&&c<=399)||(c>=440&&c<=449))return "Vacant land";
  if(c>=100&&c<200)return "Residential";
  if(c>=300&&c<500)return "Commercial / industrial";
  if(c>=600&&c<900)return "Farm, forest & recreation";
  if(c<100&&/[678]/.test(s.slice(1)))return "Farm, forest & recreation";
  return "Other / mixed";
}
function mailClass(r,town){
  var city=norm(r.OWN_CITY),st=norm(r.OWN_STATE);if(!city||!st)return "Not listed";
  if(st==="MA")return (city===norm(town)||(ALIASES[town]||[]).indexOf(city)>=0)?"This town":"Elsewhere in MA";
  return st==="NY"?"New York":st==="CT"?"Connecticut":"Other states";
}
function saleDate(x){
  var s=String(x||"").trim();if(!/^\d{8}$/.test(s))return "";
  var y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6),dt=new Date(Date.UTC(y,m-1,d)),iso=s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6);
  return y>1900&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d&&iso<=state.ins.retrieved.slice(0,10)?iso:"";
}
function polyAcres(rings){
  var total=0;rings.forEach(function(ring){if(ring.length<4)return;var kx=111320*Math.cos(ring[0][1]*Math.PI/180),ky=110540,a=0;for(var i=0;i<ring.length-1;i++)a+=(ring[i][0]*kx)*(ring[i+1][1]*ky)-(ring[i+1][0]*kx)*(ring[i][1]*ky);total+=a/2;});
  return Math.max(0,-total/4046.8564224);
}
function noMatch(f){return String(f.properties.NO_MATCH||"").toUpperCase()==="Y";}

/* One town's records and boundaries, with derived fields. */
function derive(t,d){
  var area={},perLoc={},index={};
  d.geometry.features.forEach(function(f){f.properties._acres=polyAcres(f.geometry.coordinates);if(!noMatch(f))area[f.properties.LOC_ID]=(area[f.properties.LOC_ID]||0)+f.properties._acres;});
  d.records.forEach(function(r){if(r.LOC_ID)perLoc[r.LOC_ID]=(perLoc[r.LOC_ID]||0)+1;});
  d.records.forEach(function(r){
    r._use=useGroup(r.USE_CODE);r._mail=mailClass(r,t.name);r._acres=r.LOC_ID&&area[r.LOC_ID]?area[r.LOC_ID]/perLoc[r.LOC_ID]:0;
    r._sale=saleDate(r.LS_DATE);r._built=r.YEAR_BUILT&&r.YEAR_BUILT>1700&&r.YEAR_BUILT<=+state.ins.retrieved.slice(0,4)?r.YEAR_BUILT:null;
    r._owner=norm(r.OWNER1)||"[OWNER NOT LISTED]";r._hay=(String(r.SITE_ADDR||"")+" "+r._owner+" "+(r.PROP_ID||"")+" "+(r.LOC_ID||"")).toUpperCase();
    if(r.LOC_ID)(index[r.LOC_ID]||(index[r.LOC_ID]=[])).push(r);
  });
  d.index=index;d.area=area;return d;
}
function linked(f,d){return noMatch(f)?[]:(d.index[f.properties.LOC_ID]||[]);}

/* Classify a boundary for the current map mode: returns [key,color] or null. */
function classify(f,d){
  var rs=linked(f,d);if(!rs.length)return null;
  var m=state.mode,uniq=function(k){var s={};rs.forEach(function(r){s[r[k]]=1;});return Object.keys(s);};
  if(m==="density"){var a=d.area[f.properties.LOC_ID]||0,v=sum(rs,function(r){return r.TOTAL_VAL||0;});if(a<=0)return null;var i=0;while(i<DENSITY.length-1&&v/a>=DENSITY[i+1][0])i++;return [DENSITY[i][1],DENSITY_C[i]];}
  if(m==="mail"){var u=uniq("_mail");return u.length===1?[u[0],MAIL_C[u[0]]]:["Several owners",MAIL_C["Several owners"]];}
  if(m==="use"){var g=uniq("_use"),k=g.length===1?g[0]:"Other / mixed";return [k,USE_C[k]];}
  if(m==="sale"){var last=rs.map(function(r){return r._sale;}).filter(Boolean).sort().pop();if(!last)return null;var y=+last.slice(0,4),j=y<2000?0:y<2010?1:y<2020?2:y<2023?3:4;return SALE[j];}
  if(m==="built"){var b=Math.max.apply(null,rs.map(function(r){return r._built||0;}));if(!b)return null;var n=b<1900?0:b<1950?1:b<1980?2:b<2000?3:4;return BUILT[n];}
  return null;
}
function modeKeys(){
  if(state.mode==="density")return DENSITY.map(function(d,i){return [d[1],DENSITY_C[i]];});
  if(state.mode==="mail")return MAIL.concat(["Several owners"]).map(function(k){return [k,MAIL_C[k]];});
  if(state.mode==="use")return USES.map(function(k){return [k,USE_C[k]];});
  return state.mode==="sale"?SALE:BUILT;
}

/* ------------------------------------------------------------ rendering */
function render(){
  var host=document.getElementById("view");
  if(map){map.remove();map=null;layer=null;}
  if(!state.ins){
    host.innerHTML='<div class="m-loading">Loading the property snapshot…</div>';
    if(!state.loading){state.loading=true;fetch("property-insights.json?v="+V).then(function(r){if(!r.ok)throw Error(r.status);return r.json();}).then(function(d){state.ins=d;state.loading=false;if(isActive())render();}).catch(function(){state.loading=false;if(isActive())host.innerHTML='<div class="m-loading p-error">The property snapshot could not be loaded. Reload to try again.</div>';});}
    return;
  }
  var d=state.ins,r=d.region,t=townOf(state.town)||d.towns[0];state.town=t.name;
  var resKnown=sum(d.towns,function(x){return x.res_known;}),resAway=sum(d.towns,function(x){return x.res_away;});
  var comm=r.landholders[0],s19=r.sales["2019"],s25=r.sales["2025"];
  host.innerHTML='<div class="mny prop" id="property-analysis">'
    +'<header class="m-hero"><div class="m-kicker">South County property records</div>'
    +'<h1>Who owns South County.</h1>'
    +'<p>'+num(r.records)+' assessment records across eleven towns, mapped parcel by parcel. Follow the land, the value, the sales and the addresses where the tax bills go.</p>'
    +'<div class="m-data-strip">'
      +stat(compact(r.value),"assessed value","all records, incl. exempt")
      +stat(pct(resAway/resKnown*100),"of homes","mail tax bills out of state")
      +stat(num(comm.acres),"acres","held by the Commonwealth")
      +stat("+"+pct((s25.sf_median/s19.sf_median-1)*100),"home sale price","median, 2019 to 2025")
    +'</div></header>'
    +controls(t)
    +'<main class="m-story" id="p-story"></main>'
    +methodology()
    +'<div class="m-tooltip" id="p-tip" role="status"></div></div>';
  var story=document.getElementById("p-story");
  story.appendChild(block("map","wide",'<span id="p-map-h">'+esc(t.name)+', parcel by parcel.</span>',"",mapBlock,true));
  story.appendChild(block("mail","wide",mailHeadline(),"Homes (residential assessment records) by where the owner of record receives the tax bill, sorted by the out-of-state share. A mailing address is the best public signal of second-home ownership, but it is not proof of where anyone lives.",chartMail));
  story.appendChild(block("nyct","half",nyctHeadline(),"Share of each town’s homes whose tax bill goes to New York or Connecticut.",chartNyCt));
  story.appendChild(block("cities","half",citiesHeadline(t),"The most common mailing cities for "+esc(t.name)+" homes owned from outside town. Counts are assessment records.",chartCities));
  story.appendChild(block("landvalue","wide",landValueHeadline(),"Each town’s mapped land (top bar) and assessed value (bottom bar) split by use. Homes carry most of the value on a sliver of the land; exempt and current-use land (Chapter 61 forest, farm and recreation) is the reverse.",chartLandValue));
  story.appendChild(block("holders","half",holdersHeadline(),"The largest landholders across all eleven towns, by mapped acres. Public and conservation owners appear under one name across their label variants; everyone else is grouped only by identical owner labels.",chartHolders));
  story.appendChild(block("owners","half",ownersHeadline(),"Share of each town’s mapped acres by owner type. Owner type comes from a name screen and the exempt use code, not a verified legal status.",chartOwnerClass));
  story.appendChild(block("market","wide",marketHeadline(),"Each property’s most recent recorded sale, by year. Nominal transfers (under $1,000, usually to a family member or trust) are shown separately. A property that sold twice counts only once, in the later year, so older years are undercounted.",chartMarket));
  story.appendChild(block("prices","half",pricesHeadline(),"Median last-recorded sale price of single-family homes (use code 101, price of $25,000 or more).",chartPrices));
  story.appendChild(block("buyers","half",buyersHeadline(),"Share of home sales (residential, $1,000 or more) recorded to an owner label that names an LLC or corporation, or a trust or trustee.",chartBuyers));
  story.appendChild(block("ratio","wide",'<span id="p-ratio-h">'+esc(ratioHeadline(t))+'</span>',"Recent single-family sales in "+esc(t.name)+" against the current assessment on the same record. Points above the line sold for more than the assessment. Sales from two years before the fiscal year onward, the window assessors use.",chartRatio,true));
  story.appendChild(block("top","half",topHeadline(t),"The fifteen owner labels with the most assessed value in "+esc(t.name)+". Labels are grouped only when they match exactly.",chartTop));
  story.appendChild(block("built","half",builtHeadline(),"Year built for homes. The bar spans the middle half of homes; the thin line runs from the 10th to the 90th percentile; the dot is the median.",chartBuilt));
  story.appendChild(block("records","wide","Search every "+esc(t.name)+" record.","Every assessment record in the snapshot. Filter, sort, click a row to find it on the map, or download what you see as a spreadsheet.",recordsBlock,true));
  bind(document.getElementById("property-analysis"));
  ensureTown(t,function(){if(isActive()&&state.town===t.name)townReady(t);});
}
function isActive(){var b=document.querySelector('#views button[data-view="property"]');return b&&b.classList.contains("active");}
function stat(value,label,note){return '<div class="m-stat"><strong>'+value+'</strong><span>'+label+'</span><small>'+note+'</small></div>';}
function controls(t){
  var opts=state.ins.towns.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(d){return '<option'+(d.name===t.name?' selected':'')+'>'+esc(d.name)+'</option>';}).join("");
  return '<div class="m-controlbar"><label>Focus town<select id="p-town">'+opts+'</select></label>'
    +'<div class="m-control-note"><strong>'+esc(t.name)+'</strong> is highlighted in every chart. Click any town to switch.</div>'
    +'<nav class="p-jump" aria-label="Sections"><button type="button" data-jump="map">Map</button><button type="button" data-jump="mail">Owners</button><button type="button" data-jump="landvalue">Land</button><button type="button" data-jump="market">Sales</button><button type="button" data-jump="records">Records</button></nav></div>';
}
function block(id,size,title,sub,fn,deferred){
  var s=document.createElement("section");s.className="m-block m-"+size;s.id="ps-"+id;
  s.innerHTML='<header><h2>'+title+'</h2>'+(sub?'<p>'+sub+'</p>':'')+'</header>';
  var body=document.createElement("div");body.className="p-body";s.appendChild(body);
  if(deferred)body.innerHTML='<p class="p-status">Loading '+esc(state.town)+' records and parcel boundaries…</p>';else body.appendChild(fn());
  s._fn=fn;s.insertAdjacentHTML("beforeend",source(id==="holders"||id==="landvalue"||id==="owners"?"acres from simplified parcel boundaries":""));
  return s;
}
function refill(id){var s=document.getElementById("ps-"+id);if(!s)return;var b=s.querySelector(".p-body");b.innerHTML="";b.appendChild(s._fn());}

function ensureTown(t,cb){
  if(cache[t.id])return cb();
  if(pending[t.id]){pending[t.id].push(cb);return;}
  pending[t.id]=[cb];
  fetch("property-"+t.id+".json?v="+V).then(function(r){if(!r.ok)throw Error(r.status);return r.json();}).then(function(d){cache[t.id]=derive(t,d);var q=pending[t.id];delete pending[t.id];q.forEach(function(f){f();});})
    .catch(function(){delete pending[t.id];["map","ratio","records"].forEach(function(id){var s=document.getElementById("ps-"+id);if(s)s.querySelector(".p-body").innerHTML='<p class="p-status p-error">'+esc(t.name)+' records could not be loaded. Reload to try again.</p>';});});
}
function townReady(){["map","ratio","records"].forEach(refill);var h=document.getElementById("p-ratio-h");if(h)h.textContent=ratioHeadline(townOf(state.town));drawMap();}

/* ================================================================ the map */
function mapBlock(){
  var h=document.createElement("div"),t=townOf(state.town);
  h.innerHTML='<div class="m-switch p-modes" role="group" aria-label="Map color">'+Object.keys(MODES).map(function(k){return '<button type="button" data-mode="'+k+'" class="'+(state.mode===k?'on':'')+'">'+MODES[k].label+'</button>';}).join("")+'</div>'
    +'<p class="p-mode-note" id="p-mode-note"></p>'
    +'<div class="p-map-layout"><div class="p-map-col"><div class="p-find"><input id="p-find" type="search" autocomplete="off" placeholder="Find an address, owner or parcel ID in '+esc(t.name)+'" aria-label="Find a parcel" value="'+esc(state.find)+'"><div id="p-find-results" class="p-find-results" role="listbox"></div></div>'
    +'<div id="p-map" class="p-map" aria-label="'+esc(t.name)+' parcel map"></div><div id="p-map-legend" class="p-map-legend"></div><p class="p-note" id="p-map-count"></p></div>'
    +'<aside class="p-detail" id="p-detail" aria-live="polite"></aside></div>';
  return h;
}
function drawMap(){
  var host=document.getElementById("p-map"),t=townOf(state.town),d=cache[t.id];if(!host||!d)return;
  if(!window.L){paintLegend();showDetail();host.innerHTML='<p class="p-status">The map library is still loading…</p>';setTimeout(drawMap,400);return;}
  if(map){map.remove();map=null;}
  map=L.map(host,{preferCanvas:true,scrollWheelZoom:false,zoomSnap:.25});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19}).addTo(map);
  layerIndex={};
  layer=L.geoJSON(d.geometry,{renderer:L.canvas({padding:.3}),style:function(f){return styleFor(f,d);},onEachFeature:function(f,l){var loc=f.properties.LOC_ID;if(loc)(layerIndex[loc]||(layerIndex[loc]=[])).push(l);l.on("click",function(){select(loc,f);});}}).addTo(map);
  if(layer.getBounds().isValid())map.fitBounds(layer.getBounds(),{padding:[6,6]});
  paintLegend();showDetail();
}
function styleFor(f,d){
  var c=classify(f,d),sel=state.sel&&f.properties.LOC_ID===state.sel,dim=state.isolate&&(!c||c[0]!==state.isolate);
  if(sel)return {color:C.ink,weight:2.6,fillColor:c?c[1]:"#fff",fillOpacity:c?.95:.2,opacity:1};
  if(!c)return {color:"#9aa5ad",weight:.35,fillOpacity:0,opacity:.55};
  return {color:"#ffffff",weight:.35,opacity:dim?.25:.8,fillColor:c[1],fillOpacity:dim?.08:.82};
}
function restyle(){if(!layer)return;var d=cache[townOf(state.town).id];layer.setStyle(function(f){return styleFor(f,d);});paintLegend();}
function paintLegend(){
  var t=townOf(state.town),d=cache[t.id],el=document.getElementById("p-map-legend");if(!el||!d)return;
  var counts={},ac={},none=0,totalAc=0;d.geometry.features.forEach(function(f){var c=classify(f,d);totalAc+=f.properties._acres;if(!c){none++;return;}counts[c[0]]=(counts[c[0]]||0)+1;ac[c[0]]=(ac[c[0]]||0)+f.properties._acres;});
  el.innerHTML='<div class="m-legend">'+modeKeys().filter(function(k){return counts[k[0]];}).map(function(k){return '<button type="button" data-isolate="'+esc(k[0])+'" class="'+(state.isolate===k[0]?'on':'')+'" title="'+num(counts[k[0]])+' boundaries · '+num(ac[k[0]])+' acres"><i style="background:'+k[1]+'"></i>'+esc(k[0])+' <small>'+pct(ac[k[0]]/totalAc*100)+' of land</small></button>';}).join("")+(state.isolate?'<button type="button" class="m-reset" data-isolate="">Show all</button>':'')+'</div>';
  document.getElementById("p-mode-note").textContent=MODES[state.mode].note+" Click a legend item to isolate it.";
  document.getElementById("p-map-count").textContent=num(d.geometry.features.length)+" mapped boundaries; "+num(none)+" have no fill for this view (no linked record, a source NO_MATCH flag, or no data for this measure). Shapes are simplified for the web and are not survey boundaries.";
}
function select(loc,f){
  state.sel=loc||null;restyle();showDetail();
  if(loc&&layerIndex[loc]&&window.innerWidth<850){var el=document.getElementById("p-detail");if(el)el.scrollIntoView({behavior:"smooth",block:"nearest"});}
}
function zoomTo(loc){
  var ls=layerIndex[loc];if(!ls||!map)return false;var b=L.latLngBounds([]);ls.forEach(function(l){b.extend(l.getBounds());});
  map.fitBounds(b,{maxZoom:17,padding:[40,40]});select(loc);return true;
}
function showDetail(){
  var el=document.getElementById("p-detail"),t=townOf(state.town),d=cache[t.id];if(!el||!d)return;
  if(!state.sel){
    var res=t.uses.Residential;
    el.innerHTML='<h4>Select a parcel.</h4><p>Click any shape on the map, or search above, to see the owner of record, mailing address, assessment, acreage, last recorded sale and year built.</p>'
      +'<dl class="p-facts"><dt>Records</dt><dd>'+num(t.records)+'</dd><dt>Assessed value</dt><dd>'+compact(t.value)+'</dd><dt>Mapped land</dt><dd>'+num(t.acres)+' acres</dd><dt>Homes</dt><dd>'+num(res.n)+'</dd><dt>Homes owned from out of state</dt><dd>'+pct(t.away_share)+'</dd><dt>Fiscal year</dt><dd>'+t.fy.map(function(f){return "FY"+f;}).join(", ")+'</dd></dl>';
    return;
  }
  var rs=d.index[state.sel]||[],a=d.area[state.sel]||0;
  if(!rs.length){el.innerHTML='<h4>Unmatched boundary</h4><p>This shape has no usable linked assessment record, or the source flags it NO_MATCH. No owner or value is assigned.</p><p class="p-mono">'+esc(state.sel)+'</p><button type="button" class="p-textbtn" data-clear-sel>Clear selection</button>';return;}
  var v=sum(rs,function(r){return r.TOTAL_VAL||0;}),first=rs[0],shown=layerIndex[state.sel];
  var html='<p class="p-eyebrow">'+esc(t.name)+(rs.length>1?' · '+rs.length+' records share this boundary':'')+'</p><h4>'+esc(first.SITE_ADDR||"No site address")+'</h4>'
    +(shown||!map?'':'<p class="p-note">No mapped boundary matches this record.</p>')+'<dl class="p-facts"><dt>Assessed value</dt><dd>'+money(v)+'</dd><dt>Mapped area</dt><dd>'+acres(a)+' acres</dd><dt>Value per acre</dt><dd>'+(a>0?money(v/a):"—")+'</dd></dl>';
  rs.slice(0,8).forEach(function(r){
    html+='<div class="p-record"><p class="p-owner">'+esc(r._owner)+'</p><p class="p-mail"><i style="background:'+MAIL_C[r._mail]+'"></i>'+(r._mail==="Not listed"?"Mailing address not listed":"Mails to "+esc(titleCase(r.OWN_CITY))+", "+esc(norm(r.OWN_STATE)))+'</p>'
      +'<dl class="p-facts"><dt>Use</dt><dd><i class="p-dot" style="background:'+USE_C[r._use]+'"></i>'+esc(r._use)+' <span class="p-code">'+esc(r.USE_CODE)+'</span></dd>'
      +'<dt>Assessed</dt><dd>'+money(r.TOTAL_VAL)+'</dd><dt>Land · building</dt><dd>'+compact(r.LAND_VAL)+' · '+compact(r.BLDG_VAL)+'</dd>'
      +'<dt>Year built</dt><dd>'+(r._built||"—")+'</dd><dt>Last recorded sale</dt><dd>'+(r._sale?esc(r._sale)+(r.LS_PRICE?' · '+money(r.LS_PRICE):''):"—")+'</dd>'
      +'<dt>Property ID</dt><dd class="p-code">'+esc(r.PROP_ID)+' · FY'+esc(r.FY)+'</dd></dl></div>';
  });
  if(rs.length>8)html+='<p class="p-note">'+(rs.length-8)+' more records on this boundary appear in the records table below.</p>';
  el.innerHTML=html+'<button type="button" class="p-textbtn" data-clear-sel>Clear selection</button>';
}
function findResults(){
  var box=document.getElementById("p-find-results"),t=townOf(state.town),d=cache[t.id];if(!box||!d)return;
  var q=state.find.trim().toUpperCase();if(q.length<2){box.innerHTML="";box.classList.remove("open");return;}
  var terms=q.split(/\s+/),hits=d.records.filter(function(r){return terms.every(function(w){return r._hay.indexOf(w)>=0;});});
  box.classList.add("open");
  box.innerHTML=hits.length?hits.slice(0,8).map(function(r){return '<button type="button" role="option" data-loc="'+esc(r.LOC_ID||"")+'"><strong>'+esc(r.SITE_ADDR||r.PROP_ID)+'</strong><span>'+esc(r._owner)+' · '+compact(r.TOTAL_VAL)+'</span></button>';}).join("")+(hits.length>8?'<p>'+num(hits.length)+' matches. Keep typing, or use the records table below.</p>':''):'<p>No records match.</p>';
}

/* ======================================================== owners & mail */
function mailHeadline(){var t=state.ins.towns.slice().sort(function(a,b){return b.away_share-a.away_share;})[0];return "In "+t.name+", "+pct(t.away_share)+" of homes send the tax bill out of state.";}
function chartMail(){
  var h=chartHost("Homes by owner mailing address, by town"),towns=state.ins.towns.slice().sort(function(a,b){return b.away_share-a.away_share;});
  var order=AWAY.concat(["Elsewhere in MA","This town"]);
  h.insertAdjacentHTML("beforeend",legend(order,MAIL_C));
  var W=940,L=140,R=128,T=10,row=33,H=T+towns.length*row+26,X=scale(0,1,L,W-R),s=svg(h,W,H,"Stacked bars of home ownership by mailing address");
  svgText(s,W-R+14,T-1,"Out of state",{fill:C.muted,"font-size":10,"font-weight":700});
  towns.forEach(function(t,i){
    var y=T+i*row+8,on=t.name===state.town,x=0;
    svgText(s,L-12,y+13,t.name,{"text-anchor":"end","font-size":13,"font-weight":on?750:500,fill:on?C.ink:C.ink2});
    order.forEach(function(k){var n=t.mail[k].n,w=n/t.res_known;if(!n)return;var r=svgEl("rect",{x:X(x)+(x>0?1:0),y:y,width:Math.max(.5,X(x+w)-X(x)-(x>0?1:0)-1),height:18,fill:MAIL_C[k],opacity:on||!state.town?1:.9},s);tip(r,t.name+" · "+k+"\n"+num(n)+" homes ("+pct(w*100,1)+")\nAssessed "+compact(t.mail[k].value),t.name);if(k==="New York"&&w>.07)svgText(s,X(x)+6,y+13,pct(w*100),{fill:"#fff","font-size":10.5,"font-weight":700,"pointer-events":"none"});x+=w;});
    svgText(s,W-R+14,y+14,pct(t.away_share),{"font-size":13,"font-weight":750,fill:C.ink});
    svgText(s,W-R+52,y+14,num(t.res_away)+" of "+num(t.res_known),{"font-size":10,fill:C.muted});
    if(on)svgEl("rect",{x:4,y:y-5,width:W-8,height:28,fill:"none",stroke:C.ink,"stroke-width":1,rx:3,"pointer-events":"none"},s);
  });
  [0,.25,.5,.75,1].forEach(function(v){svgText(s,X(v),H-4,pct(v*100),{"text-anchor":v===0?"start":v===1?"end":"middle","font-size":10,fill:C.muted});});
  h.appendChild(tableToggle(["Town","Homes","This town","Elsewhere in MA","New York","Connecticut","Other states","Not listed","Out-of-state share","Out-of-state share of home value"],towns.map(function(t){return [t.name,num(t.res_records)].concat(MAIL.map(function(k){return num(t.mail[k].n);})).concat([pct(t.away_share,1),pct(t.away_value_share,1)]);})));
  return h;
}
function nyctHeadline(){var ct=state.ins.towns.filter(function(t){return t.mail.Connecticut.n>t.mail["New York"].n;}).map(function(t){return t.name;});return ct.length?"Connecticut outnumbers New York only in "+ct.join(" and ")+".":"New York dominates every town.";}
function chartNyCt(){
  var h=chartHost("New York and Connecticut shares of homes by town"),towns=state.ins.towns.map(function(t){return {name:t.name,ny:t.mail["New York"].n/t.res_known*100,ct:t.mail.Connecticut.n/t.res_known*100,t:t};}).sort(function(a,b){return (b.ny-b.ct)-(a.ny-a.ct);});
  h.insertAdjacentHTML("beforeend",legend(["New York","Connecticut"],MAIL_C));
  var W=610,L=130,R=30,T=24,row=31,H=T+towns.length*row+24,max=Math.ceil(Math.max.apply(null,towns.map(function(d){return Math.max(d.ny,d.ct);}))/5)*5,X=scale(0,max,L,W-R),s=svg(h,W,H,"Dot plot of New York and Connecticut shares");
  for(var g=0;g<=max;g+=5){svgEl("line",{x1:X(g),x2:X(g),y1:T-8,y2:H-20,stroke:C.grid},s);svgText(s,X(g),H-5,g+"%",{"text-anchor":"middle","font-size":10,fill:C.muted});}
  towns.forEach(function(d,i){
    var y=T+i*row+8,on=d.name===state.town;
    svgText(s,L-12,y+4,d.name,{"text-anchor":"end","font-size":12,"font-weight":on?750:500,fill:on?C.ink:C.ink2});
    svgEl("line",{x1:X(Math.min(d.ny,d.ct)),x2:X(Math.max(d.ny,d.ct)),y1:y,y2:y,stroke:on?C.ink:"#b8c0c5","stroke-width":on?2.5:2},s);
    [["ny","New York"],["ct","Connecticut"]].forEach(function(k){var c=svgEl("circle",{cx:X(d[k[0]]),cy:y,r:on?6.5:5.5,fill:MAIL_C[k[1]],stroke:C.paper,"stroke-width":2},s);tip(c,d.name+" · "+k[1]+"\n"+num(d.t.mail[k[1]].n)+" homes ("+pct(d[k[0]],1)+")",d.name);});
    if(i===0){svgText(s,X(d.ny),y-11,"NY",{"text-anchor":"middle","font-size":9.5,"font-weight":700,fill:C.muted});svgText(s,X(d.ct),y-11,"CT",{"text-anchor":"middle","font-size":9.5,"font-weight":700,fill:C.muted});}
  });
  return h;
}
function citiesHeadline(t){var c=t.cities[0];return c?(c[0]==="New York, NY"?"New York City":c[0])+" is the top out-of-town address for "+t.name+" homes.":"No mailing cities recorded.";}
function chartCities(){
  var t=townOf(state.town),h=chartHost("Most common owner mailing cities for "+t.name+" homes"),list=t.cities.slice(0,10);
  var cls=function(c){var st=c.slice(-2);return st==="MA"?"Elsewhere in MA":st==="NY"?"New York":st==="CT"?"Connecticut":"Other states";};
  h.insertAdjacentHTML("beforeend",legend(["Elsewhere in MA","New York","Connecticut","Other states"],MAIL_C));
  var W=610,L=170,R=70,T=6,row=30,H=T+list.length*row+8,max=list.length?list[0][1]:1,X=scale(0,max,0,W-L-R),s=svg(h,W,H,"Bar chart of mailing cities");
  list.forEach(function(c,i){var y=T+i*row;svgText(s,L-12,y+17,c[0],{"text-anchor":"end","font-size":12});var b=bar(s,L,y+5,Math.max(2,X(c[1])),18,MAIL_C[cls(c[0])]);tip(b,c[0]+"\n"+num(c[1])+" "+t.name+" homes ("+pct(c[1]/t.res_known*100,1)+" of homes with an address)");svgText(s,L+X(c[1])+7,y+18,num(c[1]),{"font-size":11.5,"font-weight":700,fill:C.ink});});
  if(!list.length)h.innerHTML='<p class="p-status">No mailing cities recorded.</p>';
  return h;
}

/* ========================================================== land & value */
function landValueHeadline(){var ts=state.ins.towns,a=sum(ts,function(t){return t.uses.Residential.acres;})/sum(ts,function(t){return t.acres;})*100,v=sum(ts,function(t){return t.uses.Residential.value;})/sum(ts,function(t){return t.value;})*100;return "Homes sit on "+pct(a)+" of the land and carry "+pct(v)+" of the value.";}
function chartLandValue(){
  var h=chartHost("Share of land and share of assessed value by use, by town"),towns=state.ins.towns.slice().sort(function(a,b){return b.uses.Residential.value/b.value-a.uses.Residential.value/a.value;});
  h.insertAdjacentHTML("beforeend",legend(USES,USE_C));
  var W=940,L=190,R=16,T=8,row=46,H=T+towns.length*row+22,X=scale(0,1,L,W-R),s=svg(h,W,H,"Paired stacked bars: land and value by use");
  towns.forEach(function(t,i){
    var y=T+i*row,on=t.name===state.town;
    svgText(s,L-58,y+22,t.name,{"text-anchor":"end","font-size":13,"font-weight":on?750:500,fill:on?C.ink:C.ink2});
    [["acres","land",t.acres],["value","value",t.value]].forEach(function(m,j){
      var yy=y+6+j*17,x=0;svgText(s,L-8,yy+10,m[1],{"text-anchor":"end","font-size":9.5,fill:C.muted});
      USES.forEach(function(u){var v=t.uses[u][m[0]],w=v/m[2];if(w<=0)return;var r=svgEl("rect",{x:X(x)+(x>0?1:0),y:yy,width:Math.max(.5,X(x+w)-X(x)-(x>0?1:0)-1),height:13,fill:USE_C[u]},s);tip(r,t.name+" · "+u+"\n"+pct(t.uses[u].acres/t.acres*100,1)+" of land ("+num(t.uses[u].acres)+" acres)\n"+pct(t.uses[u].value/t.value*100,1)+" of value ("+compact(t.uses[u].value)+")\n"+num(t.uses[u].n)+" records",t.name);x+=w;});
    });
    if(on)svgEl("rect",{x:4,y:y+1,width:W-8,height:42,fill:"none",stroke:C.ink,"stroke-width":1,rx:3,"pointer-events":"none"},s);
  });
  [0,.5,1].forEach(function(v){svgText(s,X(v),H-4,pct(v*100),{"text-anchor":v===0?"start":v===1?"end":"middle","font-size":10,fill:C.muted});});
  var rows=[];towns.forEach(function(t){USES.forEach(function(u){rows.push([t.name,u,num(t.uses[u].n),num(t.uses[u].acres),pct(t.uses[u].acres/t.acres*100,1),money(t.uses[u].value),pct(t.uses[u].value/t.value*100,1)]);});});
  h.appendChild(tableToggle(["Town","Use","Records","Acres","Share of land","Assessed value","Share of value"],rows));
  return h;
}
function holdersHeadline(){var l=state.ins.region.landholders[0];return "The state holds "+num(l.acres)+" acres, "+pct(l.share,0)+" of all mapped land.";}
function chartHolders(){
  var h=chartHost("Largest landholders across eleven towns by acres"),list=state.ins.region.landholders.slice(0,15),types=["Public","Nonprofit / conservation","Private"];
  h.insertAdjacentHTML("beforeend",legend(types,OWN_C));
  var W=610,L=236,R=70,T=4,row=27,H=T+list.length*row+6,X=scale(0,list[0].acres,0,W-L-R),s=svg(h,W,H,"Bar chart of the largest landholders");
  list.forEach(function(d,i){
    var y=T+i*row,name=d.name.length>34?d.name.slice(0,33)+"…":d.name,inTown=(d.towns.filter(function(x){return x[0]===state.town;})[0]||[0,0])[1];
    svgText(s,L-10,y+16,name,{"text-anchor":"end","font-size":11,fill:inTown?C.ink:C.ink2,"font-weight":inTown?700:500});
    var b=bar(s,L,y+5,Math.max(2,X(d.acres)),16,OWN_C[d.type]);
    if(inTown)svgEl("rect",{x:L,y:y+5,width:Math.max(2,X(inTown)),height:16,fill:"none",stroke:C.ink,"stroke-width":1.4,"pointer-events":"none"},s);
    tip(b,d.name+"\n"+num(d.acres)+" acres · "+compact(d.value)+" assessed · "+num(d.records)+" records\n"+d.towns.slice(0,5).map(function(x){return x[0]+": "+num(x[1])+" ac";}).join(" · ")+(d.label_count>1?"\n"+d.label_count+" owner-label variants":""));
    svgText(s,L+X(d.acres)+6,y+17,num(d.acres),{"font-size":11,"font-weight":700,fill:C.ink});
  });
  var note=document.createElement("p");note.className="p-note";note.innerHTML='Outlined segment = acres in <strong>'+esc(state.town)+'</strong>. Hover for each owner’s towns.';h.appendChild(note);
  h.appendChild(tableToggle(["Owner","Type","Acres","Share of mapped land","Assessed","Records","Towns"],state.ins.region.landholders.map(function(d){return [d.name,d.type,num(d.acres),pct(d.share,1),money(d.value),num(d.records),d.towns.map(function(x){return x[0]+" ("+num(x[1])+")";}).join(", ")];})));
  return h;
}
function ownersHeadline(){var t=state.ins.towns.slice().sort(function(a,b){return (b.land_owner["Private, out of state"]||0)/b.acres-(a.land_owner["Private, out of state"]||0)/a.acres;})[0];return "Out-of-state owners hold "+pct((t.land_owner["Private, out of state"]||0)/t.acres*100)+" of "+t.name+"’s land.";}
function chartOwnerClass(){
  var h=chartHost("Share of land by owner type, by town"),towns=state.ins.towns.slice().sort(function(a,b){return (b.land_owner["Private, out of state"]||0)/b.acres-(a.land_owner["Private, out of state"]||0)/a.acres;}),order=["Private, out of state","Private, local or MA","Nonprofit / conservation","Public"];
  h.insertAdjacentHTML("beforeend",legend(order,OWN_C));
  var W=610,L=130,R=12,T=6,row=31,H=T+towns.length*row+22,X=scale(0,1,L,W-R),s=svg(h,W,H,"Stacked bars of land by owner type");
  towns.forEach(function(t,i){var y=T+i*row+5,on=t.name===state.town,x=0,tot=sum(OWN,function(k){return t.land_owner[k]||0;});
    svgText(s,L-10,y+13,t.name,{"text-anchor":"end","font-size":12,"font-weight":on?750:500,fill:on?C.ink:C.ink2});
    order.concat(["Private, address not listed"]).forEach(function(k){var v=t.land_owner[k]||0,w=v/tot;if(w<=0)return;var r=svgEl("rect",{x:X(x)+(x>0?1:0),y:y,width:Math.max(.5,X(x+w)-X(x)-(x>0?1:0)-1),height:18,fill:OWN_C[k]},s);tip(r,t.name+" · "+k+"\n"+num(v)+" acres ("+pct(w*100,1)+" of mapped land)",t.name);if(w>.09)svgText(s,X(x)+5,y+13,pct(w*100),{fill:k==="Private, local or MA"?C.ink:"#fff","font-size":10,"font-weight":700,"pointer-events":"none"});x+=w;});
    if(on)svgEl("rect",{x:4,y:y-5,width:W-8,height:28,fill:"none",stroke:C.ink,"stroke-width":1,rx:3,"pointer-events":"none"},s);
  });
  [0,.5,1].forEach(function(v){svgText(s,X(v),H-4,pct(v*100),{"text-anchor":v===0?"start":v===1?"end":"middle","font-size":10,fill:C.muted});});
  h.appendChild(tableToggle(["Town"].concat(OWN).concat(["Mapped acres"]),towns.map(function(t){return [t.name].concat(OWN.map(function(k){return pct((t.land_owner[k]||0)/t.acres*100,1);})).concat([num(t.acres)]);})));
  return h;
}
function topHeadline(t){var v=sum(t.top_owners,function(o){return o.value;});return "Fifteen owners hold "+pct(v/t.value*100)+" of "+t.name+"’s assessed value.";}
function chartTop(){
  var t=townOf(state.town),h=chartHost("Largest owners by assessed value in "+t.name),max=t.top_owners[0].value;
  h.innerHTML='<table class="p-table p-top"><thead><tr><th>Owner of record</th><th class="num">Records</th><th class="num">Acres</th><th class="p-barcol">Assessed value</th></tr></thead><tbody>'
    +t.top_owners.map(function(o){return '<tr><td><i class="p-dot" style="background:'+OWN_C[o.type]+'" title="'+esc(o.type)+'"></i>'+esc(o.name)+'</td><td class="num">'+num(o.n)+'</td><td class="num">'+acres(o.acres)+'</td><td class="p-barcol"><span class="p-inbar"><i style="width:'+(o.value/max*100)+'%;background:'+OWN_C[o.type]+'"></i></span><b>'+compact(o.value)+'</b></td></tr>';}).join("")+'</tbody></table>'
    +legend(["Public","Nonprofit / conservation","Private"],OWN_C);
  return h;
}

/* ================================================================ market */
function marketHeadline(){var s=state.ins.region.sales,a=s["2019"].n,b=s["2020"].n;return "2020 set the record: "+num(b)+" last-recorded sales, "+pct((b/a-1)*100)+" more than 2019.";}
function chartMarket(){
  var t=townOf(state.town),region=state.market==="region",src=region?state.ins.region.sales:t.sales,h=chartHost("Last recorded sales by year");
  h.innerHTML='<div class="m-switch" role="group" aria-label="Area"><button type="button" data-market="region" class="'+(region?'on':'')+'">All eleven towns</button><button type="button" data-market="town" class="'+(!region?'on':'')+'">'+esc(t.name)+'</button></div>'+legend(["Sale of $1,000 or more","Nominal transfer"],{"Sale of $1,000 or more":C.blue,"Nominal transfer":"#b9c1c6"});
  var years=[];for(var y=1995;y<=2026;y++)years.push(y);
  var W=940,L=46,R=14,T=26,B=30,H=300,max=Math.max.apply(null,years.map(function(y){return (src[y]||{n:0}).n;}))||1,step=max>600?200:max>200?50:max>60?20:5,top=Math.ceil(max/step)*step,Y=scale(0,top,H-B,T),bw=(W-L-R)/years.length,s=svg(h,W,H,"Column chart of last recorded sales by year");
  for(var g=0;g<=top;g+=step){svgEl("line",{x1:L,x2:W-R,y1:Y(g),y2:Y(g),stroke:C.grid},s);svgText(s,L-6,Y(g)+4,num(g),{"text-anchor":"end","font-size":10,fill:C.muted});}
  svgEl("rect",{x:L+(2020-1995)*bw,y:T-18,width:bw*3,height:H-B-T+18,fill:"#e9e3d2",opacity:.7},s);svgText(s,L+(2020-1995)*bw+bw*1.5,T-6,"Pandemic years",{"text-anchor":"middle","font-size":10,"font-weight":700,fill:C.muted});
  years.forEach(function(y,i){var d=src[y]||{n:0,nominal:0},priced=d.n-d.nominal,x=L+i*bw+2,w=bw-4;
    var a=svgEl("rect",{x:x,y:Y(priced),width:w,height:Y(0)-Y(priced),fill:C.blue,opacity:y===2026?.45:1},s);
    var b=svgEl("rect",{x:x,y:Y(d.n),width:w,height:Math.max(0,Y(priced)-Y(d.n)-1),fill:"#b9c1c6",opacity:y===2026?.45:1},s);
    [a,b].forEach(function(r){tip(r,(region?"Eleven towns":t.name)+", "+y+(y===2026?" (through the snapshot date)":"")+"\n"+num(d.n)+" last-recorded sales\n"+num(priced)+" at $1,000 or more · "+num(d.nominal)+" nominal");});
    if(y%5===0||y===2026)svgText(s,x+w/2,H-B+15,y===2026?"’26":y,{"text-anchor":"middle","font-size":10,fill:C.muted});
  });
  var peak=years.reduce(function(a,y){return (src[y]||{n:0}).n>(src[a]||{n:0}).n?y:a;},1995);svgText(s,L+(peak-1995)*bw+bw/2,Y(src[peak].n)-5,num(src[peak].n),{"text-anchor":"middle","font-size":11,"font-weight":750,fill:C.ink});
  h.appendChild(tableToggle(["Year","Last-recorded sales","$1,000 or more","Nominal (<$1,000)"],years.filter(function(y){return src[y];}).map(function(y){var d=src[y];return [y,num(d.n),num(d.n-d.nominal),num(d.nominal)];})));
  return h;
}
function pricesHeadline(){var s=state.ins.region.sales;return "The median recorded home sale rose "+pct((s["2025"].sf_median/s["2019"].sf_median-1)*100)+" from 2019 to 2025, to "+compact(s["2025"].sf_median)+".";}
function chartPrices(){
  var t=townOf(state.town),r=state.ins.region.sales,h=chartHost("Median single-family sale price by year"),years=[];for(var y=2005;y<=2025;y++)years.push(y);
  var focus=t.name+" (years with 5+ sales)";var col={};col["All eleven towns"]=C.ink;col[focus]=C.blue;
  h.insertAdjacentHTML("beforeend",legend(["All eleven towns",focus],col));
  var tv=years.map(function(y){var d=t.sales[y];return d&&d.sf_n>=5?d.sf_median:null;}),rv=years.map(function(y){return r[y].sf_median;});
  var max=Math.max.apply(null,rv.concat(tv.filter(Boolean))),top=Math.ceil(max/100000)*100000,W=610,L=52,R=56,T=14,B=28,H=330,X=scale(2005,2025,L,W-R),Y=scale(0,top,H-B,T),s=svg(h,W,H,"Line chart of median sale prices");
  for(var g=0;g<=top;g+=100000){svgEl("line",{x1:L,x2:W-R,y1:Y(g),y2:Y(g),stroke:C.grid},s);svgText(s,L-6,Y(g)+4,g?"$"+g/1000+"K":"$0",{"text-anchor":"end","font-size":10,fill:C.muted});}
  [2005,2010,2015,2020,2025].forEach(function(y){svgText(s,X(y),H-B+16,y,{"text-anchor":"middle","font-size":10,fill:C.muted});});
  var seg=[];tv.forEach(function(v,i){if(v!=null)seg.push(X(years[i])+","+Y(v));});
  if(seg.length>1)svgEl("path",{d:"M"+seg.join(" L"),fill:"none",stroke:C.blue,"stroke-width":1.5,opacity:.45,"stroke-linejoin":"round"},s);
  tv.forEach(function(v,i){if(v==null)return;var c=svgEl("circle",{cx:X(years[i]),cy:Y(v),r:4,fill:C.blue,stroke:C.paper,"stroke-width":2},s);tip(c,t.name+", "+years[i]+"\nMedian "+money(v)+" · "+t.sales[years[i]].sf_n+" sales");});
  svgEl("path",{d:"M"+rv.map(function(v,i){return X(years[i])+","+Y(v);}).join(" L"),fill:"none",stroke:C.ink,"stroke-width":2.2,"stroke-linejoin":"round","stroke-linecap":"round"},s);
  rv.forEach(function(v,i){var c=svgEl("circle",{cx:X(years[i]),cy:Y(v),r:years[i]===2019||years[i]===2025?4.5:2.5,fill:C.ink,stroke:C.paper,"stroke-width":years[i]===2019||years[i]===2025?2:0},s);tip(c,"Eleven towns, "+years[i]+"\nMedian "+money(v)+" · "+r[years[i]].sf_n+" sales");});
  [[2019,"start"],[2025,"end"]].forEach(function(p){var v=r[p[0]].sf_median;svgText(s,X(p[0])+(p[0]===2025?8:4),Y(v)+(p[0]===2025?4:18),compact(v),{"text-anchor":p[0]===2025?"start":"end","font-size":11,"font-weight":750,fill:C.ink});});
  h.appendChild(tableToggle(["Year","Eleven-town median","Sales","",t.name+" median",t.name+" sales"],years.map(function(y){var d=t.sales[y]||{};return [y,money(r[y].sf_median),num(r[y].sf_n),"",d.sf_n?money(d.sf_median):"—",d.sf_n||0];})));
  return h;
}
function buyersHeadline(){var s=state.ins.region.sales,f=function(y){var d=s[y];return (d.llc+d.trust)/(d.llc+d.trust+d.person)*100;};return "LLCs and trusts took "+pct(f("2025"))+" of 2025 home sales, up from "+pct(f("2019"))+" in 2019.";}
function chartBuyers(){
  var s=state.ins.region.sales,h=chartHost("Share of home sales to LLCs and trusts by year"),years=[];for(var y=2008;y<=2025;y++)years.push(y);
  var col={"LLC or corporation":C.red,"Trust or trustee":C.gold};h.insertAdjacentHTML("beforeend",legend(Object.keys(col),col));
  var share=function(y,k){var d=s[y];return d[k]/(d.llc+d.trust+d.person)*100;};
  var W=610,L=40,R=40,T=14,B=28,H=330,max=Math.ceil(Math.max.apply(null,years.map(function(y){return share(y,"llc")+share(y,"trust");}))/5)*5,X=scale(2008,2025,L,W-R),Y=scale(0,max,H-B,T),sv=svg(h,W,H,"Stacked area of LLC and trust buyer shares");
  for(var g=0;g<=max;g+=5){svgEl("line",{x1:L,x2:W-R,y1:Y(g),y2:Y(g),stroke:C.grid},sv);svgText(sv,L-6,Y(g)+4,g+"%",{"text-anchor":"end","font-size":10,fill:C.muted});}
  [2010,2015,2020,2025].forEach(function(y){svgText(sv,X(y),H-B+16,y,{"text-anchor":"middle","font-size":10,fill:C.muted});});
  var bw=(W-L-R)/years.length*.62;
  years.forEach(function(y){var a=share(y,"llc"),b=share(y,"trust"),d=s[y],x=X(y)-bw/2;
    var r1=svgEl("rect",{x:x,y:Y(a),width:bw,height:Y(0)-Y(a),fill:col["LLC or corporation"]},sv);
    var r2=svgEl("rect",{x:x,y:Y(a+b),width:bw,height:Math.max(0,Y(a)-Y(a+b)-1.5),fill:col["Trust or trustee"],rx:2},sv);
    [r1,r2].forEach(function(r){tip(r,y+" · "+num(d.llc+d.trust+d.person)+" home sales\nLLC or corporation: "+d.llc+" ("+pct(a,1)+")\nTrust or trustee: "+d.trust+" ("+pct(b,1)+")");});
  });
  var e=share(2025,"llc")+share(2025,"trust");svgText(sv,X(2025),Y(e)-7,pct(e),{"text-anchor":"middle","font-size":11,"font-weight":750,fill:C.ink});
  h.appendChild(tableToggle(["Year","Home sales","LLC or corporation","Trust or trustee","Individual names"],years.map(function(y){var d=s[y];return [y,num(d.llc+d.trust+d.person),d.llc+" ("+pct(share(y,"llc"),1)+")",d.trust+" ("+pct(share(y,"trust"),1)+")",num(d.person)];})));
  return h;
}

/* ============================================= sales vs assessment scatter */
function ratioSales(t){
  var d=cache[t.id];if(!d)return [];
  return d.records.filter(function(r){return String(r.USE_CODE||"").slice(0,3)==="101"&&r._sale&&(r.LS_PRICE||0)>=25000&&(r.TOTAL_VAL||0)>0&&+r._sale.slice(0,4)>=(+r.FY)-2;}).map(function(r){return {r:r,p:r.LS_PRICE,v:r.TOTAL_VAL,k:r.LS_PRICE/r.TOTAL_VAL};});
}
function ratioHeadline(t){
  var pts=ratioSales(t);if(!cache[t.id])return "How "+t.name+"’s recent sales compare with assessments.";
  if(pts.length<5)return "Too few recent single-family sales in "+t.name+" to compare with assessments.";
  var m=median(pts.map(function(p){return p.k;})),above=pts.filter(function(p){return p.k>1.1;}).length;
  return (m>=1?"Half of "+t.name+"’s recent home sales closed at least "+pct((m-1)*100)+" above assessment":"Half of "+t.name+"’s recent home sales closed at least "+pct((1-m)*100)+" below assessment")+"; "+above+" of "+pts.length+" beat it by more than 10%.";
}
function chartRatio(){
  var t=townOf(state.town),h=chartHost("Sale price against assessed value, "+t.name),pts=ratioSales(t);
  if(pts.length<5){h.innerHTML='<p class="p-status">'+esc(t.name)+' has '+pts.length+' qualifying single-family sales in the window, too few to chart.</p>';return h;}
  var col={"Sold 10%+ above assessment":C.red,"Within 10%":"#8d989f","Sold 10%+ below":C.blue};
  h.insertAdjacentHTML("beforeend",legend(Object.keys(col),col));
  var grid=document.createElement("div");grid.className="p-ratio-grid";h.appendChild(grid);var cw=document.createElement("div");grid.appendChild(cw);
  var all=pts.map(function(p){return p.p;}).concat(pts.map(function(p){return p.v;})),lo=Math.log10(Math.min.apply(null,all)*.85),hi=Math.log10(Math.max.apply(null,all)*1.15);
  var W=620,L=58,R=16,T=12,B=40,H=460,X=scale(lo,hi,L,W-R),Y=scale(lo,hi,H-B,T),s=svg(cw,W,H,"Scatter plot of sale price against assessment");
  var ticks=[5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7].filter(function(v){var l=Math.log10(v);return l>=lo&&l<=hi;});
  ticks.forEach(function(v){var l=Math.log10(v);svgEl("line",{x1:X(l),x2:X(l),y1:T,y2:H-B,stroke:C.grid},s);svgEl("line",{x1:L,x2:W-R,y1:Y(l),y2:Y(l),stroke:C.grid},s);svgText(s,X(l),H-B+15,compact(v),{"text-anchor":"middle","font-size":10,fill:C.muted});svgText(s,L-6,Y(l)+4,compact(v),{"text-anchor":"end","font-size":10,fill:C.muted});});
  var band="M"+X(lo)+","+Y(lo+Math.log10(1.1))+" L"+X(hi)+","+Y(hi+Math.log10(1.1))+" L"+X(hi)+","+Y(hi+Math.log10(.9))+" L"+X(lo)+","+Y(lo+Math.log10(.9))+"Z";
  svgEl("clipPath",{id:"p-clip"},s).appendChild(svgEl("rect",{x:L,y:T,width:W-L-R,height:H-B-T}));
  svgEl("path",{d:band,fill:"#dfe3e0",opacity:.8,"clip-path":"url(#p-clip)"},s);
  svgEl("line",{x1:X(lo),y1:Y(lo),x2:X(hi),y2:Y(hi),stroke:C.muted,"stroke-width":1.2,"clip-path":"url(#p-clip)"},s);
  svgText(s,X(hi)-6,Y(hi)+16,"sold at assessment",{"text-anchor":"end","font-size":10,fill:C.muted});
  svgText(s,(L+W-R)/2,H-6,"Current assessed value →",{"text-anchor":"middle","font-size":11,fill:C.muted});
  var yl=svgText(s,13,(T+H-B)/2,"Last recorded sale price →",{"text-anchor":"middle","font-size":11,fill:C.muted});yl.setAttribute("transform","rotate(-90 13 "+((T+H-B)/2)+")");
  pts.sort(function(a,b){return Math.abs(Math.log(a.k))-Math.abs(Math.log(b.k));}).forEach(function(p){var c=p.k>1.1?col["Sold 10%+ above assessment"]:p.k<.9?col["Sold 10%+ below"]:col["Within 10%"];var dot=svgEl("circle",{cx:X(Math.log10(p.v)),cy:Y(Math.log10(p.p)),r:4.5,fill:c,stroke:C.paper,"stroke-width":1.5,opacity:.9,"data-loc":p.r.LOC_ID||""},s);tip(dot,(p.r.SITE_ADDR||p.r.PROP_ID)+"\nSold "+p.r._sale+" for "+money(p.p)+"\nAssessed "+money(p.v)+" (FY"+p.r.FY+")\n"+(p.k>=1?pct((p.k-1)*100)+" above":pct((1-p.k)*100)+" below")+" assessment · click to map");});
  var side=document.createElement("div");side.className="p-gaps";
  var top=pts.slice().sort(function(a,b){return b.k-a.k;}).slice(0,6),m=median(pts.map(function(p){return p.k;}));
  side.innerHTML='<div class="p-bigstat"><strong>'+(m>=1?"+":"−")+pct(Math.abs(m-1)*100,1)+'</strong><span>median sale vs. assessment</span><small>'+pts.length+' single-family sales</small></div><h4>Furthest above assessment</h4><ol>'+top.map(function(p){return '<li><button type="button" data-loc="'+esc(p.r.LOC_ID||"")+'"><strong>'+esc(p.r.SITE_ADDR||p.r.PROP_ID)+'</strong><span>'+money(p.p)+' vs. '+compact(p.v)+' · '+(p.k).toFixed(2)+'×</span></button></li>';}).join("")+'</ol><p class="p-note">A big gap can be a renovation after the assessment date, a bundled sale, or a record problem. Check the deed before reporting it.</p>';
  grid.appendChild(side);
  return h;
}

/* ================================================================ housing */
function builtHeadline(){var ts=state.ins.towns.filter(function(t){return t.built.median;}).sort(function(a,b){return a.built.median-b.built.median;}),o=ts[0],rest=median(ts.slice(1).map(function(t){return t.built.median;}));return o.name+"’s homes are the oldest: half were built by "+Math.round(o.built.median)+", about "+Math.round((rest-o.built.median)/10)*10+" years before the others.";}
function chartBuilt(){
  var h=chartHost("Year built range for homes, by town"),towns=state.ins.towns.filter(function(t){return t.built.n;}).sort(function(a,b){return a.built.median-b.built.median;});
  var W=610,L=130,R=20,T=8,row=31,H=T+towns.length*row+26,X=scale(1800,2026,L,W-R),s=svg(h,W,H,"Range plot of year built");
  [1800,1850,1900,1950,2000].forEach(function(y){svgEl("line",{x1:X(y),x2:X(y),y1:T,y2:H-22,stroke:C.grid},s);svgText(s,X(y),H-6,y,{"text-anchor":"middle","font-size":10,fill:C.muted});});
  towns.forEach(function(t,i){var b=t.built,y=T+i*row+13,on=t.name===state.town,c=on?C.blue:"#7d8990";
    svgText(s,L-10,y+4,t.name,{"text-anchor":"end","font-size":12,"font-weight":on?750:500,fill:on?C.ink:C.ink2});
    svgEl("line",{x1:X(Math.max(1800,b.p10)),x2:X(b.p90),y1:y,y2:y,stroke:c,"stroke-width":1.5},s);
    var r=svgEl("rect",{x:X(Math.max(1800,b.q1)),y:y-6,width:Math.max(2,X(b.q3)-X(Math.max(1800,b.q1))),height:12,fill:c,opacity:on?.4:.28,rx:2},s);
    var d=svgEl("circle",{cx:X(b.median),cy:y,r:5,fill:c,stroke:C.paper,"stroke-width":2},s);
    [r,d].forEach(function(e){tip(e,t.name+" · "+num(b.n)+" homes with a year built\nMedian "+Math.round(b.median)+" · middle half "+Math.round(b.q1)+"–"+Math.round(b.q3)+"\n"+pct(b.since2000/b.n*100)+" built in 2000 or later",t.name);});
  });
  return h;
}

/* ================================================================ records */
function recordsBlock(){
  var t=townOf(state.town),h=document.createElement("div");
  h.innerHTML='<div class="p-filters"><input id="p-tq" type="search" placeholder="Address, owner, city or ID" value="'+esc(state.tq)+'" aria-label="Search records">'
    +'<select id="p-tuse" aria-label="Use"><option value="">All uses</option>'+USES.map(function(u){return '<option'+(state.tuse===u?' selected':'')+'>'+esc(u)+'</option>';}).join("")+'</select>'
    +'<select id="p-tmail" aria-label="Mailing address"><option value="">Any mailing address</option><option value="away"'+(state.tmail==="away"?' selected':'')+'>Out of state (any)</option>'+MAIL.map(function(u){return '<option'+(state.tmail===u?' selected':'')+'>'+esc(u)+'</option>';}).join("")+'</select>'
    +'<select id="p-tsort" aria-label="Sort"><option value="value">Highest assessed value</option><option value="acres">Most acres</option><option value="sale">Newest recorded sale</option><option value="price">Highest sale price</option><option value="built">Oldest building</option><option value="addr">Address A–Z</option></select>'
    +'<button type="button" class="p-textbtn" data-csv>Download CSV</button></div><div id="p-rec-out"></div>';
  h.querySelector("#p-tsort").value=state.tsort;
  setTimeout(recordsTable,0);return h;
}
function filtered(){
  var d=cache[townOf(state.town).id];if(!d)return [];var q=state.tq.trim().toUpperCase(),terms=q?q.split(/\s+/):[];
  var rows=d.records.filter(function(r){if(state.tuse&&r._use!==state.tuse)return false;if(state.tmail==="away"&&AWAY.indexOf(r._mail)<0)return false;if(state.tmail&&state.tmail!=="away"&&r._mail!==state.tmail)return false;if(!terms.length)return true;var hay=r._hay+" "+String(r.OWN_CITY||"").toUpperCase()+" "+String(r.OWN_STATE||"").toUpperCase();return terms.every(function(w){return hay.indexOf(w)>=0;});});
  var k=state.tsort,f={value:function(a,b){return (b.TOTAL_VAL||0)-(a.TOTAL_VAL||0);},acres:function(a,b){return b._acres-a._acres;},sale:function(a,b){return (b._sale||"").localeCompare(a._sale||"");},price:function(a,b){return (b._sale?b.LS_PRICE||0:0)-(a._sale?a.LS_PRICE||0:0);},built:function(a,b){return (a._built||9999)-(b._built||9999);},addr:function(a,b){return String(a.SITE_ADDR||"~").localeCompare(String(b.SITE_ADDR||"~"),"en",{numeric:true});}}[k];
  return rows.sort(f);
}
function recordsTable(){
  var out=document.getElementById("p-rec-out");if(!out)return;var rows=filtered(),shown=rows.slice(0,state.tlimit),total=sum(rows,function(r){return r.TOTAL_VAL||0;}),ac=sum(rows,function(r){return r._acres;});
  out.innerHTML='<p class="p-count"><strong>'+num(rows.length)+'</strong> records · '+compact(total)+' assessed · '+num(ac)+' mapped acres</p><div class="p-scroll"><table class="p-table p-records"><thead><tr><th>Property</th><th>Owner of record</th><th>Use</th><th class="num">Assessed</th><th class="num">Acres</th><th>Last recorded sale</th><th class="num">Built</th></tr></thead><tbody>'
    +shown.map(function(r){return '<tr data-loc="'+esc(r.LOC_ID||"")+'" tabindex="0"><td><strong>'+esc(r.SITE_ADDR||"—")+'</strong><small>'+esc(r.PROP_ID)+'</small></td><td>'+esc(r._owner)+'<small><i class="p-dot" style="background:'+MAIL_C[r._mail]+'"></i>'+(r._mail==="Not listed"?"No mailing address":esc(titleCase(r.OWN_CITY))+", "+esc(norm(r.OWN_STATE)))+'</small></td><td><i class="p-dot" style="background:'+USE_C[r._use]+'"></i>'+esc(r._use)+'<small>code '+esc(r.USE_CODE)+'</small></td><td class="num">'+money(r.TOTAL_VAL)+'</td><td class="num">'+(r._acres?acres(r._acres):"—")+'</td><td>'+(r._sale?esc(r._sale)+'<small>'+money(r.LS_PRICE)+(r.LS_PRICE<1000?' · nominal':'')+'</small>':"—")+'</td><td class="num">'+(r._built||"—")+'</td></tr>';}).join("")+'</tbody></table></div>'
    +(rows.length>shown.length?'<button type="button" class="p-more" data-more>Show '+Math.min(200,rows.length-shown.length)+' more of '+num(rows.length-shown.length)+'</button>':'');
}
function csv(){
  var t=townOf(state.town),rows=filtered(),cols=["TOWN","PROP_ID","LOC_ID","SITE_ADDR","OWNER1","OWN_CITY","OWN_STATE","MAILING_GROUP","USE_CODE","USE_GROUP","TOTAL_VAL","LAND_VAL","BLDG_VAL","MAPPED_ACRES","LS_DATE","LS_PRICE","YEAR_BUILT","FY"];
  var q=function(v){v=v==null?"":String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  var body=rows.map(function(r){return [t.name,r.PROP_ID,r.LOC_ID,r.SITE_ADDR,r.OWNER1,r.OWN_CITY,r.OWN_STATE,r._mail,r.USE_CODE,r._use,r.TOTAL_VAL,r.LAND_VAL,r.BLDG_VAL,r._acres?r._acres.toFixed(2):"",r._sale,r.LS_PRICE,r.YEAR_BUILT,r.FY].map(q).join(",");});
  var blob=new Blob([cols.join(",")+"\n"+body.join("\n")],{type:"text/csv"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="massgis-"+t.name.toLowerCase().replace(/\s+/g,"-")+"-records.csv";document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},500);
}

/* ------------------------------------------------------- shared widgets */
function tableToggle(head,rows){
  var d=document.createElement("details");d.className="p-exact";
  d.innerHTML='<summary>Exact values as a table</summary><div class="p-scroll"><table class="p-table"><thead><tr>'+head.map(function(x,i){return '<th'+(i?' class="num"':'')+'>'+esc(x)+'</th>';}).join("")+'</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(x,i){return '<td'+(i?' class="num"':'')+'>'+esc(x)+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table></div>';
  return d;
}
function methodology(){
  var d=state.ins,ex=sum(d.towns,function(t){return t.excluded;});
  return '<details class="m-method" id="p-method"><summary>Data, definitions and limitations</summary><div>'
  +'<p><strong>Source:</strong> <a href="https://www.mass.gov/info-details/massgis-data-property-tax-parcels" target="_blank" rel="noopener">MassGIS Property Tax Parcels</a>, assessment table and parcel boundaries, observed '+esc(fmtDate(d.retrieved.slice(0,10)))+'. Town fiscal years differ (FY2025–FY2027). This is a dated snapshot, not a live feed, and not affiliated with MassGIS or the towns.</p>'
  +'<p><strong>Unit:</strong> assessment records, not parcels or owners. A boundary can link to several records (condominiums) and a record to several shapes. '+ex+' Monterey records with repeated IDs and conflicting owners are excluded.</p>'
  +'<p><strong>Values:</strong> assessed values, not market values or tax bills. Totals include exempt property, so they are not a tax-rate base.</p>'
  +'<p><strong>Acres:</strong> computed from the web-simplified boundaries and split evenly among records that share a boundary. Roads and water outside parcels are not counted. Good for shares, not for surveying.</p>'
  +'<p><strong>Use groups:</strong> from the first three digits of the state use code. 900s exempt; 130–132, 390s and 440s vacant; other 100s residential; 300–499 commercial or industrial; 600–899 and mixed codes with a 6, 7 or 8 are Chapter 61, 61A or 61B current-use land; everything else other / mixed. “Homes” means residential records, including condos and multifamily.</p>'
  +'<p><strong>Mailing address:</strong> city and state of the owner of record. Local aliases (Housatonic, Ashley Falls, Mill River, South Egremont and others) count as the town itself. A mailing address is not residency, and a post-office box or accountant can stand in for a second home or the reverse.</p>'
  +'<p><strong>Owner types:</strong> a keyword screen on the owner label (town, Commonwealth, United States, school district; land trust, conservancy, Audubon, church, college and similar) plus the exempt use code. It is a lead, not a legal status. LLC and trust buyers are identified the same way from the current owner label.</p>'
  +'<p><strong>Landholder groups:</strong> Commonwealth of Massachusetts, United States, Berkshire Natural Resources Council, Mass Audubon, The Nature Conservancy, The Trustees of Reservations, Appalachian Trail Conservancy and Berkshire County Land Trust are merged across label variants. Nothing else is merged; spelling variants of private owners stay separate.</p>'
  +'<p><strong>Sales:</strong> each record carries only its last recorded sale, so this is not a transaction history and earlier years are undercounted. Dates must be valid and on or before the snapshot. Under $1,000 counts as nominal. Price trends use single-family (101) sales of $25,000 or more. None of these are screened for arm’s-length status.</p>'
  +'<p><strong>Rebuild:</strong> <code>python3 property-collector.py</code> refreshes the snapshot from MassGIS; <code>python3 property-insights.py</code> recomputes this page’s figures. Full notes in <a href="https://github.com/tylerherman19/berkshire-meetings/blob/main/property-method.md" target="_blank" rel="noopener">property-method.md</a>.</p>'
  +'</div></details>';
}

/* ---------------------------------------------------------------- events */
function setTown(name){if(!name||name===state.town)return;var y=window.scrollY;state.town=name;state.sel=null;state.find="";state.isolate="";state.tlimit=60;render();window.scrollTo(0,y);}
function bind(root){
  var tipEl=root.querySelector("#p-tip"),findTimer,recTimer;
  root.addEventListener("change",function(e){
    var id=e.target.id;
    if(id==="p-town")setTown(e.target.value);
    if(id==="p-tuse"||id==="p-tmail"||id==="p-tsort"){state[id.slice(2)]=e.target.value;state.tlimit=60;recordsTable();}
  });
  root.addEventListener("input",function(e){
    if(e.target.id==="p-find"){state.find=e.target.value;clearTimeout(findTimer);findTimer=setTimeout(findResults,120);}
    if(e.target.id==="p-tq"){state.tq=e.target.value;state.tlimit=60;clearTimeout(recTimer);recTimer=setTimeout(recordsTable,160);}
  });
  root.addEventListener("keydown",function(e){
    if(e.key==="Enter"&&e.target.matches("tr[data-loc]"))e.target.click();
    if(e.key==="Enter"&&e.target.id==="p-find"){var b=root.querySelector("#p-find-results button");if(b)b.click();}
  });
  root.addEventListener("click",function(e){
    var el;
    if((el=e.target.closest("[data-mode]"))){state.mode=el.getAttribute("data-mode");state.isolate="";root.querySelectorAll("[data-mode]").forEach(function(b){b.classList.toggle("on",b===el);});restyle();return;}
    if((el=e.target.closest("[data-isolate]"))){var k=el.getAttribute("data-isolate");state.isolate=state.isolate===k?"":k;restyle();return;}
    if((el=e.target.closest("[data-market]"))){state.market=el.getAttribute("data-market");refill("market");return;}
    if((el=e.target.closest("[data-jump]"))){var s=document.getElementById("ps-"+el.getAttribute("data-jump"));if(s)s.scrollIntoView({behavior:"smooth"});return;}
    if(e.target.closest("[data-clear-sel]")){select(null);return;}
    if(e.target.closest("[data-csv]")){csv();return;}
    if(e.target.closest("[data-more]")){state.tlimit+=200;recordsTable();return;}
    if((el=e.target.closest("[data-loc]"))){var loc=el.getAttribute("data-loc"),box=document.getElementById("p-find-results");if(box){box.classList.remove("open");}
      if(!loc)return;var fromFind=!!e.target.closest("#p-find-results");
      if(zoomTo(loc)){var m=document.getElementById("p-map");if(m&&!fromFind)m.scrollIntoView({behavior:"smooth",block:"center"});}
      else{select(loc);var dt=document.getElementById("p-detail");if(dt)dt.scrollIntoView({behavior:"smooth",block:"center"});}
      return;}
    if((el=e.target.closest("[data-town]"))){tipEl.classList.remove("show");setTown(el.getAttribute("data-town"));return;}
    if(!e.target.closest(".p-find")){var bx=document.getElementById("p-find-results");if(bx)bx.classList.remove("open");}
  });
  function show(e){var m=e.target.closest&&e.target.closest("[data-tip]");if(!m)return;tipEl.innerHTML=m.getAttribute("data-tip").split("\n").map(function(l,i){return i?esc(l):"<strong>"+esc(l)+"</strong>";}).join("<br>");tipEl.classList.add("show");place(e,m);}
  function place(e,m){var x=e.clientX||0,y=e.clientY||0;if(!x&&!y){var r=m.getBoundingClientRect();x=r.left+r.width/2;y=r.top;}var tw=tipEl.offsetWidth||220,th=tipEl.offsetHeight||50;tipEl.style.left=Math.max(8,Math.min(window.innerWidth-tw-8,x+14))+"px";tipEl.style.top=Math.max(8,Math.min(window.innerHeight-th-8,y+14))+"px";}
  root.addEventListener("pointerover",show);
  root.addEventListener("pointermove",function(e){if(tipEl.classList.contains("show"))place(e,e.target);});
  root.addEventListener("pointerout",function(e){if(e.target.closest&&e.target.closest("[data-tip]"))tipEl.classList.remove("show");});
  root.addEventListener("focusin",show);root.addEventListener("focusout",function(){tipEl.classList.remove("show");});
}

/* Links elsewhere on the site ("Explore the property base") switch views. */
document.addEventListener("click",function(e){var g=e.target.closest("[data-goto]");if(!g)return;e.preventDefault();var b=document.querySelector('#views button[data-view="'+g.getAttribute("data-goto")+'"]');if(b)b.click();});

window.BMProperty={render:render,setTown:function(n){state.town=n;}};
})();
