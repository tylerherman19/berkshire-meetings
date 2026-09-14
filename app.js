(function(){
"use strict";

var TOWNS = ["Great Barrington","Egremont","Sheffield","New Marlborough","Monterey","Sandisfield","Lee"];
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

var state = { view:"week", town:"All", day:etToday(), month:etToday().slice(0,7), selDay:etToday() };
var DATA = { meetings:[], updated:null };

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
  TOWNS.forEach(function(x){ counts[x]=0; });
  DATA.meetings.forEach(function(m){
    if(m.date>=t && m.date<e && counts[m.town]!=null) counts[m.town]++;
  });
  var h='<button class="chip'+(state.town==="All"?" active":"")+'" data-town="All">All towns</button>';
  TOWNS.forEach(function(x){
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
}

function renderView(){
  var v=$("#view");
  v.classList.remove("fade"); void v.offsetWidth; v.classList.add("fade");
  if(state.view==="week") renderWeek();
  else if(state.view==="day") renderDay();
  else renderMonth();
  renderStats();
  Array.prototype.forEach.call(document.querySelectorAll(".views button"),function(b){
    var on=b.dataset.view===state.view;
    b.classList.toggle("active",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
}

function init(){
  $("#view").innerHTML='<p class="loading">Gathering the week&rsquo;s meetings&hellip;</p>';
  Array.prototype.forEach.call(document.querySelectorAll(".views button"),function(b){
    b.addEventListener("click",function(){ state.view=b.dataset.view; renderView(); });
  });
  fetch("data/meetings.json",{cache:"no-store"})
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

document.addEventListener("DOMContentLoaded",init);
})();
