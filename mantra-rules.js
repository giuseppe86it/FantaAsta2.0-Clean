(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.FA2MantraRules=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const ROLE_META=Object.freeze({
    Por:{display:"P",family:"por",label:"Portiere"},
    Ds:{display:"DS",family:"dif",label:"Terzino sinistro"},
    Dc:{display:"DC",family:"dif",label:"Difensore centrale"},
    Dd:{display:"DD",family:"dif",label:"Terzino destro"},
    B:{display:"B",family:"dif",label:"Braccetto difensivo"},
    E:{display:"E",family:"cen",label:"Esterno basso"},
    M:{display:"M",family:"cen",label:"Centrocampista difensivo"},
    C:{display:"C",family:"cen",label:"Centrocampista centrale"},
    W:{display:"W",family:"trq",label:"Ala"},
    T:{display:"T",family:"trq",label:"Trequartista"},
    A:{display:"A",family:"att",label:"Attaccante di raccordo"},
    Pc:{display:"PC",family:"att",label:"Punta centrale"}
  });
  const CANONICAL=Object.freeze(Object.fromEntries(Object.keys(ROLE_META).map(role=>[role.toLowerCase(),role])));
  const FAMILY_ORDER=["por","dif","cen","trq","att"];

  function normalizeRoleTokens(value){
    const source=Array.isArray(value)?value.join("/"):String(value||"");
    return source.split(/[\/;]+/).map(token=>CANONICAL[token.trim().toLowerCase()]||token.trim()).filter(token=>ROLE_META[token]);
  }
  function displayRole(value){
    return normalizeRoleTokens(value).map(role=>ROLE_META[role].display).join("/")||"—";
  }
  function familiesFor(value){
    const families=new Set(normalizeRoleTokens(value).map(role=>ROLE_META[role].family));
    return FAMILY_ORDER.filter(family=>families.has(family));
  }
  function toneClass(value){
    const families=familiesFor(value);
    return `role-tone-${families.length?families.join("-"):"neutral"}`;
  }
  function accessibleRoleLabel(value){
    const roles=normalizeRoleTokens(value);
    return roles.length?roles.map(role=>`${ROLE_META[role].display}, ${ROLE_META[role].label}`).join("; "):"Ruolo non disponibile";
  }
  function slotLine(moduleName,index){
    if(Number(index)===0)return "POR";
    const bands=String(moduleName||"").split("-").map(Number).filter(Number.isFinite);
    if(bands.length<3)return "CEN";
    const defenderEnd=1+bands[0];
    if(index<defenderEnd)return "DIF";
    const attackStart=1+bands.reduce((sum,count)=>sum+count,0)-bands[bands.length-1];
    if(index>=attackStart)return "ATT";
    if(bands.length>3){
      const midfieldEnd=defenderEnd+bands[1];
      if(index>=midfieldEnd)return "TRQ";
    }
    return "CEN";
  }
  function lineLabel(line){
    return {POR:"Portieri",DIF:"Difensori",CEN:"Centrocampisti",TRQ:"Trequarti",ATT:"Attaccanti"}[line]||"Giocatori";
  }

  return {ROLE_META,normalizeRoleTokens,displayRole,familiesFor,toneClass,accessibleRoleLabel,slotLine,lineLabel};
});
