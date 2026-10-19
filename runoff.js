(() => {
 'use strict';
 const OPEN=Date.parse('2026-10-25T17:00:00-03:00');
 const ROOT='https://resultados.tse.jus.br/oficial/ele2026/6258/dados/';
 const UFS='ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' ');
 const state={running:false,busy:false,mapBusy:false,finished:false,map:new Map(),complete:new Set(),
   national:null,first:[],firstUfs:{},tick:null,mapTimer:null};
 const $=id=>document.getElementById(id);
 const n=v=>Number(String(v??'0').replace(/\D/g,''))||0;
 const fmt=n=>n.toLocaleString('pt-BR');
 const pct=v=>{const x=Number(String(v??'').replace(',','.'));return v==null||v===''||!Number.isFinite(x)?'—':x.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'};
 const clean=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const name=c=>String(c?.nmu||c?.nm||'');
 const key=c=>clean(name(c)).includes('FLAVIO BOLSONARO')?'flavio':clean(name(c)).includes('LULA')?'lula':'other';
 const candidates=data=>Array.isArray(data?.cand)?data.cand:
   (data?.carg||[]).flatMap(c=>(c.agr||[]).flatMap(a=>(a.par||[]).flatMap(p=>p.cand||[])));
 const progress=data=>Number(String(data?.s?.pst??data?.pst??0).replace(',','.'));
 const resultUrl=uf=>ROOT+uf+'/'+uf+'-c0001-e006258-u.json';
 async function get(uf){
   const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),8000);
   try{const r=await fetch(resultUrl(uf),{cache:'no-cache',signal:ctl.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}
   finally{clearTimeout(timeout)}
 }
 function fillCard(who){
   const card=document.querySelector('[data-runoff="'+who+'"]');if(!card)return;
   const first=state.first.find(c=>clean(c.name).includes(who==='lula'?'LULA':'FLAVIO BOLSONARO'));
   const second=state.national?candidates(state.national).find(c=>key(c)===who):null;
   if(first){
     card.querySelector('h3').textContent=first.name;
     const img=card.querySelector('img');
     if(first.photo&&!img.src){img.src=first.photo;img.hidden=false}
     card.querySelector('.runoff-vice').textContent=first.vice?'Vice: '+first.vice:'';
     card.querySelector('.runoff-baseline b').textContent=pct(first.pct)+' • '+fmt(first.votes)+' votos';
   }
   card.querySelector('.runoff-percentage').textContent=second?pct(second.pvap):'—';
   card.querySelector('.runoff-votes').textContent=second?fmt(n(second.vap))+' votos':'Aguardando votos do 2º turno';
 }
 function refreshFirst(){
   state.first=window.__FIRST_ROUND_PRESIDENT__||[];
   state.firstUfs=window.__FIRST_ROUND_UFS__||{};
   fillCard('flavio');fillCard('lula');updateFlips();
 }
 function updateFlips(){
   let flipped=0,compared=0;
   for(const [uf,summary] of state.map){
     if(!summary.leader||!n(summary.leader.vap)||!state.firstUfs[uf]?.leader)continue;
     compared++;
     if(clean(name(summary.leader))!==clean(state.firstUfs[uf].leader))flipped++;
   }
   $('runoffFlips').textContent=compared?flipped+' de '+compared+' UFs':'—';
 }
 function redrawNational(d){
   state.national=d;fillCard('flavio');fillCard('lula');
   const cs=candidates(d).slice().sort((a,b)=>n(b.vap)-n(a.vap));
   $('runoffDiff').textContent=cs.length<2?'—':fmt(Math.abs(n(cs[0].vap)-n(cs[1].vap)))+' votos';
   $('runoffProgress').textContent=pct(progress(d));
   $('runoffBar').style.width=Math.max(0,Math.min(100,progress(d)||0))+'%';
   $('runoffStatus').textContent=progress(d)>=100?'100% totalizado':'Totalização oficial em andamento';
   $('runoffExplanation').textContent='Resultados oficiais do 2º turno. Compare a liderança de cada UF com o 1º turno pelo mapa.';
   state.finished=progress(d)>=100;
   window.__RUNOFF_NATIONAL__=d;
   window.__RUNOFF_LAST_AT__=Date.now();
   window.dispatchEvent(new Event('runoffDataUpdated'));
 }
 async function fetchNational(){
   if(!state.running||state.busy||state.finished||document.hidden)return;
   state.busy=true;
   try{redrawNational(await get('br'))}
   catch(e){$('runoffStatus').textContent='Aguardando divulgação pelo TSE';console.warn('Segundo turno nacional',e)}
   finally{state.busy=false;checkFinish()}
 }
 function summary(d){
   const cs=candidates(d).sort((a,b)=>n(b.vap)-n(a.vap));
   return {leader:cs[0],second:cs[1],diff:Math.abs(n(cs[0]?.vap)-n(cs[1]?.vap)),
     progress:progress(d),timestamp:[d?.dt,d?.ht].filter(Boolean).join(' • ')||'Aguardando',
     totalElectors:d?.e?.te,remainingElectors:d?.e?.esnt,countedVotes:d?.v?.tv};
 }
 async function fetchMap(){
   if(!state.running||state.mapBusy||document.hidden)return;
   const pending=UFS.filter(uf=>!state.complete.has(uf));
   if(!pending.length){checkFinish();return}
   state.mapBusy=true;
   try{
     const results=await Promise.allSettled(pending.map(get));
     let changed=false;
     results.forEach((r,i)=>{
       if(r.status!=='fulfilled')return;
       const uf=pending[i],s=summary(r.value);
       const old=state.map.get(uf);
       if(!old||old.progress!==s.progress||n(old.leader?.vap)!==n(s.leader?.vap)){
         state.map.set(uf,s);changed=true;
       }
       if(s.progress>=100)state.complete.add(uf);
     });
     if(changed){
       window.__RUNOFF_UFS__=Object.fromEntries(state.map);
       window.dispatchEvent(new Event('runoffDataUpdated'));
       updateFlips();
     }
   }finally{state.mapBusy=false;checkFinish()}
 }
 function stop(){
   clearInterval(state.tick);clearInterval(state.mapTimer);
   state.tick=null;state.mapTimer=null;state.running=false;
 }
 function checkFinish(){
   if(state.finished&&state.complete.size===27){
     stop();$('runoffStatus').textContent='Apuração encerrada • sem novas consultas';
   }
 }
 function start(){
   if(state.running||document.hidden||state.finished&&state.complete.size===27)return;
   state.running=true;
   window.__RUNOFF_STARTED__=true;
   window.dispatchEvent(new Event('runoffStarted'));
   $('runoffStatus').textContent='Aguardando publicação dos resultados';
   fetchNational();fetchMap();
   state.tick=setInterval(fetchNational,1000);
   state.mapTimer=setInterval(fetchMap,2000);
 }
 function countdown(){
   const ms=OPEN-Date.now();
   if(ms<=0){
     $('runoffCountdown').textContent=state.finished?'Totalização concluída':'Dia do 2º turno';
     if(!state.running&&!document.hidden&&!state.finished)start();
     return;
   }
   const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),minutes=Math.floor(ms%3600000/60000);
   $('runoffCountdown').textContent=days+'d '+String(hours).padStart(2,'0')+'h '+String(minutes).padStart(2,'0')+'min';
 }
 refreshFirst();countdown();
 addEventListener('firstRoundDataReady',refreshFirst);
 addEventListener('firstRoundMapUpdated',refreshFirst);
 setInterval(countdown,1000);
 document.addEventListener('visibilitychange',()=>{
   if(document.hidden)stop();
   else if(Date.now()>=OPEN)start();
   else refreshFirst();
 });
})();