/* ============================================================
   Berkshire Meetings
   Briefing (A) · Power Calendar (B) · Town Dashboard (C)
   Static, no build step, no dependencies.
   ============================================================ */
(function(){
"use strict";

var TOWN_ORDER = ["Great Barrington","Sheffield","Egremont","New Marlborough","Monterey",
                  "Sandisfield","Otis","Tyringham","Becket","Alford","Richmond"];
var DISTRICTS = ["BHRSD","SBRSD"];
var DISTRICT_NAMES = {BHRSD:"Berkshire Hills RSD", SBRSD:"Southern Berkshire RSD"};
var ET = "America/New_York";
var DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MONS_L = ["January","February","March","April","May","June","July","August",
              "September","October","November","December"];

/* ---------------------------------------------------------- utilities */
function $(s){ return document.querySelector(s); }
function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
function pad2(n){ return String(n).length<2 ? "0"+n : String(n); }

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
function fmtDay(iso){ var d=parseD(iso); return DOW[d.getDay()]+", "+MONS[d.getMonth()]+" "+d.getDate(); }
function fmtShort(iso){ var d=parseD(iso); return MONS[d.getMonth()]+" "+d.getDate(); }
function fmtLong(iso){ var d=parseD(iso); return DOW[d.getDay()]+", "+MONS_L[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear(); }
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
  if(m.end && m.end!==m.start && m.start) s += " – "+fmtTime(m.end);
  return s;
}
function dayLabel(iso){
  var t=etToday();
  if(iso===t) return "Today";
  if(iso===addDays(t,1)) return "Tomorrow";
  if(iso===addDays(t,-1)) return "Yesterday";
  return fmtDay(iso);
}
function townLabel(t){ return DISTRICT_NAMES[t] || t; }
function plural(n,w){ return n+" "+w+(n===1?"":"s"); }

/* ------------------------------------------- location cleanup (display) */
function cleanLoc(loc, board){
  var s=String(loc==null?"":loc);
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
  phys = phys.replace(/\s{2,}/g," ").replace(/[\s·:;,.\-]+$/,"").replace(/\s+and$/i,"").trim();
  if(!phys) return viaZoom ? "Remote via Zoom" : "";
  return viaZoom ? phys+" · via Zoom" : phys;
}
function isRemote(m){ return /via zoom|remote meeting/i.test(String(m.location||"")); }
function isCancelled(m){ return /\bcancell?ed\b/i.test(String(m.title||"")+" "+String(m.board||"")); }

/* ------------------------------------------------- stars (localStorage) */
var STAR_KEY = "bm-stars-v1";
var FOLLOW_KEY = "bm-follows-v1";
var SEARCH_KEY = "bm-searches-v1";

function lsGet(k,fallback){
  try{ var v=JSON.parse(localStorage.getItem(k)); return v==null?fallback:v; }
  catch(e){ return fallback; }
}
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

var STARS   = lsGet(STAR_KEY,{});
var FOLLOWS = lsGet(FOLLOW_KEY,{});
var SAVED   = lsGet(SEARCH_KEY,[]);

/* A meeting's identity: stable across scrapes as long as it isn't rescheduled. */
function mkey(m){
  return [m.town||"",m.board||"",m.title||"",m.date||"",m.start||""].join("|");
}
function isStarred(m){ return !!STARS[mkey(m)]; }
function starCount(){ return Object.keys(STARS).length; }

function toggleStar(key){
  if(STARS[key]) delete STARS[key];
  else STARS[key] = {t:Date.now()};
  lsSet(STAR_KEY,STARS);
  paintStars();
  /* Views built around the star set have to rebuild; everywhere else we just
     repaint the buttons so the page doesn't jump under the reader's thumb. */
  if(state.view==="starred" || (state.view==="briefing" && state.mode==="starred")) renderView();
}
/* Repaint every star button in place, plus the header count. */
function paintStars(){
  var n = starCount();
  var c = $("#starcount"); if(c) c.textContent = n;
  var j = $("#starjump"); if(j) j.classList.toggle("on", n>0);
  var chip = document.getElementById("starchip-n"); if(chip) chip.textContent = n;
  Array.prototype.forEach.call(document.querySelectorAll(".star[data-key]"),function(b){
    var on = !!STARS[b.dataset.key];
    b.setAttribute("aria-pressed", on?"true":"false");
    b.textContent = on ? "★" : "☆";
    b.title = on ? "Remove from your starred meetings" : "Star this meeting";
    var row = b.closest(".mrow");
    if(row) row.classList.toggle("starred", on);
  });
}
function starredMeetings(){
  var out=[];
  DATA.meetings.forEach(function(m){ if(isStarred(m)) out.push(m); });
  return out.sort(byDateTime);
}

/* ---------------------------------------------- follows (towns + boards) */
function followKey(town,board){ return board ? town+"␟"+board : town; }
function isFollowed(town,board){ return !!FOLLOWS[followKey(town,board)]; }
function toggleFollow(key){
  if(FOLLOWS[key]) delete FOLLOWS[key];
  else FOLLOWS[key] = 1;
  lsSet(FOLLOW_KEY,FOLLOWS);
  renderView();
}
function followCount(){ return Object.keys(FOLLOWS).length; }
function matchesFollow(m){
  return !!(FOLLOWS[followKey(m.town,null)] || FOLLOWS[followKey(m.town,m.board)]);
}

/* ============================================================
   Calendar sync — .ics export and Google Calendar links.
   Starred meetings only; nothing leaves the browser.
   ============================================================ */
function icsEsc(s){
  return String(s==null?"":s).replace(/\\/g,"\\\\").replace(/;/g,"\;")
    .replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
}
function icsStamp(){ return new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,""); }
function icsLocal(dateStr,timeStr){
  var t=String(timeStr||"").split(":");
  return dateStr.replace(/-/g,"")+"T"+pad2(t[0]||"00")+pad2(t[1]||"00")+"00";
}
function addHour(timeStr){
  var t=String(timeStr||"00:00").split(":");
  return pad2((+t[0]+1)%24)+":"+pad2(t[1]||"00");
}
function eventEnd(m){ return (m.end && m.end!==m.start) ? m.end : addHour(m.start||"00:00"); }
/* True when the title already says what the board is, so an event doesn't end
   up titled "Council Aging — Council on Aging Meeting". */
function titleCoversBoard(board,title){
  if(!board) return true;
  var t=String(title||"").toLowerCase();
  return String(board).toLowerCase().split(/[^a-z0-9]+/).every(function(w){
    return w.length<3 || t.indexOf(w)>=0;
  });
}
function eventTitle(m){
  var name = titleCoversBoard(m.board,m.title) ? m.title : m.board+" — "+m.title;
  return townLabel(m.town)+": "+name;
}
function eventDesc(m,nl){
  var d = (m.board ? m.board+" · " : "")+townLabel(m.town||"");
  if(m.agenda_url)  d += nl+"Agenda: "+m.agenda_url;
  if(m.minutes_url) d += nl+"Minutes: "+m.minutes_url;
  if(m.source_url && m.source_url!==m.agenda_url) d += nl+"Official posting: "+m.source_url;
  d += nl+nl+"Added from Berkshire Meetings. Confirm the time and place against the official posting before you go.";
  return d;
}
/* A VTIMEZONE for America/New_York so floating times land correctly in
   calendars that won't look up the TZID themselves (notably Outlook). */
var VTIMEZONE = [
  "BEGIN:VTIMEZONE","TZID:America/New_York",
  "BEGIN:DAYLIGHT","TZOFFSETFROM:-0500","TZOFFSETTO:-0400","TZNAME:EDT",
  "DTSTART:19700308T020000","RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU","END:DAYLIGHT",
  "BEGIN:STANDARD","TZOFFSETFROM:-0400","TZOFFSETTO:-0500","TZNAME:EST",
  "DTSTART:19701101T020000","RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU","END:STANDARD",
  "END:VTIMEZONE"
];
function foldLine(l){
  /* RFC 5545 caps content lines at 75 octets; fold the rest onto continuation
     lines so long agenda URLs don't break the import. */
  if(l.length<=73) return l;
  var out=[l.slice(0,73)], rest=l.slice(73);
  while(rest.length>72){ out.push(" "+rest.slice(0,72)); rest=rest.slice(72); }
  if(rest) out.push(" "+rest);
  return out.join("\r\n");
}
function buildICS(list){
  var L=["BEGIN:VCALENDAR","VERSION:2.0",
         "PRODID:-//Berkshire Meetings//Starred meetings//EN",
         "CALSCALE:GREGORIAN","METHOD:PUBLISH",
         "X-WR-CALNAME:Berkshire Meetings — starred",
         "X-WR-TIMEZONE:"+ET].concat(VTIMEZONE);
  list.forEach(function(m){
    var uid = mkey(m).replace(/[^A-Za-z0-9]+/g,"-").replace(/^-|-$/g,"")+"@berkshire-meetings";
    L.push("BEGIN:VEVENT","UID:"+uid,"DTSTAMP:"+icsStamp());
    if(m.start && !m.all_day){
      L.push("DTSTART;TZID="+ET+":"+icsLocal(m.date,m.start));
      L.push("DTEND;TZID="+ET+":"+icsLocal(m.date,eventEnd(m)));
    }else{
      L.push("DTSTART;VALUE=DATE:"+m.date.replace(/-/g,""));
      L.push("DTEND;VALUE=DATE:"+addDays(m.date,1).replace(/-/g,""));
    }
    L.push("SUMMARY:"+icsEsc(eventTitle(m)));
    L.push("DESCRIPTION:"+icsEsc(eventDesc(m,"\n")));
    var loc = cleanLoc(m.location,m.board);
    if(loc) L.push("LOCATION:"+icsEsc(loc));
    if(m.agenda_url) L.push("URL:"+m.agenda_url);
    if(isCancelled(m)) L.push("STATUS:CANCELLED");
    L.push("END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n")+"\r\n";
}
function downloadICS(list,filename){
  if(!list.length) return;
  var blob=new Blob([buildICS(list)],{type:"text/calendar;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url; a.download=filename||"berkshire-meetings.ics"; a.rel="noopener";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },4000);
}
function gcalURL(m){
  var dates = (m.start && !m.all_day)
    ? icsLocal(m.date,m.start)+"/"+icsLocal(m.date,eventEnd(m))
    : m.date.replace(/-/g,"")+"/"+addDays(m.date,1).replace(/-/g,"");
  var p = {
    action:"TEMPLATE",
    text: eventTitle(m),
    dates: dates,
    ctz: ET,
    details: eventDesc(m,"\n"),
    location: cleanLoc(m.location,m.board)
  };
  return "https://calendar.google.com/calendar/render?"+
    Object.keys(p).map(function(k){ return k+"="+encodeURIComponent(p[k]); }).join("&");
}

/* --------------------------------------------------------- how-to blurb */
function howtoBlurb(){
  return '<details class="howto"><summary>How to get these into Google Calendar or Apple Calendar</summary>'+
    '<div class="howto-body">'+
    '<p><b>Google Calendar.</b> Download the <code>.ics</code> file, then open Google Calendar on a computer and go to '+
    '<b>Settings</b> (the gear, top right) &rarr; <b>Import &amp; export</b> &rarr; <b>Import</b>. Choose the file, pick which '+
    'calendar the meetings should land in, and press <b>Import</b>. For a single meeting you can skip all that and use the '+
    '<b>Add to Google</b> button on the meeting itself.</p>'+
    '<p><b>Apple Calendar, Outlook, Fantastical, anything else.</b> Download the file and open it. '+
    'Your calendar app will ask which calendar to add the meetings to and then add all of them at once. '+
    'On an iPhone, tapping the downloaded file does the same thing.</p>'+
    '<p class="note">This is a one-time export, not a live subscription — star more meetings later and download again. '+
    'Re-importing is safe: each meeting carries a stable ID, so most calendars update the existing entry instead of '+
    'creating a duplicate. Town clerks move and cancel meetings, so confirm against the official posting before you go.</p>'+
    '</div></details>';
}

/* ================================================================= state */
var state = {
  view:"briefing",
  mode:"week",            // briefing: week | starred | followed
  town:"All",
  board:"All",
  q:"",
  dateFilter:"day",       // calendar: day | 7 | 30 | month | past
  format:"all",           // all | in-person | remote
  sort:"time",            // time | town | board
  selDay:etToday(),
  month:etToday().slice(0,7),
  sel:null,               // selected meeting key (calendar detail pane)
  tab:"overview",         // town dashboard tab
  followQ:"",
  archiveQ:"",
  minOnly:false,
  showAllChanges:false,
  pcLimit:60,
  newsQ:"",               // news: independent of the meetings search
  newsTown:"All",
  newsCat:"All"
};
var DATA = {meetings:[],updated:null,sources:null};
var CHANGES = {updated:null,changes:[]};
var NEW_KEYS={}, UPD_KEYS={}, BY_KEY={};

/* ------------------------------------------------------- derived lookups */
function townList(){
  var seen={}, list=[];
  TOWN_ORDER.concat(DISTRICTS).forEach(function(t){ if(!seen[t]){ seen[t]=1; list.push(t); } });
  DATA.meetings.forEach(function(m){ if(m.town && !seen[m.town]){ seen[m.town]=1; list.push(m.town); } });
  return list.filter(function(t){ return DISTRICTS.indexOf(t)<0; });
}
function districtList(){
  var seen={}, list=[];
  DISTRICTS.forEach(function(t){ seen[t]=1; list.push(t); });
  DATA.meetings.forEach(function(m){
    if(m.town && !seen[m.town] && TOWN_ORDER.indexOf(m.town)<0 && /RSD|School/i.test(m.town)){
      seen[m.town]=1; list.push(m.town);
    }
  });
  return list;
}
function allPlaces(){ return townList().concat(districtList()); }
function boardsIn(town){
  var seen={}, out=[];
  DATA.meetings.forEach(function(m){
    if(town && town!=="All" && m.town!==town) return;
    var b=m.board||m.title;
    if(b && !seen[b]){ seen[b]=1; out.push(b); }
  });
  return out.sort(function(a,b){ return a.localeCompare(b); });
}
function byDateTime(a,b){
  return a.date.localeCompare(b.date) || (a.start||"99:99").localeCompare(b.start||"99:99");
}
function byTime(a,b){ return (a.start||"99:99").localeCompare(b.start||"99:99"); }

function upcoming(town){
  var t=etToday();
  return DATA.meetings.filter(function(m){
    return m.date>=t && (!town || town==="All" || m.town===town);
  }).sort(byDateTime);
}
function weekCount(town){
  var t=etToday(), e=addDays(t,7);
  return DATA.meetings.filter(function(m){
    return m.date>=t && m.date<e && (!town || town==="All" || m.town===town);
  }).length;
}

function indexChanges(){
  NEW_KEYS={}; UPD_KEYS={};
  var cutoff=addDays(etToday(),-3);
  (CHANGES.changes||[]).forEach(function(c){
    if((c.at||"").slice(0,10) < cutoff) return;
    var k=[c.town||"",c.board||"",c.title||"",c.date||"",c.start||""].join("|");
    if(c.type==="added") NEW_KEYS[k]=1;
    else if(c.type==="changed") UPD_KEYS[k]=1;
  });
}
function recentChangeCount(town){
  var cutoff=addDays(etToday(),-3);
  return (CHANGES.changes||[]).filter(function(c){
    return (c.at||"").slice(0,10)>=cutoff && (!town||town==="All"||c.town===town);
  }).length;
}

/* ============================================================== fragments */
function statusTags(m){
  var h="", k=mkey(m);
  if(isCancelled(m)) h += '<span class="tag cancelled">Cancelled</span>';
  if(NEW_KEYS[k]) h += '<span class="tag new">New</span>';
  else if(UPD_KEYS[k]) h += '<span class="tag updated">Changed</span>';
  if(m.agenda_url) h += '<span class="tag agenda">Agenda posted</span>';
  if(m.minutes_url) h += '<span class="tag minutes">Minutes available</span>';
  h += isRemote(m) ? '<span class="tag remote">Remote</span>'
                   : '<span class="tag inperson">In-person</span>';
  return h;
}
function starBtn(m){
  var k=mkey(m), on=!!STARS[k];
  return '<button class="star" data-action="star" data-key="'+esc(k)+'" '+
    'aria-pressed="'+on+'" title="'+(on?"Remove from your starred meetings":"Star this meeting")+'" '+
    'aria-label="'+(on?"Unstar":"Star")+' '+esc(m.title)+'" type="button">'+(on?"★":"☆")+'</button>';
}
/* The briefing row: day gutter | what & when | actions. */
function meetingRow(m,i,opts){
  opts = opts||{};
  var k=mkey(m), d=parseD(m.date), loc=cleanLoc(m.location,m.board);
  var act = "";
  if(m.agenda_url)       act += '<a class="btn ghost sm" href="'+esc(m.agenda_url)+'" target="_blank" rel="noopener">View agenda</a>';
  else if(m.minutes_url) act += '<a class="btn ghost sm" href="'+esc(m.minutes_url)+'" target="_blank" rel="noopener">Minutes</a>';
  if(opts.sync){
    act += '<a class="btn ghost sm" href="'+esc(gcalURL(m))+'" target="_blank" rel="noopener">Add to Google</a>';
    act += '<button class="btn ghost sm" data-action="ics-one" data-key="'+esc(k)+'" type="button">.ics</button>';
  }
  return '<article class="mrow rise'+(STARS[k]?" starred":"")+'" style="--i:'+Math.min(i,14)+'">'+
    '<div class="mr-date"><span class="mr-dow">'+DOW[d.getDay()].slice(0,3)+'</span>'+
      '<span class="mr-dnum">'+MONS[d.getMonth()].toUpperCase()+" "+d.getDate()+'</span></div>'+
    '<div class="mr-body">'+
      '<div class="mr-title">'+esc(m.title)+'</div>'+
      '<div class="mr-meta">'+esc(townLabel(m.town))+(m.board?' · '+esc(m.board):"")+'</div>'+
      '<div class="mr-when"><span class="t">'+esc(fmtRange(m))+'</span>'+
        (loc?'<span class="loc">'+esc(loc)+'</span>':"")+'</div>'+
      '<div class="mr-tags">'+statusTags(m)+'</div>'+
    '</div>'+
    '<div class="mr-act">'+starBtn(m)+act+
      '<button class="chev" data-action="open" data-key="'+esc(k)+'" aria-label="Open meeting details" type="button">›</button>'+
    '</div></article>';
}
function groupByDay(list){
  var by={}, order=[];
  list.forEach(function(m){
    if(!by[m.date]){ by[m.date]=[]; order.push(m.date); }
    by[m.date].push(m);
  });
  order.sort();
  return order.map(function(d){ return {date:d, ms:by[d].sort(byTime)}; });
}
function dayGroupsHTML(groups,opts){
  var i=0;
  return groups.map(function(g){
    return '<div class="daygroup"><h3>'+esc(dayLabel(g.date))+
      ' <span class="dc">'+plural(g.ms.length,"meeting")+'</span></h3>'+
      g.ms.map(function(m){ return meetingRow(m,i++,opts); }).join("")+'</div>';
  }).join("");
}

/* ============================================================
   A — CIVIC BRIEFING
   ============================================================ */
function renderHero(){
  var host=$("#herohost");
  if(state.view!=="briefing"){ host.innerHTML=""; host.hidden=true; return; }
  host.hidden=false;
  var updated = DATA.updated
    ? "Refreshed "+new Date(DATA.updated).toLocaleString("en-US",
        {timeZone:ET,month:"long",day:"numeric",hour:"numeric",minute:"2-digit"})+" ET"
    : "Refreshed daily.";
  var places = allPlaces();
  var opts = '<option value="All">All towns</option>'+places.map(function(t){
    return '<option value="'+esc(t)+'"'+(state.town===t?" selected":"")+'>'+esc(townLabel(t))+'</option>';
  }).join("");

  host.innerHTML =
  '<section class="hero">'+
    '<div class="hero-img" aria-hidden="true"></div>'+
    '<div class="hero-veil" aria-hidden="true"></div>'+
    '<div class="hero-in">'+
      '<div class="hero-copy">'+
        '<p class="kicker">South County &middot; Massachusetts</p>'+
        '<h1>Upcoming in South County</h1>'+
        '<p class="sub">Every public meeting. One place. Star the ones you plan to attend and take them '+
          'with you to your own calendar.<span class="upd">'+esc(updated)+'</span></p>'+
      '</div>'+
      '<div class="hero-side"><div class="herosearch">'+
        '<input id="q" type="search" value="'+esc(state.q)+'" placeholder="Search meetings, boards, keywords…" '+
          'autocomplete="off" aria-label="Search upcoming meetings">'+
        '<button class="go" data-action="tosearch" type="button" aria-label="Search">→</button>'+
      '</div></div>'+
    '</div>'+
    '<div class="hero-controls">'+
      '<button class="chip'+(state.mode==="week"?" active":"")+'" data-action="mode" data-mode="week" type="button">This week</button>'+
      '<button class="chip'+(state.mode==="starred"?" active":"")+'" data-action="mode" data-mode="starred" type="button">'+
        '<span aria-hidden="true">★</span> My starred <span class="n" id="starchip-n">'+starCount()+'</span></button>'+
      '<button class="chip'+(state.mode==="followed"?" active":"")+'" data-action="mode" data-mode="followed" type="button">'+
        'My followed boards <span class="n">'+followCount()+'</span></button>'+
      '<span class="selwrap"><select id="townsel" aria-label="Filter by town">'+opts+'</select></span>'+
    '</div>'+
  '</section>';

  var q=$("#q");
  q.addEventListener("input",function(){
    state.q=q.value;
    if(state.view==="briefing") renderBriefingFeed();
  });
  $("#townsel").addEventListener("change",function(e){
    state.town=e.target.value; renderView();
  });
}

function briefingList(){
  var t=etToday(), q=state.q.trim().toLowerCase();
  var end = state.mode==="week" ? addDays(t,7) : "9999-12-31";
  return DATA.meetings.filter(function(m){
    if(m.date<t || m.date>=end) return false;
    if(state.town!=="All" && m.town!==state.town) return false;
    if(state.mode==="starred" && !isStarred(m)) return false;
    if(state.mode==="followed" && !matchesFollow(m)) return false;
    if(q){
      var hay=(m.title+" "+(m.board||"")+" "+townLabel(m.town)+" "+(m.location||"")).toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  }).sort(byDateTime);
}
function changesCard(){
  var ch = CHANGES.changes||[];
  var h='<div class="card"><div class="cardhead"><h3>What changed?</h3>'+
    (ch.length>5 && !state.showAllChanges
      ? '<button class="linkall" data-action="more-changes" type="button">View all '+ch.length+' →</button>' : "")+
    '</div>';
  if(!ch.length){
    h+='<p class="cardsub">The daily scrape flags newly posted, rescheduled and withdrawn meetings here. '+
       'Nothing was flagged in the latest run.</p>';
  }else{
    var when = CHANGES.updated
      ? new Date(CHANGES.updated).toLocaleString("en-US",{timeZone:ET,month:"long",day:"numeric"})
      : "latest";
    h+='<p class="cardsub">'+plural(ch.length,"update")+' from the '+esc(when)+' scrape</p>';
    (state.showAllChanges ? ch : ch.slice(0,5)).forEach(function(c){
      var kind = c.type==="added" ? "added" : c.type==="removed" ? "removed" : "changed";
      var mark = kind==="added" ? "+" : kind==="removed" ? "×" : "∼";
      var label = c.type==="added" ? "New meeting posted"
        : c.type==="removed" ? "No longer posted"
        : (c.fields||[]).map(function(f){
            return {time:"Time changed",location:"Location changed",
                    agenda:"Agenda posted",minutes:"Minutes posted"}[f]||"Updated";
          }).join(", ") || "Updated";
      h+='<div class="chg"><span class="ico '+kind+'" aria-hidden="true">'+mark+'</span><div>'+
         '<b>'+esc(label)+'</b> &mdash; '+esc(c.title)+
         '<span class="cm">'+esc(c.board||"")+(c.board?", ":"")+esc(townLabel(c.town||""))+
         ' · '+esc(fmtShort(c.date))+'</span></div></div>';
    });
  }
  return h+'</div>';
}
function followCard(){
  var fq=state.followQ.trim().toLowerCase();
  var h='<div class="card"><div class="cardhead"><h3>Follow your town or board</h3></div>'+
    '<p class="cardsub">Pick the ones you care about, then use the '+
    '&ldquo;My followed boards&rdquo; filter above to see only those.</p>'+
    '<div class="followsearch"><input id="followq" type="search" value="'+esc(state.followQ)+'" '+
      'placeholder="Search towns and boards…" autocomplete="off" aria-label="Search towns and boards"></div>'+
    '<div class="followchips">';

  var chips=[], added={};
  allPlaces().forEach(function(t){
    if(fq && townLabel(t).toLowerCase().indexOf(fq)<0) return;
    var k=followKey(t,null);
    added[k]=1;
    chips.push({k:k,label:townLabel(t),on:!!FOLLOWS[k]});
  });
  if(fq){
    boardsIn(state.town).forEach(function(b){
      if(b.toLowerCase().indexOf(fq)<0 || chips.length>=28) return;
      var town = state.town!=="All" ? state.town : boardTown(b);
      if(!town) return;
      var k=followKey(town,b);
      if(added[k]) return;
      added[k]=1;
      chips.push({k:k,label:b+" · "+townLabel(town),on:!!FOLLOWS[k]});
    });
  }
  /* Whatever is already followed stays visible so it can be switched off. */
  Object.keys(FOLLOWS).forEach(function(k){
    if(added[k]) return;
    var p=k.split("␟");
    chips.push({k:k,label:p[1]?p[1]+" · "+townLabel(p[0]):townLabel(p[0]),on:true});
  });

  if(!chips.length) h+='<p class="followempty">Nothing matches that.</p>';
  chips.forEach(function(c){
    h+='<button class="fchip'+(c.on?" on":"")+'" data-action="follow" data-key="'+esc(c.k)+'" '+
       'aria-pressed="'+c.on+'" type="button">'+(c.on?'<span class="tick" aria-hidden="true">✓</span>':"")+
       esc(c.label)+'</button>';
  });
  h+='</div>';
  if(!fq) h+='<p class="followempty">Search above to follow an individual board, not just a whole town.</p>';
  return h+'</div>';
}
var BOARD_TOWN=null;
function boardTown(b){
  if(!BOARD_TOWN){
    BOARD_TOWN={};
    DATA.meetings.forEach(function(m){
      var key=m.board||m.title;
      if(key && !BOARD_TOWN[key]) BOARD_TOWN[key]=m.town;
    });
  }
  return BOARD_TOWN[b];
}

function renderBriefing(){
  $("#view").innerHTML='<div id="brief-feed"></div>'+
    '<div class="briefgrid">'+changesCard()+followCard()+'</div>';
  renderBriefingFeed();
  wireFollowSearch();
}
function wireFollowSearch(){
  var f=document.getElementById("followq");
  if(!f) return;
  f.addEventListener("input",function(){
    state.followQ=f.value;
    var host=document.querySelector(".briefgrid");
    if(!host) return;
    host.innerHTML=changesCard()+followCard();
    wireFollowSearch();
    var again=document.getElementById("followq");
    if(again){ again.focus(); again.setSelectionRange(again.value.length,again.value.length); }
  });
}
function renderBriefingFeed(){
  var host=document.getElementById("brief-feed");
  if(!host) return;
  var list=briefingList(), t=etToday();
  var title = state.mode==="starred" ? "Your starred meetings"
            : state.mode==="followed" ? "Meetings you follow"
            : "Meetings This Week";
  var range = state.mode==="week"
    ? fmtShort(t)+" – "+fmtShort(addDays(t,6))+", "+parseD(t).getFullYear()
    : "Everything upcoming";

  var h='<div class="secthead"><h2>'+esc(title)+'</h2><span class="range">'+esc(range)+'</span>'+
    '<span class="right"><span class="count">'+plural(list.length,"meeting")+'</span>'+
    '<button class="linkall" data-action="goto" data-view="calendar" type="button">View all →</button></span></div>';

  if(state.mode==="starred"){
    h += list.length ? syncPanel(list) :
      '<div class="syncbar"><div class="sb-top"><span class="sb-t">Nothing starred yet</span></div>'+
      '<p class="sb-s">Tap the ☆ on any meeting to save it here. Once you have a few, you can send the whole '+
      'set to Google Calendar or Apple Calendar in one go.</p>'+howtoBlurb()+'</div>';
  }
  if(state.mode==="followed" && !followCount()){
    h += '<p class="none">You are not following anything yet. Use the '+
         '&ldquo;Follow your town or board&rdquo; card below to pick a few.</p>';
  }

  if(list.length){
    h += dayGroupsHTML(groupByDay(list), {sync: state.mode==="starred"});
  }else if(state.mode!=="starred" && !(state.mode==="followed" && !followCount())){
    h += '<p class="none">'+(state.q.trim()
      ? "No meetings match “"+esc(state.q.trim())+"”."
      : state.mode==="week" ? "Nothing posted for the coming week."
      : "Nothing posted yet.")+'</p>';
  }
  host.innerHTML=h;
}

/* --------------------------------------------------- starred sync panel */
function syncPanel(list){
  return '<div class="syncbar">'+
    '<div class="sb-top"><span class="sb-t">'+plural(list.length,"starred meeting")+'</span>'+
    '<span class="sb-acts">'+
      '<button class="btn dark" data-action="ics-all" type="button">↓ Download .ics</button>'+
      (list.length===1?'<a class="btn ghost" href="'+esc(gcalURL(list[0]))+'" target="_blank" rel="noopener">Add to Google</a>':"")+
    '</span></div>'+
    '<p class="sb-s">One file with just your starred meetings — import it into Google Calendar, or open it '+
    'to drop them straight into Apple Calendar or Outlook. Single meetings have their own '+
    '&ldquo;Add to Google&rdquo; button below.</p>'+
    howtoBlurb()+'</div>';
}
function renderStarred(){
  var list=starredMeetings();
  var t=etToday();
  var past=list.filter(function(m){ return m.date<t; });
  var soon=list.filter(function(m){ return m.date>=t; });
  var h='<div class="viewhead"><h2>Your starred meetings</h2>'+
    '<p class="vsub">Stars live in this browser only — nothing is uploaded and no account is needed. '+
    'Clearing your browser data clears them.</p></div>';
  if(!list.length){
    h+='<div class="syncbar"><div class="sb-top"><span class="sb-t">Nothing starred yet</span></div>'+
      '<p class="sb-s">Tap the ☆ on any meeting — in the briefing, the calendar, or a town page — to save '+
      'it here. Then export the whole set to your calendar in one file.</p>'+howtoBlurb()+'</div>'+
      '<p class="none">Start with <button class="linkall" data-action="goto" data-view="briefing" type="button">this week’s briefing →</button></p>';
    $("#view").innerHTML=h;
    return;
  }
  h+=syncPanel(soon.length?soon:list);
  if(soon.length) h+=dayGroupsHTML(groupByDay(soon),{sync:true});
  else h+='<p class="none">All of your starred meetings have already happened.</p>';
  if(past.length){
    h+='<div class="secthead" style="margin-top:28px"><h2>Already happened</h2>'+
       '<span class="right"><span class="count">'+plural(past.length,"meeting")+'</span></span></div>';
    h+=dayGroupsHTML(groupByDay(past.slice().reverse()),{sync:false});
  }
  $("#view").innerHTML=h;
}

/* ============================================================
   B — POWER CALENDAR
   ============================================================ */
function pcFilter(m){
  var t=etToday(), q=state.q.trim().toLowerCase();
  if(state.town!=="All" && m.town!==state.town) return false;
  if(state.board!=="All" && (m.board||m.title)!==state.board) return false;
  if(state.format==="remote" && !isRemote(m)) return false;
  if(state.format==="in-person" && isRemote(m)) return false;
  if(q){
    var hay=(m.title+" "+(m.board||"")+" "+townLabel(m.town)+" "+(m.location||"")).toLowerCase();
    if(hay.indexOf(q)<0) return false;
  }
  if(state.dateFilter==="past") return m.date<t;
  if(state.dateFilter==="7")  return m.date>=t && m.date<addDays(t,7);
  if(state.dateFilter==="30") return m.date>=t && m.date<addDays(t,30);
  if(state.dateFilter==="month") return m.date.slice(0,7)===state.month;
  return true;   /* "day" mode filters by selDay at render time */
}
function pcSort(list){
  var s=state.sort;
  return list.sort(function(a,b){
    if(s==="town") return townLabel(a.town).localeCompare(townLabel(b.town)) || byDateTime(a,b);
    if(s==="board") return (a.board||a.title).localeCompare(b.board||b.title) || byDateTime(a,b);
    return byDateTime(a,b);
  });
}
function miniCal(matching){
  var ym=state.month.split("-"), y=+ym[0], mo=+ym[1];
  var startDay=new Date(y,mo-1,1).getDay();
  var dim=new Date(y,mo,0).getDate();
  var t=etToday();
  var counts={};
  matching.forEach(function(m){ counts[m.date]=(counts[m.date]||0)+1; });

  var h='<div class="pccal"><div class="pccal-head">'+
    '<h3>'+MONS_L[mo-1]+' '+y+'</h3>'+
    '<button class="navbtn" data-action="month-prev" aria-label="Previous month" type="button">‹</button>'+
    '<button class="navbtn" data-action="month-next" aria-label="Next month" type="button">›</button>'+
    '</div><div class="grid">';
  DOW.forEach(function(d){ h+='<div class="dow">'+d.slice(0,2)+'</div>'; });
  for(var i=0;i<startDay;i++) h+='<div class="cell blank"></div>';
  for(var d=1;d<=dim;d++){
    var iso=state.month+"-"+pad2(d);
    var n=counts[iso]||0;
    var dots="";
    for(var j=0;j<Math.min(n,3);j++) dots+='<span class="cdot"></span>';
    h+='<button class="cell'+(n>1?" multi":"")+(iso===t?" today":"")+(iso===state.selDay?" sel":"")+'" '+
       'data-action="sel-day" data-day="'+iso+'" type="button" '+
       'aria-label="'+esc(fmtLong(iso))+', '+plural(n,"meeting")+'"'+(iso===state.selDay?' aria-current="date"':"")+'>'+
       '<span>'+d+'</span><span class="cdots">'+dots+'</span></button>';
  }
  h+='</div><div class="callegend">'+
    '<span><i class="lg one"></i> One meeting</span>'+
    '<span><i class="lg many"></i> Several meetings</span>'+
    '<span><i class="lg sel"></i> Selected</span>'+
    '<span><i class="lg today"></i> Today</span>'+
    '</div></div>';
  return h;
}
function pcRow(m){
  var k=mkey(m), loc=cleanLoc(m.location,m.board);
  return '<button class="prow'+(state.sel===k?" sel":"")+'" data-action="open" data-key="'+esc(k)+'" type="button">'+
    '<span class="p-time">'+esc(m.all_day?"All day":(fmtTime(m.start)||"TBA"))+'</span>'+
    '<span class="p-main"><span class="p-town">'+esc(townLabel(m.town))+'</span>'+
      '<span class="p-board">'+esc(m.board||m.title)+'</span></span>'+
    '<span class="p-loc">'+esc(loc||"")+'</span>'+
    '<span class="mr-tags">'+statusTags(m)+'</span>'+
    '<span class="chev" aria-hidden="true">›</span>'+
    '</button>';
}
function pcDetail(){
  var m = state.sel && BY_KEY[state.sel];
  if(!m) return '<div class="pcdetail"><p class="none" style="margin:0">Pick a meeting above to see its details, '+
    'star it, or send it to your calendar.</p></div>';
  var loc=cleanLoc(m.location,m.board);
  var h='<div class="pcdetail fade"><div class="pd-top">'+
    '<h3 class="pd-title">'+esc(m.title)+'</h3>'+
    '<div class="pd-tags">'+statusTags(m)+starBtn(m)+'</div></div>'+
    '<p class="pd-when">'+esc(townLabel(m.town))+(m.board?' · '+esc(m.board):"")+'<br>'+
      '<span class="t">'+esc(fmtLong(m.date))+' · '+esc(fmtRange(m))+'</span></p>'+
    (loc?'<p class="pd-loc">'+esc(loc)+'</p>':"")+
    '<div class="pd-acts">';
  if(m.agenda_url)  h+='<a class="btn" href="'+esc(m.agenda_url)+'" target="_blank" rel="noopener">View agenda</a>';
  if(m.minutes_url) h+='<a class="btn ghost" href="'+esc(m.minutes_url)+'" target="_blank" rel="noopener">Minutes</a>';
  h+='<a class="btn ghost" href="'+esc(gcalURL(m))+'" target="_blank" rel="noopener">Add to Google Calendar</a>';
  h+='<button class="btn ghost" data-action="ics-one" data-key="'+esc(mkey(m))+'" type="button">Download .ics</button>';
  if(m.source_url) h+='<a class="btn ghost" href="'+esc(m.source_url)+'" target="_blank" rel="noopener">Official posting ↗</a>';
  h+='<button class="btn ghost" data-action="follow" data-key="'+esc(followKey(m.town,m.board))+'" type="button">'+
     (isFollowed(m.town,m.board)?"✓ Following board":"Follow board")+'</button>';
  return h+'</div></div>';
}
function renderCalendar(){
  var matching = DATA.meetings.filter(pcFilter);
  var listAll;
  var headTitle, headCount;
  if(state.dateFilter==="day"){
    listAll = pcSort(matching.filter(function(m){ return m.date===state.selDay; }));
    headTitle = fmtLong(state.selDay);
    headCount = plural(listAll.length,"meeting");
  }else{
    listAll = pcSort(matching.slice());
    if(state.dateFilter==="past") listAll.reverse();
    headTitle = {"7":"Next 7 days","30":"Next 30 days",
                 "month":MONS_L[+state.month.slice(5)-1]+" "+state.month.slice(0,4),
                 "past":"Past meetings"}[state.dateFilter];
    headCount = plural(listAll.length,"meeting");
  }
  var list = listAll.slice(0,state.pcLimit);

  var places=allPlaces();
  var townOpts='<option value="All">All towns</option>'+places.map(function(t){
    return '<option value="'+esc(t)+'"'+(state.town===t?" selected":"")+'>'+esc(townLabel(t))+'</option>';
  }).join("");
  var boardOpts='<option value="All">All boards</option>'+boardsIn(state.town).map(function(b){
    return '<option value="'+esc(b)+'"'+(state.board===b?" selected":"")+'>'+esc(b)+'</option>';
  }).join("");
  function dOpt(v,l){ return '<option value="'+v+'"'+(state.dateFilter===v?" selected":"")+'>'+l+'</option>'; }
  function fOpt(v,l){ return '<option value="'+v+'"'+(state.format===v?" selected":"")+'>'+l+'</option>'; }
  function sOpt(v,l){ return '<option value="'+v+'"'+(state.sort===v?" selected":"")+'>'+l+'</option>'; }

  var h='<div class="viewhead"><h2>Power calendar</h2>'+
    '<p class="vsub">Filter, search and scan every meeting we know about — built for reporters, '+
    'researchers and anyone tracking a particular board.</p></div>';

  h+='<div class="pcbar">'+
    '<div class="pcsearch">'+
      '<input id="pcq" type="search" value="'+esc(state.q)+'" placeholder="Search meetings, boards, or keywords…" '+
        'autocomplete="off" aria-label="Search all meetings">'+
      '<button class="btn ghost" data-action="save-search" type="button">⊕ Save search</button>'+
    '</div>'+
    '<div class="pcfilters">'+
      '<span class="fsel"><select id="pctown" aria-label="Town">'+townOpts+'</select></span>'+
      '<span class="fsel wide"><select id="pcboard" aria-label="Board">'+boardOpts+'</select></span>'+
      '<span class="fsel"><select id="pcdate" aria-label="Date range">'+
        dOpt("day","Selected day")+dOpt("7","Next 7 days")+dOpt("30","Next 30 days")+
        dOpt("month","This calendar month")+dOpt("past","Past meetings")+'</select></span>'+
      '<span class="fsel"><select id="pcformat" aria-label="Meeting format">'+
        fOpt("all","In-person &amp; remote")+fOpt("in-person","In-person only")+fOpt("remote","Remote only")+'</select></span>'+
      '<span class="fsel"><select id="pcsort" aria-label="Sort order">'+
        sOpt("time","Sort: time")+sOpt("town","Sort: town")+sOpt("board","Sort: board")+'</select></span>'+
      (activeFilterCount()?'<button class="fclear" data-action="clear-filters" type="button">Clear filters</button>':"")+
    '</div>';
  if(SAVED.length){
    h+='<div class="pcfilters" style="margin-top:9px">';
    SAVED.forEach(function(s,i){
      h+='<button class="fchip" data-action="load-search" data-i="'+i+'" type="button">'+esc(s.name)+
         ' <span data-action="del-search" data-i="'+i+'" role="button" tabindex="0" aria-label="Delete saved search" '+
         'style="color:var(--faint);font-weight:400">×</span></button>';
    });
    h+='</div>';
  }
  h+='</div>';

  h+='<div class="pclayout">'+miniCal(matching)+
    '<div><div class="pcagenda"><div class="pca-head"><h3>'+esc(headTitle)+'</h3>'+
      '<span class="n">'+headCount+'</span></div>';
  if(!list.length){
    h+='<p class="none" style="padding:22px 17px;margin:0">No meetings match these filters.</p>';
  }else{
    h+=list.map(pcRow).join("");
    if(listAll.length>list.length)
      h+='<button class="pcmore" data-action="pc-more" type="button">Show '+
         Math.min(60,listAll.length-list.length)+' more of '+listAll.length+'</button>';
  }
  h+='</div>'+pcDetail()+'</div></div>';

  $("#view").innerHTML=h;

  var pcq=$("#pcq");
  pcq.addEventListener("input",function(){ state.q=pcq.value; state.pcLimit=60; renderCalendar(); refocus("#pcq"); });
  bindSelect("#pctown","town",function(){ state.board="All"; });
  bindSelect("#pcboard","board");
  bindSelect("#pcdate","dateFilter");
  bindSelect("#pcformat","format");
  bindSelect("#pcsort","sort");
}
function bindSelect(sel,key,before){
  var el=$(sel);
  if(!el) return;
  el.addEventListener("change",function(){
    if(before) before();
    state[key]=el.value;
    state.pcLimit=60;
    renderCalendar();
  });
}
function refocus(sel){
  var el=$(sel);
  if(!el) return;
  el.focus();
  try{ el.setSelectionRange(el.value.length,el.value.length); }catch(e){}
}
function activeFilterCount(){
  var n=0;
  if(state.town!=="All") n++;
  if(state.board!=="All") n++;
  if(state.format!=="all") n++;
  if(state.dateFilter!=="day") n++;
  if(state.q.trim()) n++;
  return n;
}
function saveSearch(){
  var bits=[];
  if(state.q.trim()) bits.push('"'+state.q.trim()+'"');
  if(state.town!=="All") bits.push(townLabel(state.town));
  if(state.board!=="All") bits.push(state.board);
  if(state.format!=="all") bits.push(state.format==="remote"?"remote":"in-person");
  if(state.dateFilter!=="day") bits.push({"7":"next 7 days","30":"next 30 days",
                                          month:"this month",past:"past"}[state.dateFilter]);
  if(!bits.length) return;
  var name=bits.join(" · ");
  if(SAVED.some(function(s){ return s.name===name; })) return;
  SAVED.unshift({name:name, q:state.q, town:state.town, board:state.board,
                 format:state.format, dateFilter:state.dateFilter, sort:state.sort});
  SAVED=SAVED.slice(0,8);
  lsSet(SEARCH_KEY,SAVED);
  renderCalendar();
}

/* ============================================================
   C — TOWN DASHBOARD
   ============================================================ */
function townRail(){
  var h='<nav class="tdrail" aria-label="Towns">'+
    '<button class="railback" data-action="town-pick" data-town="All" type="button">← All towns</button>';
  townList().forEach(function(t){
    h+='<button class="railitem'+(state.town===t?" on":"")+'" data-action="town-pick" data-town="'+esc(t)+'" '+
       'type="button"'+(state.town===t?' aria-current="true"':"")+'>'+esc(t)+
       '<span class="rn">'+weekCount(t)+'</span></button>';
  });
  h+='<div class="railgroup">School districts</div>';
  districtList().forEach(function(t){
    h+='<button class="railitem'+(state.town===t?" on":"")+'" data-action="town-pick" data-town="'+esc(t)+'" '+
       'type="button"'+(state.town===t?' aria-current="true"':"")+'>'+esc(townLabel(t))+
       '<span class="rn">'+weekCount(t)+'</span></button>';
  });
  return h+'</nav>';
}
function townIndex(){
  var t=etToday();
  var h='<div class="viewhead"><h2>Towns &amp; districts</h2>'+
    '<p class="vsub">Pick a town for its boards, agendas, minutes and next meetings. '+
    'Counts cover the next seven days.</p></div><div class="towngrid">';
  allPlaces().forEach(function(x,i){
    var up=upcoming(x), s=DATA.sources&&DATA.sources[x];
    var dot='<span class="sdot '+(s?(s.ok?"ok":"bad"):"")+'"></span>';
    h+='<button class="towncard rise" style="--i:'+Math.min(i,12)+'" data-action="town-pick" '+
      'data-town="'+esc(x)+'" type="button">'+
      '<div class="tc-top">'+dot+'<span class="tc-name">'+esc(townLabel(x))+'</span></div>'+
      '<div class="tc-n">'+weekCount(x)+' in the next 7 days · '+up.length+' upcoming</div>'+
      (up.length
        ? '<div class="tc-next">Next: <b>'+esc(up[0].board||up[0].title)+'</b><br>'+
          esc(fmtShort(up[0].date))+(up[0].start?' · '+esc(fmtTime(up[0].start)):"")+'</div>'
        : '<div class="tc-next">No upcoming meetings posted.</div>')+
      '</button>';
  });
  return h+'</div>';
}
function townDash(){
  var town=state.town, up=upcoming(town), t=etToday();
  var followed=isFollowed(town,null);
  var next=up[0];
  var h='<div class="tdhero"><div class="tdhero-img" aria-hidden="true"></div>'+
    '<div class="tdhero-veil" aria-hidden="true"></div><div class="tdhero-in">'+
    '<div><h2>'+esc(townLabel(town))+'</h2>'+
    '<p>Boards, meetings, agendas and minutes — everything we have for '+esc(townLabel(town))+'.</p></div>'+
    '<button class="followbtn'+(followed?" on":"")+'" data-action="follow" data-key="'+esc(followKey(town,null))+'" '+
      'aria-pressed="'+followed+'" type="button">'+(followed?"✓ Following":"+ Follow town")+'</button>'+
    '</div></div>';

  h+='<div class="tdtabs" role="tablist">';
  [["overview","Overview"],["boards","Boards"],["calendar","Calendar"],["minutes","Recent minutes"]]
    .forEach(function(p){
      h+='<button class="tdtab'+(state.tab===p[0]?" on":"")+'" data-action="tab" data-tab="'+p[0]+'" '+
         'role="tab" aria-selected="'+(state.tab===p[0])+'" type="button">'+p[1]+'</button>';
    });
  h+='</div>';

  if(state.tab==="overview"){
    h+='<div class="statgrid">'+
      '<div class="stat"><span class="sl">Next meeting</span>'+
        (next
          ? '<span class="sname">'+esc(next.board||next.title)+'</span>'+
            '<span class="swhen">'+esc(fmtDay(next.date))+(next.start?' · '+esc(fmtTime(next.start)):"")+'</span>'+
            '<span class="sloc">'+esc(cleanLoc(next.location,next.board)||"Location not posted")+'</span>'+
            '<span class="sfoot">'+(next.agenda_url
              ? '<a class="btn ghost sm" href="'+esc(next.agenda_url)+'" target="_blank" rel="noopener">View agenda</a>'
              : '<button class="btn ghost sm" data-action="star" data-key="'+esc(mkey(next))+'" type="button">'+
                (isStarred(next)?"★ Starred":"☆ Star it")+'</button>')+'</span>'
          : '<span class="sname">Nothing posted</span><span class="sloc">No upcoming meetings in the feed.</span>')+
      '</div>'+
      '<div class="stat"><span class="sl">Upcoming this week</span>'+
        '<span class="sbig">'+weekCount(town)+'</span><span class="sloc">public meetings</span>'+
        '<span class="sfoot"><button class="btn ghost sm" data-action="tab" data-tab="calendar" type="button">View calendar</button></span>'+
      '</div>'+
      '<div class="stat"><span class="sl">Recent changes</span>'+
        '<span class="sbig">'+recentChangeCount(town)+'</span><span class="sloc">updates in the last 3 days</span>'+
        '<span class="sfoot"><button class="btn ghost sm" data-action="goto" data-view="briefing" type="button">See what changed</button></span>'+
      '</div></div>';

    h+='<div class="tdcols">'+boardsCard(town,5)+minutesCard(town,5)+'</div>';
  }
  else if(state.tab==="boards"){ h+='<div class="card">'+boardsCardBody(town,999)+'</div>'; }
  else if(state.tab==="calendar"){
    h+='<div class="secthead"><h2>Upcoming in '+esc(townLabel(town))+'</h2>'+
       '<span class="right"><span class="count">'+plural(up.length,"meeting")+'</span></span></div>';
    h+= up.length ? dayGroupsHTML(groupByDay(up.slice(0,60)),{})
                  : '<p class="none">No upcoming meetings posted for '+esc(townLabel(town))+'.</p>';
  }
  else if(state.tab==="minutes"){
    var mins=DATA.meetings.filter(function(m){ return m.town===town && m.minutes_url && m.date<t; })
      .sort(function(a,b){ return b.date.localeCompare(a.date); });
    h+='<div class="secthead"><h2>Recent minutes</h2>'+
       '<span class="right"><span class="count">'+plural(mins.length,"posting")+'</span>'+
       '<button class="linkall" data-action="goto" data-view="archive" type="button">Search the archive →</button></span></div>';
    h+= mins.length ? '<div class="card">'+mins.slice(0,80).map(minRow).join("")+'</div>'
                    : '<p class="none">No minutes posted for '+esc(townLabel(town))+' yet.</p>';
  }
  return h;
}
function boardsCardBody(town,limit){
  var boards={}, t=etToday();
  DATA.meetings.forEach(function(m){
    if(m.town!==town) return;
    var b=m.board||m.title;
    if(!boards[b]) boards[b]={n:0,next:null};
    if(m.date>=t){
      boards[b].n++;
      if(!boards[b].next || byDateTime(m,boards[b].next)<0) boards[b].next=m;
    }
  });
  var names=Object.keys(boards).sort(function(a,b){
    return boards[b].n-boards[a].n || a.localeCompare(b);
  }).slice(0,limit);
  var h='<div class="cardhead"><h3>Boards in '+esc(townLabel(town))+'</h3>'+
    (limit<999?'<button class="linkall" data-action="tab" data-tab="boards" type="button">View all →</button>':"")+
    '</div><p class="cardsub">'+plural(Object.keys(boards).length,"board")+' with meetings on record</p>';
  if(!names.length) return h+'<p class="none">No boards on record yet.</p>';
  names.forEach(function(b){
    var info=boards[b];
    var on=isFollowed(town,b);
    h+='<div class="listrow"><span class="lr-main"><span class="lr-name">'+esc(b)+'</span>'+
      '<span class="lr-sub">'+(info.n?plural(info.n,"upcoming meeting"):"Nothing upcoming")+
      (info.next?' · next '+esc(fmtShort(info.next.date)):"")+'</span></span>'+
      '<button class="fchip'+(on?" on":"")+'" data-action="follow" data-key="'+esc(followKey(town,b))+'" '+
      'aria-pressed="'+on+'" type="button">'+(on?"✓ Following":"Follow")+'</button></div>';
  });
  return h;
}
function boardsCard(town,limit){ return '<div class="card">'+boardsCardBody(town,limit)+'</div>'; }
function minRow(m){
  return '<a class="listrow" href="'+esc(m.minutes_url)+'" target="_blank" rel="noopener">'+
    '<span class="lr-main"><span class="lr-name">'+esc(m.board||m.title)+'</span>'+
    '<span class="lr-sub">'+esc(fmtDay(m.date))+', '+parseD(m.date).getFullYear()+'</span></span>'+
    '<span class="lr-doc">OPEN ↗</span></a>';
}
function minutesCard(town,limit){
  var t=etToday();
  var mins=DATA.meetings.filter(function(m){ return m.town===town && m.minutes_url && m.date<t; })
    .sort(function(a,b){ return b.date.localeCompare(a.date); });
  var h='<div class="card"><div class="cardhead"><h3>Recent minutes</h3>'+
    '<button class="linkall" data-action="tab" data-tab="minutes" type="button">View all →</button></div>'+
    '<p class="cardsub">'+plural(mins.length,"posting")+' on record</p>';
  if(!mins.length) return h+'<p class="none">No minutes posted yet.</p></div>';
  return h+mins.slice(0,limit).map(minRow).join("")+'</div>';
}
function renderTowns(){
  var body = state.town==="All" ? townIndex() : townDash();
  $("#view").innerHTML='<div class="tdlayout">'+townRail()+'<div class="tdmain">'+body+'</div></div>';
}

/* ============================================================
   NEWS — town announcements, newest first
   Loaded lazily from data/news.json the first time the tab opens.
   ============================================================ */
var NEWS = null, NEWS_LOADING = false, NEWS_FAILED = false;

/* Timestamp of the reader's previous visit to this tab. Read once at load so
   the "New" markers hold still while they read, and only advanced on the way
   out — otherwise everything stops being new the moment you arrive. */
var NEWS_SEEN_KEY = "bm-news-seen-v1";
var NEWS_SEEN_AT = lsGet(NEWS_SEEN_KEY, null);

function ensureNews(cb){
  if(NEWS!==null){ if(cb) cb(); return; }
  if(NEWS_LOADING) return;
  NEWS_LOADING = true;
  fetch("data/news.json?ts="+Date.now(),{cache:"no-store"})
    .then(function(r){ if(!r.ok) throw 0; return r.json(); })
    .then(function(j){
      NEWS = j || {items:[],sources:[]};
      NEWS_LOADING = false;
      if(cb) cb();
    })
    .catch(function(){
      NEWS = {items:[],sources:[]};
      NEWS_FAILED = true;
      NEWS_LOADING = false;
      if(cb) cb();
    });
}
/* Called when the reader leaves the tab, so the next visit can mark what
   arrived in between. */
function markNewsSeen(){
  lsSet(NEWS_SEEN_KEY, new Date().toISOString());
}
function newsIsNew(it){
  if(!NEWS_SEEN_AT) return false;   /* first visit: nothing is "new" yet */
  /* Compare instants, not strings: the stored stamp is UTC ("…Z") while
     first_seen carries the scraper's Eastern offset, so the two sort
     differently as text than they do in time. */
  var seen = Date.parse(NEWS_SEEN_AT), at = Date.parse(it.first_seen||"");
  if(isNaN(seen) || isNaN(at)) return false;
  return at > seen;
}
function newsUnseenCount(){
  if(!NEWS || !NEWS.items) return 0;
  return NEWS.items.filter(newsIsNew).length;
}

/* "2h ago". Date-only postings say Today/Yesterday rather than invent an hour. */
function relTime(it){
  var iso = it.posted || it.first_seen;
  if(!iso) return "";
  var then = new Date(iso);
  if(isNaN(then)) return "";
  var mins = Math.round((Date.now()-then.getTime())/60000);
  var day = iso.slice(0,10), t = etToday();
  if(it.date_only){
    if(day===t) return "Today";
    if(day===addDays(t,-1)) return "Yesterday";
  }else{
    if(mins < 2)   return "just now";
    if(mins < 60)  return mins+"m ago";
    if(mins < 1440) return Math.round(mins/60)+"h ago";
  }
  var days = Math.round((parseD(t)-parseD(day))/86400000);
  if(days <= 0) return "Today";
  if(days === 1) return "Yesterday";
  if(days < 7)  return days+"d ago";
  if(days < 35) return Math.round(days/7)+"w ago";
  return fmtShort(day);
}
function newsTownLabel(t){ return DISTRICT_NAMES[t] || t; }

function newsTowns(){
  var seen={}, list=[];
  (NEWS && NEWS.items || []).forEach(function(it){
    if(it.town && !seen[it.town]){ seen[it.town]=1; list.push(it.town); }
  });
  /* Keep the site's canonical town order; anything unexpected goes last. */
  var ordered = TOWN_ORDER.concat(DISTRICTS).filter(function(t){ return seen[t]; });
  list.forEach(function(t){ if(ordered.indexOf(t)<0) ordered.push(t); });
  return ordered;
}
var NEWS_CATS = ["Road closures","Meeting notices","Public notices","General"];

function newsList(){
  var q = state.newsQ.trim().toLowerCase();
  return (NEWS && NEWS.items || []).filter(function(it){
    if(state.newsTown!=="All" && it.town!==state.newsTown) return false;
    if(state.newsCat!=="All" && it.category!==state.newsCat) return false;
    if(q){
      var hay = (it.headline+" "+(it.summary||"")+" "+(it.topic||"")+" "+
                 newsTownLabel(it.town)).toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  });
}

function newsCard(it,i){
  var fresh = newsIsNew(it);
  var cat = NEWS_CATS.indexOf(it.category)>=0 ? it.category : "General";
  var slug = cat.toLowerCase().replace(/[^a-z]+/g,"-");
  var town = newsTownLabel(it.town);
  var on = state.newsTown===it.town;
  return '<article class="ncard rise'+(fresh?" fresh":"")+'" style="--i:'+Math.min(i,14)+'">'+
    '<div class="nc-top">'+
      /* The pill is the filter: tap a town on any card to narrow the feed to
         it, tap it again to come back to everything. */
      '<button class="npill" data-action="news-town" data-town="'+esc(it.town)+'" '+
        'aria-pressed="'+on+'" type="button" title="'+
        (on?"Show every town again":"Show only "+esc(town))+'">'+esc(town)+'</button>'+
      '<span class="tag ncat '+slug+'">'+esc(cat)+'</span>'+
      (it.topic?'<span class="tag ntopic">'+esc(it.topic)+'</span>':"")+
      (fresh?'<span class="tag new">New</span>':"")+
      '<span class="nc-when">'+esc(relTime(it))+'</span>'+
    '</div>'+
    '<h3 class="nc-head"><a href="'+esc(it.url)+'" target="_blank" rel="noopener">'+
      esc(it.headline)+'</a></h3>'+
    (it.summary?'<p class="nc-sum">'+esc(it.summary)+'</p>':"")+
    '<div class="nc-foot">'+
      '<a class="btn ghost sm" href="'+esc(it.url)+'" target="_blank" rel="noopener">'+
      'Read full post ↗</a></div>'+
  '</article>';
}

function newsSourcesSection(){
  var srcs = (NEWS && NEWS.sources) || [];
  if(!srcs.length) return "";
  var h='<section class="nsources"><div class="cardhead"><h3>Where this comes from</h3></div>'+
    '<p class="cardsub">Every item above is scraped from one of these pages, hourly. '+
    'Nothing is rewritten — headlines and summaries are the towns&rsquo; own words, and every '+
    'card links back to the original posting.</p><div class="nsrclist">';
  srcs.forEach(function(s){
    /* A town that scrapes cleanly but posts rarely is not a broken source, and
       saying so beats a bare "0 items". */
    var cls = s.ok ? (s.items ? "ok" : "quiet") : (s.items ? "stale" : "bad");
    var note = s.ok
             ? (s.items ? plural(s.items,"item")+" on file"
                        : "Nothing posted in the last 90 days")
             : s.items ? plural(s.items,"item")+" on file · last check failed"
                       : "No items yet · "+(s.error ? "last check failed" : "nothing posted");
    h+='<div class="nsrc">'+
       '<span class="sdot '+cls+'"></span>'+
       '<span class="nsrc-main">'+
         '<a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.name)+'</a>'+
         '<span class="nsrc-url">'+esc(s.url)+'</span>'+
       '</span>'+
       '<span class="nsrc-n">'+esc(note)+'</span>'+
       '</div>';
  });
  return h+'</div></section>';
}

function renderNews(){
  if(NEWS===null){
    $("#view").innerHTML='<p class="loading">Gathering town announcements…</p>';
    ensureNews(function(){ if(state.view==="news") renderNews(); });
    return;
  }
  var all = (NEWS.items||[]);
  var list = newsList();
  var updated = NEWS.updated
    ? "Refreshed "+new Date(NEWS.updated).toLocaleString("en-US",
        {timeZone:ET,month:"long",day:"numeric",hour:"numeric",minute:"2-digit"})+" ET"
    : "";
  var unseen = newsUnseenCount();

  var h='<section class="newshero">'+
    '<p class="kicker">South County &middot; Massachusetts</p>'+
    '<h2>Town news, all of it</h2>'+
    '<p class="nsub">Road closures, special meeting notices, public notices and transfer '+
      'station hours &mdash; gathered from every town website we cover, newest first, so you '+
      'never have to visit ten of them.'+
      (updated?'<span class="upd">'+esc(updated)+
        (unseen?' · '+plural(unseen,"new item")+' since your last visit':"")+'</span>':"")+
    '</p></section>';

  h+='<div class="newsbar">'+
    '<div class="nsearch">'+
      '<input id="newsq" type="search" value="'+esc(state.newsQ)+'" '+
        'placeholder="Search announcements…" autocomplete="off" '+
        'aria-label="Search town announcements">'+
    '</div>'+
    '<div class="npills" role="group" aria-label="Filter by town">'+
      '<button class="fchip'+(state.newsTown==="All"?" on":"")+'" data-action="news-town" '+
        'data-town="All" aria-pressed="'+(state.newsTown==="All")+'" type="button">All towns</button>';
  newsTowns().forEach(function(t){
    var on = state.newsTown===t;
    h+='<button class="fchip'+(on?" on":"")+'" data-action="news-town" data-town="'+esc(t)+'" '+
       'aria-pressed="'+on+'" type="button">'+esc(newsTownLabel(t))+'</button>';
  });
  h+='</div>'+
    '<div class="npills cats" role="group" aria-label="Filter by category">'+
      '<button class="fchip'+(state.newsCat==="All"?" on":"")+'" data-action="news-cat" '+
        'data-cat="All" aria-pressed="'+(state.newsCat==="All")+'" type="button">All categories</button>';
  NEWS_CATS.forEach(function(c){
    var on = state.newsCat===c;
    var n = all.filter(function(it){ return it.category===c; }).length;
    if(!n && !on) return;
    h+='<button class="fchip'+(on?" on":"")+'" data-action="news-cat" data-cat="'+esc(c)+'" '+
       'aria-pressed="'+on+'" type="button">'+esc(c)+' <span class="n">'+n+'</span></button>';
  });
  h+='</div></div>';

  /* The feed is every town by default; the heading says so, and says what
     you're looking at instead once you've narrowed it. */
  h+='<div class="secthead"><h2>'+
       (state.newsTown==="All" ? "Everything, newest first"
                               : esc(newsTownLabel(state.newsTown)))+'</h2>'+
     (state.newsCat!=="All"?'<span class="range">'+esc(state.newsCat)+'</span>':"")+
     '<span class="right"><span class="count" id="newscount">'+
       plural(list.length,"announcement")+'</span>'+
     '<button class="linkall" id="newsclear" data-action="news-clear" type="button"'+
       (newsFiltered()?"":" hidden")+'>Show all towns</button>'+
     '</span></div>';

  h+='<div id="newsfeed">'+newsFeedHTML(list)+'</div>';
  h+=newsSourcesSection();

  $("#view").innerHTML=h;
  var box=$("#newsq");
  if(box){
    /* Search repaints only the feed and its counter — re-rendering the whole
       view would tear the input out from under the reader's cursor. */
    box.addEventListener("input",function(){
      state.newsQ=box.value;
      var hits=newsList();
      var feed=document.getElementById("newsfeed");
      if(feed) feed.innerHTML=newsFeedHTML(hits);
      var c=document.getElementById("newscount");
      if(c) c.textContent=plural(hits.length,"announcement");
      var clear=document.getElementById("newsclear");
      if(clear) clear.hidden=!newsFiltered();
    });
  }
}
function newsFiltered(){
  return !!(state.newsQ.trim() || state.newsTown!=="All" || state.newsCat!=="All");
}
function newsFeedHTML(list){
  if(!list.length){
    if(NEWS_FAILED){
      return '<p class="none">Couldn&rsquo;t load the news feed &mdash; the first scrape is '+
             'probably still running. Check back shortly.</p>';
    }
    if(!(NEWS.items||[]).length){
      return '<p class="none">No announcements on file yet. The scraper runs hourly from '+
             '6:00 AM to midnight Eastern.</p>';
    }
    return '<p class="none">Nothing matches those filters.</p>';
  }
  return '<div class="newsfeed">'+list.map(newsCard).join("")+'</div>';
}

/* ============================================================
   Archive + sources
   ============================================================ */
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
    if(m.date>=t) return;
    if(state.town!=="All" && m.town!==state.town) return;
    if(state.minOnly && !m.minutes_url) return;
    var inDoc=false;
    if(q){
      var hay=(m.title+" "+(m.board||"")+" "+townLabel(m.town)).toLowerCase();
      if(hay.indexOf(q)<0){
        var txt=ATEXT?(ATEXT[mkey(m)]||""):"";
        inDoc = !!txt && txt.toLowerCase().indexOf(q)>=0;
        if(!inDoc) return;
      }
    }
    out.push({m:m,inDoc:inDoc});
  });
  return out.sort(function(a,b){
    return b.m.date.localeCompare(a.m.date) || (b.m.start||"").localeCompare(a.m.start||"");
  });
}
function renderArchive(){
  var t=etToday();
  var past=DATA.meetings.filter(function(m){
    return m.date<t && (state.town==="All"||m.town===state.town);
  });
  var withMin=past.filter(function(m){ return m.minutes_url; }).length;
  $("#view").innerHTML='<div class="viewhead"><h2>Minutes archive</h2>'+
    '<p class="vsub">Search past meetings, boards, and the full text of posted agendas and minutes.</p></div>'+
    '<div class="archivebar">'+
      '<input id="aq" type="search" value="'+esc(state.archiveQ)+'" '+
        'placeholder="Search past meetings, boards, agendas, minutes…" '+
        'aria-label="Search the minutes archive" autocomplete="off">'+
      '<label class="minonly"><input type="checkbox" id="amin"'+(state.minOnly?" checked":"")+'> Minutes only</label>'+
    '</div>'+
    '<p class="archcount">'+plural(past.length,"past meeting")+
      (withMin?' · '+withMin+' with minutes posted':"")+'</p>'+
    '<div id="archresults"></div>';
  renderArchiveResults();
  ensureAtext(function(){ if(state.view==="archive") renderArchiveResults(); });
  $("#aq").addEventListener("input",function(e){ state.archiveQ=e.target.value; renderArchiveResults(); });
  $("#amin").addEventListener("change",function(e){ state.minOnly=e.target.checked; renderArchiveResults(); });
}
function renderArchiveResults(){
  var box=document.getElementById("archresults");
  if(!box) return;
  var rows=archiveMatches();
  if(!rows.length){ box.innerHTML='<p class="none">No past meetings match.</p>'; return; }
  box.innerHTML=rows.slice(0,150).map(function(r,i){
    var html=meetingRow(r.m,i,{});
    if(r.inDoc) html=html.replace('<div class="mr-tags">',
      '<div class="mr-tags"><span class="hit">match in document text</span>');
    return html;
  }).join("") + (rows.length>150
    ? '<p class="archcount">Showing the 150 most recent of '+rows.length+' matches. Narrow the search to see more.</p>'
    : "");
}
function renderSources(){
  var src=DATA.sources;
  var upd=DATA.updated?new Date(DATA.updated).toLocaleString("en-US",
    {timeZone:ET,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" ET":"not yet";
  var h='<div class="viewhead"><h2>Source health</h2>'+
    '<p class="vsub">Every town calendar is scraped daily at 6:02 AM ET. If a source fails, its meetings may be '+
    'missing — this page says so plainly instead of pretending nothing was posted.</p>'+
    '<p class="vsub srcfresh"><span>Data updated '+esc(upd)+'</span>'+
    '<button class="btn ghost sm" id="refreshdata" type="button">Refresh data</button>'+
    '<a class="rerun" href="https://github.com/tylerherman19/berkshire-meetings/actions/workflows/update.yml" target="_blank" rel="noopener">Re-run the scraper</a></p></div>';
  if(!src){
    h+='<p class="none">Source health arrives with the next scheduled scrape.</p>';
  }else{
    h+='<div class="srcgrid">';
    allPlaces().forEach(function(tn,i){
      var s=src[tn], dot, status, detail;
      if(!s){ dot=""; status="Not scraped"; detail="No automated source yet — coverage is manual."; }
      else if(s.ok){ dot="ok"; status="OK"; detail=plural(s.meetings,"meeting")+" in the feed"; }
      else { dot="bad"; status="Scrape failed"; detail=s.error||"The source could not be reached."; }
      h+='<div class="srccard rise" style="--i:'+Math.min(i,12)+'">'+
        '<div class="srcname"><span class="sdot '+dot+'"></span>'+esc(townLabel(tn))+'</div>'+
        '<div class="srcstatus">'+esc(status)+
          (s&&s.checked_at ? ' · checked '+esc(new Date(s.checked_at).toLocaleString("en-US",
            {timeZone:ET,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))+" ET" : "")+'</div>'+
        '<div class="srcdetail">'+esc(detail)+'</div>'+
        (s&&s.note?'<div class="srcdetail">'+esc(s.note)+'</div>':"")+'</div>';
    });
    h+='</div>';
  }
  $("#view").innerHTML=h;
  var rb=document.getElementById("refreshdata");
  if(rb) rb.addEventListener("click",function(){ loadData(); });
}

/* ============================================================
   View switching + events
   ============================================================ */
function setView(v){
  /* Leaving the news tab is what banks "you have seen up to here" — doing it
     on arrival would clear the New markers before they could be read. */
  if(state.view==="news" && v!=="news") markNewsSeen();
  state.view=v;
  if(v==="calendar") state.pcLimit=60;
  renderHero();
  renderView();
  window.scrollTo({top:0,behavior:"auto"});
}
function renderView(){
  var v=$("#view");
  v.classList.remove("fade"); void v.offsetWidth; v.classList.add("fade");
  if(state.view==="briefing")      renderBriefing();
  else if(state.view==="news")     renderNews();
  else if(state.view==="calendar") renderCalendar();
  else if(state.view==="towns")    renderTowns();
  else if(state.view==="starred")  renderStarred();
  else if(state.view==="archive")  renderArchive();
  else if(state.view==="sources")  renderSources();
  else if(state.view==="blotter")  { if(window.BMBlotter) BMBlotter.render(); }
  Array.prototype.forEach.call(document.querySelectorAll("#views button"),function(b){
    var on = b.dataset.view===state.view;
    b.classList.toggle("active",on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  paintStars();
}

document.addEventListener("click",function(e){
  var el=e.target.closest("[data-action]");
  if(!el) return;
  var a=el.dataset.action;

  if(a==="star"){ toggleStar(el.dataset.key); return; }
  if(a==="follow"){ toggleFollow(el.dataset.key); return; }
  if(a==="ics-one"){
    var m=BY_KEY[el.dataset.key];
    if(m) downloadICS([m],"berkshire-meeting.ics");
    return;
  }
  if(a==="ics-all"){
    var t=etToday();
    var list=starredMeetings();
    var soon=list.filter(function(x){ return x.date>=t; });
    downloadICS(soon.length?soon:list,"berkshire-meetings-starred.ics");
    return;
  }
  if(a==="open"){
    state.sel=el.dataset.key;
    var mm=BY_KEY[state.sel];
    if(state.view!=="calendar"){
      if(mm){ state.selDay=mm.date; state.month=mm.date.slice(0,7); state.dateFilter="day"; }
      setView("calendar");
    }else{
      renderCalendar();
      var d=document.querySelector(".pcdetail");
      if(d) d.scrollIntoView({block:"nearest"});
    }
    return;
  }
  if(a==="news-town" || a==="news-cat"){
    var key = a==="news-town" ? "newsTown" : "newsCat";
    var val = a==="news-town" ? el.dataset.town : el.dataset.cat;
    /* Pressing the active filter again clears it, so a card's town pill is a
       way back to the whole feed as well as a way into one town. */
    state[key] = (state[key]===val && val!=="All") ? "All" : val;
    renderNews();
    /* The list under the reader just changed length; start them at the top of
       it rather than wherever the old list had them scrolled to. */
    window.scrollTo({top:0,behavior:"auto"});
    return;
  }
  if(a==="news-clear"){
    state.newsTown="All"; state.newsCat="All"; state.newsQ="";
    renderNews();
    return;
  }
  if(a==="mode"){ state.mode=el.dataset.mode; renderHero(); renderView(); return; }
  if(a==="goto"){ setView(el.dataset.view); return; }
  if(a==="tosearch"){ setView("calendar"); return; }
  if(a==="more-changes"){ state.showAllChanges=true; renderView(); return; }
  if(a==="town-pick"){ state.town=el.dataset.town; state.tab="overview"; setView("towns"); return; }
  if(a==="tab"){ state.tab=el.dataset.tab; renderTowns(); paintStars(); return; }
  if(a==="sel-day"){
    state.selDay=el.dataset.day;
    state.dateFilter="day";
    state.pcLimit=60;
    renderCalendar();
    return;
  }
  if(a==="month-prev"||a==="month-next"){
    var y=+state.month.slice(0,4), mo=+state.month.slice(5);
    var d0=new Date(y, mo-1+(a==="month-next"?1:-1), 1);
    state.month=d0.getFullYear()+"-"+pad2(d0.getMonth()+1);
    renderCalendar();
    return;
  }
  if(a==="pc-more"){ state.pcLimit+=60; renderCalendar(); return; }
  if(a==="clear-filters"){
    state.town="All"; state.board="All"; state.format="all";
    state.dateFilter="day"; state.q=""; state.pcLimit=60;
    renderCalendar();
    return;
  }
  if(a==="save-search"){ saveSearch(); return; }
  if(a==="load-search"){
    var s=SAVED[+el.dataset.i];
    if(s){
      state.q=s.q; state.town=s.town; state.board=s.board;
      state.format=s.format; state.dateFilter=s.dateFilter; state.sort=s.sort||"time";
      state.pcLimit=60;
      renderCalendar();
    }
    return;
  }
  if(a==="del-search"){
    e.stopPropagation();
    SAVED.splice(+el.dataset.i,1);
    lsSet(SEARCH_KEY,SAVED);
    renderCalendar();
    return;
  }
});

document.addEventListener("DOMContentLoaded",function(){
  Array.prototype.forEach.call(document.querySelectorAll("#views button"),function(b){
    b.addEventListener("click",function(){ setView(b.dataset.view); });
  });
  $("#brand").addEventListener("click",function(){
    state.town="All"; state.q=""; state.mode="week"; setView("briefing");
  });
  $("#starjump").addEventListener("click",function(){ setView("starred"); });
  /* Closing the tab from the news view counts as having read it, same as
     navigating away would. */
  window.addEventListener("pagehide",function(){
    if(state.view==="news") markNewsSeen();
  });
  loadData();
});

/* ============================================================ data load */
function loadData(){
  $("#view").innerHTML='<p class="loading">Gathering the week’s meetings…</p>';
  var ts="?ts="+Date.now();
  Promise.all([
    fetch("data/meetings.json"+ts,{cache:"no-store"}).then(function(r){ if(!r.ok) throw 0; return r.json(); }),
    fetch("data/changes.json"+ts,{cache:"no-store"})
      .then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
  ]).then(function(res){
    DATA=res[0];
    CHANGES=res[1]||{updated:null,changes:[]};
    BY_KEY={}; BOARD_TOWN=null;
    DATA.meetings.forEach(function(m){ BY_KEY[mkey(m)]=m; });
    indexChanges();
    renderHero();
    renderView();
  }).catch(function(){
    $("#herohost").innerHTML="";
    $("#view").innerHTML='<p class="none" style="margin-top:30px">Couldn’t load the calendar just yet '+
      '— the first scrape is probably still running. Check back in a few minutes.</p>';
  });
}
})();
