/* FantaAsta2.0 — Strategy Engine A8.0.0
   Usa esclusivamente FVM, quotazione, ruoli e anagrafica presenti nel
   Listone scelto manualmente dall'utente, più i parametri d'asta. */
(function(){
  const ENGINE_VERSION="A8.0.0";
  const STORAGE_KEY="fa2_strategy_v2";
  const LEGACY_KEY="fa2_strategy_v1";
  const MODULES=[
    {id:"343",name:"3-4-3",slots:[["Por"],["Dc"],["Dc"],["Dc","B"],["E"],["M","C"],["C"],["E"],["W","A"],["A","Pc"],["W","A"]]},
    {id:"3412",name:"3-4-1-2",slots:[["Por"],["Dc"],["Dc"],["Dc","B"],["E"],["M","C"],["C"],["E"],["T"],["A","Pc"],["A","Pc"]]},
    {id:"3421",name:"3-4-2-1",slots:[["Por"],["Dc"],["Dc"],["Dc","B"],["M"],["M","C"],["E","W"],["E"],["T"],["T","A"],["A","Pc"]]},
    {id:"352",name:"3-5-2",slots:[["Por"],["Dc"],["Dc"],["Dc","B"],["E","W"],["M","C"],["M"],["C"],["E"],["A","Pc"],["A","Pc"]]},
    {id:"3511",name:"3-5-1-1",slots:[["Por"],["Dc"],["Dc"],["Dc","B"],["E","W"],["M"],["M"],["C"],["E","W"],["T","A"],["A","Pc"]]},
    {id:"433",name:"4-3-3",slots:[["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["M"],["C"],["W","A"],["A","Pc"],["W","A"]]},
    {id:"4312",name:"4-3-1-2",slots:[["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["M"],["C"],["T"],["T","A","Pc"],["A","Pc"]]},
    {id:"442",name:"4-4-2",slots:[["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["C"],["E","W"],["E"],["A","Pc"],["A","Pc"]]},
    {id:"4141",name:"4-1-4-1",slots:[["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["C","T"],["T"],["E","W"],["W"],["A","Pc"]]},
    {id:"4411",name:"4-4-1-1",slots:[["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["C"],["E","W"],["E","W"],["T","A"],["A","Pc"]]},
    {id:"4231",name:"4-2-3-1",slots:[["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["M","C"],["W","T"],["T"],["W","A"],["A","Pc"]]}
  ];
  const DEFAULT_PROFILE={schema:2,mode:"mono",scope:"full",primary:"433",secondary:"4231",autoTopN:2,lastGeneratedAt:0};
  const ROLE_MACRO={Por:"POR",Dd:"DIF",Ds:"DIF",Dc:"DIF",B:"DIF",E:"CEN",M:"CEN",C:"CEN",W:"ATT",T:"ATT",A:"ATT",Pc:"ATT"};
  const D_FACTOR_ROLES=new Set(["Dc","B","Dd","Ds","E","M"]);
  const SLOT_STATES=Object.freeze({
    OPEN:"OPEN",
    TARGET_ACTIVE:"TARGET_ACTIVE",
    PROMOTED:"PROMOTED",
    COVERED:"COVERED",
    LOST_EXHAUSTED:"LOST_EXHAUSTED"
  });
  const SLOT_PLAYER_STATES=Object.freeze({
    AVAILABLE:"AVAILABLE",
    OWNED:"OWNED",
    LOST:"LOST",
    MISSING:"MISSING"
  });
  const SLOT_STATE_LABELS=Object.freeze({
    [SLOT_STATES.OPEN]:"APERTO",
    [SLOT_STATES.TARGET_ACTIVE]:"TARGET ATTIVO",
    [SLOT_STATES.PROMOTED]:"PROMOSSO",
    [SLOT_STATES.COVERED]:"COPERTO",
    [SLOT_STATES.LOST_EXHAUSTED]:"PERSO / ESAURITO"
  });
  const clone=v=>JSON.parse(JSON.stringify(v));
  const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
  const round=v=>Math.round(Number(v)||0);

  /* Alpha 3.6 — fonte unica dello stato slot.
     Il motore riceve soltanto Piano Strategia + stato mercato corrente:
     non salva copie dello stato e resta quindi compatibile con i piani A3.4/A3.5. */
  function uniqueSlotCandidates(slot){
    const rows=[slot?.target,...(slot?.alternatives||[]),...(slot?.values||[])].filter(x=>x&&String(x.id??""));
    const seen=new Set();
    return rows.filter(x=>{const id=String(x.id);if(seen.has(id))return false;seen.add(id);return true});
  }
  function resolveSlotState(slot,playerStateFor,key=slot?.key||""){
    const stateFor=typeof playerStateFor==="function"?playerStateFor:()=>SLOT_PLAYER_STATES.MISSING;
    const originalTarget=slot?.target||null,ordered=uniqueSlotCandidates(slot);
    const candidateStates=ordered.map(candidate=>({candidate,state:stateFor(String(candidate.id))||SLOT_PLAYER_STATES.MISSING}));
    const owned=candidateStates.find(x=>x.state===SLOT_PLAYER_STATES.OWNED);
    const base={key:key||slot?.key||"",slot:slot||{},originalTarget,candidateStates};
    if(owned){
      return {...base,state:SLOT_STATES.COVERED,stateLabel:SLOT_STATE_LABELS[SLOT_STATES.COVERED],covered:true,coveredBy:owned.candidate,current:null,alternatives:[],promoted:false};
    }
    if(!ordered.length){
      return {...base,state:SLOT_STATES.OPEN,stateLabel:SLOT_STATE_LABELS[SLOT_STATES.OPEN],covered:false,coveredBy:null,current:null,alternatives:[],promoted:false};
    }
    const available=candidateStates.filter(x=>x.state===SLOT_PLAYER_STATES.AVAILABLE).map(x=>x.candidate);
    if(!available.length){
      return {...base,state:SLOT_STATES.LOST_EXHAUSTED,stateLabel:SLOT_STATE_LABELS[SLOT_STATES.LOST_EXHAUSTED],covered:false,coveredBy:null,current:null,alternatives:[],promoted:false};
    }
    const current=available[0],promoted=!!originalTarget&&String(current.id)!==String(originalTarget.id);
    const state=promoted?SLOT_STATES.PROMOTED:SLOT_STATES.TARGET_ACTIVE;
    return {...base,state,stateLabel:SLOT_STATE_LABELS[state],covered:false,coveredBy:null,current,alternatives:available.slice(1,4),promoted};
  }
  function resolvePlanSlots(plan,playerStateFor){
    const stateFor=typeof playerStateFor==="function"?playerStateFor:()=>SLOT_PLAYER_STATES.MISSING;
    const claimedPlayers=new Set();
    const entries=Object.entries(plan?.slots||{}).map(([key,slot],index)=>({key,slot:slot||{},index}));
    // A3.7: uno stesso giocatore non può essere TARGET operativo o copertura
    // di due slot. Nei piani precedenti sovrapposti prevale lo slot più
    // prioritario; a parità resta stabile l'ordine già salvato nel piano.
    const ordered=entries.slice().sort((a,b)=>{
      const ap=Number(a.slot?.priority?.score??a.slot?.priorityScore)||0;
      const bp=Number(b.slot?.priority?.score??b.slot?.priorityScore)||0;
      return bp-ap||a.index-b.index;
    });
    const resolved=ordered.map(entry=>{
      const runtime=resolveSlotState(entry.slot,id=>{
        const state=stateFor(id)||SLOT_PLAYER_STATES.MISSING;
        return (state===SLOT_PLAYER_STATES.OWNED||state===SLOT_PLAYER_STATES.AVAILABLE)&&claimedPlayers.has(String(id))?SLOT_PLAYER_STATES.LOST:state;
      },entry.key);
      if(runtime.coveredBy)claimedPlayers.add(String(runtime.coveredBy.id));
      else if(runtime.current)claimedPlayers.add(String(runtime.current.id));
      return {...runtime,_planIndex:entry.index};
    });
    return resolved.sort((a,b)=>a._planIndex-b._planIndex).map(({_planIndex,...runtime})=>runtime);
  }

  /* A3.8 — Budget Runtime puro e non persistente.
     Distribuisce interi senza superare il budget disponibile e conserva il
     minimo per gli altri posti della rosa. */
  function allocateInteger(rows,total,minEach=0,weightFor=x=>x.weight){
    const count=rows.length,amount=Math.max(0,round(total)),minimum=Math.max(0,round(minEach));
    if(!count)return {};
    const floor=amount>=count*minimum?minimum:0,out={};
    rows.forEach(x=>{out[x.key]=floor});
    let left=amount-floor*count;
    if(left<=0)return out;
    let weights=rows.map((x,index)=>({key:x.key,index,weight:Math.max(0,Number(weightFor(x))||0)}));
    let weightTotal=weights.reduce((sum,x)=>sum+x.weight,0);
    if(weightTotal<=0){weights=weights.map(x=>({...x,weight:1}));weightTotal=weights.length}
    const shares=weights.map(x=>{
      const exact=left*x.weight/weightTotal,whole=Math.floor(exact);
      out[x.key]+=whole;
      return {...x,fraction:exact-whole};
    });
    let remainder=amount-Object.values(out).reduce((sum,x)=>sum+x,0);
    shares.sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
    for(let i=0;i<remainder;i++)out[shares[i%shares.length].key]++;
    return out;
  }
  function dynamicCandidateCap(candidate,slotBudget,maxNext=Infinity){
    const base=Math.max(1,Number(candidate?.maxRecommended||slotBudget?.baseCap)||1);
    const baseBudget=Math.max(1,Number(slotBudget?.baseBudget)||base);
    const dynamicBudget=Math.max(0,Number(slotBudget?.dynamicBudget)||0);
    const hardMax=Number.isFinite(Number(maxNext))?Math.max(0,Number(maxNext)):Infinity;
    if(dynamicBudget<=0||hardMax<=0)return 0;
    const factor=clamp(Math.sqrt(dynamicBudget/baseBudget),.68,1.28);
    return Math.max(1,round(Math.min(base*factor,dynamicBudget,hardMax)));
  }
  function rebalanceBudget(input={}){
    const remaining=Math.max(0,round(input.remaining));
    const missing=Math.max(0,round(input.missing));
    const minBid=Math.max(1,round(input.minBid||1));
    const rows=(input.slots||[]).map((raw,index)=>{
      const state=String(raw?.state||"");
      const open=raw?.open??(state===SLOT_STATES.TARGET_ACTIVE||state===SLOT_STATES.PROMOTED);
      const covered=raw?.covered??state===SLOT_STATES.COVERED;
      const baseCap=Math.max(1,round(raw?.baseCap||raw?.maxRecommended||1));
      const baseBudget=Math.max(minBid,round(raw?.baseBudget||baseCap));
      return {
        ...raw,index,key:String(raw?.key??index),state,open:!!open,covered:!!covered,
        phase:String(raw?.phase||"TOT"),baseCap,baseBudget,
        paid:Math.max(0,round(raw?.paid)),priorityScore:clamp(raw?.priorityScore),
        inflationPct:clamp(raw?.inflationPct,-50,100),inflationConfidence:clamp(raw?.inflationConfidence,0,1)
      };
    });
    /* Con la rosa completa gli slot del Piano restano nello storico, ma non
       ricevono più budget e non possono diventare obiettivi operativi. */
    rows.forEach(row=>{row.open=row.open&&missing>0});
    const openRows=rows.filter(x=>x.open),groups=new Map();
    rows.forEach(row=>{if(!groups.has(row.phase))groups.set(row.phase,[]);groups.get(row.phase).push(row)});
    const desiredByKey={},phases={};
    for(const [phase,phaseRows] of groups){
      const phaseOpen=phaseRows.filter(x=>x.open);
      const baseBudget=phaseRows.reduce((sum,x)=>sum+x.baseBudget,0);
      const spentCovered=phaseRows.filter(x=>x.covered).reduce((sum,x)=>sum+x.paid,0);
      const inflationRows=phaseOpen.length?phaseOpen:phaseRows;
      const inflationPct=inflationRows.length?avg(inflationRows.map(x=>x.inflationPct)):0;
      const inflationConfidence=inflationRows.length?avg(inflationRows.map(x=>x.inflationConfidence)):0;
      const inflationFactor=clamp(1+(inflationPct/100)*.22*inflationConfidence,.88,1.18);
      const pool=phaseOpen.length?Math.max(minBid*phaseOpen.length,baseBudget-spentCovered):0;
      const desiredTotal=phaseOpen.length?Math.max(minBid*phaseOpen.length,round(pool*inflationFactor)):0;
      const phaseDesired=allocateInteger(phaseOpen,desiredTotal,minBid,x=>x.baseBudget*(.8+.4*x.priorityScore/100));
      Object.assign(desiredByKey,phaseDesired);
      phases[phase]={baseBudget,spentCovered,openCount:phaseOpen.length,inflationPct:round(inflationPct),inflationConfidence,inflationFactor,desiredBudget:desiredTotal,dynamicBudget:0};
    }
    const reserve=Math.max(0,missing*minBid);
    const reserveAfterNext=Math.max(0,(missing-1)*minBid);
    const free=Math.max(0,remaining-reserve);
    const maxNext=missing>0?Math.max(0,remaining-reserveAfterNext):0;
    const reserveOutsidePlan=Math.max(0,missing-openRows.length)*minBid;
    const planCapacity=Math.max(0,remaining-reserveOutsidePlan);
    const desiredTotal=Object.values(desiredByKey).reduce((sum,x)=>sum+x,0);
    const planBudget=Math.min(planCapacity,desiredTotal);
    const dynamicByKey=planBudget<desiredTotal
      ? allocateInteger(openRows,planBudget,minBid,x=>desiredByKey[x.key]||x.baseBudget)
      : desiredByKey;
    const slotBudgets={};
    rows.forEach(row=>{
      const dynamicBudget=row.open?Math.max(0,Number(dynamicByKey[row.key])||0):0;
      const info={key:row.key,phase:row.phase,state:row.state,open:row.open,covered:row.covered,baseBudget:row.baseBudget,dynamicBudget,deltaBudget:dynamicBudget-row.baseBudget,baseCap:row.baseCap,inflationPct:row.inflationPct,inflationConfidence:row.inflationConfidence,priorityScore:row.priorityScore};
      info.dynamicCap=row.open?dynamicCandidateCap({maxRecommended:row.baseCap},info,maxNext):0;
      slotBudgets[row.key]=info;
      if(row.open&&phases[row.phase])phases[row.phase].dynamicBudget+=dynamicBudget;
    });
    const allocated=Object.values(dynamicByKey).reduce((sum,x)=>sum+Number(x||0),0);
    const overallInflation=Number(input.overallInflation)||0;
    const status=remaining<reserve?"INSUFFICIENT":planBudget<desiredTotal?"PROTETTO":"OK";
    return {remaining,missing,minBid,reserve,reserveAfterNext,free,maxNext,reserveOutsidePlan,planCapacity,desiredTotal,allocated,planScale:desiredTotal?allocated/desiredTotal:1,overallInflation,status,phases,slots:slotBudgets};
  }

  /* A3.9 — Module Switch Advisor.
     Valuta tutti i moduli usando insieme acquisti già fatti e mercato ancora
     disponibile. La decisione resta solo consultiva; soglia e isteresi evitano
     cambi di consiglio causati da scostamenti marginali. */
  function ownedModuleFit(module,owned,env){
    const slots=module?.slots||[],size=1<<slots.length;
    let dp=new Float64Array(size);dp.fill(-1);dp[0]=0;
    const eligible=(owned||[]).filter(p=>slots.some(roles=>compatible(p,roles)));
    eligible.forEach(p=>{
      const compatibleSlots=[];
      slots.forEach((roles,i)=>{if(compatible(p,roles))compatibleSlots.push(i)});
      if(!compatibleSlots.length)return;
      const quality=clamp(playerMetrics(p,env).intelligence),next=dp.slice();
      for(let mask=0;mask<size;mask++){
        const current=dp[mask];if(current<0)continue;
        compatibleSlots.forEach(i=>{
          const bit=1<<i;if(mask&bit)return;
          const nextMask=mask|bit,value=current+10000+quality;
          if(value>next[nextMask])next[nextMask]=value;
        });
      }
      dp=next;
    });
    let best=0;
    for(let i=1;i<size;i++)if(dp[i]>best)best=dp[i];
    const matched=Math.min(slots.length,Math.floor(best/10000));
    const qualitySum=Math.max(0,best-matched*10000);
    const denominator=Math.max(1,Math.min((owned||[]).length,slots.length));
    return {
      matched,total:slots.length,ownedCount:(owned||[]).length,
      useRate:(owned||[]).length?round(matched/denominator*100):50,
      coverage:round(matched/Math.max(1,slots.length)*100),
      quality:matched?round(qualitySum/matched):50
    };
  }
  function moduleAdvisorRows(input={}){
    const players=input.players||[],reg=input.reg||{},ctx=input.ctx||{};
    const isOwned=typeof ctx.isOwned==="function"?ctx.isOwned:()=>false;
    const isMarketAvailable=typeof ctx.isMarketAvailable==="function"?ctx.isMarketAvailable:p=>isAvailable(p,ctx);
    const owned=players.filter(p=>isOwned(p));
    const ownedIds=new Set(owned.map(p=>String(p?.id??"")));
    const pool=[],seen=new Set();
    players.forEach(p=>{
      const id=String(p?.id??"");if(!id||seen.has(id))return;
      const eligible=ownedIds.has(id)||(!ctx.isEligible||ctx.isEligible(p));
      if(eligible&&(ownedIds.has(id)||isMarketAvailable(p))){seen.add(id);pool.push(p)}
    });
    const projectionCtx={...ctx,isAssigned:()=>false,isEligible:p=>ownedIds.has(String(p?.id??""))||(!ctx.isEligible||ctx.isEligible(p))};
    const progress=clamp(owned.length/11,0,1);
    const freeBudget=Math.max(0,Number(ctx.freeBudget??reg?.budget?.initial)||0);
    const rows=MODULES.map(module=>{
      const env=environment(pool,reg,projectionCtx,module);
      const market=moduleScore(module,pool,reg,projectionCtx,env),fit=ownedModuleFit(module,owned,env);
      const unfilled=Math.max(0,11-fit.matched);
      const estimatedCompletion=round(Number(market.rosterProjection?.expectedRemaining)||0);
      const budgetHealth=estimatedCompletion<=0?100:round(clamp(freeBudget/estimatedCompletion*100));
      const ownWeight=.20+.35*progress,marketWeight=.65-.35*progress;
      const score=round(clamp(market.score*marketWeight+fit.useRate*ownWeight+fit.quality*.10+budgetHealth*.05));
      return {module,score,marketScore:market.score,fit,budgetHealth,estimatedCompletion,market};
    }).sort((a,b)=>b.score-a.score||b.fit.matched-a.fit.matched||b.marketScore-a.marketScore||a.module.id.localeCompare(b.module.id));
    return {rows,ownedCount:owned.length,marketCount:pool.length-owned.length};
  }
  function advisorSecondary(primary,rows,preferredIds=[]){
    const candidates=(rows||[]).filter(x=>x.module.id!==primary?.module?.id).map(row=>{
      const synergy=moduleSimilarity(primary.module,row.module);
      return {...row,synergy,pairScore:round(row.score*.82+synergy*.18)};
    }).sort((a,b)=>b.pairScore-a.pairScore||b.score-a.score||a.module.id.localeCompare(b.module.id));
    const best=candidates[0]||null;
    for(const id of preferredIds.filter(Boolean)){
      const preferred=candidates.find(x=>x.module.id===id);
      if(preferred&&best&&preferred.pairScore>=best.pairScore-2)return preferred;
    }
    return best;
  }
  function adviseModuleSwitch(input={}){
    const runtime=moduleAdvisorRows(input),rows=runtime.rows;
    const requestedCurrent=String(input.currentPrimaryId||DEFAULT_PROFILE.primary);
    const current=rows.find(x=>x.module.id===requestedCurrent)||rows.find(x=>x.module.id===DEFAULT_PROFILE.primary)||rows[0];
    const rawBest=rows[0]||current,previous=input.previous||{};
    const marketEvents=Math.max(0,Number(input.marketEvents)||0),evidence=runtime.ownedCount+Math.min(12,marketEvents)*.35;
    const enterThreshold=Math.max(1,Number(input.enterThreshold)||(evidence<3?8:evidence<7?6:5));
    const releaseThreshold=Math.max(1,Number(input.releaseThreshold)||Math.max(2,enterThreshold-3));
    const challengerGap=Math.max(1,Number(input.challengerGap)||2);
    const validPrevious=String(previous.currentPrimaryId||"")===current.module.id;
    const previousRow=validPrevious&&previous.status==="SWITCH"?rows.find(x=>x.module.id===String(previous.recommendedPrimaryId||"")):null;
    const rawDelta=rawBest&&current?rawBest.score-current.score:0;
    let recommended=null,hysteresisHeld=false;
    if(previousRow&&previousRow.module.id!==current.module.id&&previousRow.score-current.score>=releaseThreshold){
      recommended=previousRow;hysteresisHeld=true;
      if(rawBest.module.id!==previousRow.module.id&&rawBest.module.id!==current.module.id&&rawBest.score-previousRow.score>=challengerGap&&rawDelta>=enterThreshold){
        recommended=rawBest;hysteresisHeld=false;
      }
    }else if(rawBest.module.id!==current.module.id&&rawDelta>=enterThreshold){
      recommended=rawBest;
    }
    const status=recommended?"SWITCH":"KEEP",primary=recommended||current;
    const secondary=advisorSecondary(primary,rows,[validPrevious?previous.recommendedSecondaryId:"",input.currentSecondaryId]);
    const delta=recommended?recommended.score-current.score:Math.max(0,rawDelta);
    const confidence=round(clamp(34+Math.min(11,runtime.ownedCount)*4+Math.min(12,marketEvents)*1.5+Math.abs(delta)*2,35,95));
    const currentNeed=Math.min(runtime.ownedCount,11);
    const reasons=status==="SWITCH"
      ? [
          `${primary.module.name} migliora l'indice runtime di ${delta} punti`,
          `${primary.fit.matched}/${currentNeed} acquisti compatibili con l'XI`,
          `mercato residuo ${primary.marketScore}/100 · completamento stimato ${primary.estimatedCompletion} cr`
        ]
      : [
          rawBest.module.id===current.module.id?`${current.module.name} resta il modulo più efficiente`:`vantaggio di ${rawDelta} punti sotto la soglia ${enterThreshold}`,
          `${current.fit.matched}/${currentNeed} acquisti compatibili con l'XI`,
          `isteresi attiva: il consiglio cambia solo oltre una soglia significativa`
        ];
    return {
      version:"A3.9",status,currentPrimaryId:current.module.id,current,currentSecondaryId:String(input.currentSecondaryId||""),
      recommendedPrimaryId:primary.module.id,recommendedPrimary:primary,recommendedSecondaryId:secondary?.module?.id||"",recommendedSecondary:secondary,
      rawBestId:rawBest?.module?.id||current.module.id,rawDelta,delta,enterThreshold,releaseThreshold,hysteresisHeld,confidence,
      ownedCount:runtime.ownedCount,marketCount:runtime.marketCount,reasons,ranking:rows.slice(0,5)
    };
  }

  function loadProfile(){
    let raw={};
    try{raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||localStorage.getItem(LEGACY_KEY)||"{}")||{}}catch{}
    return {...DEFAULT_PROFILE,...raw,schema:2};
  }
  function saveProfile(p){const x={...DEFAULT_PROFILE,...p,schema:2};localStorage.setItem(STORAGE_KEY,JSON.stringify(x));return x}
  function moduleById(id){return MODULES.find(x=>x.id===id)||MODULES.find(x=>x.id==="433")}
  function roleTokens(p){return String(p?.role||"").split("/").filter(Boolean)}
  function compatible(p,roles){const t=roleTokens(p);return roles.some(r=>t.includes(r))}
  function isAvailable(p,ctx){return (!ctx?.isAssigned||!ctx.isAssigned(p))&&(!ctx?.isEligible||ctx.isEligible(p))}
  function starterProb(p,ctx){
    if(ctx?.starterProbability){const x=ctx.starterProbability(p);return clamp(typeof x==="object"?x?.prob:x)}
    return clamp(p?.starterProbability??p?.starterProb??45);
  }
  function basePrice(p,ctx){
    if(ctx?.playerQuality)return Math.max(0,Number(ctx.playerQuality(p))||0);
    return Math.max(0,Number(p?.maxPrice||p?.marketMax||Math.round(Number(p?.fvm||0)*2.5))||0);
  }
  function playerIsUnder(p,rule,ctx){
    if(ctx?.isUnder)return !!ctx.isUnder(p,rule);
    const y=Number(p?.birthYear||String(p?.birthDate||"").slice(0,4)||0);
    if(rule?.birthYearFrom&&y)return y>=Number(rule.birthYearFrom);
    if(rule?.id==="u21")return !!p?.u21;
    if(rule?.id==="u23")return !!p?.u23||!!p?.u21;
    return false;
  }
  function analysisLimits(reg){
    const participants=round(clamp(reg?.league?.participants||8,4,20));
    const rosterTotal=Math.max(1,round(reg?.roster?.total||25));
    const goalkeepers=Math.max(1,Math.min(rosterTotal,round(reg?.roster?.goalkeepers||3)));
    return {
      participants,rosterTotal,
      total:participants*rosterTotal,
      goalkeepers:participants*goalkeepers,
      movement:participants*Math.max(0,rosterTotal-goalkeepers)
    };
  }
  function moduleSeedScore(p,module,ctx,maxFvm,maxPrice){
    const fvm=Math.max(0,Number(p?.fvm)||0),price=basePrice(p,ctx);
    const matching=(module?.slots||[]).filter(roles=>compatible(p,roles)).length;
    const fit=clamp(matching/Math.max(1,(module?.slots||[]).length)*420);
    const preference=String(ctx?.playerPreference?.(p)||"neutral");
    const preferenceAdjustment=preference==="high"?12:preference==="prefer"?6:preference==="avoid"?-70:0;
    return clamp(clamp(Math.sqrt(fvm/Math.max(1,maxFvm))*100)*.55
      +clamp(Math.sqrt(price/Math.max(1,maxPrice))*100)*.25+fit*.20+preferenceAdjustment);
  }
  function moduleAnalysisPool(players,reg,ctx,module){
    const eligible=(players||[]).filter(p=>isAvailable(p,ctx)),limits=analysisLimits(reg);
    const maxFvm=Math.max(1,...eligible.map(p=>Number(p?.fvm)||0));
    const maxPrice=Math.max(1,...eligible.map(p=>basePrice(p,ctx)));
    const ranked=eligible.map(p=>({p,score:moduleSeedScore(p,module,ctx,maxFvm,maxPrice)}))
      .sort((a,b)=>b.score-a.score||starterProb(b.p,ctx)-starterProb(a.p,ctx)||(Number(b.p?.fvm)||0)-(Number(a.p?.fvm)||0)||String(a.p?.name||"").localeCompare(String(b.p?.name||""),"it"));
    const goalkeepers=ranked.filter(x=>roleTokens(x.p).includes("Por"));
    const movement=ranked.filter(x=>!roleTokens(x.p).includes("Por"));
    const selected=[...goalkeepers.slice(0,limits.goalkeepers),...movement.slice(0,limits.movement)];
    if(selected.length<Math.min(limits.total,ranked.length)){
      const used=new Set(selected.map(x=>String(x.p?.id??x.p?.name??"")));
      for(const row of ranked){
        const key=String(row.p?.id??row.p?.name??"");
        if(!used.has(key)){selected.push(row);used.add(key)}
        if(selected.length>=limits.total)break;
      }
    }
    const available=selected.slice(0,limits.total).map(x=>x.p);
    return {available,limits,eligibleCount:eligible.length,goalkeepers:available.filter(p=>roleTokens(p).includes("Por")).length,movement:available.filter(p=>!roleTokens(p).includes("Por")).length};
  }
  function environment(players,reg,ctx,module=null){
    const analysis=moduleAnalysisPool(players,reg,ctx,module),available=analysis.available;
    const maxFvm=Math.max(1,...available.map(p=>Number(p?.fvm)||0));
    const maxPrice=Math.max(1,...available.map(p=>basePrice(p,ctx)));
    const underRules=(reg?.underRules||[]).filter(x=>x.enabled&&Number(x.min)>0);
    const regulationSignals={depthDemand:1};
    return {players:players||[],available,maxFvm,maxPrice,underRules,reg,ctx,moduleId:module?.id||"",analysis,regulationSignals,piCache:new Map(),candidatePoolCache:new Map()};
  }
  function cachedPlayerIntelligence(p,env){
    return null;
  }
  function playerMetrics(p,env,norm=null){
    const fvm=Math.max(0,Number(p?.fvm)||0),price=basePrice(p,env.ctx),starter=starterProb(p,env.ctx),roles=roleTokens(p);
    // La qualità deve essere relativa ALLO SLOT, non al miglior giocatore assoluto del Listone.
    const maxFvm=Math.max(1,Number(norm?.maxFvm)||env.maxFvm);
    const maxPrice=Math.max(1,Number(norm?.maxPrice)||env.maxPrice);
    const fvmScore=clamp(100*Math.sqrt(fvm/maxFvm));
    const pricePower=clamp(100*Math.sqrt(price/maxPrice));
    const flex=env.reg?.gameMode==="classic"?0:clamp((roles.length-1)*32+(roles.length>=3?8:0));
    const underMatches=env.underRules.filter(r=>playerIsUnder(p,r,env.ctx)).length;
    const youth=env.underRules.length?100*underMatches/env.underRules.length:50;
    const historyScore=0,historyReliability=0,regulationAdjustment=0;
    const baseIntelligence=clamp(fvmScore*.55+pricePower*.25+flex*.15+youth*.05);
    const preference=String(env.ctx?.playerPreference?.(p)||"neutral");
    const preferenceAdjustment=preference==="high"?12:preference==="prefer"?6:preference==="avoid"?-70:0;
    const intelligence=clamp(baseIntelligence+preferenceAdjustment);
    const efficiency=clamp(68+(intelligence-pricePower)*.48);
    return {intelligence,baseIntelligence,historyScore,historyReliability,regulationAdjustment,preference,preferenceAdjustment,starter:intelligence,flex,youth,fvmScore,pricePower,efficiency,price,fvm};
  }
  function slotCandidatePool(roles,env){
    const cacheKey=roles.slice().sort().join("/");
    if(env.candidatePoolCache?.has(cacheKey))return env.candidatePoolCache.get(cacheKey);
    const pool=env.available.filter(p=>compatible(p,roles));
    const maxFvm=Math.max(1,...pool.map(p=>Number(p?.fvm)||0));
    const maxPrice=Math.max(1,...pool.map(p=>basePrice(p,env.ctx)));
    const ranked=pool.map(p=>({p,m:playerMetrics(p,env,{maxFvm,maxPrice})}))
      .sort((a,b)=>b.m.intelligence-a.m.intelligence||b.m.starter-a.m.starter||b.m.fvm-a.m.fvm);
    env.candidatePoolCache?.set(cacheKey,ranked);
    return ranked;
  }
  function slotKey(roles){return roles.slice().sort().join("/")}
  function demandFor(module,roles){const key=slotKey(roles);return module.slots.filter(x=>slotKey(x)===key).length}
  function slotMarket(module,roles,env){
    const demand=Math.max(1,demandFor(module,roles));
    const candidates=slotCandidatePool(roles,env);
    const participants=analysisLimits(env.reg).participants;
    const samplePerSlot=Math.max(7,Math.round(participants*.9));
    const sample=candidates.slice(0,Math.max(8,demand*samplePerSlot));
    // "Forte" è relativo al mercato dello specifico slot.
    // Soglia dinamica: evita sia 0 Por forti sia decine di falsi top in slot profondi.
    const topScore=candidates[0]?.m.intelligence||0;
    const strongThreshold=Math.max(56,topScore*.72);
    const strong=candidates.filter(x=>x.m.intelligence>=strongThreshold&&x.m.starter>=45);
    const supplyWindow=Math.max(30,Math.round(30*participants/8));
    const effectiveSupply=candidates.slice(0,supplyWindow).reduce((s,x)=>s+clamp((x.m.intelligence-34)/54,0,1)*(0.55+x.m.starter/220),0)*Number(env.regulationSignals?.availabilitySupplyMultiplier||1);
    const targetSupply=demand*participants*.9;
    const minimumSupply=demand*participants*.75;
    let scarcity=clamp((1-Math.min(1,effectiveSupply/targetSupply))*100);
    if(candidates.length<minimumSupply)scarcity=Math.max(scarcity,clamp((1-candidates.length/minimumSupply)*100));
    const strongTarget=Math.max(1,demand*participants);
    const depth=clamp(100-scarcity*.72+(Math.min(strong.length,strongTarget)/strongTarget)*28);
    return {
      roles:roles.slice(),key:slotKey(roles),demand,count:candidates.length,strongCount:strong.length,
      quality:round(avg(sample.map(x=>x.m.intelligence))),starter:round(avg(sample.map(x=>x.m.starter))),
      history:round(avg(sample.filter(x=>x.m.historyScore>0).map(x=>x.m.historyScore))),
      historyCoverage:round(sample.length?sample.filter(x=>x.m.historyScore>0).length/sample.length*100:0),
      depth:round(depth),scarcity:round(scarcity),efficiency:round(avg(sample.map(x=>x.m.efficiency))),
      flexibility:round(avg(sample.map(x=>x.m.flex))),
      top:candidates.slice(0,3).map(x=>({id:x.p.id,name:x.p.name,club:x.p.club,role:x.p.role,score:round(x.m.intelligence),history:round(x.m.historyScore),starter:round(x.m.starter),price:round(x.m.price)}))
    };
  }
  function analyseSlots(module,env){
    const cache=new Map();
    return module.slots.map(roles=>{
      const key=slotKey(roles);
      if(!cache.has(key))cache.set(key,slotMarket(module,roles,env));
      return {...cache.get(key),roles:roles.slice()};
    });
  }
  function playerKey(p){return String(p?.id??`${p?.name||""}|${p?.club||""}|${p?.role||""}`)}
  function assignmentValue(m,p,slot,module,env){
    const history=m.historyScore>0?m.historyScore:m.intelligence;
    const slotBudget=Math.max(1,slotMacroBudget({module,critical:[]},slot?.roles||[],env.reg).perSlot||1);
    const expected=expectedMarketPrice(p,m,env),overrun=Math.max(0,(expected-slotBudget)/slotBudget*100);
    /* Il matching non cerca semplicemente gli undici nomi più costosi: un
       profilo oltre il budget naturale dello slot perde valore operativo. */
    return m.intelligence*.48+m.starter*.12+history*.08+m.efficiency*.12+m.flex*.06+m.youth*.04+10-overrun*.52;
  }
  function greedyXI(module,slotRows,env){
    const slots=module.slots.map((roles,i)=>({i,roles,row:slotRows[i]})).sort((a,b)=>b.row.scarcity-a.row.scarcity||a.row.count-b.row.count);
    const used=new Set(),selected=[];
    for(const s of slots){
      const pick=slotCandidatePool(s.roles,env).find(x=>!used.has(playerKey(x.p)));
      if(pick){used.add(playerKey(pick.p));selected.push({slot:s.i,roles:s.roles,p:pick.p,m:pick.m})}
    }
    return selected.sort((a,b)=>a.slot-b.slot);
  }
  /* A5.6.4 — matching globale multiruolo.
     Ogni calciatore viene processato una volta e la DP confronta tutte le
     assegnazioni possibili sugli 11 slot. In questo modo un M/C non viene
     consumato sul primo ruolo incontrato se genera più valore altrove. */
  function bestXI(module,slotRows,env){
    const slots=module.slots.map((roles,i)=>({i,roles,row:slotRows[i]}));
    const perSlot=Math.max(16,Math.min(28,analysisLimits(env.reg).participants*2)),candidates=new Map();
    slots.forEach(slot=>{
      slotCandidatePool(slot.roles,env).slice(0,perSlot).forEach(entry=>{
        const key=playerKey(entry.p),record=candidates.get(key)||{key,p:entry.p,bySlot:new Map(),best:0};
        const value=assignmentValue(entry.m,entry.p,slot,module,env);
        record.bySlot.set(slot.i,{m:entry.m,value});record.best=Math.max(record.best,value);candidates.set(key,record);
      });
    });
    const rows=[...candidates.values()].sort((a,b)=>b.best-a.best||a.key.localeCompare(b.key)),size=1<<slots.length;
    let dp=new Float64Array(size);dp.fill(-1e12);dp[0]=0;
    let paths=Array(size).fill(null);paths[0]=Array(slots.length).fill(null);
    rows.forEach(candidate=>{
      const next=dp.slice(),nextPaths=paths.slice();
      for(let mask=0;mask<size;mask++){
        if(dp[mask]<-1e11||!paths[mask])continue;
        candidate.bySlot.forEach((entry,slotIndex)=>{
          const bit=1<<slotIndex;if(mask&bit)return;
          const nextMask=mask|bit,value=dp[mask]+10000+entry.value;
          if(value>next[nextMask]){
            const path=paths[mask].slice();path[slotIndex]={slot:slotIndex,roles:slots[slotIndex].roles,p:candidate.p,m:entry.m};
            next[nextMask]=value;nextPaths[nextMask]=path;
          }
        });
      }
      dp=next;paths=nextPaths;
    });
    let bestMask=0;
    for(let mask=1;mask<size;mask++)if(dp[mask]>dp[bestMask])bestMask=mask;
    const selected=(paths[bestMask]||[]).filter(Boolean).sort((a,b)=>a.slot-b.slot),greedy=greedyXI(module,slotRows,env);
    const globalQuality=avg(selected.map(x=>assignmentValue(x.m,x.p,slots[x.slot],module,env))),greedyQuality=avg(greedy.map(x=>assignmentValue(x.m,x.p,slots[x.slot],module,env)));
    return {selected,diagnostics:{method:"GLOBAL_DP",candidates:rows.length,filled:selected.length,total:slots.length,multirole:selected.filter(x=>roleTokens(x.p).length>1).length,gain:round(globalQuality-greedyQuality)}};
  }
  function regulationFit(module,selected,env){
    const reg=env.reg||{},rules=env.underRules,signals=env.regulationSignals||{};
    const participants=analysisLimits(reg).participants;
    const underHealth=rules.length?avg(rules.map(rule=>{
      const pool=env.available.filter(p=>compatibleAnyModule(p,module)&&playerIsUnder(p,rule,env.ctx));
      const target=Math.max(1,Number(rule.min)||0)*participants;
      return clamp(pool.length/target*100);
    })):75;
    const moduleFlex=avg(module.slots.slice(1).map(x=>x.length>1?100:0));
    const selectedFlex=avg(selected.map(x=>x.m.flex));
    return round(clamp(underHealth*.55+moduleFlex*.20+selectedFlex*.25));
    let switchFit=65;
    if(reg.switchMode==="plus")switchFit=clamp(55+moduleFlex*.23+selectedFlex*.22);
    else if(reg.switchMode==="switch")switchFit=clamp(58+selectedFlex*.18);
    else switchFit=65;
    let dFit=70;
    if(reg?.modifiers?.dFactor?.enabled){
      const defenders=selected.filter(x=>x.roles.some(r=>D_FACTOR_ROLES.has(r)));
      const bandPeak=Math.max(0,...(reg.modifiers.dFactor.bands||[]).map(x=>Number(x.value)||0));
      const applyFactor=reg.modifiers.dFactor.applyTo==="opponent"?.97:1;
      dFit=clamp((45+defenders.length*5+avg(defenders.map(x=>x.m.intelligence))*.22+(reg.modifiers.dFactor.includeGoalkeeper?3:0)+(bandPeak-6)*.8)*applyFactor);
    }
    /* Il preset A3.9 resta il punto zero. Panca, soglie e bonus personalizzati
       aggiungono piccoli delta sensibili al tipo di XI soltanto quando il
       regolamento viene davvero cambiato nel Regolamento Lega. */
    const baseFit=underHealth*.40+switchFit*.30+dFit*.30;
    const starterFloor=avg(selected.map(x=>x.m.starter)),reliability=avg(selected.map(x=>x.m.historyReliability||50));
    const depthProfile=clamp(48+starterFloor*.28+reliability*.14);
    const depthDelta=(Number(signals.depthDemand||1)-1)*(depthProfile-70)*.18;
    const ruleDelta=avg(selected.map(x=>x.m.regulationAdjustment||0));
    const attackShare=selected.length?selected.filter(x=>x.roles.some(role=>ROLE_MACRO[role]==="ATT")).length/selected.length:0;
    const qualityProfile=avg(selected.map(x=>x.m.intelligence))-70;
    const scoringDelta=ruleDelta*.45
      +(Number(signals.attackEventWeight||1)-1)*attackShare*5
      +(Number(signals.thresholdAttackBias||1)-1)*attackShare*4
      +(Number(signals.floorBias||1)-1)*qualityProfile*.10
      +(Number(signals.ceilingBias||1)-1)*qualityProfile*.08;
    return round(clamp(baseFit+depthDelta+scoringDelta));
  }
  function compatibleAnyModule(p,module){return module.slots.some(r=>compatible(p,r))}
  function moduleFlexibility(module,selected,reg){
    const structural=avg(module.slots.slice(1).map(r=>r.length>1?100:0));
    const playerFlex=avg(selected.map(x=>x.m.flex));
    const boost=0;
    return round(clamp(structural*.43+playerFlex*.57+boost));
  }
  function quantile(values,q=.3){
    const rows=(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);if(!rows.length)return 0;
    const pos=(rows.length-1)*clamp(q,0,1),low=Math.floor(pos),high=Math.ceil(pos),weight=pos-low;
    return rows[low]*(1-weight)+rows[high]*weight;
  }
  function expectedMarketPrice(p,m,env){
    const minBid=Math.max(1,Number(env.reg?.budget?.minBid)||1);
    if(typeof env.ctx?.expectedPrice==="function")return Math.max(minBid,round(env.ctx.expectedPrice(p,m)));
    const guide=Math.max(minBid,Number(m?.price)||basePrice(p,env.ctx));
    const fvm=Math.max(0,Number(m?.fvm??p?.fvm)||0),starter=Number(m?.starter)||starterProb(p,env.ctx);
    const expected=Math.max(minBid,fvm*1.8*(.88+starter/600));
    return Math.max(minBid,round(Math.min(guide,expected)));
  }
  function projectFullRoster(module,selected,env){
    const reg=env.reg||{},ctx=env.ctx||{},budget=Math.max(1,Number(reg?.budget?.initial)||2500);
    const rosterTotal=Math.max(1,Number(reg?.roster?.total)||25),goalkeepers=Math.max(0,Number(reg?.roster?.goalkeepers)||3);
    const minBid=Math.max(1,Number(reg?.budget?.minBid)||1),isOwned=typeof ctx.isOwned==="function"?ctx.isOwned:()=>false;
    const purchasePrice=typeof ctx.purchasePrice==="function"?ctx.purchasePrice:()=>0,owned=[],seen=new Set();
    (env.players||[]).forEach(p=>{const key=playerKey(p);if(!seen.has(key)&&isOwned(p)){seen.add(key);owned.push(p)}});
    const actualSpent=round(owned.reduce((sum,p)=>sum+Math.max(0,Number(purchasePrice(p))||0),0));
    const ownedCount=owned.length,configuredMissing=Number(ctx.missingRoster),missing=Math.max(0,Math.min(rosterTotal,Number.isFinite(configuredMissing)?round(configuredMissing):rosterTotal-ownedCount));
    const remainingBudget=Math.max(0,Number.isFinite(Number(ctx.remainingBudget))?round(ctx.remainingBudget):budget-actualSpent);
    if(!missing)return {status:"COMPLETE",rosterTotal,ownedCount,missing:0,actualSpent,remainingBudget,strategicPlayers:0,strategicCost:0,benchPlayers:0,benchCost:0,expectedRemaining:0,projectedTotal:actualSpent,closingBalance:remainingBudget,minReserve:0};
    const fit=ownedModuleFit(module,owned,env),targetCount=Math.min(missing,Math.max(0,11-fit.matched));
    const ownedGoalkeepers=owned.filter(p=>roleTokens(p).includes("Por")).length,requiredGoalkeepers=Math.max(0,Math.min(missing,goalkeepers-ownedGoalkeepers));
    const requiredMovement=Math.max(0,missing-requiredGoalkeepers),ownedIds=new Set(owned.map(playerKey));
    const availableSelected=selected.filter(x=>!ownedIds.has(playerKey(x.p))).map(x=>({...x,expected:expectedMarketPrice(x.p,x.m,env)}));
    const strategic=[],used=new Set(),capacity={gk:requiredGoalkeepers,mov:requiredMovement};
    availableSelected.sort((a,b)=>b.expected-a.expected||b.m.intelligence-a.m.intelligence).forEach(row=>{
      if(strategic.length>=targetCount)return;
      const kind=roleTokens(row.p).includes("Por")?"gk":"mov";if(capacity[kind]<=0)return;
      strategic.push(row);used.add(playerKey(row.p));capacity[kind]--;
    });
    const market=env.available.filter(p=>!ownedIds.has(playerKey(p))&&!used.has(playerKey(p)));
    const marketPrices=kind=>market.filter(p=>(roleTokens(p).includes("Por")?"gk":"mov")===kind).map(p=>expectedMarketPrice(p,playerMetrics(p,env),env));
    const strategicGoalkeepers=strategic.filter(x=>roleTokens(x.p).includes("Por")).length;
    const benchGoalkeepers=Math.max(0,requiredGoalkeepers-strategicGoalkeepers),benchMovement=Math.max(0,missing-strategic.length-benchGoalkeepers);
    const strategicCost=round(strategic.reduce((sum,x)=>sum+x.expected,0));
    const gkUnit=Math.max(minBid,round(quantile(marketPrices("gk"),.30)||minBid));
    const movUnit=Math.max(minBid,round(quantile(marketPrices("mov"),.28)||minBid));
    const benchCost=round(benchGoalkeepers*gkUnit+benchMovement*movUnit),expectedRemaining=Math.max(missing*minBid,strategicCost+benchCost);
    const closingBalance=remainingBudget-expectedRemaining,projectedTotal=actualSpent+expectedRemaining,minReserve=missing*minBid;
    const status=closingBalance<0?"OVER":closingBalance<Math.max(minBid,budget*.03)?"TIGHT":"SUSTAINABLE";
    return {status,rosterTotal,ownedCount,missing,actualSpent,remainingBudget,strategicPlayers:strategic.length,strategicCost,benchPlayers:benchGoalkeepers+benchMovement,benchCost,expectedRemaining,projectedTotal,closingBalance,minReserve,gkUnit,movUnit};
  }
  function costScore(selected,reg,projection=null){
    const budget=Math.max(1,Number(reg?.budget?.initial)||2500);
    const xiCost=selected.reduce((s,x)=>s+x.m.price,0);
    const fullCost=Math.max(0,Number(projection?.projectedTotal)||xiCost),ratio=fullCost/budget;
    const efficiency=avg(selected.map(x=>x.m.efficiency));
    const pressure=ratio<=.48?95:ratio<=.65?88:ratio<=.82?76:ratio<=1?60:Math.max(25,60-(ratio-1)*80);
    return {score:round(clamp(pressure*.55+efficiency*.45)),xiCost:round(xiCost),fullCost:round(fullCost),ratio};
  }
  function moduleScore(module,players,reg,ctx,sharedEnv=null){
    const env=sharedEnv&&sharedEnv.moduleId===module?.id?sharedEnv:environment(players,reg,ctx,module),slotRows=analyseSlots(module,env),assignment=bestXI(module,slotRows,env),selected=assignment.selected;
    const coverage=round(selected.length/module.slots.length*100);
    const qualityXI=round(avg(selected.map(x=>x.m.intelligence)));
    const starterXI=round(avg(selected.map(x=>x.m.starter)));
    const historyRows=selected.filter(x=>x.m.historyScore>0);
    const history=round(avg(historyRows.map(x=>x.m.historyScore)));
    const historyCoverage=round(selected.length?historyRows.length/selected.length*100:0);
    const depth=round(avg(slotRows.map(x=>x.depth)));
    const avgScarcity=avg(slotRows.map(x=>x.scarcity)),maxScarcity=Math.max(0,...slotRows.map(x=>x.scarcity));
    const scarcityRisk=round(avgScarcity*.62+maxScarcity*.38);
    const flexibility=moduleFlexibility(module,selected,reg);
    const rosterProjection=projectFullRoster(module,selected,env),cost=costScore(selected,reg,rosterProjection);
    const regulation=regulationFit(module,selected,env);
    const scarcityHealth=100-scarcityRisk;
    /* A7: il punteggio è completamente riproducibile dal Listone e dal
       regolamento d'asta; nessun segnale esterno entra nel calcolo. */
    let score=qualityXI*.34+starterXI*.12+depth*.16+cost.score*.13+flexibility*.11+regulation*.04+scarcityHealth*.10;
    score*=coverage/100;
    score=round(clamp(score));
    const uniqueCritical=new Map();
    slotRows.forEach(r=>{const prev=uniqueCritical.get(r.key);if(!prev||r.scarcity>prev.scarcity)uniqueCritical.set(r.key,r)});
    const critical=[...uniqueCritical.values()].sort((a,b)=>b.scarcity-a.scarcity||a.strongCount-b.strongCount).slice(0,4);
    const explanation=explainModule({module,score,coverage,qualityXI,starterXI,history,historyCoverage,depth,scarcityRisk,flexibility,cost,regulation,critical,participants:env.analysis.limits.participants});
    return {module,score,coverage,quality:qualityXI,starter:starterXI,history,historyCoverage,depth,flexibility,scarcityRisk,cost:cost.score,xiCost:cost.xiCost,fullCost:cost.fullCost,rosterProjection,assignment:assignment.diagnostics,regulation,critical,analysis:{...env.analysis.limits,eligible:env.analysis.eligibleCount,analyzed:env.available.length,actualGoalkeepers:env.analysis.goalkeepers,actualMovement:env.analysis.movement},selected:selected.map(x=>({slot:x.slot,name:x.p.name,club:x.p.club,role:x.p.role,score:round(x.m.intelligence),history:round(x.m.historyScore),starter:round(x.m.starter)})),explanation};
  }
  function explainModule(x){
    const strengths=[],warnings=[];
    if(x.starter>=72)strengths.push(`Valore Listone elevato negli undici slot (${x.starter}/100)`);else if(x.starter<58)warnings.push(`Valore Listone medio da proteggere (${x.starter}/100)`);
    if(x.depth>=76)strengths.push(`Buona profondità del mercato (${x.depth}/100)`);else if(x.depth<58)warnings.push(`Alternative poco profonde (${x.depth}/100)`);
    if(x.flexibility>=55)strengths.push(`Flessibilità Mantra alta (${x.flexibility}/100)`);
    if(x.cost.score>=76)strengths.push(`Costo rosa completa sostenibile (${x.cost.score}/100)`);else if(x.cost.score<55)warnings.push(`Completamento della rosa potenzialmente costoso (${x.cost.score}/100)`);
    if(x.scarcityRisk>=35)warnings.push(`Scarsità significativa (${x.scarcityRisk}/100)`);
    const participants=Math.max(4,Number(x.participants)||8);
    x.critical.filter(r=>r.scarcity>=18||r.strongCount<r.demand*participants*.75).slice(0,2).forEach(r=>warnings.push(`${r.roles.join("/")}: ${r.strongCount} profili forti, rischio ${r.scarcity}%`));
    if(!strengths.length)strengths.push("Struttura equilibrata senza un vantaggio dominante");
    if(!warnings.length)warnings.push("Nessuna criticità grave: monitorare comunque i prezzi reali");
    return {strengths,warnings,priority:x.critical.slice(0,3).map(r=>r.roles.join("/"))};
  }
  function sortRanked(rows){return rows.sort((a,b)=>b.score-a.score||a.scarcityRisk-b.scarcityRisk||b.starter-a.starter)}
  function rankModules(players,reg,ctx){
    return sortRanked(MODULES.map(m=>moduleScore(m,players,reg,ctx)));
  }
  async function rankModulesAsync(players,reg,ctx,onProgress){
    const rows=[];
    for(let i=0;i<MODULES.length;i++){
      rows.push(moduleScore(MODULES[i],players,reg,ctx));
      if(onProgress)onProgress(i+1,MODULES.length,MODULES[i]);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return sortRanked(rows);
  }
  function moduleSimilarity(a,b){
    const tokens=m=>m.slots.slice(1).map(r=>slotKey(r));
    const A=tokens(a),B=tokens(b),used=new Set();let matches=0;
    A.forEach(x=>{const idx=B.findIndex((y,i)=>!used.has(i)&&(y===x||y.split("/").some(r=>x.split("/").includes(r))));if(idx>=0){used.add(idx);matches++}});
    return round(matches/Math.max(A.length,B.length)*100);
  }
  function bestAutoPair(ranked){
    const top=ranked.slice(0,6);let best=null;
    for(let i=0;i<top.length;i++)for(let j=i+1;j<top.length;j++){
      const synergy=moduleSimilarity(top[i].module,top[j].module);
      const score=round(top[i].score*.45+top[j].score*.35+synergy*.20);
      if(!best||score>best.score)best={primary:top[i],secondary:top[j],synergy,score};
    }
    return best||{primary:top[0],secondary:top[1],synergy:0,score:top[0]?.score||0};
  }
  function macroWeights(moduleResult,reg){
    const module=moduleResult.module,base={POR:.08,DIF:.20,CEN:.27,ATT:.45},struct={POR:0,DIF:0,CEN:0,ATT:0},risk={POR:0,DIF:0,CEN:0,ATT:0},counts={POR:0,DIF:0,CEN:0,ATT:0};
    module.slots.forEach((roles,i)=>{
      const macros=[...new Set(roles.map(r=>ROLE_MACRO[r]).filter(Boolean))];
      macros.forEach(m=>{struct[m]+=1/macros.length;counts[m]++});
      const row=moduleResult.critical?.find(x=>x.key===slotKey(roles));
      if(row)macros.forEach(m=>risk[m]+=row.scarcity/macros.length);
    });
    const total=Object.values(struct).reduce((a,b)=>a+b,0)||11,mix={};
    Object.keys(base).forEach(k=>{
      const structural=struct[k]/total,scarcityBoost=(risk[k]/Math.max(1,counts[k]))/100;
      mix[k]=base[k]*.52+structural*.38+scarcityBoost*.10;
    });
    const sum=Object.values(mix).reduce((a,b)=>a+b,0)||1,budget=Math.max(1,Number(reg?.budget?.initial)||2500);
    const entries=Object.entries(mix).map(([k,v])=>[k,v/sum]);
    const out={};let credits=0;
    entries.forEach(([k,v],i)=>{const c=i===entries.length-1?budget-credits:Math.round(v*budget);credits+=c;out[k]={pct:round(v*100),credits:c}});
    return out;
  }

  function moduleMacroSlotCount(module,macro){
    let count=0;
    (module?.slots||[]).forEach(roles=>{
      const macros=[...new Set((roles||[]).map(r=>ROLE_MACRO[r]).filter(Boolean))];
      if(macros.includes(macro))count+=1/Math.max(1,macros.length);
    });
    return Math.max(1,count);
  }
  function bridgeFitForPlayer(p,secondaryModule){
    if(!secondaryModule)return 50;
    const matching=(secondaryModule.slots||[]).filter(roles=>compatible(p,roles)).length;
    if(!matching)return 0;
    return clamp(58+matching*12);
  }
  function slotMacroBudget(moduleResult,roles,reg){
    const budget=macroWeights(moduleResult,reg);
    const macros=[...new Set((roles||[]).map(r=>ROLE_MACRO[r]).filter(Boolean))];
    if(!macros.length)return {credits:Math.max(1,Number(reg?.budget?.initial)||2500),perSlot:0,macro:'TOT'};
    const credits=avg(macros.map(m=>Number(budget?.[m]?.credits)||0));
    const perSlot=avg(macros.map(m=>credits/Math.max(1,moduleMacroSlotCount(moduleResult.module,m))));
    return {credits:round(credits),perSlot:round(perSlot),macro:macros.join('/')};
  }
  function recommendedMaxForCandidate(candidate,moduleResult,roles,row,reg,rankType='alt'){
    const m=candidate.m,bridge=candidate.bridge||0,auction=candidate.auctionScore||0,history=m.historyScore||0;
    const neutral=Math.max(1,round(m.price));
    const scarcity=Number(row?.scarcity)||0;
    const macro=slotMacroBudget(moduleResult,roles,reg);
    let multiplier=.78+auction*.0026+m.starter*.0007+history*.0006+scarcity*.001+(bridge>=80?.025:0);
    if(rankType==='target')multiplier+=.04;
    if(rankType==='value')multiplier-=.05;
    const raw=neutral*multiplier;
    const strategicCap=Math.max(neutral*.90,macro.perSlot*(1.25+auction/100*.82));
    const hardCap=neutral*1.42;
    return Math.max(1,round(Math.min(raw,strategicCap,hardCap)));
  }
  function analyseSlotWithEnv(moduleResult,roles,env,secondaryModule=null){
    const row=slotMarket(moduleResult.module,roles,env);
    const pool=slotCandidatePool(roles,env).slice(0,36);
    const enriched=pool.map(({p,m})=>{
      const bridge=bridgeFitForPlayer(p,secondaryModule);
      const historyEffective=m.historyScore>0?m.historyScore:m.intelligence;
      const auctionScore=clamp(m.intelligence*.48+m.starter*.15+historyEffective*.11+m.efficiency*.12+m.flex*.06+m.youth*.03+bridge*.05);
      const valueScore=clamp(m.intelligence*.42+m.efficiency*.30+m.starter*.10+historyEffective*.09+m.flex*.05+bridge*.04);
      return {
        id:p.id,name:p.name,club:p.club,role:p.role,reparto:p.reparto,fvm:round(m.fvm),
        score:round(auctionScore),intelligence:round(m.intelligence),starter:round(m.starter),
        history:round(m.historyScore),historyReliability:round(m.historyReliability),efficiency:round(m.efficiency),
        flexibility:round(m.flex),youth:round(m.youth),bridge:round(bridge),neutralMax:round(m.price),valueScore:round(valueScore),
        preference:m.preference||"neutral",preferenceAdjustment:round(m.preferenceAdjustment||0),
        assigned:!isAvailable(p,env.ctx),player:p,m
      };
    }).sort((a,b)=>b.score-a.score||b.history-a.history||b.starter-a.starter||b.fvm-a.fvm);
    const operational=enriched.filter(x=>x.preference!=="avoid");
    const target=operational[0]||null;
    const alternatives=operational.slice(1,4);
    const reserved=new Set([target,...alternatives].filter(Boolean).map(x=>String(x.id)));
    const values=operational.filter(x=>!reserved.has(String(x.id))).sort((a,b)=>b.valueScore-a.valueScore||b.score-a.score).slice(0,3);
    if(target)target.maxRecommended=recommendedMaxForCandidate(target,moduleResult,roles,row,env.reg,'target');
    alternatives.forEach((x,i)=>{x.altRank=i+1;x.maxRecommended=recommendedMaxForCandidate(x,moduleResult,roles,row,env.reg,'alt')});
    values.forEach(x=>{x.maxRecommended=recommendedMaxForCandidate(x,moduleResult,roles,row,env.reg,'value')});
    const budget=slotMacroBudget(moduleResult,roles,env.reg);
    const core=[target,...alternatives].filter(Boolean);
    const minimumScore=core.length?Math.min(...core.map(x=>Number(x.score)||0)):0;
    const priorityScore=round(clamp(Number(row.scarcity)*.65+(100-Number(row.depth))*.35));
    const priority={score:priorityScore,label:priorityScore>=55?'ALTA':priorityScore>=30?'MEDIA':'BASSA'};
    return {
      key:slotKey(roles),roles:roles.slice(),row,budget,minimumScore,priority,target,alternatives,values,
      candidates:operational.slice(0,12),excludedByUser:enriched.filter(x=>x.preference==="avoid").length,secondaryModule:secondaryModule?.name||'',
      summary:{scarcity:row.scarcity,strongCount:row.strongCount,depth:row.depth,quality:row.quality,starter:row.starter,history:row.history,historyCoverage:row.historyCoverage}
    };
  }
  function analyseSlot(moduleResult,roles,players,reg,ctx,secondaryModule=null){
    const env=environment(players,reg,ctx,moduleResult?.module||null);
    return analyseSlotWithEnv(moduleResult,roles,env,secondaryModule);
  }

  function bridgeRoles(a,b){
    const A=a.slots.slice(1).flat(),B=b.slots.slice(1).flat(),all=[...new Set(A.concat(B))];
    return all.map(role=>({role,a:A.filter(x=>x===role).length,b:B.filter(x=>x===role).length})).filter(x=>x.a&&x.b).sort((x,y)=>(y.a+y.b)-(x.a+x.b));
  }
  function finalizeAuto(p,ranked,reg){
    const pair=bestAutoPair(ranked);
    p.primary=pair.primary?.module.id||"433";p.secondary=pair.secondary?.module.id||"4231";
    return {engineVersion:ENGINE_VERSION,profile:saveProfile(p),mode:"auto",ranked,primary:pair.primary,secondary:pair.secondary,pairScore:pair.score,synergy:pair.synergy,budget:macroWeights(pair.primary,reg),bridges:pair.secondary?bridgeRoles(pair.primary.module,pair.secondary.module):[]};
  }
  function build(profile,players,reg,ctx){
    const p={...DEFAULT_PROFILE,...profile,lastGeneratedAt:Date.now(),schema:2};
    if(p.mode==="auto")return finalizeAuto(p,rankModules(players,reg,ctx),reg);
    const env=environment(players,reg,ctx,moduleById(p.primary));
    const primary=moduleScore(moduleById(p.primary),players,reg,ctx,env);
    const secondary=p.mode==="dual"?moduleScore(moduleById(p.secondary),players,reg,ctx):null;
    const synergy=secondary?moduleSimilarity(primary.module,secondary.module):0;
    const pairScore=secondary?round(primary.score*.50+secondary.score*.34+synergy*.16):primary.score;
    return {engineVersion:ENGINE_VERSION,profile:saveProfile(p),mode:p.mode,primary,secondary,pairScore,synergy,budget:macroWeights(primary,reg),bridges:secondary?bridgeRoles(primary.module,secondary.module):[]};
  }
  async function buildAsync(profile,players,reg,ctx,onProgress){
    const p={...DEFAULT_PROFILE,...profile,lastGeneratedAt:Date.now(),schema:2};
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    if(p.mode==="auto")return finalizeAuto(p,await rankModulesAsync(players,reg,ctx,onProgress),reg);
    const env=environment(players,reg,ctx,moduleById(p.primary));
    const primary=moduleScore(moduleById(p.primary),players,reg,ctx,env);
    if(onProgress)onProgress(1,p.mode==="dual"?2:1,primary.module);
    await new Promise(resolve=>setTimeout(resolve,0));
    const secondary=p.mode==="dual"?moduleScore(moduleById(p.secondary),players,reg,ctx):null;
    if(secondary&&onProgress)onProgress(2,2,secondary.module);
    const synergy=secondary?moduleSimilarity(primary.module,secondary.module):0;
    const pairScore=secondary?round(primary.score*.50+secondary.score*.34+synergy*.16):primary.score;
    return {engineVersion:ENGINE_VERSION,profile:saveProfile(p),mode:p.mode,primary,secondary,pairScore,synergy,budget:macroWeights(primary,reg),bridges:secondary?bridgeRoles(primary.module,secondary.module):[]};
  }
  window.FA2Strategy={VERSION:ENGINE_VERSION,STORAGE_KEY,LEGACY_KEY,MODULES,DEFAULT_PROFILE:clone(DEFAULT_PROFILE),SLOT_STATES,SLOT_PLAYER_STATES,SLOT_STATE_LABELS,loadProfile,saveProfile,moduleById,rankModules,rankModulesAsync,moduleScore,build,buildAsync,macroWeights,moduleSimilarity,analyseSlot,analysisLimits,resolveSlotState,resolvePlanSlots,rebalanceBudget,dynamicCandidateCap,adviseModuleSwitch};
})();
