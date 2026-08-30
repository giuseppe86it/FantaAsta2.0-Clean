/* FantaAsta2.0 — Regulation Engine A5.6.2
   Regolamento Lega completo e retrocompatibile.
   Migra v1/v2 senza cancellare le configurazioni precedenti. */
(function(){
  const STORAGE_KEY="fa2_regulation_v3";
  const PREVIOUS_KEY="fa2_regulation_v2";
  const LEGACY_KEY="fa2_regulation_v1";
  const SCHEMA=4;
  const clone=v=>JSON.parse(JSON.stringify(v));

  const DEFAULT_BANDS=[
    {lt:6,value:0},
    {gte:6,lt:6.25,value:1},
    {gte:6.25,lt:6.5,value:2},
    {gte:6.5,lt:6.75,value:3},
    {gte:6.75,lt:7,value:4.5},
    {gte:7,value:6}
  ];
  const DEFAULT_BONUSES={
    goal:3,goalAgainst:-1,penaltyScored:3,penaltyMissed:-3,penaltySaved:3,
    yellow:-0.5,red:-1,assistStandard:1,assistSoft:1,assistGold:1,
    ownGoal:-2,equalizer:0,winner:0,cleanSheet:1,playerOfMatch:0.5
  };
  const CURRENT_PRESET={
    schema:SCHEMA,
    id:"mia-lega",
    name:"La mia lega",
    season:"2026/27",
    league:{participants:8},
    availability:"single",
    gameMode:"mantra",
    budget:{initial:2500,minBid:1,minResidualPerSlot:1},
    roster:{total:25,goalkeepers:3,movement:22,clubLimit:5,hidden:false},
    underRules:[
      {id:"u23",enabled:true,maxAge:23,birthYearFrom:2003,min:2,label:"U23"},
      {id:"u21",enabled:true,maxAge:21,birthYearFrom:2005,min:1,label:"U21"}
    ],
    bench:{size:12,minGoalkeepers:1,movement:"variable"},
    formation:{timeoutMinutes:5,hidden:false,missingLineup:"previous"},
    switchMode:"plus",
    scoring:{
      source:"fantacalcio",
      bonuses:clone(DEFAULT_BONUSES),
      goalThreshold:{firstGoal:66,mode:"fixed",step:6},
      limitWin:{enabled:false,delta:0},
      limitDraw:{enabled:false,delta:0},
      autoGoal:{enabled:false,threshold:0},
      bookedNoVote:true
    },
    modifiers:{
      dFactor:{enabled:true,includeGoalkeeper:true,applyTo:"own",preset:"recommended",bands:clone(DEFAULT_BANDS)},
      performance:{enabled:false},
      fairplay:{enabled:true,bonus:0.5},
      captain:{enabled:false,bands:[]}
    },
    auction:{phases:["POR","DIF","CEN","ATT"],singleAvailability:true}
  };

  function mergeDeep(base,patch){
    if(Array.isArray(base))return Array.isArray(patch)?clone(patch):clone(base);
    if(!base||typeof base!=="object")return patch===undefined?base:patch;
    const out={...base};
    if(patch&&typeof patch==="object")Object.keys(patch).forEach(k=>{
      const bv=base[k],pv=patch[k];
      out[k]=(bv&&typeof bv==="object"&&!Array.isArray(bv)&&pv&&typeof pv==="object"&&!Array.isArray(pv))?mergeDeep(bv,pv):clone(pv);
    });
    return out;
  }
  const num=(v,d=0,min=-Infinity,max=Infinity)=>Math.min(max,Math.max(min,Number.isFinite(Number(v))?Number(v):d));
  const bool=v=>!!v;
  const seasonStartYear=season=>{
    const match=String(season||"").match(/(20\d{2})/);
    return match?Number(match[1]):new Date().getFullYear();
  };
  function normalizeBands(raw){
    const rows=Array.isArray(raw)&&raw.length===DEFAULT_BANDS.length?raw:DEFAULT_BANDS;
    return DEFAULT_BANDS.map((base,index)=>({
      ...(base.gte===undefined?{}:{gte:num(rows[index]?.gte,base.gte,0,10)}),
      ...(base.lt===undefined?{}:{lt:num(rows[index]?.lt,base.lt,0,10)}),
      value:num(rows[index]?.value,base.value,-20,20)
    }));
  }
  function normalize(raw){
    const r=mergeDeep(CURRENT_PRESET,raw||{}),startYear=seasonStartYear(r.season);
    r.schema=SCHEMA;
    r.id=String(r.id||"mia-lega");r.name=String(r.name||"La mia lega");
    r.season=String(r.season||CURRENT_PRESET.season);
    r.league=r.league&&typeof r.league==="object"?r.league:{};
    r.league.participants=Math.round(num(r.league.participants,8,4,20));
    r.availability=r.availability==="multiple"?"multiple":"single";
    r.gameMode=r.gameMode==="classic"?"classic":"mantra";
    r.switchMode=["off","switch","plus"].includes(r.switchMode)?r.switchMode:"plus";
    r.budget.initial=Math.round(num(r.budget.initial,2500,1,100000));
    r.budget.minBid=Math.round(num(r.budget.minBid,1,1,1000));
    r.budget.minResidualPerSlot=Math.round(num(r.budget.minResidualPerSlot,r.budget.minBid,r.budget.minBid,1000));
    r.roster.total=Math.round(num(r.roster.total,25,1,100));
    r.roster.goalkeepers=Math.round(num(r.roster.goalkeepers,3,1,r.roster.total));
    r.roster.movement=Math.max(0,r.roster.total-r.roster.goalkeepers);
    r.roster.clubLimit=Math.round(num(r.roster.clubLimit,5,0,99));
    r.roster.hidden=bool(r.roster.hidden);
    r.underRules=(r.underRules||[]).map((x,index)=>{
      const maxAge=Math.round(num(x.maxAge,index?21:23,16,30));
      return {
        ...x,id:String(x.id||`under-${index+1}`),label:String(x.label||"UNDER"),enabled:x.enabled!==false,
        maxAge,birthYearFrom:Math.round(num(x.birthYearFrom,startYear-maxAge,1900,2100)),
        min:Math.round(num(x.min,0,0,r.roster.total))
      };
    });
    r.bench.size=Math.round(num(r.bench.size,12,0,50));
    r.bench.minGoalkeepers=Math.round(num(r.bench.minGoalkeepers,1,0,Math.min(10,r.bench.size)));
    r.bench.movement="variable";
    r.formation.timeoutMinutes=Math.round(num(r.formation.timeoutMinutes,5,0,120));
    r.formation.hidden=bool(r.formation.hidden);
    r.formation.missingLineup="previous";
    r.scoring.source=["fantacalcio","italia","statistical"].includes(r.scoring.source)?r.scoring.source:"fantacalcio";
    Object.keys(DEFAULT_BONUSES).forEach(key=>{r.scoring.bonuses[key]=num(r.scoring.bonuses[key],DEFAULT_BONUSES[key],-50,50)});
    r.scoring.goalThreshold.firstGoal=num(r.scoring.goalThreshold.firstGoal,66,0,200);
    r.scoring.goalThreshold.mode="fixed";
    r.scoring.goalThreshold.step=num(r.scoring.goalThreshold.step,6,.5,50);
    r.scoring.limitWin.enabled=bool(r.scoring.limitWin.enabled);
    r.scoring.limitWin.delta=num(r.scoring.limitWin.delta,0,0,50);
    r.scoring.limitDraw.enabled=bool(r.scoring.limitDraw.enabled);
    r.scoring.limitDraw.delta=num(r.scoring.limitDraw.delta,0,0,50);
    r.scoring.autoGoal.enabled=bool(r.scoring.autoGoal.enabled);
    r.scoring.autoGoal.threshold=num(r.scoring.autoGoal.threshold,0,0,200);
    r.scoring.bookedNoVote=bool(r.scoring.bookedNoVote);
    r.modifiers.dFactor.enabled=bool(r.modifiers.dFactor.enabled);
    r.modifiers.dFactor.includeGoalkeeper=bool(r.modifiers.dFactor.includeGoalkeeper);
    r.modifiers.dFactor.applyTo=r.modifiers.dFactor.applyTo==="opponent"?"opponent":"own";
    r.modifiers.dFactor.preset=r.modifiers.dFactor.preset==="custom"?"custom":"recommended";
    r.modifiers.dFactor.bands=normalizeBands(r.modifiers.dFactor.bands);
    r.modifiers.performance.enabled=bool(r.modifiers.performance.enabled);
    r.modifiers.fairplay.enabled=bool(r.modifiers.fairplay.enabled);
    r.modifiers.fairplay.bonus=num(r.modifiers.fairplay.bonus,.5,-10,10);
    r.modifiers.captain.enabled=bool(r.modifiers.captain.enabled);
    r.modifiers.captain.bands=Array.isArray(r.modifiers.captain.bands)?r.modifiers.captain.bands:[];
    r.auction.singleAvailability=r.availability==="single";
    return r;
  }
  function rawStored(){
    for(const key of [STORAGE_KEY,PREVIOUS_KEY,LEGACY_KEY]){
      try{const raw=JSON.parse(localStorage.getItem(key)||"null");if(raw)return {key,raw}}catch{}
    }
    return {key:"",raw:null};
  }
  function load(){
    const stored=rawStored(),normalized=normalize(stored.raw||CURRENT_PRESET);
    if(stored.key!==STORAGE_KEY){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized))}catch{}}
    return normalized;
  }
  function save(reg){
    const normalized=normalize(reg);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("fa2:regulation-changed",{detail:normalized}));
    return normalized;
  }
  function reset(){return save(CURRENT_PRESET)}
  function enabledUnder(reg=load()){return (reg.underRules||[]).filter(x=>x.enabled&&x.min>0)}
  function underRule(reg,id){return (reg?.underRules||[]).find(x=>x.id===id)||null}

  /* Segnali leggeri, calcolati una volta per analisi. Le regole operative
     (visibilità/timeout) restano persistite ma non alterano il valore d'asta. */
  function strategicImpact(reg=load()){
    const r=reg||CURRENT_PRESET,b=r.scoring?.bonuses||DEFAULT_BONUSES,threshold=r.scoring?.goalThreshold||{};
    const sourceHistoryMultiplier=r.scoring?.source==="statistical"?1.16:r.scoring?.source==="italia"?1.06:1;
    const assist=(num(b.assistStandard,1)+num(b.assistSoft,1)+num(b.assistGold,1))/3;
    const attackEventWeight=Math.max(.35,Math.min(2,(num(b.goal,3)/3*.62+assist*.28+num(b.penaltyScored,3)/3*.10)));
    const disciplineWeight=Math.max(.25,Math.min(3,(Math.abs(num(b.yellow,-.5))/.5+Math.abs(num(b.red,-1)))/2*(r.scoring?.bookedNoVote?0.88:1.12)));
    const goalkeeperDepth=1+(num(r.roster?.goalkeepers,3,1,20)-3)*.035+(num(r.bench?.minGoalkeepers,1,0,10)-1)*.025;
    const goalkeeperWeight=Math.max(.3,Math.min(2.5,(Math.abs(num(b.goalAgainst,-1))+num(b.penaltySaved,3)/3+Math.max(0,num(b.cleanSheet,1)))/3*goalkeeperDepth));
    const thresholdAttackBias=Math.max(.7,Math.min(1.35,(66/Math.max(1,num(threshold.firstGoal,66))*.35+6/Math.max(.5,num(threshold.step,6))*.65)));
    const winImpact=r.scoring?.limitWin?.enabled ? .04+Math.min(.08,num(r.scoring.limitWin.delta,0,0,50)/250) : 0;
    const drawImpact=r.scoring?.limitDraw?.enabled ? .04+Math.min(.08,num(r.scoring.limitDraw.delta,0,0,50)/250) : 0;
    const autoImpact=r.scoring?.autoGoal?.enabled ? .02+Math.min(.06,num(r.scoring.autoGoal.threshold,0,0,200)/1000) : 0;
    const floorBias=Math.max(.75,Math.min(1.3,1+winImpact-drawImpact*.5+(r.modifiers?.performance?.enabled ? .08 : 0)));
    const ceilingBias=Math.max(.75,Math.min(1.3,1+drawImpact+autoImpact));
    const depthDemand=Math.max(.7,Math.min(1.4,(num(r.bench?.size,12)/12)*(!r.scoring?.bookedNoVote?1.06:1)));
    const availabilitySupplyMultiplier=r.availability==="multiple"?1.35:1;
    return {sourceHistoryMultiplier,attackEventWeight,disciplineWeight,goalkeeperWeight,thresholdAttackBias,floorBias,ceilingBias,depthDemand,availabilitySupplyMultiplier};
  }
  const per90=(total,minutes)=>minutes>0?num(total,0)*90/minutes:0;
  function playerAdjustment(player,pi,reg=load(),signals=strategicImpact(reg)){
    if(!pi||typeof pi!=="object")return 0;
    const stats=pi.weighted||pi.latest||{},minutes=Math.max(0,num(stats.minutes,0));
    if(minutes<90)return 0;
    const b=reg?.scoring?.bonuses||DEFAULT_BONUSES,base=DEFAULT_BONUSES;
    const goals90=per90(stats.goals,minutes),assists90=per90(stats.assists,minutes),cards90=num(stats.cards90,per90(stats.cards,minutes));
    const penaltyScored90=per90(stats.penaltiesScored,minutes),penaltyMissed90=per90(stats.penaltiesMissed,minutes),penaltySaved90=per90(stats.penaltiesSaved,minutes);
    const ga90=num(stats.ga90,0),cleanSheet=num(stats.cleanSheetPct,0)/100,rating=num(stats.rating,6.5);
    const reparto=String(player?.reparto||pi?.positionGroup||"").toUpperCase(),isGoalkeeper=reparto==="POR";
    const assistBonus=(num(b.assistStandard,1)+num(b.assistSoft,1)+num(b.assistGold,1))/3;
    const baseAssist=(base.assistStandard+base.assistSoft+base.assistGold)/3;
    let delta=0;
    delta+=goals90*((num(b.goal,3)-base.goal)+(num(b.equalizer,0)-base.equalizer)*.22+(num(b.winner,0)-base.winner)*.22)*2.4;
    delta+=assists90*(assistBonus-baseAssist)*1.9;
    delta+=penaltyScored90*(num(b.penaltyScored,3)-base.penaltyScored)*1.6;
    delta+=penaltyMissed90*(num(b.penaltyMissed,-3)-base.penaltyMissed)*1.6;
    if(isGoalkeeper){
      delta+=penaltySaved90*(num(b.penaltySaved,3)-base.penaltySaved)*1.6;
      delta+=ga90*(num(b.goalAgainst,-1)-base.goalAgainst)*.7;
      delta+=cleanSheet*(num(b.cleanSheet,1)-base.cleanSheet)*1.8;
    }
    delta+=cards90*((num(b.yellow,-.5)-base.yellow)*.85+(num(b.red,-1)-base.red)*.15)*1.4;
    delta+=Math.max(0,rating-6.7)*(num(b.playerOfMatch,.5)-base.playerOfMatch)*1.2;
    if(reg?.modifiers?.captain?.enabled)delta+=(rating-6.5)*1.6*(num(pi.reliability,50)/100);
    if(reg?.modifiers?.performance?.enabled)delta+=(rating-6.4)*1.25;
    /* Il preset storico (Fairplay attivo a 0,5) deve essere neutro: A4 non
       cambia da sola una strategia già validata. Solo una modifica reale del
       regolamento introduce il relativo delta. */
    const fairplayProfile=0.55-Math.min(.9,cards90);
    if(reg?.modifiers?.fairplay?.enabled)delta+=fairplayProfile*(num(reg.modifiers.fairplay.bonus,.5)-.5)*.9;
    else delta-=fairplayProfile*.5*.9;
    if(isGoalkeeper)delta+=(signals.goalkeeperWeight-1)*2.2;
    return Math.max(-8,Math.min(8,delta));
  }
  function summary(reg=load()){
    return {
      budget:reg.budget.initial,
      participants:reg.league.participants,
      analysisPool:reg.league.participants*reg.roster.total,
      roster:`${reg.roster.total} · ${reg.roster.goalkeepers} POR`,
      availability:reg.availability==="single"?"Singola":"Multipla",
      mode:String(reg.gameMode||"").toUpperCase(),
      under:enabledUnder(reg).map(x=>`${x.label} ${x.min}`).join(" · ")||"Nessun vincolo",
      clubLimit:reg.roster.clubLimit||"—",
      switchMode:reg.switchMode,
      scoringSource:reg.scoring.source==="statistical"?"Statistico":reg.scoring.source==="italia"?"Italia":"Fantacalcio",
      goalBands:`${reg.scoring.goalThreshold.firstGoal} +${reg.scoring.goalThreshold.step}`,
      modifiers:[reg.modifiers.dFactor.enabled?"D Factor":null,reg.modifiers.performance.enabled?"Rendimento":null,reg.modifiers.fairplay.enabled?"Fairplay":null,reg.modifiers.captain.enabled?"Capitano":null].filter(Boolean).join(" · ")||"Nessuno"
    };
  }
  window.FA2Regulation={
    SCHEMA,STORAGE_KEY,PREVIOUS_KEY,LEGACY_KEY,CURRENT_PRESET:clone(CURRENT_PRESET),DEFAULT_BANDS:clone(DEFAULT_BANDS),
    load,save,reset,normalize,enabledUnder,underRule,summary,strategicImpact,playerAdjustment,seasonStartYear
  };
})();
