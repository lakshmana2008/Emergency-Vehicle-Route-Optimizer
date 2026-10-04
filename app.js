import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1";

env.allowLocalModels = false;

const MODEL = "Xenova/LaMini-Flan-T5-77M";
let generator = null;
let currentRequest = null;

const locations = {
  A:{name:"Race Course", x:105, y:105},
  B:{name:"Saibaba Colony", x:330, y:80},
  C:{name:"Ukkadam", x:300, y:260},
  D:{name:"Town Hall", x:520, y:225},
  E:{name:"RS Puram", x:585, y:85},
  F:{name:"Gandhipuram", x:680, y:305}
};

const hospitals = {
  H1:{name:"Town Hall Emergency Hospital", x:610, y:225, near:"D"},
  H2:{name:"Saibaba Care Hospital", x:420, y:55, near:"B"},
  H3:{name:"Gandhipuram City Hospital", x:735, y:305, near:"F"}
};

const edges = [
  ["A","B",4],["A","C",5],["B","C",3],["B","E",4],
  ["C","D",3],["C","F",8],["D","E",2],["D","F",4],["E","F",6],
  ["D","H1",2],["B","H2",2],["F","H3",2]
];

const vehicles = [
  {id:"A01",driver:"Arun",start:"A",available:true},
  {id:"A02",driver:"Karthik",start:"B",available:true},
  {id:"A03",driver:"Vijay",start:"E",available:true}
];

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function setLoading(show,title="Checking emergency details...",text="Finding a nearby driver and preparing the route."){
  $("aiLoading").classList.toggle("hidden",!show);
  $("loadingTitle").textContent=title;
  $("loadingText").textContent=text;
}

function addTimeline(text, cls="done"){
  const li=document.createElement("li"); li.className=cls; li.textContent=text;
  $("timeline").appendChild(li);
}

function clearTimeline(){$("timeline").innerHTML='<li class="pending">No emergency submitted yet.</li>';}

function resolveLocation(text="", address=""){
  const aliases=[
    ["F",["gandhipuram","gandhi puram"]],
    ["E",["rs puram","r.s. puram","rs. puram"]],
    ["D",["town hall","townhall"]],
    ["C",["ukkadam"]],
    ["B",["saibaba colony","sai baba colony"]],
    ["A",["race course","racecourse"]]
  ];
  // If the caller supplies a dedicated address/landmark, that field has priority.
  const sources=[String(address||""),String(text||"")].filter(Boolean);
  for(const source of sources){
    const t=source.toLowerCase();
    for(const [id,words] of aliases){
      for(const word of words){
        const idx=t.indexOf(word);
        if(idx!==-1) return id;
      }
    }
  }
  return null;
}

function locationLabel(id, address=""){
  const base=locations[id]?.name || address || "Unknown location";
  return base;
}

function extractPeople(text){
  const m=text.match(/(\d+)\s*(?:people|persons|patients|victims|members|injured)/i);
  return m ? Number(m[1]) : (/one|1\b/i.test(text) ? 1 : 1);
}

function ruleFallback(text,address){
  const t=(text+" "+address).toLowerCase();
  let type="Medical Emergency";
  if(/accident|crash|collision|bike|car|vehicle/.test(t)) type="Road Accident";
  else if(/fire|smoke|burning|flame/.test(t)) type="Fire Emergency";
  else if(/heart|chest pain|breath|breathing|unconscious|faint|bleeding/.test(t)) type="Medical Emergency";
  let priority="Normal";
  if(/unconscious|not breathing|severe bleeding|heavy bleeding|trapped|multiple injured|major fire|critical/.test(t)) priority="Critical";
  else if(/injured|accident|crash|fire|breathing|serious|pain/.test(t)) priority="High";
  return {
    type, priority, location: address.trim() || (resolveLocation(text,address) ? locations[resolveLocation(text,address)].name : "Unknown location"),
    locationId: resolveLocation(text,address),
    people: extractPeople(text),
    summary: text.trim()
  };
}

async function getAI(){
  if(generator) return generator;
  setLoading(true,"Checking emergency details...","Finding a nearby driver and preparing the route.");
  generator = await pipeline("text2text-generation", MODEL, {dtype:"q8"});
  return generator;
}

async function analyzeWithAI(text,address){
  const fallback=ruleFallback(text,address);
  try{
    const ai=await getAI();
    setLoading(true,"Checking emergency details...","Finding a nearby driver and preparing the route.");
    const prompt=`Extract information from this emergency report. Return one short line in this exact format:
TYPE=Road Accident|Medical Emergency|Fire Emergency|Other; LOCATION=location mentioned; PEOPLE=number if stated; PRIORITY=Critical|High|Normal.
Do not invent information. If a field is not stated, use Unknown.
REPORT: ${text}. ADDRESS PROVIDED: ${address || "Unknown"}`;
    const out=await ai(prompt,{max_new_tokens:80,do_sample:false});
    const generated=(out?.[0]?.generated_text || "").trim();
    const parsed={...fallback};
    const typeMatch=generated.match(/TYPE\s*=\s*(Road Accident|Medical Emergency|Fire Emergency|Other)/i);
    const locMatch=generated.match(/LOCATION\s*=\s*([^;]+)/i);
    const peopleMatch=generated.match(/PEOPLE\s*=\s*(\d+)/i);
    const priorityMatch=generated.match(/PRIORITY\s*=\s*(Critical|High|Normal)/i);
    if(typeMatch) parsed.type=typeMatch[1];
    if(locMatch && !/unknown/i.test(locMatch[1])) parsed.location=locMatch[1].trim();
    if(peopleMatch) parsed.people=Number(peopleMatch[1]);
    if(priorityMatch) parsed.priority=priorityMatch[1][0].toUpperCase()+priorityMatch[1].slice(1).toLowerCase();
    // The map location is always resolved from the caller's text/address, never invented by the model.
    parsed.locationId=resolveLocation(text,address) || fallback.locationId;
    parsed.location = parsed.locationId ? locations[parsed.locationId].name : parsed.location;
    parsed.aiSource="Pretrained browser model + verified location mapping";
    return parsed;
  }catch(err){
    console.warn("Pretrained model unavailable; using safe local extraction fallback.",err);
    fallback.aiSource="Local extraction fallback (pretrained model unavailable)";
    return fallback;
  }
}

function graph(){
  const g={}; Object.keys(locations).forEach(k=>g[k]=[]); Object.keys(hospitals).forEach(k=>g[k]=[]);
  for(const [a,b,w] of edges){g[a].push({to:b,w});g[b].push({to:a,w});}
  return g;
}

function dijkstra(start,end){
  const g=graph(), dist={}, prev={}, unvisited=new Set(Object.keys(g));
  Object.keys(g).forEach(k=>dist[k]=Infinity); dist[start]=0;
  while(unvisited.size){
    let u=null;
    for(const n of unvisited) if(u===null || dist[n]<dist[u]) u=n;
    unvisited.delete(u);
    if(u===end) break;
    for(const e of g[u]){
      if(!unvisited.has(e.to)) continue;
      const alt=dist[u]+e.w;
      if(alt<dist[e.to]){dist[e.to]=alt;prev[e.to]=u;}
    }
  }
  if(dist[end]===Infinity) return null;
  const path=[]; let cur=end;
  while(cur){path.unshift(cur); if(cur===start) break; cur=prev[cur];}
  return {path,distance:dist[end]};
}

function candidateVehicles(target){
  return vehicles.filter(v=>v.available).map(v=>{
    const route=dijkstra(v.start,target);
    return {...v,route,distance:route?route.distance:Infinity};
  }).filter(v=>v.route).sort((a,b)=>a.distance-b.distance);
}


function candidateHospitals(from){
  return Object.keys(hospitals).map(id=>{
    const route=dijkstra(from,id);
    return {id,name:hospitals[id].name,route,distance:route?route.distance:Infinity};
  }).filter(h=>h.route).sort((a,b)=>a.distance-b.distance);
}

function hospitalName(id){ return hospitals[id]?.name || "Hospital"; }

function publish(request){
  localStorage.setItem("emergency_dispatch_request",JSON.stringify(request));
  localStorage.setItem("emergency_dispatch_updated",String(Date.now()));
  if("BroadcastChannel" in window){
    const bc=new BroadcastChannel("emergency_dispatch");
    bc.postMessage(request); bc.close();
  }
}

let liveMap = null;
let liveMapMarkers = [];
let liveMapRoute = null;
let liveMapBounds = null;
const mapPositions = {
  A: [11.0056, 76.9744],
  B: [11.0232, 76.9545],
  C: [10.9957, 76.9618],
  D: [10.9925, 76.9607],
  E: [11.0048, 76.9674],
  F: [11.0168, 76.9674],
  H1: [10.9941, 76.9635],
  H2: [11.0187, 76.9510],
  H3: [11.0194, 76.9701]
};

function ensureLeafletMap(){
  const mapEl = document.getElementById("userMapLeaflet");
  if (!mapEl) return null;
  if (liveMap) {
    liveMap.invalidateSize();
    return liveMap;
  }
  liveMap = window.L.map(mapEl, { zoomControl: true, scrollWheelZoom: false }).setView([11.0168, 76.9558], 12);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(liveMap);
  return liveMap;
}

function routePosition(routeIds, progress){
  if (!routeIds?.length) return null;
  const segmentCount = routeIds.length - 1;
  if (!segmentCount) return mapPositions[routeIds[0]] || null;
  const routeProgress = Math.max(0, Math.min(1, progress)) * segmentCount;
  const segment = Math.min(segmentCount - 1, Math.floor(routeProgress));
  const fraction = routeProgress - segment;
  const from = mapPositions[routeIds[segment]];
  const to = mapPositions[routeIds[segment + 1]];
  if (!from || !to) return null;
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
}

function updateLiveMap(requestData){
  const map = ensureLeafletMap();
  if (!map) return;
  liveMapMarkers.forEach(marker => marker.remove());
  liveMapMarkers = [];
  if (liveMapRoute) liveMapRoute.remove();

  const emergencyLocation = mapPositions[requestData?.locationId] || mapPositions.D;
  const selectedVehicle = mapPositions[requestData?.vehicleStart] || mapPositions.A;
  const hospitalLocation = mapPositions[requestData?.hospitalId] || mapPositions.H1;
  const hospitalPhase = ["To Hospital", "Hospital Arrived", "Completed"].includes(requestData?.status);
  const routeIds = hospitalPhase ? requestData?.hospitalRouteIds : requestData?.routeIds;
  const progress = Number(requestData?.progress || 0);
  const currentPosition = hospitalPhase
    ? routePosition(routeIds, progress)
    : requestData?.status === "Arrived"
      ? emergencyLocation
      : routePosition(routeIds, progress) || selectedVehicle;

  const emergencyMarker = window.L.marker(emergencyLocation).addTo(map)
    .bindPopup(`<b>${escapeHtml(requestData?.location || "Emergency")}</b>`);
  liveMapMarkers.push(emergencyMarker);

  const hospitalMarker = window.L.marker(hospitalLocation).addTo(map)
    .bindPopup(`<b>${escapeHtml(requestData?.hospital || "Hospital")}</b>`);
  liveMapMarkers.push(hospitalMarker);

  const ambulanceMarker = window.L.marker(currentPosition || selectedVehicle).addTo(map)
    .bindPopup(`<b>${escapeHtml(requestData?.vehicleId || "Ambulance")}</b><br>${escapeHtml(requestData?.driver || "Driver")}`);
  liveMapMarkers.push(ambulanceMarker);

  const routePositions = (routeIds || []).map(id => mapPositions[id]).filter(Boolean);
  if (routePositions.length > 1) {
    liveMapRoute = window.L.polyline(routePositions, { color: "#1769e0", weight: 5 }).addTo(map);
  }

  const bounds = window.L.latLngBounds([emergencyLocation, selectedVehicle, hospitalLocation, ...(routePositions || [])]);
  if (!liveMapBounds || !liveMapBounds.equals(bounds)) {
    liveMapBounds = bounds;
    map.fitBounds(bounds.pad(0.2));
  }
  map.invalidateSize();
}

async function sendEmergency(){
  const text=$("emergencyText").value.trim();
  const address=$("address").value.trim();
  if(!text && !address){alert("Please enter the emergency information.");return;}
  $("sendBtn").disabled=true; $("demoBtn").disabled=true; $("systemStatus").textContent="Dispatching...";
  $("resultEmpty").classList.add("hidden"); $("result").classList.remove("hidden");
  $("aiBadge").textContent="Preparing"; $("aiBadge").className="badge";
  $("routeBox").textContent="Waiting for AI analysis...";
  $("timeline").innerHTML="";
  addTimeline("📞 Caller information received","active");
  await sleep(350);
  const ai=await analyzeWithAI(text,address);
  setLoading(false);
  addTimeline(`Emergency identified: ${ai.type} • ${ai.priority}`);
  await sleep(300);

  const target=ai.locationId;
  if(!target){
    alert("Please provide a recognizable emergency location such as Town Hall, Gandhipuram, RS Puram, Ukkadam, Saibaba Colony or Race Course.");
    $("sendBtn").disabled=false; $("demoBtn").disabled=false;
    return;
  }
  const candidates=candidateVehicles(target);
  if(!candidates.length){alert("No available vehicle can reach this location in the demo graph."); $("sendBtn").disabled=false;$("demoBtn").disabled=false;return;}
  const selected=candidates[0];
  const route=selected.route;
  const eta=Math.max(1,Math.round(route.distance));
  const hospitalCandidates=candidateHospitals(target);
  const selectedHospital=hospitalCandidates[0];
  const hospitalRoute=selectedHospital.route;
  const hospitalEta=Math.max(1,Math.round(hospitalRoute.distance));

  $("aiBadge").textContent="Driver selected"; $("aiBadge").className="badge";
  $("typeValue").textContent=ai.type;
  $("locationValue").textContent=ai.location || locations[target].name;
  $("peopleValue").textContent=ai.people;
  $("vehicleValue").textContent=`${selected.id} — ${selected.driver}`;
  $("priorityBadge").textContent=ai.priority;
  $("priorityBadge").className="priority "+ai.priority.toLowerCase();
  $("routeBox").innerHTML=`<div class="route-path">${route.path.map(id=>locations[id]?.name || hospitalName(id)).join(" → ")}</div><div><b>Estimated time:</b> ${eta} minutes</div>`;
  if($("hospitalValue")) $("hospitalValue").textContent=selectedHospital.name;
  if($("hospitalRouteBox")) $("hospitalRouteBox").innerHTML=`<b>${escapeHtml(selectedHospital.name)}</b><br>${hospitalRoute.path.map(id=>locations[id]?.name || hospitalName(id)).join(" → ")}<br><b>${hospitalEta} min</b>`;
  addTimeline(`🚑 ${selected.id} (${selected.driver}) selected as nearest available vehicle`);
  await sleep(250);
  addTimeline(`🧮 Dijkstra route calculated: ${route.path.join(" → ")}`);
  await sleep(250);

  currentRequest={
    id:"EMG-"+Date.now(), timestamp:new Date().toLocaleTimeString(),
    caller:"Caller",
    text,address,
    type:ai.type,priority:ai.priority,people:ai.people,
    location:ai.location || locations[target].name, locationId:target,
    vehicleId:selected.id,driver:selected.driver,vehicleStart:selected.start,vehicleStartName:locations[selected.start].name,
    route:route.path.map(id=>locations[id].name), routeIds:route.path,
    eta, hospitalId:selectedHospital.id, hospital:selectedHospital.name, hospitalRoute:hospitalRoute.path.map(id=>locations[id]?.name || hospitalName(id)), hospitalRouteIds:hospitalRoute.path, hospitalEta,
    status:"NEW EMERGENCY", phase:"toEmergency", aiSource:ai.aiSource
  };
  publish(currentRequest);
  updateLiveMap(currentRequest);
  $("userMapPosition").textContent=`🚑 ${selected.driver} is waiting at ${locations[selected.start].name}`;
  $("driverReturnBadge").textContent="NEW EMERGENCY";
  $("driverReturn").innerHTML=`<strong>📱 Emergency sent to ${escapeHtml(selected.driver)}</strong><br>Waiting for driver acceptance.`;
  addTimeline(`📱 Emergency sent instantly to Driver Dashboard — ${selected.driver}`);
  $("systemStatus").textContent="Emergency Dispatched";
  $("systemDot").style.background="#ffbd3e";
  $("sendBtn").disabled=false;$("demoBtn").disabled=false;
}


function showDriverReturn(r){
  if(!r || !currentRequest || r.id!==currentRequest.id) return;
  const status=r.status||"NEW EMERGENCY", progress=Number(r.progress||0);
  const badge=$("driverReturnBadge"); if(!badge) return;
  badge.textContent=status; badge.className="small-status";
  const current=r.currentNode || r.vehicleStartName || "Vehicle base";
  const messages={"Accepted":"Driver accepted the emergency. Ambulance is preparing to depart.","En Route":"Driver is travelling to the emergency location.","Arrived":"Driver has arrived at the emergency location and is ready for the hospital trip.","To Hospital":"Driver is taking the patient to the selected hospital.","Hospital Arrived":"Driver has arrived at the selected hospital.","Completed":"Emergency trip completed at the hospital."};
  $("driverReturn").innerHTML=`<strong>🚑 ${escapeHtml(r.driver)} (${escapeHtml(r.vehicleId)})</strong><br>${messages[status]||"Emergency sent to driver."}<br><b>Current location:</b> ${escapeHtml(current)}${status==="En Route"?`<br><b>ETA remaining:</b> ${Math.max(0,Math.ceil((r.eta||1)*(1-progress)))} min`:""}`;
  updateLiveMap(r);
  $("userMapPosition").textContent=status==="Arrived"?`📍 Ambulance arrived at ${r.location}. Next: ${r.hospital}.`:status==="Hospital Arrived"?`🏥 Ambulance arrived at ${r.hospital}.`:status==="Completed"?`✓ Emergency completed at ${r.hospital}.`:`🚑 Ambulance position: ${current}`;
}

function restoreSavedRequest(){
  try{
    const saved=localStorage.getItem("emergency_dispatch_request");
    if(!saved) return;
    const r=JSON.parse(saved);
    if(!r || !r.id) return;
    currentRequest=r;
    $("resultEmpty").classList.add("hidden");
    $("result").classList.remove("hidden");
    $("aiBadge").textContent="Active request";
    $("aiBadge").className="badge";
    $("typeValue").textContent=r.type || "Unknown";
    $("locationValue").textContent=r.location || "Unknown";
    $("peopleValue").textContent=r.people ?? "Unknown";
    $("vehicleValue").textContent=`${r.vehicleId || "--"} — ${r.driver || "Driver"}`;
    $("priorityBadge").textContent=r.priority || "Normal";
    $("priorityBadge").className="priority "+String(r.priority||"Normal").toLowerCase();
    $("routeBox").innerHTML=`<div class="route-path">${(r.route||[]).map(escapeHtml).join(" → ")}</div><div><b>Estimated time:</b> ${r.eta||"--"} minutes</div>`;
    if($("hospitalValue")) $("hospitalValue").textContent=r.hospital||"--";
    if($("hospitalRouteBox")) $("hospitalRouteBox").innerHTML=`<b>${escapeHtml(r.hospital||"--")}</b><br>${(r.hospitalRoute||[]).map(escapeHtml).join(" → ")}<br><b>${r.hospitalEta||"--"} min</b>`;
    updateLiveMap(r);
    showDriverReturn(r);
    $("systemStatus").textContent=r.status==="Completed"?"Emergency Completed":"Emergency Dispatched";
    $("systemDot").style.background=r.status==="Completed"?"#35d07f":"#ffbd3e";
    addTimeline(`🔄 Restored emergency ${r.id} — ${r.status||"NEW EMERGENCY"}`);
  }catch(err){ console.warn("Could not restore saved emergency",err); }
}

window.addEventListener("storage",e=>{if(e.key==="emergency_dispatch_request"&&e.newValue){try{showDriverReturn(JSON.parse(e.newValue));}catch{}}});

if("BroadcastChannel" in window){const userBc=new BroadcastChannel("emergency_dispatch");userBc.onmessage=e=>{if(e.data?.fromDriver)showDriverReturn(e.data);};}

restoreSavedRequest();

$("sendBtn").addEventListener("click",sendEmergency);
$("demoBtn").addEventListener("click",()=>{
  $("emergencyText").value="There has been a road accident near Gandhipuram bus stand. Two people are injured and one person is unconscious.";
  $("address").value="Gandhipuram Bus Stand, Coimbatore";
});
$("clearBtn").addEventListener("click",()=>{clearTimeline();$("result").classList.add("hidden");$("resultEmpty").classList.remove("hidden");$("aiBadge").textContent="Waiting";$("aiBadge").className="badge muted";$("systemStatus").textContent="System Ready";$("systemDot").style.background="#35d07f";localStorage.removeItem("emergency_dispatch_request");});
