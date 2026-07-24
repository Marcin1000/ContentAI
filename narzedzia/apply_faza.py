#!/usr/bin/env python3
# Reskin: Faza 1 (fix migania) + Faza 2 (odliczanie wyniku, pasek postepu, pop slow, wejscia widokow,
# fix pozycji paneli, F11 fix luk w zrodle) + Faza 3 (krotki splash raz na sesje).
# Append-only wzgledem logiki; splash wstawiany tuz po <body> (bez mignięcia).
import sys, re
SRC='/home/claude/out/ContentAI_pakowanie/zrodlo/web-keys.html'
OUT='/home/claude/proj/ContentAI_Showcase/ContentAI_faza2.html'
# branding splasha: 'odbrand' = czasteczki bursztyn+cyan (ciemne tlo), 'dhl' = tradycyjny (zolte tlo DHL,
# oficjalne logo DHL, wordmark Content AI 1:1 z aplikacja, pasek czerwony, bez czastek)
SPLASH='odbrand'
html=open(SRC,encoding='utf-8').read()

SPLASH_HEAD_ODBRAND=r'''<style id="cin-splash-css">
  #cin-splash{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px;transition:opacity .5s ease;overflow:hidden;
    background:#07080D;}
  #cin-splash.hide{opacity:0;pointer-events:none}
  #cin-splash-cv{position:absolute;inset:0;width:100%;height:100%;z-index:1}
  #cin-splash .cin-splash-logo,#cin-splash .cin-splash-bar{position:relative;z-index:2}
  .cin-splash-logo{display:flex;align-items:center;gap:14px;font-family:'IBM Plex Mono',ui-monospace,monospace;text-transform:uppercase}
  .cin-splash-mark{color:var(--accent,#F6A623);display:inline-flex;line-height:0;filter:drop-shadow(0 0 14px rgba(245,163,0,.6));animation:cinSpark 2.4s ease-in-out infinite}
  .cin-splash-mark svg{width:38px;height:38px;display:block}
  .cin-splash-word{font-size:22px;font-weight:600;letter-spacing:.24em;color:#ECEBE6}
  .cin-splash-word b{color:var(--accent,#F6A623);font-weight:700;margin-left:.16em}
  .cin-splash-bar{width:160px;height:3px;border-radius:3px;background:rgba(255,255,255,.10);overflow:hidden}
  .cin-splash-fill{height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,var(--accent,#F6A623),#35E0D0);animation:cinSplashBar 1.6s ease-out forwards}
  @keyframes cinSpark{0%,100%{transform:rotate(0) scale(1)}50%{transform:rotate(90deg) scale(1.12)}}
  @keyframes cinSplashBar{to{width:100%}}
  @media (prefers-reduced-motion:reduce){.cin-splash-mark,.cin-splash-fill{animation:none}}
</style>
<div id="cin-splash" aria-hidden="true">
  <canvas id="cin-splash-cv"></canvas>
  <div class="cin-splash-logo">
    <span class="cin-splash-mark"><svg viewBox="0 0 32 32"><path d="M16 1.5 L18.4 13.6 L30.5 16 L18.4 18.4 L16 30.5 L13.6 18.4 L1.5 16 L13.6 13.6 Z" fill="currentColor"/><circle cx="16" cy="16" r="1.7" fill="#07080D"/></svg></span>
    <span class="cin-splash-word">CONTENT<b>AI</b></span>
  </div>
  <div class="cin-splash-bar"><div class="cin-splash-fill"></div></div>
</div>
'''

# Wariant DHL: bez <canvas> (splash JS pomija czastki przez if(cv)); logo i wordmark 1:1 z topbarem aplikacji DHL.
# Font 'DM Sans' jest juz ladowany w <head> aplikacji DHL, wiec wordmark dziedziczy dokladny krój.
SPLASH_HEAD_DHL=r'''<style id="cin-splash-css">
  #cin-splash{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:26px;transition:opacity .5s ease;overflow:hidden;
    background:#FFCC00;}
  #cin-splash.hide{opacity:0;pointer-events:none}
  #cin-splash .cin-splash-logo,#cin-splash .cin-splash-word,#cin-splash .cin-splash-bar{position:relative;z-index:2}
  .cin-splash-logo svg{height:52px;width:auto;display:block}
  .cin-splash-word{font-family:'DM Sans',system-ui,sans-serif;color:#D40511;font-size:30px;font-weight:500;letter-spacing:.01em}
  .cin-splash-word b{font-weight:700}
  .cin-splash-bar{width:230px;height:5px;border-radius:999px;background:rgba(212,5,17,.16);overflow:hidden}
  .cin-splash-fill{height:100%;width:0;border-radius:999px;background:#D40511;animation:cinSplashBar 1.6s ease-out forwards}
  @keyframes cinSplashBar{to{width:100%}}
  @media (prefers-reduced-motion:reduce){.cin-splash-fill{animation:none}}
</style>
<div id="cin-splash" aria-hidden="true">
  <div class="cin-splash-logo"><svg viewBox="0 0 900 127.278" xmlns="http://www.w3.org/2000/svg"><path fill="#D40511" d="M0,101.4813h121.7104l-6.6478,9.0474H0v-9.0474h0ZM0,84.6949v9.035h127.4155l6.6599-9.035H0ZM0,118.2802v8.9854h102.7347l6.6183-8.9854H0ZM900,110.5288v-9.0412h-114.5914l-6.6443,9.0412h121.2357ZM900,127.2656v-8.9854h-126.9472l-6.6164,8.9978,133.5636-.0124h0ZM797.7644,84.6949l-6.6507,9.0474,108.8862-.0063v-9.0411h-102.2356ZM117.8842,127.2656h140.8362c46.509,0,72.4096-31.6319,80.3951-42.5707h-96.0157c-12.1777,0-8.5017-5.0044-6.4694-7.7514,4.0043-5.4073,10.6953-14.5665,14.6269-19.8931,3.8713-5.2463,3.9751-8.254-3.9468-8.254h-71.6702l-57.7561,78.4691h0ZM448.6481,84.6886l-82.6039.0063c-.0279,0-31.3315,42.5707-31.3315,42.5707h82.6182l31.3172-42.577h0ZM568.1197,84.6949h-82.5871c-.0279,0-31.3344,42.5707-31.3344,42.5707h82.5871l31.3344-42.5707h0ZM594.9866,84.6949c.0029,0-6.0338,8.2537-8.9671,12.2162-10.3743,14.0207-1.2059,30.3545,32.6523,30.3545h132.6368l31.3284-42.5707h-187.6503ZM158.2739,0l-28.7547,39.0671h156.7141c7.9207,0,7.8168,3.0077,3.9456,8.2537-3.9316,5.3206-10.5124,14.5852-14.5167,19.9925-2.0326,2.741-5.7083,7.745,6.4694,7.745h64.0857s10.3295-14.0578,18.9881-25.809c11.7805-15.9863,1.0217-49.2492-41.0905-49.2492h-165.8409ZM575.214,75.0583L630.4542,0h-82.5779l-31.6912,43.0358h-36.8627L510.9885,0h-82.5903l-55.257,75.0583h202.0727ZM744.8347,0h-87.4709c-.0276,0-55.2926,75.0583-55.2926,75.0583h87.5172L744.8347,0h0Z"/></svg></div>
  <div class="cin-splash-word">Content <b>AI</b></div>
  <div class="cin-splash-bar"><div class="cin-splash-fill"></div></div>
</div>
'''

SPLASH_HEAD = SPLASH_HEAD_DHL if SPLASH=='dhl' else SPLASH_HEAD_ODBRAND

BLOCK=r'''
<!-- ============ Content AI - reskin (Faza 1 fix + Faza 2 + Faza 3 splash), append-only ============ -->
<style id="cin-reskin">
  @keyframes cinRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes cinField{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes cinPanelIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
  @keyframes cinPop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}

  #img-panel[style*="display: block"], #audio-panel[style*="display: block"]{animation:cinPanelIn .3s cubic-bezier(.2,.7,.2,1)}

  .btn-generate, .btn-module, .btn-premium, .btn-secondary{transition:transform .12s ease, box-shadow .2s ease, border-color .2s ease}
  .btn-generate:active, .btn-module:active, .btn-premium:active, .btn-secondary:active{transform:translateY(1px) scale(0.99)}

  .spinner{box-shadow:0 0 18px var(--glow-amber)}
  .cin-progress{width:190px;max-width:62vw;height:4px;border-radius:4px;background:rgba(255,255,255,0.09);overflow:hidden;margin-top:2px}
  .cin-progress-bar{height:100%;width:0;border-radius:4px;background:linear-gradient(90deg,var(--accent),#35E0D0);transition:width .5s cubic-bezier(.2,.7,.2,1)}

  /* panele oceny w tym samym miejscu (SEO/AIO/AEO/GEO) - desktop; mobile zostaje przy dole */
  body:not(.is-mobile) #seo-panel,
  body:not(.is-mobile) #aio-panel,
  body:not(.is-mobile) #aeo-panel,
  body:not(.is-mobile) #geo-panel{position:absolute;right:20px;left:auto;top:60px;width:290px}

  /* mobile: pusty stan i spinner wysrodkowane w pionie w polu wyniku */
  body.is-mobile #placeholder{min-height:52vh;height:auto}
  body.is-mobile #spinner{min-height:52vh}

  button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}

  @media (prefers-reduced-motion:reduce){
    #img-panel[style*="display: block"], #audio-panel[style*="display: block"]{animation:none}
    .btn-generate:active,.btn-module:active,.btn-premium:active,.btn-secondary:active{transform:none}
    .cin-progress-bar{transition:none}
  }
</style>
<script id="cin-splash-js">
(function(){
  var sp=document.getElementById('cin-splash'); if(!sp) return;
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  var seen=false; try{ seen=sessionStorage.getItem('cin_splash')==='1'; }catch(e){}
  if(seen||reduce){ sp.parentNode&&sp.parentNode.removeChild(sp); return; }
  try{ sessionStorage.setItem('cin_splash','1'); }catch(e){}

  var cv=document.getElementById('cin-splash-cv'), raf=null, running=true;
  if(cv){
    var ctx=cv.getContext('2d'), DPR=Math.min(window.devicePixelRatio||1,2), W,H,parts=[];
    function resize(){ W=cv.width=innerWidth*DPR; H=cv.height=innerHeight*DPR; }
    resize(); addEventListener('resize',resize,{passive:true});
    var N=innerWidth<760?95:150;
    for(var i=0;i<N;i++){
      parts.push({x:Math.random()*W, y:Math.random()*H,
        vx:(Math.random()-0.5)*0.16*DPR, vy:(Math.random()-0.5)*0.16*DPR,
        r:(Math.random()*0.9+0.4)*DPR, c:Math.random()<0.5?'246,166,35':'53,224,208',
        a:Math.random()*0.4+0.22, ph:Math.random()*6.28});
    }
    var t0=performance.now();
    function frame(now){
      if(!running) return;
      var t=(now-t0)/1000;
      ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation='lighter';
      for(var i=0;i<parts.length;i++){ var o=parts[i];
        o.x+=o.vx; o.y+=o.vy;
        if(o.x<0)o.x=W; else if(o.x>W)o.x=0;
        if(o.y<0)o.y=H; else if(o.y>H)o.y=0;
        var tw=o.a*(0.45+0.55*Math.sin(t*1.4+o.ph)), R=o.r*5;
        var g=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,R);
        g.addColorStop(0,'rgba('+o.c+','+tw+')'); g.addColorStop(1,'rgba('+o.c+',0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(o.x,o.y,R,0,6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation='source-over'; raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
  }
  function done(){ running=false; if(raf) cancelAnimationFrame(raf); sp.classList.add('hide');
    setTimeout(function(){ sp.parentNode&&sp.parentNode.removeChild(sp); },520); }
  sp.addEventListener('click', done);
  setTimeout(done, 1900);
})();
</script>
<script id="cin-reskin-js">
(function(){
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  if(reduce) return;
  var MODULE={image:1,audio:1};
  var last='generator';
  function anim(el,css){ if(el){ el.style.animation='none'; void el.offsetWidth; el.style.animation=css; } }
  function animateGen(){
    var p=document.getElementById('tab-generator'); anim(p,'cinRise .42s cubic-bezier(.2,.7,.2,1)');
    var fs=(p||document).querySelectorAll('.field');
    for(var i=0;i<fs.length;i++){ anim(fs[i],'cinField .4s cubic-bezier(.2,.7,.2,1) both'); fs[i].style.animationDelay=(0.02+i*0.04)+'s'; }
  }
  function animateHistory(){
    anim(document.getElementById('tab-history'),'cinRise .42s cubic-bezier(.2,.7,.2,1)');
    var items=document.querySelectorAll('#h-list-inner .h-item');
    for(var i=0;i<items.length && i<16;i++){ anim(items[i],'cinField .38s cubic-bezier(.2,.7,.2,1) both'); items[i].style.animationDelay=(0.02+i*0.03)+'s'; }
  }
  function onView(name){
    if(!MODULE[last]){ if(name==='generator') animateGen(); else if(name==='history') animateHistory(); }
    last=name;
  }
  var st=window.switchTab;
  if(typeof st==='function') window.switchTab=function(n){ st.apply(this,arguments); requestAnimationFrame(function(){ onView(n); }); };
  var smt=window.switchMobileTab;
  if(typeof smt==='function') window.switchMobileTab=function(n){ smt.apply(this,arguments); requestAnimationFrame(function(){ onView(n); }); };
  requestAnimationFrame(animateGen);

  /* odliczanie wyniku SEO/AIO/AEO/GEO */
  function countUp(el){
    if(!el || el.dataset.cinCounted) return;
    var target=parseInt(el.textContent,10); if(isNaN(target)){ return; }
    el.dataset.cinCounted='1'; var t0=performance.now(), dur=700; el.textContent='0';
    (function step(now){ var p=Math.min((now-t0)/dur,1), e=1-Math.pow(1-p,3);
      el.textContent=Math.round(target*e); if(p<1) requestAnimationFrame(step); else el.textContent=target; })(performance.now());
  }
  new MutationObserver(function(m){ for(var i=0;i<m.length;i++){ var a=m[i].addedNodes;
    for(var j=0;j<a.length;j++){ var n=a[j]; if(n.nodeType!==1) continue;
      if(n.classList&&n.classList.contains('seo-score-num')) countUp(n);
      if(n.querySelectorAll){ var q=n.querySelectorAll('.seo-score-num'); for(var k=0;k<q.length;k++) countUp(q[k]); } } }
  }).observe(document.body,{childList:true,subtree:true});

  /* pasek postepu generowania */
  var spinner=document.getElementById('spinner');
  if(spinner){
    var bar=document.createElement('div'); bar.className='cin-progress';
    var fill=document.createElement('div'); fill.className='cin-progress-bar'; bar.appendChild(fill); spinner.appendChild(bar);
    var prog=0, creep=null;
    function setBar(v){ prog=v; fill.style.width=v+'%'; }
    function startBar(){ setBar(0); requestAnimationFrame(function(){ setBar(8); }); clearInterval(creep);
      creep=setInterval(function(){ if(prog<90) setBar(prog+(90-prog)*0.08); },420); }
    function endBar(){ clearInterval(creep); setBar(100); setTimeout(function(){ fill.style.transition='none'; setBar(0); requestAnimationFrame(function(){ fill.style.transition=''; }); },500); }
    var visible=false;
    new MutationObserver(function(){ var vis=getComputedStyle(spinner).display!=='none';
      if(vis&&!visible){ visible=true; startBar(); if(document.body.classList.contains('is-mobile')){ try{ spinner.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} } } else if(!vis&&visible){ visible=false; endBar(); }
    }).observe(spinner,{attributes:true,attributeFilter:['style']});
    var lbl=document.getElementById('spin-label');
    if(lbl) new MutationObserver(function(){ if(visible&&prog<88) setBar(prog+7); }).observe(lbl,{childList:true,characterData:true,subtree:true});
  }

  /* pasek postepu generowania grafiki (obserwacja #img-spinner, jak dla tresci) */
  var imgSpin=document.getElementById('img-spinner');
  if(imgSpin){
    var ibar=document.createElement('div'); ibar.className='cin-progress'; ibar.style.margin='16px auto 0';
    var ifill=document.createElement('div'); ifill.className='cin-progress-bar'; ibar.appendChild(ifill); imgSpin.appendChild(ibar);
    var ip=0, icreep=null, ivis=false;
    function isetBar(v){ ip=v; ifill.style.width=v+'%'; }
    new MutationObserver(function(){
      var vis=getComputedStyle(imgSpin).display!=='none';
      if(vis&&!ivis){ ivis=true; isetBar(0); requestAnimationFrame(function(){ isetBar(6); }); clearInterval(icreep);
        icreep=setInterval(function(){ if(ip<92) isetBar(ip+(92-ip)*0.05); },500); }
      else if(!vis&&ivis){ ivis=false; clearInterval(icreep); isetBar(100);
        setTimeout(function(){ ifill.style.transition='none'; isetBar(0); requestAnimationFrame(function(){ ifill.style.transition=''; }); },500); }
    }).observe(imgSpin,{attributes:true,attributeFilter:['style']});
  }

  /* pop nowego slowa kluczowego */
  var kw=document.getElementById('kw-tags');
  if(kw){ var kwN=kw.children.length;
    new MutationObserver(function(){ var n=kw.children.length;
      if(n>kwN){ anim(kw.children[n-1],'cinPop .26s cubic-bezier(.2,.7,.2,1)'); } kwN=n;
    }).observe(kw,{childList:true}); }

  /* wejscie listy Bazy (mobile-sidebar) */
  var msb=document.getElementById('mobile-sidebar');
  if(msb){ var wasOpen=msb.classList.contains('open');
    new MutationObserver(function(){ var open=msb.classList.contains('open');
      if(open&&!wasOpen){ var items=msb.querySelectorAll('.kb-item');
        for(var i=0;i<items.length&&i<16;i++){ anim(items[i],'cinField .38s cubic-bezier(.2,.7,.2,1) both'); items[i].style.animationDelay=(0.02+i*0.03)+'s'; } }
      wasOpen=open;
    }).observe(msb,{attributes:true,attributeFilter:['class']}); }
})();
</script>
<!-- ============ koniec reskin ============ -->
'''

if SPLASH=='dhl':
    # reskin w kolorach DHL zamiast bursztyn+cyan (pasek postepu tresci/grafiki, poswiata spinnera, focus)
    BLOCK = (BLOCK
        .replace('var(--accent),#35E0D0', '#D40511,#FFCC00')
        .replace('var(--glow-amber)', 'rgba(212,5,17,.35)')
        .replace('var(--accent)', '#D40511'))

# splash po REALNYM <body> (dopiero po </head>; w <head> jest komentarz CSS z tekstem <body>)
he=html.find('</head>')
if he<0: sys.exit('brak </head>')
m=re.search(r'<body[^>]*>', html[he:])
if not m: sys.exit('brak <body> po </head>')
pos=he+m.end()
html=html[:pos]+'\n'+SPLASH_HEAD+html[pos:]

# reszta reskinu przed </body>
idx=html.rfind('</body>')
if idx<0: sys.exit('brak </body>')
open(OUT,'w',encoding='utf-8').write(html[:idx]+BLOCK+html[idx:])
print('ContentAI_faza2.html zapisana (Faza 1+2+3, F11 w zrodle)')
