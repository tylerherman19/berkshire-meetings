(function(){
"use strict";

var TOWN_ORDER = ["Great Barrington","Sheffield","Egremont","New Marlborough","Monterey","Sandisfield","Otis","Tyringham","Becket","Alford","Richmond","BHRSD","SBRSD"];
var ET = "America/New_York";
var DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MONS_L = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function $(s){ return document.querySelector(s); }
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

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
function fmtShort(iso){ var d=parseD(iso); return MONS[d.getMonth()]+" "+d.getDate(); }
function fmtTime(t){
  if(!t) return null;
  var p=String(t).split(":"), h=+p[0], m=p[1]||"00";
  var ap = h>=12 ? "PM" : "AM";
  h = h%12 || 12;
  return h+":"+m+" "+ap;
}
function fmtRange(m){
  if(m.all_day) return "All day";
  var s = fmtTime(m.start) || "Time TBA";
  if(m.end && m.end!==m.start && m.start) s += " \u2013 "+fmtTime(m.end);
  return s;
}

/* ---------- location cleanup (display-only; raw data untouched) ---------- */
function cleanLoc(loc, board){
  var s = String(loc==null?"":loc);
  s = s.split(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)[0];
  var viaZoom = /via zoom|remote meeting/i.test(s);
  var phys = s.split(/via zoom|remote meeting/i)[0];
  phys = phys.replace(/https?:\/\/\S+/g," ");
  phys = phys.replace(/\bDial[-\s]?in\s*:?[^;]*/gi," ");
  phys = phys.replace(/\b(Webinar ID|Meeting ID|Passcode)\s*:?[^;]*/gi," ");
  phys = phys.replace(/\+\d[\d\s().-]{6,}/g," ");
  phys = phys.replace(/BarringtonTown/g,"Barrington Town");
  phys = phys.replace(/\s+,/g,",");
  if(board) phys = phys.replace(new RegExp("\\s*"+escRe(board)+"\\s*$","i"),"");
  phys = phys.replace(/^(in-person|hybrid meeting)(\s+in person)?(\s+at)?\s+/i,"");
  phys = phys.replace(/,?\s*United States\s*$/i,"");
  phys = phys.replace(/\s{2,}/g," ").replace(/[\s\u00b7:;,.\-]+$/,"").replace(/\s+and$/i,"").trim();
  if(!phys) return viaZoom ? "Remote via Zoom" : "";
  return viaZoom ? phys + " \u00b7 via Zoom" : phys;
}
function isRemote(loc){ return /via zoom|remote meeting/i.test(String(loc||"")); }

/* ---------- stars (localStorage) ---------- */
var STAR_KEY = "bm-stars-v1";
function loadStars(){
  try{ return JSON.parse(localStorage.getItem(STAR_KEY)) || {}; }
  catch(e){ return {}; }
}
var STARS = loadStars();
function saveStars(){ try{ localStorage.setItem(STAR_KEY, JSON.stringify(STARS)); }catch(e){} }
function starKey(m){
  return [m.town||"", m.board||"", m.title||"", m.date||"", m.start||""].join("|");
}
function isStarred(m){ return !!STARS[starKey(m)]; }
function toggleStar(key){
  if(STARS[key]) delete STARS[key];
  else STARS[key] = {t: Date.now()};
  saveStars(); updateStarUI(); renderView();
}
function starredMeetings(){
  var out = [];
  DATA.meetings.forEach(function(m){ if(isStarred(m)) out.push(m); });
  out.sort(function(a,b){
    return a.date.localeCompare(b.date) || (a.start||"99").localeCompare(b.start||"99");
  });
  return out;
}
function updateStarUI(){
  var n = Object.keys(STARS).length;
  var sc = $("#starcount"); if(sc) sc.textContent = n;
  var sn = $("#starchip-n"); if(sn) sn.textContent = n;
}

/* ---------- calendar sync: ICS download + Google Calendar links ---------- */
function icsEsc(s){
  return String(s==null?"":s).replace(/\\/g,"\\\\").replace(/;/g,"\\;")
    .replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
}
function icsDTStamp(){ return new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,""); }
function icsLocal(dateStr, timeStr){
  var t = String(timeStr||"").split(":");
  var hh = String(t[0]||"00").padStart(2,"0"), mm = String(t[1]||"00").padStart(2,"0");
  return dateStr.replace(/-/g,"")+"T"+hh+mm+"00";
}
function addHour(timeStr){
  var t = String(timeStr||"00:00").split(":");
  var h = (+t[0]+1)%24, m = t[1]||"00";
  return String(h).padStart(2,"0")+":"+m;
}
function eventEnd(m){
  return (m.end && m.end!==m.start) ? m.end : addHour(m.start||"00:00");
}
function buildICS(list){
  var L = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Berkshire Meetings//EN","CALSCALE:GREGORIAN"];
  list.forEach(function(m){
    var uid = icsEsc(starKey(m)).replace(/\|/g,"-")+"@berkshire-meetings";
    L.push("BEGIN:VEVENT","UID:"+uid,"DTSTAMP:"+icsDTStamp());
    if(m.start && !m.all_day){
      L.push("DTSTART;TZID="+ET+":"+icsLocal(m.date,m.start));
      L.push("DTEND;TZID="+ET+":"+icsLocal(m.date,eventEnd(m)));
    }else{
      L.push("DTSTART;VALUE=DATE:"+m.date.replace(/-/g,""));
      L.push("DTEND;VALUE=DATE:"+addDays(m.date,1).replace(/-/g,""));
    }
    L.push("SUMMARY:"+icsEsc(m.title));
    var desc = (m.board ? m.board+" \u00b7 " : "")+(m.town||"");
    if(m.agenda_url) desc += "\\nAgenda: "+m.agenda_url;
    if(m.minutes_url) desc += "\\nMinutes: "+m.minutes_url;
    desc += "\\n\\nvia Berkshire Meetings";
    L.push("DESCRIPTION:"+icsEsc(desc));
    var loc = cleanLoc(m.location, m.board);
    if(loc) L.push("LOCATION:"+icsEsc(loc));
    L.push("END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return L.join("\r\n");
}
function downloadICS(list, filename){
  if(!list.length) return;
  var blob = new Blob([buildICS(list)],{type:"text/calendar;charset=utf-8"});
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "berkshire-meetings.ics";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
function gcalURL(m){
  var dates, details = (m.board?m.board+" \u00b7 ":"")+(m.town||"");
  if(m.agenda_url) details += "\nAgenda: "+m.agenda_url;
  details += "\n\nvia Berkshire Meetings";
  if(m.start && !m.all_day){
    dates = icsLocal(m.date,m.start)+"/"+icsLocal(m.date,eventEnd(m));
  }else{
    dates = m.date.replace(/-/g,"")+"/"+addDays(m.date,1).replace(/-/g,"");
  }
  var p = {action:"TEMPLATE", text:m.title||"Meeting", dates:dates,
           details:details, location:cleanLoc(m.location,m.board)};
  return "https://calendar.google.com/calendar/render?"+
    Object.keys(p).map(function(k){ return k+"="+encodeURIComponent(p[k]); }).join("&");
}

/* ---------- state + data ---------- */
var state = { view:"week", town:"All", mode:"week", q:"",
              day:etToday(), month:etToday().slice(0,7), selDay:etToday(),
              archiveQ:"", minOnly:false, showAllChanges:false };
var DATA = { meetings:[], updated:null, sources:null };
var CHANGES = { updated:null, changes:[] };
var NEW_KEYS = {}, UPD_KEYS = {};
var BY_KEY = {};

function townList(){
  var seen={}, list=[];
  TOWN_ORDER.forEach(function(t){ if(!seen[t]){ seen[t]=1; list.push(t); } });
  DATA.meetings.forEach(function(m){ if(m.town && !seen[m.town]){ seen[m.town]=1; list.push(m.town); } });
  list.sort(function(a,b){
    var ia=TOWN_ORDER.indexOf(a), ib=TOWN_ORDER.indexOf(b);
    if(ia<0 && ib<0) return a<b?-1:1;
    if(ia<0) return 1;
    if(ib<0) return -1;
    return ia-ib;
  });
  return list;
}
function inTown(m){ return state.town==="All" || m.town===state.town; }
function matchesQ(m){
  var q = state.q.trim().toLowerCase();
  if(!q) return true;
  return (m.title+" "+(m.board||"")+" "+m.town+" "+(m.location||"")).toLowerCase().indexOf(q)>=0;
}
function byTime(a,b){ return (a.start||"99:99").localeCompare(b.start||"99:99"); }

function indexChanges(){
  NEW_KEYS = {}; UPD_KEYS = {};
  var cutoff = addDays(etToday(),-2);
  CHANGES.changes.forEach(function(c){
    if((c.at||"").slice(0,10) < cutoff) return;
    var k = [c.town||"",c.board||"",c.title||"",c.date||"",c.start||""].join("|");
    if(c.type==="added") NEW_KEYS[k]=1;
    else if(c.type==="changed") UPD_KEYS[k]=1;
  });
}

/* ---------- meeting cards ---------- */
function statusPills(m){
  var h = "";
  var k = starKey(m);
  if(NEW_KEYS[k]) h += '<span class="tag new">New</span>';
  else if(UPD_KEYS[k]) h += '<span class="tag updated">Updated</span>';
  if(m.agenda_url) h += '<span class="tag agenda">Agenda posted</span>';
  if(m.minutes_url) h += '<span class="tag minutes">Minutes available</span>';
  if(isRemote(m.location)) h += '<span class="tag remote">Remote</span>';
  return h;
}
function meetingCard(m, i, opts){
  opts = opts || {};
  var k = starKey(m);
  var starred = !!STARS[k];
  var loc = cleanLoc(m.location, m.board);
  var when = opts.showDate
    ? esc(fmtShort(m.date))+" \u00b7 "+esc(fmtRange(m))
    : esc(fmtRange(m));
  var links = "";
  if(m.agenda_url) links += '<a class="mlink" href="'+esc(m.agenda_url)+'" target="_blank" rel="noopener">View agenda</a>';
  else if(m.minutes_url) links += '<a class="mlink ghost" href="'+esc(m.minutes_url)+'" target="_blank" rel="noopener">Minutes</a>';
  if(opts.sync){
    links += '<a class="mlink ghost" href="'+esc(gcalURL(m))+'" target="_blank" rel="noopener">Google Calendar</a>';
    links += '<button class="mlink ghost" data-action="ics" data-key="'+esc(k)+'" type="button">.ics</button>';
  }
  return '<article class="mcard rise" style="--i:'+Math.min(i,14)+'">'+
    '<div class="m-main">'+
    '<div class="m-top"><span class="m-title">'+esc(m.title)+'</span>'+
    '<button class="star" data-action="star" data-key="'+esc(k)+'" aria-pressed="'+starred+'" title="'+(starred?"Unstar":"Star this meeting")+'" type="button">'+(starred?"\u2605":"\u2606")+'</button></div>'+
    '<div class="m-meta">'+esc(m.town)+(m.board?" \u00b7 "+esc(m.board):"")+'</div>'+
    '<div class="m-when"><span class="t">'+when+'</span>'+(loc?" \u00b7 "+esc(loc):"")+'</div>'+
    '<div class="m-tags">'+statusPills(m)+links+'</div>'+
    '</div></article>';
}

/* ---------- hero (week view only) ---------- */
function renderHero(){
  var hero = $("#hero");
  hero.style.display = state.view==="week" ? "" : "none";
  if(state.view!=="week") return;
  var t=etToday(), e=addDays(t,7), counts={};
  var towns=townList();
  towns.forEach(function(x){ counts[x]=0; });
  DATA.meetings.forEach(function(m){
    if(m.date>=t && m.date<e && counts[m.town]!=null) counts[m.town]++;
  });
  var h='<button class="tchip'+(state.town==="All"?" active":"")+'" data-action="town" data-town="All" type="button">All towns</button>';
  towns.forEach(function(x){
    h+='<button class="tchip'+(state.town===x?" active":"")+'" data-action="town" data-town="'+esc(x)+'" type="button">'+esc(x)+'<span class="n">'+counts[x]+'</span></button>';
  });
  $("#towns").innerHTML=h;
  Array.prototype.forEach.call(document.querySelectorAll("#modechips .chip"),function(b){
    b.classList.toggle("active", b.dataset.mode===state.mode);
  });
  var q=$("#q");
  if(q && q.value!==state.q) q.value=state.q;
}

/* ---------- week view ---------- */
function changeItem(c){
  var dot = c.type==="added"?"added":(c.type==="changed"?"changed":"removed");
  var label = c.type==="added" ? "New meeting posted"
    : c.type==="removed" ? "No longer posted"
    : (c.fields||[]).map(function(f){
        return {time:"Time changed",location:"Location changed",agenda:"Agenda posted",minutes:"Minutes posted"}[f]||"Updated";
      }).join(", ");
  return '<div class="chg"><span class="dot '+dot+'"></span><div><b>'+esc(label)+'</b> &mdash; '+esc(c.title)+
    '<span class="cm">'+esc(c.board)+", "+esc(c.town)+" \u00b7 "+esc(fmtShort(c.date))+"</span></div></div>";
}
function changesCard(){
  var ch = CHANGES.changes||[];
  var h = '<div class="card"><h3>What changed?</h3>';
  if(!ch.length){
    h += '<p class="cardsub">The daily scrape notes newly posted, moved, and removed meetings here. Nothing flagged in the latest run.</p>';
  }else{
    var when = CHANGES.updated ? new Date(CHANGES.updated).toLocaleString("en-US",{timeZone:ET,month:"short",day:"numeric"}) : "";
    h += '<p class="cardsub">'+ch.length+' update'+(ch.length===1?"":"s")+' from the '+(when||"latest")+' scrape</p>';
    var show = state.showAllChanges ? ch : ch.slice(0,5);
    h += show.map(changeItem).join("");
    if(ch.length>5 && !state.showAllChanges)
      h += '<button class="more" data-action="more-changes" type="button">View all '+ch.length+'</button>';
  }
  return h+'</div>';
}
function townSideCard(){
  var t=etToday(), e=addDays(t,7), counts={};
  townList().forEach(function(x){ counts[x]=0; });
  DATA.meetings.forEach(function(m){
    if(m.date>=t && m.date<e && counts[m.town]!=null) counts[m.town]++;
  });
  var h='<div class="card"><h3>Browse by town</h3><p class="cardsub">Meetings in the next 7 days</p>';
  townList().forEach(function(x){
    var s = DATA.sources && DATA.sources[x];
    var dot = !s ? "" : (s.ok ? '<span class="sdot ok"></span>' : '<span class="sdot bad"></span>');
    h+='<button class="townlink" data-action="town" data-town="'+esc(x)+'" type="button">'+dot+'<span class="tname">'+esc(x)+'</span><span class="tn">'+counts[x]+'</span></button>';
  });
  return h+'</div>';
}
function syncBar(n){
  return '<div class="syncbar fade"><span class="sb-t">'+n+' starred</span>'+
    '<span class="sb-s">Download them all as one calendar file, or add each to Google Calendar below.</span>'+
    '<button class="btn" data-action="ics-all" type="button">Download .ics</button></div>';
}
function dayLabel(iso, i){
  if(i===0) return "Today";
  if(i===1) return "Tomorrow";
  return fmtDay(iso);
}
function renderWeek(){
  var t=etToday(), h="";
  if(state.mode==="starred"){
    var starred = starredMeetings().filter(function(m){ return inTown(m)&&matchesQ(m); });
    h+='<div class="layout"><section class="feed">';
    h+='<div class="feedhead"><h2>Starred meetings</h2><span class="count">'+starred.length+' starred</span></div>';
    if(starred.length){
      h+=syncBar(starred.length);
      var byDay={}, order=[];
      starred.forEach(function(m){
        if(!byDay[m.date]){ byDay[m.date]=[]; order.push(m.date); }
        byDay[m.date].push(m);
      });
      order.forEach(function(d){
        h+='<div class="daygroup"><h3>'+esc(fmtDay(d))+' <span class="dc">'+byDay[d].length+' meeting'+(byDay[d].length===1?"":"s")+'</span></h3>';
        h+=byDay[d].map(function(m,j){ return meetingCard(m,j,{sync:true}); }).join("");
        h+='</div>';
      });
    }else{
      h+='<p class="none">Nothing starred yet. Tap the \u2606 on any meeting to save it here, then sync it to your calendar.</p>';
    }
    h+='</section><aside class="side">'+changesCard()+townSideCard()+'</aside></div>';
    $("#view").innerHTML=h;
    return;
  }
  var total=0;
  var days=[];
  for(var i=0;i<7;i++){
    var d=addDays(t,i);
    var ms=DATA.meetings.filter(function(m){ return inTown(m)&&matchesQ(m)&&m.date===d; }).sort(byTime);
    total+=ms.length;
    days.push({d:d,ms:ms,i:i});
  }
  h+='<div class="layout"><section class="feed">';
  var rng = fmtShort(t)+" \u2013 "+fmtShort(addDays(t,6))+", "+parseD(t).getFullYear();
  h+='<div class="feedhead"><h2>Meetings This Week</h2><span class="range">'+esc(rng)+'</span><span class="count">'+total+' meetings</span></div>';
  if(state.q.trim()) h+='<p class="archcount" style="margin:0 0 14px">Filtering by \u201c'+esc(state.q.trim())+'\u201d</p>';
  var any=false;
  days.forEach(function(g){
    if(!g.ms.length) return;
    any=true;
    h+='<div class="daygroup"><h3>'+esc(dayLabel(g.d,g.i))+' <span class="dc">'+g.ms.length+' meeting'+(g.ms.length===1?"":"s")+'</span></h3>';
    h+=g.ms.map(function(m,j){ return meetingCard(m,j); }).join("");
    h+='</div>';
  });
  if(!any) h+='<p class="none">'+(state.q.trim()?"No meetings match your search.":"Nothing posted for this week.")+'</p>';
  h+='</section><aside class="side">'+changesCard()+townSideCard()+'</aside></div>';
  $("#view").innerHTML=h;
}

/* ---------- day / month / towns / archive / sources ---------- */
function renderDay(){
  var d=state.day;
  var ms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===d; }).sort(byTime);
  var h='<div class="viewhead"><h2>'+esc(fmtDay(d))+'</h2>'+
    '<p class="vsub">'+ms.length+' meeting'+(ms.length===1?"":"s")+(state.town!=="All"?" in "+esc(state.town):"")+'</p></div>';
  h+='<div class="daynav fade"><button class="navbtn" data-action="day-prev" aria-label="Previous day" type="button">&larr;</button>'+
    '<div style="flex:1"></div>'+
    '<button class="todaybtn" data-action="day-today" type="button">Back to today</button>'+
    '<button class="navbtn" data-action="day-next" aria-label="Next day" type="button">&rarr;</button></div>';
  if(!ms.length) h+='<p class="none">Nothing posted for this day.</p>';
  else h+=ms.map(function(m,j){ return meetingCard(m,j); }).join("");
  $("#view").innerHTML=h;
}
function renderMonth(){
  var ym=state.month.split("-"), y=+ym[0], mo=+ym[1];
  var startDay=new Date(y,mo-1,1).getDay();
  var dim=new Date(y,mo,0).getDate();
  var t=etToday();
  var h='<div class="viewhead"><h2>'+MONS_L[mo-1]+' '+y+'</h2>'+
    '<p class="vsub">Tap a day to see its meetings'+(state.town!=="All"?" in "+esc(state.town):"")+'</p></div>';
  h+='<div class="daynav fade"><button class="navbtn" data-action="month-prev" aria-label="Previous month" type="button">&larr;</button>'+
    '<div style="flex:1"></div>'+
    '<button class="navbtn" data-action="month-next" aria-label="Next month" type="button">&rarr;</button></div>';
  h+='<div class="grid fade">';
  DOW.forEach(function(d){ h+='<div class="dow">'+d.slice(0,2)+'</div>'; });
  for(var i=0;i<startDay;i++) h+='<div class="cell blank"></div>';
  for(var d=1;d<=dim;d++){
    var iso=state.month+"-"+String(d).padStart(2,"0");
    var ms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===iso; });
    var dots=ms.slice(0,3).map(function(){ return '<span class="dot"></span>'; }).join("")+
      (ms.length>3 ? '<span class="more">+'+(ms.length-3)+'</span>' : "");
    h+='<button class="cell rise'+(iso===t?" today":"")+(iso===state.selDay?" sel":"")+'" style="--i:'+Math.min(d,18)+'" data-action="sel-day" data-day="'+iso+'" type="button">'+
       '<span class="dnum">'+d+'</span><span class="dots">'+dots+'</span></button>';
  }
  h+='</div>';
  var sel=state.selDay;
  var sms=DATA.meetings.filter(function(m){ return inTown(m)&&m.date===sel; }).sort(byTime);
  h+='<div class="selday"><h3>'+esc(fmtDay(sel))+'</h3><span class="count" style="font-family:var(--mono);font-size:12px;color:var(--muted)">'+sms.length+' meeting'+(sms.length===1?"":"s")+'</span>';
  if(!sms.length) h+='<p class="none">Nothing posted.</p>';
  else h+=sms.map(function(m,j){ return meetingCard(m,j); }).join("");
  h+='</div>';
  $("#view").innerHTML=h;
}
function renderTowns(){
  var t=etToday(), e=addDays(t,7);
  var h='<div class="viewhead"><h2>Towns &amp; districts</h2>'+
    '<p class="vsub">Pick a town to filter the week view. Counts cover the next 7 days.</p></div>';
  h+='<div class="towngrid">';
  townList().forEach(function(x,i){
    var wk=DATA.meetings.filter(function(m){ return m.town===x&&m.date>=t&&m.date<e; });
    var upcoming=DATA.meetings.filter(function(m){ return m.town===x&&m.date>=t; }).sort(function(a,b){
      return a.date.localeCompare(b.date)||(a.start||"99").localeCompare(b.start||"99");
    });
    var s=DATA.sources&&DATA.sources[x];
    var dot='<span class="sdot '+(s?(s.ok?"ok":"bad"):"")+'"></span>';
    var next=upcoming.length
      ? '<div class="tc-next">Next: <b>'+esc(upcoming[0].board||upcoming[0].title)+'</b><br>'+esc(fmtShort(upcoming[0].date))+(upcoming[0].start?" \u00b7 "+esc(fmtTime(upcoming[0].start)):"")+'</div>'
      : '<div class="tc-next">No upcoming meetings posted.</div>';
    h+='<button class="towncard rise" style="--i:'+Math.min(i,12)+'" data-action="town" data-town="'+esc(x)+'" type="button">'+
      '<div class="tc-top">'+dot+'<span class="tc-name">'+esc(x)+'</span></div>'+
      '<div class="tc-n">'+wk.length+' in the next 7 days \u00b7 '+upcoming.length+' upcoming</div>'+
      next+'</button>';
  });
  h+='</div>';
  $("#view").innerHTML=h;
}

/* archive (minutes search) */
var ATEXT=null, ATEXT_LOADING=false;
function ensureAtext(cb){
  if(ATEXT!==null){ if(cb) cb(); return; }
  if(ATEXT_LOADING) return;
  ATEXT_LOADING=true;
  fetch("data/agenda_text.json?ts="+Date.now(),{cache:"no-store"})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(j){ ATEXT=(j&&j.texts)||{}; ATEXT_LOADING=false; if(cb) cb(); })
    .catch(function(){ ATEXT={}; ATEXT_LOADING=false; if(cb) cb(); });
}
function archiveMatches(){
  var t=etToday(), q=state.archiveQ.trim().toLowerCase(), out=[];
  DATA.meetings.forEach(function(m){
    if(m.date>=t || !inTown(m)) return;
    if(state.minOnly && !m.minutes_url) return;
    var inAgenda=false;
    if(q){
      var hay=(m.title+" "+(m.board||"")+" "+m.town).toLowerCase();
      if(hay.indexOf(q)<0){
        var txt=ATEXT?(ATEXT[starKey(m)]||""):"";
        inAgenda=txt && txt.toLowerCase().indexOf(q)>=0;
        if(!inAgenda) return;
      }
    }
    out.push({m:m,inAgenda:inAgenda});
  });
  out.sort(function(a,b){
    return b.m.date.localeCompare(a.m.date)||(b.m.start||"").localeCompare(a.m.start||"");
  });
  return out;
}
function renderArchive(){
  var t=etToday();
  var past=DATA.meetings.filter(function(m){ return m.date<t&&inTown(m); });
  var withMin=past.filter(function(m){ return m.minutes_url; }).length;
  var h='<div class="viewhead"><h2>Minutes archive</h2>'+
    '<p class="vsub">Search past meetings, boards, and the text of posted agendas and minutes.</p></div>';
  h+='<div class="archivebar fade">'+
    '<input id="aq" type="search" placeholder="Search past meetings, boards, agendas, minutes\u2026" value="'+esc(state.archiveQ)+'" aria-label="Search the minutes archive" autocomplete="off">'+
    '<label class="minonly"><input type="checkbox" id="amin"'+(state.minOnly?" checked":"")+'> Minutes only</label>'+
    '</div>'+
    '<p class="archcount">'+past.length+' past meetings'+(withMin?' \u00b7 '+withMin+' with minutes posted':"")+'</p>'+
    '<div id="archresults"></div>';
  $("#view").innerHTML=h;
  renderArchiveResults();
  ensureAtext(function(){ if(state.view==="archive") renderArchiveResults(); });
  var aq=$("#aq");
  aq.addEventListener("input",function(){ state.archiveQ=aq.value; renderArchiveResults(); });
  var am=$("#amin");
  am.addEventListener("change",function(){ state.minOnly=am.checked; renderArchiveResults(); });
}
function renderArchiveResults(){
  var box=$("#archresults");
  if(!box) return;
  var rows=archiveMatches();
  if(!rows.length){
    box.innerHTML='<p class="none" style="margin-top:20px">No past meetings match.</p>';
    return;
  }
  box.innerHTML=rows.map(function(r,i){
    var html=meetingCard(r.m,i,{showDate:true});
    if(r.inAgenda) html=html.replace('<div class="m-tags">','<div class="m-tags"><span class="hit">match in document text</span>');
    return html;
  }).join("");
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
      if(!s){ dot=""; status="Not scraped"; detail="No automated source yet \u2014 coverage is manual."; }
      else if(s.ok){ dot="ok"; status="OK"; detail=s.meetings+" meetings in the feed"; }
      else { dot="bad"; status="Scrape failed"; detail=s.error || "The source could not be reached."; }
      h+='<div class="srccard rise" style="--i:'+Math.min(i,12)+'">'+
        '<div class="srcname"><span class="sdot '+dot+'"></span>'+esc(tn)+'</div>'+
        '<div class="srcstatus">'+esc(status)+
          (s && s.checked_at ? ' \u00b7 checked '+esc(new Date(s.checked_at).toLocaleString("en-US",{timeZone:ET,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))+" ET" : "")+'</div>'+
        '<div class="srcdetail">'+esc(detail)+'</div>'+
        (s && s.note ? '<div class="srcdetail">'+esc(s.note)+'</div>' : "")+
        '</div>';
    });
    h+='</div>';
  }
  $("#view").innerHTML=h;
}

/* ---------- view switching + events ---------- */
function setView(v){
  state.view=v;
  if(v!=="week") state.mode="week";
  renderHero(); renderView();
}
function renderView(){
  var v=$("#view");
  v.classList.remove("fade"); void v.offsetWidth; v.classList.add("fade");
  if(state.view==="week") renderWeek();
  else if(state.view==="day") renderDay();
  else if(state.view==="month") renderMonth();
  else if(state.view==="towns") renderTowns();
  else if(state.view==="archive") renderArchive();
  else if(state.view==="sources") renderSources();
  Array.prototype.forEach.call(document.querySelectorAll("#views button"),function(b){
    b.classList.toggle("active", b.dataset.view===state.view);
  });
  updateStarUI();
}
function byKey(k){ return BY_KEY[k]; }

document.addEventListener("click",function(e){
  var el=e.target.closest("[data-action]");
  if(!el) return;
  var a=el.dataset.action;
  if(a==="star"){ toggleStar(el.dataset.key); }
  else if(a==="ics"){ var m=byKey(el.dataset.key); if(m) downloadICS([m],"berkshire-meeting.ics"); }
  else if(a==="ics-all"){
    var list=starredMeetings().filter(function(m){ return inTown(m)&&matchesQ(m); });
    downloadICS(list,"berkshire-meetings-starred.ics");
  }
  else if(a==="mode"){ state.mode=el.dataset.mode; renderHero(); renderView(); }
  else if(a==="town"){ state.town=el.dataset.town; state.mode="week"; setView("week"); }
  else if(a==="view"){ setView(el.dataset.view); }
  else if(a==="more-changes"){ state.showAllChanges=true; renderView(); }
  else if(a==="day-prev"){ state.day=addDays(state.day,-1); renderDay(); }
  else if(a==="day-next"){ state.day=addDays(state.day,1); renderDay(); }
  else if(a==="day-today"){ state.day=etToday(); renderDay(); }
  else if(a==="month-prev"){ var d0=new Date(+state.month.slice(0,4),+state.month.slice(5)-2,1); state.month=d0.getFullYear()+"-"+String(d0.getMonth()+1).padStart(2,"0"); renderMonth(); }
  else if(a==="month-next"){ var d1=new Date(+state.month.slice(0,4),+state.month.slice(5),1); state.month=d1.getFullYear()+"-"+String(d1.getMonth()+1).padStart(2,"0"); renderMonth(); }
  else if(a==="sel-day"){ state.selDay=el.dataset.day; renderMonth(); }
});
document.addEventListener("DOMContentLoaded",function(){
  Array.prototype.forEach.call(document.querySelectorAll("#views button"),function(b){
    b.addEventListener("click",function(){ setView(b.dataset.view); });
  });
  $("#brand").addEventListener("click",function(){ state.town="All"; state.q=""; setView("week"); });
  $("#starjump").addEventListener("click",function(){ state.mode="starred"; setView("week"); });
  var q=$("#q");
  q.addEventListener("input",function(){ state.q=q.value; if(state.view==="week") renderWeek(); });
  loadData();
});

/* ---------- data loading ---------- */
function loadData(){
  $("#view").innerHTML='<p class="loading">Gathering the week&rsquo;s meetings&hellip;</p>';
  var ts="?ts="+Date.now();
  Promise.all([
    fetch("data/meetings.json"+ts,{cache:"no-store"}).then(function(r){ if(!r.ok) throw 0; return r.json(); }),
    fetch("data/changes.json"+ts,{cache:"no-store"}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
  ]).then(function(res){
    DATA=res[0];
    CHANGES=res[1]||{updated:null,changes:[]};
    BY_KEY={};
    DATA.meetings.forEach(function(m){ BY_KEY[starKey(m)]=m; });
    indexChanges();
    if(DATA.updated){
      var u=new Date(DATA.updated);
      $("#updated").textContent="Refreshed "+
        u.toLocaleString("en-US",{timeZone:ET,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" ET";
    }
    renderHero(); renderView();
  }).catch(function(){
    $("#view").innerHTML='<p class="none" style="margin-top:30px">Couldn&rsquo;t load the calendar just yet &mdash; the first scrape is probably still running. Check back in a few minutes.</p>';
  });
}
})();
