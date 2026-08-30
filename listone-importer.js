(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.FA2ListoneImporter=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function normalizeKey(value){
    return String(value??"")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
  }

  function detectDelimiter(source){
    const lines=String(source||"").split(/\r?\n/).filter(line=>line.trim()).slice(0,8);
    const candidates=[";",",","\t"];
    return candidates.map(delimiter=>({
      delimiter,
      score:Math.max(0,...lines.map(line=>(line.match(new RegExp(delimiter==="\t"?"\\t":`\\${delimiter}`,"g"))||[]).length))
    })).sort((a,b)=>b.score-a.score||candidates.indexOf(a.delimiter)-candidates.indexOf(b.delimiter))[0].delimiter;
  }

  function splitDelimited(source,delimiter){
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
      if(ch===delimiter){row.push(cell);cell="";continue}
      if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell="";continue}
      if(ch!=="\r")cell+=ch;
    }
    if(quoted)throw new Error("CSV non valido: virgolette non chiuse.");
    if(cell!==""||row.length){row.push(cell);rows.push(row)}
    return rows.filter(values=>values.some(value=>String(value).trim()));
  }

  const FIELD_ALIASES={
    name:["nome","name","giocatore","player","calciatore"],
    club:["squadra","club","team","societa"],
    role:["rm","ruolomantra","mantra","ruolo","role"],
    classic:["r","classic","ruoloclassic","ruoloclassico"],
    quote:["qtam","quotazionemantra","quotazione","quote","quot"],
    fvm:["fvmm","fvmantra","fvm"],
    birthYear:["annonascita","birthyear"],
    active:["attivo","active"],
    sourceId:["id","playerid","idgiocatore"]
  };

  function findAliasIndex(header,aliases){
    for(const alias of aliases){
      const index=header.indexOf(alias);
      if(index>=0)return index;
    }
    return -1;
  }

  function resolveHeader(values){
    const header=values.map(normalizeKey);
    const indexes={};
    for(const [field,aliases] of Object.entries(FIELD_ALIASES))indexes[field]=findAliasIndex(header,aliases);
    return {indexes,valid:indexes.name>=0&&indexes.club>=0&&indexes.role>=0};
  }

  function parseDelimited(text){
    const source=String(text||"").replace(/^\uFEFF/,"");
    const delimiter=detectDelimiter(source);
    const rows=splitDelimited(source,delimiter);
    if(rows.length<2)throw new Error("CSV vuoto o privo di righe dati.");
    const searchLimit=Math.min(rows.length,10);
    let headerRow=-1,resolved=null;
    for(let i=0;i<searchLimit;i++){
      const candidate=resolveHeader(rows[i]);
      if(candidate.valid){headerRow=i;resolved=candidate;break}
    }
    if(headerRow<0)throw new Error("Intestazioni obbligatorie: nome, club e ruolo (oppure Nome, Squadra e RM nel formato ufficiale).");
    return rows.slice(headerRow+1).filter(values=>values.some(value=>String(value).trim())).map((values,index)=>{
      const record={_sourceRow:headerRow+index+2};
      for(const [field,column] of Object.entries(resolved.indexes))if(column>=0)record[field]=values[column]??"";
      return record;
    });
  }

  function normalizeRole(value){
    const canonical={por:"Por",dd:"Dd",ds:"Ds",dc:"Dc",b:"B",e:"E",m:"M",c:"C",w:"W",t:"T",a:"A",pc:"Pc"};
    return String(value||"").split(/[\/;]+/).map(token=>canonical[token.trim().toLowerCase()]||token.trim()).filter(Boolean).join("/");
  }

  function normalizeClub(value,clubPairs=[]){
    const raw=String(value??"").trim(),key=normalizeKey(raw);
    const match=clubPairs.find(([code,name])=>normalizeKey(code)===key||normalizeKey(name)===key);
    return match?String(match[0]).toUpperCase():raw.toUpperCase();
  }

  return {parseDelimited,normalizeRole,normalizeClub,normalizeKey};
});
