const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const strategicPlayers = window.PLAYERS || [];
const marketSeed = window.MARKET_PLAYERS || [];
const marketMeta = window.MARKET_META || {};
const players = strategicPlayers; // compatibilità con il codice storico
const baseFormations = [];
let formations = [];
const FORMATIONS_LIVE_STORAGE="fa2_formations_live_v1";
const FORMATIONS_LIVE_SCHEMA=1;
const FORMATIONS_LIVE_CHECKED_STORAGE="fa2_formations_live_checked_at";
let formationsLiveCheckedAt=0;
let formationsLiveFeed=null;
let formationsLiveLoading=false;
let formationsLiveError="";
const AVAILABILITY_LIVE_STORAGE="fa2_availability_live_v1";
const AVAILABILITY_LIVE_SCHEMA=1;
const AVAILABILITY_LIVE_CHECKED_STORAGE="fa2_availability_live_checked_at";
let availabilityLiveCheckedAt=0;
let availabilityLiveFeed=null;
let availabilityLiveLoading=false;
let availabilityLiveError="";

const LISTONE_SYNC_STORAGE="fa2_listone_sync";
const LISTONE_SYNC_SCHEMA=2;

function safeJsonParse(raw,fallback=null){
  try{return raw?JSON.parse(raw):fallback}catch{return fallback}
}
/* A7.0: il Listone manuale è l'unica fonte sportiva dell'app. */
formationsLiveFeed=null;
availabilityLiveFeed=null;
formationsLiveCheckedAt=0;
availabilityLiveCheckedAt=0;
let fa2AppRegulationCache=null;
function currentRegulation(){
  if(fa2AppRegulationCache)return fa2AppRegulationCache;
  fa2AppRegulationCache=window.FA2Regulation?.load?.()||{
    league:{participants:8},
    budget:{initial:2500,minBid:1,minResidualPerSlot:1},roster:{total:25,goalkeepers:3,movement:22,clubLimit:5},
    underRules:[{id:"u23",enabled:true,birthYearFrom:2003,min:2},{id:"u21",enabled:true,birthYearFrom:2005,min:1}]
  };
  return fa2AppRegulationCache;
}
function configuredBudget(){return Math.max(1,Number(currentRegulation()?.budget?.initial)||2500)}
function configuredMinBid(){return Math.max(1,Number(currentRegulation()?.budget?.minBid)||1)}
function configuredReservePerSlot(){return Math.max(configuredMinBid(),Number(currentRegulation()?.budget?.minResidualPerSlot)||1)}
function configuredRosterTotal(){return Math.max(1,Number(currentRegulation()?.roster?.total)||25)}
function configuredGoalkeepers(){return Math.max(1,Number(currentRegulation()?.roster?.goalkeepers)||3)}
function configuredClubLimit(){return Math.max(0,Number(currentRegulation()?.roster?.clubLimit)||0)}
function configuredParticipants(){return Math.max(4,Math.min(20,Math.round(Number(currentRegulation()?.league?.participants)||8)))}
function configuredUnderRule(id){return (currentRegulation()?.underRules||[]).find(rule=>rule.id===id)||null}
let appliedListoneSync=safeJsonParse(localStorage.getItem(LISTONE_SYNC_STORAGE),null);
let pendingListoneSnapshot=null;

function normalizePlayerName(name){
  return String(name||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

// Requisiti giovani 2026/27. La base Clean Data conserva soltanto
// l'anno di nascita facoltativo fornito dall'utente.
const YOUTH_RULES_2627={u23MinBirthYear:2003,u21MinBirthYear:2005};
const YOUTH_BIRTHDATE_OVERRIDES_2627={};
function normalizedBirthDate(value){
  const raw=String(value||"").trim();
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?raw:"";
}
function playerBirthDate(p){
  if(!p)return "";
  return normalizedBirthDate(p.birthDate)||YOUTH_BIRTHDATE_OVERRIDES_2627[normalizePlayerName(p.name)]||"";
}
function playerBirthYear(p){
  const date=playerBirthDate(p);
  if(date)return Number(date.slice(0,4))||0;
  const y=Number(p?.birthYear||0);
  return Number.isFinite(y)?y:0;
}
function isU21Player(p){
  const y=playerBirthYear(p),rule=configuredUnderRule("u21"),from=Number(rule?.birthYearFrom)||YOUTH_RULES_2627.u21MinBirthYear;
  return !!p && (y>0?y>=from:!!p.u21);
}
function isU23Player(p){
  const y=playerBirthYear(p),rule=configuredUnderRule("u23"),from=Number(rule?.birthYearFrom)||YOUTH_RULES_2627.u23MinBirthYear;
  return !!p && (y>0?y>=from:(isU21Player(p)||!!p.u23));
}
function playerMatchesUnderRule(p,rule){
  if(!p||!rule)return false;
  const y=playerBirthYear(p),from=Number(rule.birthYearFrom)||0;
  if(y>0&&from>0)return y>=from;
  return rule.id==="u21"?!!p.u21:rule.id==="u23"?(!!p.u23||!!p.u21):false;
}
function youthLabel(p){
  return isU21Player(p)?"U21 + U23":isU23Player(p)?"U23":"—";
}
function birthDateLabel(p){
  const d=playerBirthDate(p);
  if(!d)return "";
  const [y,m,day]=d.split("-");
  return `${day}/${m}/${y}`;
}
function validMantraRole(role){
  const allowed=new Set(Object.keys(window.FA2MantraRules?.ROLE_META||{Por:1,Dd:1,Ds:1,Dc:1,B:1,E:1,M:1,C:1,W:1,T:1,A:1,Pc:1}));
  const tokens=window.FA2MantraRules?.normalizeRoleTokens?.(role)||String(role||"").split("/").filter(Boolean);
  return tokens.length>0 && tokens.every(x=>allowed.has(x));
}
function normalizeMantraRoleInput(value){
  if(window.FA2ListoneImporter?.normalizeRole)return window.FA2ListoneImporter.normalizeRole(value);
  const canonical={por:"Por",dd:"Dd",ds:"Ds",dc:"Dc",b:"B",e:"E",m:"M",c:"C",w:"W",t:"T",a:"A",pc:"Pc"};
  return String(value||"").split(/[\/;]+/).map(token=>canonical[token.trim().toLowerCase()]||token.trim()).filter(Boolean).join("/");
}
function mantraRoleDisplay(value){return window.FA2MantraRules?.displayRole?.(value)||String(value||"—")}
function mantraRoleTone(value){return window.FA2MantraRules?.toneClass?.(value)||"role-tone-neutral"}
function mantraRoleAccessibleLabel(value){return window.FA2MantraRules?.accessibleRoleLabel?.(value)||`Ruolo ${String(value||"non disponibile")}`}
function mantraRoleChipHTML(value,className="mantra-role-chip"){
  return `<span class="${escAttr(className)} ${escAttr(mantraRoleTone(value))}" aria-label="${escAttr(mantraRoleAccessibleLabel(value))}">${esc(mantraRoleDisplay(value))}</span>`;
}
function localField(value,max=80){
  return String(value??"").replace(/[<>\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function localPlayerId(seed){
  let hash=2166136261;for(const ch of String(seed||"")){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619)}
  return `local_${(hash>>>0).toString(36)}`;
}
function inferRepartoFromRole(role,classic=""){
  const c=String(classic||"").toUpperCase();
  if(c==="P")return "POR";
  if(c==="D")return "DIF";
  if(c==="C")return "CEN";
  if(c==="A")return "ATT";
  const t=String(role||"").split("/");
  if(t.includes("Por"))return "POR";
  if(t.some(x=>["W","T","A","Pc"].includes(x)))return "ATT";
  if(t.some(x=>["E","M","C"].includes(x)))return "CEN";
  return "DIF";
}
function marketTier(fvm){
  const v=Number(fvm||0);
  if(v>=180)return "TOP";
  if(v>=90)return "SEMITOP";
  if(v>=45)return "TITOLARE";
  if(v>=20)return "VALUE";
  if(v>=8)return "ROTAZIONE";
  return "LOW COST";
}
function enrichMarketPlayer(p){
  const birthDate=playerBirthDate(p);
  const birthYear=birthDate?Number(birthDate.slice(0,4)):(Number(p.birthYear||0)||0);
  const u21=!!p.u21 || (birthYear>0 && birthYear>=YOUTH_RULES_2627.u21MinBirthYear);
  const u23=u21 || !!p.u23 || (birthYear>0 && birthYear>=YOUTH_RULES_2627.u23MinBirthYear);
  return {
    ...p,
    maxPrice:Number(p.maxPrice??p.marketMax??Math.max(1,Math.round(Number(p.fvm||0)*2.5))),
    tier:p.tier||marketTier(p.fvm),
    starter:p.starter||"Listone",
    setPieces:p.setPieces||"—",
    birthDate,
    birthYear,
    u23,
    u21,
    modifier:p.modifier||"—",
    notes:p.notes||"LISTONE COMPLETO · MAX neutro da FVM ×2,5",
    strategic:!!p.strategic,
    officialActive:p.officialActive!==false,
    outOfListone:!!p.outOfListone,
    syncPendingRole:!!p.syncPendingRole
  };
}
function basePlayerMap(){
  const byName=new Map();
  return byName;
}
function buildAllPlayers(){
  const byName=basePlayerMap();
  const sync=appliedListoneSync;
  if(syncSnapshotValid(sync)){
    const seen=new Set();
    sync.players.forEach(s=>{
      const key=s.key||normalizePlayerName(s.name);
      if(!key)return;
      seen.add(key);
      const base=byName.get(key);
      const strategic=!!base?.strategic;
      const role=validMantraRole(s.role)?s.role:(base?.role||"?");
      const fvm=Number(s.fvm??base?.fvm??0);
      let merged={
        ...(base||{}),
        id:s.id||localPlayerId(`${key}|${s.club||""}`),
        name:s.name||base?.name||key,
        club:s.club||base?.club||"—",
        role,
        reparto:s.reparto||base?.reparto||inferRepartoFromRole(role,s.classic||base?.classic||""),
        classic:s.classic||base?.classic||"",
        quote:Number(s.quote??base?.quote??0),
        fvm,
        birthDate:normalizedBirthDate(s.birthDate)||base?.birthDate||"",
        birthYear:Number(s.birthYear??base?.birthYear??0)||0,
        strategic:false,
        officialActive:s.active!==false,
        outOfListone:s.active===false,
        syncPendingRole:!validMantraRole(role),
        syncSource:sync.sourceName||"File locale",
        syncGeneratedAt:sync.importedAt||sync.generatedAt||""
      };
      if(strategic){
        merged.maxPrice=Number(base.maxPrice||Math.max(1,Math.round(fvm*2.5)));
        merged.tier=base.tier;
        merged.starter=base.starter;
        merged.setPieces=base.setPieces;
        merged.u23=base.u23;
        merged.u21=base.u21;
        merged.modifier=base.modifier;
        merged.notes=base.notes;
        merged.primaryRole=base.primaryRole;
      }else{
        merged.marketMax=Math.max(1,Math.round(fvm*2.5));
        merged.maxPrice=merged.marketMax;
        merged.tier=marketTier(fvm);
        merged.notes=merged.outOfListone?"FUORI LISTONE · storico mercato":"LISTONE SINCRONIZZATO · MAX neutro da FVM ×2,5";
      }
      byName.set(key,enrichMarketPlayer(merged));
    });
    if(sync.complete===true){
      byName.forEach((p,key)=>{
        if(!seen.has(key))byName.set(key,enrichMarketPlayer({...p,officialActive:false,outOfListone:true}));
      });
    }
  }
  return [...byName.values()];
}
let allPlayers=buildAllPlayers();

function currentStrategicPlayers(){
  return allPlayers.filter(p=>p.strategic && (!p.outOfListone || state?.purchases?.[p.id] || state?.sold?.[p.id]));
}
function isMarketEligiblePlayer(p){
  return !!p && !p.outOfListone && validMantraRole(p.role);
}
function getPlayer(id){return allPlayers.find(p=>String(p.id)===String(id))}
function idArg(id){return JSON.stringify(String(id))}
function playerIsRosterAssigned(p){
  if(!p)return false;
  if(state?.purchases?.[p.id])return true;
  const sale=state?.sold?.[p.id];
  return !!sale?.teamId;
}
function playerNameText(p){
  if(!p)return "";
  return `${p.name}${p.outOfListone&&playerIsRosterAssigned(p)?" *":""}`;
}
function playerNameHTML(p){
  if(!p)return "";
  return `${esc(p.name)}${p.outOfListone&&playerIsRosterAssigned(p)?'<span class="out-name-marker" title="Fuori listone">*</span>':""}`;
}
function esc(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}
const DEFAULT_BUDGET = 2500;
const STRATEGIES = {
  A:{
    id:"A",
    module:"4-3-1-2",
    name:"Strategia A",
    budgets:{POR:250,DIF:550,CEN:725,ATT:975},
    slots:[
      {label:"Por",roles:["Por"]},
      {label:"Dd",roles:["Dd"]},{label:"Dc",roles:["Dc"]},{label:"Dc",roles:["Dc"]},{label:"Ds",roles:["Ds"]},
      {label:"M/C",roles:["M","C"]},{label:"M",roles:["M"]},{label:"C",roles:["C"]},
      {label:"T",roles:["T"]},{label:"T/A/Pc",roles:["T","A","Pc"]},{label:"A/Pc",roles:["A","Pc"]}
    ],
    keySlots:[
      {label:"T",roles:["T"]},{label:"T/A/Pc",roles:["T","A","Pc"]},{label:"A/Pc",roles:["A","Pc"]}
    ],
    priority:"T + T/A/Pc + A/Pc",
    depth:"2 profili T · 4 profili A/Pc"
  },
  B:{
    id:"B",
    module:"4-3-3",
    name:"Strategia B",
    budgets:{POR:250,DIF:500,CEN:625,ATT:1125},
    slots:[
      {label:"Por",roles:["Por"]},
      {label:"Dd",roles:["Dd"]},{label:"Dc",roles:["Dc"]},{label:"Dc",roles:["Dc"]},{label:"Ds",roles:["Ds"]},
      {label:"M/C",roles:["M","C"]},{label:"M",roles:["M"]},{label:"C",roles:["C"]},
      {label:"W/A",roles:["W","A"]},{label:"A/Pc",roles:["A","Pc"]},{label:"W/A",roles:["W","A"]}
    ],
    keySlots:[
      {label:"W/A",roles:["W","A"]},{label:"A/Pc",roles:["A","Pc"]},{label:"W/A",roles:["W","A"]}
    ],
    priority:"W/A + A/Pc + W/A",
    depth:"4 profili W/A · 3 profili A/Pc"
  }
};

const AUCTION_PHASES = [
  {id:"POR",label:"Portieri",icon:""},
  {id:"DIF",label:"Difensori",icon:""},
  {id:"CEN",label:"Centrocampisti",icon:""},
  {id:"ATT",label:"Attaccanti",icon:""}
];
const PHASE_ROLE_INDEX = {Por:0,Dd:1,Ds:1,Dc:1,B:1,E:2,M:2,C:2,W:3,T:3,A:3,Pc:3};
const INTEL_FAMILIES = [
  {id:"Dd",label:"Dd",roles:["Dd"]},
  {id:"Ds",label:"Ds",roles:["Ds"]},
  {id:"Dc",label:"Dc",roles:["Dc","B"]},
  {id:"MC",label:"M/C",roles:["M","C"]},
  {id:"T",label:"T",roles:["T"]},
  {id:"WA",label:"W/A",roles:["W","A"]},
  {id:"APc",label:"A/Pc",roles:["A","Pc"]},
  {id:"Pc",label:"Pc",roles:["Pc"]}
];
const OPPONENT_ROLE_FAMILIES = [
  {id:"Por",label:"Por",roles:["Por"]},
  {id:"EW",label:"E/W",roles:["E","W"]},
  ...INTEL_FAMILIES
];

// Gli 11 schemi Mantra ufficiali. Gli slot alternativi sono rappresentati
// come insiemi di ruoli compatibili; servono per stimare la struttura potenziale
// delle rose avversarie durante l'asta a reparti.
const MANTRA_MODULES = [
  {id:"343",name:"3-4-3",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E"],["M","C"],["C"],["E"],["W","A"],["A","Pc"],["W","A"]]},
  {id:"3412",name:"3-4-1-2",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E"],["M","C"],["C"],["E"],["T"],["A","Pc"],["A","Pc"]]},
  {id:"3421",name:"3-4-2-1",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["M"],["M","C"],["E","W"],["E"],["T"],["T","A"],["A","Pc"]]},
  {id:"352",name:"3-5-2",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E","W"],["M","C"],["M"],["C"],["E"],["A","Pc"],["A","Pc"]]},
  {id:"3511",name:"3-5-1-1",slots:[
    ["Por"],["Dc"],["Dc"],["Dc","B"],["E","W"],["M"],["M"],["C"],["E","W"],["T","A"],["A","Pc"]]},
  {id:"433",name:"4-3-3",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["M"],["C"],["W","A"],["A","Pc"],["W","A"]]},
  {id:"4312",name:"4-3-1-2",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["M"],["C"],["T"],["T","A","Pc"],["A","Pc"]]},
  {id:"442",name:"4-4-2",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M","C"],["C"],["E","W"],["E"],["A","Pc"],["A","Pc"]]},
  {id:"4141",name:"4-1-4-1",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["C","T"],["T"],["E","W"],["W"],["A","Pc"]]},
  {id:"4411",name:"4-4-1-1",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["C"],["E","W"],["E","W"],["T","A"],["A","Pc"]]},
  {id:"4231",name:"4-2-3-1",slots:[
    ["Por"],["Dd"],["Dc"],["Dc"],["Ds"],["M"],["M","C"],["W","T"],["T"],["W","A"],["A","Pc"]]}
].map(m=>({...m,slots:m.slots.map((roles,i)=>({label:roles.join("/"),roles}))}));

const SERIES_A_CLUBS = [
  ["ATA","Atalanta"],["BOL","Bologna"],["CAG","Cagliari"],["COM","Como"],["FIO","Fiorentina"],
  ["FRO","Frosinone"],["GEN","Genoa"],["INT","Inter"],["JUV","Juventus"],["LAZ","Lazio"],
  ["LEC","Lecce"],["MIL","Milan"],["MON","Monza"],["NAP","Napoli"],["PAR","Parma"],
  ["ROM","Roma"],["SAS","Sassuolo"],["TOR","Torino"],["UDI","Udinese"],["VEN","Venezia"]
];
const roleOrder = ["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"];
const CLUB_KITS = {
  // Palette digitali ispirate ai colori sociali dichiarati dai club ufficiali.
  // Le maglie restano volutamente fantasy: nessun logo, sponsor o replica esatta del kit gara.
  ATA:"club-ata", BOL:"club-bol", CAG:"club-cag", COM:"club-com", FIO:"club-fio",
  FRO:"club-fro", GEN:"club-gen", INT:"club-int", JUV:"club-juv", LAZ:"club-laz",
  LEC:"club-lec", MIL:"club-mil", MON:"club-mon", NAP:"club-nap", PAR:"club-par",
  ROM:"club-rom", SAS:"club-sas", TOR:"club-tor", UDI:"club-udi", VEN:"club-ven"
};
function escAttr(s){return String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");}
function clubKitClass(club){return 'kit-'+String(CLUB_KITS[club]||'solid-neutral').replace(/[^a-z0-9-]/gi,'').toLowerCase();}
function kitHTML(club,size='sm',label=''){
  const aria=label?` aria-label="${escAttr(label)}" title="${escAttr(label)}"`:'';
  return `<span class="club-kit ${clubKitClass(club)} kit-${size}"${aria}></span>`;
}
const SET_PIECES_2627 = {};
function setPieceHTML(){return ""}
function sortedFormations(){
  return formations.slice().sort((a,b)=>String(a.team||"").localeCompare(String(b.team||""),"it",{sensitivity:"base"}));
}

const SET_PIECES_UPDATED_AT="";
const SAFETY_KEYS={
  protected:"fa2_protected_mode",
  watchlist:"fa2_watchlist",
  operationLog:"fa2_operation_log",
  undoStack:"fa2_undo_stack",
  snapshots:"fa2_snapshots",
  operationCount:"fa2_operation_count",
  backupActionCount:"fa2_backup_action_count",
  lastBackupActionCount:"fa2_last_backup_action_count"
};
const REPAIR_MARKET_STORAGE="fa2_repair_market_v1";

function normalizeRepairMarket(raw){
  const sessions=Array.isArray(raw?.sessions)?raw.sessions.filter(x=>x&&x.id).map(session=>({
    ...session,
    pausedAt:Number(session.pausedAt)||0,
    resumedAt:Number(session.resumedAt)||0,
    settings:{...(session.settings||{}),allowPromise:session.settings?.allowPromise!==false,excludeOutOfListoneFromLimit:session.settings?.excludeOutOfListoneFromLimit===true},
    releases:Array.isArray(session.releases)?session.releases:[],
    acquisitions:Array.isArray(session.acquisitions)?session.acquisitions.map(row=>({...row,limitExempt:row?.limitExempt===true})):[],
    promisedRelease:session.promisedRelease&&session.promisedRelease.playerId?{...session.promisedRelease,playerId:String(session.promisedRelease.playerId)}:null
  })):[];
  const activeSessionId=sessions.some(x=>x.id===raw?.activeSessionId&&!x.endedAt)?String(raw.activeSessionId):"";
  return {schema:1,activeSessionId,sessions};
}

const state = {
  purchases: JSON.parse(localStorage.getItem("fa2_purchases")||"{}"),
  sold: JSON.parse(localStorage.getItem("fa2_sold")||"{}"),
  pin: localStorage.getItem("fa2_pin")||"",
  view:"dashboardView",
  filter:"Tutti",
  query:"",
  clubFilter: safeJsonParse(localStorage.getItem("fa2_club_filter"),[])||[],
  strategy: localStorage.getItem("fa2_strategy") || "A",
  poolMode: "all",
  league: JSON.parse(localStorage.getItem("fa2_league")||"null"),
  auctionPhase: localStorage.getItem("fa2_auction_phase") || "POR",
  protectedMode: localStorage.getItem(SAFETY_KEYS.protected)==="1",
  watchlist: safeJsonParse(localStorage.getItem(SAFETY_KEYS.watchlist),{})||{},
  operationLog: safeJsonParse(localStorage.getItem(SAFETY_KEYS.operationLog),[])||[],
  undoStack: safeJsonParse(localStorage.getItem(SAFETY_KEYS.undoStack),[])||[],
  snapshots: safeJsonParse(localStorage.getItem(SAFETY_KEYS.snapshots),[])||[],
  repairMarket: normalizeRepairMarket(safeJsonParse(localStorage.getItem(REPAIR_MARKET_STORAGE),null))
};
function save(){localStorage.setItem("fa2_purchases",JSON.stringify(state.purchases))}
function saveSold(){localStorage.setItem("fa2_sold",JSON.stringify(state.sold))}
function saveLeague(){
  if(state.league) localStorage.setItem("fa2_league",JSON.stringify(state.league));
  else localStorage.removeItem("fa2_league");
}
function fa2SetRegulationParticipants(size){
  if(!window.FA2Regulation)return;
  const participants=Math.max(4,Math.min(20,Math.round(Number(size)||8))),reg=FA2Regulation.load();
  if(Number(reg?.league?.participants)===participants)return;
  reg.league={...(reg.league||{}),participants};
  FA2Regulation.save(reg);
}
function fa2MigrateRegulationParticipantsFromLeague(){
  if(!state.league?.size||!window.FA2Regulation)return;
  let stored=null;try{stored=JSON.parse(localStorage.getItem(FA2Regulation.STORAGE_KEY)||"null")}catch{}
  if(!stored?.league||!Number.isFinite(Number(stored.league.participants)))fa2SetRegulationParticipants(state.league.size);
}
function saveAuctionPhase(){localStorage.setItem("fa2_auction_phase",state.auctionPhase)}
function saveRepairMarket(){localStorage.setItem(REPAIR_MARKET_STORAGE,JSON.stringify(normalizeRepairMarket(state.repairMarket)))}
function cloneAuctionData(v){return JSON.parse(JSON.stringify(v??null))}
function saveSafetyState(){
  localStorage.setItem(SAFETY_KEYS.protected,state.protectedMode?"1":"0");
  localStorage.setItem(SAFETY_KEYS.watchlist,JSON.stringify(state.watchlist||{}));
  localStorage.setItem(SAFETY_KEYS.operationLog,JSON.stringify((state.operationLog||[]).slice(-100)));
  localStorage.setItem(SAFETY_KEYS.undoStack,JSON.stringify((state.undoStack||[]).slice(-10)));
  localStorage.setItem(SAFETY_KEYS.snapshots,JSON.stringify((state.snapshots||[]).slice(-8)));
}
function captureAuctionCore(){
  return {
    purchases:cloneAuctionData(state.purchases)||{},
    sold:cloneAuctionData(state.sold)||{},
    strategy:state.strategy,
    league:cloneAuctionData(state.league),
    auctionPhase:state.auctionPhase,
    watchlist:cloneAuctionData(state.watchlist)||{},
    repairMarket:cloneAuctionData(state.repairMarket)||normalizeRepairMarket(null)
  };
}
function applyAuctionCore(core){
  if(!core)return;
  const strategyBefore=fa2CaptureStrategySlotStates();
  state.purchases=cloneAuctionData(core.purchases)||{};
  state.sold=cloneAuctionData(core.sold)||{};
  if(STRATEGIES[core.strategy])state.strategy=core.strategy;
  state.league=cloneAuctionData(core.league);
  if(AUCTION_PHASES.some(x=>x.id===core.auctionPhase))state.auctionPhase=core.auctionPhase;
  state.watchlist=cloneAuctionData(core.watchlist)||{};
  state.repairMarket=normalizeRepairMarket(core.repairMarket||state.repairMarket);
  save();saveSold();saveLeague();saveAuctionPhase();saveRepairMarket();
  localStorage.setItem("fa2_strategy",state.strategy);
  saveSafetyState();
  fa2AfterAuctionStateChange("STATE_RESTORED","",strategyBefore);
}
function auditOnly(type,label){
  state.operationLog=[...(state.operationLog||[]),{id:`op_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,at:Date.now(),type,label}].slice(-100);
  saveSafetyState();
}
function createSafetySnapshot(reason="Snapshot manuale",silent=false){
  const snap={id:`snap_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,at:Date.now(),reason,state:captureAuctionCore()};
  state.snapshots=[...(state.snapshots||[]),snap].slice(-8);
  saveSafetyState();
  if(!silent)alert("Snapshot salvato.");
  return snap;
}
function ensureInitialSnapshot(){
  if(!(state.snapshots||[]).length)createSafetySnapshot("Ingresso v1.30 · punto iniziale",true);
}
function recordOperation(type,label,before,{undoable=true,count=true}={}){
  const id=`op_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const at=Date.now();
  state.operationLog=[...(state.operationLog||[]),{id,at,type,label}].slice(-100);
  if(undoable&&before){
    state.undoStack=[...(state.undoStack||[]),{id,at,type,label,before}].slice(-10);
  }
  if(count){
    const n=Number(localStorage.getItem(SAFETY_KEYS.operationCount)||0)+1;
    localStorage.setItem(SAFETY_KEYS.operationCount,String(n));
    if(n%10===0)createSafetySnapshot(`Automatico · ${n} operazioni`,true);
  }
  saveSafetyState();
}
function currentAssignmentCount(){
  return Object.keys(state.purchases||{}).length+Object.keys(state.sold||{}).length;
}
function getBackupActionCount(){
  const raw=localStorage.getItem(SAFETY_KEYS.backupActionCount);
  if(raw===null){
    const initial=currentAssignmentCount();
    localStorage.setItem(SAFETY_KEYS.backupActionCount,String(initial));
    return initial;
  }
  return Math.max(0,Number(raw)||0);
}
function getLastBackupActionCount(){
  return Math.max(0,Number(localStorage.getItem(SAFETY_KEYS.lastBackupActionCount)||0)||0);
}
function registerBackupRelevantAssignment(){
  const next=getBackupActionCount()+1;
  localStorage.setItem(SAFETY_KEYS.backupActionCount,String(next));
  updateBackupAlert();
}
function markExternalBackupDone(){
  const n=getBackupActionCount();
  localStorage.setItem(SAFETY_KEYS.lastBackupActionCount,String(n));
  updateBackupAlert();
}
function resetBackupReminderCounters(){
  localStorage.setItem(SAFETY_KEYS.backupActionCount,"0");
  localStorage.setItem(SAFETY_KEYS.lastBackupActionCount,"0");
  updateBackupAlert();
}
function updateBackupAlert(){
  const btn=$("#backupAlertBtn");
  if(!btn)return;
  const delta=getBackupActionCount()-getLastBackupActionCount();
  const due=delta>=10;
  btn.hidden=!due;
  btn.textContent="BACKUP";
  btn.setAttribute("aria-label",due?`Backup consigliato: ${delta} nuove assegnazioni dall'ultimo backup`:"Backup aggiornato");
  btn.title=due?`${delta} nuove assegnazioni dall'ultimo backup`:"";
}
function openBackupReminder(){
  switchView("settingsView");
  requestAnimationFrame(()=>{
    const card=$("#backupCard");
    if(card)card.scrollIntoView({behavior:"smooth",block:"center"});
  });
}
function protectedPermission(action){
  if(!state.protectedMode)return true;
  if(state.pin){
    const p=prompt(`Modalità ASTA PROTETTA attiva.\nInserisci il PIN per ${action}:`);
    if(p!==state.pin){if(p!==null)alert("PIN errato. Operazione annullata.");return false;}
    return true;
  }
  return confirm(`Modalità ASTA PROTETTA attiva.\n\nVuoi davvero ${action}?`);
}
function blockedByProtection(action){
  if(!state.protectedMode)return false;
  alert(`ASTA PROTETTA\n\n${action} è bloccato per evitare tocchi accidentali. Disattiva prima la protezione dalle Impostazioni.`);
  return true;
}
function toggleProtectedMode(){
  if(!state.protectedMode){
    createSafetySnapshot("Attivazione Asta protetta",true);
    state.protectedMode=true;saveSafetyState();auditOnly("PROTEZIONE","Modalità Asta protetta attivata");refresh();return;
  }
  if(!protectedPermission("disattivare la protezione"))return;
  state.protectedMode=false;saveSafetyState();auditOnly("PROTEZIONE","Modalità Asta protetta disattivata");refresh();
}
window.toggleProtectedMode=toggleProtectedMode;
function isWatchlisted(id){return !!state.watchlist?.[String(id)]}
function toggleWatchlist(id){
  const p=getPlayer(id);if(!p)return;
  const before=captureAuctionCore();
  const key=String(p.id);
  if(state.watchlist[key])delete state.watchlist[key];else state.watchlist[key]=true;
  saveSafetyState();
  recordOperation("WATCHLIST",`${state.watchlist[key]?"Aggiunto":"Rimosso"} ${p.name} ${state.watchlist[key]?"alla":"dalla"} watchlist`,before,{undoable:true,count:false});
  refresh();
  if($("#playerDialog")?.open)openPlayer(p.id);
}
window.toggleWatchlist=toggleWatchlist;
function formatLogTime(ts){
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(ts));
}
function undoOperation(id){
  const stack=state.undoStack||[];
  const idx=stack.findIndex(x=>x.id===id);if(idx<0)return;
  const item=stack[idx];
  if(!confirm(`Ripristinare lo stato precedente a:\n\n${item.label}?`))return;
  applyAuctionCore(item.before);
  state.undoStack=stack.slice(0,idx);
  auditOnly("UNDO",`Ripristino: ${item.label}`);
  closeSafetyDialog();refresh();
}
window.undoOperation=undoOperation;
function restoreSafetySnapshot(id){
  const snap=(state.snapshots||[]).find(x=>x.id===id);if(!snap)return;
  if(!protectedPermission(`ripristinare lo snapshot “${snap.reason}”`))return;
  const before=captureAuctionCore();
  applyAuctionCore(snap.state);
  recordOperation("SNAPSHOT",`Ripristinato snapshot: ${snap.reason}`,before,{undoable:true,count:false});
  closeSafetyDialog();refresh();
}
window.restoreSafetySnapshot=restoreSafetySnapshot;
function closeSafetyDialog(){const d=$("#safetyDialog");if(d?.open)d.close()}
window.closeSafetyDialog=closeSafetyDialog;
function openSafetyCenter(){
  const logs=(state.operationLog||[]).slice().reverse().slice(0,30);
  const undo=(state.undoStack||[]).slice().reverse();
  const snaps=(state.snapshots||[]).slice().reverse();
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body safety-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">Safety & Control</div><h2>Registro e ripristino</h2></div><button class="ghost" type="button" aria-label="Chiudi Registro e ripristino" onclick="closeSafetyDialog()">✕</button></div>
    <div class="safety-tabs-summary"><span>Registro <b>${state.operationLog.length}</b></span><span>Undo <b>${state.undoStack.length}/10</b></span><span>Snapshot <b>${state.snapshots.length}/8</b></span></div>
    <div class="safety-action-row"><button class="primary" onclick="createSafetySnapshot('Snapshot manuale');closeSafetyDialog();refresh()">Salva snapshot</button><button class="ghost" onclick="openFinalReport()">Report asta</button></div>
    <section class="safety-section"><h3>Undo multiplo</h3>${undo.length?undo.map(x=>`<button class="undo-entry" onclick="undoOperation('${x.id}')"><span><b>${esc(x.label)}</b><small>${formatLogTime(x.at)}</small></span><strong>Ripristina</strong></button>`).join(""):`<div class="safety-empty">Nessuna operazione da annullare.</div>`}</section>
    <section class="safety-section"><h3>Snapshot</h3>${snaps.length?snaps.map(x=>`<button class="snapshot-entry" onclick="restoreSafetySnapshot('${x.id}')"><span><b>${esc(x.reason)}</b><small>${formatLogTime(x.at)}</small></span><strong>Apri</strong></button>`).join(""):`<div class="safety-empty">Nessuno snapshot.</div>`}</section>
    <section class="safety-section"><h3>Registro operazioni</h3>${logs.length?logs.map(x=>`<div class="log-entry"><span class="log-type">${esc(x.type)}</span><div><b>${esc(x.label)}</b><small>${formatLogTime(x.at)}</small></div></div>`).join(""):`<div class="safety-empty">Registro vuoto.</div>`}</section>
  </div>`;
  $("#safetyDialog").showModal();
}
window.openSafetyCenter=openSafetyCenter;

function openTechnicalInformation(){
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body safety-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">Architettura locale A7.0.1</div><h2>Informativa tecnica</h2></div><button class="ghost" type="button" aria-label="Chiudi informativa tecnica" onclick="closeSafetyDialog()">✕</button></div>
    <section class="safety-section"><h3>Dati utilizzati</h3><p>FantaAsta 2.0 non include database sportivi. Usa soltanto il Listone scelto e importato manualmente dall’utente, i parametri del regolamento e le operazioni d’asta inserite nel dispositivo.</p></section>
    <section class="safety-section"><h3>Elaborazione locale</h3><p>Listone, rose, prezzi, crediti e strategia restano nel browser. L’app non invia questi dati a GitHub o ad altri server e non richiede un account.</p></section>
    <section class="safety-section"><h3>Fonti esterne</h3><p>Scraping, aggiornamenti automatici e API sportive sono disattivati. L’app non importa automaticamente statistiche, probabili formazioni, infortuni o disciplina.</p></section>
    <section class="safety-section"><h3>Responsabilità del file</h3><p>L’utente deve usare un file ottenuto legittimamente e nel rispetto delle condizioni della fonte. L’importazione locale non concede diritti di redistribuzione sui dati di terzi.</p></section>
    <button class="primary full-btn" type="button" onclick="closeSafetyDialog()">Chiudi e torna alle impostazioni</button>
  </div>`;
  $("#safetyDialog").showModal();
}
window.openTechnicalInformation=openTechnicalInformation;

function repairRuleLabel(rule){
  const labels={purchasePct:"prezzo di acquisto",quotePct:"quotazione attuale",fvmpPct:"FVMp",fixed:"valore fisso"};
  return rule?.type==="fixed"?`${fmt(rule.value||0)} cr fissi`:`${fmt(rule?.value||0)}% ${labels[rule?.type]||labels.purchasePct}`;
}
function repairReferenceValue(p,purchase,rule){
  if(rule?.type==="quotePct")return Math.max(0,Number(p?.quote||0));
  if(rule?.type==="fvmpPct")return Math.max(0,Number(p?.fvm||0)*configuredBudget()/1000);
  return Math.max(0,Number(purchase?.price||0));
}
function repairRefundForPlayer(p,purchase,settings=activeRepairSession()?.settings){
  const rule=p?.outOfListone?settings?.outOfListRule:settings?.ordinaryRule;
  const raw=rule?.type==="fixed"?Number(rule.value||0):repairReferenceValue(p,purchase,rule)*Number(rule?.value||0)/100;
  return Math.max(0,settings?.rounding==="ceil"?Math.ceil(raw):Math.floor(raw));
}
function repairRuleOptions(selected){
  return [["purchasePct","% prezzo acquisto"],["quotePct","% quotazione attuale"],["fvmpPct","% FVMp"],["fixed","Valore fisso"]]
    .map(([value,label])=>`<option value="${value}" ${selected===value?"selected":""}>${label}</option>`).join("");
}
function repairSetupHTML(){
  const past=repairSessions(),pastReleases=past.reduce((sum,x)=>sum+(x.releases?.length||0),0),pastRefunds=past.flatMap(x=>x.releases||[]).reduce((sum,x)=>sum+Number(x.refund||0),0);
  return `<div class="dialog-body repair-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">Asta di riparazione · A5.8.2</div><h2>Configura nuova sessione</h2></div><button class="ghost" type="button" aria-label="Chiudi" onclick="closeSafetyDialog()">✕</button></div>
    <div class="repair-intro"><b>Regole della tua lega</b><span>La sessione usa le rose e i crediti già presenti. Nessuna assegnazione viene cancellata senza una tua conferma.</span>${past.length?`<span><strong>Storico:</strong> ${past.length} sessioni · ${pastReleases} svincoli · ${fmt(pastRefunds)} cr recuperati.</span>`:""}</div>
    <section class="repair-config-section"><h3>Acquisti consentiti</h3><div class="repair-field-grid">
      <label>Limite<select id="repairLimitMode"><option value="unlimited">Illimitati</option><option value="fixed">Numero fisso</option></select></label>
      <label>Numero<input id="repairLimitValue" type="number" inputmode="numeric" min="1" max="99" value="5" disabled></label>
    </div></section>
    <section class="repair-config-section"><h3>Valore svincoli ordinari</h3><div class="repair-field-grid">
      <label>Metodo<select id="repairOrdinaryType">${repairRuleOptions("purchasePct")}</select></label>
      <label>Valore / percentuale<input id="repairOrdinaryValue" type="number" inputmode="decimal" min="0" max="1000" value="50"></label>
    </div></section>
    <section class="repair-config-section"><h3>Calciatori fuori listone *</h3><p>Regola separata per chi non è più presente nel Listone Serie A.</p><div class="repair-field-grid">
      <label>Metodo<select id="repairOutType">${repairRuleOptions("purchasePct")}</select></label>
      <label>Valore / percentuale<input id="repairOutValue" type="number" inputmode="decimal" min="0" max="1000" value="100"></label>
    </div></section>
    <section class="repair-config-section"><h3>Opzioni</h3><div class="repair-choice-grid">
      <label class="fa2-check"><input id="repairPreventRebuy" type="checkbox" checked><span>Impedisci di riacquistare uno svincolato nella stessa sessione</span></label>
      <label>Arrotondamento<select id="repairRounding"><option value="floor">Per difetto</option><option value="ceil">Per eccesso</option></select></label>
      <label class="fa2-check repair-promise-option"><input id="repairAllowPromise" type="checkbox" checked><span><b>Consenti promessa di svincolo</b>Il giocatore resta in rosa finché non acquisti il sostituto.</span></label>
      <label class="fa2-check repair-limit-exemption"><input id="repairExcludeOutOfListone" type="checkbox"><span><b>Fuori listone esclusi dal limite</b>Le sostituzioni dei giocatori contrassegnati con * non consumano il numero massimo impostato.</span></label>
    </div></section>
    <div class="dialog-actions repair-sticky-actions"><button class="ghost" type="button" onclick="closeSafetyDialog()">Annulla</button><button class="primary" type="button" onclick="startRepairMarketSession()">Avvia sessione</button></div>
  </div>`;
}
function repairReleaseRows(session){
  const rows=(session?.releases||[]).slice().reverse();
  return rows.length?rows.map(row=>`<div class="repair-movement"><span><b>${esc(row.name)}</b><small>${row.outOfListone?"FUORI LISTONE · ":""}pagato ${fmt(row.originalPrice)} cr</small></span><strong>+${fmt(row.refund)} cr</strong></div>`).join(""):'<div class="safety-empty">Nessuno svincolo registrato.</div>';
}
function repairPromiseHTML(session){
  const promise=activeRepairPromise(session);if(!session?.settings?.allowPromise)return "";
  if(!promise)return `<section class="repair-promise-card empty"><span>PROMESSA DI SVINCOLO</span><b>Nessun giocatore promesso</b><small>Puoi indicarne uno qui sotto. Rosa e crediti cambieranno soltanto dopo il prossimo acquisto.</small></section>`;
  return `<section class="repair-promise-card active"><div><span>PROMESSA ATTIVA</span><b>${esc(promise.name)}</b><small>${esc(promise.club||"")} · ${esc(promise.role||"")} · pagato ${fmt(promise.originalPrice)} cr</small></div><div><strong>+${fmt(promise.refund)} cr</strong><small>solo dopo l'acquisto</small><button class="ghost" type="button" onclick="cancelRepairReleasePromise()">Annulla promessa</button></div></section>`;
}
function repairActiveHTML(session){
  const econ=teamEconomy(mineTeam()),owned=purchasedPlayers().slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"it"));
  const releasedTotal=(session.releases||[]).reduce((sum,x)=>sum+Number(x.refund||0),0),used=repairAcquisitionCount(session),exempt=repairExemptAcquisitionCount(session),totalAcquisitions=session.acquisitions?.length||0;
  const limit=session.settings.purchaseLimitMode==="fixed"?String(session.settings.purchaseLimit):"∞";
  const playerOptions=owned.map(p=>`<option value="${escAttr(String(p.id))}">${esc(p.name)} · ${p.role} · ${fmt(state.purchases[p.id]?.price||0)} cr${p.outOfListone?" *":""}</option>`).join("");
  return `<div class="dialog-body repair-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">Asta di riparazione · A5.8.2</div><h2>${esc(session.name||"Sessione attiva")}</h2></div><button class="ghost" type="button" aria-label="Chiudi" onclick="closeSafetyDialog()">✕</button></div>
    <div class="repair-status-kpis"><div class="featured"><span>Residuo reale</span><b>${fmt(econ.remaining)} cr</b></div><div><span>Rosa</span><b>${owned.length}/${configuredRosterTotal()}</b></div><div><span>Recuperati</span><b>+${fmt(releasedTotal)} cr</b></div><div><span>Sostituzioni conteggiate</span><b>${used}/${limit}</b><small>${exempt?`${exempt} fuori listone esclus${exempt===1?"a":"e"} · ${totalAcquisitions} totali`:"limite della sessione"}</small></div></div>
    <section class="repair-config-summary"><b>Regole attive</b><span>Ordinari: ${esc(repairRuleLabel(session.settings.ordinaryRule))}</span><span>Fuori listone: ${esc(repairRuleLabel(session.settings.outOfListRule))}</span><span>Arrotondamento ${session.settings.rounding==="ceil"?"per eccesso":"per difetto"}${session.settings.preventRebuy?" · riacquisto bloccato":""}${session.settings.allowPromise?" · promessa consentita":""}${session.settings.excludeOutOfListoneFromLimit?" · fuori listone esclusi dal limite":""}</span></section>
    ${repairPromiseHTML(session)}
    <section class="repair-release-card"><h3>Svincola un giocatore</h3>${owned.length?`<label>Giocatore<select id="repairReleasePlayer" onchange="renderRepairReleasePreview()">${playerOptions}</select></label><div id="repairReleasePreview"></div><div class="repair-release-actions"><button class="dangerbtn" type="button" onclick="confirmRepairRelease()">Svincola ora</button>${session.settings.allowPromise?`<button class="primary" type="button" onclick="setRepairReleasePromise()">${session.promisedRelease?"Cambia promessa":"Prometti svincolo"}</button>`:""}</div>`:'<div class="safety-empty">La rosa non contiene giocatori da svincolare.</div>'}</section>
    <section class="repair-config-section"><div class="repair-section-head"><h3>Movimenti sessione</h3><span>${session.releases.length} svincoli</span></div>${repairReleaseRows(session)}</section>
    <div class="repair-live-actions"><button class="primary" type="button" onclick="closeSafetyDialog();openAuctionLive()">Apri Asta Live</button><button class="ghost" type="button" onclick="pauseRepairMarketSession()">Sospendi asta</button><button class="dangerbtn" type="button" onclick="endRepairMarketSession()">Termina asta</button></div>
  </div>`;
}
function repairPausedHTML(session){
  const used=repairAcquisitionCount(session),exempt=repairExemptAcquisitionCount(session),limit=session.settings.purchaseLimitMode==="fixed"?session.settings.purchaseLimit:"∞",remaining=session.settings.purchaseLimitMode==="fixed"?Math.max(0,Number(session.settings.purchaseLimit)-used):"∞";
  return `<div class="dialog-body repair-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">Asta di riparazione · SOSPESA</div><h2>${esc(session.name||"Mercato di riparazione")}</h2></div><button class="ghost" type="button" aria-label="Chiudi" onclick="closeSafetyDialog()">✕</button></div><div class="repair-paused-card"><span>SESSIONE MEMORIZZATA</span><b>${used}/${limit} sostituzioni conteggiate</b><small>${session.acquisitions?.length||0} acquisti reali${exempt?` · ${exempt} fuori listone esclus${exempt===1?"o":"i"}`:""} · ${remaining} ancora disponibili</small><p>Rose, rimborsi, acquisti e limite residuo sono conservati. Finché la sessione è sospesa, le operazioni non vengono registrate come Asta di riparazione.</p></div><div class="repair-live-actions"><button class="primary" type="button" onclick="resumeRepairMarketSession()">Riprendi asta</button><button class="dangerbtn" type="button" onclick="endRepairMarketSession()">Termina definitivamente</button></div></div>`;
}
function openRepairMarket(){
  const dialog=$("#safetyDialog"),current=currentRepairSession(),session=activeRepairSession();
  $("#safetyDialogContent").innerHTML=session?repairActiveHTML(session):current?.pausedAt?repairPausedHTML(current):repairSetupHTML();
  if(!dialog.open)dialog.showModal();
  if(session)requestAnimationFrame(renderRepairReleasePreview);
  else requestAnimationFrame(()=>{const mode=$("#repairLimitMode"),input=$("#repairLimitValue");if(mode&&input)mode.onchange=()=>input.disabled=mode.value!=="fixed"});
}
window.openRepairMarket=openRepairMarket;
function startRepairMarketSession(){
  const limitMode=$("#repairLimitMode")?.value==="fixed"?"fixed":"unlimited",limit=Math.max(1,Math.round(Number($("#repairLimitValue")?.value)||1));
  const ordinaryType=$("#repairOrdinaryType")?.value||"purchasePct",outType=$("#repairOutType")?.value||"purchasePct";
  const ordinaryValue=Math.max(0,Number($("#repairOrdinaryValue")?.value)||0),outValue=Math.max(0,Number($("#repairOutValue")?.value)||0);
  const before=captureAuctionCore(),id=`repair_${Date.now()}`;
  const session={id,name:"Mercato di riparazione",startedAt:Date.now(),pausedAt:0,resumedAt:0,endedAt:0,settings:{purchaseLimitMode:limitMode,purchaseLimit:limit,ordinaryRule:{type:ordinaryType,value:ordinaryValue},outOfListRule:{type:outType,value:outValue},rounding:$("#repairRounding")?.value==="ceil"?"ceil":"floor",preventRebuy:!!$("#repairPreventRebuy")?.checked,allowPromise:!!$("#repairAllowPromise")?.checked,excludeOutOfListoneFromLimit:!!$("#repairExcludeOutOfListone")?.checked},releases:[],acquisitions:[],promisedRelease:null};
  state.repairMarket.sessions.push(session);state.repairMarket.activeSessionId=id;saveRepairMarket();
  createSafetySnapshot("Avvio asta di riparazione",true);recordOperation("RIPARAZIONE",`Avviata asta di riparazione · ${limitMode==="fixed"?limit+" acquisti":"acquisti illimitati"}`,before,{undoable:true,count:false});
  refresh();openRepairMarket();
}
window.startRepairMarketSession=startRepairMarketSession;
function renderRepairReleasePreview(){
  const root=$("#repairReleasePreview"),id=$("#repairReleasePlayer")?.value,p=getPlayer(id),purchase=p?state.purchases[p.id]:null,session=activeRepairSession();if(!root||!p||!purchase||!session)return;
  const refund=repairRefundForPlayer(p,purchase,session.settings),rule=p.outOfListone?session.settings.outOfListRule:session.settings.ordinaryRule;
  root.innerHTML=`<div class="repair-refund-preview"><span><b>${playerNameHTML(p)}</b><small>${p.club} · ${p.role}${p.outOfListone?" · FUORI LISTONE":""}</small></span><span><small>${esc(repairRuleLabel(rule))}</small><strong>Recuperi ${fmt(refund)} cr</strong></span></div>`;
}
window.renderRepairReleasePreview=renderRepairReleasePreview;
function setRepairReleasePromise(){
  const id=$("#repairReleasePlayer")?.value,p=getPlayer(id),purchase=p?state.purchases[p.id]:null,session=activeRepairSession();if(!p||!purchase||!session?.settings?.allowPromise)return;
  const refund=repairRefundForPlayer(p,purchase,session.settings),before=captureAuctionCore();
  if(!confirm(`Promettere lo svincolo di ${p.name}?\n\nIl giocatore resta in rosa e non ricevi ancora crediti. Dopo il prossimo acquisto verrà svincolato automaticamente e recupererai ${fmt(refund)} crediti.`))return;
  session.promisedRelease={playerId:String(p.id),name:p.name,club:p.club,role:p.role,originalPrice:Number(purchase.price||0),originalPurchase:cloneAuctionData(purchase),refund,outOfListone:!!p.outOfListone,promisedAt:Date.now()};
  saveRepairMarket();recordOperation("PROMESSA_SVINCOLO",`${p.name}: promessa di svincolo · rimborso previsto ${refund} cr`,before,{undoable:true,count:false});
  refresh();openRepairMarket();
}
window.setRepairReleasePromise=setRepairReleasePromise;
function cancelRepairReleasePromise(){
  const session=activeRepairSession(),promise=session?.promisedRelease;if(!promise)return;
  if(!confirm(`Annullare la promessa di svincolo di ${promise.name}?\n\nLa rosa e i crediti resteranno invariati.`))return;
  const before=captureAuctionCore();session.promisedRelease=null;saveRepairMarket();
  recordOperation("PROMESSA_ANNULLATA",`${promise.name}: promessa di svincolo annullata`,before,{undoable:true,count:false});
  refresh();openRepairMarket();
}
window.cancelRepairReleasePromise=cancelRepairReleasePromise;
function confirmRepairRelease(){
  const id=$("#repairReleasePlayer")?.value,p=getPlayer(id),purchase=p?state.purchases[p.id]:null,session=activeRepairSession();if(!p||!purchase||!session)return;
  const refund=repairRefundForPlayer(p,purchase,session.settings);
  if(!confirm(`Svincolare ${p.name}?\n\nPrezzo storico: ${fmt(purchase.price)} cr\nCredito recuperato: ${fmt(refund)} cr\n\nIl movimento potrà essere annullato dal Registro / Undo.`))return;
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
  session.releases.push({id:`release_${Date.now()}`,playerId:String(p.id),name:p.name,club:p.club,role:p.role,originalPrice:Number(purchase.price||0),refund,outOfListone:!!p.outOfListone,at:Date.now()});
  if(String(session.promisedRelease?.playerId||"")===String(p.id))session.promisedRelease=null;
  delete state.purchases[p.id];save();saveRepairMarket();
  fa2AfterAuctionStateChange("PLAYER_RELEASED",p.id,strategyBefore);registerBackupRelevantAssignment();
  recordOperation("SVINCOLO",`${p.name} svincolato · recuperati ${refund} cr`,before);
  refresh();openRepairMarket();
}
window.confirmRepairRelease=confirmRepairRelease;
function pauseRepairMarketSession(){
  const session=activeRepairSession();if(!session)return;
  if(!confirm(`Sospendere questa asta di riparazione?\n\nLe ${session.acquisitions?.length||0} sostituzioni effettuate, i rimborsi e il limite residuo verranno memorizzati.`))return;
  const before=captureAuctionCore();session.pausedAt=Date.now();saveRepairMarket();
  recordOperation("RIPARAZIONE",`Asta di riparazione sospesa · ${repairAcquisitionCount(session)} sostituzioni conteggiate`,before,{undoable:true,count:false});
  refresh();openRepairMarket();
}
window.pauseRepairMarketSession=pauseRepairMarketSession;
function resumeRepairMarketSession(){
  const session=pausedRepairSession();if(!session)return;
  const before=captureAuctionCore();session.pausedAt=0;session.resumedAt=Date.now();saveRepairMarket();
  recordOperation("RIPARAZIONE",`Asta di riparazione ripresa · ${repairAcquisitionCount(session)} sostituzioni già conteggiate`,before,{undoable:true,count:false});
  refresh();openRepairMarket();
}
window.resumeRepairMarketSession=resumeRepairMarketSession;
function endRepairMarketSession(){
  const session=currentRepairSession();if(!session)return;
  const economy=teamEconomy(mineTeam());
  if(economy.missing>0){alert(`Non puoi terminare l'asta di riparazione con ${economy.missing} ${economy.missing===1?"posto scoperto":"posti scoperti"}. Completa la rosa oppure usa la promessa di svincolo prima di congelarla.`);return;}
  const promiseText=session.promisedRelease?`\n\nLa promessa su ${session.promisedRelease.name} verrà annullata senza modificare rosa o crediti.`:"";
  if(!confirm(`Chiudere questa sessione di riparazione?\n\nRose, crediti recuperati e movimenti resteranno salvati.${promiseText}`))return;
  const before=captureAuctionCore();session.promisedRelease=null;session.pausedAt=0;session.endedAt=Date.now();state.repairMarket.activeSessionId="";saveRepairMarket();
  recordOperation("RIPARAZIONE",`Terminata asta di riparazione · ${session.releases.length} svincoli · ${session.acquisitions.length} acquisti`,before,{undoable:true,count:false});
  closeSafetyDialog();refresh();
}
window.endRepairMarketSession=endRepairMarketSession;
function parseFormationUpdated(raw){
  const m=String(raw||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m)return null;
  return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]||12),Number(m[5]||0));
}
function freshnessStatus(date,missingText="non disponibile"){
  if(!date||Number.isNaN(date.getTime()))return {cls:"stale",icon:"ATT",text:missingText};
  const h=Math.max(0,(Date.now()-date.getTime())/36e5);
  if(h<=24)return {cls:"fresh",icon:"OK",text:h<1?"adesso":`${Math.round(h)} h fa`};
  if(h<=72)return {cls:"aging",icon:"MID",text:`${Math.round(h)} h fa`};
  return {cls:"stale",icon:"OLD",text:`${Math.round(h/24)} gg fa`};
}
function dataFreshnessHTML(){
  const listIso=appliedListoneSync?.importedAt||appliedListoneSync?.generatedAt;
  const listDate=syncSnapshotValid(appliedListoneSync)&&listIso?new Date(listIso):null;
  const l=freshnessStatus(listDate,"da importare");
  return `<section class="freshness-card"><div class="freshness-title"><b>DATI IN USO</b><span>solo sul dispositivo</span></div><div class="freshness-grid">
    <div class="${l.cls}"><span>${l.icon} Listone</span><b>${l.text}</b></div>
    <div class="fresh"><span>LOCAL Operazioni</span><b>registrate in app</b></div>
    <div class="fresh"><span>ZERO Collegamenti</span><b>nessuna fonte esterna</b></div>
  </div></section>`;
}
function watchlistDashboardHTML(){
  const list=allPlayers.filter(p=>isWatchlisted(p.id)&&isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]);
  const top=list.slice().sort((a,b)=>liveMaxForPlayer(b).live-liveMaxForPlayer(a).live).slice(0,5);
  return `<section class="watch-dashboard-card"><div class="watch-dashboard-head"><div><span>WATCHLIST</span><b>${list.length} target ancora disponibili</b></div><button class="ghost" onclick="switchView('playersView');state.filter='Preferiti';renderPlayers()">Apri</button></div>
    ${top.length?`<div class="watch-dashboard-list">${top.map(p=>`<button onclick='openPlayer(${idArg(p.id)})'>${kitHTML(p.club,'xs',p.club)}<span><b>${esc(p.name)}</b><small>${p.club} · ${p.role}</small></span><strong>${fmt(liveMaxForPlayer(p).live)}<small>MAX live</small></strong></button>`).join("")}</div>`:`<div class="safety-empty">Usa SEGUI accanto a un giocatore per aggiungerlo.</div>`}
  </section>`;
}
function safetyDashboardHTML(){
  const last=state.operationLog?.[state.operationLog.length-1];
  return `<section class="safety-dashboard-card ${state.protectedMode?"protected":""}"><div class="safety-dashboard-status"><span>${state.protectedMode?"LOCK":"OPEN"}</span><div><b>${state.protectedMode?"ASTA PROTETTA":"Protezione disattivata"}</b><small>${last?`Ultima: ${esc(last.label)}`:"Registro pronto"}</small></div></div><div class="safety-dashboard-actions"><button class="${state.protectedMode?"protected-btn":"primary"}" onclick="toggleProtectedMode()">${state.protectedMode?"Sblocca":"Proteggi asta"}</button><button class="ghost" onclick="openSafetyCenter()">Registro</button></div></section>`;
}
function finalReportData(){
  const owned=purchasedPlayers(),reg=currentRegulation(),rosterTotal=configuredRosterTotal(),goalkeepers=configuredGoalkeepers(),clubLimit=configuredClubLimit();
  const total=spent(),remaining=teamEconomy(mineTeam()).remaining;
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};owned.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id]?.price||0));
  const deals=owned.map(p=>({p,price:Number(state.purchases[p.id]?.price||0),ratio:Number(state.purchases[p.id]?.price||0)/Math.max(1,Number(p.maxPrice||1))})).sort((a,b)=>a.ratio-b.ratio);
  const overs=deals.filter(x=>x.ratio>1).sort((a,b)=>b.ratio-a.ratio);
  const under=(reg.underRules||[]).filter(rule=>rule.enabled&&Number(rule.min)>0).map(rule=>({...rule,count:owned.filter(p=>playerMatchesUnderRule(p,rule)).length}));
  const u23=under.find(x=>x.id==="u23")?.count||owned.filter(isU23Player).length,u21=under.find(x=>x.id==="u21")?.count||owned.filter(isU21Player).length;
  const clubValid=!clubLimit||SERIES_A_CLUBS.every(([c])=>owned.filter(p=>p.club===c).length<=clubLimit);
  const valid=owned.length===rosterTotal&&owned.filter(p=>p.reparto==="POR").length===goalkeepers&&under.every(rule=>rule.count>=Number(rule.min))&&clubValid;
  return {owned,total,remaining,byRep,deals,overs,u23,u21,under,valid,rosterTotal,goalkeepers,clubLimit,avg:owned.length?Math.round(total/owned.length):0};
}
function openFinalReport(){
  const r=finalReportData();
  const topSpend=r.owned.slice().sort((a,b)=>Number(state.purchases[b.id]?.price||0)-Number(state.purchases[a.id]?.price||0)).slice(0,3);
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body final-report-body"><div class="safety-modal-head"><div><div class="eyebrow">Report asta</div><h2>${r.owned.length===r.rosterTotal?"Rosa completata":"Report parziale"}</h2></div><button class="ghost" type="button" aria-label="Chiudi report asta" onclick="closeSafetyDialog()">✕</button></div>
    <div class="report-status ${r.valid?"ok":"warn"}">${r.valid?"Rosa formalmente completa":"Rosa ancora in costruzione"} · ${r.owned.length}/${r.rosterTotal}</div>
    <div class="report-kpis"><div><span>Speso</span><b>${fmt(r.total)}</b></div><div><span>Residuo</span><b>${fmt(r.remaining)}</b></div><div><span>Media</span><b>${fmt(r.avg)}</b></div><div><span>Modulo</span><b>${activeStrategy().module}</b></div></div>
    <div class="report-reps">${["POR","DIF","CEN","ATT"].map(rep=>`<div><span>${rep}</span><b>${fmt(r.byRep[rep])}</b></div>`).join("")}</div>
    <section class="report-section"><h3>Migliori affari vs MAX</h3>${r.deals.slice(0,3).map(x=>`<div><span>${playerNameHTML(x.p)}<small>${x.p.club} · MAX ${fmt(x.p.maxPrice)}</small></span><b>${fmt(x.price)} cr</b></div>`).join("")||'<div class="safety-empty">Nessun acquisto.</div>'}</section>
    <section class="report-section"><h3>Investimenti principali</h3>${topSpend.map(p=>`<div><span>${playerNameHTML(p)}<small>${p.club} · ${p.role}</small></span><b>${fmt(state.purchases[p.id]?.price)} cr</b></div>`).join("")||'<div class="safety-empty">Nessun acquisto.</div>'}</section>
    <section class="report-section"><h3>Sopra MAX</h3>${r.overs.slice(0,3).map(x=>`<div><span>${playerNameHTML(x.p)}<small>MAX ${fmt(x.p.maxPrice)}</small></span><b>+${Math.round((x.ratio-1)*100)}%</b></div>`).join("")||'<div class="safety-empty">Nessun acquisto sopra MAX.</div>'}</section>
    ${state.league?(()=>{const rows=state.league.teams.map(t=>({t,e:teamEconomy(t)})).sort((a,b)=>b.e.spent-a.e.spent);const myRank=rows.findIndex(x=>x.t.isMine)+1;return `<section class="report-section"><h3>Confronto lega</h3><div><span>Posizione per spesa<small>${state.league.size} squadre</small></span><b>${myRank}°</b></div><div><span>Leader spesa<small>${esc(rows[0]?.t.name||"—")}</small></span><b>${fmt(rows[0]?.e.spent||0)} cr</b></div><div><span>Leader crediti residui<small>${esc(rows.slice().sort((a,b)=>b.e.remaining-a.e.remaining)[0]?.t.name||"—")}</small></span><b>${fmt(rows.slice().sort((a,b)=>b.e.remaining-a.e.remaining)[0]?.e.remaining||0)} cr</b></div></section>`})():""}
    <button class="primary full-btn" onclick="closeSafetyDialog()">Chiudi report</button>
  </div>`;
  if(!$("#safetyDialog").open)$("#safetyDialog").showModal();
}
window.openFinalReport=openFinalReport;
function soldPlayers(){return allPlayers.filter(p=>state.sold[p.id])}
function isSold(id){return !!state.sold[id]}
function leagueTeamById(id){return state.league?.teams?.find(t=>t.id===id)||null}
function opponentTeams(){return state.league?.teams?.filter(t=>!t.isMine)||[]}
function soldTeamName(sale){
  if(!sale?.teamId) return "Non assegnato";
  const t=leagueTeamById(sale.teamId);
  return t?.name||"Squadra non disponibile";
}
function soldMeta(id){
  const sale=state.sold[id]; if(!sale)return "";
  const parts=[soldTeamName(sale)];
  if(Number(sale.price)>0) parts.push(`${fmt(sale.price)} cr`);
  return parts.join(" · ");
}

/* v1.45.3 — stato assegnazione condiviso tra Giocatori e Asta Live.
   Un giocatore assegnato resta visibile nel mercato e mostra immediatamente
   la squadra che lo ha acquistato, indipendentemente da dove è stata
   registrata l'operazione (Asta Live, dettaglio Giocatore o Lega). */
function playerAssignment(p){
  if(!p)return {assigned:false,mine:false,teamName:"",price:0};
  const own=state.purchases?.[p.id];
  if(own){
    const team=mineTeam();
    return {assigned:true,mine:true,teamName:team?.name||"La mia squadra",price:Number(own.price||0),at:Number(own.at||0)};
  }
  const sale=state.sold?.[p.id];
  if(sale){
    return {assigned:true,mine:false,teamName:soldTeamName(sale),price:Number(sale.price||0),at:Number(sale.at||0)};
  }
  return {assigned:false,mine:false,teamName:"",price:0,at:0};
}
function assignedPlayers(){return allPlayers.filter(p=>playerAssignment(p).assigned)}
function playersAuctionLiveStripHTML(){
  const assigned=assignedPlayers().length;
  if(!state.league && !assigned)return "";
  const available=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&!playerAssignment(p).assigned).length;
  return `<button type="button" class="players-auction-live-strip" onclick="openAuctionLive()" aria-label="Apri Asta Live: ${assigned} assegnati, ${available} disponibili">
    <span><i></i> ASTA LIVE</span>
    <b>${assigned} assegnati</b>
    <small>${available} disponibili · sincronizzazione immediata</small>
    <strong aria-hidden="true">APRI ›</strong>
  </button>`;
}
function roleTokens(role){return String(role||"").split("/").map(x=>x.trim()).filter(Boolean)}
function activeStrategy(){return STRATEGIES[state.strategy] || STRATEGIES.A}
function scaledStrategyBudgets(strategy=activeStrategy()){
  const source=strategy?.budgets||{},total=configuredBudget(),baseTotal=Object.values(source).reduce((sum,value)=>sum+Number(value||0),0)||DEFAULT_BUDGET;
  const keys=["POR","DIF","CEN","ATT"],out={};let assigned=0;
  keys.forEach((key,index)=>{const value=index===keys.length-1?total-assigned:Math.round(total*(Number(source[key]||0)/baseTotal));out[key]=Math.max(0,value);assigned+=out[key]});
  return out;
}
function slotCompatible(p,slot){
  const tokens=roleTokens(p.role);
  return slot.roles.some(r=>tokens.includes(r));
}
function strategyPlayerFit(p,strategyId=state.strategy){
  const st=STRATEGIES[strategyId]||STRATEGIES.A;
  const labels=st.keySlots.filter(slot=>slotCompatible(p,slot)).map(x=>x.label);
  return [...new Set(labels)];
}
function playerQuality(p){
  return Math.min(999,Math.max(0,Number(p.maxPrice||p.marketMax||Math.round(Number(p.fvm||0)*2.5)||0)));
}
function bestLineupMatch(strategy,bought,slotsOverride=null){
  const slots=slotsOverride||strategy.slots;
  let dp=new Map([[0,{value:0,assign:Array(slots.length).fill(null)}]]);
  for(const p of bought){
    const next=new Map(dp);
    for(const [mask,data] of dp){
      for(let i=0;i<slots.length;i++){
        if(mask&(1<<i)) continue;
        if(!slotCompatible(p,slots[i])) continue;
        const nmask=mask|(1<<i);
        const nvalue=data.value+10000+playerQuality(p)+Math.round(Number(p.fvm||0)*4);
        const prev=next.get(nmask);
        if(!prev || nvalue>prev.value){
          const assign=data.assign.slice();
          assign[i]=p;
          next.set(nmask,{value:nvalue,assign});
        }
      }
    }
    dp=next;
  }
  let best={mask:0,value:0,assign:Array(slots.length).fill(null)};
  for(const [mask,data] of dp){
    const filled=mask.toString(2).split("1").length-1;
    const bestFilled=best.mask.toString(2).split("1").length-1;
    if(filled>bestFilled || (filled===bestFilled && data.value>best.value)){
      best={mask,value:data.value,assign:data.assign};
    }
  }
  best.filled=best.mask.toString(2).split("1").length-1;
  best.total=slots.length;
  return best;
}
function strategyDepth(strategyId,bought){
  const countHas=roles=>bought.filter(p=>roles.some(r=>roleTokens(p.role).includes(r))).length;
  if(strategyId==="A"){
    const t=countHas(["T"]);
    const apc=countHas(["A","Pc"]);
    return {
      value:(Math.min(1,t/2)+Math.min(1,apc/4))/2,
      text:`T ${t}/2 · A/Pc ${apc}/4`
    };
  }
  const wa=countHas(["W","A"]);
  const apc=countHas(["A","Pc"]);
  return {
    value:(Math.min(1,wa/4)+Math.min(1,apc/3))/2,
    text:`W/A ${wa}/4 · A/Pc ${apc}/3`
  };
}
function marketEligiblePlayers(roles){
  return allPlayers.filter(p=>isMarketEligiblePlayer(p)&&roles.some(r=>roleTokens(p.role).includes(r)));
}
function marketRemainingPlayers(roles){
  return marketEligiblePlayers(roles).filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
}
function marketRoleHealth(roles,needed){
  if(needed<=0) return {value:1,remaining:marketRemainingPlayers(roles).length,total:marketEligiblePlayers(roles).length};
  const all=marketEligiblePlayers(roles);
  const remaining=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
  if(!all.length) return {value:0,remaining:0,total:0};

  const weight=p=>1+Math.min(5,playerQuality(p)/120)+Math.min(3,Number(p.fvm||0)/35);
  const totalWeight=all.reduce((a,p)=>a+weight(p),0);
  const remainingWeight=remaining.reduce((a,p)=>a+weight(p),0);

  const countShare=remaining.length/all.length;
  const qualityShare=totalWeight?remainingWeight/totalWeight:0;
  const cushion=Math.min(1,remaining.length/Math.max(1,needed*4));
  const value=.35*countShare+.35*qualityShare+.30*cushion;

  return {value,remaining:remaining.length,total:all.length};
}
function strategyMarket(strategyId,bought=purchasedPlayers()){
  const countOwned=roles=>bought.filter(p=>roles.some(r=>roleTokens(p.role).includes(r))).length;

  if(strategyId==="A"){
    const ownedT=countOwned(["T"]);
    const ownedAPc=countOwned(["A","Pc"]);
    const t=marketRoleHealth(["T"],Math.max(0,2-ownedT));
    const apc=marketRoleHealth(["A","Pc"],Math.max(0,4-ownedAPc));
    return {
      value:.58*t.value+.42*apc.value,
      primary:t,
      secondary:apc,
      text:`T mercato ${t.remaining}/${t.total} · A/Pc ${apc.remaining}/${apc.total}`
    };
  }

  const ownedWA=countOwned(["W","A"]);
  const ownedAPc=countOwned(["A","Pc"]);
  const wa=marketRoleHealth(["W","A"],Math.max(0,4-ownedWA));
  const apc=marketRoleHealth(["A","Pc"],Math.max(0,3-ownedAPc));
  return {
    value:.62*wa.value+.38*apc.value,
    primary:wa,
    secondary:apc,
    text:`W/A mercato ${wa.remaining}/${wa.total} · A/Pc ${apc.remaining}/${apc.total}`
  };
}
function strategyScore(strategyId,bought=purchasedPlayers(),intel=null){
  const st=STRATEGIES[strategyId];
  const full=bestLineupMatch(st,bought);
  const key=bestLineupMatch(st,bought,st.keySlots);
  const depth=strategyDepth(strategyId,bought);
  const market=strategyMarket(strategyId,bought);
  const keyPlayers=key.assign.filter(Boolean);
  const qsum=keyPlayers.reduce((a,p)=>a+playerQuality(p),0);
  const quality=Math.min(1,qsum/900);
  const starterMarket={value:market.value,text:market.text};
  const starterValue=quality;
  const starterAdjustment=0;
  const prior=strategyId==="A"?3:0;
  const riskFor=id=>Number(intel?.scarcity?.[id]?.risk||0);
  const strategicRisk=strategyId==="A"
    ? .58*riskFor("T")+.42*riskFor("APc")
    : .62*riskFor("WA")+.38*riskFor("APc");
  const auctionAdjustment=intel?Math.round(3-8*(strategicRisk/100)):0;

  const score=Math.round(
    35
    +20*(full.filled/full.total)
    +18*(key.filled/3)
    +9*depth.value
    +6*quality
    +12*market.value
    +prior
    +auctionAdjustment
    +starterAdjustment
  );

  return {score:Math.min(100,Math.max(0,score)),full,key,depth,quality,market,starterMarket,starterValue,starterAdjustment,auctionAdjustment,strategicRisk};
}
function strategyRecommendation(bought=purchasedPlayers(),intel=null){
  const A=strategyScore("A",bought,intel),B=strategyScore("B",bought,intel);
  const delta=A.score-B.score;
  let recommended="A",status="BASE";
  if(bought.length<3){
    if(delta>=3){recommended="A";status="A"}
    else if(delta<=-3){recommended="B";status="B"}
    else {recommended="A";status="BASE"}
  }else if(delta>=4){
    recommended="A"; status="A";
  }else if(delta<=-4){
    recommended="B"; status="B";
  }else{
    recommended=state.strategy; status="EQUILIBRIO";
  }
  const active=state.strategy;
  let headline="";
  if(status==="EQUILIBRIO") headline=`Rosa ibrida: mantieni ${active}`;
  else if(recommended===active) headline=`Continua con ${recommended} · ${STRATEGIES[recommended].module}`;
  else headline=`Switch consigliato → ${recommended} · ${STRATEGIES[recommended].module}`;

  let reason="";
  if(bought.length<3){
    reason=`Confronto iniziale su ruoli, FVM, quotazioni e profondità del Listone: ${recommended==="A"?A.market.text:B.market.text}.`;
  }else if(recommended==="A"){
    reason=`A è più coperta nel Listone: ${A.depth.text} · ${A.market.text}.`;
  }else{
    reason=`B è più coperta nel Listone: ${B.depth.text} · ${B.market.text}.`;
  }
  return {A,B,recommended,status,headline,reason};
}
function setStrategy(id){
  if(!STRATEGIES[id]||state.strategy===id) return;
  const before=captureAuctionCore(),oldId=state.strategy;
  state.strategy=id;
  localStorage.setItem("fa2_strategy",id);
  recordOperation("STRATEGIA",`Strategia ${oldId} → ${id} · ${STRATEGIES[id].module}`,before,{undoable:true,count:false});
  refresh();
}
window.setStrategy=setStrategy;
function primaryOffensiveRole(p){
  if(!p) return null;
  if(["W","T","A","Pc"].includes(p.primaryRole)) return p.primaryRole;
  if(p.reparto!=="ATT") return null;
  return roleTokens(p.role).find(r=>["W","T","A","Pc"].includes(r)) || null;
}
const ROLE_DETAIL_FILTERS=new Set(["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"]);
function roleFilterCount(role){
  if(!ROLE_DETAIL_FILTERS.has(role)) return 0;
  return currentStrategicPlayers().filter(p=>roleTokens(p.role).includes(role)).length;
}
function playerMatchesRoleFilter(p,role,mode=state.poolMode){
  if(role==="Tutti") return true;
  if(role==="Preferiti") return isWatchlisted(p.id);
  if(role==="U23") return isU23Player(p);
  if(role==="U21") return isU21Player(p);
  if(ROLE_DETAIL_FILTERS.has(role)) return roleTokens(p.role).includes(role);
  return false;
}
function isPrimaryForRole(p,role){
  const tokens=roleTokens(p?.role);
  if(!tokens.includes(role)) return false;
  if(["W","T","A","Pc"].includes(role)){
    const offensivePrimary=primaryOffensiveRole(p);
    if(offensivePrimary) return offensivePrimary===role;
  }
  return tokens[0]===role;
}
function roleCompatibilityLabel(role){
  if(["W","T","A","Pc"].includes(role)) return `${role} presente tra i ruoli offensivi compatibili`;
  return `${role} presente tra i ruoli secondari`;
}
function fmt(n){return Number(n||0).toLocaleString("it-IT")}
function purchasedPlayers(){return allPlayers.filter(p=>state.purchases[p.id])}
function spent(){return Object.values(state.purchases).reduce((a,x)=>a+Number(x.price||0),0)}
function countClub(club){return purchasedPlayers().filter(p=>p.club===club).length}

function formationFeedValid(feed){
  return !!feed && feed.schema===FORMATIONS_LIVE_SCHEMA && Array.isArray(feed.teams) && feed.teams.length>0;
}
function availabilityFeedValid(feed=availabilityLiveFeed){
  return !!feed && feed.schema===AVAILABILITY_LIVE_SCHEMA && feed.complete===true && Array.isArray(feed.teams) && feed.teams.length>=1 && Array.isArray(feed.cards);
}
function formationDisplayDate(value){
  const d=new Date(value||0);if(Number.isNaN(d.getTime()))return "—";
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d).replace(",","");
}
function formationFeedAgeMinutes(){
  if(!formationFeedValid(formationsLiveFeed))return Infinity;
  const ts=formationsLiveCheckedAt||new Date(formationsLiveFeed.generatedAt||0).getTime();
  if(!Number.isFinite(ts)||!ts)return Infinity;
  return Math.max(0,(Date.now()-ts)/6e4);
}
function availabilityFeedAgeMinutes(){
  if(!availabilityFeedValid())return Infinity;
  const ts=availabilityLiveCheckedAt||new Date(availabilityLiveFeed.generatedAt||0).getTime();
  if(!Number.isFinite(ts)||!ts)return Infinity;
  return Math.max(0,(Date.now()-ts)/6e4);
}
function formationPlayerCandidate(name,club){
  const key=normalizePlayerName(name),candidates=allPlayers.filter(p=>p.club===club);
  let hit=candidates.find(p=>normalizePlayerName(p.name)===key);if(hit)return hit;
  const close=candidates.filter(p=>{
    const k=normalizePlayerName(p.name);
    return key.length>=5&&k.length>=5&&(key.startsWith(k)||k.startsWith(key)||key.includes(k)||k.includes(key));
  });
  return close.length===1?close[0]:null;
}
function formationRoleFor(name,club){return formationPlayerCandidate(name,club)?.role||"?"}
function availabilityNamesMatch(left,right){
  const a=normalizePlayerName(left),b=normalizePlayerName(right);
  return !!a&&!!b&&(a===b||(Math.min(a.length,b.length)>=5&&(a.startsWith(b)||b.startsWith(a)||a.includes(b)||b.includes(a))));
}
function availabilityTeamFor(club){
  return availabilityFeedValid()?availabilityLiveFeed.teams.find(team=>team.club===club)||null:null;
}
function availabilityItemFor(name,club,key){
  const team=availabilityTeamFor(club);if(!team)return null;
  const candidate=formationPlayerCandidate(name,club),id=candidate?.id;
  return (team[key]||[]).find(item=>(id!=null&&item.playerId!=null&&String(item.playerId)===String(id))||availabilityNamesMatch(item.name,name))||null;
}
function disciplineCardFor(name,club){
  if(!availabilityFeedValid())return null;
  const candidate=formationPlayerCandidate(name,club),id=candidate?.id;
  let card=id==null?null:availabilityLiveFeed.cards.find(row=>row.id!=null&&String(row.id)===String(id));
  if(card)return card;
  const wanted=normalizePlayerName(name);
  const localExact=availabilityLiveFeed.cards.filter(row=>row.club===club&&normalizePlayerName(row.name)===wanted);
  if(localExact.length===1)return localExact[0];
  const localClose=availabilityLiveFeed.cards.filter(row=>row.club===club&&availabilityNamesMatch(row.name,name));
  if(localClose.length===1)return localClose[0];
  const globalExact=availabilityLiveFeed.cards.filter(row=>normalizePlayerName(row.name)===wanted);
  if(globalExact.length===1)return globalExact[0];
  const globalClose=availabilityLiveFeed.cards.filter(row=>availabilityNamesMatch(row.name,name));
  return globalClose.length===1?globalClose[0]:null;
}
function availabilityPlayerMeta(name,club){
  const card=disciplineCardFor(name,club);
  const injury=availabilityItemFor(name,club,"injuries");
  const suspended=availabilityItemFor(name,club,"suspended");
  const warned=availabilityItemFor(name,club,"warned");
  return {card,injury,suspended,warned,isSuspended:!!(suspended||card?.suspended),isWarned:!!(warned||card?.warned)};
}
function disciplineCountersHTML(name,club,{withStatus=true}={}){
  const meta=availabilityPlayerMeta(name,club),known=!!meta.card;
  const yellow=known?Math.max(0,Number(meta.card.yellow)||0):"—";
  const red=known?Math.max(0,Number(meta.card.red)||0):"—";
  const statuses=[];
  if(meta.injury)statuses.push('<em class="injured">INF</em>');
  if(meta.isSuspended)statuses.push('<em class="suspended">SQ</em>');
  if(meta.isWarned)statuses.push('<em class="warned">DIFF</em>');
  const aria=`Gialli ${yellow}, rossi ${red}${meta.injury?", infortunato":""}${meta.isSuspended?", squalificato":""}${meta.isWarned?", diffidato":""}`;
  return `<small class="formation-discipline" aria-label="${escAttr(aria)}"><span><i class="yellow" aria-hidden="true"></i>G ${yellow}</span><span><i class="red" aria-hidden="true"></i>R ${red}</span>${withStatus?statuses.join(""):""}</small>`;
}
function formationAvailabilitySummary(club){
  const team=availabilityTeamFor(club);if(!team)return "INF — · SQ — · DIFF —";
  return `INF ${team.injuries?.length||0} · SQ ${team.suspended?.length||0} · DIFF ${team.warned?.length||0}`;
}
function playerAvailabilityLinesHTML(p){
  if(!availabilityFeedValid())return '<div class="line"><span>Disponibilità / disciplina</span><b>Dati da sincronizzare</b></div>';
  const meta=availabilityPlayerMeta(p.name,p.club),states=[];
  if(meta.injury)states.push("INFORTUNATO");
  if(meta.isSuspended)states.push("SQUALIFICATO");
  if(meta.isWarned)states.push("DIFFIDATO");
  if(!states.length)states.push("DISPONIBILE");
  const y=meta.card?Math.max(0,Number(meta.card.yellow)||0):"—",r=meta.card?Math.max(0,Number(meta.card.red)||0):"—";
  const recovery=meta.injury?.recovery||meta.injury?.detail||"";
  return `<div class="line"><span>Disponibilità</span><b>${states.join(" · ")}</b></div><div class="line"><span>Cartellini Serie A</span><b>Gialli ${y} · Rossi ${r}</b></div>${recovery?`<div class="line"><span>Recupero stimato</span><b>${esc(recovery)}</b></div>`:""}`;
}
function moduleLineCounts(module){
  const nums=String(module||"").split("-").map(Number).filter(Number.isFinite);
  return nums.length&&nums.reduce((a,b)=>a+b,0)===10?[1,...nums]:null;
}
function buildLiveFormationLines(team,base){
  const starters=(team.starters||[]).slice(0,11).map(x=>({name:x.name,role:formationRoleFor(x.name,team.club),probability:Number(x.probability||0)}));
  const counts=moduleLineCounts(team.module);
  if(starters.length===11&&counts){
    const lines=[];let pos=0;
    counts.forEach(n=>{lines.push(starters.slice(pos,pos+n));pos+=n});
    return lines;
  }
  return (base?.lines||[]).map(line=>line.map(p=>{
    const live=[...(team.starters||[]),...(team.bench||[])].find(x=>normalizePlayerName(x.name)===normalizePlayerName(p.name));
    return {...p,probability:Number(live?.probability||0)};
  }));
}
function mergedLiveFormations(feed){
  if(!formationFeedValid(feed))return baseFormations.slice();
  const byClub=new Map((feed.teams||[]).map(t=>[t.club,t]));
  if(!baseFormations.length){
    return (feed.teams||[]).map(team=>({team:team.team||team.club,club:team.club,module:team.module||"—",updated:formationDisplayDate(feed.generatedAt),lines:buildLiveFormationLines(team,null),bench:(team.bench||[]).map(x=>({...x,role:x.role||formationRoleFor(x.name,team.club)})),liveSource:true,sourceUrl:""}));
  }
  return baseFormations.map(base=>{
    const team=byClub.get(base.club);if(!team)return base;
    return {...base,team:team.team||base.team,module:team.module||base.module,updated:formationDisplayDate(feed.generatedAt),lines:buildLiveFormationLines(team,base),bench:(team.bench||[]).map(x=>({...x,role:formationRoleFor(x.name,team.club)})),liveSource:true,sourceUrl:""};
  });
}
function applyFormationLiveFeed(feed,{persist=true}={}){
  if(!formationFeedValid(feed))return false;
  formationsLiveFeed=feed;formations=mergedLiveFormations(feed);formationsLiveError="";
  if(persist)localStorage.setItem(FORMATIONS_LIVE_STORAGE,JSON.stringify(feed));
  return true;
}
function applyAvailabilityLiveFeed(feed,{persist=true}={}){
  if(!availabilityFeedValid(feed))return false;
  availabilityLiveFeed=feed;availabilityLiveError="";
  if(persist)localStorage.setItem(AVAILABILITY_LIVE_STORAGE,JSON.stringify(feed));
  return true;
}

/* A6.1.0 — Data Center locale. I file vengono scelti dall'utente, verificati
   nel browser e non sono mai trasmessi o recuperati automaticamente. */
let fa2PendingLocalData=null;
function fa2LocalDataDelimiter(line){const rows=[[";",(line.match(/;/g)||[]).length],[",",(line.match(/,/g)||[]).length],["\t",(line.match(/\t/g)||[]).length]];return rows.sort((a,b)=>b[1]-a[1])[0][0]}
function fa2LocalDataLine(line,separator){const out=[];let value="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(ch===separator&&!quoted){out.push(value);value=""}else value+=ch}out.push(value);return out}
function fa2LocalDataRows(raw){const lines=String(raw||"").replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>line.trim());if(lines.length<2)throw new Error("Il CSV non contiene dati sufficienti.");const separator=fa2LocalDataDelimiter(lines[0]),headers=fa2LocalDataLine(lines[0],separator).map(value=>localField(value,80).toLowerCase());return lines.slice(1).map(line=>{const cells=fa2LocalDataLine(line,separator),row={};headers.forEach((header,index)=>row[header]=cells[index]??"");return row})}
function fa2LocalDataValue(row,names){for(const name of names){const value=row[String(name).toLowerCase()];if(value!==undefined&&String(value).trim()!=="")return value}return ""}
function fa2LocalNumber(value,fallback=0){const number=Number(String(value??"").trim().replace(/%$/,"").replace(",","."));return Number.isFinite(number)?number:fallback}
function fa2ParseFormationLocalFile(raw,fileName){
  if(/\.json$/i.test(fileName)){const feed=JSON.parse(raw);if(!formationFeedValid(feed))throw new Error("JSON formazioni non compatibile con lo schema locale.");return {...feed,sourceKind:"user-provided-local",generatedAt:feed.generatedAt||new Date().toISOString()}}
  const rows=fa2LocalDataRows(raw),teams=new Map();
  rows.forEach((row,index)=>{const club=localField(fa2LocalDataValue(row,["club","squadra","team_code"]),24).toUpperCase(),teamName=localField(fa2LocalDataValue(row,["team","squadra_nome","nome_squadra"]),50)||club,module=localField(fa2LocalDataValue(row,["module","modulo"]),12),name=localField(fa2LocalDataValue(row,["player","giocatore","nome"]),80),role=normalizeMantraRoleInput(fa2LocalDataValue(row,["role","ruolo","rm"])),status=localField(fa2LocalDataValue(row,["status","stato"]),20).toLowerCase(),probability=clamp(fa2LocalNumber(fa2LocalDataValue(row,["probability","probabilita","titolarita"]),status.includes("titol")?70:35),0,100);if(!club||!name)throw new Error(`Riga ${index+2}: club o giocatore mancante.`);if(!teams.has(club))teams.set(club,{club,team:teamName,module,starters:[],bench:[]});const item={name,role,probability};if(status.includes("panch")||status.includes("bench")||status.includes("riserv"))teams.get(club).bench.push(item);else teams.get(club).starters.push(item)});
  const feed={schema:FORMATIONS_LIVE_SCHEMA,complete:true,sourceKind:"user-provided-local",fileLabel:localField(fileName,120),generatedAt:new Date().toISOString(),teams:[...teams.values()]};if(!formationFeedValid(feed))throw new Error("Nessuna formazione valida trovata.");return feed;
}
function fa2ParseAvailabilityLocalFile(raw,fileName){
  if(/\.json$/i.test(fileName)){const feed=JSON.parse(raw);if(!availabilityFeedValid(feed))throw new Error("JSON disponibilità non compatibile con lo schema locale.");return {...feed,sourceKind:"user-provided-local",generatedAt:feed.generatedAt||new Date().toISOString()}}
  const rows=fa2LocalDataRows(raw),teams=new Map(),cards=[];
  rows.forEach((row,index)=>{const club=localField(fa2LocalDataValue(row,["club","squadra","team"]),24).toUpperCase(),name=localField(fa2LocalDataValue(row,["player","giocatore","nome"]),80),status=localField(fa2LocalDataValue(row,["status","stato"]),30).toLowerCase(),recovery=localField(fa2LocalDataValue(row,["recovery","recupero","rientro","dettaglio"]),100),yellow=Math.max(0,fa2LocalNumber(fa2LocalDataValue(row,["yellow","gialli","ammonizioni"]),0)),red=Math.max(0,fa2LocalNumber(fa2LocalDataValue(row,["red","rossi","espulsioni"]),0));if(!club||!name)throw new Error(`Riga ${index+2}: club o giocatore mancante.`);if(!teams.has(club))teams.set(club,{club,injuries:[],suspended:[],warned:[]});const item={name,recovery,detail:recovery};if(status.includes("infort")||status.includes("injur"))teams.get(club).injuries.push(item);if(status.includes("squal")||status.includes("suspend"))teams.get(club).suspended.push(item);if(status.includes("diffid")||status.includes("warn"))teams.get(club).warned.push(item);cards.push({name,club,yellow,red,suspended:status.includes("squal")||status.includes("suspend"),warned:status.includes("diffid")||status.includes("warn")})});
  const feed={schema:AVAILABILITY_LIVE_SCHEMA,complete:true,sourceKind:"user-provided-local",fileLabel:localField(fileName,120),generatedAt:new Date().toISOString(),teams:[...teams.values()],cards};if(!availabilityFeedValid(feed))throw new Error("Nessun dato di disponibilità valido trovato.");return feed;
}
function fa2LocalDataCounts(){return {stats:window.FA2PlayerIntelligence?.status?.().count||0,formations:formationsLiveFeed?.teams?.length||0,availability:availabilityLiveFeed?.cards?.length||0}}
function closeLocalDataDialog(){fa2PendingLocalData=null;const dialog=$("#localDataDialog");if(dialog?.open)dialog.close()}
window.closeLocalDataDialog=closeLocalDataDialog;
function fa2LocalDataCenterHTML(){const counts=fa2LocalDataCounts();return `<div class="dialog-body local-data-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">DATI LOCALI · A6.1.0</div><h2>Dati per gli algoritmi</h2></div><button class="ghost" type="button" aria-label="Chiudi dati locali" onclick="closeLocalDataDialog()">✕</button></div><div class="local-data-privacy"><b>Solo file autorizzati dall’utente</b><span>Nessun download automatico, scraping o invio a server. L’app conserva esclusivamente dati fattuali nel browser.</span></div><div class="local-data-grid"><section><span>STATISTICHE</span><b>${counts.stats} righe</b><small>Rendimento e storico</small><button class="primary" type="button" onclick="fa2ChooseLocalData('stats')">Importa file</button><a href="./statistics-template.csv" download>Scarica modello</a><button class="ghost" type="button" onclick="fa2ClearLocalData('stats')" ${counts.stats?"":"disabled"}>Elimina</button></section><section><span>FORMAZIONI</span><b>${counts.formations} squadre</b><small>Titolarità e moduli</small><button class="primary" type="button" onclick="fa2ChooseLocalData('formations')">Importa file</button><a href="./formations-template.csv" download>Scarica modello</a><button class="ghost" type="button" onclick="fa2ClearLocalData('formations')" ${counts.formations?"":"disabled"}>Elimina</button></section><section><span>DISPONIBILITÀ</span><b>${counts.availability} giocatori</b><small>Infortuni e disciplina</small><button class="primary" type="button" onclick="fa2ChooseLocalData('availability')">Importa file</button><a href="./availability-template.csv" download>Scarica modello</a><button class="ghost" type="button" onclick="fa2ClearLocalData('availability')" ${counts.availability?"":"disabled"}>Elimina</button></section></div><p class="muted">I file devono provenire da una fonte che consente l’esportazione e l’uso scelto. L’app non concede licenze sui dati di terzi.</p><button class="primary full-btn" type="button" onclick="closeLocalDataDialog()">Chiudi</button></div>`}
function openLocalDataCenter(){const dialog=$("#localDataDialog");$("#localDataDialogContent").innerHTML=fa2LocalDataCenterHTML();if(!dialog.open)dialog.showModal()}
window.openLocalDataCenter=openLocalDataCenter;
function fa2ChooseLocalData(kind){const ids={stats:"playerStatsLocalFileInput",formations:"formationsLocalFileInput",availability:"availabilityLocalFileInput"},input=$("#"+ids[kind]);if(input){input.value="";input.click()}}
window.fa2ChooseLocalData=fa2ChooseLocalData;
function fa2LocalDataPreview(kind,snapshot,fileName){const labels={stats:"Statistiche",formations:"Formazioni",availability:"Disponibilità"},count=kind==="stats"?snapshot.records.length:kind==="formations"?snapshot.teams.length:snapshot.cards.length;fa2PendingLocalData={kind,snapshot};$("#localDataDialogContent").innerHTML=`<div class="dialog-body local-data-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">IMPORTAZIONE LOCALE</div><h2>Verifica ${labels[kind]}</h2></div><button class="ghost" type="button" aria-label="Chiudi anteprima" onclick="closeLocalDataDialog()">✕</button></div><div class="listone-sync-finished"><span>${count}</span><h2>elementi riconosciuti</h2><p>${esc(fileName)}</p></div><div class="sync-preserve-note">Il file resta su questo dispositivo. URL, immagini e testi editoriali non sono richiesti né utilizzati.</div><label class="listone-rights-check"><input id="localDataRightsConfirm" type="checkbox"> <span>Confermo di essere autorizzato a usare questo file e di rispettare licenza e condizioni della fonte.</span></label><div class="dialog-actions"><button class="ghost" type="button" onclick="closeLocalDataDialog()">Annulla</button><button id="applyLocalDataBtn" class="primary" type="button" disabled>Importa</button></div></div>`;$("#localDataRightsConfirm").onchange=event=>$("#applyLocalDataBtn").disabled=!event.target.checked;$("#applyLocalDataBtn").onclick=fa2ApplyPendingLocalData}
function fa2ApplyPendingLocalData(){const pending=fa2PendingLocalData;if(!pending)return;if(pending.kind==="stats")window.FA2PlayerIntelligence.applySnapshot(pending.snapshot);if(pending.kind==="formations"){applyFormationLiveFeed(pending.snapshot);formationsLiveCheckedAt=Date.now();localStorage.setItem(FORMATIONS_LIVE_CHECKED_STORAGE,String(formationsLiveCheckedAt))}if(pending.kind==="availability"){applyAvailabilityLiveFeed(pending.snapshot);availabilityLiveCheckedAt=Date.now();localStorage.setItem(AVAILABILITY_LIVE_CHECKED_STORAGE,String(availabilityLiveCheckedAt))}sessionStorage.removeItem("fa2_strategy_result_v35");fa2PendingLocalData=null;refresh();$("#localDataDialogContent").innerHTML=`<div class="dialog-body local-data-dialog-body"><div class="listone-sync-finished"><span>OK</span><h2>Dati locali importati</h2><p>Gli algoritmi sono stati ricalcolati senza collegamenti esterni.</p></div><button class="primary full-btn" type="button" onclick="closeLocalDataDialog()">Continua</button></div>`}
window.fa2ApplyPendingLocalData=fa2ApplyPendingLocalData;
function fa2ClearLocalData(kind){if(!confirm("Eliminare questi dati locali dal dispositivo? Listone, rose e acquisti non verranno modificati."))return;if(kind==="stats")window.FA2PlayerIntelligence?.clear?.();if(kind==="formations"){localStorage.removeItem(FORMATIONS_LIVE_STORAGE);localStorage.removeItem(FORMATIONS_LIVE_CHECKED_STORAGE);formationsLiveFeed=null;formations=baseFormations.slice();formationsLiveCheckedAt=0}if(kind==="availability"){localStorage.removeItem(AVAILABILITY_LIVE_STORAGE);localStorage.removeItem(AVAILABILITY_LIVE_CHECKED_STORAGE);availabilityLiveFeed=null;availabilityLiveCheckedAt=0}sessionStorage.removeItem("fa2_strategy_result_v35");refresh();openLocalDataCenter()}
window.fa2ClearLocalData=fa2ClearLocalData;
async function fa2ImportLocalDataFile(kind,file){try{const raw=await fa2ReadTextFile(file),snapshot=kind==="stats"?window.FA2PlayerIntelligence.parseText(raw,file.name):kind==="formations"?fa2ParseFormationLocalFile(raw,file.name):fa2ParseAvailabilityLocalFile(raw,file.name);fa2LocalDataPreview(kind,snapshot,file.name)}catch(error){$("#localDataDialogContent").innerHTML=`<div class="dialog-body local-data-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">NESSUNA MODIFICA</div><h2>File non importabile</h2></div><button class="ghost" type="button" aria-label="Chiudi errore" onclick="closeLocalDataDialog()">✕</button></div><div class="listone-sync-warning">${esc(error?.message||"File non valido.")}</div><button class="primary full-btn" type="button" onclick="openLocalDataCenter()">Torna ai dati locali</button></div>`}}
[...["stats","formations","availability"]].forEach(kind=>{const id={stats:"playerStatsLocalFileInput",formations:"formationsLocalFileInput",availability:"availabilityLocalFileInput"}[kind],input=$("#"+id);input?.addEventListener("change",event=>{const file=event.target.files?.[0];if(file)fa2ImportLocalDataFile(kind,file)})});
function starterProbability(p){
  if(!p)return {prob:45,source:"unknown"};
  if(formationFeedValid(formationsLiveFeed)){
    const team=formationsLiveFeed.teams.find(t=>t.club===p.club);
    if(team){
      const pools=[...(team.starters||[]).map(x=>({...x,kind:"starter"})),...(team.bench||[]).map(x=>({...x,kind:"bench"}))];
      const key=normalizePlayerName(p.name);
      let hit=pools.find(x=>normalizePlayerName(x.name)===key);
      if(!hit){
        const close=pools.filter(x=>{const k=normalizePlayerName(x.name);return key.length>=5&&k.length>=5&&(key.startsWith(k)||k.startsWith(key)||key.includes(k)||k.includes(key))});
        if(close.length===1)hit=close[0];
      }
      if(hit)return {prob:clamp(Number(hit.probability||0),0,100),source:"live",kind:hit.kind};
      return {prob:12,source:"live",kind:"absent"};
    }
  }
  const base=baseFormations.find(f=>f.club===p.club);
  if(base){
    const inXI=(base.lines||[]).flat().some(x=>normalizePlayerName(x.name)===normalizePlayerName(p.name));
    return {prob:inXI?72:32,source:"base",kind:inXI?"starter":"bench"};
  }
  const txt=String(p.starter||"").toLowerCase();
  if(txt.includes("titol"))return {prob:74,source:"profile"};
  if(txt.includes("ballott"))return {prob:55,source:"profile"};
  if(txt.includes("rotaz"))return {prob:42,source:"profile"};
  return {prob:45,source:"unknown"};
}
function starterPriorityBonus(p){
  const pr=starterProbability(p).prob;
  if(pr>=85)return 16;if(pr>=70)return 12;if(pr>=55)return 7;if(pr>=40)return 2;if(pr>=25)return -4;return -9;
}
function starterStatus(pr){
  if(pr>=85)return {label:"TITOLARE",cls:"sure"};
  if(pr>=70)return {label:"PROBABILE",cls:"probable"};
  if(pr>=50)return {label:"BALLOTTAGGIO",cls:"battle"};
  if(pr>=30)return {label:"RISERVA ATTIVA",cls:"rotation"};
  return {label:"RISERVA",cls:"reserve"};
}
function marketStarterHealth(roles,needed){
  if(needed<=0)return {value:1,avg:100,count:0};
  const candidates=marketRemainingPlayers(roles).map(p=>({p,prob:starterProbability(p).prob})).sort((a,b)=>b.prob-a.prob||playerQuality(b.p)-playerQuality(a.p));
  if(!candidates.length)return {value:0,avg:0,count:0};
  const take=candidates.slice(0,Math.max(needed*2,3));
  const avg=take.reduce((a,x)=>a+x.prob,0)/take.length;
  const usable=candidates.filter(x=>x.prob>=55).length;
  const quantity=Math.min(1,usable/Math.max(1,needed*2));
  return {value:clamp(.72*(avg/100)+.28*quantity),avg, count:usable};
}
function strategyStarterMarket(strategyId,bought=purchasedPlayers()){
  const countOwned=roles=>bought.filter(p=>roles.some(r=>roleTokens(p.role).includes(r))).length;
  if(strategyId==="A"){
    const t=marketStarterHealth(["T"],Math.max(0,2-countOwned(["T"]))),apc=marketStarterHealth(["A","Pc"],Math.max(0,4-countOwned(["A","Pc"])));
    const value=.58*t.value+.42*apc.value;
    return {value,text:`titolarità T ${Math.round(t.avg)}% · A/Pc ${Math.round(apc.avg)}%`};
  }
  const wa=marketStarterHealth(["W","A"],Math.max(0,4-countOwned(["W","A"]))),apc=marketStarterHealth(["A","Pc"],Math.max(0,3-countOwned(["A","Pc"])));
  const value=.62*wa.value+.38*apc.value;
  return {value,text:`titolarità W/A ${Math.round(wa.avg)}% · A/Pc ${Math.round(apc.avg)}%`};
}
function lineupStarterValue(assign){
  const rows=assign.filter(Boolean);if(!rows.length)return null;
  return rows.reduce((a,p)=>a+starterProbability(p).prob,0)/(rows.length*100);
}
async function refreshFormationsLiveInternal({manual=false}={}){
  formationsLiveError="Aggiornamento esterno disattivato nella versione Clean Data";
  if(manual&&state.view==="formationsView")renderFormationsView();
  return false;
}
async function refreshAvailabilityLiveInternal({manual=false}={}){
  availabilityLiveError="Aggiornamento esterno disattivato nella versione Clean Data";
  if(manual&&state.view==="formationsView")renderFormationsView();
  return false;
}
window.refreshFormationsLive=async()=>{
  const results=await Promise.all([refreshFormationsLiveInternal({manual:true}),refreshAvailabilityLiveInternal({manual:true})]);
  if(state.view==="formationsView")renderFormationsView();
  return results.every(Boolean);
};
function maybeRefreshFormationsLive(){
  if(formationFeedAgeMinutes()>10)refreshFormationsLiveInternal({manual:false});
  if(availabilityFeedAgeMinutes()>45)refreshAvailabilityLiveInternal({manual:false});
}

if(formationFeedValid(formationsLiveFeed))applyFormationLiveFeed(formationsLiveFeed,{persist:false});
if(availabilityFeedValid(availabilityLiveFeed))applyAvailabilityLiveFeed(availabilityLiveFeed,{persist:false});

function clamp(v,min=0,max=1){return Math.min(max,Math.max(min,v))}
function phaseIndex(id=state.auctionPhase){
  const i=AUCTION_PHASES.findIndex(x=>x.id===id);
  return i<0?0:i;
}
function rolePhaseIndex(role){return PHASE_ROLE_INDEX[role]??3}
function playerAuctionPhase(p){
  const tokens=roleTokens(p?.role);
  if(tokens.includes("Por"))return "POR";
  if(tokens.some(r=>["W","T","A","Pc"].includes(r)))return "ATT";
  if(tokens.some(r=>["E","M","C"].includes(r)))return "CEN";
  return "DIF";
}
function phaseForRep(rep){return ({POR:"POR",DIF:"DIF",CEN:"CEN",ATT:"ATT"})[rep]||"ATT"}
function setAuctionPhase(id){
  if(!AUCTION_PHASES.some(x=>x.id===id)||state.auctionPhase===id)return;
  const before=captureAuctionCore(),old=state.auctionPhase;
  state.auctionPhase=id;saveAuctionPhase();
  recordOperation("FASE",`Fase asta ${old} → ${id}`,before,{undoable:true,count:false});
  refresh();
}
window.setAuctionPhase=setAuctionPhase;
function nextAuctionPhase(){
  const i=phaseIndex();
  if(i<AUCTION_PHASES.length-1)setAuctionPhase(AUCTION_PHASES[i+1].id);
}
window.nextAuctionPhase=nextAuctionPhase;

function teamItems(team,excludePlayerId=null){
  let items=rosterForLeagueTeam(team);
  if(excludePlayerId!=null)items=items.filter(x=>String(x.p.id)!==String(excludePlayerId));
  return items;
}
function repairSessions(){return state.repairMarket?.sessions||[]}
function repairSessionById(id){return repairSessions().find(x=>String(x.id)===String(id))||null}
function currentRepairSession(){
  const id=state.repairMarket?.activeSessionId;
  return id?repairSessions().find(x=>String(x.id)===String(id)&&!x.endedAt)||null:null;
}
function activeRepairSession(){
  const session=currentRepairSession();
  return session&&!session.pausedAt?session:null;
}
function pausedRepairSession(){const session=currentRepairSession();return session?.pausedAt?session:null}
function activeRepairPromise(session=activeRepairSession()){
  const promise=session?.settings?.allowPromise?session.promisedRelease:null;
  return promise&&state.purchases?.[promise.playerId]?promise:null;
}
function repairBudgetAdjustment(){
  return repairSessions().flatMap(x=>x.releases||[]).reduce((sum,row)=>sum+Number(row.originalPrice||0)-Number(row.refund||0),0);
}
function repairExemptAcquisitionCount(session=activeRepairSession()){
  if(!session?.settings?.excludeOutOfListoneFromLimit)return 0;
  return (session.acquisitions||[]).filter(row=>row.limitExempt===true).length;
}
function repairPendingExemptionCount(session=activeRepairSession()){
  if(!session?.settings?.excludeOutOfListoneFromLimit)return 0;
  const outReleases=(session.releases||[]).filter(row=>row.outOfListone).length;
  return Math.max(0,outReleases-repairExemptAcquisitionCount(session));
}
function repairAcquisitionCount(session=activeRepairSession()){return Math.max(0,(session?.acquisitions?.length||0)-repairExemptAcquisitionCount(session))}
function repairLimitReached(session=activeRepairSession()){
  return !!session&&session.settings?.purchaseLimitMode==="fixed"&&repairAcquisitionCount(session)>=Math.max(1,Number(session.settings.purchaseLimit)||1)&&repairPendingExemptionCount(session)===0;
}
function repairReleasedInActiveSession(id){return !!activeRepairSession()?.releases?.some(x=>String(x.playerId)===String(id))}
function teamEconomy(team,excludePlayerId=null){
  const items=teamItems(team,excludePlayerId);
  const spentValue=items.reduce((a,x)=>a+Number(x.price||0),0);
  const budget=configuredBudget(),rosterTotal=configuredRosterTotal(),reservePerSlot=configuredReservePerSlot();
  const repairAdjustment=team?.isMine===true||team?.id==="mine"?repairBudgetAdjustment():0;
  const remaining=Math.max(0,budget-spentValue-repairAdjustment);
  const missing=Math.max(0,rosterTotal-items.length);
  const minimumToFinish=missing*reservePerSlot;
  const free=Math.max(0,remaining-minimumToFinish);
  const maxNext=missing>0?Math.max(0,remaining-Math.max(0,missing-1)*reservePerSlot):0;
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  items.forEach(x=>{const rep=playerAuctionPhase(x.p);if(byRep[rep]!=null)byRep[rep]+=Number(x.price||0)});
  return {items,spent:spentValue,remaining,missing,minimumToFinish,free,maxNext,byRep,repairAdjustment};
}
/* A5.6.5 — stato reale dell'asta, separato dalle simulazioni di riparazione.
   Una promessa di svincolo apre capacità operativa per il prossimo acquisto,
   ma non deve trasformare una rosa reale 25/25 in una rosa 24/25. */
function auctionLifecycleStatus(){
  const rosterTotal=configuredRosterTotal(),teams=state.league?.teams||[];
  const rows=teams.map(team=>({team,count:teamItems(team).length}));
  const completeTeams=rows.filter(row=>row.count===rosterTotal).length;
  const own=teamEconomy(mineTeam()),ownComplete=own.items.length===rosterTotal;
  const allRostersComplete=teams.length>=4&&completeTeams===teams.length;
  const repairSession=currentRepairSession(),repairActive=!!repairSession&&!repairSession.pausedAt,repairPaused=!!repairSession?.pausedAt,initialAuctionComplete=allRostersComplete||(!teams.length&&ownComplete);
  return {
    rosterTotal,teams:teams.length,completeTeams,ownCount:own.items.length,ownComplete,
    allRostersComplete,initialAuctionComplete,repairActive,repairPaused,auctionComplete:initialAuctionComplete||!!repairSession,
    imported:state.league?.importSource==="fantacalcio-csv"
  };
}
window.auctionLifecycleStatus=auctionLifecycleStatus;
function teamEconomyForPurchase(excludePlayerId=null){
  const promise=activeRepairPromise();if(!promise)return teamEconomy(mineTeam(),excludePlayerId);
  const promisedId=String(promise.playerId),current=state.purchases[promisedId];
  let items=teamItems(mineTeam(),excludePlayerId).filter(x=>String(x.p.id)!==promisedId);
  const spentValue=items.reduce((sum,x)=>sum+Number(x.price||0),0),budget=configuredBudget(),rosterTotal=configuredRosterTotal(),reservePerSlot=configuredReservePerSlot();
  const pendingAdjustment=Math.max(0,Number(current?.price||promise.originalPrice||0)-Number(promise.refund||0));
  const repairAdjustment=repairBudgetAdjustment()+pendingAdjustment,remaining=Math.max(0,budget-spentValue-repairAdjustment),missing=Math.max(0,rosterTotal-items.length),minimumToFinish=missing*reservePerSlot,free=Math.max(0,remaining-minimumToFinish),maxNext=missing>0?Math.max(0,remaining-Math.max(0,missing-1)*reservePerSlot):0;
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};items.forEach(x=>{const rep=playerAuctionPhase(x.p);if(byRep[rep]!=null)byRep[rep]+=Number(x.price||0)});
  return {items,spent:spentValue,remaining,missing,minimumToFinish,free,maxNext,byRep,repairAdjustment,promisedRelease:promise};
}
function teamClubCount(team,club,excludePlayerId=null){
  return teamItems(team,excludePlayerId).filter(x=>x.p?.club===club).length;
}
function clubLimitMessage(team,p){
  const name=team?.isMine?"La tua rosa":(team?.name||"Questa squadra"),limit=configuredClubLimit();
  return `${name} ha già ${limit} giocatori del ${p.club}. Il regolamento non consente di superare questo limite.`;
}
function mineTeam(){return state.league?.teams?.find(t=>t.isMine)||{id:"mine",name:"La mia squadra",isMine:true}}

function neutralPrice(p){return Math.max(1,Math.round(Number(p?.fvm||0)*2.5))}
function auctionTransactions(){
  const tx=[];
  Object.entries(state.purchases).forEach(([id,data])=>{const p=getPlayer(id);if(p&&Number(data.price)>0)tx.push({p,price:Number(data.price),teamId:"mine",at:data.at||0})});
  Object.entries(state.sold).forEach(([id,data])=>{const p=getPlayer(id);if(p&&Number(data.price)>0)tx.push({p,price:Number(data.price),teamId:data.teamId||"",at:data.at||0})});
  return tx;
}
function inflationStats(filterFn=()=>true){
  const rows=auctionTransactions().filter(x=>filterFn(x.p,x));
  const actual=rows.reduce((a,x)=>a+x.price,0);
  const expected=rows.reduce((a,x)=>a+neutralPrice(x.p),0);
  const pct=expected?((actual/expected)-1)*100:0;
  return {count:rows.length,actual,expected,pct,confidence:clamp(rows.length/8)};
}
function familyById(id){return INTEL_FAMILIES.find(x=>x.id===id)}
function playerMatchesFamily(p,family){
  const f=typeof family==="string"?familyById(family):family;
  if(!f)return false;
  const tokens=roleTokens(p.role);
  return f.roles.some(r=>tokens.includes(r));
}
function familyInflation(id){return inflationStats(p=>playerMatchesFamily(p,id))}
function familyMarketHealth(id){
  const f=familyById(id); if(!f)return {total:0,remaining:0,countShare:0,qualityShare:0};
  const all=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&playerMatchesFamily(p,f));
  const remaining=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
  const qAll=all.reduce((a,p)=>a+Math.max(1,playerQuality(p)),0);
  const qRem=remaining.reduce((a,p)=>a+Math.max(1,playerQuality(p)),0);
  return {total:all.length,remaining:remaining.length,countShare:all.length?remaining.length/all.length:0,qualityShare:qAll?qRem/qAll:0};
}

function fastSlotMatch(slots,players){
  const ordered=players.slice().sort((a,b)=>playerQuality(b)-playerQuality(a));
  const assigned=Array(slots.length).fill(null);
  function tryPlayer(p,seen){
    const opts=[];
    for(let i=0;i<slots.length;i++)if(slotCompatible(p,slots[i]))opts.push(i);
    opts.sort((a,b)=>{
      const aa=assigned[a]?1:0,bb=assigned[b]?1:0;
      return aa-bb || slots[a].roles.length-slots[b].roles.length;
    });
    for(const i of opts){
      if(seen.has(i))continue;
      seen.add(i);
      if(!assigned[i] || tryPlayer(assigned[i],seen)){
        assigned[i]=p;return true;
      }
    }
    return false;
  }
  ordered.forEach(p=>tryPlayer(p,new Set()));
  return {assign:assigned,filled:assigned.filter(Boolean).length,total:slots.length};
}
function slotFinality(slot,currentPhase=phaseIndex()){
  const phases=slot.roles.map(rolePhaseIndex);
  const minP=Math.min(...phases),maxP=Math.max(...phases);
  if(currentPhase>maxP)return 1;
  if(currentPhase===maxP)return .62;
  if(currentPhase>=minP)return .35;
  return .10;
}
function modulePredictionForTeam(team){
  const econ=teamEconomy(team);
  const roster=econ.items.map(x=>x.p);
  const movement=roster.filter(p=>!roleTokens(p.role).includes("Por"));
  const spendTotal=Math.max(1,econ.items.reduce((a,x)=>a+x.price,0));
  const recent=econ.items.slice().sort((a,b)=>(b.p&&((state.purchases[b.p.id]?.at)||(state.sold[b.p.id]?.at))||0)-((a.p&&((state.purchases[a.p.id]?.at)||(state.sold[a.p.id]?.at)))||0)).slice(0,4);

  const scored=MANTRA_MODULES.map(module=>{
    const match=fastSlotMatch(module.slots,roster);
    let weightedPossible=0,weightedFilled=0,quality=0,depth=0;
    module.slots.forEach((slot,i)=>{
      if(slot.roles.includes("Por"))return;
      const f=.35+1.65*slotFinality(slot);
      weightedPossible+=f;
      if(match.assign[i]){
        weightedFilled+=f;
        quality+=f*clamp(playerQuality(match.assign[i])/220);
      }
      const compatible=roster.filter(p=>slotCompatible(p,slot)).length;
      depth+=f*clamp((compatible-1)/2);
    });
    const coverage=weightedPossible?weightedFilled/weightedPossible:0;
    const qualityScore=weightedPossible?quality/weightedPossible:0;
    const depthScore=weightedPossible?depth/weightedPossible:0;
    const assignedIds=new Set(match.assign.filter(Boolean).map(p=>String(p.id)));
    const coherentSpend=econ.items.filter(x=>assignedIds.has(String(x.p.id))).reduce((a,x)=>a+x.price,0)/spendTotal;
    const recentFit=recent.length?recent.filter(x=>module.slots.some(slot=>slotCompatible(x.p,slot))).length/recent.length:0;
    const score=100*(.52*coverage+.15*qualityScore+.10*depthScore+.15*coherentSpend+.08*recentFit);
    return {module,score,match,coverage,quality:qualityScore,depth:depthScore,coherentSpend,recentFit};
  });
  const maxScore=Math.max(...scored.map(x=>x.score),0);
  const temp=8;
  const weights=scored.map(x=>Math.exp((x.score-maxScore)/temp));
  const wsum=weights.reduce((a,b)=>a+b,0)||1;
  scored.forEach((x,i)=>x.prob=weights[i]/wsum);
  scored.sort((a,b)=>b.prob-a.prob);
  const gap=(scored[0]?.prob||0)-(scored[1]?.prob||0);
  const phaseBase=[.08,.25,.48,.72][phaseIndex()]||.08;
  const sample=clamp(movement.length/14);
  const confidence=clamp(phaseBase*.55+sample*.35+gap*.75,0.05,.96);
  return {team,econ,ranked:scored,top:scored[0],confidence};
}
function missingDemandForPrediction(pred,familyId){
  const family=typeof familyId==="string"?familyById(familyId):familyId;if(!family)return 0;
  let demand=0;
  pred.ranked.forEach(r=>{
    let units=0;
    r.module.slots.forEach((slot,i)=>{
      if(r.match.assign[i])return;
      const intersection=slot.roles.filter(role=>family.roles.includes(role));
      if(!intersection.length)return;
      const share=intersection.length/slot.roles.length;
      units+=Math.max(.45,share);
    });
    demand+=r.prob*units;
  });
  return demand;
}
function buildAuctionIntel(){
  const teams=state.league?.teams?.length?state.league.teams:[mineTeam()];
  const predictions={};
  teams.forEach(t=>predictions[t.id]=modulePredictionForTeam(t));
  const opponents=teams.filter(t=>!t.isMine);
  const demand={};
  INTEL_FAMILIES.forEach(f=>{
    const teamRows=opponents.map(t=>{
      const pred=predictions[t.id];
      const units=missingDemandForPrediction(pred,f.id);
      const econ=pred.econ;
      const money=clamp(econ.maxNext/350);
      const need=clamp(units/1.5);
      const marketPressure=need*(.45+.55*money)*pred.confidence;
      return {team:t,units,need,money,marketPressure,pressure:marketPressure,maxNext:econ.maxNext,pred};
    }).sort((a,b)=>b.marketPressure-a.marketPressure);
    demand[f.id]={teams:teamRows,totalPressure:teamRows.reduce((a,x)=>a+x.marketPressure,0),likelyTeams:teamRows.filter(x=>x.marketPressure>=.22).length};
  });
  const scarcity={};
  INTEL_FAMILIES.forEach(f=>{
    const health=familyMarketHealth(f.id);
    const inf=familyInflation(f.id);
    const supply=.5*health.countShare+.5*health.qualityShare;
    const demandNorm=clamp((demand[f.id]?.totalPressure||0)/Math.max(1,health.remaining/8));
    const infNorm=inf.count?clamp(Math.max(0,inf.pct)/50):0;
    const risk=Math.round(100*clamp(.56*(1-supply)+.29*demandNorm+.15*infNorm));
    scarcity[f.id]={...health,inflation:inf,risk,demandNorm,likelyTeams:demand[f.id]?.likelyTeams||0};
  });
  const economy=teams.map(t=>({team:t,...teamEconomy(t)})).sort((a,b)=>b.remaining-a.remaining||b.maxNext-a.maxNext);
  const repInflation={};
  ["POR","DIF","CEN","ATT"].forEach(rep=>repInflation[rep]=inflationStats(p=>playerAuctionPhase(p)===rep));
  const leagueSpend={POR:0,DIF:0,CEN:0,ATT:0};
  economy.forEach(e=>Object.keys(leagueSpend).forEach(r=>leagueSpend[r]+=e.byRep[r]||0));
  return {predictions,demand,scarcity,economy,repInflation,overallInflation:inflationStats(),leagueSpend};
}
let auctionIntelCache=null;
function getAuctionIntel(){return auctionIntelCache||(auctionIntelCache=buildAuctionIntel())}
function invalidateAuctionIntel(){auctionIntelCache=null}

function riskClass(risk){return risk>=70?"risk-red":risk>=50?"risk-orange":risk>=30?"risk-yellow":"risk-green"}
function riskIcon(risk){return risk>=70?"ALTO":risk>=50?"MED":risk>=30?"BASSO":"OK"}
function familyRiskForPlayer(p,intel=getAuctionIntel()){
  const ids=INTEL_FAMILIES.filter(f=>playerMatchesFamily(p,f)).map(f=>f.id);
  if(!ids.length)return {risk:0,ids:[]};
  const values=ids.map(id=>intel.scarcity[id]?.risk||0);
  return {risk:Math.round(values.reduce((a,b)=>a+b,0)/values.length),ids};
}
function playerInflation(p,intel=getAuctionIntel()){
  const familyIds=INTEL_FAMILIES.filter(f=>playerMatchesFamily(p,f)).map(f=>f.id);
  const stats=familyIds.map(id=>intel.scarcity[id]?.inflation).filter(x=>x&&x.count);
  if(stats.length)return stats.reduce((a,x)=>a+x.pct,0)/stats.length;
  return intel.repInflation[p.reparto]?.pct||intel.overallInflation.pct||0;
}
function opponentAssignmentShare(){
  const sold=soldPlayers();if(!sold.length)return 0;
  const validTeams=new Set(opponentTeams().map(team=>String(team.id)));
  const assigned=sold.filter(p=>{
    const sale=state.sold[p.id];
    return validTeams.has(String(sale?.teamId||""))&&(!sale?.leagueId||sale.leagueId===state.league?.id);
  }).length;
  return clamp(assigned/sold.length);
}
function opponentRoleNeedsForTeam(team,intel=getAuctionIntel()){
  const pred=intel.predictions[team.id];if(!pred)return [];
  return OPPONENT_ROLE_FAMILIES.map(f=>{
    const row=intel.demand[f.id]?.teams.find(x=>x.team.id===team.id);
    const units=row?.units??missingDemandForPrediction(pred,f);
    return {id:f.id,label:f.label,roles:f.roles,units,need:row?.need??clamp(units/1.5)};
  }).sort((a,b)=>b.need-a.need||a.label.localeCompare(b.label,"it"));
}
function opponentTeamDataConfidence(team,intel=getAuctionIntel()){
  const pred=intel.predictions[team.id],engine=window.FA2OpponentIntelligence;
  if(typeof engine?.teamDataConfidence!=="function")return clamp(pred?.confidence||0);
  return engine.teamDataConfidence({
    phaseIndex:phaseIndex(),
    rosterTotal:configuredRosterTotal(),
    rosterCount:pred?.econ?.items?.length||0,
    moduleConfidence:pred?.confidence||0,
    assignmentShare:opponentAssignmentShare()
  });
}
/* A4.2 — unica valutazione avversaria per Leghe, Asta Live e MAX live.
   Il motore riceve una fotografia dei dati esistenti e non scrive nello stato. */
function opponentIntelligenceForPlayer(p,intel=getAuctionIntel()){
  const empty={version:"A4.2",anchorPrice:Math.max(1,Number(p?.maxPrice||neutralPrice(p))),teams:[],expectedRivals:0,likelyRivals:0,atLeastOneBid:0,pricePressurePct:0,pressureLabel:"BASSA",confidence:0};
  if(!state.league||!p)return empty;
  const opponents=opponentTeams(),engine=window.FA2OpponentIntelligence;
  const anchorPrice=empty.anchorPrice,clubLimit=configuredClubLimit(),assignmentShare=opponentAssignmentShare();
  const teamInputs=opponents.map(team=>{
    const pred=intel.predictions[team.id],econ=pred?.econ||teamEconomy(team);
    const needs=opponentRoleNeedsForTeam(team,intel);
    return {
      id:team.id,name:team.name,module:pred?.top?.module.name||"—",moduleConfidence:pred?.confidence||0,
      rosterCount:econ.items?.length||0,remaining:econ.remaining,missing:econ.missing,maxNext:econ.maxNext,
      clubEligible:!clubLimit||teamClubCount(team,p.club)<clubLimit,needs
    };
  });
  if(typeof engine?.evaluatePlayer!=="function"){
    const rows=teamInputs.map(row=>{
      const matching=row.needs.filter(need=>need.roles.some(role=>roleTokens(p.role).includes(role))).sort((a,b)=>b.need-a.need);
      const probability=clamp((matching[0]?.need||0)*row.moduleConfidence*(row.maxNext>=anchorPrice?1:.2));
      return {...row,team:leagueTeamById(row.id),teamId:row.id,need:matching[0]?.need||0,needLabel:matching[0]?.label||"",probability,pressure:probability,dataConfidence:row.moduleConfidence,confidence:row.moduleConfidence,estimatedCap:Math.min(row.maxNext,anchorPrice),eligible:row.missing>0};
    }).sort((a,b)=>b.probability-a.probability);
    const atLeastOneBid=rows.length?1-rows.reduce((value,row)=>value*(1-row.probability),1):0;
    return {...empty,teams:rows,expectedRivals:rows.reduce((sum,row)=>sum+row.probability,0),likelyRivals:rows.filter(row=>row.probability>=.42).length,atLeastOneBid,confidence:rows.length?rows.reduce((sum,row)=>sum+row.dataConfidence,0)/rows.length:0};
  }
  const result=engine.evaluatePlayer({
    anchorPrice,minBid:configuredMinBid(),budget:configuredBudget(),rosterTotal:configuredRosterTotal(),
    phaseIndex:phaseIndex(),assignmentShare,playerRoles:roleTokens(p.role),teams:teamInputs
  });
  const teamsById=new Map(opponents.map(team=>[String(team.id),team]));
  return {...result,teams:result.teams.map(row=>({...row,team:teamsById.get(String(row.teamId)),pressure:row.probability,confidence:row.dataConfidence}))};
}
function competitionForPlayer(p,intel=getAuctionIntel()){return opponentIntelligenceForPlayer(p,intel).teams}
function liveMaxForPlayer(p,intel=getAuctionIntel()){
  const base=Math.max(1,Number(p.maxPrice||neutralPrice(p)));
  const inf=clamp(playerInflation(p,intel),-35,70);
  const risk=familyRiskForPlayer(p,intel).risk;
  const opponent=opponentIntelligenceForPlayer(p,intel),comp=opponent.teams;
  const activeComp=opponent.likelyRivals;
  const factor=clamp(1+(inf/100)*.25+((risk-35)/100)*.16+Math.min(.10,opponent.pricePressurePct/100),.78,1.25);
  const mine=teamEconomyForPurchase();
  const live=Math.round(base*factor);
  return {base,live:Math.min(live,mine.maxNext||live),rawLive:live,inflation:inf,risk,activeComp,competition:comp,opponent};
}

/* v1.43 — Target dinamici Asta Live.
   I TARGET originali restano immutati; quando uno viene perso il motore
   promuove automaticamente la migliore alternativa ancora disponibile. */
function isStaticTarget(p){return !!p && p.strategic && String(p.notes||"").toUpperCase().includes("TARGET")}
function staticTargets(){return allPlayers.filter(isStaticTarget)}
function lostStaticTargets(){
  return staticTargets().filter(p=>!state.purchases[p.id] && (state.sold[p.id] || p.outOfListone));
}
function availableStaticTargets(){
  return staticTargets().filter(p=>isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]);
}
function currentMissingStrategySlots(){
  const st=activeStrategy(),match=bestLineupMatch(st,purchasedPlayers());
  return st.slots.map((slot,i)=>({slot,i,filled:!!match.assign[i]})).filter(x=>!x.filled);
}
function phaseBudgetRemaining(phase){
  const guide=Number(scaledStrategyBudgets(activeStrategy())?.[phase]||0);
  const used=purchasedPlayers().filter(p=>playerAuctionPhase(p)===phase).reduce((a,p)=>a+Number(state.purchases[p.id]?.price||0),0);
  return Math.max(0,guide-used);
}
function roleAffinityScore(candidate,lost){
  const ct=roleTokens(candidate.role),lt=roleTokens(lost.role);
  const overlap=ct.filter(x=>lt.includes(x)).length;
  let score=overlap?24+Math.min(10,(overlap-1)*5):0;
  const cp=primaryOffensiveRole(candidate),lp=primaryOffensiveRole(lost);
  if(cp&&lp&&cp===lp)score+=16;
  const sharedFamilies=INTEL_FAMILIES.filter(f=>playerMatchesFamily(candidate,f)&&playerMatchesFamily(lost,f)).length;
  score+=Math.min(14,sharedFamilies*7);
  const cf=strategyPlayerFit(candidate),lf=strategyPlayerFit(lost);
  if(cf.some(x=>lf.includes(x)))score+=12;
  return Math.min(58,score);
}
function dynamicAlternativeScore(candidate,lost,intel=getAuctionIntel(),ctx=null){
  if(!candidate||!lost||String(candidate.id)===String(lost.id))return -Infinity;
  if(!isMarketEligiblePlayer(candidate)||state.purchases[candidate.id]||state.sold[candidate.id])return -Infinity;
  if(ctx?.managedPlanPlayers?.has(String(candidate.id)))return -Infinity;
  if(playerAuctionPhase(candidate)!==playerAuctionPhase(lost))return -Infinity;
  const clubLimit=configuredClubLimit();
  if(clubLimit&&countClub(candidate.club)>=clubLimit)return -Infinity;

  let score=roleAffinityScore(candidate,lost);
  if(score<18)return -Infinity; // evita alternative solo nominalmente nello stesso reparto

  const missing=ctx?.missing||currentMissingStrategySlots();
  const missingFits=missing.filter(x=>slotCompatible(candidate,x.slot));
  score+=Math.min(18,missingFits.length*6);
  if(missingFits.some(x=>activeStrategy().keySlots.some(k=>k.label===x.slot.label)))score+=8;

  const quality=Math.max(1,playerQuality(candidate));
  const lostQuality=Math.max(1,playerQuality(lost));
  score+=Math.min(15,15*clamp(quality/lostQuality,0,1.2));

  if(candidate.strategic)score+=12;
  if(isStaticTarget(candidate))score+=8;
  score+=starterPriorityBonus(candidate);

  const mine=ctx?.mine||teamEconomy(mineTeam());
  const guide=ctx?.guide??phaseBudgetRemaining(playerAuctionPhase(candidate));
  if(quality<=mine.maxNext)score+=5;
  if(guide>0 && quality<=guide)score+=4;
  else if(guide>0 && quality>guide*1.35)score-=5;

  const u23Owned=ctx?.u23Owned??purchasedPlayers().filter(isU23Player).length;
  const u21Owned=ctx?.u21Owned??purchasedPlayers().filter(isU21Player).length;
  const u23Rule=configuredUnderRule("u23"),u21Rule=configuredUnderRule("u21"),u23Min=u23Rule?.enabled?Number(u23Rule.min)||0:0,u21Min=u21Rule?.enabled?Number(u21Rule.min)||0:0;
  if(u23Owned<u23Min && isU23Player(candidate))score+=4;
  if(u21Owned<u21Min && isU21Player(candidate))score+=5;

  const risk=familyRiskForPlayer(candidate,intel).risk;
  score+=Math.min(8,risk*.08); // se il ruolo si sta esaurendo, priorità maggiore
  return Math.round(score);
}
function bestAlternativeForTarget(lost,intel=getAuctionIntel()){
  if(!lost)return null;
  const owned=purchasedPlayers();
  const ctx={
    missing:currentMissingStrategySlots(),
    mine:teamEconomy(mineTeam()),
    guide:phaseBudgetRemaining(playerAuctionPhase(lost)),
    u23Owned:owned.filter(isU23Player).length,
    u21Owned:owned.filter(isU21Player).length,
    managedPlanPlayers:fa2ManagedPlanPlayerIds()
  };
  const rank=pool=>pool
    .map(p=>({p,score:dynamicAlternativeScore(p,lost,intel,ctx)}))
    .filter(x=>Number.isFinite(x.score))
    .sort((a,b)=>b.score-a.score||playerQuality(b.p)-playerQuality(a.p));
  // Prima lavora sulla shortlist strategica da 200; il listone completo è solo fallback.
  let candidates=rank(allPlayers.filter(p=>p.strategic));
  if(!candidates.length)candidates=rank(allPlayers);
  if(!candidates.length)return null;
  const best=candidates[0];
  const fit=strategyPlayerFit(best.p);
  const reason=[
    roleTokens(best.p.role).some(r=>roleTokens(lost.role).includes(r))?`ruolo ${best.p.role}`:"profilo compatibile",
    fit.length?`fit ${fit.join("/")}`:`fit ${activeStrategy().module}`,
    `MAX live ${fmt(liveMaxForPlayer(best.p,intel).live)}`
  ].join(" · ");
  return {lost,player:best.p,score:best.score,reason};
}
function fa2ManagedPlanPlayerIds(){
  const resolver=window.FA2Strategy?.resolvePlanSlots;
  if(typeof resolver!=="function")return new Set();
  const ids=new Set();
  for(const rt of resolver(fa2LoadPurchasePlan(),fa2PlanCandidateAuctionState)){
    for(const row of rt?.candidateStates||[]){
      if(row?.candidate?.id)ids.add(String(row.candidate.id));
    }
  }
  return ids;
}
function dynamicTargetRecommendations(intel=getAuctionIntel()){
  /* A5.6.3 — Il Piano Strategia è l'unica fonte operativa di TARGET e
     alternative. I vecchi TARGET restano profili utili all'ordinamento,
     ma non possono più promuovere automaticamente un sostituto. */
  void intel;
  return [];
}
function dynamicAlternativeForPlayer(p,intel=getAuctionIntel(),recommendations=null){
  void p;void intel;void recommendations;
  return null;
}
function liveTargetBannerHTML(intel=getAuctionIntel()){
  if(teamEconomyForPurchase().missing<=0)return `<div class="live-target-alert plan covered"><div><span>ROSA COMPLETA</span><b>Nessun obiettivo ordinario</b><small>Per riaprire un posto usa uno svincolo o una promessa nell’Asta di Riparazione.</small></div></div>`;
  const planRuntime=typeof fa2PlanRuntimeSlots==="function"?fa2PlanRuntimeSlots():[];
  const slotStates=window.FA2Strategy?.SLOT_STATES||{};
  const promoted=planRuntime.find(x=>x.state===slotStates.PROMOTED&&x.current&&playerAuctionPhase(getPlayer(x.current.id))===state.auctionPhase);
  if(promoted){
    const slotLabel=fa2PlanSlotLabel(promoted.slot,promoted.key);
    return `<div class="live-target-alert urgent plan"><div><span>TARGET PERSO · ${esc(promoted.originalTarget?.name||slotLabel)}</span><b>${kitHTML(getPlayer(promoted.current.id)?.club,'xs',getPlayer(promoted.current.id)?.club)} ${esc(promoted.current.name)}</b><small>Promosso automaticamente · ${esc(slotLabel)} · MAX strategico ${fmt(promoted.currentCap||0)}</small></div><button type="button" onclick='selectLivePlayer(${idArg(promoted.current.id)})'>PARTECIPA</button></div>`;
  }
  const covered=planRuntime.find(x=>x.state===slotStates.COVERED&&x.coveredBy&&playerAuctionPhase(getPlayer(x.coveredBy.id))===state.auctionPhase);
  if(covered){
    const p=getPlayer(covered.coveredBy.id);
    const paid=Number(state.purchases?.[p?.id]?.price||0);
    const slotLabel=fa2PlanSlotLabel(covered.slot,covered.key);
    return `<div class="live-target-alert plan covered"><div><span>SLOT COPERTO · ${esc(slotLabel)}</span><b>${kitHTML(p?.club,'xs',p?.club)} ${esc(covered.coveredBy.name)}</b><small>Acquistato da noi${paid?` a ${fmt(paid)} cr`:""}. Il Piano Strategia non cerca più sostituti per ${esc(covered.originalTarget?.name||slotLabel)}.</small></div></div>`;
  }
  const exhausted=planRuntime.find(x=>{const p=getPlayer(x.originalTarget?.id);return x.state===slotStates.LOST_EXHAUSTED&&p&&playerAuctionPhase(p)===state.auctionPhase});
  if(exhausted){
    const slotLabel=fa2PlanSlotLabel(exhausted.slot,exhausted.key);
    return `<div class="live-target-alert urgent"><div><span>SLOT PERSO / ESAURITO · ${esc(slotLabel)}</span><b>${esc(exhausted.originalTarget?.name||slotLabel)}</b><small>Nessun candidato salvato è ancora disponibile. Riapri lo slot in Strategia per rianalizzarlo.</small></div></div>`;
  }
  return "";
}
function updateSoldEconomicNote(){
  const team=leagueTeamById($("#soldTeamSelect")?.value);
  if(!team){
    if($("#soldLeagueNote"))$("#soldLeagueNote").textContent="Nessuna lega creata: vendita registrata senza squadra.";
    return;
  }
  const econ=teamEconomy(team,soldPlayerId);
  $("#soldLeagueNote").textContent=`${team.name}: ${fmt(econ.remaining)} cr residui · ${econ.missing} posti · MAX prossimo ${fmt(econ.maxNext)}.`;
}

function signal(p, price){
  price=Number(price||0); let m=Number(p.maxPrice||0);
  if(!price) return {t:"Inserisci il prezzo",c:""};
  if(price<=m*.75) return {t:"AFFARE",c:"green"};
  if(price<=m*.92) return {t:"OK",c:"green"};
  if(price<=m) return {t:"LIMITE",c:"orange"};
  return {t:"STOP",c:"red"};
}
function pctLabel(v,count=1){
  if(!count)return "—";
  const n=Math.round(Number(v||0));
  return `${n>0?"+":""}${n}%`;
}
/* v1.45.4 — editor unificato delle assegnazioni dalla Dashboard.
   Permette di correggere in un unico punto squadra, prezzo o annullare
   un'assegnazione registrata durante Asta Live. */
function dashboardAssignmentData(id){
  const p=getPlayer(id);if(!p)return null;
  const own=state.purchases?.[p.id];
  if(own)return {p,mine:true,teamKey:"__mine__",team:mineTeam(),price:Number(own.price||0),at:Number(own.at||0)};
  const sale=state.sold?.[p.id];
  if(sale)return {p,mine:false,teamKey:sale.teamId||"__unassigned__",team:leagueTeamById(sale.teamId),price:Number(sale.price||0),at:Number(sale.at||0)};
  return null;
}
function dashboardAssignmentTargetTeam(key){
  if(key==="__mine__")return mineTeam();
  if(key==="__unassigned__")return null;
  return leagueTeamById(key);
}
function dashboardAssignmentTeamOptions(current){
  const teams=state.league?.teams||[];
  let rows=[];
  if(teams.length){
    rows=teams.map(t=>`<option value="${t.isMine?"__mine__":escAttr(t.id)}">${esc(t.name)}${t.isMine?" · MIA SQUADRA":""}</option>`);
  }else{
    rows.push('<option value="__mine__">La mia squadra</option>');
  }
  if(current?.teamKey==="__unassigned__" || (current?.teamKey && current.teamKey!=="__mine__" && !leagueTeamById(current.teamKey))){
    rows.push('<option value="__unassigned__">Non assegnato</option>');
  }
  return rows.join("");
}
function updateDashboardAssignmentEconomicInfo(){
  const id=$("#dashAssignPlayerId")?.value;
  const p=getPlayer(id);if(!p)return;
  const key=$("#dashAssignTeam")?.value||"__mine__";
  const team=dashboardAssignmentTargetTeam(key);
  const box=$("#dashAssignEconomicInfo");if(!box)return;
  if(!team){box.textContent="Assegnazione senza squadra: seleziona una squadra della lega per collegarla correttamente.";return;}
  const econ=teamEconomy(team,p.id);
  box.innerHTML=`<span>${team.isMine?"Mia squadra":esc(team.name)}</span><b>${fmt(econ.remaining)} cr residui · ${econ.missing} posti · MAX ${fmt(econ.maxNext)}</b>`;
}
function openDashboardAssignmentEditor(id){
  const current=dashboardAssignmentData(id);if(!current)return;
  const p=current.p;
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body dashboard-assignment-editor">
    <div class="safety-modal-head"><div><div class="eyebrow">Asta Live</div><h2>Modifica assegnazione</h2></div><button class="ghost" type="button" aria-label="Chiudi modifica assegnazione" onclick="closeSafetyDialog()">✕</button></div>
    <div class="dashboard-assignment-player">${kitHTML(p.club,'sm',p.club)}<span><b>${playerNameHTML(p)}</b><small>${p.club} · ${p.role}</small></span></div>
    <input id="dashAssignPlayerId" type="hidden" value="${escAttr(p.id)}">
    <label>Squadra aggiudicataria
      <select id="dashAssignTeam">${dashboardAssignmentTeamOptions(current)}</select>
    </label>
    <label>Prezzo di aggiudicazione
      <input id="dashAssignPrice" type="number" min="${configuredMinBid()}" step="1" inputmode="numeric" value="${current.price||""}">
    </label>
    <div id="dashAssignEconomicInfo" class="dashboard-assignment-economic"></div>
    <div class="dashboard-assignment-actions">
      <button class="dangerbtn" id="dashAssignDelete">Annulla assegnazione</button>
      <button class="primary" id="dashAssignSave">Salva modifiche</button>
    </div>
  </div>`;
  const select=$("#dashAssignTeam");
  if(select){
    const desired=current.teamKey;
    if([...select.options].some(o=>o.value===desired))select.value=desired;
    else if(current.mine)select.value="__mine__";
    select.addEventListener("change",updateDashboardAssignmentEconomicInfo);
  }
  $("#dashAssignSave").onclick=saveDashboardAssignmentEdit;
  $("#dashAssignDelete").onclick=cancelDashboardAssignment;
  updateDashboardAssignmentEconomicInfo();
  if(!$("#safetyDialog").open)$("#safetyDialog").showModal();
}
window.openDashboardAssignmentEditor=openDashboardAssignmentEditor;
function saveDashboardAssignmentEdit(){
  const id=$("#dashAssignPlayerId")?.value;
  const current=dashboardAssignmentData(id);if(!current)return;
  if(!protectedPermission("modificare l'assegnazione"))return;
  const p=current.p;
  const price=Number($("#dashAssignPrice")?.value||0);
  const minBid=configuredMinBid();
  if(!Number.isInteger(price)||price<minBid){alert(`Inserisci un prezzo valido (minimo ${minBid}).`);return;}
  const teamKey=$("#dashAssignTeam")?.value||"__mine__";
  const target=dashboardAssignmentTargetTeam(teamKey);
  if(target){
    const clubCount=teamClubCount(target,p.club,p.id);
    const clubLimit=configuredClubLimit();
    if(clubLimit&&clubCount>=clubLimit){alert(clubLimitMessage(target,p));return;}
    const econ=teamEconomy(target,p.id);
    if(price>econ.maxNext){alert(`${target.isMine?"La tua squadra":target.name} può spendere al massimo ${econ.maxNext} crediti su questa assegnazione, conservando ${configuredReservePerSlot()} crediti per ogni slot successivo.`);return;}
  }
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
  const oldTeam=current.mine?(current.team?.name||"La mia squadra"):(current.team?.name||"Non assegnato");
  const newTeam=target?.name||"Non assegnato";
  delete state.purchases[p.id];
  delete state.sold[p.id];
  if(teamKey==="__mine__"){
    state.purchases[p.id]={price,at:current.at||Date.now()};
  }else{
    state.sold[p.id]={price,at:current.at||Date.now(),teamId:teamKey==="__unassigned__"?"":teamKey,leagueId:state.league?.id||""};
  }
  save();saveSold();fa2AfterAuctionStateChange("ASSIGNMENT_EDITED",p.id,strategyBefore);
  recordOperation("MODIFICA_ASSEGNAZIONE",`${p.name}: ${oldTeam} → ${newTeam} · ${current.price} → ${price} cr`,before);
  closeSafetyDialog();refresh();
}
function cancelDashboardAssignment(){
  const id=$("#dashAssignPlayerId")?.value;
  const current=dashboardAssignmentData(id);if(!current)return;
  if(!protectedPermission("annullare l'assegnazione"))return;
  if(!confirm(`Annullare l'assegnazione di ${current.p.name}?\n\nIl giocatore tornerà disponibile in Asta Live.`))return;
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
  delete state.purchases[current.p.id];
  delete state.sold[current.p.id];
  save();saveSold();fa2AfterAuctionStateChange("ASSIGNMENT_REMOVED",current.p.id,strategyBefore);
  recordOperation("ANNULLA_ASSEGNAZIONE",`${current.p.name}: assegnazione annullata`,before);
  closeSafetyDialog();refresh();
}
window.saveDashboardAssignmentEdit=saveDashboardAssignmentEdit;
window.cancelDashboardAssignment=cancelDashboardAssignment;

function openLeagueTeamIntelligence(teamId){
  const team=leagueTeamById(String(teamId));
  if(!team)return;
  closeSafetyDialog();
  switchView("leagueView");
  requestAnimationFrame(()=>{
    const card=$$(".intelligence-team-card").find(el=>String(el.dataset.teamId)===String(team.id));
    if(!card)return;
    card.open=true;
    card.scrollIntoView({behavior:"smooth",block:"start"});
  });
}
window.openLeagueTeamIntelligence=openLeagueTeamIntelligence;

function openDashboardLeagueQuickView(teamId){
  const team=leagueTeamById(String(teamId));
  if(!team)return;
  const econ=teamEconomy(team),rosterTotal=configuredRosterTotal();
  const acquired=econ.items.length;
  $("#safetyDialogContent").innerHTML=`<div class="dialog-body dashboard-league-quickview">
    <div class="safety-modal-head">
      <div><div class="eyebrow">Panoramica Lega · ${team.isMine?"Mia squadra":"Rivale"}</div><h2>${esc(team.name)}</h2></div>
      <button type="button" class="ghost" aria-label="Chiudi" onclick="closeSafetyDialog()">✕</button>
    </div>
    <div class="dashboard-league-quick-kpis">
      <div class="featured"><span>Residuo</span><b>${fmt(econ.remaining)}<small> cr</small></b></div>
      <div><span>Acquistati</span><b>${acquired}<small>/${rosterTotal}</small></b></div>
      <div><span>Posti rimasti</span><b>${econ.missing}</b></div>
      <div><span>MAX prossimo</span><b>${fmt(econ.maxNext)}<small> cr</small></b></div>
    </div>
    <div class="dashboard-league-budget-line"><span>Speso finora</span><b>${fmt(econ.spent)} cr</b><small>Budget iniziale ${fmt(configuredBudget())} cr</small></div>
    <section class="dashboard-league-purchases">
      <div class="dashboard-league-purchases-head"><h3>Giocatori acquistati</h3><span>${acquired} ${acquired===1?"acquisto":"acquisti"}</span></div>
      <div class="dashboard-league-purchases-list">${leagueRosterRows(econ.items)}</div>
    </section>
    <button type="button" class="primary dashboard-league-detail-link" onclick='openLeagueTeamIntelligence(${idArg(team.id)})'>
      <span>Rose + Opponent Intelligence</span><strong>Apri ›</strong>
    </button>
  </div>`;
  const dialog=$("#safetyDialog");
  if(dialog&&!dialog.open)dialog.showModal();
}
window.openDashboardLeagueQuickView=openDashboardLeagueQuickView;

function renderDashboard(){
  invalidateAuctionIntel();
  const intel=getAuctionIntel();
  const bought=purchasedPlayers(),rosterTotal=configuredRosterTotal(),goalkeeperTarget=configuredGoalkeepers(),movementTarget=Math.max(0,rosterTotal-goalkeeperTarget),clubLimit=configuredClubLimit(),reservePerSlot=configuredReservePerSlot();
  const st=activeStrategy(),budgets=scaledStrategyBudgets(st),rec=strategyRecommendation(bought,intel);
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  bought.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id].price||0));

  const u23Rule=configuredUnderRule("u23"),u21Rule=configuredUnderRule("u21"),u23=bought.filter(p=>playerMatchesUnderRule(p,u23Rule)).length,u21=bought.filter(p=>playerMatchesUnderRule(p,u21Rule)).length;
  const u23Min=u23Rule?.enabled?Number(u23Rule.min)||0:0,u21Min=u21Rule?.enabled?Number(u21Rule.min)||0:0;
  const porCount=bought.filter(p=>p.reparto==="POR").length;
  const movCount=bought.length-porCount;
  const mineEcon=teamEconomy(mineTeam());
  const rem=mineEcon.remaining;
  const currentPhase=AUCTION_PHASES[phaseIndex()];
  const nextPhase=AUCTION_PHASES[phaseIndex()+1]||null;
  const leader=intel.economy[0];
  const clubAlerts=clubLimit?SERIES_A_CLUBS.map(([code])=>[code,countClub(code)]).filter(([,count])=>count>clubLimit):[];
  // v1.45.4 — ultimi 5 movimenti di tutta l'asta, non solo della mia rosa.
  const recent=auctionTransactions().slice().sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,5);
  const scarcityOrder=["Dd","Ds","Dc","MC","T","WA","APc","Pc"];
  const pressure=scarcityOrder.map(id=>({id,x:intel.scarcity[id],f:familyById(id)})).sort((a,b)=>(b.x?.risk||0)-(a.x?.risk||0))[0];
  const leagueOverview=(state.league?.teams||[])
    .map((team,index)=>({team,index,...teamEconomy(team)}))
    .sort((a,b)=>b.remaining-a.remaining||a.index-b.index);
  const watchCount=allPlayers.filter(p=>isWatchlisted(p.id)&&isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]).length;
  const repair=currentRepairSession(),repairIsActive=!!repair&&!repair.pausedAt,repairUsed=repairAcquisitionCount(repair),repairReleased=repair?.releases?.length||0,repairPromise=repairIsActive?activeRepairPromise(repair):null;
  const lifecycle=auctionLifecycleStatus();

  let alerts=[];
  if(bought.length>rosterTotal) alerts.push(`Rosa oltre limite: ${bought.length}/${rosterTotal}`);
  if(porCount>goalkeeperTarget) alerts.push(`Portieri oltre limite: ${porCount}/${goalkeeperTarget}`);
  if(movCount>movementTarget) alerts.push(`Movimento oltre limite: ${movCount}/${movementTarget}`);
  if(clubAlerts.length) alerts.push(`Club oltre ${clubLimit}: `+clubAlerts.map(([c,n])=>`${c} ${n}/${clubLimit}`).join(", "));
  if(mineEcon.remaining<mineEcon.minimumToFinish) alerts.push(`Crediti insufficienti per chiudere ${mineEcon.missing} slot con riserva ${reservePerSlot}`);

  const repLabel={POR:"Portieri",DIF:"Difensori",CEN:"Centrocampisti",ATT:"Attaccanti"};
  const repCards=["POR","DIF","CEN","ATT"].map(rep=>{
    const guide=Math.max(1,Number(budgets[rep]||0));
    const pct=Math.min(100,Math.max(0,byRep[rep]/guide*100));
    return `<div class="finance-rep"><span data-short="${rep}">${repLabel[rep]}</span><strong>${fmt(byRep[rep])}</strong><small>su ${fmt(guide)} crediti</small><i><em style="width:${pct}%"></em></i><b>${Math.round(pct)}%</b></div>`;
  }).join("");

  const recentRows=recent.length?recent.map(tx=>{
    const p=tx.p;
    const time=tx.at?new Date(tx.at).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"}):"—";
    const team=tx.teamId==="mine"?mineTeam():leagueTeamById(tx.teamId);
    const teamName=team?.name||(tx.teamId?"Squadra non disponibile":"Non assegnato");
    return `<button class="finance-recent-row finance-assignment-row ${team?.isMine?"mine":""}" onclick='openDashboardAssignmentEditor(${idArg(p.id)})'>
      <time>${time}</time>${kitHTML(p.club,'xs',p.club)}
      <span><b>${playerNameHTML(p)}</b><small><em>${esc(teamName)}</em> · ${p.club} · ${p.role}</small></span>
      <strong>${fmt(tx.price)}<small>cr</small></strong>
    </button>`;
  }).join(""):`<div class="finance-empty">Nessuna assegnazione ancora.</div>`;

  $("#dashboardView").innerHTML=`
    <div class="finance-dashboard">
      <section id="auctionLivePanel" class="finance-panel finance-live-panel finance-live-panel-top ${lifecycle.auctionComplete?"complete":""}">
        <div class="finance-panel-title"><b>ASTA LIVE</b><span>accesso rapido</span></div>
        <div class="finance-live-main"><span>${lifecycle.auctionComplete?"ASTA CONCLUSA":"FASE ATTIVA"}</span><strong>${lifecycle.auctionComplete?"OK":currentPhase.id}</strong><small>${lifecycle.auctionComplete?`${lifecycle.completeTeams}/${lifecycle.teams} rose complete · la tua rosa ${lifecycle.ownCount}/${lifecycle.rosterTotal}`:`${currentPhase.label} · ${mineEcon.missing} posti mancanti`}</small></div>
        <div class="finance-live-metrics">
          <div class="finance-live-sub"><span>${lifecycle.auctionComplete?"CREDITI RESIDUI":"MAX PROSSIMO"}</span><b>${fmt(lifecycle.auctionComplete?mineEcon.remaining:mineEcon.maxNext)}</b></div>
          <div class="finance-live-sub"><span>WATCHLIST</span><b>${watchCount}</b></div>
        </div>
        <div class="finance-live-actions">
          ${lifecycle.auctionComplete
            ?`<button type="button" class="primary finance-live-btn" onclick="openFinalReport()">APRI REPORT ASTA</button><div class="finance-text-btn">Rose importate e assegnazioni consolidate</div>`
            :`<button id="openLiveBtn" class="primary finance-live-btn">ENTRA IN ASTA</button><div class="finance-phase-track">${AUCTION_PHASES.map((ph,i)=>`<button class="${ph.id===state.auctionPhase?"active":""} ${i<phaseIndex()?"done":""}" onclick="setAuctionPhase('${ph.id}')">${ph.id}</button>`).join("")}</div>${nextPhase?`<button id="nextPhaseBtn" class="finance-text-btn">Termina ${currentPhase.id} · passa a ${nextPhase.id}</button>`:""}`}
        </div>
      </section>

      <button type="button" class="finance-repair-launch ${repair?repairIsActive?"active":"paused":""}" onclick="openRepairMarket()">
        <span>${repair?`<i>${repairIsActive?"SESSIONE ATTIVA":"SESSIONE SOSPESA"}</i>`:""}<b>ASTA DI RIPARAZIONE</b><small>${repair?`${repairReleased} svincoli · ${repairUsed} sostituzioni conteggiate · residuo ${fmt(mineEcon.remaining)} cr${repairPromise?` · promessa ${esc(repairPromise.name)}`:""}`:"Configura svincoli, rimborsi e limite acquisti secondo il regolamento della lega."}</small></span>
        <strong>${repair?repairIsActive?"GESTISCI":"RIPRENDI":"CONFIGURA"} ›</strong>
      </button>

      <section class="finance-kpis">
        <div class="finance-kpi finance-kpi-primary"><span>BUDGET RESIDUO</span><strong>${fmt(rem)}</strong><small>CREDITI</small></div>
        <div class="finance-kpi"><span>ROSA</span><strong>${bought.length}<em>/${rosterTotal}</em></strong><small>${porCount} POR · ${movCount} MOV.</small></div>
        <div class="finance-kpi ${u23>=u23Min?"ok":"warn"}"><span>U23</span><strong>${u23}<em>/${u23Min}</em></strong><small>${u23Rule?.enabled?`REQUISITO · nati dal ${u23Rule.birthYearFrom}`:"DISATTIVATO"}</small></div>
        <div class="finance-kpi ${u21>=u21Min?"ok":"warn"}"><span>U21</span><strong>${u21}<em>/${u21Min}</em></strong><small>${u21Rule?.enabled?`REQUISITO · nati dal ${u21Rule.birthYearFrom}`:"DISATTIVATO"}</small></div>
      </section>

      <section class="finance-panel finance-budget-panel">
        <div class="finance-panel-title"><b>BUDGET PER REPARTO</b><span>spesa / guida ${state.strategy}</span></div>
        <div class="finance-rep-grid">${repCards}</div>
      </section>

      <section class="finance-intel-grid">
        <div class="finance-stat"><span>CREDITI LIBERI REALI</span><strong>${fmt(mineEcon.free)}</strong><small>MAX prossimo ${fmt(mineEcon.maxNext)}</small></div>
        <div class="finance-stat"><span>LEADER CREDITI</span><b>${leader?esc(leader.team.name):"—"}</b><strong>${leader?fmt(leader.remaining):"—"}</strong><small>crediti residui</small></div>
        <div class="finance-stat finance-stat-warn"><span>INFLAZIONE ASTA</span><strong>${pctLabel(intel.overallInflation.pct,intel.overallInflation.count)}</strong><small>vs FVM ×2,5</small></div>
      </section>

      <section class="finance-strategy-grid">
        <div class="finance-strategy-card"><span>STRATEGIA CONSIGLIATA</span><strong>${rec.recommended==="A"?"4-3-1-2":"4-3-3"}</strong><small>${rec.recommended===state.strategy?"strategia attiva coerente":"valuta il cambio strategia"}</small></div>
        <div class="finance-strategy-card ${pressure?.x?.risk>=60?"warn":""}"><span>PRESSIONE MERCATO</span><strong>${pressure?.f?.label||currentPhase.label}</strong><div class="finance-pressure"><i style="width:${Math.min(100,pressure?.x?.risk||0)}%"></i></div><small>${pressure?.x?.risk||0}/100 · ${pressure?.x?.remaining||0} disponibili</small></div>
        <div class="finance-strategy-card"><span>MODULO TARGET</span><strong>${st.module}</strong><small>${state.strategy==="A"?"Strategia A":"Strategia B"}</small></div>
      </section>

      <section class="finance-market-grid">
        <div class="finance-panel finance-league-overview">
          <div class="finance-panel-title"><b>PANORAMICA LEGA</b><span>${state.league?state.league.size+" squadre · tocca per aprire":"lega non creata"}</span></div>
          ${leagueOverview.length?`<div class="finance-league-list">${leagueOverview.map((e,i)=>`
            <button type="button" class="finance-league-row ${e.team.isMine?"mine":""} ${i===0?"leader":""}" aria-label="Apri riepilogo di ${escAttr(e.team.name)}" onclick='openDashboardLeagueQuickView(${idArg(e.team.id)})'>
              <b class="finance-league-rank">${i+1}</b>
              <span class="finance-league-team"><strong>${esc(e.team.name)}</strong>${e.team.isMine?'<small class="finance-mine-label">MIA SQUADRA</small>':''}</span>
              <span class="finance-league-roster"><strong>${e.items.length}<em>/${rosterTotal}</em></strong><small>giocatori</small></span>
              <span class="finance-league-credit"><strong>${fmt(e.remaining)}</strong><small>crediti</small></span>
            </button>`).join("")}</div>`:`<div class="finance-empty">Crea una lega per il confronto avversari.</div>`}
        </div>
        <div class="finance-panel finance-club-panel">
          <div class="finance-panel-title"><b>GIOCATORI PER CLUB</b><span>${clubLimit?`quota massima ${clubLimit}`:"nessun limite"}</span></div>
          ${clubCounterHTML(bought)}
        </div>
      </section>

      <section class="finance-bottom-grid finance-bottom-grid-single">
        <div class="finance-panel finance-recent-panel">
          <div class="finance-panel-title"><b>ULTIME 5 ASSEGNAZIONI</b><span>${auctionTransactions().length} totali</span></div>
          <div class="finance-recent-list">${recentRows}</div>
          ${recent.length?`<div class="finance-recent-hint">Tocca un giocatore per modificare squadra, prezzo o annullare l'assegnazione.</div>`:""}
        </div>
      </section>

      ${alerts.length?`<div class="dash-critical">${alerts.join(" · ")}</div>`:""}

      <details class="finance-system-details">
        <summary><span>SISTEMA & CONTROLLO</span><small>protezione, dati, watchlist, report</small></summary>
        <div class="finance-system-content">
          ${safetyDashboardHTML()}
          ${dataFreshnessHTML()}
          ${listoneDashboardBadgeHTML()}
          ${watchlistDashboardHTML()}
          <button class="final-report-launch" onclick="openFinalReport()"><span>REPORT ASTA</span><b>${bought.length===rosterTotal?"Rosa completata · apri report":"Report parziale · "+bought.length+"/"+rosterTotal}</b><strong>›</strong></button>
        </div>
      </details>

      <details class="dashboard-plan-details finance-plan-details">
        <summary><span>PIANO STRATEGICO COMPLETO</span><small>apri / chiudi</small></summary>
        <div id="dashboardPlanContent"></div>
      </details>
    </div>`;

  const nextBtn=$("#nextPhaseBtn");if(nextBtn)nextBtn.onclick=nextAuctionPhase;
  const liveBtn=$("#openLiveBtn");if(liveBtn)liveBtn.onclick=openAuctionLive;
  const listoneBtn=$("#dashboardListoneBtn");if(listoneBtn)listoneBtn.onclick=()=>switchView("playersView");
  renderPlan("#dashboardPlanContent");
}
function clubCounterHTML(bought){
  const limit=configuredClubLimit();
  const counts={};
  SERIES_A_CLUBS.forEach(([code])=>counts[code]=0);
  bought.forEach(p=>{
    if(Object.prototype.hasOwnProperty.call(counts,p.club)){
      counts[p.club]+=1;
    }
  });

  return `<div class="club-grid">
    ${SERIES_A_CLUBS.map(([club,fullName])=>{
      const count=counts[club]||0;
      let cls="club-safe";
      if(limit&&count>=limit) cls="club-full";
      else if(limit&&count===Math.max(1,limit-1)) cls="club-warning";

      return `<div class="club-tile ${cls}" title="${fullName}">
        ${kitHTML(club,'tile',fullName)}
        <span class="club-tile-copy"><b>${club}</b><strong>${count}/${limit||"∞"}</strong></span>
      </div>`;
    }).join("")}
  </div>`;
}

function formationBroadGroup(role){
  const tokens=String(role||"").split("/").map(x=>x.trim()).filter(Boolean);
  if(tokens.includes("Por")) return "POR";
  if(tokens.some(r=>["W","T","A","Pc"].includes(r))) return "ATT";
  if(tokens.some(r=>["B","Ds","Dc","Dd"].includes(r))) return "DIF";
  return "CEN";
}

function formationAvailabilityRowsHTML(rows,type,club){
  const labels={injuries:"INF",suspended:"SQ",warned:"DIFF"};
  if(!rows?.length)return '<div class="formation-availability-empty">Nessuno segnalato</div>';
  return rows.map(item=>{
    const hint=type==="injuries"?(item.recovery||item.detail||"Tempi non indicati"):(item.detail||"");
    const extra=item.detail&&item.detail!==hint?`<small class="formation-availability-detail">${esc(item.detail)}</small>`:"";
    return `<div class="formation-availability-row ${type}">
      <span class="formation-availability-code">${labels[type]}</span>
      <span class="formation-availability-copy"><b>${esc(item.name)}</b>${hint?`<small>${type==="injuries"?"Recupero: ":""}${esc(hint)}</small>`:""}${extra}</span>
      ${disciplineCountersHTML(item.name,club,{withStatus:false})}
    </div>`;
  }).join("");
}

function formationAvailabilityPanelHTML(f){
  if(!availabilityFeedValid()){
    return `<section class="formation-availability-panel unavailable">
      <div class="formation-availability-head"><div><span>DISPONIBILITÀ E DISCIPLINA</span><b>Dati non importati</b></div></div>
      <p>La versione Clean Data non interroga fonti esterne. Questa sezione sarà disponibile soltanto con dati locali autorizzati.</p>
    </section>`;
  }
  const team=availabilityTeamFor(f.club);
  if(!team)return `<section class="formation-availability-panel unavailable"><p>Dati non disponibili per ${esc(f.team)}.</p></section>`;
  const sources=availabilityLiveFeed.sources||{},availability=sources.availability||{};
  return `<details class="formation-availability-panel">
    <summary class="formation-availability-head">
      <div><span>DISPONIBILITÀ E DISCIPLINA · A5.6</span><b>${esc(f.team)}</b><small>Aggiornato ${esc(formationDisplayDate(availabilityLiveFeed.generatedAt))}</small></div>
      <div class="formation-availability-totals" aria-label="${escAttr(formationAvailabilitySummary(f.club))}"><span>INF <b>${team.injuries?.length||0}</b></span><span>SQ <b>${team.suspended?.length||0}</b></span><span>DIFF <b>${team.warned?.length||0}</b></span></div>
      <span class="formation-availability-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="formation-availability-body">
      <div class="formation-availability-groups">
        <details><summary><span>Infortunati</span><b>${team.injuries?.length||0}</b><i aria-hidden="true">⌄</i></summary><div>${formationAvailabilityRowsHTML(team.injuries,"injuries",f.club)}</div></details>
        <details><summary><span>Squalificati</span><b>${team.suspended?.length||0}</b><i aria-hidden="true">⌄</i></summary><div>${formationAvailabilityRowsHTML(team.suspended,"suspended",f.club)}</div></details>
        <details><summary><span>Diffidati</span><b>${team.warned?.length||0}</b><i aria-hidden="true">⌄</i></summary><div>${formationAvailabilityRowsHTML(team.warned,"warned",f.club)}</div></details>
      </div>
      <p class="formation-availability-note">Dati locali forniti dall’utente. Le informazioni sono di supporto e non modificano automaticamente rosa o strategia.</p>
    </div>
  </details>`;
}

function formationListCardHTML(f,index,showSetPieces=true){
  const groups={POR:[],DIF:[],CEN:[],ATT:[]};
  (f.lines||[]).flat().forEach(p=>{const g=formationBroadGroup(p.role);groups[g].push(p)});
  const labels={POR:"POR",DIF:"DIF",CEN:"CEN",ATT:"ATT"};
  const bench=(f.bench||[]).filter(x=>Number(x.probability)>=30).sort((a,b)=>Number(b.probability)-Number(a.probability)).slice(0,7);
  return `<article class="formation-list-card ${f.liveSource?"formation-live-card":""}"
      role="button" tabindex="0" onclick="openFormation(${index})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFormation(${index})}"
      aria-label="${f.team}, ${f.module}">
    <div class="formation-list-head"><div><b>${f.team}</b><span>${f.club}${f.liveSource?' · LIVE':''}</span></div><strong>${f.module}</strong></div>
    ${showSetPieces?setPieceHTML(f.club):""}
    <div class="formation-role-list">
      ${["POR","DIF","CEN","ATT"].map(group=>`<div class="formation-role-row formation-role-${group.toLowerCase()}">
        <div class="formation-role-label">${labels[group]}</div><div class="formation-role-players">
          ${groups[group].map(p=>{const pr=Number(p.probability||starterProbability(formationPlayerCandidate(p.name,f.club)).prob);const st=starterStatus(pr);return `<span class="formation-name-chip"><span class="formation-chip-text"><b>${esc(p.name)}</b><em>${esc(mantraRoleDisplay(p.role))}</em></span><small class="starter-prob ${st.cls}">${Math.round(pr)}%</small></span>`}).join("")||`<span class="formation-empty">—</span>`}
        </div></div>`).join("")}
    </div>
    ${bench.length?`<div class="formation-ballottaggi"><b>Alternative / ballottaggi</b><div>${bench.map(x=>`<span>${esc(x.name)} <strong>${Math.round(Number(x.probability||0))}%</strong></span>`).join("")}</div></div>`:""}
    <div class="formation-list-foot"><span>Agg. ${f.updated}</span><span>${f.liveSource?'dati live · ':''}tocca per dettaglio ›</span></div>
  </article>`;
}

function formationCompactCardHTML(f,index){
  const starters=(f.lines||[]).flat();
  const probabilities=starters.map(p=>Number(p.probability||starterProbability(formationPlayerCandidate(p.name,f.club)).prob)).filter(Number.isFinite);
  const average=probabilities.length?Math.round(probabilities.reduce((sum,value)=>sum+value,0)/probabilities.length):0;
  const doubts=probabilities.filter(value=>value<70).length;
  return `<button type="button" class="formation-compact-card ${f.liveSource?"formation-live-card":""}" onclick="openFormation(${index})" aria-label="Apri formazione ${escAttr(f.team)}, modulo ${escAttr(f.module)}">
    <span class="formation-compact-team">${kitHTML(f.club,"sm",f.team)}<span><b>${esc(f.team)}</b><small>${esc(f.club)}${f.liveSource?' · LIVE':''} · agg. ${esc(f.updated)}</small></span></span>
    <span class="formation-compact-status"><strong>${esc(f.module)}</strong><small>XI ${average}% · ${doubts?`${doubts} da verificare`:"XI definito"}</small><em>${esc(formationAvailabilitySummary(f.club))}</em></span>
    <i aria-hidden="true">›</i>
  </button>`;
}

function formationCarouselHTML(){
  if(!formations.length){
    return `<div class="formation-box">
      <div class="formation-box-head">
        <div><b>Probabili Formazioni</b><span>Nessun dato preinstallato</span></div>
      </div>
      <div class="card muted">Formazioni non disponibili.</div>
    </div>`;
  }

  const ordered=sortedFormations();
  const pages=[];
  for(let i=0;i<ordered.length;i+=2){
    pages.push(ordered.slice(i,i+2));
  }

  return `<section class="formation-box formation-list-box" aria-label="Probabili Formazioni">
    <div class="formation-box-head">
      <div>
        <b>Probabili Formazioni</b>
        <span>Dati locali dell’utente</span>
      </div>
      <small>2 squadre · scorri ↑</small>
    </div>

    <div class="formation-list-carousel formation-list-carousel-2col">
      ${pages.map((page,pageIndex)=>`
        <div class="formation-list-page formation-list-page-2col" data-page="${pageIndex+1}">
          ${page.map(f=>{
            const index=formations.indexOf(f);
            return formationListCardHTML(f,index,false);
          }).join("")}
        </div>
      `).join("")}
    </div>

    <div class="formation-page-hint formation-list-hint">
      <span>1</span><i></i><span>10</span>
      <small>2 squadre per pagina</small>
    </div>
  </section>`;
}


function formationUpdateTimestamp(value){
  const m=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if(!m)return 0;
  return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5])).getTime();
}
function latestFormationUpdate(){
  return formations.slice().sort((a,b)=>formationUpdateTimestamp(b.updated)-formationUpdateTimestamp(a.updated))[0]?.updated||"—";
}

function renderFormationsView(){
  const live=formationFeedValid(formationsLiveFeed),age=formationFeedAgeMinutes();
  const availabilityLive=availabilityFeedValid(),availabilityAge=availabilityFeedAgeMinutes();
  const updating=formationsLiveLoading||availabilityLiveLoading;
  const syncText=formationsLiveLoading?"Aggiornamento…":live?(age<=20?"LIVE":"CACHE"):"BASE LOCALE";
  $("#formationsView").innerHTML=`
    <div class="section-title formations-page-title">
      <div><div class="eyebrow">Serie A 26/27</div><h2>Probabili Formazioni</h2></div>
      <span class="muted">${formations.length} squadre</span>
    </div>
    <div class="formations-update-card ${live?"live":"base"}">
      <div><span>FORMAZIONI + DISPONIBILITÀ</span><b>${latestFormationUpdate()}</b><small>${live?`Formazioni ${Math.round(age)} min fa`:"Formazioni locali"} · ${availabilityLive?`infortuni e disciplina ${Math.round(availabilityAge)} min fa`:"disponibilità da sincronizzare"} · ${esc(syncText)}${formationsLiveError?` · ${esc(formationsLiveError)}`:""}${availabilityLiveError?` · ${esc(availabilityLiveError)}`:""}</small></div>
      <button type="button" class="formation-refresh-btn" aria-label="Importa formazioni, infortuni e disciplina da file locale" onclick="openLocalDataCenter()">Importa dati</button>
    </div>
    <div class="formation-algo-note"><b>Titolarità collegata all'algoritmo</b><span>Le percentuali influenzano Strategia A/B, TARGET dinamici, ALT 1-3 e ranking Asta Live.</span></div>
    ${formations.length?`<div class="formations-compact-list">${sortedFormations().map(f=>formationCompactCardHTML(f,formations.indexOf(f))).join("")}</div>`:`<div class="card muted">Formazioni non disponibili.</div>`}`;
}

window.openFormation=index=>{
  const f=formations[index]; if(!f)return;
  const groups={POR:[],DIF:[],CEN:[],ATT:[]};
  (f.lines||[]).flat().forEach(p=>groups[formationBroadGroup(p.role)].push(p));
  const groupLabels={POR:"Portiere",DIF:"Difensori",CEN:"Centrocampisti",ATT:"Attaccanti"};
  const lineupList=`<div class="formation-detail-list" aria-label="Formazione titolare di ${escAttr(f.team)}">
    ${["POR","DIF","CEN","ATT"].map(group=>`<section class="formation-detail-section formation-detail-${group.toLowerCase()}">
      <div class="formation-detail-section-head"><span>${groupLabels[group]}</span><strong>${groups[group].length}</strong></div>
      <div class="formation-detail-players">
        ${groups[group].map(p=>{const pr=Number(p.probability||starterProbability(formationPlayerCandidate(p.name,f.club)).prob);const st=starterStatus(pr);return `<div class="formation-detail-player">${mantraRoleChipHTML(p.role,"formation-detail-role mantra-role-chip")}<span class="formation-detail-copy"><b>${esc(p.name)}</b>${disciplineCountersHTML(p.name,f.club)}</span><small class="starter-prob ${st.cls}">${Math.round(pr)}%</small></div>`}).join("")||'<div class="formation-detail-empty">—</div>'}
      </div>
    </section>`).join("")}
  </div>`;
  const bench=(f.bench||[]).filter(x=>Number(x.probability)>=20).sort((a,b)=>Number(b.probability)-Number(a.probability)).slice(0,12);
  $("#formationDialogContent").innerHTML=`<div class="dialog-body formation-dialog-body">
    <div class="formation-modal-head"><div><div class="eyebrow">Probabile formazione ${f.liveSource?'· LIVE':''}</div><h2>${f.team} · ${f.module}</h2><p>Ruoli Mantra · aggiornamento ${f.updated}</p></div><button class="ghost" type="button" aria-label="Chiudi formazione ${escAttr(f.team)}" onclick="formationDialog.close()">✕</button></div>
    ${formationAvailabilityPanelHTML(f)}
    ${lineupList}
    ${bench.length?`<div class="formation-dialog-bench"><b>Possibili titolari / ballottaggi</b><div>${bench.map(x=>`<span><span class="formation-bench-copy"><b>${esc(x.name)}</b><small>${esc(x.role||formationRoleFor(x.name,f.club))}</small>${disciplineCountersHTML(x.name,f.club)}</span><strong>${Math.round(Number(x.probability||0))}%</strong></span>`).join("")}</div></div>`:""}
    ${setPieceHTML(f.club)}
    <p class="formation-source">Dati locali importati dall’utente. Le percentuali disponibili entrano nel motore strategico.</p>
  </div>`;
  $("#formationDialog").showModal();
};


let actionReturnContext=null;

function captureActionReturnContext(playerId){
  if($("#liveDialog")?.open){
    return {
      type:"live",
      playerId,
      query:$("#liveSearchInput")?.value||""
    };
  }
  if($("#playerDialog")?.open){
    return {type:"player",playerId};
  }
  return null;
}

function restoreActionReturnContext(){
  const ctx=actionReturnContext;
  actionReturnContext=null;
  if(!ctx)return;

  if(ctx.type==="player"){
    openPlayer(ctx.playerId);
    return;
  }

  if(ctx.type==="live"){
    liveSelectedId=null;
    renderAuctionLive();
    $("#liveDialog").showModal();
    const input=$("#liveSearchInput");
    if(input){
      input.value=ctx.query||"";
      updateLiveResults(input.value);
    }
    if(ctx.playerId)selectLivePlayer(ctx.playerId);
    setTimeout(()=>$("#liveSearchInput")?.focus(),30);
  }
}

function finishAuctionActionNavigation(){
  const ctx=actionReturnContext;
  actionReturnContext=null;
  refresh();
  if(ctx?.type!=="live")return;

  if(state.view!=="dashboardView")switchView("dashboardView");
  requestAnimationFrame(()=>{
    const panel=document.getElementById("auctionLivePanel");
    if(panel)panel.scrollIntoView({behavior:"auto",block:"start"});
    openAuctionLive();
  });
}

let liveSelectedId=null;
/* Alpha 5.6.3 — Strategia e Asta Live leggono la stessa state machine.
   Ogni slot ha un unico TARGET operativo e nessun motore legacy può
   assegnare TARGET o alternative in parallelo. */
function fa2LivePlanEntries(){
  const map=new Map();
  if(typeof fa2PlanRuntimeSlots!=="function")return map;
  for(const runtime of fa2PlanRuntimeSlots()){
    if(runtime.covered||!runtime.current||Number(runtime.budgetRuntime?.missing)<=0)continue;
    const target=runtime.current,tid=String(target.id);
    map.set(tid,{kind:"target",rank:0,runtime,candidate:target,promoted:runtime.promoted,maxRecommended:runtime.currentCap});
    runtime.alternatives.slice(0,3).forEach((x,i)=>{
      const id=String(x.id),entry={kind:"alt",rank:i+1,runtime,candidate:x,promoted:false,maxRecommended:fa2DynamicStrategicCap(runtime.slot,x,runtime)};
      const prev=map.get(id);if(!prev||prev.kind!=="target"&&entry.rank<prev.rank)map.set(id,entry);
    });
  }
  return map;
}
function fa2LivePlanEntry(p,map=null){return (map||fa2LivePlanEntries()).get(String(p?.id??""))||null}
/* Alpha 5.6.3 — Priorità strategica dell'elenco Asta Live.
   TARGET piano → ALT piano → migliori profili disponibili. */
function liveGeneralOpportunityScore(p,intel=getAuctionIntel(),ctx=null){
  if(!p)return -Infinity;
  const mine=ctx?.mine||teamEconomy(mineTeam());
  const missing=ctx?.missing||currentMissingStrategySlots();
  let score=0;
  if(p.strategic)score+=24;
  const fits=strategyPlayerFit(p);
  score+=Math.min(20,fits.length*10);
  const missingFits=missing.filter(x=>slotCompatible(p,x.slot));
  score+=Math.min(24,missingFits.length*6);
  if(missingFits.some(x=>activeStrategy().keySlots.some(k=>k.label===x.slot.label)))score+=8;
  const quality=playerQuality(p);
  score+=Math.min(20,Math.round(Math.sqrt(Math.max(0,quality))*1.05));
  score+=starterPriorityBonus(p);
  const risk=familyRiskForPlayer(p,intel).risk;
  score+=Math.min(10,Math.round(risk*.10));
  if(quality<=mine.maxNext)score+=6;
  else score-=12;
  const owned=purchasedPlayers();
  const u23Rule=configuredUnderRule("u23"),u21Rule=configuredUnderRule("u21"),u23Min=u23Rule?.enabled?Number(u23Rule.min)||0:0,u21Min=u21Rule?.enabled?Number(u21Rule.min)||0:0;
  if(owned.filter(isU23Player).length<u23Min&&isU23Player(p))score+=5;
  if(owned.filter(isU21Player).length<u21Min&&isU21Player(p))score+=6;
  const clubLimit=configuredClubLimit();if(clubLimit&&countClub(p.club)>=Math.max(1,clubLimit-1))score-=6;
  return score;
}
function livePriorityRows(list,intel=getAuctionIntel(),recommendations=null){
  void recommendations;
  const planMap=fa2LivePlanEntries();
  const managedPlanPlayers=fa2ManagedPlanPlayerIds();
  const phaseCtx=new Map();
  const ctxFor=phase=>{
    if(!phaseCtx.has(phase)){
      const owned=purchasedPlayers();
      phaseCtx.set(phase,{
        missing:currentMissingStrategySlots(),
        mine:teamEconomy(mineTeam()),
        guide:phaseBudgetRemaining(phase),
        u23Owned:owned.filter(isU23Player).length,
        u21Owned:owned.filter(isU21Player).length,
        managedPlanPlayers
      });
    }
    return phaseCtx.get(phase);
  };
  const rows=list.map(p=>{
    const phase=playerAuctionPhase(p),managedPlanPlayer=managedPlanPlayers.has(String(p.id));
    const plan=fa2LivePlanEntry(p,planMap);
    const ctx=ctxFor(phase);
    const general=liveGeneralOpportunityScore(p,intel,ctx);
    let tier=5,score=general;
    if(plan?.kind==="target"){tier=0;score=6000+(plan.promoted?250:500)+Number(plan.candidate?.score||0)}
    else if(plan?.kind==="alt"){tier=1;score=5200-plan.rank*100+Number(plan.candidate?.score||0)}
    return {p,meta:{tier,score,general,dynamic:null,plan,managedPlanPlayer,legacyStaticTarget:false,altRank:null}};
  });
  rows.sort((a,b)=>{
    const phaseA=playerAuctionPhase(a.p)===state.auctionPhase?0:1;
    const phaseB=playerAuctionPhase(b.p)===state.auctionPhase?0:1;
    return phaseA-phaseB||a.meta.tier-b.meta.tier||b.meta.score-a.meta.score||b.meta.general-a.meta.general||playerQuality(b.p)-playerQuality(a.p)||String(a.p.name).localeCompare(String(b.p.name),'it');
  });
  return rows;
}
function liveCandidateList(query="",intel=getAuctionIntel(),recommendations=null){
  const q=String(query||"").trim().toLowerCase();
  let list=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&!state.purchases[p.id]&&!state.sold[p.id]);
  if(q){
    list=list.filter(p=>(p.name+" "+p.club+" "+p.role).toLowerCase().includes(q));
  }else{
    list=list.filter(p=>playerAuctionPhase(p)===state.auctionPhase);
  }
  return livePriorityRows(list,intel,recommendations).slice(0,18);
}
function fa2LiveContext(query=""){
  const intel=getAuctionIntel(),recommendations=dynamicTargetRecommendations(intel);
  return {intel,recommendations,rows:liveCandidateList(query,intel,recommendations)};
}
function liveResultHTML(p,intel=getAuctionIntel(),recommendations=null,meta=null){
  const live=liveMaxForPlayer(p,intel),plan=meta?.plan||fa2LivePlanEntry(p);
  void recommendations;
  const planBadge=plan?.kind==="target"
    ? `<em class="live-result-badge plan-target">${plan.promoted?"TARGET ↑":"TARGET"}</em>`
    : plan?.kind==="alt"?`<em class="live-result-badge alternative">ALT ${plan.rank}</em>`:"";
  const listoneBadge=`<em class="live-result-badge starter">FVM ${fmt(p.fvm||0)}</em>`;
  const badges=[planBadge,listoneBadge].join("");
  const rankedClass=plan?.kind==="target"?"plan-target":plan?.kind==="alt"?"ranked-alternative":"";
  const strat=plan?.maxRecommended?`<small>STRAT ${fmt(plan.maxRecommended)}</small>`:'<small>MAX live</small>';
  return `<button type="button" role="listitem" class="live-result ${rankedClass}" data-id="${p.id}" aria-label="Apri ${escAttr(p.name)}, ${p.club}, ruolo ${escAttr(p.role)}, MAX live ${fmt(live.live)}${plan?.maxRecommended?`, MAX strategico ${fmt(plan.maxRecommended)}`:""}"><span class="live-result-main">${kitHTML(p.club,'sm',p.club)}<span><b>${esc(p.name)} ${badges}</b><small>${p.club} · ${p.role} · FVM ${p.fvm||0}</small></span></span><strong>${riskIcon(live.risk)} ${fmt(live.live)}${strat}</strong></button>`;
}
function updateLiveResults(query="",preparedContext=null){
  const context=preparedContext&&String(query||"")===""?preparedContext:fa2LiveContext(query);
  const {intel,recommendations,rows}=context;
  const target=$("#liveResults");if(!target)return;
  target.innerHTML=rows.length?rows.map(({p,meta})=>liveResultHTML(p,intel,recommendations,meta)).join(""):'<div class="live-empty">Nessun giocatore trovato.</div>';
  $$("#liveResults .live-result").forEach(btn=>btn.onclick=()=>selectLivePlayer(btn.dataset.id));
}
function selectLivePlayer(id){
  const p=getPlayer(id);if(!p)return;
  liveSelectedId=p.id;
  const intel=getAuctionIntel(),live=liveMaxForPlayer(p,intel),mine=teamEconomyForPurchase();
  const opponent=live.opponent,comp=live.competition.slice(0,5);
  const plan=fa2LivePlanEntry(p),guidance=fa2StrategyGuidanceForPlayer(p);
  let targetSignal="";
  if(plan?.kind==="target"){
    const lost=plan.runtime?.originalTarget,slotLabel=fa2PlanSlotLabel(plan.runtime?.slot,plan.runtime?.key||"");
    targetSignal=plan.promoted
      ? `<div class="live-strategy-signal plan"><span class="live-target-symbol">TARGET ↑</span><div><b>TARGET PROMOSSO</b><small>${lost?`${esc(lost.name)} non è più disponibile · `:""}${esc(slotLabel)} · MAX strategico ${fmt(plan.maxRecommended||0)}.</small></div></div>`
      : `<div class="live-strategy-signal plan"><span class="live-target-symbol">TARGET</span><div><b>PIANO STRATEGIA ATTIVO</b><small>Priorità per slot ${esc(slotLabel)} · MAX strategico ${fmt(plan.maxRecommended||0)}.</small></div></div>`;
  }else if(plan?.kind==="alt"){
    const slotLabel=fa2PlanSlotLabel(plan.runtime?.slot,plan.runtime?.key||"");
    targetSignal=`<div class="live-strategy-signal plan-alt"><span class="live-target-symbol">ALT ${plan.rank}</span><div><b>ALTERNATIVA PIANIFICATA</b><small>Sale automaticamente se il TARGET dello slot ${esc(slotLabel)} viene perso.</small></div></div>`;
  }
  const planCap=Number(plan?.maxRecommended)||Number(guidance?.maxRecommended)||0;
  const dynamicBudget=Number(plan?.runtime?.dynamicBudget)||Number(guidance?.dynamicBudget)||0;
  const budgetRuntime=plan?.runtime?.budgetRuntime||fa2LastBudgetRuntime;
  const target=$("#liveSelected");if(!target)return;
  target.innerHTML=`<div class="live-player-card ${plan?.kind==="target"?"plan-recommended":""}">
    ${targetSignal}
    <div class="live-player-head"><div class="live-player-identity">${kitHTML(p.club,'live',p.club)}<div><span>${p.club} · ${p.role} · FVM ${fmt(p.fvm||0)}</span><b>${esc(p.name)}${plan?.kind==="target"?' <em class="live-inline-plan">TARGET</em>':plan?.kind==="alt"?` <em class="live-inline-alt">ALT ${plan.rank}</em>`:""}</b><button type="button" class="live-watch ${isWatchlisted(p.id)?"active":""}" aria-pressed="${isWatchlisted(p.id)?"true":"false"}" aria-label="${isWatchlisted(p.id)?"Rimuovi":"Aggiungi"} ${escAttr(p.name)} ${isWatchlisted(p.id)?"dalla":"alla"} watchlist" onclick='toggleWatchlist(${idArg(p.id)})'>${isWatchlisted(p.id)?"SEGUITO":"SEGUI"}</button></div></div><strong>${riskIcon(live.risk)} ${live.risk}</strong></div>
    <div class="live-price-grid ${planCap?"with-strategy":""}">
      <div><span>FVM</span><b>${p.fvm||0}</b></div>
      <div><span>MAX iniziale</span><b>${fmt(live.base)}</b></div>
      <div class="live-max"><span>MAX LIVE</span><b>${fmt(live.live)}</b></div>
      ${planCap?`<div class="live-strategy-max"><span>MAX STRATEGICO</span><b>${fmt(planCap)}</b></div>`:`<div><span>Inflazione</span><b>${pctLabel(live.inflation,1)}</b></div>`}
      ${planCap?`<div><span>Inflazione</span><b>${pctLabel(live.inflation,1)}</b></div>`:""}
      ${planCap&&dynamicBudget?`<div><span>BUDGET SLOT</span><b>${fmt(dynamicBudget)}</b></div>`:""}
    </div>
    <div class="live-own-money"><span>${mine.promisedRelease?`Dopo promessa ${esc(mine.promisedRelease.name)}: ${fmt(mine.remaining)} cr · ${mine.missing} posto libero`:`Noi: ${fmt(mine.remaining)} cr · ${mine.missing} posti${budgetRuntime?` · riserva ${fmt(budgetRuntime.reserve)}`:""}`}</span><b>MAX possibile ${fmt(mine.maxNext)}</b></div>
    <div class="live-competition-title"><span>OPPONENT INTELLIGENCE · A4.2</span>${state.league?`<small>stima al prezzo guida ${fmt(opponent.anchorPrice)} cr</small>`:""}</div>
    ${state.league?`<div class="live-opponent-summary pressure-${String(opponent.pressureLabel||"bassa").toLowerCase()}">
      <div><span>PRESSIONE SUL PREZZO</span><b>${esc(opponent.pressureLabel)} · +${opponent.pricePressurePct}%</b></div>
      <div><span>ALMENO UN RILANCIO</span><b>${Math.round(opponent.atLeastOneBid*100)}%</b></div>
      <small>${opponent.likelyRivals} ${opponent.likelyRivals===1?"rivale probabile":"rivali probabili"} · affidabilità dati ${Math.round(opponent.confidence*100)}%</small>
    </div><div class="live-competition">${comp.map(x=>{
      const blocked=!x.clubEligible?"limite club raggiunto":!x.eligible?"rosa completa o budget esaurito":"";
      const need=blocked||x.needLabel?blocked||`manca ${x.needLabel}`:"bisogno non forte";
      return `<div class="${x.probability>=.62?"hot":x.probability>=.38?"warm":"cool"}"><span><b>${esc(x.team?.name||x.name)}</b><small>${esc(need)} · ${esc(x.module)}</small><small>Residuo ${fmt(x.remaining)} · MAX possibile ${fmt(x.maxNext)}</small></span><strong>${Math.round(x.probability*100)}%<small>rilancio · tetto stim. ${fmt(x.estimatedCap)}</small></strong></div>`;
    }).join("")}</div><p class="live-opponent-note">Stima basata soltanto su rose, prezzi e assegnazioni salvati. Il tetto rivale stimato non sostituisce il tuo MAX strategico.</p>`:'<div class="live-empty">Crea una lega e assegna i giocatori venduti per attivare budget rivali, ruoli mancanti e probabilità di rilancio.</div>'}
    <div class="live-actions"><button class="primary" onclick='liveBuy(${idArg(p.id)})'>ACQUISTA</button><button class="soldbtn" onclick='liveSell(${idArg(p.id)})'>VENDUTO</button></div>
  </div>`;
}
function fa2LiveBudgetStripHTML(){
  const runtimes=fa2PlanRuntimeSlots(),budget=runtimes[0]?.budgetRuntime||fa2LastBudgetRuntime;
  if(!runtimes.length||!budget)return "";
  return `<div class="live-own-money"><span>BUDGET RUNTIME · ${fmt(budget.remaining)} cr · ${budget.missing} posti · riserva ${fmt(budget.reserve)}</span><b>Piano slot ${fmt(budget.allocated)} · ${pctLabel(budget.overallInflation,1)}</b></div>`;
}

/* Alpha 5 — Auction Copilot Core.
   Il Copilot non assegna nuove priorità: riassume esclusivamente le decisioni
   già prodotte da Piano Strategia, lista Asta Live, Budget Runtime, MAX Live,
   Opponent Intelligence e Module Switch Advisor. */
function fa2CopilotRuntimePhase(runtime){
  const reference=runtime?.current||runtime?.coveredBy||runtime?.originalTarget||runtime?.slot?.target||null;
  const p=getPlayer(reference?.id)||reference;
  if(p?.role)return playerAuctionPhase(p);
  const roles=runtime?.slot?.roles||[];
  return roles.length?playerAuctionPhase({role:roles.join("/")}):"";
}
function fa2CopilotModule(advisor){
  if(!advisor?.current)return {label:"MODULO",value:"Non disponibile",detail:"",switch:false};
  if(advisor.status==="SWITCH"){
    const next=advisor.recommendedPrimary?.module?.name||"—",current=advisor.current?.module?.name||"—";
    return {label:"CAMBIO MODULO",value:`${next} · +${Number(advisor.delta)||0}`,detail:`da ${current} · decisione assistita`,switch:true};
  }
  return {label:"MODULO CONFERMATO",value:advisor.current?.module?.name||"—",detail:`indice ${advisor.current?.score||0}/100`,switch:false};
}
function fa2CopilotBudget(runtime=null,runtimes=[]){
  const mine=teamEconomyForPurchase();
  return runtime?.budgetRuntime||runtimes[0]?.budgetRuntime||fa2LastBudgetRuntime||{
    remaining:mine.remaining,missing:mine.missing,reserve:mine.minimumToFinish,
    free:mine.free,maxNext:mine.maxNext,allocated:0,status:"OK"
  };
}
function fa2AuctionCopilotSnapshot(context=fa2LiveContext("")){
  const slotStates=window.FA2Strategy?.SLOT_STATES||{},runtimes=fa2PlanRuntimeSlots();
  const phaseRuntimes=runtimes.filter(runtime=>fa2CopilotRuntimePhase(runtime)===state.auctionPhase);
  const planRow=context.rows.find(row=>row.meta?.plan?.kind==="target")||null;
  const covered=phaseRuntimes.find(runtime=>runtime.state===slotStates.COVERED&&runtime.coveredBy)||null;
  const exhausted=phaseRuntimes.find(runtime=>runtime.state===slotStates.LOST_EXHAUSTED)||null;
  const advisor=fa2GetModuleAdvisor(),module=fa2CopilotModule(advisor);
  const capacity=fa2CopilotBudget(null,runtimes);

  if(Number(capacity.missing)<=0){
    return {mode:"complete",status:"ROSA COMPLETA",badge:"25/25",player:null,budget:capacity,module,slotLabel:"Nessun posto libero",why:"La rosa ha raggiunto il numero massimo previsto dal Regolamento Lega. Il Piano Strategia resta consultabile, ma non produce nuovi obiettivi finché uno svincolo o una promessa di svincolo non riapre un posto."};
  }

  if(planRow){
    const p=planRow.p,plan=planRow.meta.plan,runtime=plan.runtime;
    const live=liveMaxForPlayer(p,context.intel),slotLabel=fa2PlanSlotLabel(runtime.slot,runtime.key);
    const fallbackCandidate=runtime.alternatives?.[0]||null,fallback=fallbackCandidate?(getPlayer(fallbackCandidate.id)||fallbackCandidate):null;
    const fallbackCap=fallbackCandidate?fa2DynamicStrategicCap(runtime.slot,fallbackCandidate,runtime):0;
    const budget=fa2CopilotBudget(runtime,runtimes),priority=runtime.slot?.priority?.label||"NORMALE";
    const promotedFrom=plan.promoted?runtime.originalTarget?.name||"il TARGET iniziale":"";
    const why=plan.promoted
      ? `${promotedFrom} non è più disponibile: ${p.name} è il primo candidato ancora attivo per lo slot ${slotLabel}. Tetto e budget sono già stati ricalcolati.`
      : `${p.name} è il TARGET attivo dello slot ${slotLabel}. Il tetto combina il Piano Strategia con budget runtime e mercato corrente.`;
    return {
      mode:plan.promoted?"promoted":"target",status:plan.promoted?"TARGET PROMOSSO":"PROSSIMO OBIETTIVO",badge:plan.promoted?"TARGET ↑":"TARGET",
      player:p,slotLabel,strategicMax:Number(plan.maxRecommended)||Number(runtime.currentCap)||0,liveMax:live.live,
      fallback,fallbackCap,slotBudget:Number(runtime.dynamicBudget)||0,budget,module,why,
      detail:`${p.club} · ${p.role} · priorità ${priority} · concorrenza ${String(live.opponent?.pressureLabel||"bassa").toLowerCase()}`,
      coveredNote:covered?`Slot ${fa2PlanSlotLabel(covered.slot,covered.key)} già coperto da ${covered.coveredBy.name}.`:""
    };
  }

  if(covered){
    const p=getPlayer(covered.coveredBy.id)||covered.coveredBy,paid=Number(state.purchases?.[p.id]?.price||0),budget=fa2CopilotBudget(covered,runtimes);
    const slotLabel=fa2PlanSlotLabel(covered.slot,covered.key),original=covered.originalTarget?.name||slotLabel;
    return {
      mode:"covered",status:"SLOT COPERTO",badge:"COPERTO",player:p,slotLabel,paid,budget,module,
      why:`${p.name} copre lo slot ${slotLabel}${paid?` a ${fmt(paid)} crediti`:""}. Le alternative di ${original} sono ferme e non vengono più inseguite.`
    };
  }

  if(exhausted){
    const slotLabel=fa2PlanSlotLabel(exhausted.slot,exhausted.key),budget=fa2CopilotBudget(exhausted,runtimes);
    return {
      mode:"exhausted",status:"SLOT DA RIANALIZZARE",badge:"ESAURITO",player:getPlayer(exhausted.originalTarget?.id)||exhausted.originalTarget||null,
      slotLabel,budget,module,why:`Nessun candidato salvato per lo slot ${slotLabel} è ancora disponibile. Il Copilot non sceglie un sostituto fuori piano: rianalizza lo slot in Strategia.`
    };
  }

  const top=context.rows[0]||null;
  if(!top){
    const budget=fa2CopilotBudget(null,runtimes);
    return {mode:"empty",status:"FASE COMPLETATA",badge:"OK",player:null,budget,module,why:"Non risultano giocatori disponibili nella fase corrente."};
  }
  const p=top.p,live=liveMaxForPlayer(p,context.intel),fallback=context.rows[1]?.p||null;
  const fallbackLive=fallback?liveMaxForPlayer(fallback,context.intel):null,budget=fa2CopilotBudget(null,runtimes);
  const status="MIGLIOR PROFILO DISPONIBILE";
  const why=`${p.name} è il primo profilo dell'ordinamento Asta Live per la fase corrente; non viene presentato come TARGET o alternativa del Piano Strategia.`;
  return {
    mode:"market",status,badge:"PROFILO",player:p,slotLabel:"Fuori piano",
    strategicMax:0,liveMax:live.live,fallback,fallbackCap:fallbackLive?.live||0,slotBudget:0,budget,module,why,
    detail:`${p.club} · ${p.role} · concorrenza ${String(live.opponent?.pressureLabel||"bassa").toLowerCase()}`
  };
}
function fa2CopilotMetricHTML(label,value,detail="",className=""){
  return `<div class="fa2-copilot-metric ${escAttr(className)}"><span>${esc(label)}</span><b>${esc(value)}</b>${detail?`<small>${esc(detail)}</small>`:""}</div>`;
}
/* Alpha 5.1 — Next Call Reminder.
   È un riepilogo volatile dell'ultimo acquisto: non crea chiavi persistenti,
   non decide nuovi TARGET e legge il nuovo stato già prodotto dal Copilot. */
let fa2LastPurchaseReminder=null;
function fa2RememberPurchaseForNextCall(p,price,guide,live,event){
  if(!p)return;
  const strategicMax=Math.max(0,Number(guide?.maxRecommended)||0),liveMax=Math.max(0,Number(live?.live)||0),cap=strategicMax||liveMax;
  if(!cap||Number(price)<=cap){fa2LastPurchaseReminder=null;return}
  fa2LastPurchaseReminder={
    playerId:String(p.id),name:p.name||"Giocatore",club:p.club||"",role:p.role||"",price:Number(price)||0,
    strategicMax,liveMax,
    slot:guide?.slot||"",planLabel:guide?.label||"",budget:event?.budget||{},at:Date.now()
  };
}
function fa2DismissNextCallReminder(){
  fa2LastPurchaseReminder=null;
  $(".fa2-next-call-reminder")?.remove();
}
function fa2NextCallSummary(snapshot){
  if(!snapshot)return {label:"PROSSIMA INDICAZIONE",value:"Riapri Asta Live",detail:"Il mercato verrà ricalcolato."};
  if(snapshot.mode==="target"||snapshot.mode==="promoted")return {
    label:snapshot.status,value:snapshot.player?.name||"—",
    detail:`Slot ${snapshot.slotLabel||"—"} · MAX strategico ${fmt(snapshot.strategicMax||0)} · MAX live ${fmt(snapshot.liveMax||0)}`
  };
  if(snapshot.mode==="market")return {
    label:"PROFILO DI MERCATO",value:snapshot.player?.name||"—",
    detail:`Fuori Piano Strategia · MAX live ${fmt(snapshot.liveMax||0)}`
  };
  if(snapshot.mode==="covered")return {
    label:"SLOT COPERTO",value:`Nessun sostituto per ${snapshot.slotLabel||"lo slot"}`,
    detail:`${snapshot.player?.name||"Il giocatore acquistato"} resta la copertura · alternative ferme`
  };
  if(snapshot.mode==="exhausted")return {
    label:"SLOT DA RIANALIZZARE",value:snapshot.slotLabel||"Strategia",
    detail:"Nessun candidato salvato disponibile: il Copilot non promuove profili esterni."
  };
  return {label:"FASE COMPLETATA",value:`Nessuna priorità in ${state.auctionPhase}`,detail:"Passa alla fase successiva quando previsto dall'asta."};
}
function fa2NextCallReminderHTML(snapshot){
  const reminder=fa2LastPurchaseReminder;if(!reminder)return "";
  const cap=reminder.strategicMax||reminder.liveMax,difference=cap?reminder.price-cap:0,over=difference>0;
  const reference=reminder.strategicMax?"MAX strategico":reminder.liveMax?"MAX live":"prezzo guida";
  const status=reminder.strategicMax?`EXTRA BUDGET · +${fmt(difference)} cr`:`OLTRE MAX LIVE · +${fmt(difference)} cr`;
  const comparison=cap?`${reference} ${fmt(cap)}${reminder.strategicMax&&reminder.liveMax?` · MAX live ${fmt(reminder.liveMax)}`:""}`:"Nessun tetto disponibile";
  const next=fa2NextCallSummary(snapshot),budget=snapshot?.budget||reminder.budget||{};
  return `<section class="fa2-next-call-reminder ${over?"over":"ok"}" aria-live="polite">
    <div class="fa2-next-call-head"><div><span>POST ACQUISTO · α5.6</span><b>${esc(status)}</b></div><button type="button" onclick="fa2DismissNextCallReminder()" aria-label="Chiudi promemoria">×</button></div>
    <div class="fa2-next-call-purchase"><div><span>${esc(reminder.name)} · ${fmt(reminder.price)} cr</span><small>${esc(comparison)}${reminder.slot?` · slot ${esc(reminder.slot)}`:""}</small></div></div>
    <div class="fa2-next-call-target"><span>${esc(next.label)}</span><b>${esc(next.value)}</b><small>${esc(next.detail)}</small></div>
    <div class="fa2-next-call-budget"><b>${fmt(budget.remaining||0)} cr residui</b><span>${budget.missing??0} posti · MAX prossimo ${fmt(budget.maxNext||0)}</span></div>
  </section>`;
}
window.fa2DismissNextCallReminder=fa2DismissNextCallReminder;
function fa2AuctionCopilotHTML(context,snapshot=null){
  const x=snapshot||fa2AuctionCopilotSnapshot(context),budget=x.budget||{},module=x.module||{};
  let metrics="",action="";
  if(x.mode==="target"||x.mode==="promoted"){
    metrics=[
      fa2CopilotMetricHTML("MAX STRATEGICO",fmt(x.strategicMax),"tetto operativo","strategic"),
      fa2CopilotMetricHTML("MAX LIVE",fmt(x.liveMax),"mercato corrente"),
      fa2CopilotMetricHTML("FALLBACK",x.fallback?.name||"Nessuno",x.fallback?`STRAT ${fmt(x.fallbackCap)}`:"slot da rianalizzare"),
      fa2CopilotMetricHTML("BUDGET SLOT",fmt(x.slotBudget),`libero totale ${fmt(budget.free||0)}`)
    ].join("");
    action=`<button type="button" class="fa2-copilot-open" onclick='fa2OpenCopilotPlayer(${idArg(x.player.id)})'>APRI OBIETTIVO</button>`;
  }else if(x.mode==="covered"){
    metrics=[
      fa2CopilotMetricHTML("PAGATO",x.paid?`${fmt(x.paid)} cr`:"—","acquisto registrato","strategic"),
      fa2CopilotMetricHTML("RESIDUO",`${fmt(budget.remaining||0)} cr`),
      fa2CopilotMetricHTML("POSTI",String(budget.missing??0),"ancora da coprire"),
      fa2CopilotMetricHTML("ALTERNATIVE","FERME","nessun sostituto cercato")
    ].join("");
  }else if(x.mode==="exhausted"){
    metrics=[
      fa2CopilotMetricHTML("STATO","ESAURITO","nessun candidato salvato"),
      fa2CopilotMetricHTML("RESIDUO",`${fmt(budget.remaining||0)} cr`),
      fa2CopilotMetricHTML("POSTI",String(budget.missing??0),"ancora da coprire"),
      fa2CopilotMetricHTML("AZIONE","STRATEGIA","rianalizza lo slot")
    ].join("");
  }else if(x.mode==="market"){
    metrics=[
      fa2CopilotMetricHTML("MAX LIVE",fmt(x.liveMax),"limite operativo","strategic"),
      fa2CopilotMetricHTML("MAX POSSIBILE",fmt(budget.maxNext||0),"vincolo rosa"),
      fa2CopilotMetricHTML("PROSSIMO PROFILO",x.fallback?.name||"Nessuno",x.fallback?`MAX live ${fmt(x.fallbackCap)}`:""),
      fa2CopilotMetricHTML("BUDGET LIBERO",`${fmt(budget.free||0)} cr`)
    ].join("");
    action=`<button type="button" class="fa2-copilot-open" onclick='fa2OpenCopilotPlayer(${idArg(x.player.id)})'>APRI PROFILO</button>`;
  }else if(x.mode==="complete"){
    metrics=[
      fa2CopilotMetricHTML("ROSA",`${Number(budget.missing)<=0?"COMPLETA":"APERTA"}`,"nessun acquisto ordinario","strategic"),
      fa2CopilotMetricHTML("RESIDUO",`${fmt(budget.remaining||0)} cr`),
      fa2CopilotMetricHTML("POSTI","0","da riaprire con svincolo"),
      fa2CopilotMetricHTML("PIANO","IN PAUSA","nessun TARGET operativo")
    ].join("");
  }else{
    metrics=[
      fa2CopilotMetricHTML("RESIDUO",`${fmt(budget.remaining||0)} cr`),
      fa2CopilotMetricHTML("POSTI",String(budget.missing??0)),
      fa2CopilotMetricHTML("RISERVA",`${fmt(budget.reserve||0)} cr`),
      fa2CopilotMetricHTML("STATO","NESSUN PROFILO")
    ].join("");
  }
  const identity=x.player?`${kitHTML(x.player.club,'sm',x.player.club)}<div><b>${esc(x.player.name)}</b><small>${esc(x.detail||`Slot ${x.slotLabel||"—"}`)}</small></div>`:`<div><b>${esc(x.slotLabel||x.status)}</b><small>Fase ${esc(state.auctionPhase)}</small></div>`;
  return `<section class="fa2-live-copilot ${escAttr(x.mode)}">
    <div class="fa2-copilot-head"><div><span>AUCTION COPILOT · α5.6</span><b>${esc(x.status)}</b></div><em>${esc(state.auctionPhase)}</em></div>
    <div class="fa2-copilot-decision"><div class="fa2-copilot-player"><strong>${esc(x.badge)}</strong>${identity}</div>${action}</div>
    <div class="fa2-copilot-metrics">${metrics}</div>
    ${x.coveredNote?`<div class="fa2-copilot-covered-note">✓ ${esc(x.coveredNote)}</div>`:""}
    <details class="fa2-copilot-more"><summary>Perché e contesto</summary><div>
      <div class="fa2-copilot-why"><span>PERCHÉ</span><p>${esc(x.why)}</p></div>
      <div class="fa2-copilot-runtime"><div class="${module.switch?"switch":""}"><span>${esc(module.label||"MODULO")}</span><b>${esc(module.value||"—")}</b><small>${esc(module.detail||"")}</small></div><div><span>BUDGET RUNTIME</span><b>${fmt(budget.remaining||0)} cr · ${budget.missing??0} posti</b><small>riserva ${fmt(budget.reserve||0)} · libero ${fmt(budget.free||0)}</small></div></div>
    </div></details>
  </section>`;
}
function fa2OpenCopilotPlayer(id){
  selectLivePlayer(id);
  requestAnimationFrame(()=>$("#liveSelected")?.scrollIntoView({behavior:"smooth",block:"start"}));
}
window.fa2OpenCopilotPlayer=fa2OpenCopilotPlayer;
function renderAuctionLive(){
  const phase=AUCTION_PHASES[phaseIndex()],liveContext=fa2LiveContext(""),copilotSnapshot=fa2AuctionCopilotSnapshot(liveContext);
  $("#liveDialogContent").innerHTML=`<div class="dialog-body live-dialog-body">
    <div class="live-dialog-head"><div><span class="eyebrow">${phase.icon} Fase ${phase.id}</span><h2>Asta Live</h2></div><button id="closeLiveBtn" class="ghost" type="button" aria-label="Chiudi Asta Live">✕</button></div>
    ${fa2NextCallReminderHTML(copilotSnapshot)}
    ${fa2AuctionCopilotHTML(liveContext,copilotSnapshot)}
    <input id="liveSearchInput" class="search live-search" aria-label="Cerca giocatore in Asta Live" placeholder="Cerca giocatore…" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div id="liveSelected"></div>
    <div class="live-results-label"><span>${phase.label}</span><small>TARGET → alternative → migliori profili</small></div>
    <div id="liveResults" role="list" aria-label="Giocatori disponibili"></div>
  </div>`;
  $("#closeLiveBtn").onclick=()=>$("#liveDialog").close();
  $("#liveSearchInput").addEventListener("input",e=>updateLiveResults(e.target.value));
  updateLiveResults("",liveContext);
}
function openAuctionLive(){
  liveSelectedId=null;renderAuctionLive();$("#liveDialog").showModal();
  if(!fa2LastPurchaseReminder)setTimeout(()=>$("#liveSearchInput")?.focus(),30);
}
window.openAuctionLive=openAuctionLive;
window.liveBuy=id=>{
  const ctx=captureActionReturnContext(id);
  if($("#liveDialog").open)$("#liveDialog").close();
  startPurchase(id,ctx);
};
window.liveSell=id=>{
  const ctx=captureActionReturnContext(id);
  if($("#liveDialog").open)$("#liveDialog").close();
  openSoldDialog(id,ctx);
};


function listoneSyncDateLabel(iso){
  if(!iso)return "mai";
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return "data non disponibile";
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(d);
}
function listoneSyncAgeLabel(){
  const iso=appliedListoneSync?.importedAt||appliedListoneSync?.generatedAt;
  if(!iso)return "mai importato";
  const ms=Date.now()-new Date(iso).getTime();
  if(!Number.isFinite(ms)||ms<0)return listoneSyncDateLabel(iso);
  const min=Math.floor(ms/60000);
  if(min<1)return "adesso";
  if(min<60)return `${min} min fa`;
  const h=Math.floor(min/60);
  if(h<24)return `${h} h fa`;
  return listoneSyncDateLabel(iso);
}
function listoneSyncIsLocal(){return syncSnapshotValid(appliedListoneSync)}
function listoneSyncCardHTML(){
  const local=listoneSyncIsLocal();
  const active=allPlayers.filter(p=>isMarketEligiblePlayer(p)).length;
  return `<section class="listone-sync-card bootstrap">
    <div class="listone-sync-copy">
      <span class="listone-sync-kicker">LISTONE LOCALE</span>
      <b>${local?"Archivio dell’utente attivo":"Nessun giocatore preinstallato"}</b>
      <small>${active} giocatori · elaborazione esclusivamente nel browser${local?` · importato ${listoneSyncDateLabel(appliedListoneSync?.importedAt)}`:""}</small>
    </div>
    <div class="listone-local-actions">
      <button class="listone-sync-btn" id="importListoneBtn" type="button">Importa CSV/JSON</button>
      <button class="listone-local-copy" id="exportLocalListoneBtn" type="button" ${local?"":"disabled"}>Esporta archivio</button>
      <a class="listone-local-copy listone-template-link" href="./listone-template.csv" download>Modello CSV</a>
    </div>
  </section>`;
}
function listoneDashboardBadgeHTML(){
  return `<button class="listone-dashboard-status" id="dashboardListoneBtn">
    <span>ARCHIVIO GIOCATORI</span>
    <b>${listoneSyncIsLocal()?"locale e pronto":"vuoto · importa un file"}</b>
  </button>`;
}
function syncSnapshotValid(snapshot){
  return snapshot&&snapshot.schema===LISTONE_SYNC_SCHEMA&&snapshot.complete===true
    &&snapshot.sourceKind==="user-provided-local"&&Array.isArray(snapshot.players)
    &&Number(snapshot.activePlayers)>=1&&Number(snapshot.unclassified||0)===0;
}
function computeListoneChanges(snapshot){
  const current=new Map(allPlayers.map(p=>[normalizePlayerName(p.name),p]));
  const incoming=new Map(snapshot.players.map(p=>[p.key||normalizePlayerName(p.name),p]));
  const changes=[];
  incoming.forEach((s,key)=>{
    const cur=current.get(key);
    if(s.active!==false&&!cur){changes.push({type:"new",name:s.name,text:`Nuovo · ${s.club} · ${s.role} · FVM ${s.fvm||0}`});return}
    if(!cur)return;
    if(s.active===false&&!cur.outOfListone){changes.push({type:"out",name:cur.name,text:"Non attivo nel file importato · storico preservato"});return}
    if(s.active===false)return;
    if(s.club&&s.club!==cur.club)changes.push({type:"club",name:s.name,text:`Club ${cur.club} → ${s.club}`});
    if(validMantraRole(s.role)&&s.role!==cur.role)changes.push({type:"role",name:s.name,text:`Ruolo Mantra ${cur.role} → ${s.role}`});
    if(Number(s.fvm)!==Number(cur.fvm))changes.push({type:"fvm",name:s.name,text:`FVM ${cur.fvm||0} → ${s.fvm||0}`});
    if(Number(s.quote||0)!==Number(cur.quote||0)&&Number(s.quote||0)>0)changes.push({type:"quote",name:s.name,text:`Quotazione ${cur.quote||0} → ${s.quote||0}`});
  });
  current.forEach((cur,key)=>{
    if(!cur.outOfListone&&!incoming.has(key))changes.push({type:"out",name:cur.name,text:"Non presente nel nuovo snapshot · storico preservato"});
  });
  const counts={new:0,out:0,club:0,role:0,fvm:0,quote:0};
  changes.forEach(x=>counts[x.type]=(counts[x.type]||0)+1);
  return {changes,counts};
}
function syncChangeTag(type){return ({new:"NUOVO",out:"FUORI",club:"CLUB",role:"RUOLO",fvm:"FVM",quote:"QUOTA"})[type]||type.toUpperCase()}
function openListoneSyncDialog(html){
  $("#listoneSyncDialogContent").innerHTML=html;
  const d=$("#listoneSyncDialog");if(!d.open)d.showModal();
}
function closeListoneSyncDialog(){pendingListoneSnapshot=null;if($("#listoneSyncDialog").open)$("#listoneSyncDialog").close()}
window.closeListoneSyncDialog=closeListoneSyncDialog;

function parseListoneDelimited(text){
  if(!window.FA2ListoneImporter?.parseDelimited)throw new Error("Modulo di importazione listone non disponibile.");
  return window.FA2ListoneImporter.parseDelimited(text);
}
function localListoneBoolean(value){return !["0","false","no","falso","n"].includes(String(value??"").trim().toLowerCase())}
function normalizeLocalListoneSnapshot(raw,fileName="archivio-locale"){
  const source=Array.isArray(raw)?{players:raw}:raw;
  if(!source||!Array.isArray(source.players))throw new Error("Il file non contiene un elenco di giocatori riconoscibile.");
  const errors=[],seen=new Set(),players=[];
  source.players.forEach((input,index)=>{
    const name=localField(input?.name,80),club=window.FA2ListoneImporter?.normalizeClub
      ?window.FA2ListoneImporter.normalizeClub(localField(input?.club,24),SERIES_A_CLUBS)
      :localField(input?.club,24).toUpperCase(),role=normalizeMantraRoleInput(localField(input?.role,30));
    const key=normalizePlayerName(name),active=input?.active===undefined?true:localListoneBoolean(input.active);
    const sourceRow=Math.max(1,Number(input?._sourceRow)||index+2);
    if(!name||!club||!validMantraRole(role)){errors.push(`Riga ${sourceRow}: nome, club o ruolo non valido.`);return}
    if(seen.has(key)){errors.push(`Riga ${sourceRow}: giocatore duplicato (${name}).`);return}seen.add(key);
    const birthYear=Math.max(0,Math.round(Number(input?.birthYear)||0));
    const officialId=String(input?.officialId??input?.sourceId??"").trim();
    players.push({id:localPlayerId(`${key}|${club}`),key,name,club,role,reparto:inferRepartoFromRole(role,input?.classic),
      classic:localField(input?.classic,4).toUpperCase(),quote:Math.max(0,Number(input?.quote)||0),fvm:Math.max(0,Number(input?.fvm)||0),
      birthDate:"",birthYear,active,...(/^\d+$/.test(officialId)?{officialId}: {})});
  });
  if(errors.length)throw new Error(errors.slice(0,6).join("\n"));
  const activePlayers=players.filter(player=>player.active).length;
  if(!activePlayers)throw new Error("Il file non contiene giocatori attivi validi.");
  return {schema:LISTONE_SYNC_SCHEMA,complete:true,players,activePlayers,totalPlayers:players.length,unclassified:0,
    sourceKind:"user-provided-local",sourceName:"Archivio fornito dall’utente",fileLabel:localField(fileName,100),importedAt:new Date().toISOString()};
}
function chooseLocalListoneFile(){
  const input=$("#listoneLocalFileInput");if(input){input.value="";input.click()}
}
window.checkListoneUpdate=chooseLocalListoneFile;
async function importLocalListoneFile(file){
  if(!file)return;
  try{
    const text=await fa2ReadTextFile(file);
    const raw=/\.json$/i.test(file.name)||String(file.type).includes("json")?JSON.parse(text):{players:parseListoneDelimited(text)};
    const snapshot=normalizeLocalListoneSnapshot(raw,file.name);
    const diff=computeListoneChanges(snapshot),c=diff.counts,preview=diff.changes.slice(0,24);
    pendingListoneSnapshot=snapshot;
    openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
      <div class="listone-sync-modal-head"><div><span class="eyebrow">IMPORTAZIONE LOCALE</span><h2>Verifica il listone</h2><small class="muted">${snapshot.activePlayers} attivi · ${esc(file.name)}</small></div><button class="ghost" type="button" aria-label="Chiudi importazione listone" onclick="closeListoneSyncDialog()">✕</button></div>
      <div class="sync-summary-grid">
        <div><strong>+${c.new||0}</strong><span>nuovi</span></div><div><strong>−${c.out||0}</strong><span>fuori</span></div>
        <div><strong>${(c.club||0)+(c.role||0)}</strong><span>club/ruoli</span></div><div><strong>${(c.fvm||0)+(c.quote||0)}</strong><span>valori</span></div>
      </div>
      <div class="sync-change-list">
        ${preview.length?preview.map(x=>`<div class="sync-change-row"><span class="sync-change-tag ${x.type}">${syncChangeTag(x.type)}</span><div><b>${esc(x.name)}</b><small>${esc(x.text)}</small></div></div>`).join(""):'<div class="muted sync-more">Nessuna differenza rispetto al listone attivo.</div>'}
        ${diff.changes.length>preview.length?`<div class="muted sync-more">+ altre ${diff.changes.length-preview.length} modifiche</div>`:""}
      </div>
      <div class="sync-preserve-note">Il file viene elaborato nel browser e salvato solo su questo dispositivo. L’app conserva esclusivamente campi fattuali minimi e scarta URL, testi editoriali, immagini e riferimenti alla fonte.</div>
      <label class="listone-rights-check"><input id="listoneRightsConfirm" type="checkbox"> <span>Confermo di essere autorizzato a utilizzare questo file e che la sua acquisizione rispetta le condizioni della fonte.</span></label>
      <div class="sync-dialog-actions"><button class="ghost" onclick="closeListoneSyncDialog()">Annulla</button><button class="primary" id="applyListoneSyncBtn" disabled>Usa questo archivio</button></div>
    </div>`);
    const rights=$("#listoneRightsConfirm"),apply=$("#applyListoneSyncBtn");
    rights.onchange=()=>apply.disabled=!rights.checked;apply.onclick=applyPendingListoneUpdate;
  }catch(err){
    openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
      <div class="listone-sync-modal-head"><div><span class="eyebrow">NESSUNA MODIFICA APPLICATA</span><h2>File non valido</h2></div><button class="ghost" type="button" aria-label="Chiudi importazione listone" onclick="closeListoneSyncDialog()">✕</button></div>
      <div class="listone-sync-warning">${esc(err?.message||"Il file non può essere letto.")}</div>
      <p class="muted">Sono accettati il CSV ufficiale con colonne Nome, Squadra, R e RM, il modello generico con nome, club e ruolo, oppure JSON con un array players. I dati dell’app non sono stati modificati.</p>
      <button class="primary full-btn" onclick="closeListoneSyncDialog()">Chiudi</button>
    </div>`);
  }
}
function exportLocalListone(){
  if(!syncSnapshotValid(appliedListoneSync))return;
  const blob=new Blob([JSON.stringify(appliedListoneSync,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`fantaasta-archivio-giocatori-${new Date().toISOString().slice(0,10)}.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function applyPendingListoneUpdate(){
  const snapshot=pendingListoneSnapshot;if(!syncSnapshotValid(snapshot))return;
  appliedListoneSync=snapshot;localStorage.setItem(LISTONE_SYNC_STORAGE,JSON.stringify(snapshot));
  allPlayers=buildAllPlayers();pendingListoneSnapshot=null;invalidateAuctionIntel();refresh();
  openListoneSyncDialog(`<div class="dialog-body listone-sync-dialog">
    <div class="listone-sync-modal-head"><div></div><button class="ghost" type="button" aria-label="Chiudi aggiornamento listone" onclick="closeListoneSyncDialog()">✕</button></div>
    <div class="listone-sync-finished"><span>OK</span><h2>Archivio locale attivo</h2><p>${snapshot.activePlayers} giocatori attivi · ${listoneSyncDateLabel(snapshot.importedAt)}</p></div>
    <div class="listone-sync-success-box"><b>Importazione completata</b><span>Nessun invio esterno. L’archivio resta nel browser e può essere cancellato dall’utente.</span></div>
    <button class="primary full-btn" onclick="closeListoneSyncDialog()">Continua</button>
  </div>`);
}
window.applyPendingListoneUpdate=applyPendingListoneUpdate;

function playerRow(p){
  const b=state.purchases[p.id], sold=isSold(p.id); const sig=b?signal(p,b.price):null;
  const strategic=!!p.strategic, assignment=playerAssignment(p);
  const assignedClass=assignment.assigned?`assigned ${assignment.mine?"assigned-mine":"assigned-opponent"}`:"";
  const openLabel=`Apri ${playerNameText(p)}, ${p.club}, ruolo ${p.role}${assignment.assigned?`, assegnato a ${assignment.teamName} per ${fmt(assignment.price)} crediti`:""}`;
  return `<div class="player ${b?"bought":""} ${sold?"sold":""} ${assignedClass} ${strategic?"strategic-player":"market-player"}" data-id="${p.id}" role="group" aria-label="${escAttr(playerNameText(p))}">
    <div class="player-main">
      ${kitHTML(p.club,'row',p.club)}
      <div class="player-copy">
        <h3>${playerNameHTML(p)}<button type="button" class="watch-btn ${isWatchlisted(p.id)?"active":""}" aria-label="${isWatchlisted(p.id)?"Rimuovi":"Aggiungi"} ${escAttr(playerNameText(p))} ${isWatchlisted(p.id)?"dalla":"alla"} watchlist" aria-pressed="${isWatchlisted(p.id)?"true":"false"}" onclick='event.stopPropagation();toggleWatchlist(${idArg(p.id)})'>${isWatchlisted(p.id)?"SEG":"+"}</button>
          ${p.notes&&p.notes.includes("TARGET")?'<span class="badge target">TARGET</span>':""}
          ${strategic?'<span class="badge strategic-badge">200</span>':'<span class="badge listone-badge">LISTONE</span>'}
          ${p.outOfListone?'<span class="badge out-listone-badge">FUORI LISTONE</span>':""}
        </h3>
        <div class="meta">${p.club} · ${mantraRoleDisplay(p.role)} · ${p.tier||"—"}</div>
        ${assignment.assigned?`<div class="player-assignment-line"><span>${assignment.mine?"MIA ROSA":"ASSEGNATO"}</span><b>${esc(assignment.teamName)}</b>${assignment.price>0?`<small>${fmt(assignment.price)} cr</small>`:""}</div>`:""}
        ${p.reparto==="ATT"&&primaryOffensiveRole(p)?`<span class="badge primary-role-badge">PRIM. ${primaryOffensiveRole(p)}</span>`:""}
        <span class="badge">FVM ${p.fvm||0}</span>
        ${strategic&&p.starter?`<span class="badge">${p.starter}</span>`:""}
        ${isU23Player(p)?'<span class="badge">U23</span>':""}${isU21Player(p)?'<span class="badge">U21</span>':""}
      </div>
    </div>
    <div class="player-market-state">
      <div class="price">${assignment.assigned?"ASSEGNATO":b?fmt(b.price):"MAX "+fmt(p.maxPrice)}</div>
      <div class="meta">${assignment.assigned?esc(assignment.teamName):b?sig.t:strategic?"strategico":"da FVM"}</div>
      <button type="button" class="player-open-control" aria-label="${escAttr(openLabel)}" onclick='openPlayer(${idArg(p.id)})'>›</button>
    </div>
  </div>`;
}

function currentClubOptions(){
  const names=Object.fromEntries(SERIES_A_CLUBS);
  const codes=[...new Set(allPlayers.filter(p=>isMarketEligiblePlayer(p)&&p.club).map(p=>String(p.club)))];
  return codes.map(code=>[code,names[code]||code]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),"it",{sensitivity:"base"}));
}
function clubDisplayAbbr(code,name){
  const clean=String(name||code||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z]/g,"");
  return (clean.slice(0,3)||String(code||"").slice(0,3)).toUpperCase();
}
function selectedClubSet(){
  return new Set(Array.isArray(state.clubFilter)?state.clubFilter.map(String):[]);
}
function playerMatchesClubFilter(p){
  const selected=selectedClubSet();
  return selected.size===0 || selected.has(String(p?.club||""));
}
function saveClubFilter(){
  localStorage.setItem("fa2_club_filter",JSON.stringify(Array.isArray(state.clubFilter)?state.clubFilter:[]));
}
function clubFilterButtonLabel(){
  const selected=Array.isArray(state.clubFilter)?state.clubFilter:[];
  if(!selected.length) return `<span>Squadre</span><small>Tutte</small>`;
  if(selected.length===1) return `<span>Squadre</span><small>${esc(selected[0])}</small>`;
  return `<span>Squadre</span><small>${selected.length} scelte</small>`;
}
let clubFilterDraft=[];
const PLAYER_PAGE_SIZE=40;
let playerVisibleLimit=PLAYER_PAGE_SIZE;
function renderClubFilterDialog(){
  const dialog=$("#clubFilterDialog");
  const body=$("#clubFilterDialogContent");
  if(!dialog||!body)return;
  const selected=new Set(clubFilterDraft.map(String));
  const clubs=currentClubOptions();
  body.innerHTML=`<div class="club-filter-dialog-body">
    <div class="club-filter-dialog-head">
      <div><div class="eyebrow">FILTRO GIOCATORI</div><h2>Squadre</h2><p>Seleziona una o più squadre. Il filtro si combina con ruolo, Tutti, Preferiti, Venduti e ricerca.</p></div>
      <button type="button" class="ghost club-filter-close" id="closeClubFilter" aria-label="Chiudi">Chiudi</button>
    </div>
    <button type="button" class="club-filter-all ${selected.size===0?"active":""}" id="allClubsChoice">
      <span>Tutte le squadre</span><small>${clubs.length} club</small>
    </button>
    <div class="club-filter-grid">
      ${clubs.map(([code,name])=>`<button type="button" class="club-choice ${selected.has(code)?"active":""}" data-club="${escAttr(code)}">${kitHTML(code,"sm",name)}<span><b>${esc(name)}</b><small>${esc(code)}</small></span><i>${selected.has(code)?"✓":""}</i></button>`).join("")}
    </div>
    <div class="club-filter-dialog-actions">
      <button type="button" class="ghost" id="clearClubFilter">Azzera filtro</button>
      <button type="button" class="primary" id="applyClubFilter">Applica${selected.size?` · ${selected.size}`:""}</button>
    </div>
  </div>`;
  $("#closeClubFilter").onclick=()=>dialog.close();
  $("#allClubsChoice").onclick=()=>{clubFilterDraft=[];renderClubFilterDialog();};
  $("#clearClubFilter").onclick=()=>{clubFilterDraft=[];renderClubFilterDialog();};
  [...body.querySelectorAll(".club-choice")].forEach(btn=>btn.onclick=()=>{
    const code=String(btn.dataset.club);
    const set=new Set(clubFilterDraft.map(String));
    if(set.has(code))set.delete(code);else set.add(code);
    clubFilterDraft=[...set];
    renderClubFilterDialog();
  });
  $("#applyClubFilter").onclick=()=>{
    playerVisibleLimit=PLAYER_PAGE_SIZE;
    state.clubFilter=[...clubFilterDraft];
    saveClubFilter();
    dialog.close();
    renderPlayers();
  };
}
function openClubFilter(){
  clubFilterDraft=Array.isArray(state.clubFilter)?[...state.clubFilter]:[];
  renderClubFilterDialog();
  $("#clubFilterDialog").showModal();
}
window.openClubFilter=openClubFilter;

function playerViewData(){
  const q=state.query.trim().toLowerCase();
  const searching=!!q;

  // v1.45.2: la ricerca è un localizzatore globale. Durante un'asta reale un
  // giocatore può essere già VENDUTO o MIO: deve comunque essere trovabile,
  // indipendentemente dal pool Strategici/Tutto il listone. I tab continuano
  // invece a governare la navigazione quando il campo ricerca è vuoto.
  const visiblePool=(state.filter==="Venduti" || searching)
    ? allPlayers
    : state.poolMode==="all" ? allPlayers : currentStrategicPlayers();

  const baseFiltered=visiblePool.filter(p=>{
    const okq=!q || (p.name+" "+p.club+" "+p.role+" "+(p.primaryRole||"")).toLowerCase().includes(q);
    let okr;
    if(state.filter==="Venduti"){
      okr=isSold(p.id);
    }else if(searching){
      // In ricerca non nascondere assegnati/venduti: il loro stato è già
      // mostrato nella riga e nel dettaglio giocatore. Manteniamo solo ruolo,
      // preferiti e filtro club scelti dall'utente.
      const visibleMarket=!p.outOfListone || playerIsRosterAssigned(p);
      okr=visibleMarket && playerMatchesRoleFilter(p,state.filter,state.poolMode);
    }else{
      // v1.45.3: durante l'asta anche gli assegnati restano visibili.
      // Il contorno rosso e il nome squadra rendono evidente che non sono più disponibili.
      const visibleMarket=!p.outOfListone || playerAssignment(p).assigned;
      okr=visibleMarket && playerMatchesRoleFilter(p,state.filter,state.poolMode);
    }
    const okc=playerMatchesClubFilter(p);
    return okq&&okr&&okc;
  });

  const sorter=(a,b)=>{
    if(!searching && state.filter!=="Venduti"){
      const aa=playerAssignment(a).assigned?1:0, ab=playerAssignment(b).assigned?1:0;
      if(aa!==ab)return aa-ab;
    }
    const ta=(a.notes||"").includes("TARGET")?0:1;
    const tb=(b.notes||"").includes("TARGET")?0:1;
    return ta-tb || Number(b.maxPrice||0)-Number(a.maxPrice||0) || Number(b.fvm||0)-Number(a.fvm||0);
  };

  const list=baseFiltered.slice().sort(sorter);
  const partial=list.length>playerVisibleLimit;
  const loadMoreHTML=partial?`<div class="player-load-more">
    <button type="button" class="ghost" id="loadMorePlayers">Mostra altri ${Math.min(PLAYER_PAGE_SIZE,list.length-playerVisibleLimit)}</button>
    <small>${Math.min(playerVisibleLimit,list.length)} di ${list.length} visualizzati</small>
  </div>`:"";

  let content="";
  if(ROLE_DETAIL_FILTERS.has(state.filter)){
    const role=state.filter;
    const main=list.filter(p=>isPrimaryForRole(p,role));
    const compatible=list.filter(p=>!isPrimaryForRole(p,role));
    const ordered=[...main,...compatible].slice(0,playerVisibleLimit);
    const visibleMain=ordered.filter(p=>isPrimaryForRole(p,role));
    const visibleCompatible=ordered.filter(p=>!isPrimaryForRole(p,role));
    content=`
      <div class="role-sheet-summary">
        <div><span>${role} principali</span><strong>${main.length}</strong></div>
        <div><span>${role} compatibili</span><strong>${compatible.length}</strong></div>
        <div><span>Totale opzioni</span><strong>${list.length}</strong></div>
      </div>
      <div class="role-sheet-section">
        <div class="role-sheet-head">
          <div><b>${role} principali</b><span>ruolo ${role} prioritario</span></div>
          <strong>${main.length}</strong>
        </div>
        ${visibleMain.length?visibleMain.map(playerRow).join(""):main.length?`<div class="card muted player-deferred-note">Disponibili con “Mostra altri”.</div>`:`<div class="card muted">Nessun ${role} principale.</div>`}
      </div>
      <div class="role-sheet-section">
        <div class="role-sheet-head">
          <div><b>${role} compatibili</b><span>${roleCompatibilityLabel(role)}</span></div>
          <strong>${compatible.length}</strong>
        </div>
        ${visibleCompatible.length?visibleCompatible.map(playerRow).join(""):compatible.length?`<div class="card muted player-deferred-note">Disponibili con “Mostra altri”.</div>`:`<div class="card muted">Nessun ${role} compatibile.</div>`}
      </div>${loadMoreHTML}`;
  }else{
    if(list.length){
      content=`<div>${list.slice(0,playerVisibleLimit).map(playerRow).join("")}</div>${loadMoreHTML}`;
    }else{
      const q=state.query.trim();
      content=`<div class="players-empty-state">
        <b>${q?`Nessun risultato per “${esc(q)}”`:`Nessun giocatore con questi filtri`}</b>
        <span>${q?"La ricerca include anche giocatori venduti e già acquistati.":"Prova a cambiare ruolo, squadra o pool."}</span>
        ${q?'<button type="button" class="ghost" onclick="clearPlayerSearch()">Azzera ricerca</button>':""}
      </div>`;
    }
  }

  return {list,content,visibleCount:Math.min(playerVisibleLimit,list.length)};
}

function playerResultsInfo(list,visibleCount=list.length){
  return `${visibleCount<list.length?`${visibleCount} di ${list.length}`:list.length} giocatori
    ${state.query.trim()?" · ricerca globale (disponibili, miei e venduti)":""}
    ${ROLE_DETAIL_FILTERS.has(state.filter)?" · principali + compatibili":""}
    ${state.filter==="Venduti"?" · assegnati ad altre squadre":""}
    ${state.filter==="Preferiti"?" · watchlist personale":""}
    ${state.filter==="U23"?` · nati dal ${configuredUnderRule("u23")?.birthYearFrom||YOUTH_RULES_2627.u23MinBirthYear}`:""}
    ${state.filter==="U21"?` · nati dal ${configuredUnderRule("u21")?.birthYearFrom||YOUTH_RULES_2627.u21MinBirthYear}`:""}
    ${state.clubFilter?.length?` · ${state.clubFilter.length===1?state.clubFilter[0]:state.clubFilter.length+" squadre"}`:""}`;
}

function clearPlayerSearch(){
  state.query="";
  playerVisibleLimit=PLAYER_PAGE_SIZE;
  const input=$("#searchInput");
  if(input) input.value="";
  const clear=$("#clearPlayerSearchBtn");
  if(clear) clear.classList.add("hidden");
  updatePlayerSearchResults();
}
window.clearPlayerSearch=clearPlayerSearch;

function updatePlayerSearchResults(){
  const data=playerViewData();
  const count=$("#playerResultsCount");
  const results=$("#playerResults");
  if(count) count.textContent=playerResultsInfo(data.list,data.visibleCount);
  if(results) results.innerHTML=data.content;
  bindPlayerResultActions();
}

function bindPlayerResultActions(){
  bindPlayers();
  const loadMore=$("#loadMorePlayers");
  if(loadMore)loadMore.onclick=()=>{
    playerVisibleLimit+=PLAYER_PAGE_SIZE;
    updatePlayerSearchResults();
  };
}

function renderPlayers(){
  let roles=["Tutti","Preferiti","U23","U21",...roleOrder,"Venduti"];
  const data=playerViewData();

  const modePool=allPlayers;
  const clubModePool=modePool.filter(playerMatchesClubFilter);
  const availableModePool=clubModePool.filter(p=>isMarketEligiblePlayer(p)&&!isSold(p.id)&&!state.purchases[p.id]);

  $("#playersView").innerHTML=`
    ${listoneSyncCardHTML()}
    ${playersAuctionLiveStripHTML()}
    <div class="market-universe-strip local-archive-strip"><span>Archivio importato dall’utente</span><b>${allPlayers.filter(p=>!p.outOfListone).length} giocatori</b></div>

    <div class="players-quickbar">
      <div class="player-search-wrap">
        <input class="search" id="searchInput"
          aria-label="Cerca giocatore, club o ruolo"
          placeholder="Cerca giocatore, club o ruolo…"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          value="${state.query.replaceAll('"','&quot;')}">
        <button type="button" id="clearPlayerSearchBtn" class="search-clear ${state.query.trim()?"":"hidden"}" aria-label="Azzera ricerca">×</button>
      </div>
      <button type="button" class="players-live-shortcut" onclick="openAuctionLive()" aria-label="Apri Asta Live">LIVE</button>
    </div>

    <div class="market-universe-strip">
      <span>Universo locale</span>
      <b>${availableModePool.length} disponibili</b>
      <b>${assignedPlayers().filter(playerMatchesClubFilter).length} assegnati</b>
    </div>

    <div class="inline-club-filter">
      <div class="inline-club-filter-head">
        <span>Squadre</span>
        <small>selezione multipla</small>
      </div>
      <div class="club-chips" role="group" aria-label="Filtro squadre Serie A">
        <button type="button" class="club-chip club-chip-all ${!state.clubFilter?.length?"active":""}" data-club="__ALL__" aria-pressed="${!state.clubFilter?.length?"true":"false"}" aria-label="Mostra tutte le squadre"><span>TUT</span></button>
        ${currentClubOptions().map(([code,name])=>`<button type="button" class="club-chip ${selectedClubSet().has(code)?"active":""}" data-club="${escAttr(code)}" title="${escAttr(name)}" aria-label="Filtra ${escAttr(name)}" aria-pressed="${selectedClubSet().has(code)?"true":"false"}">${kitHTML(code,"xs",name)}<span>${clubDisplayAbbr(code,name)}</span></button>`).join("")}
      </div>
    </div>

    <div class="chips role-filter-chips" role="group" aria-label="Filtro per ruolo e stato">
      ${roles.map(r=>{
        const poolForCount=(r==="Venduti"?allPlayers:modePool).filter(playerMatchesClubFilter);
        const count=r==="Tutti"
          ? poolForCount.filter(p=>!p.outOfListone || playerAssignment(p).assigned).length
          : r==="Preferiti"
            ? poolForCount.filter(p=>(!p.outOfListone || playerAssignment(p).assigned)&&isWatchlisted(p.id)).length
          : r==="Venduti"
            ? poolForCount.filter(p=>isSold(p.id)).length
            : poolForCount.filter(p=>(!p.outOfListone || playerAssignment(p).assigned)&&playerMatchesRoleFilter(p,r,state.poolMode)).length;
        return `<button type="button" class="chip ${state.filter===r?"active":""}" data-role="${r}" aria-pressed="${state.filter===r?"true":"false"}">
          ${r}<small>${count}</small>
        </button>`;
      }).join("")}
    </div>

    <div id="playerResultsCount" class="muted" role="status" aria-live="polite" style="margin:8px 2px">${playerResultsInfo(data.list,data.visibleCount)}</div>
    <div id="playerResults">${data.content}</div>`;

  $("#importListoneBtn").onclick=chooseLocalListoneFile;
  $("#exportLocalListoneBtn").onclick=exportLocalListone;
  $$(".club-chip").forEach(btn=>btn.onclick=()=>{
    playerVisibleLimit=PLAYER_PAGE_SIZE;
    const code=String(btn.dataset.club||"");
    if(code==="__ALL__"){
      state.clubFilter=[];
    }else{
      const selected=selectedClubSet();
      if(selected.has(code)) selected.delete(code); else selected.add(code);
      state.clubFilter=[...selected];
    }
    saveClubFilter();
    renderPlayers();
  });

  /*
   * IMPORTANTE iPhone/Safari:
   * durante la digitazione NON ricreiamo #playersView e NON sostituiamo
   * #searchInput. Aggiorniamo soltanto contatore e risultati.
   * In questo modo il campo conserva il focus e la tastiera resta aperta.
   */
  $("#searchInput").addEventListener("input",e=>{
    state.query=e.target.value;
    playerVisibleLimit=PLAYER_PAGE_SIZE;
    const clear=$("#clearPlayerSearchBtn");
    if(clear) clear.classList.toggle("hidden",!state.query.trim());
    updatePlayerSearchResults();
  });
  $("#clearPlayerSearchBtn").onclick=()=>{
    clearPlayerSearch();
    $("#searchInput")?.focus();
  };

  $$(".chip").forEach(b=>b.onclick=()=>{
    state.filter=b.dataset.role;
    playerVisibleLimit=PLAYER_PAGE_SIZE;
    renderPlayers();
  });

  bindPlayerResultActions();
}
function bindPlayers(){
  $$(".player[data-id]").forEach(el=>{
    el.onclick=e=>{if(!e.target.closest("button,a,input,select,textarea"))openPlayer(el.dataset.id)};
  });
}
function fa2StatValue(v,digits=1){
  const n=Number(v);
  if(!Number.isFinite(n))return "—";
  return n.toLocaleString("it-IT",{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function fa2StatInt(v){const n=Number(v);return Number.isFinite(n)?Math.round(n).toLocaleString("it-IT"):"—"}
function fa2TrendLabel(v){const n=Number(v)||0;return n>=4?`↑ +${Math.round(n)}`:n<=-4?`↓ ${Math.round(n)}`:"→ stabile"}
function fa2PlayerIntelligenceHTML(p){
  const engine=window.FA2PlayerIntelligence;
  if(!engine)return `<section class="pi-card missing"><div class="pi-head"><div><span>PLAYER INTELLIGENCE</span><b>Motore non caricato</b></div></div></section>`;
  const identity=engine.resolve?.(p)||{data:engine.get(p),matched:!!engine.get(p),ambiguous:false,confidence:0,methodLabel:""};
  const data=identity.data,status=engine.status();
  if(!data){
    const title=identity.ambiguous?"Abbinamento da verificare":"Storico non disponibile";
    const detail=identity.ambiguous
      ?"Esistono profili simili, ma ruolo, squadra o iniziali non permettono un'associazione sicura. Nessun dato viene applicato automaticamente."
      :"Il giocatore non è presente nel dataset storico attuale. Il Listone e l'asta continuano a funzionare normalmente.";
    return `<section class="pi-card missing"><div class="pi-head"><div><span>PLAYER INTELLIGENCE · RESOLVER ${esc(engine.RESOLVER_VERSION||"A6.1")}</span><b>${esc(title)}</b><small>Dati ${esc(status.label)} · ${status.count||0} giocatori indicizzati${identity.candidateCount?` · ${identity.candidateCount} profili simili`:""}</small></div><button class="ghost pi-refresh" onclick="openLocalDataCenter()">Importa statistiche</button></div><p>${esc(detail)}</p></section>`;
  }
  const latest=data.latest||{},w=data.weighted||{},seasons=Array.isArray(data.seasons)?data.seasons:[];
  const source="Archivio locale dell’utente";
  const stats=[
    ["Minuti",fa2StatInt(latest.minutes)],
    ["Titolare",fa2StatInt(latest.starts)],
    ["Rating",fa2StatValue(latest.rating,2)],
    ["Gol",fa2StatValue(latest.goals,0)],
    ["Assist",fa2StatValue(latest.assists,0)],
    ["G+A /90",fa2StatValue(latest.ga90,2)],
    ["Tiri /90",fa2StatValue(latest.shots90,2)],
    ["In porta /90",fa2StatValue(latest.shotsOn90,2)],
    ["Passaggi chiave /90",fa2StatValue(latest.keyPasses90,2)],
    ["Precisione passaggi",fa2StatValue(latest.passAccuracy,0)+"%"],
    ["Tkl+Int /90",fa2StatValue(latest.tacklesInterceptions90,2)],
    ["Duelli vinti",fa2StatValue(latest.duelsWonPct,0)+"%"],
    ["Dribbling /90",fa2StatValue(latest.dribbles90,2)],
    ["Cartellini /90",fa2StatValue(latest.cards90,2)]
  ];
  if(Number.isFinite(Number(latest.penaltiesScored)))stats.push(["Rigori segnati",fa2StatValue(latest.penaltiesScored,0)]);
  if(Number.isFinite(Number(latest.penaltiesMissed)))stats.push(["Rigori sbagliati",fa2StatValue(latest.penaltiesMissed,0)]);
  if(Number.isFinite(Number(latest.saves90)))stats.push(["Parate /90",fa2StatValue(latest.saves90,2)]);
  if(Number.isFinite(Number(latest.savePct)))stats.push(["Parate %",fa2StatValue(latest.savePct,1)+"%"]);
  if(Number.isFinite(Number(latest.penaltiesSaved)))stats.push(["Rigori parati",fa2StatValue(latest.penaltiesSaved,0)]);
  const historyRows=seasons.slice(0,3).map(x=>`<div class="pi-season-row"><b>${esc(x.seasonLabel||x.season||"—")}</b><span>${fa2StatInt(x.minutes)} min</span><span>${fa2StatValue(x.goals,0)} G</span><span>${fa2StatValue(x.assists,0)} A</span><span>${fa2StatValue(x.score,0)}/100</span></div>`).join("");
  return `<section class="pi-card ${status.className}">
    <div class="pi-head"><div><span>PLAYER INTELLIGENCE · ${esc(status.label)}</span><b>${Math.round(Number(data.score)||0)}/100 <small>affidabilità ${Math.round(Number(data.reliability)||0)}%</small></b><small>${esc(source)} · importato ${esc(engine.formatAge())}</small><small class="pi-identity">IDENTITÀ: ${esc(identity.methodLabel||engine.methodLabel?.(identity.method)||"VERIFICATA")} · ${Math.round(Number(identity.confidence)||0)}%</small></div><button class="ghost pi-refresh" onclick="openLocalDataCenter()">Gestisci dati</button></div>
    <div class="pi-score-grid"><div><span>STORICO</span><b>${Math.round(Number(data.score)||0)}</b></div><div><span>TREND</span><b>${esc(fa2TrendLabel(data.trend))}</b></div><div><span>STAGIONE</span><b>${esc(latest.seasonLabel||latest.season||"—")}</b></div><div><span>POS. DATI</span><b>${esc(data.positionGroup||"—")}</b></div></div>
    <div class="pi-stats-grid">${stats.map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
    <div class="pi-history-summary"><b>MEDIA PESATA ULTIME STAGIONI</b><span>${fa2StatInt(w.minutes)} min eq. · rating ${fa2StatValue(w.rating,2)} · G+A/90 ${fa2StatValue(w.ga90,2)} · score ${fa2StatValue(data.score,0)}/100</span></div>
    ${historyRows?`<div class="pi-seasons"><b>STORICO</b>${historyRows}</div>`:""}
    <div class="pi-source-note">Dati locali forniti dall’utente. Nessuna fonte esterna viene interrogata dall’app.</div>
  </section>`;
}
async function refreshPlayerIntelligenceProfile(id){
  openLocalDataCenter();
}
async function refreshPlayerIntelligenceGlobal(){
  openLocalDataCenter();return false;
}
window.refreshPlayerIntelligenceProfile=refreshPlayerIntelligenceProfile;
window.refreshPlayerIntelligenceGlobal=refreshPlayerIntelligenceGlobal;
function openPlayer(id){
  const p=getPlayer(id); if(!p)return;
  const b=state.purchases[p.id],sold=isSold(p.id),strategic=!!p.strategic;
  const live=liveMaxForPlayer(p);
  const playerActions=b
    ? `<button class="ghost" onclick='editPurchase(${idArg(p.id)})'>Modifica acquisto</button><button class="dangerbtn" onclick='removePurchase(${idArg(p.id)})'>Annulla acquisto</button>`
    : sold
      ? `<button class="ghost" onclick='editSold(${idArg(p.id)})'>Modifica vendita</button><button class="ghost" onclick='restoreSold(${idArg(p.id)})'>Ripristina mercato</button>`
      : p.outOfListone
        ? `<button class="ghost" onclick="playerDialog.close()">Chiudi</button>`
        : `<button class="primary" onclick='startPurchase(${idArg(p.id)})'>Acquista</button><button class="soldbtn" onclick='markSold(${idArg(p.id)})'>Venduto</button>`;
  $("#playerDialogContent").innerHTML=`<div class="dialog-body">
    <div class="section-title player-dialog-head">
      <div class="player-dialog-title">${kitHTML(p.club,'dialog',p.club)}<div><div class="eyebrow">${p.club} · ${mantraRoleDisplay(p.role)} · ${strategic?"STRATEGICO":"LISTONE"}</div><h2>${playerNameHTML(p)}</h2></div></div>
      <div class="player-title-actions"><button type="button" class="watch-detail ${isWatchlisted(p.id)?"active":""}" aria-label="${isWatchlisted(p.id)?"Rimuovi":"Aggiungi"} ${escAttr(playerNameText(p))} ${isWatchlisted(p.id)?"dalla":"alla"} watchlist" aria-pressed="${isWatchlisted(p.id)?"true":"false"}" onclick='toggleWatchlist(${idArg(p.id)})'>${isWatchlisted(p.id)?"Seguito":"Segui"}</button><button type="button" class="ghost" aria-label="Chiudi scheda giocatore" onclick="playerDialog.close()">✕</button></div>
    </div>
    <div class="grid">
      <div class="card metric"><span>FVM</span><strong>${p.fvm||0}</strong></div>
      <div class="card metric"><span>${strategic?"MAX iniziale":"MAX da FVM"}</span><strong>${p.maxPrice}</strong></div>
      <div class="card metric"><span>MAX LIVE</span><strong>${fmt(live.live)}</strong></div>
      <div class="card metric"><span>Inflazione</span><strong>${pctLabel(live.inflation,1)}</strong></div>
    </div>
    <div class="dialog-actions player-quick-actions">${playerActions}</div>
    ${fa2PlayerPlanHTML(p)}
    <div class="card" style="margin-top:10px">
      <div class="line"><span>Ruoli Mantra</span>${mantraRoleChipHTML(p.role)}</div>
      <div class="line"><span>Fascia</span><b>${p.tier||"—"}</b></div>
      <div class="line"><span>Dati sportivi</span><b>Listone importato</b></div>
      ${p.reparto==="ATT"&&primaryOffensiveRole(p)?`<div class="line"><span>Ruolo offensivo principale</span><b>${primaryOffensiveRole(p)}</b></div>`:""}
      <div class="line"><span>Giovane</span><b>${youthLabel(p)}${birthDateLabel(p)?` · ${birthDateLabel(p)}`:""}</b></div>
      <div class="line"><span>Fit ${state.strategy} · ${activeStrategy().module}</span><b>${strategyPlayerFit(p).length?strategyPlayerFit(p).join(" · "):"ruolo condiviso / non chiave"}</b></div>
      <div class="line"><span>Stato mercato</span><b>${playerAssignment(p).assigned?"ASSEGNATO":p.outOfListone?"FUORI LISTONE":"DISPONIBILE"}</b></div>
      ${p.syncGeneratedAt?`<div class="line"><span>Listone locale</span><b>${listoneSyncDateLabel(p.syncGeneratedAt)}</b></div>`:""}
      <div class="line"><span>Scarsità live</span><b>${riskIcon(live.risk)} ${live.risk}/100 · ${live.activeComp} rivali probabili</b></div>
      ${playerAssignment(p).assigned?`<div class="line"><span>Assegnato a</span><b>${esc(playerAssignment(p).teamName)}</b></div>`:""}
      ${playerAssignment(p).assigned?`<div class="line"><span>Prezzo assegnazione</span><b>${playerAssignment(p).price>0?fmt(playerAssignment(p).price)+" cr":"—"}</b></div>`:""}
      ${p.notes?`<div class="line"><span>Note</span><b>${p.notes}</b></div>`:""}
    </div>
  </div>`;
  $("#playerDialog").dataset.playerId=String(p.id);
  $("#playerDialog").showModal();
}
let purchaseId=null;
let purchaseMode="new";

let soldPlayerId=null;
function openSoldDialog(id,returnContext=undefined){
  const p=getPlayer(id); if(!p || state.purchases[p.id]) return;
  actionReturnContext=returnContext===undefined?captureActionReturnContext(p.id):returnContext;
  soldPlayerId=p.id;
  const previous=state.sold[p.id]||{};
  $("#playerDialog").close();
  $("#soldTitle").textContent=(previous.price?"Modifica vendita · ":"Venduto · ")+playerNameText(p);

  const teams=opponentTeams();
  if(teams.length){
    $("#soldTeamSelect").innerHTML=teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
    const preferred=teams.some(t=>t.id===previous.teamId)?previous.teamId:teams[0].id;
    $("#soldTeamSelect").value=preferred;
    $("#soldTeamSelect").disabled=false;
    updateSoldEconomicNote();
  }else{
    $("#soldTeamSelect").innerHTML='<option value="">Non assegnato</option>';
    $("#soldTeamSelect").disabled=true;
    $("#soldLeagueNote").textContent="Nessuna lega creata: il giocatore sarà registrato come venduto non assegnato. Puoi creare la lega dal menu Leghe e modificarlo dopo.";
  }
  $("#soldPriceInput").min=String(configuredMinBid());$("#soldPriceInput").value=previous.price||"";
  $("#soldDialog").showModal();
  $("#soldPriceInput").focus();
  $("#soldPriceInput").select();
}
$("#soldTeamSelect").addEventListener("change",updateSoldEconomicNote);
window.markSold=id=>openSoldDialog(id);
window.editSold=id=>openSoldDialog(id);
window.restoreSold=id=>{
  const p=getPlayer(id); id=p?p.id:id;
  const previous=state.sold[id];if(!previous)return;
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
  delete state.sold[id];saveSold();
  fa2AfterAuctionStateChange("PLAYER_RESTORED",id,strategyBefore);
  recordOperation("RIPRISTINA_MERCATO",`${p?.name||"Giocatore"} ripristinato al mercato`,before);
  const d=$("#playerDialog");
  if(d.open) d.close();
  refresh();
};

function cancelSoldFlow(){
  if(document.activeElement) document.activeElement.blur();
  if($("#soldDialog").open) $("#soldDialog").close();
  soldPlayerId=null;
  $("#soldPriceInput").value="";
  restoreActionReturnContext();
}
$("#cancelSold").addEventListener("click",cancelSoldFlow);
$("#soldDialog").addEventListener("cancel",e=>{
  e.preventDefault();
  cancelSoldFlow();
});

$("#soldForm").addEventListener("submit",e=>{
  e.preventDefault();
  const p=getPlayer(soldPlayerId); if(!p)return;
  const price=Number($("#soldPriceInput").value);
  if(!Number.isInteger(price)||price<configuredMinBid())return;
  const previous=state.sold[p.id]||{};
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates(),wasEdit=!!previous.price;
  const teamId=opponentTeams().length?$("#soldTeamSelect").value:"";
  const team=leagueTeamById(teamId);
  if(team){
    const isExistingAssignment=!!previous.price;
    const clubCount=teamClubCount(team,p.club,isExistingAssignment?p.id:null);
    const clubLimit=configuredClubLimit();
    if(clubLimit&&clubCount>=clubLimit){alert(clubLimitMessage(team,p));return;}
    const econ=teamEconomy(team,p.id);
    if(price>econ.maxNext){alert(`${team.name} può spendere al massimo ${econ.maxNext} crediti sul prossimo giocatore, altrimenti non potrebbe completare la rosa all'offerta minima.`);return;}
  }
  state.sold[p.id]={
    at:previous.at||Date.now(),
    price,
    teamId,
    leagueId:state.league?.id||""
  };
  saveSold();
  fa2AfterAuctionStateChange(wasEdit?"PLAYER_LOST_EDITED":"PLAYER_LOST",p.id,strategyBefore);
  if(!wasEdit)registerBackupRelevantAssignment();
  recordOperation(wasEdit?"MODIFICA_VENDITA":"VENDUTO",wasEdit?`${p.name}: vendita aggiornata a ${price} cr · ${soldTeamName(state.sold[p.id])}`:`${p.name} → ${soldTeamName(state.sold[p.id])} · ${price} cr`,before);
  $("#soldDialog").close();
  soldPlayerId=null;
  finishAuctionActionNavigation();
});

function finalizeRepairPromiseForPurchase(session,acquisitionId){
  const promise=activeRepairPromise(session);if(!promise)return null;
  const purchase=state.purchases[promise.playerId],player=getPlayer(promise.playerId);if(!purchase||!player)return null;
  const release={id:`release_${Date.now()}`,playerId:String(player.id),name:player.name,club:player.club,role:player.role,originalPrice:Number(purchase.price||0),originalPurchase:cloneAuctionData(purchase),refund:Number(promise.refund||0),outOfListone:!!player.outOfListone,viaPromise:true,linkedAcquisitionId:acquisitionId,at:Date.now()};
  session.releases.push(release);session.promisedRelease=null;delete state.purchases[player.id];
  return release;
}
function linkedPromiseRelease(previous){
  if(!previous?.repairSessionId||!previous?.repairPromiseReleaseId)return null;
  const session=repairSessionById(previous.repairSessionId),release=session?.releases?.find(x=>String(x.id)===String(previous.repairPromiseReleaseId));
  return session&&release?{session,release}:null;
}
function promiseRollbackBlocked(previous){
  const linked=linkedPromiseRelease(previous);if(!linked)return false;
  const id=String(linked.release.playerId);return !!state.purchases[id]||!!state.sold[id];
}
function rollbackRepairPromisePurchase(previous){
  const linked=linkedPromiseRelease(previous);if(!linked)return null;
  const {session,release}=linked,id=String(release.playerId);
  state.purchases[id]=cloneAuctionData(release.originalPurchase)||{price:Number(release.originalPrice||0),at:release.at||Date.now()};
  session.releases=session.releases.filter(x=>String(x.id)!==String(release.id));
  session.acquisitions=session.acquisitions.filter(x=>String(x.linkedReleaseId)!==String(release.id));
  return release;
}

function startPurchase(id,returnContext=undefined){
  const p=getPlayer(id);
  if(!p || isSold(p.id)) return;
  const repair=activeRepairSession();
  if(repair?.settings?.preventRebuy&&repairReleasedInActiveSession(p.id)){
    alert(`${p.name} è stato svincolato in questa sessione. Il regolamento impostato ne impedisce il riacquisto da parte tua.`);return;
  }
  if(repairLimitReached(repair)){
    alert(`Hai già completato i ${repair.settings.purchaseLimit} acquisti consentiti in questa sessione di riparazione.`);return;
  }
  const clubLimit=configuredClubLimit();
  const promise=repair?activeRepairPromise(repair):null,promisedId=promise?.playerId||null;
  if(clubLimit&&teamClubCount(mineTeam(),p.club,promisedId)>=clubLimit){
    alert(clubLimitMessage(mineTeam(),p));
    return;
  }
  actionReturnContext=returnContext===undefined?captureActionReturnContext(p.id):returnContext;
  purchaseId=p.id;
  purchaseMode="new";
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Acquista "+playerNameText(p);
  $("#confirmPurchase").textContent="Conferma";
  $("#purchasePrice").min=String(configuredMinBid());$("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  const econ=teamEconomyForPurchase(),live=liveMaxForPlayer(p);
  const guide=fa2StrategyGuidanceForPlayer(p);
  $("#purchaseEconomicInfo").innerHTML=`<span>MAX possibile <b>${fmt(econ.maxNext)}</b></span><span>MAX live <b>${fmt(live.live)}</b></span>${guide?.maxRecommended?`<span>MAX strategico <b>${fmt(guide.maxRecommended)}</b></span>`:""}${guide?.dynamicBudget?`<span>Budget slot <b>${fmt(guide.dynamicBudget)}</b></span>`:""}${promise?`<span>Promessa attiva <b>${esc(promise.name)} · +${fmt(promise.refund)} cr dopo l'acquisto</b></span>`:""}`;
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
}

window.editPurchase=id=>{
  const p=getPlayer(id); if(!p)return;
  actionReturnContext=captureActionReturnContext(p.id);
  purchaseId=p.id;
  purchaseMode="edit";
  const current=state.purchases[p.id];
  $("#playerDialog").close();
  $("#purchaseTitle").textContent="Modifica "+playerNameText(p);
  $("#confirmPurchase").textContent="Salva";
  $("#purchasePrice").min=String(configuredMinBid());$("#purchasePrice").value=current?.price ?? "";
  $("#purchaseSignal").textContent="";
  const econ=teamEconomy(mineTeam(),p.id),live=liveMaxForPlayer(p);
  const guide=fa2StrategyGuidanceForPlayer(p);
  $("#purchaseEconomicInfo").innerHTML=`<span>MAX possibile <b>${fmt(econ.maxNext)}</b></span><span>MAX live <b>${fmt(live.live)}</b></span>${guide?.maxRecommended?`<span>MAX strategico <b>${fmt(guide.maxRecommended)}</b></span>`:""}${guide?.dynamicBudget?`<span>Budget slot <b>${fmt(guide.dynamicBudget)}</b></span>`:""}`;
  $("#purchaseDialog").showModal();
  $("#purchasePrice").focus();
  $("#purchasePrice").select();
};
function cancelPurchaseFlow(){
  if(document.activeElement) document.activeElement.blur();
  const dialog=$("#purchaseDialog");
  if(dialog.open) dialog.close();
  $("#purchasePrice").value="";
  $("#purchaseSignal").textContent="";
  $("#purchaseEconomicInfo").textContent="";
  purchaseId=null;
  purchaseMode="new";
  restoreActionReturnContext();
}
$("#cancelPurchase").addEventListener("click",cancelPurchaseFlow);
$("#purchaseDialog").addEventListener("cancel",e=>{
  e.preventDefault();
  cancelPurchaseFlow();
});

$("#purchaseForm").addEventListener("submit",e=>{
  e.preventDefault();
  const price=Number($("#purchasePrice").value);
  const minBid=configuredMinBid();
  if(!Number.isInteger(price) || price < minBid) return;
  const p=getPlayer(purchaseId);
  if(purchaseMode==="new"&&repairLimitReached()){
    alert(`Hai raggiunto il limite di ${activeRepairSession().settings.purchaseLimit} acquisti per questa sessione di riparazione.`);return;
  }
  if(purchaseMode==="new"&&activeRepairSession()?.settings?.preventRebuy&&repairReleasedInActiveSession(purchaseId)){
    alert(`${p?.name||"Questo giocatore"} non può essere riacquistato nella stessa sessione di riparazione.`);return;
  }
  const clubLimit=configuredClubLimit();
  const repairSession=purchaseMode==="new"?activeRepairSession():null,promisedId=activeRepairPromise(repairSession)?.playerId||null;
  if(purchaseMode==="new" && p && clubLimit&&teamClubCount(mineTeam(),p.club,promisedId)>=clubLimit){
    alert(clubLimitMessage(mineTeam(),p));
    return;
  }
  const econ=purchaseMode==="new"?teamEconomyForPurchase():teamEconomy(mineTeam(),purchaseId);
  if(price>econ.maxNext){alert(`Puoi spendere al massimo ${econ.maxNext} crediti sul prossimo giocatore, conservando ${configuredReservePerSlot()} crediti per ogni slot successivo.`);return;}
  const purchaseGuide=p?fa2StrategyGuidanceForPlayer(p):null,purchaseLive=p?liveMaxForPlayer(p):null;
  const previous=state.purchases[purchaseId];
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates(),wasEdit=purchaseMode==="edit",acquisitionId=!wasEdit&&repairSession?`acquisition_${Date.now()}`:"";
  const completedPromise=!wasEdit&&repairSession?finalizeRepairPromiseForPurchase(repairSession,acquisitionId):null;
  state.purchases[purchaseId]={
    price,
    at: wasEdit && previous?.at ? previous.at : Date.now(),
    ...(wasEdit&&previous?.repairSessionId?{repairSessionId:previous.repairSessionId,...(previous.repairPromiseReleaseId?{repairPromiseReleaseId:previous.repairPromiseReleaseId}:{})}:(!wasEdit&&repairSession?{repairSessionId:repairSession.id,...(completedPromise?{repairPromiseReleaseId:completedPromise.id}:{})}:{}))
  };
  if(!wasEdit&&repairSession)repairSession.acquisitions.push({id:acquisitionId,playerId:String(purchaseId),name:p?.name||"",price,linkedReleaseId:completedPromise?.id||"",limitExempt:repairPendingExemptionCount(repairSession)>0,at:Date.now()});
  save();saveRepairMarket();
  const strategyEvent=fa2AfterAuctionStateChange(wasEdit?"PLAYER_PURCHASE_EDITED":completedPromise?"REPAIR_REPLACEMENT_COMPLETED":"PLAYER_PURCHASED",purchaseId,strategyBefore);
  if(!wasEdit)fa2RememberPurchaseForNextCall(p,price,purchaseGuide,purchaseLive,strategyEvent);
  if(!wasEdit)registerBackupRelevantAssignment();
  if(completedPromise)registerBackupRelevantAssignment();
  recordOperation(wasEdit?"MODIFICA_ACQUISTO":completedPromise?"PROMESSA_COMPLETATA":"ACQUISTO",wasEdit?`${p?.name||"Giocatore"}: ${previous?.price||"—"} → ${price} cr`:completedPromise?`${p?.name||"Giocatore"} acquistato a ${price} cr · ${completedPromise.name} svincolato · +${completedPromise.refund} cr`:`${p?.name||"Giocatore"} acquistato a ${price} cr`,before);
  $("#purchaseDialog").close();
  purchaseId=null;
  purchaseMode="new";
  finishAuctionActionNavigation();
});
window.removePurchase=id=>{
  const p=getPlayer(id),previous=state.purchases[id];if(!previous)return;
  if(promiseRollbackBlocked(previous)){alert("Non puoi annullare automaticamente questo acquisto perché il giocatore svincolato con la promessa è già stato riassegnato. Usa Registro / Undo solo dopo aver verificato i movimenti successivi.");return;}
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
  delete state.purchases[id];
  const restored=rollbackRepairPromisePurchase(previous),session=repairSessionById(previous.repairSessionId);if(!restored&&session)session.acquisitions=session.acquisitions.filter(x=>String(x.playerId)!==String(id));
  save();saveRepairMarket();
  fa2AfterAuctionStateChange("PLAYER_PURCHASE_REMOVED",id,strategyBefore);
  recordOperation("ANNULLA_ACQUISTO",`${p?.name||"Giocatore"}: acquisto ${previous.price} cr annullato${restored?` · ${restored.name} ripristinato in rosa`:""}`,before);
  $("#playerDialog").close();refresh();
}

function undoLastPurchase(){
  const entries=Object.entries(state.purchases);
  if(!entries.length) return;
  const [lastId,lastData]=entries.sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0))[0];
  const p=getPlayer(lastId);
  if(!p) return;
  if(promiseRollbackBlocked(lastData)){alert("Non puoi annullare automaticamente questo acquisto perché il giocatore svincolato con la promessa è già stato riassegnato.");return;}
  if(confirm(`Annullare l'ultimo acquisto?\n\n${p.name} — ${lastData.price} crediti`)){
    const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
    delete state.purchases[lastId];
    const restored=rollbackRepairPromisePurchase(lastData),session=repairSessionById(lastData.repairSessionId);if(!restored&&session)session.acquisitions=session.acquisitions.filter(x=>String(x.playerId)!==String(lastId));
    save();saveRepairMarket();
    fa2AfterAuctionStateChange("PLAYER_PURCHASE_UNDONE",lastId,strategyBefore);
    recordOperation("UNDO_ACQUISTO",`${p.name}: ultimo acquisto ${lastData.price} cr annullato${restored?` · ${restored.name} ripristinato in rosa`:""}`,before);
    refresh();
  }
}

function rosterQuotaByMacro(){
  const rosterTotal=configuredRosterTotal(),porQuota=configuredGoalkeepers();
  const movementQuota=Math.max(0,rosterTotal-porQuota),difQuota=Math.round(movementQuota*8/22),cenQuota=Math.round(movementQuota*7/22);
  return {POR:porQuota,DIF:difQuota,CEN:cenQuota,ATT:Math.max(0,movementQuota-difQuota-cenQuota)};
}

function rosterFormationGroupsHTML(items,{quota=null}={}){
  const groups=["POR","DIF","CEN","ATT"],labels={POR:"Portieri",DIF:"Difensori",CEN:"Centrocampisti",ATT:"Attaccanti"};
  return `<div class="roster-formation-groups">${groups.map(rep=>{
    const rows=items.filter(item=>fa2LineupNaturalMacro(item.p)===rep),spentValue=rows.reduce((sum,item)=>sum+Number(item.price||0),0);
    const countText=quota?`${rows.length}/${quota[rep]}`:`${rows.length}`;
    const content=rows.length?rows.map(item=>{
      const p=item.p,price=Number(item.price||0);
      return `<button type="button" class="roster-formation-row roster-${rep.toLowerCase()} ${p.outOfListone?"out-of-listone":""}" aria-label="Apri ${escAttr(playerNameText(p))}, ${p.role}, ${p.club}, acquistato a ${fmt(price)} crediti" onclick='openPlayer(${idArg(p.id)})'>
        ${mantraRoleChipHTML(p.role,"roster-mantra-role mantra-role-chip")}
        <span class="roster-player-copy"><b>${playerNameHTML(p)}</b><small>${esc(p.club)} · Serie A${p.outOfListone?" · FUORI LISTONE":""}</small></span>
        <span class="roster-player-price"><b>${price?fmt(price):"—"} cr</b><small>acquisto</small><i aria-hidden="true">›</i></span>
      </button>`;
    }).join(""):'<div class="roster-formation-empty">Nessun giocatore acquistato</div>';
    return `<section class="roster-formation-group roster-${rep.toLowerCase()}">
      <header><span><b>${rep}</b><small>${labels[rep]}</small></span><strong>${countText} · ${fmt(spentValue)} cr</strong></header>
      <div>${content}</div>
    </section>`;
  }).join("")}</div>`;
}

/* A5.9.2 — Formazione consigliata pre-partita.
   È separata dalla Strategia d'asta: usa soltanto la rosa posseduta e non
   modifica acquisti, modulo salvato, crediti o sessioni di riparazione. */
const FA2_RECOMMENDED_LINEUP_MODULE_STORAGE="fa2_recommended_lineup_module_v1";
function fa2RecommendedLineupModuleOptions(){
  const profile=window.FA2Strategy?.loadProfile?.()||{},ids=[profile.primary,profile.secondary].filter(Boolean),seen=new Set();
  const modules=ids.map(id=>window.FA2Strategy?.moduleById?.(id)).filter(module=>module?.slots?.length===11&&!seen.has(module.id)&&seen.add(module.id));
  if(!modules.length){const legacy=activeStrategy();modules.push({id:state.strategy,name:legacy.module,slots:legacy.slots.map(slot=>slot.roles)})}
  return {profile,modules};
}
function fa2RecommendedLineupModule(){
  const {profile,modules}=fa2RecommendedLineupModuleOptions(),saved=localStorage.getItem(FA2_RECOMMENDED_LINEUP_MODULE_STORAGE),modern=modules.find(module=>String(module.id)===String(saved))||modules.find(module=>String(module.id)===String(profile.primary))||modules[0];
  return {id:modern.id,name:modern.name,slots:modern.slots.map(roles=>({roles:[...roles],label:roles.join("/")}))};
}
function fa2SetRecommendedLineupModule(moduleId){
  const allowed=fa2RecommendedLineupModuleOptions().modules.some(module=>String(module.id)===String(moduleId));if(!allowed)return;
  localStorage.setItem(FA2_RECOMMENDED_LINEUP_MODULE_STORAGE,String(moduleId));renderSquad();
}
window.fa2SetRecommendedLineupModule=fa2SetRecommendedLineupModule;
function fa2RecommendedLineupModuleSwitchHTML(){
  const {profile,modules}=fa2RecommendedLineupModuleOptions(),active=fa2RecommendedLineupModule().id;
  return `<div class="hybrid-squad-strategy fa2-lineup-module-switch" role="group" aria-label="Modulo della formazione consigliata">${modules.map((module,index)=>`<button type="button" class="${String(active)===String(module.id)?"active":""}" aria-pressed="${String(active)===String(module.id)?"true":"false"}" onclick="fa2SetRecommendedLineupModule('${escAttr(module.id)}')"><i>${index+1}</i><span>${String(module.id)===String(profile.primary)?"Modulo principale":"Modulo alternativo"}<b>${esc(module.name)}</b></span></button>`).join("")}</div>`;
}
function fa2LineupNaturalMacro(p){
  const reparto=String(p?.reparto||"").toUpperCase();return ["POR","DIF","CEN","ATT"].includes(reparto)?reparto:playerAuctionPhase(p);
}
function fa2RecommendedLineupMetric(p,owned=purchasedPlayers()){
  const starter=starterProbability(p),availability=availabilityPlayerMeta(p.name,p.club),intelligence=window.FA2PlayerIntelligence?.get?.(p)||null;
  const hasStatistics=Number(intelligence?.score)>0,history=hasStatistics?clamp(Number(intelligence.score),0,100):null,reliability=clamp(Number(intelligence?.reliability)||0,0,100),trend=hasStatistics?clamp(50+(Number(intelligence?.trend)||0)*2,0,100):null;
  const phase=fa2LineupNaturalMacro(p),phaseMax=Math.max(1,...owned.filter(x=>fa2LineupNaturalMacro(x)===phase).map(x=>Number(x.fvm)||0)),fvmScore=clamp(100*Math.max(0,Number(p.fvm)||0)/phaseMax,0,100);
  const unavailable=!!(availability.injury||availability.isSuspended||p.outOfListone),probability=unavailable?0:clamp(Number(starter.prob)||0,0,100);
  const components=[hasStatistics&&{value:history,weight:45},{value:fvmScore,weight:35},{value:probability,weight:15},hasStatistics&&{value:trend,weight:5}].filter(Boolean),weight=components.reduce((sum,row)=>sum+row.weight,0)||1;
  const score=Math.round(clamp(components.reduce((sum,row)=>sum+row.value*row.weight,0)/weight,0,100));
  const confidence=Math.round(clamp((starter.source==="live"?55:starter.source==="base"?37:24)+(intelligence?reliability*.35:0)+(availabilityFeedValid()?10:0),0,100));
  const recovery=availability.injury?.recovery||availability.injury?.detail||"";
  const status=p.outOfListone?"FUORI LISTONE":availability.injury?"INFORTUNATO":availability.isSuspended?"SQUALIFICATO":starterStatus(probability).label;
  const statusClass=p.outOfListone||availability.injury||availability.isSuspended?"out":probability>=70?"sure":probability>=50?"battle":"risk";
  return {p,score,probability,history:hasStatistics?Math.round(history):null,reliability:Math.round(reliability),trend:hasStatistics?Math.round(trend):null,fvmScore:Math.round(fvmScore),confidence,unavailable,status,statusClass,recovery,warned:availability.isWarned,availability,intelligence,hasStatistics,starterSource:starter.source};
}
function fa2BuildRecommendedLineup(module=fa2RecommendedLineupModule(),owned=purchasedPlayers(),metricsFor=null){
  const metric=typeof metricsFor==="function"?metricsFor:p=>fa2RecommendedLineupMetric(p,owned),metrics=new Map(owned.map(p=>[String(p.id),metric(p)])),slots=module?.slots||[],size=1<<slots.length;
  let dp=new Map([[0,{value:0,assign:Array(slots.length).fill(null)}]]);
  for(const p of owned){
    const row=metrics.get(String(p.id));if(!row||row.unavailable)continue;
    const next=new Map(dp);
    for(const [mask,data] of dp){
      for(let i=0;i<slots.length;i++){
        if(mask&(1<<i)||!slotCompatible(p,slots[i]))continue;
        const nextMask=mask|(1<<i),nextValue=data.value+10000+row.score*10+row.confidence;
        if(!next.has(nextMask)||nextValue>next.get(nextMask).value){const assign=data.assign.slice();assign[i]=p;next.set(nextMask,{value:nextValue,assign})}
      }
    }
    dp=next;
  }
  let best={mask:0,value:0,assign:Array(slots.length).fill(null)};
  for(const [mask,data] of dp){const filled=mask.toString(2).split("1").length-1,bestFilled=best.mask.toString(2).split("1").length-1;if(filled>bestFilled||(filled===bestFilled&&data.value>best.value))best={mask,value:data.value,assign:data.assign}}
  const starters=best.assign.map((p,index)=>p?{p,slot:slots[index],metric:metrics.get(String(p.id)),index,line:window.FA2MantraRules?.slotLine?.(module?.name,index)||fa2LineupNaturalMacro(p)}:null).filter(Boolean),starterIds=new Set(starters.map(row=>String(row.p.id)));
  const bench=owned.filter(p=>!starterIds.has(String(p.id))).map(p=>({p,metric:metrics.get(String(p.id))})).sort((a,b)=>Number(a.metric.unavailable)-Number(b.metric.unavailable)||b.metric.score-a.metric.score||b.metric.probability-a.metric.probability);
  starters.forEach(row=>{
    if(row.metric.probability>=70)return;
    row.alternative=bench.filter(candidate=>!candidate.metric.unavailable&&slotCompatible(candidate.p,row.slot)&&candidate.metric.probability>row.metric.probability).sort((a,b)=>b.metric.probability-a.metric.probability||b.metric.score-a.metric.score||Number(b.p.fvm||0)-Number(a.p.fvm||0))[0]||null;
  });
  const eligibleStarters=starters.filter(row=>!row.metric.unavailable),averageProbability=eligibleStarters.length?Math.round(eligibleStarters.reduce((sum,row)=>sum+row.metric.probability,0)/eligibleStarters.length):0,averageConfidence=eligibleStarters.length?Math.round(eligibleStarters.reduce((sum,row)=>sum+row.metric.confidence,0)/eligibleStarters.length):0;
  return {module,slots,metrics,best,starters,bench,filled:starters.length,total:slots.length,averageProbability,averageConfidence,doubts:starters.filter(row=>row.metric.probability<55).length,unavailable:owned.filter(p=>metrics.get(String(p.id))?.unavailable).length};
}
function fa2RecommendedLineupSourcesHTML(result){
  const formationDate=formationFeedValid(formationsLiveFeed)?formationDisplayDate(formationsLiveFeed.generatedAt):"base locale",availabilityDate=availabilityFeedValid()?formationDisplayDate(availabilityLiveFeed.generatedAt):"non sincronizzata";
  const historyCount=[...result.metrics.values()].filter(row=>row.intelligence).length;
  return `<div class="fa2-lineup-sources"><span>Probabili formazioni <b>${esc(formationDate)}</b></span><span>Disponibilità <b>${esc(availabilityDate)}</b></span><span>Storico verificato <b>${historyCount}/${result.metrics.size}</b></span></div>`;
}
function fa2RecommendedLineupHTML(){
  const result=fa2BuildRecommendedLineup(),allGroups=["POR","DIF","CEN","TRQ","ATT"],groups=allGroups.filter(group=>result.starters.some(row=>row.line===group)),labels={POR:"Portieri",DIF:"Difensori",CEN:"Centrocampisti",TRQ:"Trequarti",ATT:"Attaccanti"},reg=currentRegulation(),benchSize=Math.max(1,Number(reg?.bench?.size)||7),alternatives=result.bench.slice(0,benchSize);
  const rowsByGroup=group=>result.starters.filter(row=>row.line===group).map(row=>{const m=row.metric,alt=row.alternative,slotRole=row.slot?.roles||row.slot?.label;return `<article class="fa2-lineup-entry"><button type="button" class="fa2-lineup-row" onclick='openPlayer(${idArg(row.p.id)})' aria-label="Apri ${escAttr(row.p.name)}, schierato nello slot ${escAttr(mantraRoleDisplay(slotRole))}, ruoli ${escAttr(mantraRoleDisplay(row.p.role))}, probabilità ${m.probability} per cento">${mantraRoleChipHTML(slotRole,"fa2-lineup-role mantra-role-chip")}<span class="fa2-lineup-player"><b>${esc(row.p.name)}</b><small>${esc(row.p.club)} · ruoli ${esc(mantraRoleDisplay(row.p.role))}${m.warned?" · DIFFIDATO":""}</small></span><span class="fa2-lineup-score"><b>VAL ${m.score}</b><small>tit. ${m.probability}%</small></span><em class="${m.statusClass}">${esc(m.status)}</em><i aria-hidden="true">›</i></button>${alt?`<button type="button" class="fa2-lineup-direct-alt" onclick='openPlayer(${idArg(alt.p.id)})' aria-label="Apri alternativa ${escAttr(alt.p.name)}, ruoli ${escAttr(mantraRoleDisplay(alt.p.role))}, titolarità ${alt.metric.probability} per cento"><span aria-hidden="true">↳</span><small>ALTERNATIVA PIÙ TITOLARE</small><b>${esc(alt.p.name)}</b><em>${esc(mantraRoleDisplay(alt.p.role))}</em><strong>${alt.metric.probability}%</strong></button>`:""}</article>`}).join("");
  const unavailable=[...result.metrics.values()].filter(row=>row.unavailable);
  return `<section class="fa2-recommended-lineup"><header><div><span>FORMAZIONE CONSIGLIATA · A6.1.0</span><b>${esc(result.module.name)}</b><small>Miglior XI compatibile con il modulo selezionato sopra</small></div><button type="button" class="ghost" onclick="openLocalDataCenter()">Gestisci dati</button></header><div class="fa2-lineup-kpis"><div><span>XI COPERTO</span><b>${result.filled}/${result.total}</b></div><div><span>PROBABILITÀ MEDIA</span><b>${result.averageProbability}%</b></div><div><span>AFFIDABILITÀ</span><b>${result.averageConfidence}%</b></div><div><span>DA VERIFICARE</span><b>${result.doubts}</b></div></div>${fa2RecommendedLineupSourcesHTML(result)}<details open><summary><span>XI consigliato</span><b>${result.filled===result.total?"PRONTO":"INCOMPLETO"}</b><i aria-hidden="true">⌄</i></summary><div class="fa2-lineup-body">${groups.map(group=>`<section class="fa2-lineup-group fa2-${group.toLowerCase()}"><h3><b>${group}</b><span>${labels[group]}</span></h3>${rowsByGroup(group)||'<div class="fa2-lineup-empty">Nessun giocatore compatibile disponibile</div>'}</section>`).join("")}</div></details><details><summary><span>Prime alternative</span><b>${alternatives.length}</b><i aria-hidden="true">⌄</i></summary><div class="fa2-lineup-bench">${alternatives.map(({p,metric:m})=>`<button type="button" onclick='openPlayer(${idArg(p.id)})'><span><b>${esc(p.name)}</b><small>${esc(p.club)} · ${esc(mantraRoleDisplay(p.role))}</small></span><strong>${m.unavailable?esc(m.status):m.probability+"%"}</strong></button>`).join("")||'<div class="fa2-lineup-empty">Nessuna alternativa disponibile</div>'}</div></details>${unavailable.length?`<div class="fa2-lineup-alert"><b>NON SCHIERABILI ORA</b><span>${unavailable.map(row=>`${esc(row.p.name)} · ${esc(row.status)}${row.recovery?` · ${esc(row.recovery)}`:""}`).join("<br>")}</span></div>`:""}<p class="fa2-lineup-note">Ogni giocatore è mostrato nella linea dello slot realmente occupato nel modulo; sotto il nome restano visibili tutti i suoi ruoli Mantra. Ordine della scelta: statistiche storiche e rendimento, FVM, poi probabilità di titolarità e trend. Infortunati, squalificati e fuori listone sono esclusi; i diffidati restano selezionabili. Un titolare di valore con probabilità sotto il 70% resta nell’XI e, quando esiste, mostra subito l’alternativa compatibile più probabile.</p></section>`;
}
async function fa2RefreshRecommendedLineup(button){
  if(button){button.disabled=true;button.textContent="Aggiorno…"}
  await Promise.all([refreshFormationsLiveInternal({manual:false}),refreshAvailabilityLiveInternal({manual:false}),window.FA2PlayerIntelligence?.refresh?.({manual:true})]);
  renderSquad();
}
window.fa2RefreshRecommendedLineup=fa2RefreshRecommendedLineup;

function renderSquad(){
  const b=purchasedPlayers(),reg=currentRegulation(),rosterTotal=configuredRosterTotal();
  const econ=teamEconomy(mineTeam());
  const byRep={POR:0,DIF:0,CEN:0,ATT:0};
  b.forEach(p=>byRep[p.reparto]+=Number(state.purchases[p.id]?.price||0));
  const quota=rosterQuotaByMacro();
  const outOfListoneOwned=b.filter(p=>p.outOfListone).length;
  $("#squadView").innerHTML=`
    <div class="hybrid-page-head"><div><div class="eyebrow">La tua rosa</div><h2>Rosa ${reg.gameMode==="classic"?"Classic":"Mantra"}</h2></div><span>${rosterTotal} posti</span></div>
    <div class="hybrid-squad-kpis">
      <div><span>Speso</span><b>${fmt(econ.spent)}</b></div><div><span>Residuo</span><b>${fmt(econ.remaining)}</b></div><div><span>Posti</span><b>${b.length}/${rosterTotal}</b></div><div><span>MAX prossimo</span><b>${fmt(econ.maxNext)}</b></div>
    </div>
    <div class="hybrid-squad-reps">${["POR","DIF","CEN","ATT"].map(rep=>`<div><span>${rep}</span><b>${fmt(byRep[rep])}</b></div>`).join("")}</div>
    <div class="card local-only-note"><b>ROSA REGISTRATA</b><p>La rosa mostra esclusivamente acquisti, prezzi, ruoli e vincoli ricavati dal Listone importato e dalle operazioni inserite nell'app.</p></div>
    ${outOfListoneOwned?`<div class="out-listone-roster-legend"><b>* Fuori listone</b><span>${outOfListoneOwned} ${outOfListoneOwned===1?"giocatore da gestire":"giocatori da gestire"} nell'asta di riparazione</span></div>`:""}
    ${rosterFormationGroupsHTML(b.map(p=>({p,price:Number(state.purchases[p.id]?.price||0)})),{quota})}`;
}
function renderPlan(targetSelector="#dashboardPlanContent"){
  const target=$(targetSelector);if(!target)return;
  const bought=purchasedPlayers();
  const st=activeStrategy();
  const rec=strategyRecommendation(bought,getAuctionIntel());
  const lineup=bestLineupMatch(st,bought);
  const poolByRep={POR:0,DIF:0,CEN:0,ATT:0};
  const strategicNow=currentStrategicPlayers().filter(p=>!p.outOfListone);
  strategicNow.forEach(p=>poolByRep[p.reparto]=(poolByRep[p.reparto]||0)+1);
  const movement=strategicNow.length-poolByRep.POR;

  const roleCounts={};
  ["Por","Ds","Dc","Dd","B","E","M","C","W","T","A","Pc"].forEach(r=>{
    roleCounts[r]=allPlayers.filter(p=>roleTokens(p.role).includes(r)).length;
  });

  const strategyBudgets=scaledStrategyBudgets(st),budgetText=Object.values(strategyBudgets).map(fmt).join(" · ");

  target.innerHTML=`
    <div class="section-title"><h2>Doppia strategia Mantra</h2></div>

    <div class="strategy-plan-card">
      <div class="strategy-plan-head">
        <div><span>Strategia attiva</span><strong>${state.strategy} · ${st.module}</strong></div>
        <div class="strategy-plan-score">${state.strategy==="A"?rec.A.score:rec.B.score}/100</div>
      </div>
      <div class="strategy-buttons">
        <button type="button" class="strategy-btn ${state.strategy==="A"?"active":""}" aria-pressed="${state.strategy==="A"?"true":"false"}" onclick="setStrategy('A')"><b>A</b><span>4-3-1-2</span></button>
        <button type="button" class="strategy-btn ${state.strategy==="B"?"active":""}" aria-pressed="${state.strategy==="B"?"true":"false"}" onclick="setStrategy('B')"><b>B</b><span>4-3-3</span></button>
      </div>
      <div class="strategy-reason"><b>${rec.headline}</b><br>${rec.reason}</div>
    </div>

    <div class="section-title"><h2>Confronto copertura</h2></div>
    <div class="grid strategy-compare-grid">
      <div class="card metric ${rec.recommended==="A"?"strategy-best":""}">
        <span>A · 4-3-1-2</span><strong>${rec.A.score}</strong>
        <span>XI ${rec.A.full.filled}/11 · mercato ${Math.round(rec.A.market.value*100)}%</span>
      </div>
      <div class="card metric ${rec.recommended==="B"?"strategy-best":""}">
        <span>B · 4-3-3</span><strong>${rec.B.score}</strong>
        <span>XI ${rec.B.full.filled}/11 · mercato ${Math.round(rec.B.market.value*100)}%</span>
      </div>
    </div>

    <div class="section-title"><h2>Budget ${state.strategy}</h2></div>
    <div class="card">
      <div class="line"><span>POR</span><b>${fmt(strategyBudgets.POR)}</b></div>
      <div class="line"><span>DIF</span><b>${fmt(strategyBudgets.DIF)}</b></div>
      <div class="line"><span>CEN / trequarti</span><b>${fmt(strategyBudgets.CEN)}</b></div>
      <div class="line"><span>ATT</span><b>${fmt(strategyBudgets.ATT)}</b></div>
      <div class="line"><span>Totale</span><b>${fmt(configuredBudget())}</b></div>
    </div>

    <div class="section-title"><h2>Priorità ${st.module}</h2></div>
    <div class="card">
      <div class="line"><span>Difesa</span><b>Dd · Dc · Dc · Ds</b></div>
      <div class="line"><span>Centrocampo</span><b>M/C · M · C</b></div>
      <div class="line"><span>Zona offensiva</span><b>${st.priority}</b></div>
      <div class="line"><span>Profondità target</span><b>${st.depth}</b></div>
      <div class="line"><span>Struttura rosa</span><b>${configuredGoalkeepers()} POR · ${Math.max(0,configuredRosterTotal()-configuredGoalkeepers())} movimento</b></div>
    </div>

    <div class="section-title"><h2>XI coperto dalla tua rosa</h2><span class="muted">${lineup.filled}/11</span></div>
    <div class="card">
      ${st.slots.map((slot,i)=>`<div class="line"><span>${slot.label}</span><b>${lineup.assign[i]?lineup.assign[i].name:"— manca copertura —"}</b></div>`).join("")}
    </div>

    <div class="section-title"><h2>Bacino strategico</h2></div>
    <div class="grid">
      <div class="card metric"><span>Analisi iniziale</span><strong>${configuredParticipants()*configuredRosterTotal()}</strong><span>${configuredParticipants()} squadre × ${configuredRosterTotal()}</span></div>
      <div class="card metric"><span>Portieri</span><strong>${configuredParticipants()*configuredGoalkeepers()}</strong><span>${configuredGoalkeepers()} × ${configuredParticipants()}</span></div>
      <div class="card metric"><span>Movimento</span><strong>${configuredParticipants()*Math.max(0,configuredRosterTotal()-configuredGoalkeepers())}</strong><span>bacino massimo</span></div>
      <div class="card metric"><span>Listone algoritmo</span><strong>${allPlayers.length}</strong><span>universo mercato</span></div>
    </div>

    <div class="section-title"><h2>Distribuzione offensivi principali</h2></div>
    <div class="card">
      <div class="line"><span>W principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="W").length}</b></div>
      <div class="line"><span>T principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="T").length}</b></div>
      <div class="line"><span>A principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="A").length}</b></div>
      <div class="line"><span>Pc principali</span><b>${strategicNow.filter(p=>primaryOffensiveRole(p)==="Pc").length}</b></div>
      <div class="line"><span>T compatibili totali</span><b>${roleCounts.T||0}</b></div>
    </div>

    <div class="section-title"><h2>Mercato residuo completo</h2></div>
    <div class="card">
      ${["T","W","A","Pc","Dd","Ds","Dc"].map(r=>{
        const all=marketEligiblePlayers([r]);
        const rem=all.filter(p=>!state.purchases[p.id]&&!state.sold[p.id]);
        const qualityAll=all.reduce((s,p)=>s+playerQuality(p),0);
        const qualityRem=rem.reduce((s,p)=>s+playerQuality(p),0);
        const qPct=qualityAll?Math.round(qualityRem/qualityAll*100):0;
        return `<div class="line"><span>${r}</span><b>${rem.length}/${all.length} · qualità ${qPct}%</b></div>`;
      }).join("")}
    </div>

    <p class="install-note" style="margin-top:12px">
      L'indice confronta copertura dell'XI, slot offensivi distintivi, profondità, qualità e mercato residuo. Nella v1.25 aggiunge anche scarsità, inflazione e pressione prevista degli avversari sui ruoli chiave. Il bottone A/B resta sempre manuale.
    </p>`;
}
function createLeague(){
  $("#leagueNameInput").value="";
  $("#leagueSizeInput").value="8";
  $("#leagueDialog").showModal();
  $("#leagueNameInput").focus();
}
window.createLeague=createLeague;

/* Alpha 5.2 / 5.2.1 — import/export rose Fantacalcio CSV.
   Il file esportato da Leghe Fantacalcio contiene squadra, ID profilo
   ufficiale e prezzo. L'import usa l'ID del profilo presente nel Listone
   validato: nessun fuzzy matching e nessuna seconda fonte di verità. */
let fa2PendingRosterCsvImport=null;
let fa2PendingRosterCsvExport=null;

function fa2CsvRows(text){
  const source=String(text||"").replace(/^\uFEFF/,"");
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){
      if(ch==='"'){
        if(source[i+1]==='"'){cell+='"';i++}else quoted=false;
      }else cell+=ch;
      continue;
    }
    if(ch==='"'&&cell===""){quoted=true;continue}
    if(ch===","){row.push(cell);cell="";continue}
    if(ch==="\n"){
      row.push(cell);rows.push(row);row=[];cell="";continue;
    }
    if(ch!=="\r")cell+=ch;
  }
  if(quoted)throw new Error("CSV non valido: virgolette non chiuse.");
  if(cell!==""||row.length){row.push(cell);rows.push(row)}
  return rows;
}

function fa2ParseFantacalcioRosterCsv(text){
  const groups=new Map(),players=[],seenIds=new Set(),errors=[];
  const rawRows=fa2CsvRows(text);
  let meaningful=0;
  rawRows.forEach((raw,index)=>{
    const cells=raw.map(value=>String(value??"").trim());
    if(!cells.some(Boolean))return;
    if(cells.every(value=>value==="$"||value===""))return;
    meaningful++;
    const [teamName,officialId,priceRaw,...extra]=cells;
    const header=meaningful===1&&!/^\d+$/.test(officialId||"")&&/(squad|team|rosa)/i.test(teamName||"");
    if(header)return;
    if(!teamName||!/^\d+$/.test(officialId||"")||!/^[0-9]+$/.test(priceRaw||"")||extra.some(Boolean)){
      errors.push(`Riga ${index+1}: attesi squadra, ID giocatore e prezzo.`);return;
    }
    const price=Number(priceRaw),minBid=configuredMinBid();
    if(!Number.isSafeInteger(price)||price<minBid){errors.push(`Riga ${index+1}: prezzo non valido per ${teamName}.`);return}
    if(seenIds.has(officialId)){errors.push(`Riga ${index+1}: ID giocatore ${officialId} duplicato.`);return}
    seenIds.add(officialId);
    const normalized=normalizePlayerName(teamName);
    if(!normalized){errors.push(`Riga ${index+1}: nome squadra non valido.`);return}
    if(!groups.has(normalized))groups.set(normalized,{key:String(groups.size),name:teamName,rows:[],spent:0});
    const team=groups.get(normalized),entry={teamKey:team.key,teamName:team.name,officialId,price,row:index+1};
    team.rows.push(entry);team.spent+=price;players.push(entry);
  });
  if(errors.length)throw new Error(errors.slice(0,5).join("\n"));
  const teams=[...groups.values()],rosterTotal=configuredRosterTotal(),budget=configuredBudget();
  if(teams.length<4||teams.length>20)throw new Error(`CSV non valido: trovate ${teams.length} squadre (consentite 4–20).`);
  if(!players.length)throw new Error("CSV non valido: nessuna assegnazione trovata.");
  teams.forEach(team=>{
    if(team.rows.length>rosterTotal)throw new Error(`${team.name}: ${team.rows.length} giocatori, oltre i ${rosterTotal} previsti dal regolamento.`);
    if(team.spent>budget)throw new Error(`${team.name}: spesa ${team.spent} superiore al budget configurato di ${budget} crediti.`);
  });
  return {teams,players,totalPlayers:players.length,sourceRows:rawRows.length};
}
window.fa2ParseFantacalcioRosterCsv=fa2ParseFantacalcioRosterCsv;

function fa2OfficialRosterId(player){
  const explicit=String(player?.officialId||"").trim();
  if(/^\d+$/.test(explicit))return explicit;
  const url=String(player?.profileUrl||"").replace(/\/+$/,"");
  const match=url.match(/\/(\d+)$/);
  return match?match[1]:"";
}

async function fa2RosterImportSnapshot(){
  if(syncSnapshotValid(appliedListoneSync))return appliedListoneSync;
  throw new Error("Listone locale non disponibile. Importa prima il file JSON dalla sezione Giocatori.");
}

function fa2ResolveRosterCsv(parsed,snapshot){
  const byOfficialId=new Map(),basePlayers=basePlayerMap();
  (snapshot.players||[]).forEach(player=>{
    const officialId=fa2OfficialRosterId(player);
    if(officialId&&!byOfficialId.has(officialId))byOfficialId.set(officialId,player);
  });
  const missing=[],internalIds=new Set(),clubLimit=configuredClubLimit();
  const teams=parsed.teams.map(team=>{
    const clubCounts={};
    const rows=team.rows.map(row=>{
      const player=byOfficialId.get(row.officialId);
      if(!player){const unresolved={...row,player:null,internalId:localPlayerId(`official|${row.officialId}`),unresolved:true};missing.push(unresolved);return unresolved}
      const key=player.key||normalizePlayerName(player.name),internalId=String(basePlayers.get(key)?.id??player.id??`fc_${key}`);
      if(internalIds.has(internalId))throw new Error(`Il Listone collega più righe allo stesso giocatore: ${player.name}.`);
      internalIds.add(internalId);clubCounts[player.club]=(clubCounts[player.club]||0)+1;
      return {...row,player,internalId};
    });
    const clubViolation=clubLimit?Object.entries(clubCounts).find(([,count])=>count>clubLimit):null;
    if(clubViolation)throw new Error(`${team.name}: ${clubViolation[1]} giocatori ${clubViolation[0]}, oltre il limite di ${clubLimit}. Verifica il Regolamento Lega.`);
    return {...team,rows,remaining:configuredBudget()-team.spent};
  });
  return {teams,totalPlayers:parsed.totalPlayers,matched:parsed.totalPlayers-missing.length,missing:missing.length,missingRows:missing,snapshot};
}

function fa2ReadTextFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error("Il file non può essere letto."));
    reader.readAsText(file);
  });
}

function fa2OpenRosterImportDialog(html){
  $("#rosterImportDialogContent").innerHTML=html;
  const dialog=$("#rosterImportDialog");if(!dialog.open)dialog.showModal();
}
function closeRosterImportDialog(){
  fa2PendingRosterCsvImport=null;
  fa2PendingRosterCsvExport=null;
  const input=$("#leagueRosterCsvInput");if(input)input.value="";
  const dialog=$("#rosterImportDialog");if(dialog?.open)dialog.close();
}
window.closeRosterImportDialog=closeRosterImportDialog;

function fa2RosterImportLeagueName(fileName){
  if(state.league?.name)return state.league.name;
  const cleaned=String(fileName||"").replace(/^'+/,"").replace(/\.csv$/i,"").replace(/_rosters?_\d+$/i,"").replace(/[-_]+/g," ").trim();
  return !cleaned||/senza nome|lega fantacalcio/i.test(cleaned)?"Lega Fantacalcio":cleaned.slice(0,40);
}

function fa2RosterImportCurrentDiff(ownKey){
  if(!fa2PendingRosterCsvImport||ownKey==="")return null;
  const intended=new Map();
  fa2PendingRosterCsvImport.resolved.teams.forEach(team=>team.rows.forEach(row=>intended.set(row.internalId,{mine:team.key===ownKey,teamName:team.name,price:row.price})));
  let added=0,changed=0,unchanged=0;
  intended.forEach((next,id)=>{
    const own=state.purchases?.[id],sale=state.sold?.[id];
    if(!own&&!sale){added++;return}
    const sameOwner=next.mine?!!own:!!sale&&normalizePlayerName(soldTeamName(sale))===normalizePlayerName(next.teamName);
    const currentPrice=Number((own||sale)?.price||0);
    if(sameOwner&&currentPrice===next.price)unchanged++;else changed++;
  });
  const currentIds=new Set([...Object.keys(state.purchases||{}),...Object.keys(state.sold||{})]);
  let removed=0;currentIds.forEach(id=>{if(!intended.has(String(id)))removed++});
  return {added,changed,unchanged,removed};
}

function fa2MissingRosterFieldsValid(){
  if(!fa2PendingRosterCsvImport)return false;
  return fa2PendingRosterCsvImport.resolved.missingRows.every((row,index)=>{
    const name=localField($(`#rosterMissingName${index}`)?.value,80),club=localField($(`#rosterMissingClub${index}`)?.value,24).toUpperCase(),role=normalizeMantraRoleInput($(`#rosterMissingRole${index}`)?.value);
    return !!name&&!!club&&validMantraRole(role);
  });
}

function fa2MissingRosterPlayersHTML(resolved){
  if(!resolved.missingRows.length)return "";
  return `<section class="roster-import-missing"><header><b>${resolved.missingRows.length} FUORI LISTONE DA COMPLETARE</b><span>Il CSV delle rose contiene solo ID e prezzo. Inserisci i dati minimi per conservarli correttamente nello storico.</span></header>${resolved.missingRows.map((row,index)=>`<fieldset><legend>${esc(row.teamName)} · ID ${esc(row.officialId)} · ${fmt(row.price)} cr</legend><label>Nome giocatore<input id="rosterMissingName${index}" data-roster-missing required maxlength="80" autocomplete="off" placeholder="Nome"></label><label>Club<input id="rosterMissingClub${index}" data-roster-missing required maxlength="24" autocapitalize="characters" placeholder="Es. JUV"></label><label>Ruolo Mantra<input id="rosterMissingRole${index}" data-roster-missing required maxlength="30" autocapitalize="characters" placeholder="Es. Por oppure Ds/E"></label></fieldset>`).join("")}</section>`;
}

function fa2RosterImportDiffHTML(ownKey){
  const diff=fa2RosterImportCurrentDiff(ownKey);
  if(!diff)return '<span>Seleziona la tua squadra per calcolare le differenze con i dati presenti.</span>';
  return `<div><b>${diff.added}</b><span>nuovi</span></div><div><b>${diff.changed}</b><span>aggiornati</span></div><div><b>${diff.unchanged}</b><span>invariati</span></div><div class="${diff.removed?"warn":""}"><b>${diff.removed}</b><span>non nel CSV</span></div>`;
}

function fa2UpdateRosterImportSelection(){
  const select=$("#rosterImportMine"),button=$("#applyRosterImportBtn"),diff=$("#rosterImportDiff");
  const ownKey=select?.value??"";
  if(button)button.disabled=ownKey===""||!fa2MissingRosterFieldsValid();
  if(diff)diff.innerHTML=fa2RosterImportDiffHTML(ownKey);
  $$('[data-roster-import-team]').forEach(row=>row.classList.toggle("mine",row.dataset.rosterImportTeam===ownKey));
}

function fa2RosterImportPreviewHTML(pending){
  const {resolved,fileName}=pending,budget=configuredBudget(),rosterTotal=configuredRosterTotal();
  const existingMine=normalizePlayerName(state.league?.teams?.find(team=>team.isMine)?.name||"");
  const existingMatch=resolved.teams.find(team=>normalizePlayerName(team.name)===existingMine)?.key??"";
  const complete=resolved.teams.every(team=>team.rows.length===rosterTotal);
  return `<div class="dialog-body roster-import-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">CSV ROSE · A6.1.0</div><h2>Anteprima rose</h2></div><button class="ghost" type="button" aria-label="Chiudi anteprima rose" onclick="closeRosterImportDialog()">✕</button></div>
    <div class="roster-import-file"><span>${esc(fileName)}</span><b>${resolved.teams.length} squadre riconosciute · ${resolved.totalPlayers} giocatori</b><small>${resolved.matched}/${resolved.totalPlayers} ID collegati automaticamente${resolved.missing?` · ${resolved.missing} fuori listone`:""}</small></div>
    <form id="rosterImportForm">
      <div class="roster-import-fields"><label>Nome lega<input id="rosterImportLeagueName" maxlength="40" value="${escAttr(fa2RosterImportLeagueName(fileName))}" required></label><label>La mia squadra<select id="rosterImportMine" required><option value="">Seleziona…</option>${resolved.teams.map(team=>`<option value="${escAttr(team.key)}" ${team.key===existingMatch?"selected":""}>${esc(team.name)}</option>`).join("")}</select></label></div>
      <div class="roster-import-regulation"><b>Regolamento attivo: ${budget} crediti · rosa ${rosterTotal}</b><span>Il CSV contiene i prezzi, ma non il budget iniziale. Residui e MAX vengono calcolati dal Regolamento Lega.</span></div>
      <div class="roster-import-team-list">${resolved.teams.map(team=>`<div class="roster-import-team" data-roster-import-team="${escAttr(team.key)}"><span><b>${esc(team.name)}</b><small>${team.rows.length}/${rosterTotal} giocatori</small></span><span><b>${fmt(team.spent)} spesi</b><small>${fmt(team.remaining)} residui</small></span></div>`).join("")}</div>
      ${fa2MissingRosterPlayersHTML(resolved)}
      <div class="roster-import-status ${complete?"complete":"partial"}"><b>${complete?"ROSE COMPLETE":"FOTOGRAFIA PARZIALE"}</b><span>${complete?"Tutte le squadre hanno il numero di giocatori previsto.":"Verranno importati solo i giocatori presenti; gli slot mancanti resteranno aperti."}</span></div>
      <div><span class="roster-import-diff-title">Differenze rispetto all'app</span><div id="rosterImportDiff" class="roster-import-diff">${fa2RosterImportDiffHTML(existingMatch)}</div></div>
      <div class="roster-import-safety"><b>Importazione sicura</b><span>Il CSV diventa la fotografia corrente della lega. Prima di applicarlo viene salvato uno snapshot; eventuali assegnazioni non presenti nel file torneranno disponibili ma resteranno recuperabili da Registro / Undo.</span></div>
      <div class="dialog-actions roster-import-actions"><button class="ghost" type="button" onclick="closeRosterImportDialog()">Annulla</button><button class="primary" id="applyRosterImportBtn" type="submit" ${existingMatch===""?"disabled":""}>IMPORTA ROSE</button></div>
    </form>
  </div>`;
}

async function fa2StartRosterCsvImport(file){
  fa2OpenRosterImportDialog(`<div class="dialog-body roster-import-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">CSV ROSE · A6.1.0</div><h2>Controllo file</h2></div><button class="ghost" type="button" aria-label="Chiudi controllo file" onclick="closeRosterImportDialog()">✕</button></div><div class="listone-sync-loading"><span class="sync-spinner"></span><b>Riconosco squadre, prezzi e giocatori…</b><small>Nessun dato dell'asta viene modificato.</small></div></div>`);
  try{
    const [text,snapshot]=await Promise.all([fa2ReadTextFile(file),fa2RosterImportSnapshot()]);
    const parsed=fa2ParseFantacalcioRosterCsv(text),resolved=fa2ResolveRosterCsv(parsed,snapshot);
    fa2PendingRosterCsvImport={fileName:file.name,parsed,resolved,snapshot};
    fa2OpenRosterImportDialog(fa2RosterImportPreviewHTML(fa2PendingRosterCsvImport));
    $("#rosterImportMine").addEventListener("change",fa2UpdateRosterImportSelection);
    $$('[data-roster-missing]').forEach(input=>input.addEventListener("input",fa2UpdateRosterImportSelection));
    $("#rosterImportForm").addEventListener("submit",event=>{event.preventDefault();fa2ApplyRosterCsvImport()});
    fa2UpdateRosterImportSelection();
  }catch(error){
    fa2PendingRosterCsvImport=null;
    fa2OpenRosterImportDialog(`<div class="dialog-body roster-import-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">NESSUNA MODIFICA APPLICATA</div><h2>CSV non importabile</h2></div><button class="ghost" type="button" aria-label="Chiudi errore importazione" onclick="closeRosterImportDialog()">✕</button></div><div class="listone-sync-warning">${esc(error?.message||"File non valido.")}</div><p class="muted">Rose, prezzi, squadre e strategia sono rimasti invariati.</p><button class="primary full-btn" type="button" onclick="closeRosterImportDialog()">Chiudi</button></div>`);
  }
}

function fa2RosterImportTeamId(team,index,isMine,used){
  if(isMine){used.add("mine");return "mine"}
  const normalized=normalizePlayerName(team.name);
  const existing=state.league?.teams?.find(item=>!item.isMine&&normalizePlayerName(item.name)===normalized&&item.id!=="mine"&&!used.has(item.id));
  let id=existing?.id||`csv_team_${index+1}_${normalized.slice(0,18)||"squadra"}`;
  let suffix=2;while(used.has(id)){id=`csv_team_${index+1}_${normalized.slice(0,14)||"squadra"}_${suffix++}`}
  used.add(id);return id;
}

function fa2CompleteMissingRosterPlayers(pending){
  const missing=pending?.resolved?.missingRows||[];
  if(!missing.length)return;
  const existingKeys=new Set((pending.snapshot.players||[]).map(player=>player.key||normalizePlayerName(player.name))),additions=[];
  missing.forEach((row,index)=>{
    const name=localField($(`#rosterMissingName${index}`)?.value,80),club=window.FA2ListoneImporter?.normalizeClub
      ?window.FA2ListoneImporter.normalizeClub(localField($(`#rosterMissingClub${index}`)?.value,24),SERIES_A_CLUBS)
      :localField($(`#rosterMissingClub${index}`)?.value,24).toUpperCase(),role=normalizeMantraRoleInput($(`#rosterMissingRole${index}`)?.value),key=normalizePlayerName(name);
    if(!name||!club||!validMantraRole(role))throw new Error(`Completa nome, club e ruolo Mantra per l'ID ${row.officialId}.`);
    if(existingKeys.has(key))throw new Error(`${name} è già presente nel Listone locale: verifica il giocatore fuori listone.`);
    existingKeys.add(key);
    const reparto=inferRepartoFromRole(role),classic={POR:"P",DIF:"D",CEN:"C",ATT:"A"}[reparto]||"";
    additions.push({row,player:{id:row.internalId,key,name,club,role,reparto,classic,quote:0,fvm:0,birthDate:"",birthYear:0,active:false,officialId:String(row.officialId)}});
  });
  const additionByRow=new Map(additions.map(entry=>[entry.row,entry.player]));
  const clubLimit=configuredClubLimit();
  pending.resolved.teams.forEach(team=>{
    const counts={};team.rows.forEach(row=>{const club=(row.player||additionByRow.get(row))?.club;if(club)counts[club]=(counts[club]||0)+1});
    const violation=clubLimit?Object.entries(counts).find(([,count])=>count>clubLimit):null;
    if(violation)throw new Error(`${team.name}: ${violation[1]} giocatori ${violation[0]}, oltre il limite di ${clubLimit}. Verifica il Regolamento Lega.`);
  });
  additions.forEach(({row,player})=>{pending.snapshot.players.push(player);row.player=player;row.unresolved=false});
  pending.snapshot.totalPlayers=pending.snapshot.players.length;
  pending.resolved.matched=pending.resolved.totalPlayers;pending.resolved.missing=0;
  pending.resolved.missingRows=[];
}

function fa2ApplyRosterCsvImport(){
  const pending=fa2PendingRosterCsvImport,ownKey=$("#rosterImportMine")?.value??"";
  const leagueName=$("#rosterImportLeagueName")?.value.trim()||"";
  if(!pending||ownKey===""||!leagueName)return;
  try{fa2CompleteMissingRosterPlayers(pending)}catch(error){alert(error?.message||"Completa i giocatori fuori listone.");return}
  if(!protectedPermission("importare e sincronizzare le rose Fantacalcio"))return;
  const resolved=pending.resolved,total=resolved.totalPlayers;
  if(!confirm(`Importare ${total} assegnazioni in ${resolved.teams.length} squadre?\n\nLa situazione attuale verrà salvata in Snapshot e Registro / Undo.`))return;
  const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates(),previousListone=appliedListoneSync;
  const importedAt=Date.now(),leagueId=state.league?.id||`league_${importedAt}`,usedIds=new Set();
  const ordered=[...resolved.teams.filter(team=>team.key===ownKey),...resolved.teams.filter(team=>team.key!==ownKey)];
  const teamByKey=new Map();
  const teams=ordered.map((team,index)=>{
    const isMine=team.key===ownKey,id=fa2RosterImportTeamId(team,index,isMine,usedIds);
    const out={id,name:team.name,isMine,importSource:"fantacalcio-csv"};teamByKey.set(team.key,out);return out;
  });
  const nextPurchases={},nextSold={};let sequence=0;
  resolved.teams.forEach(team=>team.rows.forEach(row=>{
    const id=String(row.internalId),old=state.purchases?.[id]||state.sold?.[id],at=Number(old?.at)||importedAt+sequence++;
    if(team.key===ownKey)nextPurchases[id]={price:row.price,at,source:"fantacalcio-csv",importedAt};
    else nextSold[id]={price:row.price,at,teamId:teamByKey.get(team.key).id,leagueId,source:"fantacalcio-csv",importedAt};
  }));
  if(Object.keys(nextPurchases).length+Object.keys(nextSold).length!==total){alert("Importazione annullata: conteggio assegnazioni non coerente.");return}
  const backupBase=getBackupActionCount();
  try{
    createSafetySnapshot("Prima import rose Fantacalcio CSV",true);
    appliedListoneSync=pending.snapshot;localStorage.setItem(LISTONE_SYNC_STORAGE,JSON.stringify(appliedListoneSync));allPlayers=buildAllPlayers();
    const unresolved=[...Object.keys(nextPurchases),...Object.keys(nextSold)].filter(id=>!getPlayer(id));
    if(unresolved.length)throw new Error(`${unresolved.length} giocatori non disponibili dopo il sync del Listone.`);
    state.league={id:leagueId,name:leagueName,size:teams.length,teams,createdAt:state.league?.createdAt||importedAt,importedAt,importSource:"fantacalcio-csv"};
    state.purchases=nextPurchases;state.sold=nextSold;
    save();saveSold();saveLeague();
    localStorage.setItem(SAFETY_KEYS.backupActionCount,String(backupBase+total));
    fa2AfterAuctionStateChange("ROSTERS_IMPORTED","",strategyBefore);
    recordOperation("IMPORT_ROSE",`Importate rose Fantacalcio · ${teams.length} squadre · ${total} giocatori`,before,{undoable:true,count:false});
    fa2SetRegulationParticipants(teams.length);
    updateBackupAlert();refresh();
    const mine=resolved.teams.find(team=>team.key===ownKey),mineRemaining=configuredBudget()-(mine?.spent||0);
    fa2PendingRosterCsvImport=null;
    fa2OpenRosterImportDialog(`<div class="dialog-body roster-import-dialog-body roster-import-success"><div class="safety-modal-head"><div><div class="eyebrow">IMPORT COMPLETATO · A6.1.0</div><h2>Rose sincronizzate</h2></div><button class="ghost" type="button" aria-label="Chiudi importazione completata" onclick="closeRosterImportDialog()">✕</button></div><div class="listone-sync-finished"><span>OK</span><h2>${teams.length} squadre · ${total} giocatori</h2><p>${esc(mine?.name||"La mia squadra")} · ${fmt(mineRemaining)} crediti residui</p></div><div class="listone-sync-success-box"><b>Motori ricalcolati</b><span>Dashboard, Leghe, Strategia, budget, inflazione, Opponent Intelligence e Copilot leggono ora la stessa fotografia.</span></div><div class="dialog-actions"><button class="ghost" type="button" onclick="closeRosterImportDialog();switchView('leagueView')">Apri Leghe</button><button class="primary" type="button" onclick="closeRosterImportDialog();switchView('dashboardView')">Dashboard</button></div></div>`);
  }catch(error){
    appliedListoneSync=previousListone;
    if(previousListone)localStorage.setItem(LISTONE_SYNC_STORAGE,JSON.stringify(previousListone));else localStorage.removeItem(LISTONE_SYNC_STORAGE);
    allPlayers=buildAllPlayers();applyAuctionCore(before);
    alert(`Importazione annullata: ${error?.message||"errore imprevisto"}. I dati precedenti sono stati ripristinati.`);
  }
}
window.fa2ApplyRosterCsvImport=fa2ApplyRosterCsvImport;

function fa2ChooseRosterCsv(){
  const input=$("#leagueRosterCsvInput");if(!input)return;
  input.value="";input.click();
}
window.fa2ChooseRosterCsv=fa2ChooseRosterCsv;

const fa2RosterCsvInput=$("#leagueRosterCsvInput");
if(fa2RosterCsvInput)fa2RosterCsvInput.addEventListener("change",event=>{
  const file=event.target.files?.[0];if(file)fa2StartRosterCsvImport(file);
});
const listoneLocalFileInput=$("#listoneLocalFileInput");
if(listoneLocalFileInput)listoneLocalFileInput.addEventListener("change",event=>{
  const file=event.target.files?.[0];if(file)importLocalListoneFile(file);
});

$("#cancelLeagueCreate").addEventListener("click",()=>{
  if($("#leagueDialog").open) $("#leagueDialog").close();
});

$("#leagueForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("#leagueNameInput").value.trim();
  const size=Number($("#leagueSizeInput").value);
  if(!name || !Number.isInteger(size) || size<4 || size>20)return;
  if(state.league&&blockedByProtection("Creare o sostituire la struttura della lega"))return;
  const before=captureAuctionCore();
  const teams=[{id:"mine",name:"La mia squadra",isMine:true}];
  for(let i=2;i<=size;i++) teams.push({id:`team${i}`,name:`Squadra ${i}`,isMine:false});
  state.league={id:`league_${Date.now()}`,name,size,teams,createdAt:Date.now()};
  saveLeague();
  fa2SetRegulationParticipants(size);
  recordOperation("LEGA",`Creata lega “${name}” · ${size} squadre`,before);
  $("#leagueDialog").close();
  refresh();
  switchView("leagueView");
});

function rosterForLeagueTeam(team){
  if(team.isMine){
    return purchasedPlayers().map(p=>({p,price:Number(state.purchases[p.id]?.price||0)}));
  }
  return soldPlayers()
    .filter(p=>{
      const s=state.sold[p.id];
      return s?.teamId===team.id && (!s.leagueId || s.leagueId===state.league?.id);
    })
    .map(p=>({p,price:Number(state.sold[p.id]?.price||0)}));
}

/* Alpha 5.3 — export rose compatibile con Leghe Fantacalcio.
   Struttura verificata sul CSV ufficiale: separatore $,$,$ seguito da
   nome squadra, ID profilo ufficiale e prezzo. L'export è in sola lettura. */
function fa2CsvCell(value){
  const text=String(value??"");
  return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}

function fa2RosterOfficialIndex(snapshot){
  const basePlayers=basePlayerMap(),byRuntimeId=new Map(),byKey=new Map();
  const ambiguousRuntimeIds=new Set(),ambiguousKeys=new Set();
  const addExact=(map,ambiguous,key,entry)=>{
    if(!key||ambiguous.has(key))return;
    const previous=map.get(key);
    if(previous&&previous.officialId!==entry.officialId){map.delete(key);ambiguous.add(key);return}
    if(!previous)map.set(key,entry);
  };
  (snapshot?.players||[]).forEach(player=>{
    const officialId=fa2OfficialRosterId(player),key=player.key||normalizePlayerName(player.name);
    if(!officialId||!key)return;
    const runtimeId=String(basePlayers.get(key)?.id??player.id??`fc_${key}`);
    const entry={officialId,key,runtimeId,player};
    addExact(byRuntimeId,ambiguousRuntimeIds,runtimeId,entry);
    addExact(byKey,ambiguousKeys,key,entry);
  });
  return {byRuntimeId,byKey,ambiguousRuntimeIds,ambiguousKeys};
}

function fa2RosterCsvFilename(leagueName,now=Date.now()){
  const slug=String(leagueName||"lega-fantacalcio")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase();
  return `${slug||"lega-fantacalcio"}_rosters_${now}.csv`;
}

function fa2BuildRosterCsvExport(snapshot){
  const league=state.league;
  if(!league||!Array.isArray(league.teams))throw new Error("Crea o importa prima una lega con le sue squadre.");
  if(league.teams.length<4||league.teams.length>20)throw new Error(`La lega contiene ${league.teams.length} squadre: il formato accetta da 4 a 20 partecipanti.`);
  const rosterTotal=configuredRosterTotal(),budget=configuredBudget(),minBid=configuredMinBid();
  const official=fa2RosterOfficialIndex(snapshot),blockers=[],missingIds=[],invalidPrices=[],duplicateIds=[];
  const seenOfficialIds=new Map(),seenNames=new Map();
  const opponentTeamIds=new Set(league.teams.filter(team=>!team.isMine).map(team=>String(team.id)));
  const unassigned=soldPlayers().filter(player=>{
    const sale=state.sold[player.id],teamId=String(sale?.teamId||"");
    return !opponentTeamIds.has(teamId)||(sale?.leagueId&&sale.leagueId!==league.id);
  });
  if(unassigned.length)blockers.push(`${unassigned.length} venduti non sono assegnati a una squadra della lega.`);

  const teams=league.teams.map((team,index)=>{
    const name=String(team.name||"").trim(),nameKey=normalizePlayerName(name);
    if(!nameKey)blockers.push(`La squadra ${index+1} non ha un nome valido.`);
    else if(seenNames.has(nameKey))blockers.push(`Il nome squadra “${name}” è duplicato.`);
    else seenNames.set(nameKey,team.id);
    const rows=rosterForLeagueTeam(team).map(item=>{
      const player=item.p,runtimeId=String(player.id),key=normalizePlayerName(player.name);
      const match=official.byRuntimeId.get(runtimeId)||official.byKey.get(key)||null;
      const officialId=match?.officialId||"",price=Number(item.price);
      if(!officialId)missingIds.push({teamName:name,player});
      if(!Number.isSafeInteger(price)||price<minBid)invalidPrices.push({teamName:name,player,price:item.price});
      if(officialId){
        const previous=seenOfficialIds.get(officialId);
        if(previous)duplicateIds.push({officialId,first:previous,second:{teamName:name,player}});
        else seenOfficialIds.set(officialId,{teamName:name,player});
      }
      return {teamId:team.id,teamName:name,player,officialId,price};
    });
    const spent=rows.reduce((sum,row)=>sum+(Number.isFinite(row.price)?row.price:0),0);
    if(!rows.length)blockers.push(`${name||`Squadra ${index+1}`}: assegna almeno un giocatore prima dell'export.`);
    if(rows.length>rosterTotal)blockers.push(`${name}: ${rows.length} giocatori, oltre i ${rosterTotal} previsti.`);
    if(spent>budget)blockers.push(`${name}: spesa ${spent} superiore al budget di ${budget} crediti.`);
    return {id:team.id,name,isMine:!!team.isMine,rows,spent,remaining:budget-spent};
  });
  if(missingIds.length)blockers.push(`${missingIds.length} giocatori non hanno un ID ufficiale verificabile nel Listone corrente.`);
  if(invalidPrices.length)blockers.push(`${invalidPrices.length} assegnazioni hanno un prezzo non valido.`);
  if(duplicateIds.length)blockers.push(`${duplicateIds.length} ID ufficiali risultano assegnati più di una volta.`);
  const totalPlayers=teams.reduce((sum,team)=>sum+team.rows.length,0);
  if(!totalPlayers)blockers.push("Non ci sono giocatori assegnati da esportare.");
  return {
    league,teams,totalPlayers,matched:totalPlayers-missingIds.length,missingIds,invalidPrices,duplicateIds,unassigned,
    blockers:[...new Set(blockers)],complete:teams.every(team=>team.rows.length===rosterTotal),snapshot,
    filename:fa2RosterCsvFilename(league.name)
  };
}

function fa2GenerateLegheRosterCsv(exportData){
  if(!exportData||exportData.blockers?.length)throw new Error("Il CSV non può essere generato finché sono presenti controlli bloccanti.");
  const lines=[];
  exportData.teams.forEach(team=>{
    lines.push("$,$,$");
    team.rows.forEach(row=>lines.push(`${fa2CsvCell(team.name)},${row.officialId},${row.price}`));
  });
  return `${lines.join("\n")}\n`;
}
window.fa2BuildRosterCsvExport=fa2BuildRosterCsvExport;
window.fa2GenerateLegheRosterCsv=fa2GenerateLegheRosterCsv;

function fa2RosterExportBlockersHTML(pending){
  if(!pending.blockers.length)return "";
  const details=[];
  pending.missingIds.slice(0,5).forEach(row=>details.push(`${row.player.name} (${row.teamName}): ID ufficiale assente`));
  pending.invalidPrices.slice(0,3).forEach(row=>details.push(`${row.player.name} (${row.teamName}): prezzo non valido`));
  pending.unassigned.slice(0,3).forEach(player=>details.push(`${player.name}: venduto senza squadra`));
  const messages=[...pending.blockers,...details];
  return `<div class="roster-export-blockers"><b>ESPORTAZIONE BLOCCATA</b><span>Correggi questi dati prima di creare il file:</span><ul>${messages.slice(0,9).map(message=>`<li>${esc(message)}</li>`).join("")}${messages.length>9?`<li>Altri ${messages.length-9} controlli da correggere.</li>`:""}</ul></div>`;
}

function fa2RosterExportPreviewHTML(pending){
  const rosterTotal=configuredRosterTotal(),complete=pending.complete,ready=!pending.blockers.length;
  return `<div class="dialog-body roster-import-dialog-body roster-export-dialog-body">
    <div class="safety-modal-head"><div><div class="eyebrow">CSV ROSE · A6.1.0</div><h2>Esporta rose</h2></div><button class="ghost" type="button" aria-label="Chiudi esportazione rose" onclick="closeRosterImportDialog()">✕</button></div>
    <div class="roster-import-file"><span>${esc(pending.filename)}</span><b>${pending.teams.length} squadre · ${pending.totalPlayers} giocatori</b><small>${pending.matched}/${pending.totalPlayers} ID ufficiali verificati</small></div>
    <div class="roster-export-format"><b>FORMATO LEGHE FANTACALCIO</b><span>Nessuna intestazione · separatore $,$,$ · squadra, ID ufficiale, prezzo</span></div>
    <div class="roster-import-team-list">${pending.teams.map(team=>`<div class="roster-import-team ${team.isMine?"mine":""}"><span><b>${esc(team.name)}</b><small>${team.rows.length}/${rosterTotal} giocatori${team.isMine?" · MIA SQUADRA":""}</small></span><span><b>${fmt(team.spent)} spesi</b><small>${fmt(team.remaining)} residui</small></span></div>`).join("")}</div>
    <div class="roster-import-status ${complete?"complete":"partial"}"><b>${complete?"ROSE COMPLETE":"ROSE PARZIALI"}</b><span>${complete?"Ogni squadra ha il numero di giocatori previsto dal regolamento.":"Il file fotografa soltanto le assegnazioni presenti in questo momento."}</span></div>
    ${fa2RosterExportBlockersHTML(pending)}
    ${ready?`<div class="roster-export-ready"><b>CSV VERIFICATO</b><span>Il file ha superato anche la rilettura interna: squadre, ID e prezzi tornano senza differenze.</span></div>`:""}
    <div class="roster-import-safety"><b>Esportazione in sola lettura</b><span>Scaricare o condividere il CSV non modifica rose, assegnazioni, prezzi, squadre, strategia o localStorage.</span></div>
    <div class="dialog-actions roster-import-actions"><button class="ghost" type="button" onclick="closeRosterImportDialog()">Annulla</button><button class="primary" id="downloadRosterCsvBtn" type="button" ${ready?"":"disabled"}>ESPORTA CSV</button></div>
  </div>`;
}

async function fa2StartRosterCsvExport(){
  if(!state.league)return;
  fa2OpenRosterImportDialog(`<div class="dialog-body roster-import-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">CSV ROSE · A6.1.0</div><h2>Preparo l'export</h2></div><button class="ghost" type="button" aria-label="Chiudi preparazione export" onclick="closeRosterImportDialog()">✕</button></div><div class="listone-sync-loading"><span class="sync-spinner"></span><b>Verifico squadre, prezzi e ID ufficiali…</b><small>Nessun dato dell'asta viene modificato.</small></div></div>`);
  try{
    const snapshot=await fa2RosterImportSnapshot(),pending=fa2BuildRosterCsvExport(snapshot);
    if(!pending.blockers.length){
      pending.csv=fa2GenerateLegheRosterCsv(pending);
      const parsed=fa2ParseFantacalcioRosterCsv(pending.csv),resolved=fa2ResolveRosterCsv(parsed,snapshot);
      if(parsed.teams.length!==pending.teams.length||resolved.totalPlayers!==pending.totalPlayers)throw new Error("La verifica interna del CSV non restituisce lo stesso numero di squadre e giocatori.");
      pending.roundTrip={teams:parsed.teams.length,players:resolved.totalPlayers};
    }
    fa2PendingRosterCsvExport=pending;
    fa2OpenRosterImportDialog(fa2RosterExportPreviewHTML(pending));
    const button=$("#downloadRosterCsvBtn");if(button&&!button.disabled)button.onclick=fa2DownloadRosterCsv;
  }catch(error){
    fa2PendingRosterCsvExport=null;
    fa2OpenRosterImportDialog(`<div class="dialog-body roster-import-dialog-body"><div class="safety-modal-head"><div><div class="eyebrow">NESSUN FILE CREATO</div><h2>Export non disponibile</h2></div><button class="ghost" type="button" aria-label="Chiudi errore esportazione" onclick="closeRosterImportDialog()">✕</button></div><div class="listone-sync-warning">${esc(error?.message||"Controllo non riuscito.")}</div><p class="muted">Rose, prezzi, squadre e strategia sono rimasti invariati.</p><button class="primary full-btn" type="button" onclick="closeRosterImportDialog()">Chiudi</button></div>`);
  }
}

function fa2DownloadRosterCsvFallback(blob,filename){
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=filename;link.style.display="none";document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2500);
}

async function fa2DownloadRosterCsv(){
  const pending=fa2PendingRosterCsvExport;
  if(!pending?.csv||pending.blockers?.length)return;
  try{
    const parsed=fa2ParseFantacalcioRosterCsv(pending.csv);
    if(parsed.teams.length!==pending.teams.length||parsed.totalPlayers!==pending.totalPlayers)throw new Error("Verifica finale non superata.");
    const blob=new Blob([pending.csv],{type:"text/csv;charset=utf-8"});
    const nav=typeof navigator!=="undefined"?navigator:null;
    const isIOS=!!nav&&(/iPad|iPhone|iPod/.test(nav.userAgent||"")||((nav.platform||"")==="MacIntel"&&Number(nav.maxTouchPoints)>1));
    let shared=false;
    if(isIOS&&typeof File==="function"&&typeof nav?.share==="function"&&typeof nav?.canShare==="function"){
      const file=new File([blob],pending.filename,{type:"text/csv",lastModified:Date.now()});
      if(nav.canShare({files:[file]})){
        try{await nav.share({files:[file],title:"Rose Leghe Fantacalcio"});shared=true}
        catch(error){if(error?.name==="AbortError")return}
      }
    }
    if(!shared)fa2DownloadRosterCsvFallback(blob,pending.filename);
    const button=$("#downloadRosterCsvBtn");
    if(button){const old=button.textContent;button.textContent="CSV CREATO";setTimeout(()=>{if(button.isConnected)button.textContent=old},1800)}
  }catch(error){alert(`CSV non creato: ${error?.message||"errore imprevisto"}.`)}
}
window.fa2StartRosterCsvExport=fa2StartRosterCsvExport;
window.fa2DownloadRosterCsv=fa2DownloadRosterCsv;

function leagueRosterRows(items){
  return rosterFormationGroupsHTML(items,{quota:rosterQuotaByMacro()});
}
function renderLeagues(){
  if(!state.league){
    $("#leagueView").innerHTML=`
      <div class="section-title"><h2>Leghe</h2></div>
      <div class="league-csv-import-card primary-import">
        <div><span>CSV ROSE COMPATIBILE · A6.1.0</span><b>Importa automaticamente lega, squadre, rose e prezzi</b><small>Scegli il CSV esportato dalla tua piattaforma; dopo l'anteprima indicherai qual è la tua squadra.</small></div>
        <button id="importLeagueRosterBtn" class="primary" type="button">IMPORTA ROSE CSV</button>
      </div>
      <div class="card league-empty-state">
        <h3>Nessuna lega creata</h3>
        <p class="muted">Se non hai un CSV puoi ancora creare la lega e inserire manualmente le assegnazioni.</p>
        <button id="createLeagueBtn" class="ghost">＋ Crea lega manualmente</button>
      </div>`;
    $("#importLeagueRosterBtn").onclick=fa2ChooseRosterCsv;
    $("#createLeagueBtn").onclick=createLeague;
    return;
  }

  const league=state.league,rosterTotal=configuredRosterTotal();
  const intel=getAuctionIntel();
  const leader=intel.economy[0];
  const unassigned=soldPlayers().filter(p=>!state.sold[p.id]?.teamId || (state.sold[p.id]?.leagueId && state.sold[p.id]?.leagueId!==league.id));
  const assignedOutCount=league.teams.reduce((sum,team)=>sum+rosterForLeagueTeam(team).filter(x=>x.p.outOfListone).length,0);
  const opponentConfidenceRows=opponentTeams().map(team=>opponentTeamDataConfidence(team,intel));
  const opponentConfidence=opponentConfidenceRows.length?opponentConfidenceRows.reduce((sum,value)=>sum+value,0)/opponentConfidenceRows.length:0;
  const assignmentShare=opponentAssignmentShare();

  $("#leagueView").innerHTML=`
    <div class="section-title league-title-row">
      <div><div class="eyebrow">Lega attiva · fase ${state.auctionPhase}</div><h2>${esc(league.name)}</h2></div>
      <span class="muted">${league.size} squadre</span>
    </div>

    <div class="league-csv-import-card">
      <div><span>CSV ROSE · A6.1.0</span><b>Importa, aggiorna o esporta le rose</b><small>${league.teams.reduce((sum,team)=>sum+rosterForLeagueTeam(team).length,0)} assegnazioni correnti · export in sola lettura con verifica ID e prezzi</small></div>
      <div class="league-csv-actions"><button id="exportLeagueRosterBtn" class="primary" type="button">ESPORTA ROSE CSV</button><button id="importLeagueRosterBtn" class="ghost" type="button">IMPORTA / AGGIORNA CSV</button></div>
    </div>

    <div class="league-summary-grid intelligence-league-summary">
      <div class="card metric"><span>Partecipanti</span><strong>${league.size}</strong></div>
      <div class="card metric"><span>Venduti assegnati</span><strong>${soldPlayers().length-unassigned.length}</strong></div>
      <div class="card metric"><span>Inflazione</span><strong>${pctLabel(intel.overallInflation.pct,intel.overallInflation.count)}</strong></div>
      <div class="card metric"><span>Leader crediti</span><strong>${leader?fmt(leader.remaining):"—"}</strong><span>${leader?esc(leader.team.name):"—"}</span></div>
    </div>

    <div class="opponent-intelligence-banner">
      <div><span>OPPONENT INTELLIGENCE · A4.2</span><b>Budget rivali, ruoli mancanti e probabilità di rilancio</b><small>Assegnazioni collegate ${Math.round(assignmentShare*100)}% · affidabilità media ${Math.round(opponentConfidence*100)}%. Le stime migliorano mentre assegni i venduti alle squadre corrette.</small></div>
    </div>

    <details class="league-edit-details">
      <summary><span>Rinomina lega e squadre</span><small>${league.size} partecipanti</small></summary>
      <div class="card league-edit-card">
        <label>Nome lega<input id="editLeagueName" type="text" maxlength="40" value="${esc(league.name)}"></label>
        <div class="league-team-inputs">
          ${league.teams.map((t,i)=>`<label><span>${t.isMine?"Mia squadra":`Squadra ${i+1}`}</span><input class="team-name-input" data-team-id="${t.id}" maxlength="32" value="${esc(t.name)}"></label>`).join("")}
        </div>
        <div class="dialog-actions league-edit-actions"><button id="deleteLeagueBtn" class="dangerbtn">Elimina lega</button><button id="saveLeagueNamesBtn" class="primary">Salva nomi</button></div>
      </div>
    </details>

    <div class="section-title"><h2>Rose + Opponent Intelligence</h2><span class="muted">tocca per aprire</span></div>
    ${assignedOutCount?`<div class="out-listone-roster-legend league-out-legend"><b>* Fuori listone</b><span>${assignedOutCount} ${assignedOutCount===1?"giocatore assegnato":"giocatori assegnati"} da gestire nelle riparazioni</span></div>`:""}
    <div class="league-rosters intelligence-rosters">
      ${league.teams.map(team=>{
        const econ=teamEconomy(team);
        const pred=intel.predictions[team.id];
        const isLeader=leader?.team.id===team.id;
        const dataConfidence=team.isMine?1:opponentTeamDataConfidence(team,intel);
        const likelyNeeds=team.isMine?[]:opponentRoleNeedsForTeam(team,intel).filter(row=>row.need>=.25).slice(0,4);
        return `<details class="league-team-card intelligence-team-card ${isLeader?"credit-leader-card":""}" data-team-id="${escAttr(team.id)}" ${team.isMine?"open":""}>
          <summary>
            <div><b>${isLeader?"TOP ":""}${esc(team.name)}</b>${team.isMine?'<span class="mine-badge">MIA</span>':''}${isLeader?'<span class="leader-badge">LEADER CREDITI</span>':''}</div>
            <span>${econ.items.length}/${rosterTotal} · ${fmt(econ.remaining)} cr · MAX ${fmt(econ.maxNext)}</span>
          </summary>
          <div class="league-roster-body">
            <div class="team-economy-grid">
              <div><span>Speso</span><b>${fmt(econ.spent)}</b></div><div><span>Residuo</span><b>${fmt(econ.remaining)}</b></div><div><span>Posti</span><b>${econ.missing}</b></div><div><span>MAX prossimo</span><b>${fmt(econ.maxNext)}</b></div>
            </div>
            <div class="team-rep-spend">
              ${["POR","DIF","CEN","ATT"].map(rep=>`<div><span>${rep}</span><b>${fmt(econ.byRep[rep])}</b></div>`).join("")}
            </div>
            ${team.isMine?`<div class="team-module-box mine-module"><span>Strategia nostra</span><b>${state.strategy} · ${activeStrategy().module}</b><small>Il motore A/B resta dedicato alla nostra rosa.</small></div>`:`<div class="team-module-box">
              <span>Modulo previsto · confidenza ${Math.round((pred?.confidence||0)*100)}%</span>
              <b>${pred?.top?.module.name||"—"} · ${Math.round((pred?.top?.prob||0)*100)}%</b>
              <small>${(pred?.ranked||[]).slice(1,3).map(x=>`${x.module.name} ${Math.round(x.prob*100)}%`).join(" · ")||"Dati ancora insufficienti"}</small>
            </div>
            <div class="team-needs-box"><span>Ruoli mancanti stimati · dati ${Math.round(dataConfidence*100)}%</span><b>${likelyNeeds.length?likelyNeeds.map(row=>`${row.label} ${Math.round(row.need*100)}%`).join(" · "):"nessun bisogno forte ancora"}</b></div>`}
            ${leagueRosterRows(econ.items)}
          </div>
        </details>`;
      }).join("")}
    </div>

    ${unassigned.length?`<div class="section-title"><h2>Venduti non assegnati</h2><span class="muted">${unassigned.length}</span></div><div class="card">${unassigned.map(p=>`<button class="unassigned-sale" data-id="${p.id}"><span>${playerNameHTML(p)}<small>${p.club} · ${p.role}</small></span><b>${state.sold[p.id]?.price?fmt(state.sold[p.id].price)+" cr":"—"}</b></button>`).join("")}</div>`:""}
  `;

  $("#exportLeagueRosterBtn").onclick=fa2StartRosterCsvExport;
  $("#importLeagueRosterBtn").onclick=fa2ChooseRosterCsv;

  $("#saveLeagueNamesBtn").onclick=()=>{
    const before=captureAuctionCore(),oldName=state.league.name;
    const leagueName=$("#editLeagueName").value.trim();if(leagueName)state.league.name=leagueName;
    $$(".team-name-input").forEach(inp=>{const t=leagueTeamById(inp.dataset.teamId),name=inp.value.trim();if(t&&name)t.name=name});
    saveLeague();recordOperation("LEGA",`Nomi lega/squadre aggiornati${oldName!==state.league.name?` · ${oldName} → ${state.league.name}`:""}`,before,{undoable:true,count:false});refresh();
  };
  $("#deleteLeagueBtn").onclick=()=>{
    if(blockedByProtection("Eliminare la lega"))return;
    if(!confirm(`Eliminare la lega “${state.league.name}”? I giocatori resteranno Venduti ma senza squadra assegnata.`))return;
    const before=captureAuctionCore(),leagueName=state.league.name;
    Object.values(state.sold).forEach(s=>{s.teamId="";s.leagueId=""});saveSold();state.league=null;saveLeague();
    recordOperation("ELIMINA_LEGA",`Eliminata lega “${leagueName}”`,before);refresh();
  };
  $$(".unassigned-sale").forEach(btn=>btn.onclick=()=>editSold(btn.dataset.id));
}

function fa2RegUnderRow(reg,id,label){
  const rule=(reg.underRules||[]).find(x=>x.id===id)||{id,label,enabled:false,min:0,maxAge:id==="u21"?21:23,birthYearFrom:id==="u21"?2005:2003};
  const ages=[20,21,22,23].map(age=>`<option value="${age}" ${Number(rule.maxAge)===age?"selected":""}>U${age}</option>`).join("");
  return `<div class="fa2-reg-under-row"><label class="fa2-check"><input id="fa2_${id}_enabled" type="checkbox" ${rule.enabled?"checked":""}><span>${label} attivo</span></label><label>Età massima<select id="fa2_${id}_age">${ages}</select></label><label>Minimo<input id="fa2_${id}_min" type="number" min="0" max="${reg.roster.total}" value="${Number(rule.min)||0}"></label><div class="fa2-reg-derived"><span>Nati dal</span><b>${Number(rule.birthYearFrom)||"—"}</b></div></div>`;
}
const FA2_REG_BONUS_FIELDS=[
  ["goal","Gol segnato"],["goalAgainst","Gol subito"],["penaltyScored","Rigore segnato"],["penaltyMissed","Rigore sbagliato"],["penaltySaved","Rigore parato"],
  ["yellow","Ammonizione"],["red","Espulsione"],["assistStandard","Assist standard"],["assistSoft","Assist soft"],["assistGold","Assist gold"],
  ["ownGoal","Autogol"],["equalizer","Gol pareggio"],["winner","Gol vittoria"],["cleanSheet","Porta inviolata"],["playerOfMatch","Player of the match"]
];
function fa2RegBonusGrid(reg){
  return `<div class="fa2-reg-grid fa2-reg-bonus-grid">${FA2_REG_BONUS_FIELDS.map(([key,label])=>`<label>${label}<input id="fa2Bonus_${key}" type="number" step="0.5" value="${Number(reg.scoring.bonuses[key])||0}"></label>`).join("")}</div>`;
}
function fa2RegDFactorBands(reg){
  const labels=["< 6","6 – 6,24","6,25 – 6,49","6,50 – 6,74","6,75 – 6,99","≥ 7"];
  return `<div class="fa2-reg-band-grid">${(reg.modifiers.dFactor.bands||[]).map((band,index)=>`<div class="fa2-reg-band"><b>${labels[index]||`Fascia ${index+1}`}</b><div>${band.gte===undefined?'<span>Da −∞</span>':`<label>Da<input data-fa2-dfactor-field="gte" data-fa2-dfactor-index="${index}" type="number" step="0.01" value="${Number(band.gte)||0}"></label>`}${band.lt===undefined?'<span>A +∞</span>':`<label>A &lt;<input data-fa2-dfactor-field="lt" data-fa2-dfactor-index="${index}" type="number" step="0.01" value="${Number(band.lt)||0}"></label>`}<label>Bonus<input data-fa2-dfactor-field="value" data-fa2-dfactor-index="${index}" type="number" step="0.5" value="${Number(band.value)||0}"></label></div></div>`).join("")}</div>`;
}
function fa2RegStudioSection(title,summary,content,open=false){
  return `<details class="fa2-reg-studio-section" ${open?"open":""}><summary><span>${title}</span><small>${summary}</small></summary><div class="fa2-reg-studio-body">${content}</div></details>`;
}
function fa2RegulationCard(){
  if(!window.FA2Regulation)return "";
  const reg=FA2Regulation.load(),sum=FA2Regulation.summary(reg);
  const participantOptions=Array.from({length:17},(_,index)=>index+4).map(value=>`<option value="${value}" ${Number(reg.league?.participants)===value?"selected":""}>${value}</option>`).join("");
  return `<div class="card fa2-reg-settings-card"><div class="fa2-reg-settings-head"><div><span>FANTAASTA2.0 · A7.0.1</span><h3>Regolamento Lega</h3><p>Solo parametri necessari per gestire budget, rose, strategia e sessioni d'asta.</p></div><b>LOCALE</b></div>
    <div class="fa2-reg-mini"><div><span>Partecipanti</span><b>${sum.participants}</b></div><div><span>Bacino</span><b>${sum.analysisPool}</b></div><div><span>Budget</span><b>${sum.budget}</b></div><div><span>Rosa</span><b>${sum.roster}</b></div></div>
    <details id="fa2RegDetails" class="fa2-reg-details"><summary>Apri Regolamento Lega</summary><div class="fa2-reg-studio"><div class="fa2-reg-studio-body">
      <div class="fa2-reg-grid"><label>Nome regolamento<input id="fa2RegName" maxlength="40" value="${esc(reg.name)}"></label><label>Stagione<input id="fa2RegSeason" inputmode="numeric" maxlength="7" value="${esc(reg.season)}"></label><label>Numero partecipanti<select id="fa2RegParticipants">${participantOptions}</select></label><label>Acquisto giocatore<select id="fa2RegAvailability"><option value="single" ${reg.availability==="single"?"selected":""}>Una sola squadra</option><option value="multiple" ${reg.availability==="multiple"?"selected":""}>Più squadre</option></select></label><label>Sistema ruoli<select id="fa2RegMode"><option value="mantra" ${reg.gameMode==="mantra"?"selected":""}>Mantra</option><option value="classic" ${reg.gameMode==="classic"?"selected":""}>Classic</option></select></label><label>Crediti iniziali<input id="fa2RegBudget" type="number" min="1" value="${reg.budget.initial}"></label><label>Offerta minima<input id="fa2RegMinBid" type="number" min="1" value="${reg.budget.minBid}"></label><label>Riserva per posto<input id="fa2RegMinResidual" type="number" min="1" value="${reg.budget.minResidualPerSlot}"></label><label>Totale giocatori<input id="fa2RegRoster" type="number" min="1" value="${reg.roster.total}"></label><label>Portieri<input id="fa2RegGk" type="number" min="1" value="${reg.roster.goalkeepers}"></label><label>Limite stesso club<input id="fa2RegClub" type="number" min="0" value="${reg.roster.clubLimit}"></label></div>
      <p class="fa2-reg-help">Il bacino strategico analizza fino a <b>${sum.analysisPool} giocatori</b>: partecipanti × posti rosa, usando FVM, quotazione e ruoli del Listone importato.</p>
      <h4>Vincoli giovani</h4>${fa2RegUnderRow(reg,"u23","U23")}${fa2RegUnderRow(reg,"u21","U21")}
      <div class="fa2-reg-actions"><button id="fa2RegReset" class="ghost" type="button">Ripristina preset</button><button id="fa2RegSave" class="primary" type="button">SALVA REGOLAMENTO</button></div>
    </div></div></details><button id="fa2OpenStrategy" class="ghost fa2-open-strategy" type="button">Apri Strategia</button></div>`;
  const leagueSection=`<div class="fa2-reg-grid"><label>Nome regolamento<input id="fa2RegName" maxlength="40" value="${esc(reg.name)}"></label><label>Stagione<input id="fa2RegSeason" inputmode="numeric" maxlength="7" value="${esc(reg.season)}"></label><label>Numero partecipanti<select id="fa2RegParticipants">${participantOptions}</select></label><label>Disponibilità<select id="fa2RegAvailability"><option value="single" ${reg.availability==="single"?"selected":""}>Singola</option><option value="multiple" ${reg.availability==="multiple"?"selected":""}>Multipla</option></select></label><label>Modalità<select id="fa2RegMode"><option value="mantra" ${reg.gameMode==="mantra"?"selected":""}>Mantra</option><option value="classic" ${reg.gameMode==="classic"?"selected":""}>Classic</option></select></label><label>Crediti iniziali<input id="fa2RegBudget" type="number" min="1" value="${reg.budget.initial}"></label><label>Offerta minima<input id="fa2RegMinBid" type="number" min="1" value="${reg.budget.minBid}"></label><label>Riserva per posto<input id="fa2RegMinResidual" type="number" min="1" value="${reg.budget.minResidualPerSlot}"></label><label>Limite stesso club<input id="fa2RegClub" type="number" min="0" value="${reg.roster.clubLimit}"></label></div><p class="fa2-reg-help">Bacino strategico: <b>${sum.analysisPool} giocatori</b> (${sum.participants} squadre × ${reg.roster.total} posti), ricalcolato per il modulo scelto.</p>`;
  const rosterSection=`<div class="fa2-reg-grid"><label>Totale giocatori<input id="fa2RegRoster" type="number" min="1" value="${reg.roster.total}"></label><label>Portieri<input id="fa2RegGk" type="number" min="1" value="${reg.roster.goalkeepers}"></label><label>Movimento calcolati<input type="number" value="${reg.roster.movement}" disabled></label><label>Panchina<input id="fa2RegBench" type="number" min="0" value="${reg.bench.size}"></label><label>POR min panchina<input id="fa2RegBenchGk" type="number" min="0" value="${reg.bench.minGoalkeepers}"></label><label>Movimento panchina<input value="Variabili" disabled></label></div><div class="fa2-reg-toggle-grid"><label class="fa2-check"><input id="fa2RegRostersHidden" type="checkbox" ${reg.roster.hidden?"checked":""}><span>Rose invisibili</span></label></div>`;
  const underSection=`<p class="fa2-reg-help">L'anno minimo viene ricalcolato dalla stagione e dall'età massima, mantenendo separati U23 e U21.</p>${fa2RegUnderRow(reg,"u23","U23")}${fa2RegUnderRow(reg,"u21","U21")}`;
  const formationSection=`<div class="fa2-reg-grid"><label>Switch<select id="fa2RegSwitch"><option value="off" ${reg.switchMode==="off"?"selected":""}>Disattivato</option><option value="switch" ${reg.switchMode==="switch"?"selected":""}>Switch</option><option value="plus" ${reg.switchMode==="plus"?"selected":""}>Switch Plus</option></select></label><label>Timeout (min)<input id="fa2RegTimeout" type="number" min="0" value="${reg.formation.timeoutMinutes}"></label><label>Formazione non schierata<select id="fa2RegMissing"><option value="previous" selected>Recupera precedente</option></select></label></div><div class="fa2-reg-toggle-grid"><label class="fa2-check"><input id="fa2RegHidden" type="checkbox" ${reg.formation.hidden?"checked":""}><span>Formazioni nascoste</span></label><label class="fa2-check"><input id="fa2RegBookedSV" type="checkbox" ${reg.scoring.bookedNoVote?"checked":""}><span>Ammonito SV = voto 5,5</span></label></div>`;
  const scoringSection=`<div class="fa2-reg-grid"><label>Fonte voti<select id="fa2RegScoreSource"><option value="fantacalcio" ${reg.scoring.source==="fantacalcio"?"selected":""}>Fantacalcio</option><option value="italia" ${reg.scoring.source==="italia"?"selected":""}>Italia</option><option value="statistical" ${reg.scoring.source==="statistical"?"selected":""}>Statistico (Alvin 482)</option></select></label></div><p class="fa2-reg-help">Le statistiche disponibili modificano TARGET, alternative e valore dei profili; i dati mancanti restano neutrali.</p>${fa2RegBonusGrid(reg)}`;
  const thresholdSection=`<div class="fa2-reg-grid"><label>Soglia primo gol<input id="fa2RegFirstGoal" type="number" step="0.5" value="${reg.scoring.goalThreshold.firstGoal}"></label><label>Punti per fascia<input id="fa2RegGoalStep" type="number" min="0.5" step="0.5" value="${reg.scoring.goalThreshold.step}"></label></div><div class="fa2-reg-condition-grid"><div><label class="fa2-check"><input id="fa2RegLimitWin" type="checkbox" ${reg.scoring.limitWin.enabled?"checked":""}><span>Limita vittoria</span></label><label>Differenza ≤<input id="fa2RegLimitWinDelta" type="number" min="0" step="0.5" value="${reg.scoring.limitWin.delta}"></label></div><div><label class="fa2-check"><input id="fa2RegLimitDraw" type="checkbox" ${reg.scoring.limitDraw.enabled?"checked":""}><span>Limita pareggio</span></label><label>Differenza ≥<input id="fa2RegLimitDrawDelta" type="number" min="0" step="0.5" value="${reg.scoring.limitDraw.delta}"></label></div><div><label class="fa2-check"><input id="fa2RegAutoGoal" type="checkbox" ${reg.scoring.autoGoal.enabled?"checked":""}><span>Autogol avversario</span></label><label>Soglia<input id="fa2RegAutoGoalThreshold" type="number" min="0" step="0.5" value="${reg.scoring.autoGoal.threshold}"></label></div></div>`;
  const modifiersSection=`<div class="fa2-reg-toggle-grid"><label class="fa2-check"><input id="fa2RegDFactor" type="checkbox" ${reg.modifiers.dFactor.enabled?"checked":""}><span>D Factor</span></label><label class="fa2-check"><input id="fa2RegDFactorGk" type="checkbox" ${reg.modifiers.dFactor.includeGoalkeeper?"checked":""}><span>Include portiere</span></label></div><div class="fa2-reg-grid"><label>Preset D Factor<select id="fa2RegDFactorPreset"><option value="recommended" ${reg.modifiers.dFactor.preset==="recommended"?"selected":""}>Consigliata</option><option value="custom" ${reg.modifiers.dFactor.preset==="custom"?"selected":""}>Personalizzata</option></select></label><label>Applica a<select id="fa2RegDFactorApply"><option value="own" ${reg.modifiers.dFactor.applyTo==="own"?"selected":""}>Propria squadra</option><option value="opponent" ${reg.modifiers.dFactor.applyTo==="opponent"?"selected":""}>Avversario</option></select></label></div>${fa2RegDFactorBands(reg)}<div class="fa2-reg-toggle-grid"><label class="fa2-check"><input id="fa2RegPerformance" type="checkbox" ${reg.modifiers.performance.enabled?"checked":""}><span>Fattore rendimento</span></label><label class="fa2-check"><input id="fa2RegFair" type="checkbox" ${reg.modifiers.fairplay.enabled?"checked":""}><span>Fattore fairplay</span></label><label class="fa2-check"><input id="fa2RegCaptain" type="checkbox" ${reg.modifiers.captain.enabled?"checked":""}><span>Fattore capitano</span></label><label>Bonus fairplay<input id="fa2RegFairBonus" type="number" step="0.5" value="${reg.modifiers.fairplay.bonus}"></label></div><div class="fa2-reg-pending"><b>Specifiche ancora mancanti</b><span>Soglie dettagliate di Fattore rendimento, Capitano e competizioni F1 non vengono inventate. I toggle sono salvati; l'asta usa soltanto affidabilità e voto storico.</span></div>`;
  return `<div class="card fa2-reg-settings-card"><div class="fa2-reg-settings-head"><div><span>FANTAASTA2.0 · REGOLAMENTO LEGA</span><h3>Regolamento Lega</h3><p>Un'unica configurazione alimenta Strategy Engine, budget e Asta Live senza modificare i dati dell'asta.</p></div><b>α6.0.3</b></div>
    <div class="fa2-reg-mini"><div><span>Partecipanti</span><b>${sum.participants}</b></div><div><span>Bacino</span><b>${sum.analysisPool}</b></div><div><span>Budget</span><b>${sum.budget}</b></div><div><span>Rosa</span><b>${sum.roster}</b></div><div><span>Under</span><b>${sum.under}</b></div><div><span>Switch</span><b>${String(sum.switchMode).toUpperCase()}</b></div><div><span>Voti</span><b>${sum.scoringSource}</b></div><div><span>Gol</span><b>${sum.goalBands}</b></div></div>
    <details id="fa2RegDetails" class="fa2-reg-details"><summary>Apri Regolamento Lega</summary><div class="fa2-reg-studio">
      ${fa2RegStudioSection("Lega e asta",`${sum.participants} partecipanti · ${sum.availability} · ${sum.mode}`,leagueSection,true)}
      ${fa2RegStudioSection("Rosa e panchina",sum.roster,rosterSection)}
      ${fa2RegStudioSection("Under",sum.under,underSection)}
      ${fa2RegStudioSection("Switch e formazione",String(sum.switchMode).toUpperCase(),formationSection)}
      ${fa2RegStudioSection("Calcolo e bonus/malus",sum.scoringSource,scoringSection)}
      ${fa2RegStudioSection("Soglie e risultati",sum.goalBands,thresholdSection)}
      ${fa2RegStudioSection("Modificatori",sum.modifiers,modifiersSection)}
      <div class="fa2-reg-actions"><button id="fa2RegReset" class="ghost" type="button">Ripristina preset</button><button id="fa2RegSave" class="primary" type="button">SALVA REGOLAMENTO</button></div>
    </div></details><button id="fa2OpenStrategy" class="ghost fa2-open-strategy" type="button">Apri Strategia</button></div>`;
}
function fa2ReadNumber(id,fallback=0){const el=$(id);const n=Number(el?.value);return Number.isFinite(n)?n:fallback}
function fa2BindRegulationSettings(){
  if(!window.FA2Regulation||!$("#fa2RegSave"))return;
  $("#fa2OpenStrategy").onclick=()=>switchView("strategyView");
  $("#fa2RegReset").onclick=()=>{if(confirm("Ripristinare il preset 'La mia lega'?")){FA2Regulation.reset();sessionStorage.removeItem("fa2_strategy_result_v35");renderSettings()}};
  $("#fa2RegSave").onclick=()=>{
    const old=FA2Regulation.load(),reg=FA2Regulation.load();
    reg.name=$("#fa2RegName").value.trim()||old.name;reg.season=$("#fa2RegSeason").value.trim()||old.season;
    reg.league={...(reg.league||{}),participants:fa2ReadNumber("#fa2RegParticipants",old.league?.participants||8)};
    reg.availability=$("#fa2RegAvailability").value;reg.gameMode=$("#fa2RegMode").value;
    reg.budget.initial=fa2ReadNumber("#fa2RegBudget",old.budget.initial);reg.budget.minBid=fa2ReadNumber("#fa2RegMinBid",old.budget.minBid);reg.budget.minResidualPerSlot=fa2ReadNumber("#fa2RegMinResidual",old.budget.minResidualPerSlot);
    reg.roster.total=fa2ReadNumber("#fa2RegRoster",old.roster.total);reg.roster.goalkeepers=fa2ReadNumber("#fa2RegGk",old.roster.goalkeepers);reg.roster.clubLimit=fa2ReadNumber("#fa2RegClub",old.roster.clubLimit);
    const seasonStart=FA2Regulation.seasonStartYear(reg.season);
    ["u23","u21"].forEach(id=>{let r=(reg.underRules||[]).find(x=>x.id===id);if(!r){r={id,label:id.toUpperCase()};reg.underRules.push(r)}r.enabled=$("#fa2_"+id+"_enabled").checked;r.maxAge=fa2ReadNumber("#fa2_"+id+"_age",id==="u21"?21:23);r.min=fa2ReadNumber("#fa2_"+id+"_min",0);r.birthYearFrom=seasonStart-r.maxAge});
    const structural=old.league?.participants!==reg.league.participants||old.budget.initial!==reg.budget.initial||old.roster.total!==reg.roster.total||old.roster.goalkeepers!==reg.roster.goalkeepers||old.availability!==reg.availability||old.gameMode!==reg.gameMode;
    if(structural&&currentAssignmentCount()>0&&!confirm("L'asta contiene già assegnazioni. Salvare comunque le nuove regole? I dati esistenti non verranno cancellati."))return;
    FA2Regulation.save(reg);sessionStorage.removeItem("fa2_strategy_result_v35");renderSettings();
  };
  return;
  const syncDFactorPreset=()=>{$$("[data-fa2-dfactor-field]").forEach(input=>{input.disabled=$("#fa2RegDFactorPreset").value!=="custom"})};
  $("#fa2RegDFactorPreset").onchange=syncDFactorPreset;syncDFactorPreset();
  $("#fa2RegSave").onclick=()=>{
    const old=FA2Regulation.load(),reg=FA2Regulation.load();
    reg.name=$("#fa2RegName").value.trim()||old.name;reg.season=$("#fa2RegSeason").value.trim()||old.season;
    reg.league={...(reg.league||{}),participants:fa2ReadNumber("#fa2RegParticipants",old.league?.participants||8)};
    reg.availability=$("#fa2RegAvailability").value;reg.gameMode=$("#fa2RegMode").value;reg.switchMode=$("#fa2RegSwitch").value;
    reg.budget.initial=fa2ReadNumber("#fa2RegBudget",old.budget.initial);reg.budget.minBid=fa2ReadNumber("#fa2RegMinBid",old.budget.minBid);reg.budget.minResidualPerSlot=fa2ReadNumber("#fa2RegMinResidual",old.budget.minResidualPerSlot);
    reg.roster.total=fa2ReadNumber("#fa2RegRoster",old.roster.total);reg.roster.goalkeepers=fa2ReadNumber("#fa2RegGk",old.roster.goalkeepers);reg.roster.clubLimit=fa2ReadNumber("#fa2RegClub",old.roster.clubLimit);reg.roster.hidden=$("#fa2RegRostersHidden").checked;
    reg.bench.size=fa2ReadNumber("#fa2RegBench",old.bench.size);reg.bench.minGoalkeepers=fa2ReadNumber("#fa2RegBenchGk",old.bench.minGoalkeepers);reg.formation.timeoutMinutes=fa2ReadNumber("#fa2RegTimeout",old.formation.timeoutMinutes);reg.formation.hidden=$("#fa2RegHidden").checked;reg.formation.missingLineup="previous";reg.scoring.bookedNoVote=$("#fa2RegBookedSV").checked;
    const seasonStart=FA2Regulation.seasonStartYear(reg.season);
    ["u23","u21"].forEach(id=>{let r=(reg.underRules||[]).find(x=>x.id===id);if(!r){r={id,label:id.toUpperCase()};reg.underRules.push(r)}r.enabled=$("#fa2_"+id+"_enabled").checked;r.maxAge=fa2ReadNumber("#fa2_"+id+"_age",id==="u21"?21:23);r.min=fa2ReadNumber("#fa2_"+id+"_min",0);r.birthYearFrom=seasonStart-r.maxAge});
    reg.scoring.source=$("#fa2RegScoreSource").value;FA2_REG_BONUS_FIELDS.forEach(([key])=>{reg.scoring.bonuses[key]=fa2ReadNumber("#fa2Bonus_"+key,old.scoring.bonuses[key])});
    reg.scoring.goalThreshold.firstGoal=fa2ReadNumber("#fa2RegFirstGoal",old.scoring.goalThreshold.firstGoal);reg.scoring.goalThreshold.step=fa2ReadNumber("#fa2RegGoalStep",old.scoring.goalThreshold.step);
    reg.scoring.limitWin.enabled=$("#fa2RegLimitWin").checked;reg.scoring.limitWin.delta=fa2ReadNumber("#fa2RegLimitWinDelta",old.scoring.limitWin.delta);reg.scoring.limitDraw.enabled=$("#fa2RegLimitDraw").checked;reg.scoring.limitDraw.delta=fa2ReadNumber("#fa2RegLimitDrawDelta",old.scoring.limitDraw.delta);reg.scoring.autoGoal.enabled=$("#fa2RegAutoGoal").checked;reg.scoring.autoGoal.threshold=fa2ReadNumber("#fa2RegAutoGoalThreshold",old.scoring.autoGoal.threshold);
    reg.modifiers.dFactor.enabled=$("#fa2RegDFactor").checked;reg.modifiers.dFactor.includeGoalkeeper=$("#fa2RegDFactorGk").checked;reg.modifiers.dFactor.preset=$("#fa2RegDFactorPreset").value;reg.modifiers.dFactor.applyTo=$("#fa2RegDFactorApply").value;
    if(reg.modifiers.dFactor.preset==="recommended")reg.modifiers.dFactor.bands=FA2Regulation.DEFAULT_BANDS;else $$('[data-fa2-dfactor-field]').forEach(input=>{const index=Number(input.dataset.fa2DfactorIndex),field=input.dataset.fa2DfactorField;if(reg.modifiers.dFactor.bands[index]&&["gte","lt","value"].includes(field))reg.modifiers.dFactor.bands[index][field]=Number(input.value)||0});
    reg.modifiers.performance.enabled=$("#fa2RegPerformance").checked;reg.modifiers.fairplay.enabled=$("#fa2RegFair").checked;reg.modifiers.fairplay.bonus=fa2ReadNumber("#fa2RegFairBonus",old.modifiers.fairplay.bonus);reg.modifiers.captain.enabled=$("#fa2RegCaptain").checked;
    const structural=old.league?.participants!==reg.league.participants||old.budget.initial!==reg.budget.initial||old.budget.minBid!==reg.budget.minBid||old.budget.minResidualPerSlot!==reg.budget.minResidualPerSlot||old.roster.total!==reg.roster.total||old.roster.goalkeepers!==reg.roster.goalkeepers||old.roster.clubLimit!==reg.roster.clubLimit||old.availability!==reg.availability||old.gameMode!==reg.gameMode;
    if(structural&&currentAssignmentCount()>0&&!confirm("L'asta contiene già assegnazioni. Salvare comunque le nuove regole? I dati esistenti non verranno cancellati."))return;
    FA2Regulation.save(reg);sessionStorage.removeItem("fa2_strategy_result_v35");renderSettings();
  };
}

function renderSettings(){
  $("#settingsView").innerHTML=`<div class="section-title"><h2>Impostazioni</h2></div>
    ${fa2RegulationCard()}
    <div class="card safety-settings-card ${state.protectedMode?"protected":""}">
      <div class="safety-settings-head"><span>${state.protectedMode?"PROTETTA":"LIBERA"}</span><div><h3>Modalità Asta protetta</h3><p>${state.protectedMode?"Reset, import backup ed eliminazione lega sono bloccati.":"Attivala prima dell'asta per evitare operazioni distruttive accidentali."}</p></div></div>
      <button id="toggleProtectionBtn" type="button" aria-pressed="${state.protectedMode?"true":"false"}" class="${state.protectedMode?"dangerbtn":"primary"}">${state.protectedMode?"Disattiva protezione":"Attiva protezione"}</button>
      <div class="toolbar safety-settings-toolbar"><button id="openSafetyCenterBtn" class="ghost">Registro / Undo</button><button id="manualSnapshotBtn" class="ghost">Snapshot ora</button></div>
    </div>
    <div class="card" style="margin-top:10px"><h3>Watchlist</h3><p class="muted">${Object.keys(state.watchlist||{}).length} giocatori seguiti. Usa SEGUI nelle liste o in Asta Live.</p><button id="openWatchlistBtn" class="ghost">Apri watchlist</button></div>
    <div class="card local-data-settings-card" style="margin-top:10px"><h3>Architettura locale A7</h3>
      <p class="muted">L’app usa soltanto il Listone importato manualmente e le operazioni d’asta inserite dall’utente. Non gestisce statistiche, probabili formazioni, infortuni o disciplina.</p>
      <div class="line"><span>Fonte strategia</span><b>LISTONE MANUALE</b></div><div class="line"><span>Fonti esterne</span><b>NESSUNA</b></div>
    </div>
    <div class="card" style="margin-top:10px"><h3>Privacy</h3><p class="muted">Tutti i dati dell'asta restano nel browser del dispositivo. Nessun account e nessun tracciamento.</p>
      <div class="toolbar"><button id="setPin" class="ghost">${state.pin?"Cambia PIN":"Imposta PIN"}</button>${state.pin?'<button id="removePin" class="ghost">Rimuovi PIN</button>':""}</div>
    </div>
    <div class="card clean-data-settings-card" style="margin-top:10px"><h3>Dati e copyright</h3>
      <p class="muted">Nessun database sportivo è incluso nell’app. Il listone viene scelto dall’utente, ripulito dai metadati non necessari e conservato soltanto nel browser.</p>
      <div class="line"><span>Scraping</span><b>DISATTIVATO</b></div><div class="line"><span>Aggiornamenti automatici</span><b>DISATTIVATI</b></div><div class="line"><span>Invio del listone</span><b>NESSUNO</b></div>
      <button id="openTechnicalInfoBtn" class="ghost clean-data-download" type="button">Apri informativa tecnica</button>
    </div>
    <div id="backupCard" class="card backup-settings-card" style="margin-top:10px"><h3>Backup</h3>
      <div class="toolbar"><button id="exportBtn" class="primary">Esporta backup</button><label class="ghost ${state.protectedMode?"disabled-control":""}" style="margin:0">Importa backup<input id="importFile" type="file" accept=".json" hidden ${state.protectedMode?"disabled":""}></label></div>
      ${state.protectedMode?'<p class="muted safety-lock-note">Import bloccato durante Asta protetta.</p>':""}
    </div>
    <div class="card" style="margin-top:10px"><h3>Report</h3><button id="finalReportBtn" class="ghost">Apri report asta</button></div>
    <div class="card" style="margin-top:10px"><h3>Reset</h3><button id="resetBtn" class="dangerbtn" ${state.protectedMode?"disabled":""}>${state.protectedMode?"Reset bloccato":"Azzera tutta l'asta"}</button></div>
    <div class="card install-note" style="margin-top:10px"><b>Installazione su iPhone</b><br>Apri il sito in Safari → Condividi → Aggiungi alla schermata Home → attiva “Apri come app” se disponibile.</div>`;
  fa2BindRegulationSettings();
  $("#toggleProtectionBtn").onclick=toggleProtectedMode;
  $("#openSafetyCenterBtn").onclick=openSafetyCenter;
  $("#manualSnapshotBtn").onclick=()=>{createSafetySnapshot("Snapshot manuale");renderSettings()};
  $("#openTechnicalInfoBtn").onclick=openTechnicalInformation;
  $("#openWatchlistBtn").onclick=()=>{state.filter="Preferiti";switchView("playersView")};
  $("#finalReportBtn").onclick=openFinalReport;
  $("#setPin").onclick=()=>{let p=prompt("Scegli un PIN numerico (4-8 cifre):");if(/^\d{4,8}$/.test(p||"")){localStorage.setItem("fa2_pin",p);state.pin=p;alert("PIN salvato.");renderSettings()}};
  if($("#removePin"))$("#removePin").onclick=()=>{if(state.protectedMode&&!protectedPermission("rimuovere il PIN"))return;localStorage.removeItem("fa2_pin");state.pin="";renderSettings()};
  $("#resetBtn").onclick=()=>{
    if(blockedByProtection("Azzera tutta l'asta"))return;
    if(confirm("Vuoi davvero cancellare acquisti e giocatori venduti e riportare la fase asta ai POR?")){
      const before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();state.purchases={};state.sold={};state.repairMarket=normalizeRepairMarket(null);state.auctionPhase="POR";save();saveSold();saveRepairMarket();saveAuctionPhase();fa2AfterAuctionStateChange("AUCTION_RESET","",strategyBefore);resetBackupReminderCounters();recordOperation("RESET","Asta azzerata",before);refresh();
    }
  };
  $("#exportBtn").onclick=()=>{
    const backupActionCount=getBackupActionCount();
    const regulation=window.FA2Regulation?.load?.()||null,strategyPlan=fa2LoadPurchasePlan();
    let blob=new Blob([JSON.stringify({version:11,purchases:state.purchases,sold:state.sold,repairMarket:state.repairMarket,strategy:state.strategy,poolMode:state.poolMode,league:state.league,auctionPhase:state.auctionPhase,listoneSync:appliedListoneSync,watchlist:state.watchlist,protectedMode:state.protectedMode,operationLog:state.operationLog,snapshots:state.snapshots,backupActionCount,regulation,strategyPlan},null,2)],{type:"application/json"});
    const backupUrl=URL.createObjectURL(blob);
    let a=document.createElement("a");a.href=backupUrl;a.download="AstaMantra-backup-v11.json";document.body.appendChild(a);a.click();a.remove();
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    markExternalBackupDone();
    settleIOSViewport();
    setTimeout(()=>URL.revokeObjectURL(backupUrl),1500);
  };
  $("#importFile").onchange=e=>{
    if(blockedByProtection("Importare un backup")){e.target.value="";return;}
    let f=e.target.files[0];if(!f)return;let rd=new FileReader();rd.onload=()=>{try{
      let o=JSON.parse(rd.result),before=captureAuctionCore(),strategyBefore=fa2CaptureStrategySlotStates();
      state.purchases=o.purchases||{};state.sold=o.sold||{};state.repairMarket=normalizeRepairMarket(o.repairMarket||null);state.league=o.league||state.league||null;
      if(STRATEGIES[o.strategy]){state.strategy=o.strategy;localStorage.setItem("fa2_strategy",o.strategy)}
      if(["strategic","all"].includes(o.poolMode)){state.poolMode=o.poolMode;localStorage.setItem("fa2_pool_mode",o.poolMode)}
      if(AUCTION_PHASES.some(x=>x.id===o.auctionPhase)){state.auctionPhase=o.auctionPhase;saveAuctionPhase()}
      if(o.listoneSync?.schema===LISTONE_SYNC_SCHEMA&&Array.isArray(o.listoneSync.players)){appliedListoneSync=o.listoneSync;localStorage.setItem(LISTONE_SYNC_STORAGE,JSON.stringify(appliedListoneSync));allPlayers=buildAllPlayers()}
      if(o.regulation&&window.FA2Regulation?.save)FA2Regulation.save(o.regulation);
      if(o.strategyPlan?.slots)fa2SavePurchasePlan(o.strategyPlan);
      state.watchlist=o.watchlist||{};
      if(Array.isArray(o.operationLog))state.operationLog=o.operationLog.slice(-100);
      if(Array.isArray(o.snapshots))state.snapshots=o.snapshots.slice(-8);
      const importedBackupCount=Math.max(Number(o.backupActionCount)||0,Object.keys(state.purchases||{}).length+Object.keys(state.sold||{}).length);
      localStorage.setItem(SAFETY_KEYS.backupActionCount,String(importedBackupCount));
      localStorage.setItem(SAFETY_KEYS.lastBackupActionCount,String(importedBackupCount));
      save();saveSold();saveRepairMarket();saveLeague();saveSafetyState();fa2AfterAuctionStateChange("BACKUP_IMPORTED","",strategyBefore);recordOperation("IMPORT","Backup importato",before,{undoable:true,count:false});refresh();alert("Backup importato.")
    }catch{alert("File non valido.")}};rd.readAsText(f)
  };
}
function switchView(id,{historyEntry=true}={}){
  const target=document.getElementById(id);if(!target)return;
  const previousView=state.view,app=document.getElementById("app");
  state.view=id;
  if(historyEntry&&previousView!==id&&window.history?.pushState)history.pushState({fa2View:id},"");
  $$('.view').forEach(v=>{
    const active=v.id===id;
    v.classList.toggle("active",active);
    v.setAttribute("aria-hidden",active?"false":"true");
  });
  $$('.tab').forEach(t=>{
    const active=t.dataset.view===id;
    t.classList.toggle("active",active);
    if(active)t.setAttribute("aria-current","page");else t.removeAttribute("aria-current");
  });
  const settingsBtn=$("#settingsBtn"),settingsActive=id==="settingsView";
  settingsBtn?.classList.toggle("active",settingsActive);
  if(settingsActive)settingsBtn?.setAttribute("aria-current","page");else settingsBtn?.removeAttribute("aria-current");
  if(id==="dashboardView")renderDashboard();
  if(id==="playersView"){
    if(previousView!==id)playerVisibleLimit=PLAYER_PAGE_SIZE;
    renderPlayers();
  }
  if(id==="squadView")renderSquad();
  if(id==="strategyView")renderStrategyView();
  if(id==="leagueView")renderLeagues();
  if(id==="settingsView")renderSettings();
  if(app&&previousView!==id){
    app.scrollTop=0;
    requestAnimationFrame(()=>{app.scrollTop=0});
  }
  normalizeIOSViewport();
}
let fa2HandlingHistory=false;
function fa2InstallNavigationHistory(){
  if(!window.history?.replaceState)return;
  history.replaceState({fa2View:state.view||"dashboardView"},"");
  if(typeof HTMLDialogElement!=="undefined"){
    const nativeShowModal=HTMLDialogElement.prototype.showModal;
    if(nativeShowModal&&!nativeShowModal.fa2Wrapped){
      const wrapped=function(){
        if(!this.open)history.pushState({fa2View:state.view,fa2Dialog:this.id},"");
        return nativeShowModal.call(this);
      };
      wrapped.fa2Wrapped=true;
      HTMLDialogElement.prototype.showModal=wrapped;
    }
    $$('dialog').forEach(dialog=>dialog.addEventListener("close",()=>{
      if(!fa2HandlingHistory&&history.state?.fa2Dialog===dialog.id)history.replaceState({fa2View:state.view},"");
    }));
  }
  window.addEventListener("popstate",event=>{
    fa2HandlingHistory=true;
    const openDialog=document.querySelector("dialog[open]");
    if(openDialog)openDialog.close();
    const view=event.state?.fa2View;
    if(view&&document.getElementById(view))switchView(view,{historyEntry:false});
    queueMicrotask(()=>{fa2HandlingHistory=false});
  });
}
$$('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$("#settingsBtn").onclick=()=>switchView("settingsView");
$("#backupAlertBtn").onclick=openBackupReminder;
function refresh(){
  renderDashboard();renderPlayers();renderSquad();renderLeagues();
  if(state.view==="strategyView")renderStrategyView();
  if(state.view==="settingsView")renderSettings();
  updateBackupAlert();
}


/* v1.42.2 — viewport iOS stabile.
   La barra inferiore non viene più spostata in JavaScript.
   Il contenuto scorre dentro #app; la pagina radice resta ferma. */
function normalizeIOSViewport(){
  const app=document.getElementById("app");
  const appY=app ? app.scrollTop : 0;
  window.scrollTo(0,0);
  document.documentElement.scrollTop=0;
  document.body.scrollTop=0;
  if(app && app.scrollTop!==appY)app.scrollTop=appY;
}
function settleIOSViewport(){
  [0,80,220,500].forEach(ms=>setTimeout(normalizeIOSViewport,ms));
}
window.addEventListener("pageshow",settleIOSViewport,{passive:true});
window.addEventListener("orientationchange",()=>setTimeout(settleIOSViewport,250),{passive:true});
document.addEventListener("focusout",e=>{
  if(e.target && e.target.matches && e.target.matches("input, textarea, select"))settleIOSViewport();
},{passive:true});

function lockInit(){
  if(!state.pin)return;
  $("#lock").classList.remove("hidden");$("#disablePinBtn").style.display="none";
  $("#unlockBtn").onclick=()=>{if($("#pinInput").value===state.pin)$("#lock").classList.add("hidden");else $("#lockText").textContent="PIN errato. Riprova."};
}
fa2MigrateRegulationParticipantsFromLeague();ensureInitialSnapshot();refresh();fa2InstallNavigationHistory();lockInit();
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js?v=2.0.0-alpha.6.1.0").catch(()=>{}));

/* =========================================================
   FantaAsta2.0 alpha 3.9 — Module Switch Advisor
   Il Budget Runtime A3.8 resta condiviso; il nuovo advisor confronta i
   moduli senza cambiare automaticamente il Piano Strategia.
   ========================================================= */
const FA2_PURCHASE_PLAN_KEY="fa2_strategy_purchase_plan_v1";
const FA2_MODULE_ADVISOR_KEY="fa2_module_switch_advisor_v1";
let fa2LastSlotAnalysis=null;
function fa2CandidateSnapshot(x,label=""){
  if(!x)return null;
  return {
    id:String(x.id??""),name:x.name||"",club:x.club||"",role:x.role||"",label,
    score:Number(x.score)||0,intelligence:Number(x.intelligence)||0,starter:Number(x.starter)||0,
    history:Number(x.history)||0,valueScore:Number(x.valueScore)||0,bridge:Number(x.bridge)||0,
    fvm:Number(x.fvm)||0,neutralMax:Number(x.neutralMax)||0,maxRecommended:Number(x.maxRecommended)||0
  };
}
function fa2NormalizePurchasePlan(raw){
  const plan={schema:2,slots:{},...(raw||{})};plan.slots=plan.slots||{};
  Object.entries(plan.slots).forEach(([key,slot])=>{
    slot=slot||{};
    const roleKey=String(slot.roleKey||fa2SlotRoleKey(key));
    const slotIndex=Math.max(1,Number(slot.slotIndex)||fa2SlotOrdinalFromKey(key));
    const slotCount=Math.max(slotIndex,Number(slot.slotCount)||1);
    const slotLabel=slot.slotLabel||slot.label||(slotCount>1?`${roleKey} ${slotIndex}/${slotCount}`:roleKey);
    const legacySnap=(id,label,maxRecommended=0)=>{const p=getPlayer(id);return id?{id:String(id),name:p?.name||"",club:p?.club||"",role:p?.role||"",label,score:0,intelligence:0,starter:0,history:0,valueScore:0,bridge:0,fvm:Number(p?.fvm)||0,neutralMax:Number(p?.maxPrice)||0,maxRecommended:Number(maxRecommended)||0}:null};
    const target=slot.target||legacySnap(slot.targetId,"TARGET",slot.maxRecommended);
    const alternatives=(slot.alternatives||[]).length?slot.alternatives:(slot.altIds||[]).map((id,i)=>legacySnap(id,`ALT ${i+1}`)).filter(Boolean);
    const values=(slot.values||[]).length?slot.values:(slot.valueIds||[]).map(id=>legacySnap(id,"VALUE")).filter(Boolean);
    const priorityScore=Number(slot.priority?.score??slot.priorityScore)||0;
    const priorityLabel=slot.priority?.label||slot.priorityLabel||(priorityScore>=55?"ALTA":priorityScore>=30?"MEDIA":priorityScore>0?"BASSA":"");
    plan.slots[key]={...slot,key,roleKey,slotIndex,slotCount,slotLabel,roles:slot.roles||roleKey.split('/'),target,alternatives,values,
      targetId:String(target?.id||slot.targetId||""),altIds:alternatives.map(x=>String(x.id)),valueIds:values.map(x=>String(x.id)),
      maxRecommended:Number(target?.maxRecommended||slot.maxRecommended)||0,
      minimumScore:Number(slot.minimumScore)||0,budgetSlot:Number(slot.budgetSlot)||0,
      priority:{score:priorityScore,label:priorityLabel}};
  });
  plan.schema=2;return plan;
}
function fa2LoadPurchasePlan(){
  try{return fa2NormalizePurchasePlan(JSON.parse(localStorage.getItem(FA2_PURCHASE_PLAN_KEY)||"null")||{schema:2,slots:{}})}catch{return {schema:2,slots:{}}}
}
function fa2SavePurchasePlan(plan){
  const value=fa2NormalizePurchasePlan({...plan,schema:2,updatedAt:Date.now()});
  localStorage.setItem(FA2_PURCHASE_PLAN_KEY,JSON.stringify(value));
  fa2InvalidateModuleAdvisor();
  return value;
}
function fa2ClearPurchasePlan(){
  localStorage.removeItem(FA2_PURCHASE_PLAN_KEY);
  fa2InvalidateModuleAdvisor();
  if(state.view==="strategyView")renderStrategyView();
}
function fa2SlotKey(roles){return (roles||[]).slice().sort().join("/")}
function fa2SlotRoleKey(slotKey){return String(slotKey||"").replace(/#\d+$/,'')}
function fa2SlotOrdinalFromKey(slotKey){const m=String(slotKey||"").match(/#(\d+)$/);return m?Math.max(1,Number(m[1])||1):1}
function fa2ModuleSlotInstances(module){
  const rows=(module?.slots||[]).map((roles,moduleIndex)=>({roles:roles.slice(),roleKey:fa2SlotKey(roles),moduleIndex}));
  const totals=new Map();rows.forEach(x=>totals.set(x.roleKey,(totals.get(x.roleKey)||0)+1));
  const seen=new Map();
  return rows.map(x=>{
    const slotIndex=(seen.get(x.roleKey)||0)+1;seen.set(x.roleKey,slotIndex);
    const slotCount=totals.get(x.roleKey)||1,id=slotIndex===1?x.roleKey:`${x.roleKey}#${slotIndex}`;
    return {...x,id,slotIndex,slotCount,label:slotCount>1?`${x.roles.join("/")} ${slotIndex}/${slotCount}`:x.roles.join("/")};
  });
}
function fa2PlanSlotLabel(slot,key=slot?.key||""){
  const roleKey=slot?.roleKey||fa2SlotRoleKey(key),slotIndex=Math.max(1,Number(slot?.slotIndex)||fa2SlotOrdinalFromKey(key)),slotCount=Math.max(slotIndex,Number(slot?.slotCount)||1);
  return slot?.slotLabel||slot?.label||(slotCount>1?`${roleKey} ${slotIndex}/${slotCount}`:roleKey);
}
function fa2PlanSlotMetricsText(slot){
  const parts=[];
  if(Number(slot?.minimumScore)>0)parts.push(`MIN ${Math.round(Number(slot.minimumScore))}/100`);
  if(Number(slot?.budgetSlot)>0)parts.push(`BASE ${fmt(slot.budgetSlot)} cr`);
  if(slot?.priority?.label)parts.push(`PRIORITÀ ${slot.priority.label}`);
  return parts.join(" · ");
}
function fa2BudgetRuntimeHTML(runtime){
  if(!runtime)return "";
  const status=runtime.status==="INSUFFICIENT"?"Budget insufficiente per i minimi":runtime.status==="PROTETTO"?"MAX ridotti per proteggere la chiusura della rosa":"Budget sostenibile";
  const order={POR:0,DIF:1,CEN:2,ATT:3,TOT:4},phases=Object.entries(runtime.phases||{}).filter(([,x])=>x.baseBudget||x.openCount||x.spentCovered).sort((a,b)=>(order[a[0]]??9)-(order[b[0]]??9));
  const phaseHTML=phases.length?`<div class="fa2-budget">${phases.map(([phase,x])=>`<div><span>${esc(phase)} DINAMICO</span><b>${fmt(x.dynamicBudget)} cr</b><small>base ${fmt(x.baseBudget)} · speso ${fmt(x.spentCovered)} · ${pctLabel(x.inflationPct,1)}</small></div>`).join("")}</div>`:"";
  return `<div class="fa2-slot-summary"><div><span>RESIDUO</span><b>${fmt(runtime.remaining)} cr</b></div><div><span>POSTI</span><b>${runtime.missing}</b></div><div><span>RISERVA MINIMA</span><b>${fmt(runtime.reserve)} cr</b></div><div><span>LIBERO</span><b>${fmt(runtime.free)} cr</b></div><div><span>PIANO SLOT</span><b>${fmt(runtime.allocated)} cr</b></div><div><span>INFLAZIONE</span><b>${pctLabel(runtime.overallInflation,1)}</b></div></div><div class="fa2-slot-note">BUDGET RUNTIME · ${esc(status)}. Il calcolo conserva almeno ${fmt(runtime.minBid)} credito per ciascuno dei ${runtime.missing} posti residui.</div>${phaseHTML}`;
}
function fa2PlanReservedCandidateIds(exceptSlotKey=""){
  const ids=new Set(),plan=fa2LoadPurchasePlan();
  Object.entries(plan.slots||{}).forEach(([key,slot])=>{
    if(String(key)===String(exceptSlotKey))return;
    [slot?.target,...(slot?.alternatives||[]),...(slot?.values||[])].filter(Boolean).forEach(x=>{if(String(x.id??""))ids.add(String(x.id))});
  });
  return ids;
}
function fa2PlanPlayerState(id){
  const p=getPlayer(id);if(!p)return {label:"NON IN LISTONE",className:"missing"};
  if(state.purchases?.[p.id])return {label:`MIO · ${fmt(state.purchases[p.id].price||0)} cr`,className:"mine"};
  if(state.sold?.[p.id])return {label:`ASSEGNATO · ${esc(soldTeamName(state.sold[p.id]))}`,className:"lost"};
  if(p.outOfListone)return {label:"FUORI LISTONE",className:"lost"};
  return {label:"DISPONIBILE",className:"available"};
}
function fa2CandidateIsAvailable(x){
  const p=getPlayer(x?.id);return !!p&&isMarketEligiblePlayer(p)&&!state.purchases?.[p.id]&&!state.sold?.[p.id]&&!p.outOfListone;
}
function fa2PlanCandidateAuctionState(id){
  const playerStates=window.FA2Strategy?.SLOT_PLAYER_STATES||{};
  const p=getPlayer(id);
  if(!p)return playerStates.MISSING||"MISSING";
  if(state.purchases?.[p.id])return playerStates.OWNED||"OWNED";
  if(state.sold?.[p.id]||p.outOfListone)return playerStates.LOST||"LOST";
  if(isMarketEligiblePlayer(p))return playerStates.AVAILABLE||"AVAILABLE";
  return playerStates.MISSING||"MISSING";
}
function fa2RawPlanRuntimeSlots(){
  const plan=fa2LoadPurchasePlan(),resolver=window.FA2Strategy?.resolvePlanSlots;
  if(typeof resolver!=="function")return [];
  return resolver(plan,fa2PlanCandidateAuctionState);
}
let fa2LastBudgetRuntime=null;
function fa2BuildPlanBudgetRuntime(runtimes){
  const engine=window.FA2Strategy,rebalance=engine?.rebalanceBudget,mine=teamEconomy(mineTeam()),reg=currentRegulation(),minBid=configuredReservePerSlot();
  if(typeof rebalance!=="function")return {remaining:mine.remaining,missing:mine.missing,minBid,reserve:mine.minimumToFinish,free:mine.free,maxNext:mine.maxNext,overallInflation:0,status:"OK",slots:{},phases:{}};
  const inflationCache=new Map(),inflationFor=phase=>{
    if(!inflationCache.has(phase))inflationCache.set(phase,inflationStats(p=>playerAuctionPhase(p)===phase));
    return inflationCache.get(phase);
  };
  const slots=(runtimes||[]).map(rt=>{
    const reference=rt.current||rt.coveredBy||rt.originalTarget||rt.slot?.target||null;
    const player=getPlayer(reference?.id)||reference,phase=playerAuctionPhase(player),inflation=inflationFor(phase);
    const coveredId=String(rt.coveredBy?.id||""),coveredPlayer=getPlayer(coveredId);
    const paid=coveredId?Number(state.purchases?.[coveredPlayer?.id??coveredId]?.price||0):0;
    return {
      key:rt.key,state:rt.state,open:mine.missing>0&&!rt.covered&&!!rt.current,covered:!!rt.covered,phase,paid,
      baseBudget:Number(rt.slot?.budgetSlot)||Number(rt.slot?.maxRecommended)||Number(reference?.maxRecommended)||minBid,
      baseCap:Number(rt.current?.maxRecommended||reference?.maxRecommended||rt.slot?.maxRecommended)||minBid,
      priorityScore:Number(rt.slot?.priority?.score||rt.slot?.priorityScore)||0,
      inflationPct:Number(inflation?.pct)||0,inflationConfidence:Number(inflation?.confidence)||0
    };
  });
  const overall=inflationStats();
  return rebalance({remaining:mine.remaining,missing:mine.missing,minBid,overallInflation:overall.pct,slots});
}
function fa2PlanRuntimeSlots(){
  const runtimes=fa2RawPlanRuntimeSlots(),budgetRuntime=fa2BuildPlanBudgetRuntime(runtimes);
  fa2LastBudgetRuntime=budgetRuntime;
  return runtimes.map(runtime=>{
    runtime.budgetInfo=budgetRuntime.slots?.[runtime.key]||null;
    runtime.dynamicBudget=Number(runtime.budgetInfo?.dynamicBudget)||0;
    runtime.budgetRuntime=budgetRuntime;
    runtime.currentCap=runtime.current?fa2DynamicStrategicCap(runtime.slot,runtime.current,runtime):0;
    return runtime;
  });
}
let fa2ModuleAdvisorCache={fingerprint:"",result:null};
function fa2InvalidateModuleAdvisor(){fa2ModuleAdvisorCache={fingerprint:"",result:null}}
function fa2ModuleAdvisorFingerprint(primaryId,secondaryId,reg){
  const own=Object.entries(state.purchases||{}).map(([id,x])=>`${id}:${Number(x?.price)||0}`).sort();
  const sold=Object.entries(state.sold||{}).map(([id,x])=>`${id}:${Number(x?.price)||0}:${x?.teamId||""}`).sort();
  return JSON.stringify([
    primaryId,secondaryId,own,sold,state.auctionPhase,reg,
    appliedListoneSync?.generatedAt||""
  ]);
}
function fa2LoadModuleAdvisorState(){
  try{return JSON.parse(localStorage.getItem(FA2_MODULE_ADVISOR_KEY)||"null")||{}}catch{return {}}
}
function fa2SaveModuleAdvisorState(advisor){
  if(!advisor)return;
  const previous=fa2LoadModuleAdvisorState(),next={
    schema:1,currentPrimaryId:advisor.currentPrimaryId,status:advisor.status,
    recommendedPrimaryId:advisor.recommendedPrimaryId,recommendedSecondaryId:advisor.recommendedSecondaryId
  };
  if(JSON.stringify(previous)!==JSON.stringify(next))localStorage.setItem(FA2_MODULE_ADVISOR_KEY,JSON.stringify(next));
}
function fa2GetModuleAdvisor(){
  const engine=window.FA2Strategy,advise=engine?.adviseModuleSwitch;
  if(typeof advise!=="function")return null;
  const profile=engine.loadProfile(),plan=fa2LoadPurchasePlan(),hasPlan=Object.keys(plan.slots||{}).length>0;
  const primaryId=String(hasPlan&&plan.primaryId?plan.primaryId:profile.primary),secondaryId=String(hasPlan&&plan.secondaryId?plan.secondaryId:profile.secondary);
  const reg=window.FA2Regulation?.load?.()||{},fingerprint=fa2ModuleAdvisorFingerprint(primaryId,secondaryId,reg);
  if(fa2ModuleAdvisorCache.fingerprint===fingerprint)return fa2ModuleAdvisorCache.result;
  const econ=teamEconomy(mineTeam()),base=fa2StrategyContext(reg,"live");
  const ctx={
    ...base,
    isOwned:p=>!!state.purchases?.[p?.id],
    isMarketAvailable:p=>!!p&&isMarketEligiblePlayer(p)&&!state.purchases?.[p.id]&&(reg?.availability==="multiple"||!state.sold?.[p.id]),
    freeBudget:econ.free,remainingBudget:econ.remaining,missingRoster:econ.missing
  };
  const advisor=advise({
    players:allPlayers,reg,ctx,currentPrimaryId:primaryId,currentSecondaryId:secondaryId,
    previous:fa2LoadModuleAdvisorState(),marketEvents:auctionTransactions().length
  });
  fa2ModuleAdvisorCache={fingerprint,result:advisor};fa2SaveModuleAdvisorState(advisor);
  return advisor;
}
function fa2ModuleAdvisorHTML(advisor=fa2GetModuleAdvisor()){
  if(!advisor?.current||!advisor?.recommendedPrimary)return "";
  const change=advisor.status==="SWITCH",current=advisor.current,recommended=advisor.recommendedPrimary,secondary=advisor.recommendedSecondary;
  const fitTotal=Math.min(Number(advisor.ownedCount)||0,11),fit=recommended.fit||{};
  const title=change?"CAMBIO MODULO CONSIGLIATO":"MODULO CONFERMATO";
  const route=change?`${current.module.name} → ${recommended.module.name}`:`Continua con ${current.module.name}`;
  const reasons=(advisor.reasons||[]).map(esc).join(" · ");
  return `<div class="fa2-saved-plan ${change?"stale":"active"}"><div class="fa2-saved-head"><div><b>MODULE SWITCH ADVISOR · α3.9</b><span>${esc(title)}${advisor.hysteresisHeld?" · consiglio stabilizzato":""}</span></div></div><div class="fa2-result-head"><div><span>${esc(title)}</span><b>${esc(route)}</b><small>Alternativa consigliata: ${esc(secondary?.module?.name||"—")}</small></div><b class="fa2-score">${change?`+${advisor.delta}`:current.score}<small>${change?" punti":"/100"}</small></b></div><div class="fa2-slot-summary"><div><span>ATTUALE</span><b>${current.score}/100</b></div><div><span>CONSIGLIATO</span><b>${recommended.score}/100</b></div><div><span>SOGLIA</span><b>${advisor.enterThreshold}</b></div><div><span>CONFIDENZA</span><b>${advisor.confidence}%</b></div><div><span>ACQUISTI FIT</span><b>${fit.matched||0}/${fitTotal}</b></div><div><span>STIMA CHIUSURA XI</span><b>${fmt(recommended.estimatedCompletion)} cr</b></div></div><div class="fa2-slot-note">${reasons}</div><div class="fa2-bridge"><b>Decisione assistita:</b> il modulo e il Piano Strategia non vengono modificati automaticamente.${change?` Per applicare il consiglio, seleziona ${esc(recommended.module.name)} come principale, ${esc(secondary?.module?.name||"un secondo modulo")} come alternativa e rigenera la strategia.`:""}</div></div>`;
}
function fa2LiveModuleAdvisorHTML(){
  const advisor=fa2GetModuleAdvisor();if(advisor?.status!=="SWITCH")return "";
  const next=advisor.recommendedPrimary?.module?.name||"—",secondary=advisor.recommendedSecondary?.module?.name||"—";
  return `<div class="live-strategy-signal dynamic"><span class="live-target-symbol">CAMBIO</span><div><b>${esc(next)} CONSIGLIATO · +${advisor.delta}</b><small>Attuale ${esc(advisor.current?.module?.name||"—")} · alternativa ${esc(secondary)} · soglia ${advisor.enterThreshold}. Il Piano Strategia resta invariato.</small></div></div>`;
}
function fa2CaptureStrategySlotStates(){
  const snapshot={};
  fa2PlanRuntimeSlots().forEach(rt=>{snapshot[rt.key]={state:rt.state,currentId:String(rt.current?.id||""),coveredById:String(rt.coveredBy?.id||"")}});
  return snapshot;
}
let fa2LastStrategyAuctionEvent=null;
function fa2AfterAuctionStateChange(type,playerId,beforeStates=null){
  const eventType=String(type||"AUCTION_CHANGED"),eventPlayerId=String(playerId||"");
  if(["STATE_RESTORED","AUCTION_RESET","BACKUP_IMPORTED","ROSTERS_IMPORTED"].includes(eventType)||(["PLAYER_PURCHASE_REMOVED","PLAYER_PURCHASE_UNDONE"].includes(eventType)&&fa2LastPurchaseReminder?.playerId===eventPlayerId))fa2LastPurchaseReminder=null;
  invalidateAuctionIntel();
  fa2InvalidateModuleAdvisor();
  const afterStates=fa2CaptureStrategySlotStates(),before=beforeStates||{};
  const transitions=Object.keys({...before,...afterStates}).map(key=>({key,from:before[key]?.state||null,to:afterStates[key]?.state||null,currentId:afterStates[key]?.currentId||"",coveredById:afterStates[key]?.coveredById||""})).filter(x=>x.from!==x.to||before[x.key]?.currentId!==afterStates[x.key]?.currentId||before[x.key]?.coveredById!==afterStates[x.key]?.coveredById);
  const b=fa2LastBudgetRuntime||{},advisor=fa2GetModuleAdvisor();
  fa2LastStrategyAuctionEvent={type:eventType,playerId:eventPlayerId,at:Date.now(),transitions,budget:{remaining:Number(b.remaining)||0,missing:Number(b.missing)||0,reserve:Number(b.reserve)||0,free:Number(b.free)||0,maxNext:Number(b.maxNext)||0,allocated:Number(b.allocated)||0,inflation:Number(b.overallInflation)||0,status:b.status||""},moduleAdvisor:advisor?{status:advisor.status,currentPrimaryId:advisor.currentPrimaryId,recommendedPrimaryId:advisor.recommendedPrimaryId,recommendedSecondaryId:advisor.recommendedSecondaryId,delta:advisor.delta,threshold:advisor.enterThreshold,confidence:advisor.confidence}:null};
  try{window.dispatchEvent(new CustomEvent("fa2:strategy-slots-changed",{detail:fa2LastStrategyAuctionEvent}))}catch{}
  return fa2LastStrategyAuctionEvent;
}
function fa2DynamicStrategicCap(slot,candidate,runtimeHint=null){
  const base=Math.max(1,Number(candidate?.maxRecommended||slot?.maxRecommended||0));
  if(!base)return 0;
  const mine=teamEconomy(mineTeam()),info=runtimeHint?.budgetInfo||{baseBudget:Number(slot?.budgetSlot)||base,dynamicBudget:Number(slot?.budgetSlot)||base,baseCap:base};
  const dynamicCap=window.FA2Strategy?.dynamicCandidateCap;
  return typeof dynamicCap==="function"?dynamicCap(candidate,info,runtimeHint?.budgetRuntime?.maxNext??mine.maxNext):Math.max(1,Math.min(base,mine.maxNext||base));
}
function fa2PlayerPlanMembership(p){
  const id=String(p?.id??""),out=[],slotStates=window.FA2Strategy?.SLOT_STATES||{};
  for(const rt of fa2PlanRuntimeSlots()){
    const slotLabel=fa2PlanSlotLabel(rt.slot,rt.key);
    const budgetMeta={dynamicBudget:Number(rt.dynamicBudget)||0,baseBudget:Number(rt.budgetInfo?.baseBudget)||0,budgetDelta:Number(rt.budgetInfo?.deltaBudget)||0,inflation:Number(rt.budgetInfo?.inflationPct)||0,budgetStatus:rt.budgetRuntime?.status||""};
    if(rt.state===slotStates.COVERED){
      if(String(rt.coveredBy?.id||"")===id)out.push({slot:slotLabel,label:"COPERTURA",rank:-2,candidate:rt.coveredBy,maxRecommended:0,runtime:true,...budgetMeta});
      continue;
    }
    if(String(rt.current?.id||"")===id){
      out.push({slot:slotLabel,label:rt.state===slotStates.PROMOTED?"TARGET PROMOSSO":"TARGET",rank:-1,candidate:rt.current,maxRecommended:rt.currentCap,runtime:true,...budgetMeta});
      continue;
    }
    const altIndex=rt.alternatives.findIndex(x=>String(x.id)===id);
    if(altIndex>=0){
      const candidate=rt.alternatives[altIndex];
      out.push({slot:slotLabel,label:`ALT ${altIndex+1}`,rank:altIndex+1,candidate,maxRecommended:fa2DynamicStrategicCap(rt.slot,candidate,rt),runtime:true,...budgetMeta});
      continue;
    }
    const value=(rt.slot?.values||[]).find(x=>String(x?.id||"")===id&&fa2CandidateIsAvailable(x));
    if(value)out.push({slot:slotLabel,label:"VALUE",rank:9,candidate:value,maxRecommended:fa2DynamicStrategicCap(rt.slot,value,rt),runtime:true,...budgetMeta});
  }
  return out.sort((a,b)=>a.rank-b.rank||b.maxRecommended-a.maxRecommended);
}
function fa2StrategyGuidanceForPlayer(p){
  const member=fa2PlayerPlanMembership(p)[0];
  if(!member)return null;
  const plan=fa2LoadPurchasePlan();
  return {...member,primaryName:plan.primaryName||"",secondaryName:plan.secondaryName||"",planUpdatedAt:plan.updatedAt||0};
}
function fa2PlayerPlanHTML(p){
  const tags=fa2PlayerPlanMembership(p);if(!tags.length)return "";
  const plan=fa2LoadPurchasePlan(),top=tags[0],cap=Number(top.maxRecommended)||0;
  const version=String(plan.version||"A3.x").replace(/^A/,"α");
  return `<section class="fa2-player-plan alpha34"><div><span>PIANO STRATEGIA ${esc(version)}</span><b>${tags.map(x=>`${esc(x.label)} · ${esc(x.slot)}`).join(" · ")}</b><small>${plan.primaryName?`${esc(plan.primaryName)}${plan.secondaryName?` + ${esc(plan.secondaryName)}`:""}`:"Strategia salvata"}</small></div>${cap?`<div class="fa2-plan-cap"><span>MAX STRATEGICO</span><b>${fmt(cap)}</b>${top.dynamicBudget?`<span> · SLOT ${fmt(top.dynamicBudget)}</span>`:""}</div>`:""}</section>`;
}
function fa2PlanCandidateName(x){const p=getPlayer(x?.id);return p?.name||x?.name||"—"}
function fa2SavedPlanHTML(result){
  const plan=fa2LoadPurchasePlan(),entries=Object.entries(plan.slots||{}),runtimes=fa2PlanRuntimeSlots(),runtimeByKey=new Map(runtimes.map(x=>[x.key,x])),slotStates=window.FA2Strategy?.SLOT_STATES||{};
  if(!entries.length)return `<div class="fa2-saved-plan empty"><div><b>PIANO ACQUISTI</b><span>Nessuno slot bloccato. Apri uno slot e salva TARGET + ALT.</span></div></div>`;
  const currentModule=result?.primary?.module?.id,stale=plan.primaryId&&currentModule&&plan.primaryId!==currentModule,econ=teamEconomy(mineTeam());
  const rows=entries.map(([key,slot])=>{
    const rt=runtimeByKey.get(key),canReopen=!!result?.primary&&!stale,slotLabel=fa2PlanSlotLabel(slot,key),metrics=fa2PlanSlotMetricsText(slot);
    if(rt?.state===slotStates.COVERED){
      const p=getPlayer(rt.coveredBy?.id),price=p?state.purchases?.[p.id]?.price:0;
      return `<div class="fa2-plan-row rich covered"><span>${esc(slotLabel)}</span><button type="button" class="fa2-plan-target" onclick='openPlayer(${idArg(rt.coveredBy?.id)})'><b>${esc(fa2PlanCandidateName(rt.coveredBy))}</b><small>ACQUISTATO ${price?fmt(price)+" cr":""}</small></button><em>COPERTO</em><small class="fa2-plan-alts">Slot completato: le alternative non vengono più inseguite.${metrics?` · ${esc(metrics)}`:""}</small>${canReopen?`<button type="button" class="fa2-plan-reopen" data-fa2-slot-open="${esc(key)}">Rianalizza slot</button>`:""}</div>`;
    }
    if(rt?.state===slotStates.LOST_EXHAUSTED){
      const target=rt.originalTarget||slot.target||{};
      return `<div class="fa2-plan-row rich lost"><span>${esc(slotLabel)}</span><button type="button" class="fa2-plan-target" onclick='openPlayer(${idArg(target.id)})'><b>${esc(fa2PlanCandidateName(target))}</b><small>Nessun candidato disponibile</small></button><em>ESAURITO</em><small class="fa2-plan-alts">TARGET, alternative e VALUE salvati non sono più disponibili.${metrics?` · ${esc(metrics)}`:""}</small>${canReopen?`<button type="button" class="fa2-plan-reopen" data-fa2-slot-open="${esc(key)}">Rianalizza slot</button>`:""}</div>`;
    }
    if(rt?.state===slotStates.OPEN){
      return `<div class="fa2-plan-row rich"><span>${esc(slotLabel)}</span><div class="fa2-plan-target"><b>Slot aperto</b><small>Nessun TARGET salvato</small></div><em>APERTO</em><small class="fa2-plan-alts">Rianalizza lo slot per scegliere TARGET e alternative.${metrics?` · ${esc(metrics)}`:""}</small>${canReopen?`<button type="button" class="fa2-plan-reopen" data-fa2-slot-open="${esc(key)}">Rianalizza slot</button>`:""}</div>`;
    }
    const target=rt?.current||slot.target||{},status=fa2PlanPlayerState(target.id),alts=(rt?.alternatives||slot.alternatives||[]).slice(0,3),cap=rt?.currentCap||Number(target.maxRecommended)||0,dynamicBudget=Number(rt?.dynamicBudget)||0;
    const lostName=rt?.promoted?fa2PlanCandidateName(rt.originalTarget):"";
    const stateClass=rt?.state===slotStates.TARGET_ACTIVE?"available":status.className;
    return `<div class="fa2-plan-row rich ${stateClass} ${rt?.state===slotStates.PROMOTED?"promoted":""}"><span>${esc(slotLabel)}</span><button type="button" class="fa2-plan-target" onclick='openPlayer(${idArg(target.id)})'><b>${esc(fa2PlanCandidateName(target))}${rt?.state===slotStates.PROMOTED?' <small class="fa2-promoted-tag">TARGET ↑</small>':""}</b><small>${cap?`MAX STRATEGICO ${fmt(cap)}`:"MAX non salvato"}${dynamicBudget?` · BUDGET DIN. ${fmt(dynamicBudget)}`:""}</small></button><em>${esc(rt?.stateLabel||status.label)}</em><small class="fa2-plan-alts">${lostName?`Perso ${esc(lostName)} · `:""}ALT: ${alts.length?alts.map((x,i)=>`${i+1}. ${esc(fa2PlanCandidateName(x))}`).join(" · "):"—"}${metrics?` · ${esc(metrics)}`:""}</small>${canReopen?`<button type="button" class="fa2-plan-reopen" data-fa2-slot-open="${esc(key)}">Rianalizza slot</button>`:""}</div>`;
  }).join("");
  const covered=runtimes.filter(x=>x.state===slotStates.COVERED).length,exhausted=runtimes.filter(x=>x.state===slotStates.LOST_EXHAUSTED).length,open=Math.max(0,entries.length-covered-exhausted);
  const budgetRuntime=runtimes[0]?.budgetRuntime||fa2LastBudgetRuntime;
  const version=String(plan.version||"A3.x").replace(/^A/,"α");
  const capacityNote=econ.missing<=0?`<div class="fa2-slot-note"><b>ROSA COMPLETA</b> · Gli slot aperti restano nello storico ma non generano TARGET né budget. Uno svincolo o una promessa riattiva il calcolo.</div>`:"";
  return `<div class="fa2-saved-plan active ${stale?"stale":""}"><div class="fa2-saved-head"><div><b>STRATEGIA ATTIVA · ${esc(version)}</b><span>${stale?"Il piano appartiene a un modulo precedente: ricontrollalo.":`${esc(plan.primaryName||"Modulo")} ${plan.secondaryName?`+ ${esc(plan.secondaryName)}`:""} · ${covered} coperti · ${open} aperti${exhausted?` · ${exhausted} esauriti`:""}`}</span></div><button type="button" class="ghost" onclick="fa2ClearPurchasePlan()">Pulisci</button></div>${capacityNote}${fa2BudgetRuntimeHTML(budgetRuntime)}${rows}</div>`;
}
function fa2CandidateHTML(x,badge){
  if(!x)return "";
  const bridge=x.bridge>=75?"forte":x.bridge>=45?"medio":"basso";
  return `<div class="fa2-candidate ${String(badge).toLowerCase().replace(/\s+/g,"-")}">
    <div class="fa2-candidate-main"><em>${esc(badge)}</em><div><b>${esc(x.name)}</b><span>${esc(x.club||"—")} · ${esc(x.role||"—")}</span></div><strong>${x.score}/100</strong></div>
    <div class="fa2-candidate-kpis"><span>Listone <b>${x.intelligence}</b></span><span>FVM <b>${x.fvm}</b></span><span>Value <b>${x.valueScore}</b></span><span>Fit 2° mod <b>${bridge}</b></span></div>
    <div class="fa2-candidate-price"><span>FVM <b>${x.fvm}</b></span><span>MAX base <b>${x.neutralMax}</b></span><span class="hot">MAX STRATEGICO <b>${x.maxRecommended}</b></span></div>
    <button type="button" class="ghost fa2-profile-btn" onclick='fa2OpenPlayerFromSlot(${idArg(x.id)})'>Apri profilo</button>
  </div>`;
}
function fa2OpenPlayerFromSlot(id){const d=$("#fa2SlotDialog");if(d?.open)d.close();openPlayer(id)}
function fa2OpenSlotAnalysis(slotKey){
  let result=null;try{result=JSON.parse(sessionStorage.getItem("fa2_strategy_result_v35")||"null")}catch{}
  if(!result?.primary){alert("Genera prima una strategia per rianalizzare lo slot. Il Piano Strategia salvato resta comunque attivo.");return}
  const instances=fa2ModuleSlotInstances(result.primary.module),slotInstance=instances.find(x=>x.id===slotKey)||instances.find(x=>x.roleKey===fa2SlotRoleKey(slotKey));
  if(!slotInstance){alert("Slot non trovato nella strategia corrente.");return}
  const roles=slotInstance.roles,reservedIds=fa2PlanReservedCandidateIds(slotInstance.id);
  const reg=window.FA2Regulation?.load?.();
  const analysis=window.FA2Strategy?.analyseSlot?.(result.primary,roles,allPlayers,reg,fa2StrategyContext(reg,result.profile?.scope||"full",{excludeIds:reservedIds}),result.secondary?.module||null);
  if(!analysis){alert("Analisi slot non disponibile.");return}
  fa2LastSlotAnalysis={analysis,result,slotInstance};const a=analysis;
  const altHtml=(a.alternatives||[]).map((x,i)=>fa2CandidateHTML(x,`ALT ${i+1}`)).join("");
  const valueHtml=(a.values||[]).map(x=>fa2CandidateHTML(x,"VALUE")).join("");
  $("#fa2SlotDialogContent").innerHTML=`<div class="dialog-body fa2-slot-dialog-body">
    <div class="section-title"><div><div class="eyebrow">STRATEGY SLOT LAB · α4.1</div><h2>${esc(slotInstance.label)}</h2><p class="muted">${esc(result.primary.module.name)}${result.secondary?` + ${esc(result.secondary.module.name)}`:""}</p></div><button class="ghost" type="button" aria-label="Chiudi analisi slot" onclick="fa2SlotDialog.close()">✕</button></div>
    <div class="fa2-slot-summary"><div><span>PRIORITÀ</span><b>${esc(a.priority?.label||"—")}</b></div><div><span>VALORE MINIMO</span><b>${a.minimumScore||0}/100</b></div><div><span>BUDGET BASE</span><b>${a.budget.perSlot}</b></div><div><span>SCARSITÀ</span><b>${a.summary.scarcity}</b></div><div><span>FORTI</span><b>${a.summary.strongCount}</b></div><div><span>PROFONDITÀ</span><b>${a.summary.depth}</b></div></div>
    <div class="fa2-slot-note">Il MAX strategico resta separato dal MAX LIVE.${reservedIds.size?` Per evitare conflitti, ${reservedIds.size} candidati già riservati negli altri slot sono esclusi da questa analisi.`:""}</div>
    <div class="fa2-candidate-section"><h3>TARGET</h3>${a.target?fa2CandidateHTML(a.target,"TARGET"):'<p class="muted">Nessun candidato.</p>'}</div>
    <div class="fa2-candidate-section"><h3>ALTERNATIVE</h3>${altHtml||'<p class="muted">Nessuna alternativa.</p>'}</div>
    <div class="fa2-candidate-section"><h3>VALUE</h3>${valueHtml||'<p class="muted">Nessun profilo value aggiuntivo.</p>'}</div>
    <div class="dialog-actions"><button class="primary" onclick="fa2SaveCurrentSlotPlan()">Salva questo slot</button><button class="ghost" onclick="fa2SlotDialog.close()">Chiudi</button></div>
  </div>`;
  $("#fa2SlotDialog").showModal();
}
function fa2SaveCurrentSlotPlan(){
  const current=fa2LastSlotAnalysis;if(!current?.analysis?.target)return;
  const {analysis:a,result,slotInstance}=current,plan=fa2LoadPurchasePlan();
  plan.primaryId=result.primary.module.id;plan.primaryName=result.primary.module.name;
  plan.secondaryId=result.secondary?.module?.id||"";plan.secondaryName=result.secondary?.module?.name||"";
  plan.scope=result.profile?.scope||"full";plan.generatedAt=result.profile?.lastGeneratedAt||Date.now();plan.version="A4.1";plan.slots=plan.slots||{};
  const target=fa2CandidateSnapshot(a.target,"TARGET"),alternatives=(a.alternatives||[]).map((x,i)=>fa2CandidateSnapshot(x,`ALT ${i+1}`)),values=(a.values||[]).map(x=>fa2CandidateSnapshot(x,"VALUE"));
  const slotId=slotInstance?.id||a.key,roleKey=slotInstance?.roleKey||a.key,slotIndex=slotInstance?.slotIndex||1,slotCount=slotInstance?.slotCount||1,slotLabel=slotInstance?.label||a.roles.join("/");
  plan.slots[slotId]={key:slotId,roleKey,slotIndex,slotCount,slotLabel,roles:a.roles,target,alternatives,values,targetId:String(target.id),altIds:alternatives.map(x=>x.id),valueIds:values.map(x=>x.id),maxRecommended:target.maxRecommended,minimumScore:Number(a.minimumScore)||0,budgetSlot:Number(a.budget?.perSlot)||0,priority:{score:Number(a.priority?.score)||0,label:a.priority?.label||""},updatedAt:Date.now()};
  fa2SavePurchasePlan(plan);
  const d=$("#fa2SlotDialog");if(d?.open)d.close();
  if(state.view==="strategyView")renderStrategyView();
}
window.fa2OpenSlotAnalysis=fa2OpenSlotAnalysis;
window.fa2OpenPlayerFromSlot=fa2OpenPlayerFromSlot;
window.fa2SaveCurrentSlotPlan=fa2SaveCurrentSlotPlan;
window.fa2ClearPurchasePlan=fa2ClearPurchasePlan;

function fa2StrategyModuleOptions(selected){
  return (window.FA2Strategy?.MODULES||[]).map(m=>`<option value="${m.id}" ${m.id===selected?"selected":""}>${m.name}</option>`).join("");
}
function fa2StrategyContext(reg,scope="full",options={}){
  const useLiveMarket=scope==="live";
  const excludedIds=options?.excludeIds instanceof Set?options.excludeIds:new Set(options?.excludeIds||[]);
  /* La Strategia analizza la rosa realmente posseduta. La promessa di svincolo
     resta confinata al flusso di acquisto dell'Asta di Riparazione. */
  const economy=teamEconomy(mineTeam()),ownedIds=new Set((economy.items||[]).map(x=>String(x.p?.id??"")));
  return {
    isAssigned:p=>excludedIds.has(String(p?.id??""))||(!useLiveMarket?false:(reg?.availability==="multiple"?!!state.purchases?.[p.id]:playerIsRosterAssigned(p))),
    isEligible:p=>isMarketEligiblePlayer(p),
    playerQuality:p=>playerQuality(p),
    isOwned:p=>ownedIds.has(String(p?.id??"")),
    purchasePrice:p=>Number(state.purchases?.[p?.id]?.price)||0,
    remainingBudget:economy.remaining,
    missingRoster:economy.missing,
    expectedPrice:(p,m)=>Math.max(configuredReservePerSlot(),Math.round(Math.min(Number(m?.price)||Number(p?.maxPrice)||neutralPrice(p),Math.max(configuredReservePerSlot(),Number(p?.fvm||0)*1.8*(.88+(Number(m?.intelligence)||50)/600))))),
    isUnder:(p,rule)=>{const y=playerBirthYear(p);return y>0&&Number(rule?.birthYearFrom)>0?y>=Number(rule.birthYearFrom):(rule?.id==="u21"?isU21Player(p):rule?.id==="u23"?isU23Player(p):false)}
  };
}
/* A5.8.2 — advisor post-asta, confronti indipendenti e simulatore. Nessuna funzione
   di questo blocco modifica rosa, crediti o sessione: le operazioni reali
   continuano a passare dall'Asta di Riparazione. */
const FA2_RECOVERY_MONTHS={gennaio:0,febbraio:1,marzo:2,aprile:3,maggio:4,giugno:5,luglio:6,agosto:7,settembre:8,ottobre:9,novembre:10,dicembre:11};
function fa2RecoveryDaysFromText(raw,now=new Date()){
  const text=String(raw||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  let match=text.match(/(?:circa\s+|tra\s+|per\s+)?(\d{1,3})\s*giorn/);if(match)return Number(match[1]);
  match=text.match(/(?:circa\s+|tra\s+|per\s+)?(\d{1,2})\s*settiman/);if(match)return Number(match[1])*7;
  match=text.match(/(?:circa\s+|tra\s+|per\s+)?(\d{1,2})\s*mes/);if(match)return Number(match[1])*30;
  const months=Object.keys(FA2_RECOVERY_MONTHS).join("|");
  match=text.match(new RegExp("(?:(inizio|meta|fine)\\s+(?:di\\s+|del\\s+)?)?("+months+")"));
  if(match){
    const month=FA2_RECOVERY_MONTHS[match[2]],day=match[1]==="inizio"?5:match[1]==="meta"?15:match[1]==="fine"?27:15;
    let year=now.getFullYear();if(month<now.getMonth()-1)year++;
    const target=new Date(year,month,day,12);return Math.max(0,Math.ceil((target-now)/864e5));
  }
  if(/prossim[oa]\s+(?:turno|giornata)|in settimana|quotidianamente|pochi giorni|breve/.test(text))return 7;
  return null;
}
function fa2AvailabilityAssessment(p){
  const meta=availabilityPlayerMeta(p?.name,p?.club),injury=meta.injury,text=String(injury?.recovery||injury?.detail||""),normalized=text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""),days=injury?fa2RecoveryDaysFromText(text):null;
  let severity="none",penalty=0,label="Disponibile";
  if(injury){
    if(days!=null){severity=days<=21?"short":days<=60?"medium":"long"}
    else if(/stagione finita|fine stagione|non tornera|non rientrera|fuori per tutta|carriera terminata/.test(normalized))severity="season";
    else if(/rottura.*crociat|lesione.*crociat|tendine d'achille|operat|intervento chirurgico|frattura/.test(normalized))severity="long";
    else if(/da valutare|tempi.*valutare|non definit|incert/.test(normalized))severity="unknown";
    else severity="unknown";
    penalty={short:1,medium:8,long:23,season:40,unknown:4}[severity]||0;
    label=severity==="short"?"Infortunio breve":severity==="medium"?"Infortunio medio":severity==="long"?"Infortunio lungo":severity==="season"?"Stagione compromessa":"Recupero incerto";
  }else if(meta.isSuspended)label="Squalificato temporaneamente";
  return {meta,injury,severity,penalty,label,days,recovery:text||"—",suspended:meta.isSuspended};
}
function fa2StarterProfileBaseline(p){
  const value=String(p?.starter||"").toLowerCase();
  if(value.includes("alta")||value.includes("titol"))return 78;if(value.includes("media")||value.includes("ballott"))return 56;if(value.includes("rotaz"))return 42;return null;
}
function fa2EffectiveStarterProbability(p,health=fa2AvailabilityAssessment(p)){
  const live=starterProbability(p),pi=window.FA2PlayerIntelligence?.get?.(p)||null,latest=pi?.latest||pi?.seasons?.[pi.seasons.length-1]||null;
  const historical=Number(latest?.starts)>0&&Number(latest?.apps)>0?clamp(Number(latest.starts)/Number(latest.apps)*100,0,100):null,profile=fa2StarterProfileBaseline(p),signals=[Number(live?.prob)||0];
  if(historical!=null)signals.push(historical);if(profile!=null)signals.push(profile);
  if(health.injury||health.suspended||live?.kind==="absent")return Math.round(Math.max(...signals));
  let total=(Number(live?.prob)||0)*.58,weight=.58;
  if(historical!=null){total+=historical*.27;weight+=.27}if(profile!=null){total+=profile*.15;weight+=.15}
  return Math.round(total/weight);
}
function fa2RepairTierScore(p){
  const tier=String(p?.tier||"").toUpperCase();
  if(tier.includes("SUPER TOP"))return 100;if(tier.includes("TOP"))return 90;if(tier.includes("SEMITOP"))return 78;if(tier.includes("FASCIA ALTA")||tier.includes("TITOLARE"))return 66;if(tier.includes("VALUE")||tier.includes("JOLLY"))return 50;if(tier.includes("ROTAZ"))return 36;return 24;
}
function fa2RepairPhaseMax(p,field="quality"){
  const phase=playerAuctionPhase(p),values=allPlayers.filter(x=>playerAuctionPhase(x)===phase).map(x=>field==="fvm"?Number(x.fvm)||0:playerQuality(x));
  return Math.max(1,...values);
}
function fa2RepairPlayerMetrics(p){
  const quality=clamp(100*Math.sqrt(Math.max(0,playerQuality(p))/fa2RepairPhaseMax(p)),0,100),fvmQuality=clamp(100*Math.sqrt(Math.max(0,Number(p?.fvm)||0)/fa2RepairPhaseMax(p,"fvm")),0,100),tier=fa2RepairTierScore(p),flexibility=clamp(Math.max(0,roleTokens(p.role).length-1)*34,0,100);
  const score=Math.round(clamp(quality*.42+fvmQuality*.33+tier*.15+flexibility*.10,0,100));
  return {score,quality:Math.round(quality),fvmQuality:Math.round(fvmQuality),listoneValue:score,tier,flexibility};
}
function fa2RepairPlayerScore(p){return fa2RepairPlayerMetrics(p).score}
function fa2RepairConstraintCheck(player,candidate,reg,session,owned=purchasedPlayers()){
  const reasons=[],ownedAfter=owned.filter(p=>String(p.id)!==String(player.id));
  ownedAfter.push(candidate);
  if(playerAuctionPhase(player)!==playerAuctionPhase(candidate))reasons.push("macro ruolo non compatibile");
  const clubLimit=Math.max(0,Number(reg?.roster?.clubLimit)||0);
  if(clubLimit&&ownedAfter.filter(p=>p.club===candidate.club).length>clubLimit)reasons.push(`limite ${candidate.club} superato`);
  const underRules=(reg?.underRules||[]).filter(rule=>rule.enabled&&Number(rule.min)>0);
  underRules.forEach(rule=>{
    const count=ownedAfter.filter(p=>playerMatchesUnderRule(p,rule)).length;
    if(count<Number(rule.min))reasons.push(`${rule.label||String(rule.id).toUpperCase()} sotto il minimo`);
  });
  if(session?.settings?.preventRebuy&&repairReleasedInActiveSession(candidate.id))reasons.push("riacquisto bloccato nella sessione");
  return {ok:reasons.length===0,reasons,underRules:underRules.map(rule=>({label:rule.label||String(rule.id).toUpperCase(),count:ownedAfter.filter(p=>playerMatchesUnderRule(p,rule)).length,min:Number(rule.min)}))};
}
function fa2RepairFunctionalMatch(player,candidate,module){
  const slots=(module?.slots||[]).filter(roles=>roles.some(role=>roleTokens(player.role).includes(role)));
  return slots.length>0&&slots.some(roles=>roles.some(role=>roleTokens(candidate.role).includes(role)));
}
function fa2RepairSwapEvaluation(player,candidate,module,reg,session,owned,metricsFor=fa2RepairPlayerMetrics){
  const current=metricsFor(player),next=metricsFor(candidate),constraints=fa2RepairConstraintCheck(player,candidate,reg,session,owned),improvement=next.score-current.score,blocks=[],reasons=[],warnings=[];
  const priorityExit=player.outOfListone;
  if(!constraints.ok)blocks.push(...constraints.reasons);
  if(!fa2RepairFunctionalMatch(player,candidate,module))blocks.push("non copre la stessa funzione nel modulo");
  const minimumGain=priorityExit?0:7;if(improvement<minimumGain)blocks.push(`miglioramento insufficiente (${improvement>=0?"+":""}${improvement})`);
  if(!priorityExit&&current.tier>=78&&next.tier<current.tier)blocks.push("fascia Listone inferiore");
  if(!priorityExit&&next.quality<current.quality*.82)blocks.push("valore Listone sensibilmente inferiore");
  if(player.outOfListone)reasons.push("giocatore fuori dal listone");
  if(next.fvmQuality>=current.fvmQuality+5)reasons.push(`FVM relativo ${current.fvmQuality} → ${next.fvmQuality}`);
  if(next.quality>=current.quality+5)reasons.push(`qualità ${current.quality} → ${next.quality}`);
  if(next.flexibility>current.flexibility)reasons.push(`maggiore flessibilità Mantra (${candidate.role})`);
  if(!reasons.length&&improvement>=minimumGain)reasons.push(`indice complessivo ${current.score} → ${next.score}`);
  if(next.quality<current.quality)warnings.push(`qualità inferiore ${current.quality} → ${next.quality}`);
  return {recommended:blocks.length===0,blocks,reasons,warnings,current,next,improvement,constraints};
}
function fa2BuildRepairAdvisor(profile,reg){
  const module=window.FA2Strategy?.moduleById?.(profile?.primary),owned=purchasedPlayers();
  const available=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&!p.outOfListone&&!state.purchases?.[p.id]&&(reg?.availability==="multiple"||!state.sold?.[p.id]));
  const session=currentRepairSession(),rows=[],metricCache=new Map(),metricsFor=p=>{const key=String(p.id);if(!metricCache.has(key))metricCache.set(key,fa2RepairPlayerMetrics(p));return metricCache.get(key)};let blockedCount=0;
  if(repairLimitReached(session))return {module,session,rows,availableCount:available.length,remaining:teamEconomy(mineTeam()).remaining,limitReached:true};
  for(const player of owned){
    const ranked=available.map(candidate=>({candidate,evaluation:fa2RepairSwapEvaluation(player,candidate,module,reg,session,owned,metricsFor)})).filter(row=>{if(!row.evaluation.recommended){blockedCount++;return false}return true}).sort((a,b)=>b.evaluation.improvement-a.evaluation.improvement||b.evaluation.next.fvmQuality-a.evaluation.next.fvmQuality);
    if(!ranked.length)continue;
    const best=ranked[0],evaluation=best.evaluation;
    const purchase=state.purchases?.[player.id],refund=session?repairRefundForPlayer(player,purchase,session.settings):null;
    rows.push({player,currentScore:evaluation.current.score,replacement:best.candidate,replacementScore:evaluation.next.score,improvement:evaluation.improvement,refund,evaluation,priority:evaluation.improvement+(player.outOfListone?35:0)});
  }
  rows.sort((a,b)=>b.priority-a.priority||a.currentScore-b.currentScore);
  const used=new Set(),unique=[];
  for(const row of rows){const key=String(row.replacement.id);if(used.has(key))continue;used.add(key);unique.push(row);if(unique.length>=4)break}
  return {module,session,rows:unique,availableCount:available.length,remaining:teamEconomy(mineTeam()).remaining,blockedCount};
}
function fa2OpenRepairSuggestion(playerId){
  openRepairMarket();
  requestAnimationFrame(()=>{const select=$("#repairReleasePlayer");if(select&&[...select.options].some(option=>String(option.value)===String(playerId))){select.value=String(playerId);renderRepairReleasePreview()}});
}
window.fa2OpenRepairSuggestion=fa2OpenRepairSuggestion;
function fa2RepairWhatIfOptions(players,selected){return players.map(p=>`<option value="${escAttr(p.id)}" ${String(p.id)===String(selected)?"selected":""}>${esc(p.name)} · ${esc(p.club)} · ${esc(p.role)}</option>`).join("")}
function fa2RepairWhatIfSuggestedPrice(player){
  const live=liveMaxForPlayer(player);
  return Math.max(configuredMinBid(),Math.min(Number(live.rawLive)||Number(live.live)||configuredMinBid(),Math.max(configuredMinBid(),neutralPrice(player))));
}
function fa2RepairWhatIfHTML(profile,reg){
  const owned=purchasedPlayers(),available=allPlayers.filter(p=>isMarketEligiblePlayer(p)&&!p.outOfListone&&!state.purchases?.[p.id]&&(reg?.availability==="multiple"||!state.sold?.[p.id]));
  if(!owned.length||!available.length)return "";
  return `<details class="fa2-whatif" ontoggle="if(this.open)fa2RenderWhatIf()"><summary><span><b>SIMULATORE “E SE…”</b><small>Prova una coppia e un prezzo diversi dal piano</small></span><i aria-hidden="true">⌄</i></summary><div class="fa2-whatif-body"><label>Svincolo ipotetico<select id="fa2WhatIfOut" onchange="fa2RenderWhatIf()">${fa2RepairWhatIfOptions(owned,owned[0]?.id)}</select></label><label>Acquisto ipotetico<select id="fa2WhatIfIn" onchange="fa2WhatIfTargetChanged()">${fa2RepairWhatIfOptions(available,available[0]?.id)}</select></label><label>Prezzo massimo ipotizzato<input id="fa2WhatIfPrice" type="number" min="${configuredMinBid()}" step="1" inputmode="numeric" value="${fa2RepairWhatIfSuggestedPrice(available[0])}" oninput="fa2RenderWhatIf()"></label><div id="fa2WhatIfResult" class="fa2-whatif-result"><span>Apri il simulatore per calcolare l’impatto.</span></div><p>Nessun dato viene salvato: rosa, crediti e sessione restano invariati.</p></div></details>`;
}
function fa2WhatIfTargetChanged(){
  const incoming=getPlayer($("#fa2WhatIfIn")?.value),price=$("#fa2WhatIfPrice");
  if(incoming&&price)price.value=fa2RepairWhatIfSuggestedPrice(incoming);
  fa2RenderWhatIf();
}
window.fa2WhatIfTargetChanged=fa2WhatIfTargetChanged;
function fa2RenderWhatIf(){
  const out=getPlayer($("#fa2WhatIfOut")?.value),incoming=getPlayer($("#fa2WhatIfIn")?.value),box=$("#fa2WhatIfResult");if(!out||!incoming||!box)return;
  const reg=currentRegulation(),profile=window.FA2Strategy?.loadProfile?.()||{},module=window.FA2Strategy?.moduleById?.(profile.primary),session=activeRepairSession(),economy=teamEconomy(mineTeam());
  const refund=Math.max(0,Number(repairRefundForPlayer(out,state.purchases?.[out.id],session?.settings))||0),price=Math.max(configuredMinBid(),Number($("#fa2WhatIfPrice")?.value)||configuredMinBid()),creditAfter=economy.remaining+refund-price;
  const evaluation=fa2RepairSwapEvaluation(out,incoming,module,reg,session,purchasedPlayers()),reasons=[...evaluation.blocks];if(creditAfter<0)reasons.unshift("credito insufficiente");
  const youth=evaluation.constraints.underRules.map(rule=>`${esc(rule.label)} ${rule.count}/${rule.min}`).join(" · ");
  box.innerHTML=`<div class="${reasons.length?"warn":"ok"}"><span>${reasons.length?"SCAMBIO NON CONSIGLIATO":"SCAMBIO COMPATIBILE"}</span><b>${reasons.length?esc(reasons.join(" · ")):esc(evaluation.reasons.join(" · ")||"Vincoli, valore tecnico e disponibilità rispettati")}</b>${youth?`<small>${youth}</small>`:""}</div><div><span>Rimborso previsto</span><b>+${fmt(refund)} cr</b></div><div><span>Credito dopo</span><b>${fmt(creditAfter)} cr</b></div><div><span>Indice giocatore</span><b>${evaluation.current.score} → ${evaluation.next.score}</b></div><div><span>Impatto</span><b>${evaluation.improvement>=0?"+":""}${evaluation.improvement}</b></div>`;
}
window.fa2RenderWhatIf=fa2RenderWhatIf;
function fa2RepairAdvisorHTML(profile,reg,lifecycle){
  if(!lifecycle?.auctionComplete)return "";
  const advisor=fa2BuildRepairAdvisor(profile,reg),session=advisor.session,active=!!session&&!session.pausedAt;
  const rows=advisor.rows.length?advisor.rows.map((row,index)=>{
    const current=row.evaluation.current,next=row.evaluation.next,maxLive=liveMaxForPlayer(row.replacement).live,net=row.refund==null?null:maxLive-row.refund;
    const reasons=row.evaluation.reasons.map(reason=>`<li>${esc(reason)}</li>`).join("");
    const warnings=row.evaluation.warnings.length?`<div class="fa2-repair-cautions"><b>ATTENZIONE</b>${row.evaluation.warnings.map(reason=>`<span>${esc(reason)}</span>`).join("")}</div>`:"";
    return `<article class="fa2-repair-single"><header><span>SOSTITUZIONE SUGGERITA ${index+1}</span><b>Miglioramento +${row.improvement}</b></header><div class="fa2-repair-swap"><span><small>VALUTA SVINCOLO</small><b>${esc(row.player.name)}</b><em>${esc(row.player.club)} · ${esc(row.player.role)} · indice ${row.currentScore}</em></span><i aria-hidden="true">→</i><span><small>OBIETTIVO</small><b>${esc(row.replacement.name)}</b><em>${esc(row.replacement.club)} · ${esc(row.replacement.role)} · indice ${row.replacementScore}</em></span></div><div class="fa2-repair-compare"><div><span>FVM</span><b>${fmt(row.player.fvm||0)} → ${fmt(row.replacement.fvm||0)}</b></div><div><span>QUOTAZIONE</span><b>${fmt(playerQuality(row.player))} → ${fmt(playerQuality(row.replacement))}</b></div><div><span>VALORE LISTONE</span><b>${current.listoneValue} → ${next.listoneValue}</b></div><div><span>FLESSIBILITÀ RUOLI</span><b>${current.flexibility} → ${next.flexibility}</b></div></div><details class="fa2-repair-why" open><summary>Perché è suggerita <i aria-hidden="true">⌄</i></summary><div><ul>${reasons}</ul>${warnings}<p>Il confronto usa soltanto Listone, compatibilità col modulo, vincoli della rosa e crediti. Eventuali informazioni esterne vanno valutate dall’utente.</p></div></details><div class="fa2-repair-economy"><span>Rimborso previsto <b>${row.refund==null?"—":fmt(row.refund)+" cr"}</b></span><span>MAX sostituto <b>${fmt(maxLive)} cr</b></span><span>Impegno netto <b>${net==null?"—":net>=0?fmt(net)+" cr da aggiungere":"+"+fmt(Math.abs(net))+" cr residui"}</b></span></div><div class="fa2-repair-actions"><button type="button" class="ghost" onclick='openPlayer(${idArg(row.replacement.id)})'>Apri sostituto</button>${active?`<button type="button" class="primary" onclick='fa2OpenRepairSuggestion(${idArg(row.player.id)})'>Prepara svincolo</button>`:`<button type="button" class="primary" onclick="openRepairMarket()">${session?.pausedAt?"Riprendi sessione":"Configura sessione"}</button>`}</div></article>`;
  }).join(""):`<div class="fa2-slot-note"><b>NESSUNA SOSTITUZIONE MIGLIORATIVA</b> · Con i soli dati del Listone non emerge un obiettivo compatibile che migliori davvero valore, ruoli e vincoli.</div>`;
  return `<section class="fa2-repair-advisor"><div class="fa2-repair-advisor-head"><div><span>RIPARAZIONE · A7.0.1 · SOLO LISTONE</span><b>Sostituzioni singole · ${esc(advisor.module?.name||"Modulo strategico")}</b><small>${advisor.availableCount} giocatori liberi confrontati · ${advisor.rows.length}/4 proposte compatibili</small></div><button type="button" class="ghost" onclick="openRepairMarket()">${active?"Gestisci riparazione":session?.pausedAt?"Riprendi riparazione":"Configura riparazione"}</button></div>${advisor.limitReached?`<div class="fa2-slot-note"><b>LIMITE RAGGIUNTO</b> · La sessione non consente altre sostituzioni conteggiate.</div>`:rows}${fa2RepairWhatIfHTML(profile,reg)}<p class="muted">L’app non conosce forma, titolarità, infortuni o squalifiche: durante l’asta puoi valutare manualmente queste informazioni prima di confermare.</p></section>`;
}
function fa2MetricClass(value,invert=false){const v=Number(value)||0;const good=invert?v<=24:v>=72,bad=invert?v>=40:v<55;return good?"good":bad?"bad":""}
function fa2RenderExplanation(p){
  const ex=p?.explanation||{};
  return `<div class="fa2-explain"><div class="fa2-strength"><b>PERCHÉ FUNZIONA</b>${(ex.strengths||[]).map(x=>`<span>✓ ${esc(x)}</span>`).join("")}</div><div class="fa2-warning"><b>COSA PROTEGGERE IN ASTA</b>${(ex.warnings||[]).map(x=>`<span>⚠ ${esc(x)}</span>`).join("")}</div>${ex.priority?.length?`<div class="fa2-priority"><b>PRIORITÀ:</b> ${ex.priority.map(esc).join(" → ")}</div>`:""}</div>`;
}
function fa2RenderStrategyResult(result){
  const advisorHTML=fa2ModuleAdvisorHTML();
  if(!result){
    const plan=fa2LoadPurchasePlan(),hasPlan=Object.keys(plan.slots||{}).length>0;
    return `<div class="fa2-result">${advisorHTML}${hasPlan?fa2SavedPlanHTML(null):'<div class="card"><b>Nessuna strategia generata</b><p class="muted">Scegli il metodo e premi CREA STRATEGIA.</p></div>'}${hasPlan?'<div class="card fa2-persist-note"><b>Piano persistente</b><p class="muted">La strategia salvata resta attiva anche dopo la chiusura dell’app. Premi ANALIZZA LISTONE per ricalcolare moduli e slot.</p></div>':''}</div>`;
  }
  const p=result.primary,headlineScore=result.mode==="mono"?p.score:(result.pairScore||p.score);
  const kpis=`<div class="fa2-kpis alpha3"><div class="${fa2MetricClass(p.quality)}"><span>VALORE LISTONE XI</span><b>${p.quality}</b></div><div class="${fa2MetricClass(p.starter)}"><span>FORZA SLOT</span><b>${p.starter}</b></div><div class="${fa2MetricClass(p.depth)}"><span>PROFONDITÀ</span><b>${p.depth}</b></div><div class="${fa2MetricClass(p.cost)}"><span>SOSTENIBILITÀ</span><b>${p.cost}</b></div><div class="${fa2MetricClass(p.flexibility)}"><span>FLESSIBILITÀ</span><b>${p.flexibility}</b></div><div class="${fa2MetricClass(p.scarcityRisk,true)}"><span>SCARSITÀ</span><b>${p.scarcityRisk}</b></div></div>`;
  const analysis=p.analysis?`<div class="fa2-slot-note"><b>BACINO LEGA</b> · ${p.analysis.analyzed} giocatori analizzati per ${p.analysis.participants} squadre (${p.analysis.actualGoalkeepers} POR + ${p.analysis.actualMovement} movimento).</div>`:"";
  const projection=p.rosterProjection||null;
  const projectionHTML=projection?`<div class="fa2-slot-summary"><div><span>ROSA</span><b>${projection.ownedCount}/${projection.rosterTotal}</b></div><div><span>POSTI DA COPRIRE</span><b>${projection.missing}</b></div><div><span>STIMA COMPLETAMENTO</span><b>${fmt(projection.expectedRemaining)} cr</b></div><div><span>XI STRATEGICO</span><b>${fmt(projection.strategicCost)} cr</b></div><div><span>PANCHINA / RISERVE</span><b>${fmt(projection.benchCost)} cr</b></div><div><span>MARGINE PREVISTO</span><b>${fmt(projection.closingBalance)} cr</b></div></div><div class="fa2-slot-note"><b>ASSEGNAZIONE GLOBALE MULTIRUOLO</b> · ${p.assignment?.filled||0}/${p.assignment?.total||11} slot, ${p.assignment?.multirole||0} multiruolo impiegati, ${p.assignment?.candidates||0} candidati confrontati.${projection.status==="COMPLETE"?" Rosa completa: nessun nuovo obiettivo operativo.":projection.status==="OVER"?" Attenzione: la stima supera il credito disponibile.":" Il costo include titolari, panchina e riserva minima."}</div>`:"";
  const budget=`<div class="fa2-budget">${Object.entries(result.budget||{}).map(([k,v])=>`<div><span>${k}</span><b>${v.credits}</b><small>${v.pct}% budget</small></div>`).join("")}</div>`;
  const slotInstances=fa2ModuleSlotInstances(p.module),savedSlots=fa2LoadPurchasePlan().slots||{};
  const firstInstanceFor=roleKey=>slotInstances.find(x=>x.roleKey===roleKey)?.id||roleKey;
  const rosterComplete=projection?.status==="COMPLETE";
  const critical=rosterComplete?"":`<div class="fa2-critical"><b>SLOT DA PROTEGGERE · TOCCA PER APRIRE</b><div>${(p.critical||[]).map(x=>`<button type="button" data-fa2-slot-open="${esc(firstInstanceFor(fa2SlotKey(x.roles)))}">${x.roles.join("/")} · rischio ${x.scarcity}% · ${x.strongCount} forti</button>`).join("")}</div></div>`;
  const slotLab=rosterComplete
    ?`<div class="fa2-slot-note"><b>ASTA INIZIALE COMPLETATA</b> · La Strategia valuta modulo, XI e profondità della rosa, ma non crea nuovi TARGET. Le sostituzioni si aprono esclusivamente dall’Asta di Riparazione.</div>`
    :`<div class="fa2-slot-lab"><div><b>PIANO MULTI-SLOT</b><span>Ogni posizione è indipendente: TARGET, ALT 1-3, VALUE, minimo, budget e priorità.</span></div><div>${slotInstances.map(x=>`<button type="button" data-fa2-slot-open="${esc(x.id)}">${savedSlots[x.id]?"✓ ":""}${esc(x.label)}</button>`).join("")}</div></div>`;
  const savedPlan=fa2SavedPlanHTML(result);
  const secondary=result.secondary?`<div class="fa2-bridge"><b>Secondo modulo:</b> ${result.secondary.module.name} · ${result.secondary.score}/100 · sinergia ${result.synergy||0}%${result.bridges?.length?`<br><b>Ruoli ponte:</b> ${result.bridges.slice(0,7).map(x=>x.role).join(" · ")}`:""}</div>`:"";
  const ranking=result.mode==="auto"?`<div class="fa2-ranking"><b>Classifica moduli dal Listone</b>${result.ranked.slice(0,8).map((x,i)=>`<div class="fa2-ranking-row alpha2"><i>${i+1}</i><div><b>${x.module.name}</b><small>Tit ${x.starter}% · Scar ${x.scarcityRisk} · Prof ${x.depth}</small></div><span>${x.score}</span></div>`).join("")}</div>`:"";
  const scopeLabel=result?.profile?.scope==="live"?"MERCATO LIVE":"LISTONE COMPLETO";
  return `<div class="fa2-result">${advisorHTML}<div class="fa2-result-head"><div><span>${result.mode==="auto"?"AUTO · COPPIA CONSIGLIATA":result.mode==="dual"?"STRATEGIA DOPPIO MODULO":"STRATEGIA MONO MODULO"}</span><b>${p.module.name}${result.secondary?` + ${result.secondary.module.name}`:""}</b><small>${scopeLabel}${result.secondary?` · sinergia ${result.synergy||0}%`:""}</small></div><b class="fa2-score">${headlineScore}<small>/100</small></b></div>${analysis}${projectionHTML}${kpis}${fa2RenderExplanation(p)}${budget}${critical}${slotLab}${savedPlan}${secondary}${ranking}</div>`;
}
function renderStrategyView(){
  const root=$("#strategyView");if(!root)return;
  if(!window.FA2Strategy||!window.FA2Regulation){root.innerHTML='<div class="card">Motori FantaAsta2.0 non caricati.</div>';return;}
  const profile=FA2Strategy.loadProfile(),reg=FA2Regulation.load(),sum=FA2Regulation.summary(reg),lifecycle=auctionLifecycleStatus(),repairPromise=activeRepairPromise();
  let cached=null;try{cached=JSON.parse(sessionStorage.getItem("fa2_strategy_result_v35")||"null")}catch{}
  if(cached&&cached.engineVersion!==FA2Strategy.VERSION)cached=null;
  if(cached&&lifecycle.auctionComplete&&Number(cached?.primary?.rosterProjection?.ownedCount)!==lifecycle.ownCount)cached=null;
  const completionBanner=lifecycle.auctionComplete?`<div class="fa2-saved-plan active"><div><span>${lifecycle.repairActive?"ASTA DI RIPARAZIONE ATTIVA":lifecycle.repairPaused?"ASTA DI RIPARAZIONE SOSPESA":"ASTA COMPLETATA · ROSE COMPLETE"}</span><b>${lifecycle.repairActive||lifecycle.repairPaused?`Rosa attuale ${lifecycle.ownCount}/${lifecycle.rosterTotal} · movimenti e limite residuo memorizzati`:`${lifecycle.completeTeams}/${lifecycle.teams} squadre complete · tua rosa ${lifecycle.ownCount}/${lifecycle.rosterTotal}`}</b><small>${lifecycle.repairActive?"Ogni svincolo o acquisto registrato aggiorna credito, vincoli e suggerimenti.":lifecycle.repairPaused?"Riprendi la stessa sessione per continuare a utilizzare le sostituzioni ancora disponibili.":`La Strategia analizza la rosa definitiva senza creare nuovi obiettivi per l'asta iniziale.${repairPromise?` La promessa di svincolo di ${esc(repairPromise.name)} resta separata e vale soltanto nell'Asta di Riparazione.`:""}`}</small></div></div>`:"";
  const repairAdvisor=fa2RepairAdvisorHTML(profile,reg,lifecycle);
  root.innerHTML=`<div class="fa2-hero"><span>FANTAASTA2.0 · GESTIONE ASTA LOCALE · A7.0.1</span><h2>Strategia</h2><p>Le analisi utilizzano esclusivamente il regolamento e il Listone importato manualmente dall’utente. Nessuna statistica o fonte esterna viene interrogata automaticamente.</p></div>
    ${completionBanner}
    ${repairAdvisor}
    <div class="fa2-reg-strip alpha4"><div><span>Partecipanti</span><b>${sum.participants}</b></div><div><span>Bacino</span><b>${sum.analysisPool}</b></div><div><span>Budget</span><b>${sum.budget}</b></div><div><span>Rosa</span><b>${sum.roster}</b></div><div><span>Under</span><b>${sum.under}</b></div><div><span>Fonte</span><b>LISTONE</b></div></div>
    <div class="fa2-mode-grid" role="group" aria-label="Metodo strategia"><button type="button" class="fa2-mode ${profile.mode==="mono"?"active":""}" data-fa2-mode="mono" aria-pressed="${profile.mode==="mono"?"true":"false"}">1 MODULO</button><button type="button" class="fa2-mode ${profile.mode==="dual"?"active":""}" data-fa2-mode="dual" aria-pressed="${profile.mode==="dual"?"true":"false"}">2 MODULI</button><button type="button" class="fa2-mode ${profile.mode==="auto"?"active":""}" data-fa2-mode="auto" aria-pressed="${profile.mode==="auto"?"true":"false"}">AUTO LISTONE</button></div>
    <div class="fa2-scope-card"><span>BASE ANALISI</span><div class="fa2-scope-grid" role="group" aria-label="Base dell'analisi"><button type="button" class="fa2-scope ${profile.scope!=="live"?"active":""}" data-fa2-scope="full" aria-pressed="${profile.scope!=="live"?"true":"false"}"><b>LISTONE COMPLETO</b><small>Strategia pre-asta</small></button><button type="button" class="fa2-scope ${profile.scope==="live"?"active":""}" data-fa2-scope="live" aria-pressed="${profile.scope==="live"?"true":"false"}"><b>MERCATO LIVE</b><small>Solo disponibili ora</small></button></div></div>
    <div class="fa2-config-card"><div class="fa2-config-grid"><label>Modulo principale<select id="fa2Primary" ${profile.mode==="auto"?"disabled":""}>${fa2StrategyModuleOptions(profile.primary)}</select></label><label>Modulo alternativo<select id="fa2Secondary" ${profile.mode!=="dual"?"disabled":""}>${fa2StrategyModuleOptions(profile.secondary)}</select></label></div><button id="fa2Generate" class="primary">${lifecycle.auctionComplete?"ANALIZZA ROSA":profile.mode==="auto"?"ANALIZZA LISTONE":"CREA STRATEGIA"}</button><button id="fa2EditReg" class="ghost fa2-edit-reg" type="button">Modifica regolamento</button></div>
    <div id="fa2StrategyResult">${fa2RenderStrategyResult(cached)}</div>`;
  $$("[data-fa2-mode]").forEach(btn=>btn.onclick=()=>{FA2Strategy.saveProfile({...FA2Strategy.loadProfile(),mode:btn.dataset.fa2Mode});fa2InvalidateModuleAdvisor();sessionStorage.removeItem("fa2_strategy_result_v35");renderStrategyView()});
  $$("[data-fa2-scope]").forEach(btn=>btn.onclick=()=>{FA2Strategy.saveProfile({...FA2Strategy.loadProfile(),scope:btn.dataset.fa2Scope});fa2InvalidateModuleAdvisor();sessionStorage.removeItem("fa2_strategy_result_v35");renderStrategyView()});
  $("#fa2Primary").onchange=e=>{FA2Strategy.saveProfile({...FA2Strategy.loadProfile(),primary:e.target.value});localStorage.setItem(FA2_RECOMMENDED_LINEUP_MODULE_STORAGE,String(e.target.value));fa2InvalidateModuleAdvisor()};
  $("#fa2Secondary").onchange=e=>{FA2Strategy.saveProfile({...FA2Strategy.loadProfile(),secondary:e.target.value});fa2InvalidateModuleAdvisor()};
  $("#fa2EditReg").onclick=()=>switchView("settingsView");
  $("#fa2Generate").onclick=async e=>{
    const btn=e.currentTarget,current=FA2Strategy.loadProfile();
    const original=btn.textContent;btn.disabled=true;btn.textContent=current.mode==="auto"?"ANALIZZO 0/11…":"CALCOLO…";
    try{
      const buildFn=FA2Strategy.buildAsync||((profile,players,regulation,context)=>Promise.resolve(FA2Strategy.build(profile,players,regulation,context)));
      const result=await buildFn(current,allPlayers,reg,fa2StrategyContext(reg,current.scope),(done,total)=>{btn.textContent=current.mode==="auto"?`ANALIZZO ${done}/${total}…`:`CALCOLO ${done}/${total}…`});
      sessionStorage.setItem("fa2_strategy_result_v35",JSON.stringify(result));
      if(result?.profile?.primary)localStorage.setItem(FA2_RECOMMENDED_LINEUP_MODULE_STORAGE,String(result.profile.primary));
      fa2InvalidateModuleAdvisor();
      renderStrategyView();
    }catch(error){
      console.error("Strategy analysis failed",error);
      btn.disabled=false;btn.textContent=original;
      alert(`Analisi non completata: ${error?.message||error}`);
    }
  };
  $$('[data-fa2-slot-open]').forEach(btn=>btn.onclick=()=>fa2OpenSlotAnalysis(btn.dataset.fa2SlotOpen));
}
window.addEventListener("fa2:regulation-changed",event=>{fa2AppRegulationCache=event?.detail||null;fa2InvalidateModuleAdvisor();sessionStorage.removeItem("fa2_strategy_result_v35");if(state.view==="strategyView")renderStrategyView()});
window.addEventListener("fa2:strategy-slots-changed",()=>{
  if(state.view==="strategyView")renderStrategyView();
  if($("#liveDialog")?.open)renderAuctionLive();
});
window.addEventListener("fa2:player-intelligence-updated",()=>{
  fa2InvalidateModuleAdvisor();
  sessionStorage.removeItem("fa2_strategy_result_v35");
  const d=$("#playerDialog"),id=d?.dataset?.playerId;
  if(d?.open&&id)openPlayer(id);
  if(state.view==="squadView")renderSquad();
  if(state.view==="strategyView")renderStrategyView();
});
