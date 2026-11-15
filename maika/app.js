
"use strict";
/* ================= constants ================= */
var THEMES=[
  {id:"car",name:"車両",src:"assets/bg-car.jpg"},
  {id:"space",name:"宇宙",src:"assets/bg-space.jpg"},
  {id:"mountain",name:"山道",src:"assets/bg-mountain.jpg"},
  {id:"coast",name:"海岸",src:"assets/bg-coast.jpg"},
  {id:"city",name:"夜景",src:"assets/bg-city.jpg"}
];
var ACCENTS={
  mono:{name:"モノクロ",hex:"#9aa0a6"},
  blue:{name:"青",hex:"#3b82f6"},
  cyan:{name:"シアン",hex:"#06b6d4"},
  green:{name:"緑",hex:"#22c55e"},
  orange:{name:"オレンジ",hex:"#f97316"},
  red:{name:"赤",hex:"#ef4444"}
};
var MAINT_TYPES=[
  {name:"エンジンオイル",interval:5000},
  {name:"オイルフィルター",interval:10000},
  {name:"タイヤ",interval:10000},
  {name:"バッテリー",interval:40000},
  {name:"タイヤ交換",interval:40000},
  {name:"車検",interval:0,dateBased:true}
];
/* 表示しない項目（インジケーター・項目選択・間隔設定のすべてから除外する） */
var REMOVED_TYPES={"スパークプラグ":1,"クーラント":1,"ブレーキフルード":1,"ブレーキフールド":1,"エアフィルター":1,"その他":1,"ワイパー":1};
var CIRC=301.6, JP={latMin:31,latMax:45.6,lngMin:129,lngMax:146};

/* ================= state ================= */
var S={
  settings:{carName:"NCロードスター",odometer:0,odoSet:false,gpsAdd:true,heroKicker:"ROADSTER",heroModel:"NC3",heroBadge:"RS",heroYear:"2013",specChips:"後期 NC3,RS,ホワイト,黒幌",accent:"mono",bg:"car",hero:"car",mapTheme:"light",snapUrl:"",intervals:{},indicatorBase:{},shakenDate:""},
  customBg:null, customHero:null,
  maint:[], drives:[],
  tab:"home", drawerOpen:false, sheetOpen:null,
  editingMaint:null, editingDrive:null, drivePhotoDraft:undefined, maintSnap:"", indicatorTarget:null,
  rec:{active:false,id:null,watchId:null,startedAt:0,elapsedBase:0,timer:null,sections:[],distance:0,points:0,forceNew:true,lastSave:0,wakeLock:null,lastPosAt:0}
};
function $(id){return document.getElementById(id);}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function fmtInt(n){return Math.round(n).toLocaleString("ja-JP");}
function fmtKm(m){return (m/1000).toFixed(2)+" km";}
function fmtDur(ms){var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;function p(x){return (x<10?"0":"")+x;}return p(h)+":"+p(m)+":"+p(ss);}
function fmtDate(ts){var d=new Date(ts);return d.getFullYear()+"/"+(d.getMonth()+1)+"/"+d.getDate();}
function fmtDateTime(ts){var d=new Date(ts);function p(x){return (x<10?"0":"")+x;}return fmtDate(ts)+" "+p(d.getHours())+":"+p(d.getMinutes());}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
var toastTimer=null;
function toast(msg){var t=$("toast");t.textContent=msg;t.classList.add("on");clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove("on");},2200);}

/* ================= IndexedDB ================= */
var dbPromise=null;
function idb(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise(function(res,rej){
    if(!("indexedDB" in window)){rej(new Error("no idb"));return;}
    var rq=indexedDB.open("maikaguan-li",1);
    rq.onupgradeneeded=function(){var d=rq.result;d.createObjectStore("kv",{keyPath:"k"});d.createObjectStore("maint",{keyPath:"id"});d.createObjectStore("drives",{keyPath:"id"});};
    rq.onsuccess=function(){res(rq.result);};
    rq.onerror=function(){rej(rq.error);};
  });
  return dbPromise;
}
function idbTx(store,mode,fn){
  return idb().then(function(db){return new Promise(function(res,rej){
    var tx=db.transaction(store,mode),st=tx.objectStore(store),out;
    var r=fn(st); if(r){r.onsuccess=function(){out=r.result;};}
    tx.oncomplete=function(){res(out);}; tx.onerror=function(){rej(tx.error);};
  });});
}
function kvGet(k){return idbTx("kv","readonly",function(st){return st.get(k);}).then(function(r){return r?r.v:undefined;}).catch(function(){return memKV[k];});}
function kvSet(k,v){memKV[k]=v;return idbTx("kv","readwrite",function(st){return st.put({k:k,v:v});}).catch(function(){});}
function putRec(store,rec){return idbTx(store,"readwrite",function(st){return st.put(rec);}).catch(function(){});}
function delRec(store,id){return idbTx(store,"readwrite",function(st){return st.delete(id);}).catch(function(){});}
function allRecs(store){return idbTx(store,"readonly",function(st){return st.getAll();}).catch(function(){return [];});}
function clearStore(store){return idbTx(store,"readwrite",function(st){return st.clear();}).catch(function(){});}
var memKV={};

/* ================= settings / theme ================= */
function accentHex(){return (ACCENTS[S.settings.accent]||ACCENTS.mono).hex;}
function themeSrc(which){
  var v=which==="bg"?S.settings.bg:S.settings.hero;
  if(v==="customBg"&&S.customBg)return S.customBg;
  if(v==="customHero"&&S.customHero)return S.customHero;
  for(var i=0;i<THEMES.length;i++)if(THEMES[i].id===v)return THEMES[i].src;
  return "assets/bg-car.jpg";
}
function heroModelHTML(m){
  /* 型式表示は文字列全体を同じウェイト（Exo 300）で出す。末尾だけ細くする処理はしない */
  return esc(String(m||""));
}
function applyTheme(){
  document.documentElement.style.setProperty("--accent",accentHex());
  $("bg").style.backgroundImage="url('"+themeSrc("bg")+"')";
  $("heroImg").src=themeSrc("hero");
  $("heroCarName").textContent=S.settings.carName||"";
  var hk=String(S.settings.heroKicker||"");
  $("heroKicker").textContent=hk; $("heroKicker").style.display=hk?"":"none";
  var hm=String(S.settings.heroModel||"");
  $("heroModel").innerHTML=heroModelHTML(hm); $("heroModel").style.display=hm?"":"none";
  /* ヒーロー右上のRSバッジは撤去済み（設定項目 heroBadge 自体は残す） */
  $("heroYear").textContent=S.settings.heroYear||"";
  var specs=String(S.settings.specChips||"").split(/[,、]/).map(function(s){return s.trim();}).filter(Boolean);
  $("specChips").textContent=specs.join(" / ");
  $("specChips").style.display=specs.length?"":"none";
  var ga=!!S.settings.gpsAdd;
  [$("tglGpsAdd"),$("tglGpsAddDrawer")].forEach(function(t){if(t){t.classList.toggle("on",ga);t.setAttribute("aria-checked",String(ga));}});
  $("mapBox").classList.toggle("dark",S.settings.mapTheme==="dark");
  var seg=$("mapThemeSeg").children;
  for(var i=0;i<seg.length;i++)seg[i].classList.toggle("sel",seg[i].getAttribute("data-mt")===S.settings.mapTheme);
  var sw=$("accentSwatches").children;
  for(var j=0;j<sw.length;j++)sw[j].classList.toggle("sel",sw[j].getAttribute("data-ac")===S.settings.accent);
  markThumbSel("bgGrid",S.settings.bg); markThumbSel("heroGrid",S.settings.hero);
}
function markThumbSel(gridId,val){var g=$(gridId);if(!g)return;var b=g.children;for(var i=0;i<b.length;i++)b[i].classList.toggle("sel",b[i].getAttribute("data-v")===val);}
function saveSettings(){return kvSet("settings",S.settings);}
function buildThumbGrid(gridId,kind){
  var g=$(gridId); g.innerHTML="";
  THEMES.forEach(function(t){
    var b=document.createElement("button"); b.setAttribute("data-v",t.id);
    b.innerHTML='<img src="'+t.src+'" alt="'+esc(t.name)+'"><span class="cap">'+esc(t.name)+"</span>";
    b.addEventListener("click",function(){S.settings[kind]=t.id;saveSettings();applyTheme();drawFallbackMap();});
    g.appendChild(b);
  });
  var customVal=kind==="bg"?"customBg":"customHero", customData=kind==="bg"?S.customBg:S.customHero;
  if(customData){
    var b2=document.createElement("button"); b2.setAttribute("data-v",customVal);
    b2.innerHTML='<img src="'+customData+'" alt="アップロード画像"><span class="cap">カスタム</span>';
    b2.addEventListener("click",function(){S.settings[kind]=customVal;saveSettings();applyTheme();drawFallbackMap();});
    g.appendChild(b2);
  }
}
function buildSettingsUI(){
  buildThumbGrid("bgGrid","bg"); buildThumbGrid("heroGrid","hero");
  var sw=$("accentSwatches"); sw.innerHTML="";
  Object.keys(ACCENTS).forEach(function(k){
    var b=document.createElement("button"); b.className="swatch"; b.setAttribute("data-ac",k); b.setAttribute("aria-label",ACCENTS[k].name);
    b.innerHTML='<i style="background:'+ACCENTS[k].hex+'"></i>';
    b.addEventListener("click",function(){S.settings.accent=k;saveSettings();applyTheme();drawFallbackMap();drawLeafAll();});
    sw.appendChild(b);
  });
  $("setCarName").value=S.settings.carName||"";
  $("setOdo").value=S.settings.odometer||0;
  $("setHeroKicker").value=S.settings.heroKicker||"";
  $("setHeroModel").value=S.settings.heroModel||"";
  $("setHeroBadge").value=S.settings.heroBadge||"";
  $("setHeroYear").value=S.settings.heroYear||"";
  $("setSpecChips").value=S.settings.specChips||"";
  $("setSnapUrl").value=S.settings.snapUrl||"";
  buildIntervalSettings();
}
/* ================= 交換間隔の設定 =================
   優先順: 設定画面の値（settings.intervals）＞ 最新記録に保存された間隔 ＞ MAINT_TYPES の既定値 */
function intervalFor(name){
  var ov=S.settings.intervals&&S.settings.intervals[name];
  if(ov&&ov>0)return ov;
  var d=MAINT_TYPES.filter(function(t){return t.name===name;})[0];
  return d?d.interval:5000;
}
function currentInterval(name){return intervalFor(name);}
/* インジケーター／間隔設定に出す項目: プリセット＋ユーザーが追加した項目のみ。
   整備履歴の有無では変わらない（履歴とインジケーターは無関係）。削除対象のプリセットは出さない。 */
function knownMaintTypes(){
  var out=[], seen={};
  function add(k){if(!k||REMOVED_TYPES[k]||seen[k])return;seen[k]=1;out.push(k);}
  MAINT_TYPES.forEach(function(t){add(t.name);});
  if(S.settings.intervals)Object.keys(S.settings.intervals).forEach(add);
  if(S.settings.indicatorBase)Object.keys(S.settings.indicatorBase).forEach(add);
  return out;
}
function buildIntervalSettings(){
  var box=$("intervalList"); if(!box)return;
  box.innerHTML="";
  knownMaintTypes().forEach(function(name){
    if(name==="車検")return; /* 車検は年月日で設定するので km 間隔は出さない */
    var row=document.createElement("div"); row.className="ivRow";
    row.innerHTML="<span>"+esc(name)+'</span><span class="ivIn"><input type="number" inputmode="numeric" min="0" step="100" value="'+currentInterval(name)+'" aria-label="'+esc(name)+'の交換間隔"><em>km</em></span>';
    var inp=row.querySelector("input");
    inp.addEventListener("change",function(){
      var v=parseInt(inp.value,10);
      if(!S.settings.intervals)S.settings.intervals={};
      if(!isNaN(v)&&v>0)S.settings.intervals[name]=v; else delete S.settings.intervals[name];
      inp.value=currentInterval(name);
      saveSettings(); renderHome();
      toast(name+" の交換間隔を "+fmtInt(currentInterval(name))+" kmに設定しました");
    });
    box.appendChild(row);
  });
}
function readImageFile(file,cb){
  var img=new Image(), url=URL.createObjectURL(file);
  img.onload=function(){
    var max=1280, w=img.naturalWidth, h=img.naturalHeight, sc=Math.min(1,max/Math.max(w,h));
    var c=document.createElement("canvas"); c.width=Math.round(w*sc); c.height=Math.round(h*sc);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    URL.revokeObjectURL(url); cb(c.toDataURL("image/jpeg",0.82));
  };
  img.onerror=function(){URL.revokeObjectURL(url);toast("画像を読み込めませんでした");};
  img.src=url;
}

/* ================= tabs / drawer / sheets ================= */
function switchTab(name){
  S.tab=name;
  ["home","maint","drive"].forEach(function(t){$("view-"+t).classList.toggle("on",t===name);});
  var btns=document.querySelectorAll(".tabbtn");
  for(var i=0;i<btns.length;i++)btns[i].setAttribute("aria-selected",String(btns[i].getAttribute("data-tab")===name));
  $("fabAdd").classList.toggle("on",name==="maint");
  moveTabInd(false);
  if(name==="drive"){setTimeout(function(){resizeFallback();initLeafMap();drawFallbackMap();drawLeafAll();},60);}
}
/* ===== カーナビ移植: 滑るピル＋シャボン玉（指追従・バネ揺れ・拡大鏡アイコン・長押し） ===== */
var tabbarEl=null, tabIndEl=null;
function moveTabInd(instant){
  if(!tabbarEl||!tabIndEl)return;
  var btn=tabbarEl.querySelector('.tabbtn[data-tab="'+S.tab+'"]');
  if(!btn||!btn.offsetWidth)return;
  tabIndEl.style.width=btn.offsetWidth+"px";
  tabIndEl.style.height=btn.offsetHeight+"px";
  tabIndEl.style.opacity="1";
  if(instant)tabIndEl.classList.add("noanim");
  tabIndEl.style.transform="translate("+btn.offsetLeft+"px,"+btn.offsetTop+"px)";
  if(instant){void tabIndEl.offsetWidth;tabIndEl.classList.remove("noanim");}
}
function initTabBar(){
  tabbarEl=$("tabbar"); tabIndEl=$("tabInd");
  if(!tabbarEl||!tabIndEl)return;
  var tabIndIn=tabIndEl.querySelector(".tab-ind-in");
  var tabDrag=null, tabDragSuppressClick=false;
  function tabIndFollow(cx,cy){
    var btns=tabbarEl.querySelectorAll(".tabbtn");
    if(!btns.length||!tabIndEl.offsetWidth)return;
    var w=tabIndEl.offsetWidth,h=tabIndEl.offsetHeight;
    var first=btns[0],last=btns[btns.length-1];
    var nx=Math.max(first.offsetLeft,Math.min(last.offsetLeft+last.offsetWidth-w,cx-w/2));
    var ny=Math.max(first.offsetTop,Math.min(first.offsetTop+first.offsetHeight-h,cy-h/2));
    tabIndEl.style.transform="translate("+nx+"px,"+ny+"px)";
  }
  var wob={on:false,raf:0,settle:0,tilt:0,grow:1,str:0,vx:0,lastX:0,lastT:0,lastMoveAt:0};
  function bubbleReturn(){
    tabIndEl.classList.add("snap");
    if(wob.settle)clearTimeout(wob.settle);
    wob.settle=0;
    tabIndEl.classList.remove("bubble");
    clearLensIcons();
    wob.settle=setTimeout(function(){wob.settle=0;tabIndEl.classList.remove("snap");},195);
  }
  try{
    var lensProbe=document.createElement("div");
    lensProbe.style.backdropFilter="url(#bubbleLens)";
    if(lensProbe.style.backdropFilter)document.documentElement.classList.add("lens-ok");
  }catch(e){}
  var lensRAF=0;
  function clearLensIcons(){tabbarEl.querySelectorAll(".tabbtn.lens-in").forEach(function(b){b.classList.remove("lens-in");});}
  function lensTick(){
    lensRAF=0;
    if(!tabIndEl.classList.contains("bubble")){clearLensIcons();return;}
    if(tabIndIn){
      var br=tabIndIn.getBoundingClientRect();
      tabbarEl.querySelectorAll(".tabbtn").forEach(function(b){
        var s=b.querySelector("svg"); if(!s)return;
        var r=s.getBoundingClientRect();
        var cx=r.left+r.width/2, cy=r.top+r.height/2;
        var inside=cx>=br.left&&cx<=br.right&&cy>=br.top-6&&cy<=br.bottom+6;
        b.classList.toggle("lens-in",inside);
      });
    }
    lensRAF=requestAnimationFrame(lensTick);
  }
  function startLens(){if(!lensRAF)lensRAF=requestAnimationFrame(lensTick);}
  window.__tabTapBubble=function(name){
    if(tabDragSuppressClick)return;
    var btns=tabbarEl.querySelectorAll(".tabbtn");
    var ci=-1,ti=-1;
    for(var i=0;i<btns.length;i++){
      var t=btns[i].getAttribute("data-tab");
      if(t===S.tab)ci=i;
      if(t===name)ti=i;
    }
    if(ci<0||ti<0||Math.abs(ti-ci)!==1)return;
    if(wob.settle){clearTimeout(wob.settle);wob.settle=0;}
    tabIndEl.classList.remove("snap");
    tabIndEl.classList.add("bubble");
    startLens();
    bubbleReturn();
  };
  var wobReduced=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function wobFrame(){
    wob.raf=0;
    if(!wob.on)return;
    var v=(performance.now()-wob.lastMoveAt>70)?0:wob.vx;
    var tTilt=Math.max(-3,Math.min(3,v*2.4));
    var tStretch=Math.min(0.035,Math.abs(v)*0.022);
    wob.tilt+=(tTilt-wob.tilt)*0.16;
    wob.grow+=(1.14-wob.grow)*0.14;
    wob.str+=(tStretch-wob.str)*0.16;
    if(tabIndIn){
      var sx=wob.grow+wob.str, sy=wob.grow-wob.str*0.55;
      tabIndIn.style.transform="rotate("+wob.tilt.toFixed(2)+"deg) scale("+sx.toFixed(3)+","+sy.toFixed(3)+")";
    }
    wob.raf=requestAnimationFrame(wobFrame);
  }
  function wobStart(e){
    if(wob.settle){clearTimeout(wob.settle);wob.settle=0;}
    tabIndEl.classList.remove("snap");
    tabIndEl.classList.add("bubble");
    startLens();
    if(!tabIndIn||wobReduced)return;
    wob.on=true; wob.tilt=0; wob.grow=1; wob.str=0; wob.vx=0;
    wob.lastX=e.clientX; wob.lastT=performance.now(); wob.lastMoveAt=wob.lastT;
    tabIndIn.style.transitionProperty="background,border-color,box-shadow";
    if(!wob.raf)wob.raf=requestAnimationFrame(wobFrame);
  }
  function wobMove(e){
    if(!wob.on)return;
    var now=performance.now(), dt=now-wob.lastT;
    if(dt>=8){
      var inst=(e.clientX-wob.lastX)/dt;
      if(isFinite(inst))wob.vx=wob.vx*0.55+inst*0.45;
      wob.lastX=e.clientX; wob.lastT=now;
    }
    wob.lastMoveAt=now;
  }
  function wobEnd(){
    if(wob.raf){cancelAnimationFrame(wob.raf);wob.raf=0;}
    wob.on=false;
    if(tabIndIn){tabIndIn.style.transitionProperty="";tabIndIn.style.transform="";}
    bubbleReturn();
  }
  var tabLpTimer=0;
  function tabLpClear(){if(tabLpTimer){clearTimeout(tabLpTimer);tabLpTimer=0;}}
  tabbarEl.addEventListener("pointerdown",function(e){
    tabDrag={x:e.clientX,y:e.clientY,moved:false};
    tabLpClear();
    tabLpTimer=setTimeout(function(){
      tabLpTimer=0;
      if(!tabDrag||tabDrag.moved)return;
      tabDrag.moved=true; tabDrag.lp=true;
      tabIndEl.classList.add("noanim");
      wobStart({clientX:tabDrag.x});
      var r=tabbarEl.getBoundingClientRect();
      tabIndFollow(tabDrag.x-r.left,tabDrag.y-r.top);
    },230);
  });
  window.addEventListener("pointermove",function(e){
    if(!tabDrag)return;
    if(!tabDrag.moved&&Math.abs(e.clientX-tabDrag.x)<5&&Math.abs(e.clientY-tabDrag.y)<5)return;
    if(!tabDrag.moved){
      tabLpClear();
      tabDrag.moved=true;
      tabIndEl.classList.add("noanim");
      wobStart(e);
    }else{
      wobMove(e);
    }
    var r=tabbarEl.getBoundingClientRect();
    tabIndFollow(e.clientX-r.left,e.clientY-r.top);
  },{passive:true});
  window.addEventListener("pointerup",function(e){
    tabLpClear();
    if(!tabDrag)return;
    var wasMoved=tabDrag.moved; tabDrag=null;
    if(!wasMoved)return;
    wobEnd();
    tabDragSuppressClick=true;
    setTimeout(function(){tabDragSuppressClick=false;},350);
    tabIndEl.classList.remove("noanim");
    var r=tabbarEl.getBoundingClientRect(), cx=e.clientX-r.left;
    var best=null,bd=Infinity;
    tabbarEl.querySelectorAll(".tabbtn").forEach(function(b){
      var d=Math.abs(b.offsetLeft+b.offsetWidth/2-cx);
      if(d<bd){bd=d;best=b;}
    });
    if(best)switchTab(best.getAttribute("data-tab"));
    else moveTabInd(false);
  });
  window.addEventListener("pointercancel",function(){
    tabLpClear();
    if(!tabDrag)return;
    var wasMoved=tabDrag.moved; tabDrag=null;
    if(wasMoved){wobEnd();tabIndEl.classList.remove("noanim");moveTabInd(false);}
  });
  tabbarEl.addEventListener("click",function(e){
    if(tabDragSuppressClick){e.stopPropagation();e.preventDefault();}
  },true);
  tabbarEl.querySelectorAll(".tabbtn").forEach(function(b){
    b.addEventListener("click",function(){
      if(typeof window.__tabTapBubble==="function"){try{window.__tabTapBubble(b.getAttribute("data-tab"));}catch(e){}}
      switchTab(b.getAttribute("data-tab"));
    });
  });
  window.addEventListener("resize",function(){moveTabInd(true);});
  window.addEventListener("load",function(){moveTabInd(true);});
  moveTabInd(true);
}
/* プッシュ式: ドロワーの開き具合に合わせてメイン画面全体（#app・背景・タブバー）を右へずらす。
   ずらし量は CSS 変数 --push で渡し、各要素の transform が追従する */
function drawerTravel(){return drawerW()+60;} /* 逆角丸フィレット（--cr=52px）の張り出し分まで隠し切る移動量 */
function drawerPushMax(){return drawerW();} /* 全開時のメイン画面のずらし量 = ドロワー幅ちょうど（隙間なし） */
/* --push（右への移動量）と --crr（角丸半径）は必ず同じ更新で書き換える。
   角丸は開き具合に比例（全開で --cr=52px、閉で 0）させることで、角丸の変化とスライドが
   直列にならず、開く操作をした瞬間から両方が並行して進む。閉じるときも対称に連動する */
function setPushPx(px){
  px=Math.max(0,px);
  var root=document.documentElement.style;
  root.setProperty("--push",px+"px");
  var W=drawerPushMax();
  var r=W?Math.max(0,Math.min(52,52*px/W)):0;
  root.setProperty("--crr",r+"px");
}
function clearPush(){var root=document.documentElement.style;root.removeProperty("--push");root.removeProperty("--crr");}
/* ドロワーの現在位置（translateX）。ドラッグとアニメーションの双方から更新する */
var drawerCurTx=null, drawerAnim=null;
function bezEase(t){
  var x1=.32,y1=.72,x2=.24,y2=1,u=t,i,x,dx;
  for(i=0;i<6;i++){
    x=3*(1-u)*(1-u)*u*x1+3*(1-u)*u*u*x2+u*u*u;
    dx=3*(1-u)*(1-u)*x1+6*(1-u)*u*(x2-x1)+3*u*u*(1-x2);
    if(Math.abs(x-t)<.001||!dx)break;
    u-=(x-t)/dx; if(u<0)u=0; if(u>1)u=1;
  }
  return 3*(1-u)*(1-u)*u*y1+3*(1-u)*u*u*y2+u*u*u;
}
/* tx に対してドロワー位置・スクリム・メイン画面のずらし・角丸をまとめて反映する。
   ずらし量は常にドロワー右端に一致させるので、途中のどの位置でも凸カーブと凹カーブが噛み合う */
function applyDrawerTx(tx){
  var d=$("drawer"),s=$("scrim"); if(!d||!s)return;
  var T=drawerTravel(),W=drawerW();
  tx=Math.max(-T,Math.min(0,tx));
  drawerCurTx=tx;
  d.style.transform="translateX("+tx+"px)";
  var progress=T?1+tx/T:0;
  s.style.opacity=String(Math.max(0,Math.min(1,progress)));
  var push=Math.max(0,Math.min(W,W+tx));
  setPushPx(push);
  document.documentElement.classList.toggle("dopen",push>0.5);
}
function finishDrawerAnim(open){
  var d=$("drawer"),s=$("scrim"); if(!d||!s)return;
  d.classList.remove("dragging"); s.classList.remove("dragging");
  document.documentElement.classList.remove("ddrag");
  d.style.transform=""; s.style.opacity="";
  drawerCurTx=open?0:-drawerTravel();
  if(open){d.classList.add("render");d.classList.add("on");s.classList.add("on");setPushPx(drawerPushMax());document.documentElement.classList.add("dopen");}
  else{d.classList.remove("on");d.classList.remove("render");s.classList.remove("on");clearPush();document.documentElement.classList.remove("dopen");}
}
/* 開閉アニメーション: ボタンタップでも指を離したスナップでも、ドロワーとメイン画面を同じイージングで同期させて滑らせる */
function animateDrawerTo(open,fromTx){
  var d=$("drawer"),s=$("scrim"); if(!d||!s)return;
  if(drawerAnim)cancelAnimationFrame(drawerAnim.raf);
  var T=drawerTravel();
  var target=open?0:-T;
  var from=(typeof fromTx==="number")?fromTx:(drawerCurTx!=null?drawerCurTx:(S.drawerOpen?0:-T));
  S.drawerOpen=open;
  d.classList.add("render");
  d.classList.remove("on"); s.classList.remove("on");
  d.classList.add("dragging"); s.classList.add("dragging");
  document.documentElement.classList.add("ddrag");
  var reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dur=reduced?1:Math.max(110,Math.min(300,Math.round(300*Math.abs(target-from)/T)));
  var t0=performance.now();
  applyDrawerTx(from);
  function frame(now){
    var t=Math.min(1,(now-t0)/dur), e=bezEase(t);
    applyDrawerTx(from+(target-from)*e);
    if(t<1){drawerAnim={raf:requestAnimationFrame(frame)};}
    else{drawerAnim=null;finishDrawerAnim(open);}
  }
  drawerAnim={raf:requestAnimationFrame(frame)};
}
function openDrawer(){if(S.sheetOpen)return;animateDrawerTo(true);}
function closeDrawer(){animateDrawerTo(false);}
function openSheet(id){
  S.sheetOpen=id; var w=$(id); w.classList.add("on");
  requestAnimationFrame(function(){requestAnimationFrame(function(){w.classList.add("show");});});
}
function closeSheet(){
  if(!S.sheetOpen)return; var w=$(S.sheetOpen); S.sheetOpen=null;
  w.classList.remove("show"); setTimeout(function(){w.classList.remove("on");},300);
}
function anySheetOpen(){return !!S.sheetOpen;}
/* 整備フォームの未保存チェック: 開いた時点の値と比べ、変わっていたら確認ダイアログを出す */
function maintFormStr(){return [$("mType").value,$("mInterval").value,$("mDate").value,$("mOdo").value,$("mCost").value,$("mMemo").value].join("|");}
function maintDirty(){return maintFormStr()!==S.maintSnap;}
function requestCloseSheet(){
  if(S.sheetOpen==="sheetMaint"&&maintDirty()){$("confirmWrap").classList.add("on");return;}
  closeSheet();
}
/* シート全域スワイプで畳む: スクロールが先頭のとき、下スワイプでシートが指に追従し、
   閾値を超えて離すと閉じる（閉じるボタン・背景タップと同じ経路を通す） */
function initSheetGestures(){
  document.querySelectorAll(".sheet").forEach(function(sheet){
    var sc=sheet.querySelector(".sheetScroll");
    var drag=null, suppressClick=false;
    sheet.addEventListener("click",function(e){
      if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;}
    },true);
    sheet.addEventListener("touchstart",function(e){
      if(e.touches.length!==1){drag=null;return;}
      var t=e.touches[0];
      drag={y:t.clientY,x:t.clientX,active:false,atTop:!sc||sc.scrollTop<=0};
    },{passive:true});
    sheet.addEventListener("touchmove",function(e){
      if(!drag||!drag.atTop)return;
      var t=e.touches[0]; if(!t)return;
      var dy=t.clientY-drag.y, dx=t.clientX-drag.x;
      if(!drag.active){
        if(dy>10&&dy>Math.abs(dx)*1.2){drag.active=true;sheet.style.transition="none";}
        else return;
      }
      if(dy<=0){sheet.style.transform="translateY(0px)";return;}
      e.preventDefault();
      sheet.style.transform="translateY("+dy+"px)";
    },{passive:false});
    function endDrag(e){
      if(!drag)return;
      var wasActive=drag.active, dy=0;
      if(e.changedTouches&&e.changedTouches[0])dy=e.changedTouches[0].clientY-drag.y;
      drag=null;
      if(!wasActive)return;
      sheet.style.transition=""; sheet.style.transform="";
      if(dy>24){suppressClick=true;setTimeout(function(){suppressClick=false;},400);}
      if(dy>80)requestCloseSheet();
    }
    sheet.addEventListener("touchend",endDrag);
    sheet.addEventListener("touchcancel",endDrag);
  });
}

/* pull-to-refresh / pinch guards */
/* iOS double-tap zoom / loupe suppression (as far as the web can):
   touch-action:manipulation (CSS) + viewport maximum-scale already set;
   below blocks the remaining double-tap gesture Safari still honours in
   webviews/PWA, and gesture events for pinch. The system loupe inside a
   focused text field itself cannot be removed by a page — outside fields,
   user-select:none + -webkit-touch-callout:none above suppress it. */
document.addEventListener("gesturestart",function(e){e.preventDefault();});
document.addEventListener("gesturechange",function(e){e.preventDefault();});
document.addEventListener("gestureend",function(e){e.preventDefault();});
document.addEventListener("dblclick",function(e){e.preventDefault();},{passive:false});
var lastTapEnd=0,lastTapX=0,lastTapY=0;
document.addEventListener("touchend",function(e){
  var t=e.changedTouches&&e.changedTouches[0]; if(!t)return;
  var now=Date.now();
  var dx=t.clientX-lastTapX, dy=t.clientY-lastTapY;
  if(now-lastTapEnd<=350 && dx*dx+dy*dy<1600){
    if(!e.target.closest("input,textarea,select"))e.preventDefault();
  }
  lastTapEnd=now; lastTapX=t.clientX; lastTapY=t.clientY;
},{passive:false});
document.addEventListener("touchmove",function(e){
  if(e.touches.length>1){e.preventDefault();return;}
  if(anySheetOpen() && !e.target.closest(".sheetScroll") && !e.target.closest(".sheet"))e.preventDefault();
},{passive:false});
document.addEventListener("contextmenu",function(e){if(!e.target.closest("input,textarea,select"))e.preventDefault();});

/* 左端スワイプでドロワーを指追従開閉 + タブスワイプ
   開く: 左端24px以内から始まる右向き横ドラッグだけが対象（縦スクロール・シート操作と競合させない）。
   閉じる: 開いている間は画面の全域が対象。ドロワー内の入力欄・トグル類の上、タブバーの上、
   右に少し見えているメイン画面（ホーム／整備記録／走行どのタブでも、カードやボタンの上を含む）から
   始めても横ドラッグで閉じられる。除外は確認系ダイアログの上だけ。
   追跡は document の capture フェーズで受け、個別要素がタッチを飲んでも候補が消えないようにする。
   タップだけ（横移動なし）なら候補は有効化されず、入力フォーカスやボタンのタップは従来通り働く。
   開始判定は最初の実移動イベントで即決する: 横成分が縦成分をわずかでも上回る（縦が横を大きく
   上回らない）動きが見えた瞬間に追従を始め、明確に縦方向が主体のときだけ通常スクロールに任せる。
   候補ができた touchstart の時点でドロワーの描画準備（プリレンダー＋レイアウト確定）を済ませ、
   活性化した最初のフレームから判定分も含めた指の実位置へ直接置くので、初動に待ちも追いつきも出ない。
   どちらも指に追従し、離した位置（と flick の向き）で全開／全閉へスナップする。 */
var tsX=0,tsY=0,tsT=0,tsOnMap=false,tsOnTab=false;
var drawerDrag=null;
/* ドロワー幅はドラッグ中不変なのでキャッシュする。touchmove のたびに offsetWidth を読むと
   直前に書いた CSS 変数のせいで毎フレーム強制レイアウトが走り、初動と追従の両方が遅れる */
var _dwCache=0;
window.addEventListener("resize",function(){_dwCache=0;});
function drawerW(){if(_dwCache)return _dwCache;var d=$("drawer");var w=d?d.offsetWidth:0;w=w||Math.min(320,Math.round(window.innerWidth*0.86));_dwCache=w;return w;}
/* 初動対策: 候補ができた touchstart の時点でドロワーを描画状態にし、レイアウトを済ませておく。
   閉じている間ドロワーは display:none で、従来はドラッグ活性化の最初のフレームで
   初回レイアウト＋ぼかし描画まで一気に走って、それが「動き出しの遅れ」になっていた。
   ここで先に払っておけば、最初の touchmove では transform の更新だけで済む */
function prepDrawerDrag(){
  var d=$("drawer"); if(!d)return;
  d.classList.add("render");
  void d.offsetWidth; /* レイアウトをこの時点で確定させる */
  drawerW();
}
/* ドラッグにならなかった候補（タップ・縦スクロール）の後片付け: プリレンダーを畳む */
function clearDrawerPrep(){
  if(S.drawerOpen||drawerDrag||drawerAnim)return;
  var d=$("drawer"); if(d)d.classList.remove("render");
}
function setDrawerDragPos(tx){
  var d=$("drawer"),s=$("scrim");if(!d||!s||!drawerDrag)return;
  var T=drawerTravel();
  tx=Math.max(-T,Math.min(0,tx));
  drawerDrag.tx=tx;
  applyDrawerTx(tx);
}
function activateDrawerDrag(dx){
  if(!drawerDrag||drawerDrag.active)return;
  drawerDrag.active=true;
  if(drawerAnim){cancelAnimationFrame(drawerAnim.raf);drawerAnim=null;}
  var d=$("drawer"),s=$("scrim");
  d.classList.add("render");
  d.classList.remove("on"); s.classList.remove("on");
  d.classList.add("dragging"); s.classList.add("dragging");
  document.documentElement.classList.add("ddrag");
  /* 活性化した最初のフレームから、判定までに指が進んだ分も含めた実位置へ置く。
     baseTx に戻してから追いかけると「後から追いつく」動きになるので、dx を加えた位置を直接書く。
     transition は ddrag/dragging でこの同じフレーム内に無効化されるため、イージングの残りも出ない */
  setDrawerDragPos(drawerDrag.baseTx+(dx||0));
}
function finishDrawerDrag(open){
  var d=$("drawer"),s=$("scrim");if(!d||!s)return;
  var fromTx=drawerDrag?drawerDrag.tx:null;
  drawerDrag=null;
  window.__ddEnd=Date.now(); /* ドラッグ直後のクリック（メニューボタン等）を誤って開閉に使わない */
  animateDrawerTo(open,fromTx);
}
document.addEventListener("touchstart",function(e){
  if(e.touches.length!==1)return; var t=e.touches[0];
  tsX=t.clientX; tsY=t.clientY; tsT=Date.now(); tsOnMap=!!e.target.closest("#mapBox"); tsOnTab=!!e.target.closest("#tabbar");
  drawerDrag=null;
  if(anySheetOpen())return;
  if(S.drawerOpen){
    /* 開いている間は開始位置を問わない: ドロワー内の入力欄・トグル・ボタンの上でも、タブバーの上でも、
       右にずれて見えているメイン画面（スクリム越しのカードやボタン）の上でも、メニューボタン上でも
       横ドラッグの候補にする。除外は確認系ダイアログの上だけ（その操作を横取りしないため）。
       ここでは候補を作るだけで何も横取りしないので、横に動かさないタップは入力フォーカスや
       ボタンのタップとして従来通り働く */
    if(e.target.closest("#dialogWrap,#confirmWrap"))return;
    drawerDrag={mode:"close",startX:tsX,startY:tsY,baseTx:0,tx:0,active:false,lastX:tsX,lastT:Date.now(),vx:0};
  }else{
    if(e.target.closest("input,textarea,select"))return;
    if(tsX<=24&&!tsOnTab)drawerDrag={mode:"open",startX:tsX,startY:tsY,baseTx:-drawerTravel(),tx:-drawerTravel(),active:false,lastX:tsX,lastT:Date.now(),vx:0};
  }
  /* 候補ができたら指が動き出す前に描画準備を済ませる（初動対策） */
  if(drawerDrag)prepDrawerDrag();
},{passive:true,capture:true});
document.addEventListener("touchmove",function(e){
  if(!drawerDrag||e.touches.length!==1)return;
  var t=e.touches[0]; if(!t)return;
  var dx=t.clientX-drawerDrag.startX, dy=t.clientY-drawerDrag.startY;
  if(!drawerDrag.active){
    var adx=Math.abs(dx), ady=Math.abs(dy);
    if(adx===0&&ady===0)return; /* まだ指が動いていないときだけ待つ。最初の実移動イベントで即決し、数イベント様子を見る待ちは入れない */
    if(ady>adx*1.15){drawerDrag=null;clearDrawerPrep();return;} /* 明確に縦方向が主のときだけ通常スクロールに任せる。横が縦を少しでも上回れば横ドラッグと判定し、斜め気味でも縦が横を大きく上回らなければ追従を始める */
    if(drawerDrag.mode==="open"&&dx<=0){drawerDrag=null;clearDrawerPrep();return;}
    /* 閉じる側は左右どちらの横動きでも追従を開始する（右向きは全開位置でクランプされる） */
    activateDrawerDrag(dx);
  }
  if(!drawerDrag||!drawerDrag.active)return;
  e.preventDefault();
  var now=Date.now(),dt=now-drawerDrag.lastT;
  if(dt>=8){var inst=(t.clientX-drawerDrag.lastX)/dt;if(isFinite(inst))drawerDrag.vx=drawerDrag.vx*0.55+inst*0.45;drawerDrag.lastX=t.clientX;drawerDrag.lastT=now;}
  setDrawerDragPos(drawerDrag.baseTx+dx);
},{passive:false,capture:true});
function endDrawerDrag(cancelled){
  if(!drawerDrag)return false;
  var wasActive=drawerDrag.active, drag=drawerDrag;
  if(!wasActive){drawerDrag=null;clearDrawerPrep();return false;}
  var T=drawerTravel(), progress=T?(1+drag.tx/T):0, open;
  if(cancelled)open=progress>=0.5;
  else if(drag.vx>0.28)open=true;
  else if(drag.vx<-0.28)open=false;
  else open=progress>=0.5;
  finishDrawerDrag(open);
  return true;
}
document.addEventListener("touchcancel",function(){endDrawerDrag(true);},{passive:true,capture:true});
/* ドラッグを離した直後に発生するクリック（ドロワー内のトグル・ボタン、スクリム、メニューボタン等）を
   誤作動させない: 追従ドラッグが有効だった指離しから450ms以内のクリックは丸ごと打ち消す */
document.addEventListener("click",function(e){
  if(window.__ddEnd&&Date.now()-window.__ddEnd<450){e.preventDefault();e.stopPropagation();}
},true);
document.addEventListener("touchend",function(e){
  if(endDrawerDrag(false))return;
  var t=e.changedTouches[0]; if(!t)return;
  var dx=t.clientX-tsX, dy=t.clientY-tsY;
  if(tsOnTab)return;
  if(Math.abs(dy)>70||Date.now()-tsT>600)return;
  if(anySheetOpen())return;
  if(S.drawerOpen)return;
  if(tsOnMap||Math.abs(dx)<64)return;
  var order=["home","maint","drive"], i=order.indexOf(S.tab);
  if(dx<0&&i<2)switchTab(order[i+1]);
  if(dx>0&&i>0)switchTab(order[i-1]);
},{passive:true,capture:true});

;

"use strict";
/* ================= maintenance logic ================= */
function lastMaintOf(name){
  var best=null;
  S.maint.forEach(function(r){if(r.type===name&&(!best||r.odo>best.odo))best=r;});
  return best;
}
function maintStatus(){
  /* ホームのインジケーターは整備履歴とは無関係。基準は項目ごとに独自保持する:
     通常項目は settings.indicatorBase（リセットした日付・走行距離）、車検は settings.shakenDate（満了日）。 */
  var bases=S.settings.indicatorBase||{};
  return knownMaintTypes().map(function(name){
    if(name==="車検"){
      var dv=String(S.settings.shakenDate||"");
      var ts=dv?new Date(dv+"T12:00:00").getTime():null;
      if(ts!=null&&isNaN(ts))ts=null;
      var daysLeft=ts==null?null:Math.ceil((ts-Date.now())/86400000);
      var ratio=0;
      if(daysLeft!=null)ratio=daysLeft<0?1:Math.max(0,Math.min(1,1-daysLeft/730));
      return {type:name,dateBased:true,has:ts!=null,shakenTs:ts,daysLeft:daysLeft,ratio:ratio,interval:0,elapsed:0,remain:0,lastOdo:null,lastDate:null};
    }
    var interval=intervalFor(name);
    var base=bases[name]||null;
    var has=!!base;
    var elapsed=has?Math.max(0,(S.settings.odometer||0)-(base.odo||0)):0;
    return {type:name,dateBased:false,interval:interval,lastOdo:has?base.odo:null,lastDate:has?base.ts:null,elapsed:elapsed,remain:interval-elapsed,ratio:interval?elapsed/interval:0,has:has};
  }).sort(function(a,b){return b.ratio-a.ratio;});
}
function renderHome(){
  if(S.settings.odoSet){
    $("odoVal").textContent=fmtInt(S.settings.odometer);
    $("odoState").textContent="";
  }else{
    $("odoVal").textContent="—";
    $("odoState").textContent="未入力";
  }
  $("heroCarName").textContent=S.settings.carName||"";
  var qi=$("odoQuickInput");
  if(qi)qi.placeholder=S.settings.odoSet?fmtInt(S.settings.odometer):"現在の走行距離を入力";
  var st=maintStatus();
  var grid=$("gaugeGrid"); grid.innerHTML="";
  st.forEach(function(it){
    var b=document.createElement("button"); b.className="gaugeCell";
    var pct=Math.max(0,Math.min(1,it.ratio));
    var off=(CIRC*(1-pct)).toFixed(1);
    var colStyle=it.ratio>=1?"stroke:var(--danger)":"stroke:var(--accent)";
    var centerB, centerS, longCls="", rm, rmCls="gaugeRm";
    if(it.dateBased){
      if(!it.has){centerB="—"; centerS="車検日 未設定"; rm="タップで年月日を設定";}
      else if(it.daysLeft>0){centerB=fmtInt(it.daysLeft); centerS="日・車検まで"; rm="満了日 "+fmtDate(it.shakenTs);}
      else if(it.daysLeft===0){centerB="0"; centerS="日・車検まで"; rm="満了日 "+fmtDate(it.shakenTs)+"（本日）"; rmCls+=" over";}
      else{centerB=fmtInt(-it.daysLeft); centerS="日・超過"; rm="満了日 "+fmtDate(it.shakenTs); rmCls+=" over";}
    }else{
      centerB=fmtInt(it.elapsed);
      centerS="/ "+fmtInt(it.interval)+" km";
      longCls=(centerB.length+fmtInt(it.interval).length)>9?" long":"";
      if(!it.has)rm="前回交換 未登録";
      else if(it.remain>0)rm="あと "+fmtInt(it.remain)+" km";
      else if(it.remain===0){rm="交換時期です"; rmCls+=" over";}
      else{rm=fmtInt(-it.remain)+" km 超過"; rmCls+=" over";}
    }
    b.innerHTML='<span class="gaugeWrap"><svg width="118" height="118" viewBox="0 0 118 118">'
      +'<circle cx="59" cy="59" r="48" fill="none" stroke="rgba(160,165,180,.28)" stroke-width="9"/>'
      +'<circle cx="59" cy="59" r="48" fill="none" style="'+colStyle+'" stroke-width="9" stroke-linecap="round" stroke-dasharray="'+CIRC+'" stroke-dashoffset="'+off+'"/>'
      +'</svg><span class="gaugeC"><b class="'+longCls.trim()+'">'+centerB+'</b><span>'+centerS+'</span></span></span>'
      +'<span class="gaugeNm">'+esc(it.type)+'</span><span class="'+rmCls+'">'+rm+"</span>";
    b.addEventListener("click",function(){openIndicatorSheet(it);});
    grid.appendChild(b);
  });
  var totalKm=S.drives.reduce(function(a,d){return a+(d.distance||0);},0);
  $("statDriveKm").textContent=(totalKm/1000).toFixed(1)+" km";
  $("statDrives").textContent=S.drives.length;
  $("statMaint").textContent=S.maint.length;
  $("cntMaint").textContent=S.maint.length+"件";
  $("cntDrives").textContent=S.drives.length+"件";
  var rb=$("recentBox"); rb.innerHTML="";
  var items=[];
  S.maint.slice().sort(function(a,b){return b.ts-a.ts;}).slice(0,2).forEach(function(r){items.push({k:"m",r:r});});
  S.drives.slice().sort(function(a,b){return b.startedAt-a.startedAt;}).slice(0,2).forEach(function(d){items.push({k:"d",r:d});});
  items.sort(function(a,b){return (b.k==="m"?b.r.ts:b.r.startedAt)-(a.k==="m"?a.r.ts:a.r.startedAt);});
  if(!items.length)rb.innerHTML='<div class="empty">記録がありません</div>';
  items.slice(0,3).forEach(function(it){
    var b=document.createElement("button"); b.className="rowItem";
    if(it.k==="m")b.innerHTML='<div class="grow"><div class="t1">'+esc(it.r.type)+'</div><div class="t2">'+fmtDate(it.r.ts)+" ・ "+fmtInt(it.r.odo)+" km"+(it.r.brand?" ・ "+esc(it.r.brand):"")+"</div></div>"+(it.r.cost?'<span class="amt">¥'+fmtInt(it.r.cost)+"</span>":"");
    else b.innerHTML='<div class="grow"><div class="t1">走行 '+fmtKm(it.r.distance||0)+'</div><div class="t2">'+fmtDateTime(it.r.startedAt)+"</div></div>";
    b.addEventListener("click",function(){if(it.k==="m")openMaintSheet(it.r);else openDriveSheet(it.r);});
    rb.appendChild(b);
  });
}
function renderMaintList(){
  var box=$("maintList"); box.innerHTML="";
  var list=S.maint.slice().sort(function(a,b){return b.ts-a.ts;});
  if(!list.length){box.innerHTML='<div class="empty">整備記録がありません</div>';return;}
  list.forEach(function(r){
    var b=document.createElement("button"); b.className="rowItem";
    b.innerHTML='<div class="grow"><div class="t1">'+esc(r.type)+'</div><div class="t2">'+fmtDate(r.ts)+" ・ "+fmtInt(r.odo)+" km"+(r.brand?" ・ "+esc(r.brand):"")+(r.memo?" ・ "+esc(r.memo):"")+"</div></div>"+(r.cost?'<span class="amt">¥'+fmtInt(r.cost)+"</span>":"");
    b.addEventListener("click",function(){openMaintSheet(r);});
    box.appendChild(b);
  });
}
function fillMaintTypes(sel){
  var s=$("mType"); s.innerHTML="";
  MAINT_TYPES.forEach(function(t){var o=document.createElement("option");o.value=t.name;o.textContent=t.name;s.appendChild(o);});
  if(sel==="タイヤローテーション")sel="タイヤ";
  if(sel){
    var found=false;
    for(var i=0;i<s.options.length;i++)if(s.options[i].value===sel)found=true;
    if(!found){var o2=document.createElement("option");o2.value=sel;o2.textContent=sel;s.appendChild(o2);}
    s.value=sel;
  }
  $("mInterval").value=currentInterval(s.value);
}
function updateMaintBaseNote(){
  var note=$("mBaseNote"); if(!note)return;
  var t=$("mType").value;
  var ivField=$("mInterval").closest(".field");
  if(ivField)ivField.style.display=(t==="車検")?"none":"";
  var has=S.maint.some(function(r){var tp=r.type==="タイヤローテーション"?"タイヤ":r.type;return tp===t;});
  if(!S.editingMaint&&!has){
    note.textContent="「"+t+"」の整備履歴はまだありません。これは履歴への記録で、ホームのインジケーターには影響しません。";
    note.classList.add("on");
  }else{
    note.classList.remove("on");
  }
}
function openMaintSheet(rec,presetType){
  S.editingMaint=rec?rec.id:null;
  $("maintSheetTitle").textContent=rec?"整備を編集":"整備を記録";
  fillMaintTypes(rec?rec.type:(presetType||"エンジンオイル"));
  if(rec){
    $("mInterval").value=rec.interval||5000;
    $("mDate").value=new Date(rec.ts).toISOString().slice(0,10);
    $("mOdo").value=rec.odo; $("mCost").value=rec.cost||""; $("mMemo").value=rec.memo||"";
  }else{
    $("mDate").value=new Date().toISOString().slice(0,10);
    $("mOdo").value=S.settings.odometer||0; $("mCost").value=""; $("mMemo").value="";
  }
  $("maintDeleteRow").style.display=rec?"flex":"none";
  updateMaintBaseNote();
  S.maintSnap=maintFormStr();
  openSheet("sheetMaint");
}
function saveMaint(){
  var type=$("mType").value, interval=parseInt($("mInterval").value,10)||5000;
  var odo=parseInt($("mOdo").value,10);
  if(isNaN(odo)){toast("走行距離を入力してください");return;}
  var dv=$("mDate").value, ts=dv?new Date(dv+"T12:00:00").getTime():Date.now();
  var rec={id:S.editingMaint||uid(),type:type,interval:interval,odo:odo,ts:ts,
    cost:parseInt($("mCost").value,10)||0,memo:$("mMemo").value.trim()};
  /* 「交換した」経由で付いた銘柄は、履歴フォームに欄が無いので編集時も保持する */
  var prevRec=S.maint.find(function(r){return r.id===rec.id;});
  if(prevRec&&prevRec.brand)rec.brand=prevRec.brand;
  /* 整備履歴はホームのインジケーターとは無関係: ここでは履歴レコードだけを保存し、
     インジケーターの基準（indicatorBase）や間隔設定には触れない */
  var ix=S.maint.findIndex(function(r){return r.id===rec.id;});
  if(ix>=0)S.maint[ix]=rec; else S.maint.push(rec);
  putRec("maint",rec); closeSheet(); renderHome(); renderMaintList(); toast("保存しました");
}

/* ================= インジケーター（ホーム専用・基準は履歴と独立） =================
   タップでシートを開く。通常項目は「交換した」で基準＝今日＋現在のオドメーターにリセットし、
   その際に銘柄・金額（任意）とあわせて整備履歴へ1件だけ追加する。
   車検は年月日（満了日）を設定し、残り日数を表示する（履歴には追加しない）。
   履歴側の追加・編集・削除ではインジケーターは変わらない。 */
function openIndicatorSheet(it){
  S.indicatorTarget=it.type;
  $("indTitle").textContent=it.type;
  function row(k,v){return '<div class="kvRow"><span>'+esc(k)+"</span><b>"+esc(v)+"</b></div>";}
  var html="";
  if(it.dateBased){
    html=row("車検満了日",it.has?fmtDate(it.shakenTs):"未設定");
    if(it.has)html+=row("残り",it.daysLeft>=0?fmtInt(it.daysLeft)+" 日":fmtInt(-it.daysLeft)+" 日 超過");
    $("indShakenDate").value=S.settings.shakenDate||"";
  }else{
    html=row("現在のオドメーター",S.settings.odoSet?fmtInt(S.settings.odometer)+" km":"未入力")
      +row("前回交換",it.has?fmtDate(it.lastDate)+" ・ "+fmtInt(it.lastOdo)+" km":"未登録")
      +row("交換間隔",fmtInt(it.interval)+" km");
    if(it.has)html+=row("前回から",fmtInt(it.elapsed)+" km");
  }
  $("indInfo").innerHTML=html;
  $("indResetRow").style.display=it.dateBased?"none":"flex";
  $("indExFields").style.display=it.dateBased?"none":"block";
  if(!it.dateBased){$("indBrand").value=""; $("indCost").value="";}
  $("indShakenField").style.display=it.dateBased?"block":"none";
  $("indShakenRow").style.display=it.dateBased?"flex":"none";
  $("indNote").textContent=it.dateBased
    ?"車検満了日（年月日）を設定すると、その日までの残り日数を表示します。"
    :"銘柄・金額は任意です。「交換した」を押すと、今日の日付と現在のオドメーター値が基準になりゲージが0に戻るとともに、整備履歴にも1件追加されます。";
  openSheet("sheetIndicator");
}

/* ================= drives list / detail ================= */
function renderDriveList(){
  var box=$("driveList"); box.innerHTML="";
  var list=S.drives.slice().sort(function(a,b){return b.startedAt-a.startedAt;});
  if(!list.length){box.innerHTML='<div class="empty">走行記録がありません</div>';return;}
  list.forEach(function(d){
    var b=document.createElement("button"); b.className="rowItem";
    b.innerHTML=(d.photo?'<img class="thumb" src="'+d.photo+'" alt="走行写真">':"")+
      '<div class="grow"><div class="t1">'+fmtKm(d.distance||0)+'</div><div class="t2">'+fmtDateTime(d.startedAt)+(d.memo?" ・ "+esc(d.memo):"")+"</div></div>"+
      '<span class="amt">'+fmtDur((d.endedAt||d.startedAt)-d.startedAt)+"</span>";
    b.addEventListener("click",function(){openDriveSheet(d);});
    box.appendChild(b);
  });
}
function openDriveSheet(d){
  S.editingDrive=d.id; S.drivePhotoDraft=undefined;
  $("dDate").textContent=fmtDateTime(d.startedAt);
  $("dDist").textContent=fmtKm(d.distance||0);
  $("dDur").textContent=fmtDur((d.endedAt||d.startedAt)-d.startedAt);
  $("dSecs").textContent=(d.sections?d.sections.length:0)+" 区間";
  $("dMemo").value=d.memo||"";
  $("dPhotoBox").innerHTML=d.photo?'<img src="'+d.photo+'" alt="走行写真">':"";
  openSheet("sheetDrive");
}
function currentDriveRec(){return S.drives.filter(function(d){return d.id===S.editingDrive;})[0];}

/* ================= GPS recording ================= */
function haversine(a,b){
  var R=6371000, dLa=(b.lat-a.lat)*Math.PI/180, dLo=(b.lng-a.lng)*Math.PI/180;
  var la1=a.lat*Math.PI/180, la2=b.lat*Math.PI/180;
  var h=Math.sin(dLa/2)*Math.sin(dLa/2)+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)*Math.sin(dLo/2);
  return 2*R*Math.asin(Math.sqrt(h));
}
function recElapsed(){return S.rec.elapsedBase+(S.rec.active?Date.now()-S.rec.startedAt:0);}
function updateRecUI(){
  $("recTime").textContent=fmtDur(recElapsed());
  $("recDist").textContent=fmtKm(S.rec.distance);
  $("recPts").textContent=S.rec.points;
  $("recDot").classList.toggle("on",S.rec.active);
  $("recState").textContent=S.rec.active?"記録中":"待機中";
  $("recBtnsIdle").style.display=S.rec.active?"none":"flex";
  $("recBtnsRun").style.display=S.rec.active?"flex":"none";
  $("recNote").classList.toggle("on",S.rec.active);
}
function persistRec(finished){
  var rec={id:S.rec.id,startedAt:S.rec.startedAt0,endedAt:finished?Date.now():null,
    distance:S.rec.distance,sections:S.rec.sections,status:finished?"done":"recording",memo:"",photo:null};
  var ix=S.drives.findIndex(function(d){return d.id===rec.id;});
  if(ix>=0){rec.memo=S.drives[ix].memo||"";rec.photo=S.drives[ix].photo||null;S.drives[ix]=rec;}
  else S.drives.push(rec);
  return putRec("drives",rec);
}
function onPos(pos){
  var R=S.rec; if(!R.active)return;
  var p={lat:pos.coords.latitude,lng:pos.coords.longitude,t:pos.timestamp||Date.now(),acc:pos.coords.accuracy==null?999:pos.coords.accuracy};
  if(p.acc>50)return;
  R.lastPosAt=p.t;
  var secs=R.sections, cur=secs[secs.length-1];
  if(!cur||R.forceNew||(cur.length&&p.t-cur[cur.length-1].t>20000)){
    cur=[]; secs.push(cur); R.forceNew=false;
  }else if(cur.length){
    var last=cur[cur.length-1], d=haversine(last,p), dt=(p.t-last.t)/1000;
    if(dt<=0)return;
    var speed=d/dt;
    if(speed>55)return;
    if(d<Math.max(4,p.acc*0.6)&&speed<1.2)return;
    R.distance+=d;
  }
  cur.push(p); R.points++;
  updateRecUI(); drawLive();
  if(p.t-R.lastSave>3000){R.lastSave=p.t;persistRec(false);}
}
function onPosErr(){ /* 記録は継続し、次の測位を待つ */ }
function requestWake(){
  if("wakeLock" in navigator){
    navigator.wakeLock.request("screen").then(function(wl){
      S.rec.wakeLock=wl; $("wakeChip").classList.add("on");
      wl.addEventListener("release",function(){$("wakeChip").classList.remove("on");});
    }).catch(function(){$("wakeChip").classList.remove("on");});
  }
}
function releaseWake(){if(S.rec.wakeLock){try{S.rec.wakeLock.release();}catch(e){}S.rec.wakeLock=null;}$("wakeChip").classList.remove("on");}
function startRec(){
  if(!("geolocation" in navigator)){toast("位置情報が利用できません");return;}
  var R=S.rec;
  R.active=true; R.id=uid(); R.startedAt0=Date.now(); R.startedAt=Date.now(); R.elapsedBase=0;
  R.sections=[]; R.distance=0; R.points=0; R.forceNew=true; R.lastSave=0;
  persistRec(false);
  R.watchId=navigator.geolocation.watchPosition(onPos,onPosErr,{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
  R.timer=setInterval(updateRecUI,500);
  requestWake(); updateRecUI(); drawLive(); toast("記録を開始しました");
}
function stopRec(save){
  var R=S.rec; if(!R.active)return;
  if(R.watchId!=null)navigator.geolocation.clearWatch(R.watchId);
  clearInterval(R.timer); releaseWake();
  var dist=R.distance, id=R.id;
  R.active=false; R.watchId=null;
  if(save){
    persistRec(true).then(function(){
      if(S.settings.gpsAdd){
        S.settings.odometer=Math.round((S.settings.odometer||0)+dist/1000);
        if(dist>0)S.settings.odoSet=true;
        saveSettings();
        var so=$("setOdo"); if(so)so.value=S.settings.odometer;
      }
      renderHome(); renderDriveList(); drawFallbackMap(); drawLeafAll(); toast("保存しました");
    });
  }else{
    delRec("drives",id);
    S.drives=S.drives.filter(function(d){return d.id!==id;});
    renderHome(); renderDriveList(); drawFallbackMap(); drawLeafAll(); toast("破棄しました");
  }
  R.sections=[]; R.distance=0; R.points=0; R.elapsedBase=0;
  updateRecUI(); drawLive();
}
document.addEventListener("visibilitychange",function(){
  if(document.hidden){ if(S.rec.active)S.rec.forceNew=true; }
  else if(S.rec.active&&!S.rec.wakeLock)requestWake();
});

/* ================= fallback map (canvas) ================= */
function proj(lat,lng,w,h){
  return {x:(lng-JP.lngMin)/(JP.lngMax-JP.lngMin)*w, y:(1-(lat-JP.latMin)/(JP.latMax-JP.latMin))*h};
}
function allSections(){
  ensureSnaps();
  var out=[];
  S.drives.forEach(function(d){displaySections(d).forEach(function(s){out.push(s);});});
  if(S.rec.active)S.rec.sections.forEach(function(s){if(s.length>1)out.push(s);});
  return out;
}
function resizeFallback(){
  var c=$("fallbackMap"); if(!c)return;
  var r=c.parentElement.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  c.width=Math.max(1,r.width*dpr); c.height=Math.max(1,r.height*dpr);
}
function drawFallbackMap(){
  var c=$("fallbackMap"); if(!c)return;
  if(leafMap){drawLeafLive();return;}
  resizeFallback();
  var ctx=c.getContext("2d"), w=c.width, h=c.height;
  var dark=S.settings.mapTheme==="dark";
  ctx.fillStyle=dark?"#1d2a44":"#e8ebee"; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=dark?"rgba(255,255,255,.06)":"rgba(20,30,40,.06)"; ctx.lineWidth=1;
  for(var gx=0;gx<w;gx+=w/8){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,h);ctx.stroke();}
  for(var gy=0;gy<h;gy+=h/8){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(w,gy);ctx.stroke();}
  ctx.strokeStyle=accentHex(); ctx.lineWidth=Math.max(2,(window.devicePixelRatio||1)*1.6);
  ctx.lineJoin="round"; ctx.lineCap="round";
  allSections().forEach(function(s){
    ctx.beginPath();
    s.forEach(function(p,i){var q=proj(p.lat,p.lng,w,h); if(i===0)ctx.moveTo(q.x,q.y); else ctx.lineTo(q.x,q.y);});
    ctx.stroke();
  });
  var secs=allSections();
  if(secs.length){
    var last=secs[secs.length-1], lp=last[last.length-1], q=proj(lp.lat,lp.lng,w,h);
    ctx.fillStyle=accentHex(); ctx.beginPath(); ctx.arc(q.x,q.y,Math.max(4,(window.devicePixelRatio||1)*3.4),0,7); ctx.fill();
    ctx.fillStyle=dark?"#fff":"#141416"; ctx.beginPath(); ctx.arc(q.x,q.y,Math.max(1.8,(window.devicePixelRatio||1)*1.4),0,7); ctx.fill();
  }
  $("mapChip").textContent=anySnapped()?"軌跡プレビュー（吸着済み）":"軌跡プレビュー（日本全国）";
}
function drawLive(){ if(leafMap){drawLeafLive();} else {drawFallbackMap();} }

/* ================= 地図（カーナビ移植: Leaflet＋テーマ別タイル） =================
   ダーク: Esri Dark Gray（≤17, .tilefx-esri で紺色化）＋地理院淡色（≥17, .tilefx-darkhi）
   ライト: 同じスタックに反転フィルタ（.tilefx-esri-light / .tilefx-lighthi）
   Esri が落ちたら地理院淡色＋.tilefx-invert へフォールバック（カーナビと同じ） */
var leafMap=null, leafBase=null, leafPolys=[], leafLive=null, leafFitted=false;
function leafDark(){return S.settings.mapTheme==="dark";}
function attachLeafBase(){
  if(!leafMap||!window.L)return;
  try{leafMap.attributionControl.setPrefix(false);}catch(e){}
  var retina=!!(window.L&&L.Browser&&L.Browser.retina);
  var nativeCap=function(n){return retina?n-1:n;};
  if(leafBase){try{leafMap.removeLayer(leafBase);}catch(e){} leafBase=null;}
  var group, primaryTiles, fbClass;
  if(leafDark()){
    var o1={maxZoom:(retina?18:17),maxNativeZoom:(retina?15:16),detectRetina:true,className:"tilefx-esri",attribution:"Esri, HERE, Garmin, © OpenStreetMap contributors"};
    var b1=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",o1);
    var r1=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",o1);
    var h1=L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",{minZoom:17,maxZoom:19,maxNativeZoom:nativeCap(18),detectRetina:true,className:"tilefx-darkhi",attribution:"地理院タイル（国土地理院）"});
    var he=0;
    h1.on("tileerror",function(){he++; if(he<6)return; b1.options.maxZoom=19; r1.options.maxZoom=19; try{b1.redraw();r1.redraw();}catch(e){}});
    group=L.layerGroup([b1,r1,h1]); primaryTiles=b1; fbClass="tilefx-invert";
  }else{
    var o2={maxZoom:(retina?18:17),maxNativeZoom:(retina?15:16),detectRetina:true,className:"tilefx-esri-light",attribution:"Esri, HERE, Garmin, © OpenStreetMap contributors"};
    var b2=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",o2);
    var r2=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",o2);
    var h2=L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",{minZoom:17,maxZoom:19,maxNativeZoom:nativeCap(18),detectRetina:true,className:"tilefx-lighthi",attribution:"地理院タイル（国土地理院）"});
    var he2=0;
    h2.on("tileerror",function(){he2++; if(he2<6)return; b2.options.maxZoom=19; r2.options.maxZoom=19; try{b2.redraw();r2.redraw();}catch(e){}});
    group=L.layerGroup([b2,r2,h2]); primaryTiles=b2; fbClass="tilefx-lighthi";
  }
  leafBase=group.addTo(leafMap);
  var errs=0, curGroup=group;
  primaryTiles.on("tileerror",function(){
    errs++; if(errs<6)return;
    if(leafBase!==curGroup)return;
    try{leafMap.removeLayer(curGroup);}catch(e){}
    var fb=L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",{maxZoom:18,maxNativeZoom:nativeCap(18),detectRetina:true,className:fbClass,attribution:"地理院タイル（国土地理院）"});
    leafBase=fb.addTo(leafMap);
  });
}
function refreshLeafBase(){ if(leafMap)attachLeafBase(); }
function initLeafMap(){
  if(!window.L)return false;
  if(leafMap){ setTimeout(function(){try{leafMap.invalidateSize();}catch(e){} drawLeafAll();},40); return true; }
  var el=$("leafMap"); if(!el)return false;
  el.style.display="block"; $("fallbackMap").style.display="none";
  leafMap=L.map("leafMap",{zoomControl:true,doubleClickZoom:false}).setView([36.8,138.2],5);
  leafMap.options.maxZoom=18; leafMap.options.minZoom=4;
  attachLeafBase();
  $("mapChip").textContent="日本全国";
  drawLeafAll();
  return true;
}
function drawLeafAll(){
  if(!leafMap)return;
  ensureSnaps();
  leafPolys.forEach(function(p){try{leafMap.removeLayer(p);}catch(e){}}); leafPolys=[];
  var pts=[];
  S.drives.forEach(function(d){
    displaySections(d).forEach(function(s){
      if(s.length<2)return;
      var path=s.map(function(p){return [p.lat,p.lng];});
      path.forEach(function(pt){pts.push(pt);});
      leafPolys.push(L.polyline(path,{color:accentHex(),weight:4,opacity:.9}).addTo(leafMap));
    });
  });
  $("mapChip").textContent=anySnapped()?"軌跡（吸着済み）":"日本全国";
  if(pts.length&&!leafFitted){ try{leafMap.fitBounds(pts,{padding:[18,18]}); leafFitted=true; }catch(e){} }
  drawLeafLive();
}
function drawLeafLive(){
  if(!leafMap)return;
  if(leafLive){leafLive.forEach(function(p){try{leafMap.removeLayer(p);}catch(e){}}); leafLive=null;}
  if(!S.rec.active)return;
  leafLive=[];
  S.rec.sections.forEach(function(s){
    if(s.length<2)return;
    leafLive.push(L.polyline(s.map(function(p){return [p.lat,p.lng];}),{color:accentHex(),weight:5,opacity:1}).addTo(leafMap));
  });
  var secs=S.rec.sections,last=secs[secs.length-1];
  if(last&&last.length){var lp=last[last.length-1]; try{leafMap.panTo([lp.lat,lp.lng]);}catch(e){}}
}
/* ================= 軌跡の吸着（自前Valhalla trace_route） =================
   記録データは生GPSのまま保持し、表示用にだけ吸着済み形状を取得する。
   吸着サーバーURLが未設定・通信失敗・エラー時は生軌跡表示にフォールバックする。 */
var snapCache={}, snapState={};
function snapEndpoint(){
  var u=String(S.settings.snapUrl||"").trim().replace(/\/+$/,"");
  if(!u)return "";
  return /\/trace_route$/.test(u)?u:u+"/trace_route";
}
function decodePolyline6(str){
  var index=0, lat=0, lng=0, coords=[], shift, result, byte, dLat, dLng, factor=1000000;
  while(index<str.length){
    shift=0; result=0;
    do{ byte=str.charCodeAt(index++)-63; result|=(byte&0x1f)<<shift; shift+=5; }while(byte>=0x20);
    dLat=(result&1)?~(result>>1):(result>>1);
    shift=0; result=0;
    do{ byte=str.charCodeAt(index++)-63; result|=(byte&0x1f)<<shift; shift+=5; }while(byte>=0x20);
    dLng=(result&1)?~(result>>1):(result>>1);
    lat+=dLat; lng+=dLng;
    coords.push({lat:lat/factor,lng:lng/factor});
  }
  return coords;
}
function driveShapeKey(d){var n=0;(d.sections||[]).forEach(function(s){n+=s.length;});return d.id+":"+n;}
function displaySections(d){
  var c=snapCache[driveShapeKey(d)];
  if(c)return c;
  return (d.sections||[]).filter(function(s){return s.length>1;});
}
function anySnapped(){for(var k in snapCache)return true;return false;}
function snapSection(ep,sec){
  var pts=sec;
  if(pts.length>400){
    var step=Math.ceil(pts.length/400), smp=[], i;
    for(i=0;i<pts.length;i+=step)smp.push(pts[i]);
    if(smp[smp.length-1]!==pts[pts.length-1])smp.push(pts[pts.length-1]);
    pts=smp;
  }
  var t0=pts[0].t||0;
  var shape=pts.map(function(p){
    var o={lat:p.lat,lon:p.lng};
    if(p.t)o.time=Math.max(0,Math.round((p.t-t0)/1000));
    return o;
  });
  return fetch(ep,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shape:shape,costing:"auto",shape_match:"map_snap"})})
    .then(function(r){if(!r.ok)throw new Error("http "+r.status);return r.json();})
    .then(function(j){
      var legs=(j.trip&&j.trip.legs)||[], out=[];
      legs.forEach(function(l){if(l.shape)decodePolyline6(l.shape).forEach(function(c){out.push(c);});});
      return out.length>1?out:null;
    })
    .catch(function(){return null;});
}
function ensureSnaps(){
  var ep=snapEndpoint(); if(!ep||typeof fetch!=="function")return;
  S.drives.forEach(function(d){
    var key=driveShapeKey(d);
    if(snapCache[key]||snapState[key])return;
    var secs=(d.sections||[]).filter(function(s){return s.length>1;});
    if(!secs.length)return;
    snapState[key]="pending";
    Promise.all(secs.map(function(s){return snapSection(ep,s);})).then(function(res){
      if(res.length&&res.every(function(r){return r&&r.length>1;})){snapCache[key]=res;snapState[key]="ok";}
      else snapState[key]="fail";
      drawFallbackMap(); drawLeafAll();
    });
  });
}

/* ================= 設定セクションの折りたたみ =================
   各 .dsec の見出しをタップで開閉できるアコーディオンに変換する。
   初期状態は「車両」だけ開き、他は閉じる（開閉はセッション内のみ保持）。 */
function initCollapsibleSettings(){
  document.querySelectorAll("#drawer .dsec").forEach(function(sec,idx){
    var h=sec.querySelector(":scope > h3");
    if(!h)return;
    var title=h.textContent;
    var head=document.createElement("button");
    head.type="button"; head.className="dsecHead";
    var open=idx===0;
    head.setAttribute("aria-expanded",String(open));
    head.innerHTML='<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    head.querySelector("span").textContent=title;
    var body=document.createElement("div"); body.className="dsecBody";
    var inner=document.createElement("div"); inner.className="dsecInner";
    var nodes=[];
    for(var i=0;i<sec.childNodes.length;i++){ if(sec.childNodes[i]!==h)nodes.push(sec.childNodes[i]); }
    sec.replaceChild(head,h);
    nodes.forEach(function(n){inner.appendChild(n);});
    body.appendChild(inner); sec.appendChild(body);
    function apply(){
      sec.classList.toggle("collapsed",!open);
      head.setAttribute("aria-expanded",String(open));
      body.setAttribute("aria-hidden",String(!open));
      try{ inner.inert=!open; }catch(e){}
    }
    head.addEventListener("click",function(){ open=!open; apply(); });
    apply();
  });
}

/* ================= wiring ================= */
function wire(){
  initCollapsibleSettings();
  initTabBar();
  $("scrim").addEventListener("click",closeDrawer);
  $("menuBtn").addEventListener("click",function(){
    if(window.__ddEnd&&Date.now()-window.__ddEnd<450)return;
    if(S.drawerOpen)closeDrawer(); else openDrawer();
  });
  document.querySelectorAll("[data-close]").forEach(function(b){b.addEventListener("click",requestCloseSheet);});
  document.querySelectorAll(".sheetWrap").forEach(function(w){
    w.querySelector(".bk").addEventListener("click",requestCloseSheet);
  });
  initSheetGestures();
  $("cfSave").addEventListener("click",function(){$("confirmWrap").classList.remove("on");saveMaint();});
  $("cfDiscard").addEventListener("click",function(){$("confirmWrap").classList.remove("on");closeSheet();});
  $("cfCancel").addEventListener("click",function(){$("confirmWrap").classList.remove("on");});
  $("fabAdd").addEventListener("click",function(){openMaintSheet(null);});
  $("btnGaugeAdd").addEventListener("click",function(){openMaintSheet(null);});
  $("btnOdoSave").addEventListener("click",function(){
    var v=parseInt($("odoInput").value,10); if(isNaN(v)||v<0){toast("数値を入力してください");return;}
    S.settings.odometer=v; S.settings.odoSet=true; $("setOdo").value=v; saveSettings(); closeSheet(); renderHome(); toast("保存しました");
  });
  $("btnOdoQuick").addEventListener("click",function(){
    var v=parseInt($("odoQuickInput").value,10); if(isNaN(v)||v<0){toast("オドメーターの数値を入力してください");return;}
    S.settings.odometer=v; S.settings.odoSet=true; $("setOdo").value=v; $("odoQuickInput").value=""; saveSettings(); renderHome(); toast("オドメーターを更新しました");
  });
  $("btnOdoFold").addEventListener("click",function(){
    var body=$("odoFoldBody"), open=body.classList.toggle("open");
    this.classList.toggle("open",open); this.setAttribute("aria-expanded",String(open));
    if(open){var inp=$("odoQuickInput"); if(inp)setTimeout(function(){try{inp.focus();}catch(e){}},80);}
  });
  $("btnIndReset").addEventListener("click",function(){
    var t=S.indicatorTarget; if(!t)return;
    if(!S.settings.indicatorBase)S.settings.indicatorBase={};
    var now=Date.now(), odo=S.settings.odometer||0;
    S.settings.indicatorBase[t]={odo:odo,ts:now};
    /* 「交換した」確定時のみ、整備履歴へ1件追加する（項目名・日付・走行距離・銘柄・金額）。
       履歴側の操作でインジケーターが変わることはない（連動はこの一方向だけ） */
    var rec={id:uid(),type:t,interval:intervalFor(t),odo:odo,ts:now,
      cost:parseInt($("indCost").value,10)||0,memo:"",brand:$("indBrand").value.trim()};
    S.maint.push(rec); putRec("maint",rec);
    saveSettings(); closeSheet(); renderHome(); renderMaintList(); toast(t+" をリセットし、整備履歴に追加しました");
  });
  $("btnIndShakenSave").addEventListener("click",function(){
    var v=$("indShakenDate").value; if(!v){toast("年月日を選択してください");return;}
    S.settings.shakenDate=v; saveSettings(); closeSheet(); renderHome(); toast("車検の日付を設定しました");
  });
  function bindGpsToggle(el){
    if(!el)return;
    el.addEventListener("click",function(){
      S.settings.gpsAdd=!S.settings.gpsAdd; saveSettings(); applyTheme();
      toast(S.settings.gpsAdd?"GPS加算をオンにしました":"GPS加算をオフにしました");
    });
  }
  bindGpsToggle($("tglGpsAdd")); bindGpsToggle($("tglGpsAddDrawer"));
  $("mType").addEventListener("change",function(){
    $("mInterval").value=currentInterval($("mType").value);
    updateMaintBaseNote();
  });
  $("btnMaintSave").addEventListener("click",saveMaint);
  $("btnMaintDelete").addEventListener("click",function(){
    if(!S.editingMaint)return;
    delRec("maint",S.editingMaint);
    S.maint=S.maint.filter(function(r){return r.id!==S.editingMaint;});
    closeSheet(); renderHome(); renderMaintList(); toast("削除しました");
  });
  $("btnRecStart").addEventListener("click",startRec);
  $("btnRecStop").addEventListener("click",function(){stopRec(true);});
  $("btnRecDiscard").addEventListener("click",function(){stopRec(false);});
  $("btnDriveSave").addEventListener("click",function(){
    var d=currentDriveRec(); if(!d)return;
    d.memo=$("dMemo").value.trim();
    if(S.drivePhotoDraft!==undefined)d.photo=S.drivePhotoDraft;
    putRec("drives",d); closeSheet(); renderDriveList(); renderHome(); toast("保存しました");
  });
  $("btnDriveDelete").addEventListener("click",function(){
    if(!S.editingDrive)return;
    delRec("drives",S.editingDrive);
    S.drives=S.drives.filter(function(d){return d.id!==S.editingDrive;});
    closeSheet(); renderDriveList(); renderHome(); drawFallbackMap(); drawLeafAll(); toast("削除しました");
  });
  $("btnDrivePhoto").addEventListener("click",function(){$("fileDrivePhoto").click();});
  $("fileDrivePhoto").addEventListener("change",function(){
    var f=this.files[0]; if(!f)return;
    readImageFile(f,function(url){S.drivePhotoDraft=url;$("dPhotoBox").innerHTML='<img src="'+url+'" alt="走行写真">';});
    this.value="";
  });
  /* settings */
  $("setCarName").addEventListener("change",function(){S.settings.carName=this.value.trim();saveSettings();applyTheme();renderHome();});
  $("setOdo").addEventListener("change",function(){var v=parseInt(this.value,10);if(!isNaN(v)&&v>=0){S.settings.odometer=v;S.settings.odoSet=true;saveSettings();renderHome();}});
  [["setHeroKicker","heroKicker"],["setHeroModel","heroModel"],["setHeroBadge","heroBadge"],["setHeroYear","heroYear"],["setSpecChips","specChips"]].forEach(function(pair){
    $(pair[0]).addEventListener("change",function(){S.settings[pair[1]]=this.value.trim();saveSettings();applyTheme();});
  });
  $("mapThemeSeg").querySelectorAll("button").forEach(function(b){
    b.addEventListener("click",function(){
      S.settings.mapTheme=b.getAttribute("data-mt"); saveSettings(); applyTheme(); refreshLeafBase(); drawFallbackMap();
    });
  });
  $("setSnapUrl").addEventListener("change",function(){
    S.settings.snapUrl=this.value.trim(); saveSettings();
    snapCache={}; snapState={};
    drawFallbackMap(); drawLeafAll();
    toast(S.settings.snapUrl?"吸着サーバーURLを保存しました":"吸着サーバーURLを消しました");
  });
  $("btnDebugAdd").addEventListener("click",function(){
    var v=parseFloat($("setDebugKm").value);
    if(isNaN(v)||v<=0){toast("今日走った距離を入力してください");return;}
    S.settings.odometer=Math.round(((S.settings.odometer||0)+v)*10)/10;
    S.settings.odoSet=true; saveSettings();
    $("setOdo").value=S.settings.odometer; $("setDebugKm").value="";
    renderHome(); toast(v+" km をオドメーターに加算しました");
  });
  $("btnBgUpload").addEventListener("click",function(){$("fileBg").click();});
  $("btnHeroUpload").addEventListener("click",function(){$("fileHero").click();});
  $("fileBg").addEventListener("change",function(){
    var f=this.files[0]; if(!f)return;
    readImageFile(f,function(url){S.customBg=url;kvSet("customBg",url);S.settings.bg="customBg";saveSettings();buildThumbGrid("bgGrid","bg");applyTheme();toast("背景を設定しました");});
    this.value="";
  });
  $("fileHero").addEventListener("change",function(){
    var f=this.files[0]; if(!f)return;
    readImageFile(f,function(url){S.customHero=url;kvSet("customHero",url);S.settings.hero="customHero";saveSettings();buildThumbGrid("heroGrid","hero");applyTheme();toast("ヒーロー画像を設定しました");});
    this.value="";
  });
  $("btnWipe").addEventListener("click",function(){
    if(this.getAttribute("data-arm")){ 
      clearStore("maint");clearStore("drives");kvSet("settings",null);kvSet("customBg",null);kvSet("customHero",null);
      S.maint=[];S.drives=[];S.customBg=null;S.customHero=null;
      S.settings={carName:"NCロードスター",odometer:0,odoSet:false,gpsAdd:true,heroKicker:"ROADSTER",heroModel:"NC3",heroBadge:"RS",heroYear:"2013",specChips:"後期 NC3,RS,ホワイト,黒幌",accent:"mono",bg:"car",hero:"car",mapTheme:"light",snapUrl:"",intervals:{},indicatorBase:{},shakenDate:""};
      buildSettingsUI();applyTheme();renderHome();renderMaintList();renderDriveList();drawFallbackMap();
      this.removeAttribute("data-arm");this.textContent="すべてのデータを削除";toast("削除しました");
    }else{this.setAttribute("data-arm","1");this.textContent="もう一度押すと削除します";
      var b=this;setTimeout(function(){b.removeAttribute("data-arm");b.textContent="すべてのデータを削除";},3500);}
  });
  $("dlgSave").addEventListener("click",function(){
    var d=window.__pendingRec; if(d){d.status="done";d.endedAt=d.endedAt||Date.now();putRec("drives",d);}
    $("dialogWrap").classList.remove("on"); window.__pendingRec=null;
    renderHome(); renderDriveList(); drawFallbackMap(); drawLeafAll();
  });
  $("dlgDiscard").addEventListener("click",function(){
    var d=window.__pendingRec; if(d){delRec("drives",d.id);S.drives=S.drives.filter(function(x){return x.id!==d.id;});}
    $("dialogWrap").classList.remove("on"); window.__pendingRec=null;
    renderHome(); renderDriveList(); drawFallbackMap();
  });
  window.addEventListener("resize",function(){drawFallbackMap();});
}

/* ================= init ================= */
/* 上端の黒帯対策: viewport-fit=cover は付けない（付けるとレイアウトビューポートが縮んで
   下端の帯が再発する）。代わりに standalone 表示のときだけ「画面の高さ − レイアウト
   ビューポートの高さ」＝ステータスバー分の帯の高さを実測して --topgap に入れる。
   CSS 側では背景レイヤー（#bg/#bgShade）とそれに追随する面（ドロワー／スクリム／シート背景）
   だけが --topgap 分だけ上へ広がり、コンテンツの配置は一切変わらない。
   ブラウザ表示・横向き・非standalone では 0 のまま＝従来通り */
function measureTopGap(){
  var gap=0;
  try{
    var ua=window.navigator.userAgent||"";
    var sa=(window.navigator.standalone===true)||(!!(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)&&/iPhone|iPad|iPod/.test(ua));
    if(sa&&window.innerWidth<window.innerHeight){
      var g=(window.screen.height||0)-window.innerHeight;
      if(g>0&&g<160)gap=Math.round(g);
    }
  }catch(e){}
  document.documentElement.style.setProperty("--topgap",gap+"px");
}
function init(){
  measureTopGap();
  window.addEventListener("orientationchange",function(){setTimeout(measureTopGap,350);});
  wire();
  Promise.all([kvGet("settings"),kvGet("customBg"),kvGet("customHero"),allRecs("maint"),allRecs("drives")]).then(function(r){
    if(r[0])S.settings=Object.assign(S.settings,r[0]);
    delete S.settings.apiKey; /* 旧Google APIキーは使わない */
    if(!S.settings.intervals||typeof S.settings.intervals!=="object")S.settings.intervals={};
    if(!S.settings.indicatorBase||typeof S.settings.indicatorBase!=="object")S.settings.indicatorBase={};
    if(typeof S.settings.shakenDate!=="string")S.settings.shakenDate="";
    if(S.settings.gpsAdd===undefined)S.settings.gpsAdd=true;
    if(r[0]&&r[0].odoSet===undefined&&S.settings.odometer>0)S.settings.odoSet=true;
    S.customBg=r[1]||null; S.customHero=r[2]||null;
    S.maint=r[3]||[]; S.drives=r[4]||[];
    S.maint.forEach(function(rec){ if(rec.type==="タイヤローテーション"){rec.type="タイヤ"; putRec("maint",rec);} });
    buildSettingsUI(); applyTheme();
    renderHome(); renderMaintList(); renderDriveList(); updateRecUI();
    resizeFallback(); drawFallbackMap();
    var pending=S.drives.filter(function(d){return d.status==="recording";})[0];
    if(pending){
      window.__pendingRec=pending;
      $("dlgText").textContent=fmtDateTime(pending.startedAt)+" 開始 ・ "+fmtKm(pending.distance||0)+" の走行が未完了です。";
      $("dialogWrap").classList.add("on");
    }
  });
}
document.addEventListener("DOMContentLoaded",init);

;

/* Service Worker: GitHub Pages 上でのみ登録する（プレビュー等 sw.js が無い環境では登録しない）。
   更新版が有効化されたら1回だけ自動リロードして最新化する。初回登録時はリロードしない。 */
(function(){
  if(location.hostname!=="cope499.github.io")return;
  if(!("serviceWorker" in navigator))return;
  var hadController=!!navigator.serviceWorker.controller;
  var refreshing=false;
  navigator.serviceWorker.addEventListener("controllerchange",function(){
    if(!hadController)return;
    if(refreshing)return;
    refreshing=true;
    location.reload();
  });
  function registerSW(){
    try{
      var p=navigator.serviceWorker.register("sw.js");
      if(p&&typeof p.catch==="function")p.catch(function(){});
    }catch(e){}
  }
  try{
    if(document.readyState==="complete"){registerSW();}
    else{window.addEventListener("load",registerSW);}
  }catch(e){}
})();
