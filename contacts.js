/* Berkshire Meetings — Contacts
   Every board in every South County town: members, chairs, and how to reach them. */
(function(){
"use strict";

var state={data:null,town:"Great Barrington",board:""};

function esc(v){return String(v==null?"":v).replace(/[&<>\"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function mailto(e){return '<a href="mailto:'+esc(e)+'">'+esc(e)+'</a>';}
function tel(p){var d=String(p).replace(/[^\dx]/g,"");return '<a href="tel:'+esc(d)+'">'+esc(p)+'</a>';}
function byTown(name){return state.data.towns.filter(function(t){return t.name===name;})[0]||null;}

function stat(value,label,note){return '<div class="c-stat"><strong>'+value+'</strong><span>'+label+'</span><small>'+note+'</small></div>';}

function official(o){
  if(!o)return '';
  var bits=[];
  if(o.name)bits.push('<strong>'+esc(o.name)+'</strong>');
  else bits.push('<strong>'+esc(o.title)+'</strong>');
  var lines=[];
  if(o.name&&o.title)lines.push(esc(o.title));
  if(o.email)lines.push(mailto(o.email));
  if(o.phone)lines.push(tel(o.phone));
  return '<div class="c-official"><h3>'+esc(o.title)+'</h3>'+bits.join('')+
    (lines.length?'<div class="c-line">'+lines.join(' &middot; ')+'</div>':'')+
    (o.url?'<div class="c-line"><a href="'+esc(o.url)+'" target="_blank" rel="noopener">Official page &rarr;</a></div>':'')+'</div>';
}

function boardCard(b){
  var contact=[];
  (b.emails||[]).forEach(function(e){contact.push(mailto(e));});
  (b.phones||[]).forEach(function(p){var label=b.phone_labels&&b.phone_labels[p];contact.push(tel(p)+(label?' <span class="c-phone-label">('+esc(label)+')</span>':''));});
  var members='';
  if(b.members&&b.members.length){
    members='<div class="c-members">'+b.members.map(function(m){
      return '<div class="c-member"><b>'+esc(m.name)+'</b>'+(m.role?'<span>'+esc(m.role)+'</span>':'')+'</div>';
    }).join('')+'</div>';
  }
  var note=b.note?'<p class="c-note">'+esc(b.note)+'</p>':'';
  return '<section class="c-board" id="'+esc(b.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase())+'">'
    +'<div class="c-board-head"><h2>'+esc(b.name)+'</h2>'
    +(b.members&&b.members.length?'<span class="c-count">'+b.members.length+' listed</span>':'')
    +'</div>'
    +(contact.length?'<p class="c-board-contact">'+contact.join(' &middot; ')+'</p>':'')
    +members
    +'<p class="c-source">Source: <a href="'+esc(b.url)+'" target="_blank" rel="noopener">'+esc(b.url.replace(/^https?:\/\//,""))+'</a></p>'
    +'</section>';
}

function render(){
  var host=document.getElementById("view");
  if(!state.data){host.innerHTML='<div class="c-loading">Loading the board directory&hellip;</div>';load();return;}
  var towns=state.data.towns;
  if(!byTown(state.town))state.town=towns[0].name;
  var t=byTown(state.town);
  var totalBoards=towns.reduce(function(n,x){return n+x.boards.length;},0);
  var totalMembers=towns.reduce(function(n,x){return n+x.boards.reduce(function(m,b){return m+(b.members?b.members.filter(function(p){return p.name!=="Vacant";}).length:0);},0);},0);

  var boards=t.boards;
  if(state.board){
    boards=boards.filter(function(b){return b.name===state.board;});
    if(!boards.length){state.board="";boards=t.boards;}
  }

  var townOpts=towns.map(function(x){return '<option value="'+esc(x.name)+'"'+(x.name===t.name?' selected':'')+'>'+esc(x.name)+'</option>';}).join("");
  var boardOpts='<option value="">All '+t.boards.length+' boards</option>'+t.boards.map(function(b){return '<option value="'+esc(b.name)+'"'+(b.name===state.board?' selected':'')+'>'+esc(b.name)+'</option>';}).join("");

  host.innerHTML='<div class="con">'
    +'<header class="c-hero"><div class="c-kicker">Who runs South County</div>'
    +'<h1>Every board. Every town. One phone book.</h1>'
    +'<p>Members, chairs and contact points for each town&rsquo;s boards and commissions, plus the town manager and town clerk &mdash; pulled from the official town websites.</p>'
    +'<div class="c-data-strip">'
      +stat(towns.length,"towns","South County")
      +stat(totalBoards,"boards &amp; commissions","tracked")
      +stat(totalMembers,"officials listed","by name")
    +'</div></header>'
    +'<div class="c-controlbar">'
      +'<label>Town<select id="c-town-select">'+townOpts+'</select></label>'
      +'<label>Board<select id="c-board-select">'+boardOpts+'</select></label>'
      +'<div class="c-control-note">'+(state.board?'Showing one board.':'Showing every board in '+esc(t.name)+'.')+'</div>'
    +'</div>'
    +'<div class="c-officials">'+official(t.manager)+official(t.clerk)+'</div>'
    +'<div class="c-boards">'+boards.map(boardCard).join("")+'</div>'
    +'<div class="c-method"><details><summary>Sources and caveats</summary><div>'
    +'<p><strong>Sources:</strong> the official town websites of '+towns.map(function(x){return '<a href="'+esc(x.site)+'" target="_blank" rel="noopener">'+esc(x.name)+'</a>';}).join(", ")+', retrieved September 24, 2026. Each board links to the exact page its roster came from.</p>'
    +'<p><strong>Caveats:</strong> small towns update these pages irregularly. Where a town does not publish a board&rsquo;s membership online, the board is still listed with its contact point and a note. Chairs and roles are as published &mdash; always confirm with the town clerk before quoting in print.</p>'
    +'</div></details></div>'
    +'</div>';

  document.getElementById("c-town-select").addEventListener("change",function(e){state.town=e.target.value;state.board="";render();});
  document.getElementById("c-board-select").addEventListener("change",function(e){state.board=e.target.value;render();});
}

function load(){fetch("data/contacts.json?v=20260925-1").then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){state.data=d;render();}).catch(function(){document.getElementById("view").innerHTML='<div class="c-loading">The board directory could not be loaded.</div>';});}

window.BMContacts={render:render};
})();
