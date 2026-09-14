(function(){
"use strict";

var TOWN_ORDER = ["Great Barrington","Sheffield","Egremont","New Marlborough","Monterey","Sandisfield","Stockbridge","West Stockbridge","Alford","Mount Washington","Richmond","SBRSD"];

// Town list is data-driven: any jurisdiction present in the JSON shows up,
// even if this JS file is cached. TOWN_ORDER only controls display order.
function townList(){
  var seen={}, list=[];
  DATA.meetings.forEach(function(m){ if(m.town && !seen[m.town]){ seen[m.town]=1; list.push(m.town); } });
  list.sort(function(a,b){
    var ia=TOWN_ORDER.indexOf(a), ib=TOWN_ORDER.indexOf(b);
    if(ia<0 && ib<0) return a< b?-1:1;
    if(ia<0) return 1;
    if(ib<0) return -1;
    return ia-ib;
  });
  return list;
}
var ET = "America/New_York";
var DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MONS_L = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function $(s){ return document.querySelector(s); }

function etToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:ET,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function addDays(iso,n){
  var p = iso.split("-").map(Number);
  var dt = new Date(Date.UTC(p[0],p[1]-1,p[2]));
  dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}
function parseD(iso){ var p=iso.split("-").map(Number); return new Date(p[0],p[1]-1,p[2]); }
function fmtDay(iso){ var d=parseD(iso); return DOW[d.getDay()]+", "+MONS[d.getMonth()]+" "+d.getDate(); }
function fmtTime(t){
  if(!t) return null;
  var p=t.split(":"), h=+p[0], m=p[1];
  var ap = h>=12 ? "PM" : "AM";
  h = h%12 || 12;
  return h+":"+m+" "+ap;
}
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

var state = { view:"week", town:"All", day:etToday(), month:etToday().slice(0,7), selDay:etToday(), archiveQ:"", minOnly:false };
var DATA = { meetings:[], updated:null };
var ATEXT = null, ATEXT_LOADING = false;

function meetingKey(m){
  return [m.town||"", m.board||"", m.title||"", m.date||"", m.start||""].join("|");
}
// Agenda text is lazy-loaded: the search index only downloads when the
// Archive tab is opened, keeping the first paint fast.
function ensureAtext(cb){
  if(ATEXT !== null){ if(cb) cb(); return; }
  if(ATEXT_LOADING) return;
  ATEXT_LOADING = true;
  fetch("data/agenda_text.json?ts="+Date.now(),{cache:"no-store"})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      ATEXT = (j && j.texts) || {};
      ATEXT_LOADING = false;
      if(cb) cb();
    })
    .catch(function(){ ATEXT = {}; ATEXT_LOADING = false; if(cb) cb(); });
}

function inTown(m){ return state.town==="All" || m.town===state.town; }
function byTime(a,b){ return (a.start||"99:99").localeCompare(b.start||"99:99"); }

function countUp(el,to){
  var t0=performance.now(), dur=650;
  function frame(t){
    var p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3);
    el.textContent=Math.round(to*e);
    if(p<1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function meetingRow(m,i){
  var time = m.all_day ? "All day" : (fmtTime(m.start) || "Time TBA");
  var endBit = (m.end && !m.all_day && m.start) ? '<span class="end">&ndash; '+esc(fmtTime(m.end))+'</span>' : "";
  var meta = [];
  if(m.board) meta.push(esc(m.board));
  if(m.location) meta.push(esc(m.location));
  var links = "";
  if(m.agenda_url) links += '<a class="pill" href="'+esc(m.agenda_url)+'" target="_blank" rel="noopener">Agenda</a>';
  if(m.minutes_url) links += '<a class="pill dim" href="'+esc(m.minutes_url)+'" target="_blank" rel="noopener">Minutes</a>';
  return '<div class="meeting rise" style="--i:'+i+'">'+
    '<div class="time">'+esc(time)+endBit+'</div>'+
    '<div class="m-body"><div class="m-title">'+esc(m.title)+'</div>'+
    '<div class="m-meta"><span class="town-tag">'+esc(m.town)+'</span>'+meta.join(" &middot; ")+'</div></div>'+
    (links ? '<div class="m-links">'+links+'</div>' : '')+
  '</div>';
}

function renderTowns(){
  var t=etToday(), e=addDays(t,7), counts={};
  var towns=townList();
  towns.forEach(function(x){ counts[x]=0; });
  DATA.meetings.forEach(function(m){
    if(m.date>=t && m.date<e && counts[m.town]!=null) counts[m.town]++;
  });
  var h='<button class="chip'+(state.town==="All"?" active":"")+'" data-town="All">All towns</button>';
  towns.forEach(function(x){
    h+='<button class="chip'+(state.town===x?" active":"")+'" data-town="'+esc(x)+'">'+esc(x)+'<span class="n">'+counts[x]+'</span></button>';
  });
  $("#towns").innerHTML=h;
  Array.prototype.forEach.call(document.querySelectorAll("#towns .chip"),function(b){
    b.addEventListener("click",function(){
      if(state.town===b.dataset.town) return;
      state.town=b.dataset.town;
      renderTowns(); renderView();
    });
  });
}

function renderWeek(){
  var t=etToday(), h="";
  for(var i=0;i<7;i++){
    var d=addDays(t,i);
    var ms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===d; }).sort(byTime);
    h+='<section class="day"><header><h2>'+(i===0?"Today":(i===1?"Tomorrow":fmtDay(d)))+'</h2>'+
       '<span class="count">'+ms.length+' meeting'+(ms.length===1?"":"s")+'</span></header>';
    if(!ms.length) h+='<p class="none">Nothing posted.</p>';
    else h+=ms.map(function(m,j){ return meetingRow(m,j); }).join("");
    h+='</section>';
  }
  $("#view").innerHTML=h;
}

function renderDay(){
  var d=state.day;
  var ms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===d; }).sort(byTime);
  var h='<div class="daynav fade"><button id="dprev" aria-label="Previous day">&larr;</button>'+
    '<div style="text-align:center"><h2>'+fmtDay(d)+'</h2>'+
    '<span class="count">'+ms.length+' meeting'+(ms.length===1?"":"s")+'</span></div>'+
    '<button id="dnext" aria-label="Next day">&rarr;</button></div>'+
    '<div style="text-align:center;margin-bottom:6px"><button id="dtoday" class="todaybtn daynav" style="padding:0">Back to today</button></div>';
  if(!ms.length) h+='<p class="none" style="text-align:center;margin-top:24px">Nothing posted for this day.</p>';
  else h+=ms.map(function(m,j){ return meetingRow(m,j); }).join("");
  $("#view").innerHTML=h;
  $("#dprev").addEventListener("click",function(){ state.day=addDays(state.day,-1); renderDay(); });
  $("#dnext").addEventListener("click",function(){ state.day=addDays(state.day,1); renderDay(); });
  $("#dtoday").addEventListener("click",function(){ state.day=etToday(); renderDay(); });
}

function renderMonth(){
  var ym=state.month.split("-"), y=+ym[0], mo=+ym[1];
  var startDay=new Date(y,mo-1,1).getDay();
  var dim=new Date(y,mo,0).getDate();
  var t=etToday();
  var h='<div class="monthnav fade"><button id="mprev" aria-label="Previous month">&larr;</button>'+
    '<h2>'+MONS_L[mo-1]+' '+y+'</h2>'+
    '<button id="mnext" aria-label="Next month">&rarr;</button></div>';
  h+='<div class="grid fade">';
  DOW.forEach(function(d){ h+='<div class="dow">'+d.slice(0,2)+'</div>'; });
  for(var i=0;i<startDay;i++) h+='<div class="cell blank"></div>';
  for(var d=1;d<=dim;d++){
    var iso=state.month+"-"+String(d).padStart(2,"0");
    var ms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===iso; });
    var dots=ms.slice(0,3).map(function(){ return '<span class="dot"></span>'; }).join("")+
      (ms.length>3 ? '<span class="more">+'+(ms.length-3)+'</span>' : "");
    h+='<button class="cell rise'+(iso===t?" today":"")+(iso===state.selDay?" sel":"")+'" style="--i:'+Math.min(d,18)+'" data-day="'+iso+'">'+
       '<span class="dnum">'+d+'</span><span class="dots">'+dots+'</span></button>';
  }
  h+='</div>';
  var sel=state.selDay;
  var sms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===sel; }).sort(byTime);
  h+='<div class="selday"><h3>'+fmtDay(sel)+'</h3><span class="count">'+sms.length+' meeting'+(sms.length===1?"":"s")+'</span>';
  if(!sms.length) h+='<p class="none">Nothing posted.</p>';
  else h+=sms.map(function(m,j){ return meetingRow(m,j); }).join("");
  h+='</div>';
  $("#view").innerHTML=h;
  $("#mprev").addEventListener("click",function(){
    var dt=new Date(y,mo-2,1);
    state.month=dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0");
    renderMonth();
  });
  $("#mnext").addEventListener("click",function(){
    var dt=new Date(y,mo,1);
    state.month=dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0");
    renderMonth();
  });
  Array.prototype.forEach.call(document.querySelectorAll(".cell[data-day]"),function(c){
    c.addEventListener("click",function(){ state.selDay=c.dataset.day; renderMonth(); });
  });
}

function renderStats(){
  var t=etToday(), e=addDays(t,7);
  var wk=DATA.meetings.filter(function(m){ return inTown(m)&&m.date>=t&&m.date<e; });
  var boards={};
  wk.forEach(function(m){ if(m.board) boards[m.board]=1; });
  countUp($("#stat-week"),wk.length);
  countUp($("#stat-boards"),Object.keys(boards).length);
  countUp($("#stat-towns"),townList().length);
}

function renderView(){
  var v=$("#view");
  v.classList.remove("fade"); void v.offsetWidth; v.classList.add("fade");
  if(state.view==="week") renderWeek();
  else if(state.view==="day") renderDay();
  else if(state.view==="month") renderMonth();
  else if(state.view==="archive") renderArchive();
  else if(state.view==="sources") renderSources();
  renderStats();
  Array.prototype.forEach.call(document.querySelectorAll(".views button"),function(b){
    var on=b.dataset.view===state.view;
    b.classList.toggle("active",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
}

function archiveRow(m,i,inAgenda){
  var d=parseD(m.date);
  var datestr=MONS[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear();
  var links="";
  if(m.minutes_url) links+='<a class="pill" href="'+esc(m.minutes_url)+'" target="_blank" rel="noopener">Minutes</a>';
  if(m.agenda_url) links+='<a class="pill dim" href="'+esc(m.agenda_url)+'" target="_blank" rel="noopener">Agenda</a>';
  return '<div class="meeting rise" style="--i:'+Math.min(i,12)+'">'+
    '<div class="time">'+esc(datestr)+'</div>'+
    '<div class="m-body"><div class="m-title">'+esc(m.title)+'</div>'+
    '<div class="m-meta"><span class="town-tag">'+esc(m.town)+'</span>'+(m.board?esc(m.board):"")+
    (inAgenda?' <span class="hit">match in agenda text</span>':"")+'</div></div>'+
    (links ? '<div class="m-links">'+links+'</div>' : '')+
  '</div>';
}

function archiveMatches(){
  var t=etToday(), q=state.archiveQ.trim().toLowerCase();
  var out=[];
  DATA.meetings.forEach(function(m){
    if(m.date>=t || !inTown(m)) return;
    if(state.minOnly && !m.minutes_url) return;
    var inAgenda=false;
    if(q){
      var hay=(m.title+" "+(m.board||"")+" "+m.town).toLowerCase();
      if(hay.indexOf(q)<0){
        var txt=ATEXT ? (ATEXT[meetingKey(m)]||"") : "";
        inAgenda=txt && txt.toLowerCase().indexOf(q)>=0;
        if(!inAgenda) return;
      }
    }
    out.push({m:m,inAgenda:inAgenda});
  });
  out.sort(function(a,b){
    return b.m.date.localeCompare(a.m.date) || (b.m.start||"").localeCompare(a.m.start||"");
  });
  return out;
}

function renderArchiveResults(){
  var box=$("#archresults");
  if(!box) return;
  var rows=archiveMatches();
  if(!rows.length){
    box.innerHTML='<p class="none" style="margin-top:24px">No past meetings match.</p>';
    return;
  }
  box.innerHTML=rows.map(function(r,i){ return archiveRow(r.m,i,r.inAgenda); }).join("");
}

function renderArchive(){
  var t=etToday();
  var past=DATA.meetings.filter(function(m){ return m.date<t && inTown(m); });
  var withMin=past.filter(function(m){ return m.minutes_url; }).length;
  var h='<div class="archivebar fade">'+
    '<input id="aq" type="search" placeholder="Search past meetings, boards, agenda text\u2026" value="'+esc(state.archiveQ)+'" aria-label="Search the minutes archive" autocomplete="off">'+
    '<label class="minonly"><input type="checkbox" id="amin"'+(state.minOnly?" checked":"")+'> Minutes only</label>'+
    '</div>'+
    '<p class="archcount">'+past.length+' past meetings'+(withMin?' \u00b7 '+withMin+' with minutes posted':"")+'</p>'+
    '<div id="archresults"></div>';
  $("#view").innerHTML=h;
  renderArchiveResults();
  // If agenda text isn't loaded yet, fetch it and re-run the search so
  // agenda-text matches appear without the user retyping.
  ensureAtext(function(){ if(state.view==="archive") renderArchiveResults(); });
  var aq=$("#aq");
  aq.addEventListener("input",function(){ state.archiveQ=aq.value; renderArchiveResults(); });
  var am=$("#amin");
  am.addEventListener("change",function(){ state.minOnly=am.checked; renderArchiveResults(); });
}

function fmtChecked(iso){
  return new Date(iso).toLocaleString("en-US",{timeZone:ET,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}

function renderSources(){
  var src=DATA.sources;
  var h='<div class="srchead fade"><h2>Source health</h2>'+
    '<p class="srcsub">Every town calendar is scraped daily at 6:00 AM ET. '+
    'If a source fails, its meetings may be missing \u2014 this page says so instead of pretending nothing was posted.</p></div>';
  if(!src){
    h+='<p class="none">Source health arrives with the next scheduled scrape.</p>';
  }else{
    h+='<div class="srcgrid fade">';
    townList().forEach(function(tn,i){
      var s=src[tn], dot, status, detail;
      if(!s){ dot="na"; status="Not scraped"; detail="No automated source yet \u2014 coverage is manual."; }
      else if(s.ok){ dot="ok"; status="OK"; detail=s.meetings+" meetings in the feed"; }
      else { dot="bad"; status="Scrape failed"; detail=s.error || "The source could not be reached."; }
      h+='<div class="srccard rise" style="--i:'+Math.min(i,12)+'">'+
        '<span class="sdot '+dot+'"></span>'+
        '<div class="srcbody"><div class="srcname">'+esc(tn)+'</div>'+
        '<div class="srcstatus">'+esc(status)+
          (s && s.checked_at ? ' \u00b7 checked '+esc(fmtChecked(s.checked_at))+" ET" : "")+'</div>'+
        '<div class="srcdetail">'+esc(detail)+'</div>'+
        (s && s.note ? '<div class="srcdetail">'+esc(s.note)+'</div>' : "")+
        '</div></div>';
    });
    h+='</div>';
  }
  $("#view").innerHTML=h;
}

function loadData(){
  $("#view").innerHTML='<p class="loading">Gathering the week&rsquo;s meetings&hellip;</p>';
  fetch("data/meetings.json?ts="+Date.now(),{cache:"no-store"})
    .then(function(r){ if(!r.ok) throw new Error("no data"); return r.json(); })
    .then(function(j){
      DATA=j;
      if(DATA.updated){
        var u=new Date(DATA.updated);
        $("#updated").textContent="Refreshed "+
          u.toLocaleString("en-US",{timeZone:ET,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" ET";
      }
      renderTowns(); renderView();
    })
    .catch(function(){
      $("#view").innerHTML='<p class="none" style="margin-top:30px">Couldn&rsquo;t load the calendar just yet &mdash; the first scrape is probably still running. Check back in a few minutes.</p>';
    });
}

function init(){
  Array.prototype.forEach.call(document.querySelectorAll(".views button"),function(b){
    b.addEventListener("click",function(){ state.view=b.dataset.view; renderView(); });
  });
  var rb=$("#refresh");
  if(rb) rb.addEventListener("click",function(){ loadData(); });
  loadData();
}

document.addEventListener("DOMContentLoaded",init);
})();
