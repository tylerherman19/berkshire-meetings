/* ============================================================
   Police Blotter - Great Barrington dispatch logs
   Loaded lazily from data/police.json the first time the tab
   opens. Self-contained: app.js keeps its own helpers private,
   so the few this view needs are duplicated here.
   Privacy: the JSON already excludes names, exact addresses and
   medical/domestic/juvenile/victim-level call types. Nothing in
   this file re-identifies anyone; locations stay street-level.
   ============================================================ */
window.BMBlotter = (function(){
"use strict";

var POL=null, LOADING=false, FAILED=false;
var map=null, dots=null, dotById={}, GEO=null;
var bstate = {days:28, custom:false, from:"", to:"", group:"All", q:"",
              sort:"new", sel:null};

var GROUP_COLORS = {
  "Crime":"#b0483a", "Traffic":"#2b5ea6", "Disorder":"#c08a1d",
  "Alarms":"#7a7263", "Fire & hazards":"#b25a1b", "Patrol checks":"#2f5d3f",
  "Community":"#4a7a96"
};

/* Friendlier display names for the PD's codes. */
var NICE = {
  "Patrol Check":"Patrol Check",
  "Motor Vehicle Stop":"Traffic Stop",
  "Motor Vehicle Accident":"Motor Vehicle Crash",
  "Motor Vehicle Complaints":"Motor Vehicle Complaint",
  "Radar":"Radar Detail",
  "Animal Call":"Animal Complaint",
  "Larceny / Forgery/ Fraud":"Larceny Report",
  "Alarm - Burglar":"Burglar Alarm",
  "Alarm - Fire":"Fire Alarm",
  "Alarm - Panic / Hold-Up":"Panic Alarm",
  "Alarm - Co":"CO Alarm",
  "Alarm - Elevator":"Elevator Alarm",
  "Suspicious Activity":"Suspicious Activity",
  "Noise Complaint":"Noise Complaint",
  "Disturbance":"Disturbance",
  "Assist Citizen":"Assist Citizen",
  "Assist Other Agency":"Assist Other Agency",
  "Found/Lost Property":"Found/Lost Property",
  "Lock Out":"Lockout",
  "Disabled MV":"Disabled Vehicle",
  "Trespass Complaint":"Trespass Complaint",
  "Mal Damage":"Vandalism",
  "Burglary":"Burglary",
  "Auto Theft":"Stolen Vehicle",
  "Assault":"Assault",
  "Investigation":"Investigation",
  "Road Hazard":"Road Hazard",
  "Power Outage":"Power Outage",
  "Wires Down/Tree On Wires":"Wires Down",
  "Wires Smoking":"Wires Smoking",
  "Parking Enforcement":"Parking Enforcement",
  "Traffic Control":"Traffic Control",
  "Complaint":"Complaint",
  "Call For Service":"Call for Service",
  "Fire, Other":"Fire Call",
  "Fire, Hazmat":"Hazmat",
  "Fire, Mutual Aid":"Fire Mutual Aid",
  "Fire, Search & Rescue":"Search & Rescue",
  "Fire / Ems, Assist Police":"Fire/EMS Assist"
};

var LEAD = {
  "Patrol Check":"Routine patrol check.",
  "Motor Vehicle Stop":"Routine traffic stop.",
  "Motor Vehicle Accident":"Report of a motor vehicle crash.",
  "Motor Vehicle Complaints":"Report of erratic or complained-about driving.",
  "Radar":"Radar speed-enforcement detail.",
  "Animal Call":"Animal complaint.",
  "Larceny / Forgery/ Fraud":"Report of larceny, forgery or fraud.",
  "Alarm - Burglar":"Alarm activation.",
  "Alarm - Fire":"Fire alarm activation.",
  "Alarm - Panic / Hold-Up":"Panic/hold-up alarm activation.",
  "Suspicious Activity":"Report of suspicious activity.",
  "Noise Complaint":"Noise complaint.",
  "Disturbance":"Report of a disturbance.",
  "Assist Citizen":"Officer assisted a resident.",
  "Found/Lost Property":"Found or lost property report.",
  "Lock Out":"Lockout assist.",
  "Disabled MV":"Disabled vehicle.",
  "Trespass Complaint":"Trespass complaint.",
  "Mal Damage":"Report of vandalism.",
  "Burglary":"Report of a burglary.",
  "Auto Theft":"Report of a stolen vehicle.",
  "Assault":"Report of an assault.",
  "Road Hazard":"Road hazard reported.",
  "Power Outage":"Power outage reported.",
  "Complaint":"Complaint received.",
  "Call For Service":"Call for service."
};

/* --------------------------------------------------------- utilities */
function $(s){ return document.querySelector(s); }
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
var ET="America/New_York";
var MONS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function etToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:ET,year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date());
}
function addDays(iso,n){
  var p=iso.split("-").map(Number);
  var dt=new Date(Date.UTC(p[0],p[1]-1,p[2]));
  dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}
function parseD(iso){ var p=iso.split("-").map(Number); return new Date(p[0],p[1]-1,p[2]); }
function fmtDay(iso){ var d=parseD(iso); return MONS[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear(); }
function fmtTime(t){
  if(!t) return "";
  var h=+t.slice(0,2), m=t.slice(2);
  var ap=h>=12?"PM":"AM"; h=h%12||12;
  return h+":"+m+" "+ap;
}
function nice(r){ return NICE[r] || r; }
function plural(n,w){ return n+" "+w+(n===1?"":"s"); }
function color(i){ return GROUP_COLORS[i.g] || "#7a7263"; }
function areaName(i){
  var l=i.loc||"";
  if(/Downtown Housatonic/i.test(l)) return "Downtown Housatonic";
  if(l.indexOf("+")>=0) return l.replace(/\s*\+\s*/," & ");
  return l ? l+" area" : "Great Barrington";
}
function desc(i){
  var lead = LEAD[i.r] || ("Report: "+i.r.toLowerCase()+".");
  var act = i.a && i.a!=="Logged" ? " "+i.a+"." : "";
  return lead+act;
}

/* ------------------------------------------------------------ data */
function ensure(cb, bust){
  if(POL!==null && !bust){ if(cb) cb(); return; }
  if(LOADING) return;
  LOADING=true;
  fetch("data/police.json?ts="+Date.now(),{cache:"no-store"})
    .then(function(r){ if(!r.ok) throw 0; return r.json(); })
    .then(function(j){
      POL=j||{incidents:[],weeks:[]};
      GEO=POL.geo||{};
      LOADING=false; FAILED=false;
      if(cb) cb();
    })
    .catch(function(){
      LOADING=false; FAILED=true;
      if(cb) cb();
    });
}

function rangeBounds(){
  if(bstate.custom && (bstate.from || bstate.to)){
    return [bstate.from||"0000-01-01", bstate.to||"9999-12-31"];
  }
  return [addDays(etToday(),-(bstate.days-1)), "9999-12-31"];
}
function filtered(){
  if(!POL) return [];
  var b=rangeBounds(), q=bstate.q.trim().toLowerCase();
  return (POL.incidents||[]).filter(function(i){
    if(i.d<b[0]||i.d>b[1]) return false;
    if(bstate.group!=="All"&&i.g!==bstate.group) return false;
    if(q){
      var hay=(i.r+" "+i.g+" "+i.loc+" "+nice(i.r)).toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  }).sort(function(a,b){
    var c=a.d.localeCompare(b.d)||(a.t||"").localeCompare(b.t||"");
    return bstate.sort==="new" ? -c : c;
  });
}

/* ------------------------------------------------------------ render */
function render(){
  var host=$("#view");
  if(POL===null){
    host.innerHTML='<p class="loading">Gathering the blotter&hellip;</p>';
    ensure(function(){ render(); });
    return;
  }
  if(FAILED){
    host.innerHTML='<p class="none" style="margin-top:30px">Couldn&rsquo;t load the blotter '+
      '&mdash; the first data pull is probably still running. Check back shortly.</p>';
    return;
  }
  var list=filtered();
  var updated=POL.updated
    ? new Date(POL.updated).toLocaleString("en-US",
        {timeZone:ET,month:"long",day:"numeric",year:"numeric",
         hour:"numeric",minute:"2-digit"})+" ET"
    : "unknown";
  var checkedShort=POL.updated
    ? new Date(POL.updated).toLocaleString("en-US",
        {timeZone:ET,hour:"numeric",minute:"2-digit"})+" ET"
    : "";

  var h='<div class="blot-head">'+
    '<section class="newshero">'+
      '<h2>Great Barrington Police Blotter</h2>'+
      '<p class="nsub">Privacy-filtered entries from the Great Barrington Police '+
        'Department&rsquo;s weekly public logs.</p>'+
    '</section>'+
    '<div class="blot-shield">'+
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z"/></svg>'+
      '<span>Names, exact residential addresses, and sensitive '+
        'victim/medical/domestic/juvenile details are removed or generalized.</span>'+
    '</div></div>';

  h+='<div class="blot-badges">'+
    '<span class="blot-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>Official public logs</span>'+
    '<span class="blot-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z"/><path d="M9 12l2 2 4-4"/></svg>Privacy filtered</span>'+
    '<span class="blot-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>Updated daily</span>'+
    '<span class="blot-badge mono"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>Last checked: '+esc(updated)+'</span>'+
  '</div>';

  /* ---- filter bar ---- */
  h+='<div class="blot-bar">'+
    '<div class="blot-field"><label>Date range</label>'+
      '<div class="blot-daterange" role="group" aria-label="Date range">'+
        drChip(7,"7 days")+drChip(14,"14 days")+drChip(28,"28 days")+
        '<button class="fchip'+(bstate.custom?" on":"")+'" data-blot="custom" type="button">Custom</button>'+
      '</div></div>'+
    (bstate.custom?
      '<div class="blot-field"><label>From &ndash; to</label>'+
        '<div class="blot-custom">'+
          '<input type="date" id="blotfrom" value="'+esc(bstate.from)+'" aria-label="From date">'+
          '<input type="date" id="blotto" value="'+esc(bstate.to)+'" aria-label="To date">'+
        '</div></div>':"")+
    '<div class="blot-field blot-type"><label>Call type</label>'+
      '<select id="blottype" aria-label="Call type"><option value="All">All call types</option>';
  (POL.groups||[]).forEach(function(g){
    h+='<option value="'+esc(g)+'"'+(bstate.group===g?" selected":"")+'>'+esc(g)+'</option>';
  });
  h+='</select></div>'+
    '<div class="blot-field blot-search"><label>Search</label>'+
      '<input id="blotq" type="search" value="'+esc(bstate.q)+'" '+
        'placeholder="Search by area or keyword (e.g. Main St, traffic, alarm&hellip;)" '+
        'autocomplete="off" aria-label="Search incidents"></div>'+
    '<div class="blot-refreshbox">'+
      '<span class="blot-countline" id="blotcount">'+plural(list.length,"incident")+'</span>'+
      '<button class="blot-refresh" id="blotrefresh" type="button">'+
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3v4h-4"/></svg>'+
        'Refresh</button>'+
      (checkedShort?'<span class="blot-checked">Last checked '+esc(checkedShort)+'</span>':"")+
    '</div></div>';

  /* ---- split: map + list ---- */
  h+='<div class="blot-split">'+
    '<div class="blot-mapcard"><div id="blotmap" role="application" aria-label="Incident map"></div>'+
      '<div class="blot-mapfoot"><span>Dots are street-level, not exact addresses.</span>'+
      '<span id="blotmapcount"></span></div></div>'+
    '<div class="blot-listcard">'+
      '<div class="blot-listhead"><span>Incidents (<span id="blotn">'+list.length+'</span>)</span>'+
        '<span class="blot-sort">Sort:'+
          '<select id="blotsort" aria-label="Sort order">'+
            '<option value="new"'+(bstate.sort==="new"?" selected":"")+'>Newest first</option>'+
            '<option value="old"'+(bstate.sort==="old"?" selected":"")+'>Oldest first</option>'+
          '</select></span></div>'+
      '<div class="blot-rows" id="blotrows">'+rowsHTML(list)+'</div>'+
    '</div></div>';

  /* ---- stats + about ---- */
  h+=statsHTML(list);
  h+='<div class="blot-about"><div>'+
    '<h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></svg>About this data</h3>'+
    '<p>Incidents are from the Great Barrington Police Department&rsquo;s weekly public logs, '+
      'obtained from official open sources. Several weeks of backfilled history ship with the '+
      'site&rsquo;s static data; a daily morning watchdog checks for new weekly logs and updates '+
      'the data. All entries are privacy filtered: names, exact residential addresses, and '+
      'sensitive victim/medical/domestic/juvenile details are removed or generalized. '+
      'Only Great Barrington publishes an incident-level log among the towns this site covers, '+
      'so the map is Great Barrington only. This site is not affiliated with the Great '+
      'Barrington Police Department or the Town of Great Barrington. Always refer to the '+
      'official public log for the source record.</p></div>'+
    '<a class="blot-src" href="https://greatbarringtonpolice.com/logs/" target="_blank" rel="noopener">'+
      'View official public logs <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M9 7h8v8"/></svg></a>'+
  '</div>';

  host.innerHTML=h;
  bindBar();
  renderMap(list);
}

function drChip(n,label){
  var on=!bstate.custom&&bstate.days===n;
  return '<button class="fchip'+(on?" on":"")+'" data-blot="days" data-days="'+n+'" type="button">'+label+'</button>';
}

function rowsHTML(list){
  if(!list.length){
    return '<p class="blot-none">Nothing in the logs matches those filters. '+
      'Quiet is good news.</p>';
  }
  return list.map(function(i){
    var sel=bstate.sel===i.id;
    return '<div class="blot-row'+(sel?" sel":"")+'" data-blot="row" data-id="'+esc(i.id)+'" role="button" tabindex="0">'+
      '<span class="br-when">'+esc(fmtDay(i.d))+'<br>'+esc(fmtTime(i.t))+'</span>'+
      '<span class="br-dot" style="background:'+color(i)+'"></span>'+
      '<span class="br-main"><span class="br-type">'+esc(nice(i.r))+'</span>'+
        '<div class="br-area">'+esc(areaName(i))+'</div></span>'+
      '<span class="br-chev">&rsaquo;</span>'+
      '<div class="br-desc">'+esc(desc(i))+'</div>'+
      (sel?'<div class="br-detail">'+
        '<b>'+esc(nice(i.r))+'</b> &middot; '+esc(fmtDay(i.d))+' at '+esc(fmtTime(i.t))+'<br>'+
        'Area: '+esc(areaName(i))+' (street level)<br>'+
        'Disposition: '+esc(i.a||"Logged")+'<br>'+
        '<span class="br-meta">Call '+esc(i.id)+' &middot; week of '+esc(weekLabel(i.w))+
          (i.lat==null?' &middot; not enough location detail to map':"")+'</span>'+
        '<div class="br-actions">'+
          (i.lat!=null?'<button data-blot="showmap" data-id="'+esc(i.id)+'" type="button">Show on map</button>':"")+
          '<a class="blot-src" style="padding:5px 11px;font-size:12px" href="'+esc(weekUrl(i.w))+'" target="_blank" rel="noopener">Official log (PDF)</a>'+
        '</div></div>':"")+
    '</div>';
  }).join("");
}
function weekUrl(file){
  var w=(POL.weeks||[]).filter(function(x){return x.file===file;})[0];
  return w?w.url:"https://greatbarringtonpolice.com/logs/";
}
function weekLabel(file){
  var w=(POL.weeks||[]).filter(function(x){return x.file===file;})[0];
  return w&&w.from?fmtDay(w.from)+" &ndash; "+fmtDay(w.to):file;
}

function statsHTML(list){
  var byType={}, byDay={}, maxDay="";
  list.forEach(function(i){
    var n=nice(i.r); byType[n]=(byType[n]||0)+1;
    byDay[i.d]=(byDay[i.d]||0)+1;
    if(!maxDay||i.d>maxDay) maxDay=i.d;
  });
  var topType=topEntry(byType), topDay=topEntry(byDay);
  var rangeLab=bstate.custom?"the selected dates":"the past "+bstate.days+" days";
  return '<div class="blot-stats">'+
    '<div class="blot-stat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>'+
      '<div><div class="bs-num">'+list.length+'</div><div class="bs-lab">public-log entries in '+rangeLab+'</div></div></div>'+
    '<div class="blot-stat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>'+
      '<div><div class="bs-num">'+(topType?esc(topType[0]):"&mdash;")+'</div>'+
      '<div class="bs-lab">most common call type'+(topType?" ("+topType[1]+" entries)":"")+'</div></div></div>'+
    '<div class="blot-stat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'+
      '<div><div class="bs-num">'+(topDay?esc(fmtDay(topDay[0])):"&mdash;")+'</div>'+
      '<div class="bs-lab">busiest day'+(topDay?" ("+topDay[1]+" entries)":"")+'</div></div></div>'+
    '<div class="blot-stat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>'+
      '<div><div class="bs-num">'+(maxDay?esc(fmtDay(maxDay)):"&mdash;")+'</div>'+
      '<div class="bs-lab">latest log date</div></div></div>'+
  '</div>';
}
function topEntry(o){
  var best=null;
  Object.keys(o).forEach(function(k){ if(!best||o[k]>best[1]) best=[k,o[k]]; });
  return best;
}

/* ------------------------------------------------------------- map */
function renderMap(list){
  var el=document.getElementById("blotmap");
  if(!el||typeof L==="undefined") return;
  if(!map){
    map=L.map("blotmap",{scrollWheelZoom:true}).setView([42.196,-73.362],13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    L.control.scale({imperial:true,metric:false}).addTo(map);
  }
  if(dots){ dots.remove(); dotById={}; }
  dots=L.layerGroup().addTo(map);
  var bounds=[], mapped=0;
  list.forEach(function(i){
    if(i.lat==null) return;
    mapped++;
    var m=L.circleMarker([i.lat,i.lon],{
      radius:6,color:"#fff",weight:1.5,
      fillColor:color(i),fillOpacity:.92
    });
    m.bindPopup('<div class="blot-popup">'+
      '<div class="bp-type">'+esc(nice(i.r))+'</div>'+
      '<div class="bp-when">'+esc(fmtDay(i.d))+' &middot; '+esc(fmtTime(i.t))+'</div>'+
      '<div class="bp-area">'+esc(areaName(i))+'</div>'+
      '<div class="bp-desc">'+esc(desc(i))+'</div></div>');
    m.on("click",function(){
      bstate.sel=i.id;
      repaintRows();
      var row=document.querySelector('.blot-row[data-id="'+i.id+'"]');
      if(row) row.scrollIntoView({block:"nearest"});
    });
    m.addTo(dots);
    dotById[i.id]=m;
    bounds.push([i.lat,i.lon]);
  });
  var mc=document.getElementById("blotmapcount");
  if(mc) mc.textContent=plural(mapped,"mapped incident")+(list.length>mapped? "\u00B7 "+plural(list.length-mapped,"unmapped"):"");
  if(bounds.length>1) map.fitBounds(bounds,{padding:[30,30]});
  else if(bounds.length===1) map.setView(bounds[0],15);
  setTimeout(function(){ map.invalidateSize(); },60);
}

function repaintRows(){
  var rows=document.getElementById("blotrows");
  if(rows) rows.innerHTML=rowsHTML(filtered());
  var n=document.getElementById("blotn");
  if(n) n.textContent=filtered().length;
}

/* ----------------------------------------------------------- events */
function bindBar(){
  var q=$("#blotq");
  if(q) q.addEventListener("input",function(){
    bstate.q=q.value;
    var list=filtered();
    repaintRows();
    var c=document.getElementById("blotcount");
    if(c) c.textContent=plural(list.length,"incident");
    renderMap(list);
  });
  var t=$("#blottype");
  if(t) t.addEventListener("change",function(){ bstate.group=t.value; render(); });
  var s=$("#blotsort");
  if(s) s.addEventListener("change",function(){ bstate.sort=s.value; repaintRows(); });
  var f=$("#blotfrom"), tt=$("#blotto");
  if(f) f.addEventListener("change",function(){ bstate.from=f.value; render(); });
  if(tt) tt.addEventListener("change",function(){ bstate.to=tt.value; render(); });
  var r=$("#blotrefresh");
  if(r) r.addEventListener("click",function(){
    r.classList.add("spin");
    POL=null;
    ensure(function(){ r.classList.remove("spin"); render(); }, true);
  });
}

document.addEventListener("click",function(e){
  var el=e.target.closest("[data-blot]");
  if(!el) return;
  var a=el.dataset.blot;
  if(a==="days"){ bstate.days=+el.dataset.days; bstate.custom=false; render(); }
  else if(a==="custom"){ bstate.custom=true; render(); }
  else if(a==="row"){
    var id=el.dataset.id;
    bstate.sel=(bstate.sel===id)?null:id;
    repaintRows();
    if(bstate.sel && dotById[bstate.sel]){
      /* keep the map in sync without yanking it away from the reader */
      var m=dotById[bstate.sel];
    }
  }
  else if(a==="showmap"){
    var m2=dotById[el.dataset.id];
    if(m2&&map){
      map.setView(m2.getLatLng(),16,{animate:true});
      m2.openPopup();
      document.getElementById("blotmap").scrollIntoView({block:"nearest"});
    }
  }
});
document.addEventListener("keydown",function(e){
  if(e.key!=="Enter"&&e.key!==" ") return;
  var el=e.target.closest&&e.target.closest('.blot-row[data-blot="row"]');
  if(el){ e.preventDefault(); el.click(); }
});

return {render:render};
})();
