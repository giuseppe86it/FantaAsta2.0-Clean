/* FantaAsta2.0 — Opponent Intelligence A4.2
   Motore puro e deterministico: non legge e non modifica localStorage. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.FA2OpponentIntelligence=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const VERSION="A4.2";
  const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,Number(value)||0));
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const cleanRoles=roles=>(Array.isArray(roles)?roles:String(roles||"").split("/"))
    .map(role=>String(role||"").trim()).filter(Boolean);

  function teamDataConfidence(input={}){
    const phase=Math.max(0,Math.min(3,Math.round(finite(input.phaseIndex,0))));
    const rosterTotal=Math.max(1,finite(input.rosterTotal,25));
    const expectedShare=[.12,.38,.67,.92][phase];
    const expectedEvidence=Math.max(1,Math.round(rosterTotal*expectedShare));
    const rosterEvidence=clamp(finite(input.rosterCount)/expectedEvidence);
    const moduleConfidence=clamp(input.moduleConfidence);
    const assignmentShare=clamp(input.assignmentShare);
    return clamp(.12+.46*rosterEvidence+.24*moduleConfidence+.18*assignmentShare,.12,.96);
  }

  function roleOverlap(playerRoles,familyRoles){
    const wanted=new Set(cleanRoles(familyRoles));
    return cleanRoles(playerRoles).some(role=>wanted.has(role));
  }

  function evaluateTeam(team,context){
    const anchorPrice=Math.max(1,finite(context.anchorPrice,1));
    const minBid=Math.max(1,finite(context.minBid,1));
    const remaining=Math.max(0,finite(team.remaining));
    const missing=Math.max(0,Math.round(finite(team.missing)));
    const maxNext=Math.max(0,finite(team.maxNext));
    const moduleConfidence=clamp(team.moduleConfidence);
    const dataConfidence=teamDataConfidence({
      phaseIndex:context.phaseIndex,
      rosterTotal:context.rosterTotal,
      rosterCount:team.rosterCount,
      moduleConfidence,
      assignmentShare:context.assignmentShare
    });
    const matchingNeeds=(team.needs||[])
      .filter(row=>roleOverlap(context.playerRoles,row.roles))
      .map(row=>({...row,need:clamp(row.need)}))
      .sort((a,b)=>b.need-a.need||String(a.label||a.id).localeCompare(String(b.label||b.id),"it"));
    const primaryNeed=matchingNeeds[0]||null;
    const need=primaryNeed?.need||0;
    const clubEligible=team.clubEligible!==false;
    const eligible=clubEligible&&missing>0&&maxNext>=minBid;
    const affordability=!eligible||maxNext<anchorPrice
      ? 0
      : clamp(.35+.65*((maxNext-anchorPrice)/Math.max(anchorPrice*1.5,1)),.35,1);
    const averageSlot=Math.max(1,finite(context.budget,2500)/Math.max(1,finite(context.rosterTotal,25)));
    const appeal=clamp(.22+.45*Math.sqrt(anchorPrice/averageSlot),.22,1);
    const intent=clamp(.08+.56*need+.18*appeal+.10*moduleConfidence+.08*affordability);
    const desireMultiplier=clamp(.55+.66*need+.18*appeal+.12*moduleConfidence,.55,1.55);
    const estimatedCap=eligible?Math.min(maxNext,Math.max(minBid,Math.round(anchorPrice*desireMultiplier))):0;
    const capReach=!eligible||!estimatedCap
      ? 0
      : estimatedCap>=anchorPrice
        ? clamp(.65+.35*((estimatedCap-anchorPrice)/anchorPrice),.65,1)
        : clamp(.25*(estimatedCap/anchorPrice),.05,.25);
    const probability=eligible
      ? clamp(intent*(.28+.72*dataConfidence)*affordability*capReach,0,.88)
      : 0;

    return {
      teamId:String(team.id||""),
      name:String(team.name||"Squadra"),
      module:String(team.module||"—"),
      moduleConfidence,
      dataConfidence,
      remaining,
      missing,
      maxNext,
      clubEligible,
      eligible,
      need,
      needId:primaryNeed?.id||"",
      needLabel:primaryNeed?.label||"",
      affordability,
      estimatedCap,
      probability
    };
  }

  function evaluatePlayer(input={}){
    const context={
      anchorPrice:Math.max(1,finite(input.anchorPrice,1)),
      minBid:Math.max(1,finite(input.minBid,1)),
      budget:Math.max(1,finite(input.budget,2500)),
      rosterTotal:Math.max(1,finite(input.rosterTotal,25)),
      phaseIndex:Math.max(0,Math.min(3,Math.round(finite(input.phaseIndex,0)))),
      assignmentShare:clamp(input.assignmentShare),
      playerRoles:cleanRoles(input.playerRoles)
    };
    const teams=(input.teams||[]).map(team=>evaluateTeam(team,context))
      .sort((a,b)=>b.probability-a.probability||b.need-a.need||b.maxNext-a.maxNext||a.name.localeCompare(b.name,"it"));
    const expectedRivals=teams.reduce((sum,row)=>sum+row.probability,0);
    const atLeastOneBid=teams.length?1-teams.reduce((product,row)=>product*(1-row.probability),1):0;
    const likelyRivals=teams.filter(row=>row.probability>=.42).length;
    const pricePressurePct=Math.round(100*clamp(.065*atLeastOneBid+.035*Math.max(0,expectedRivals-.5),0,.15));
    const weightedConfidence=teams.reduce((sum,row)=>sum+row.dataConfidence*Math.max(.05,row.probability),0);
    const confidenceWeight=teams.reduce((sum,row)=>sum+Math.max(.05,row.probability),0);
    const confidence=confidenceWeight?weightedConfidence/confidenceWeight:0;
    const pressureLabel=pricePressurePct>=10?"ALTA":pricePressurePct>=5?"MEDIA":"BASSA";
    return {
      version:VERSION,
      anchorPrice:context.anchorPrice,
      teams,
      expectedRivals,
      likelyRivals,
      atLeastOneBid,
      pricePressurePct,
      pressureLabel,
      confidence
    };
  }

  return Object.freeze({VERSION,teamDataConfidence,evaluatePlayer});
});
