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

const vehicles = [
  {id:"A01",driver:"Arun",start:"A",available:true,coordinates:[11.0056,76.9744]},
  {id:"A02",driver:"Karthik",start:"B",available:true,coordinates:[11.0232,76.9545]},
  {id:"A03",driver:"Vijay",start:"E",available:true,coordinates:[11.0048,76.9674]}
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
    parsed.location = address || parsed.location;
    parsed.aiSource="Pretrained browser model";
    return parsed;
  }catch(err){
    console.warn("Pretrained model unavailable; using safe local extraction fallback.",err);
    fallback.aiSource="Local extraction fallback (pretrained model unavailable)";
    return fallback;
  }
}

async function fetchServiceJson(url,label,options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),25000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    if(!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
    const data=await response.json();
    if(data.error) throw new Error(`${label}: ${data.error}`);
    return data;
  }catch(error){
    if(error.name==="AbortError") throw new Error(`${label} took too long. Please try again.`);
    if(error instanceof TypeError) throw new Error(`${label} is unreachable. Check your internet connection and try again.`);
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}

async function geocodeAddress(query){
  const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const results=await fetchServiceJson(url,"OpenStreetMap address search");
  if(!results.length) throw new Error("We couldn’t find that address. Include a town or city and try again.");
  const result=results[0];
  return {
    name:result.display_name,
    coordinates:[Number(result.lat),Number(result.lon)]
  };
}

function serviceCoordinates([lat,lon]){
  return `${lon},${lat}`;
}

async function osrmTable(origins,destinations){
  const allCoordinates=[...origins,...destinations];
  const sourceIndexes=origins.map((_,index)=>index).join(";");
  const destinationIndexes=destinations.map((_,index)=>origins.length+index).join(";");
  const coordinates=allCoordinates.map(serviceCoordinates).join(";");
  const url=`https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=${sourceIndexes}&destinations=${destinationIndexes}&annotations=duration,distance`;
  const table=await fetchServiceJson(url,"OpenStreetMap road routing");
  if(table.code!=="Ok"||!table.durations?.length||!table.distances?.length){
    throw new Error("No drivable road route was found for these locations.");
  }
  return table;
}

async function osrmRoute(from,to){
  const url=`https://router.project-osrm.org/route/v1/driving/${serviceCoordinates(from)};${serviceCoordinates(to)}?overview=full&geometries=geojson&steps=false`;
  const result=await fetchServiceJson(url,"OpenStreetMap road directions");
  const route=result.routes?.[0];
  if(result.code!=="Ok"||!route?.geometry?.coordinates?.length){
    throw new Error("No drivable road route was found for these locations.");
  }
  return {
    coordinates:route.geometry.coordinates.map(([lon,lat])=>[lat,lon]),
    duration:route.duration,
    distance:route.distance
  };
}

function distanceBetween(a,b){
  const radians=value=>value*Math.PI/180;
  const [lat1,lon1]=a.map(radians),[lat2,lon2]=b.map(radians);
  const dLat=lat2-lat1,dLon=lon2-lon1;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

async function findHospitalsWithNominatim(location){
  await sleep(1000);
  const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=20&q=${encodeURIComponent(`hospital near ${location.name}`)}`;
  const results=await fetchServiceJson(url,"OpenStreetMap hospital search");
  const candidates=results.filter(result=>result.type==="hospital").map(result=>({
    name:result.name||result.display_name,
    coordinates:[Number(result.lat),Number(result.lon)]
  })).filter(hospital=>
    hospital.name&&hospital.coordinates.every(Number.isFinite)&&
    distanceBetween(hospital.coordinates,location.coordinates)<=30000
  ).sort((a,b)=>distanceBetween(a.coordinates,location.coordinates)-distanceBetween(b.coordinates,location.coordinates));
  const unique=candidates.filter((candidate,index,list)=>list.findIndex(other=>
    other.name===candidate.name&&distanceBetween(other.coordinates,candidate.coordinates)<100
  )===index);
  if(!unique.length) throw new Error("No OpenStreetMap hospitals were found within 30 km of that address.");
  return unique.slice(0,8);
}

async function findNearbyHospitals(location){
  const [lat,lon]=location.coordinates;
  const query=`[out:json][timeout:20];(nwr["amenity"="hospital"](around:30000,${lat},${lon}););out center tags 100;`;
  const url=`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  try{
    const data=await fetchServiceJson(url,"OpenStreetMap hospital search");
    const candidates=(data.elements||[]).map(element=>{
      const point=element.type==="node"?[element.lat,element.lon]:[element.center?.lat,element.center?.lon];
      if(!point[0]||!point[1]) return null;
      return {
        name:element.tags?.name||element.tags?.["name:en"]||"Unnamed hospital",
        coordinates:[Number(point[0]),Number(point[1])]
      };
    }).filter(Boolean);
    const unique=candidates.filter((candidate,index,list)=>list.findIndex(other=>
      other.name===candidate.name&&distanceBetween(other.coordinates,candidate.coordinates)<100
    )===index);
    if(!unique.length) throw new Error("No OpenStreetMap hospitals were found within 30 km of that address.");
    return unique.sort((a,b)=>distanceBetween(a.coordinates,location.coordinates)-distanceBetween(b.coordinates,location.coordinates)).slice(0,8);
  }catch(overpassError){
    console.warn("Overpass hospital search failed; trying Nominatim.",overpassError);
    try{
      return await findHospitalsWithNominatim(location);
    }catch(nominatimError){
      const overpassMessage=overpassError instanceof Error?overpassError.message:String(overpassError);
      const nominatimMessage=nominatimError instanceof Error?nominatimError.message:String(nominatimError);
      throw new Error(`Hospital search failed. Overpass: ${overpassMessage} Nominatim fallback: ${nominatimMessage}`);
    }
  }
}

function formatMinutes(seconds){
  return Math.max(1,Math.ceil(seconds/60));
}

function formatDistance(meters){
  return meters>=1000?`${(meters/1000).toFixed(1)} km`:`${Math.round(meters)} m`;
}

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

function routePosition(routeCoordinates, progress){
  if(!routeCoordinates?.length) return null;
  if(routeCoordinates.length===1) return routeCoordinates[0];
  const lengths=[];
  let totalLength=0;
  for(let index=1;index<routeCoordinates.length;index++){
    const length=distanceBetween(routeCoordinates[index-1],routeCoordinates[index]);
    lengths.push(length);
    totalLength+=length;
  }
  if(totalLength===0) return routeCoordinates[0];
  let remaining=totalLength*Math.max(0,Math.min(1,progress));
  for(let index=0;index<lengths.length;index++){
    if(remaining<=lengths[index]||index===lengths.length-1){
      const fraction=lengths[index]?remaining/lengths[index]:0;
      const from=routeCoordinates[index],to=routeCoordinates[index+1];
      return [from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction];
    }
    remaining-=lengths[index];
  }
  return routeCoordinates[routeCoordinates.length-1];
}

function updateLiveMap(requestData){
  const map = ensureLeafletMap();
  if (!map) return;
  liveMapMarkers.forEach(marker => marker.remove());
  liveMapMarkers = [];
  if (liveMapRoute) liveMapRoute.remove();

  const emergencyLocation = requestData?.locationCoordinates || mapPositions[requestData?.locationId] || mapPositions.D;
  const selectedVehicle = requestData?.vehicleCoordinates || mapPositions[requestData?.vehicleStart] || mapPositions.A;
  const hospitalLocation = requestData?.hospitalCoordinates || mapPositions[requestData?.hospitalId] || mapPositions.H1;
  const hospitalPhase = ["To Hospital", "Hospital Arrived", "Completed"].includes(requestData?.status);
  const routeCoordinates = hospitalPhase
    ? requestData?.hospitalRouteCoordinates || (requestData?.hospitalRouteIds || []).map(id=>mapPositions[id]).filter(Boolean)
    : requestData?.routeCoordinates || (requestData?.routeIds || []).map(id=>mapPositions[id]).filter(Boolean);
  const progress = Number(requestData?.progress || 0);
  const currentPosition = hospitalPhase
    ? routePosition(routeCoordinates, progress)
    : requestData?.status === "Arrived"
      ? emergencyLocation
      : routePosition(routeCoordinates, progress) || selectedVehicle;

  const emergencyMarker = window.L.marker(emergencyLocation).addTo(map)
    .bindPopup(`<b>${escapeHtml(requestData?.location || "Emergency")}</b>`);
  liveMapMarkers.push(emergencyMarker);

  const hospitalMarker = window.L.marker(hospitalLocation).addTo(map)
    .bindPopup(`<b>${escapeHtml(requestData?.hospital || "Hospital")}</b>`);
  liveMapMarkers.push(hospitalMarker);

  const ambulanceMarker = window.L.marker(currentPosition || selectedVehicle).addTo(map)
    .bindPopup(`<b>${escapeHtml(requestData?.vehicleId || "Ambulance")}</b><br>${escapeHtml(requestData?.driver || "Driver")}`);
  liveMapMarkers.push(ambulanceMarker);

  const routePositions = routeCoordinates || [];
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
  const dispatchError=$("dispatchError");
  dispatchError.classList.add("hidden");
  dispatchError.textContent="";
  if(!text && !address){
    dispatchError.textContent="Enter what happened and where it happened.";
    dispatchError.classList.remove("hidden");
    $("emergencyText").focus();
    return;
  }
  if(!address){
    dispatchError.textContent="Enter a street, landmark, town or city so OpenStreetMap can find the emergency.";
    dispatchError.classList.remove("hidden");
    $("address").focus();
    return;
  }
  $("sendBtn").disabled=true; $("demoBtn").disabled=true; $("systemStatus").textContent="Dispatching...";
  $("resultEmpty").classList.add("hidden"); $("result").classList.remove("hidden");
  $("aiBadge").textContent="Finding location"; $("aiBadge").className="badge";
  $("routeBox").textContent="Searching OpenStreetMap for the emergency address...";
  $("hospitalRouteBox").textContent="Searching for nearby hospitals...";
  $("timeline").innerHTML="";
  addTimeline("📞 Caller information received","active");
  setLoading(true,"Finding your location...","Searching OpenStreetMap and checking real road routes.");
  try{
    const [incident,ai]=await Promise.all([
      geocodeAddress(address),
      analyzeWithAI(text,address)
    ]);
    setLoading(true,"Finding a nearby hospital...","Checking OpenStreetMap hospitals and real road travel times.");
    addTimeline(`📍 Location found: ${incident.name}`);

    const hospitalCandidates=await findNearbyHospitals(incident);
    const availableVehicles=vehicles.filter(vehicle=>vehicle.available);
    const [vehicleTable,hospitalTable]=await Promise.all([
      osrmTable(availableVehicles.map(vehicle=>vehicle.coordinates),[incident.coordinates]),
      osrmTable([incident.coordinates],hospitalCandidates.map(hospital=>hospital.coordinates))
    ]);
    const reachableVehicles=availableVehicles.map((vehicle,index)=>({
      vehicle,
      duration:vehicleTable.durations?.[index]?.[0]
    })).filter(candidate=>Number.isFinite(candidate.duration))
      .sort((a,b)=>a.duration-b.duration);
    if(!reachableVehicles.length) throw new Error("No available demo ambulance has a drivable route to this location.");

    const reachableHospitals=hospitalCandidates.map((hospital,index)=>({
      ...hospital,
      duration:hospitalTable.durations?.[0]?.[index],
      distance:hospitalTable.distances?.[0]?.[index]
    })).filter(hospital=>Number.isFinite(hospital.duration)&&Number.isFinite(hospital.distance))
      .sort((a,b)=>a.duration-b.duration);
    if(!reachableHospitals.length) throw new Error("No nearby hospital has a drivable route from this location.");

    const selected=reachableVehicles[0].vehicle;
    const selectedHospital=reachableHospitals[0];
    setLoading(true,"Preparing road directions...","Loading the selected ambulance and hospital routes.");
    const [route,hospitalRoute]=await Promise.all([
      osrmRoute(selected.coordinates,incident.coordinates),
      osrmRoute(incident.coordinates,selectedHospital.coordinates)
    ]);
    const eta=formatMinutes(route.duration);
    const hospitalEta=formatMinutes(hospitalRoute.duration);
    setLoading(false);
    addTimeline(`Emergency identified: ${ai.type} • ${ai.priority}`);
    addTimeline(`🚑 Nearest available demo ambulance: ${selected.id} (${selected.driver})`);
    addTimeline(`🗺️ OpenStreetMap road route: ${formatDistance(route.distance)} • about ${eta} min`);
    addTimeline(`🏥 Nearest routed hospital: ${selectedHospital.name}`);

    $("aiBadge").textContent="Driver selected"; $("aiBadge").className="badge";
    $("typeValue").textContent=ai.type;
    $("locationValue").textContent=incident.name;
    $("peopleValue").textContent=ai.people;
    $("vehicleValue").textContent=`${selected.id} — ${selected.driver}`;
    $("priorityBadge").textContent=ai.priority;
    $("priorityBadge").className="priority "+ai.priority.toLowerCase();
    $("routeBox").innerHTML=`<div class="route-path">${escapeHtml(selected.start==="A"?"Race Course":selected.start==="B"?"Saibaba Colony":"RS Puram")} → ${escapeHtml(incident.name)}</div><div><b>Road distance:</b> ${formatDistance(route.distance)} • <b>Estimated drive:</b> ${eta} min</div>`;
    $("hospitalValue").textContent=selectedHospital.name;
    $("hospitalRouteBox").innerHTML=`<b>${escapeHtml(selectedHospital.name)}</b><br><b>Road distance:</b> ${formatDistance(hospitalRoute.distance)} • <b>Estimated drive:</b> ${hospitalEta} min`;

    currentRequest={
      id:"EMG-"+Date.now(),timestamp:new Date().toLocaleTimeString(),
      caller:"Caller",text,address,type:ai.type,priority:ai.priority,people:ai.people,
      location:incident.name,locationCoordinates:incident.coordinates,
      vehicleId:selected.id,driver:selected.driver,vehicleStart:selected.start,
      vehicleStartName:locations[selected.start].name,vehicleCoordinates:selected.coordinates,
      route:[selected.start==="A"?"Race Course":selected.start==="B"?"Saibaba Colony":"RS Puram",incident.name],
      routeCoordinates:route.coordinates,routeDistance:route.distance,eta,
      hospital:selectedHospital.name,hospitalCoordinates:selectedHospital.coordinates,
      hospitalRoute:[incident.name,selectedHospital.name],hospitalRouteCoordinates:hospitalRoute.coordinates,
      hospitalRouteDistance:hospitalRoute.distance,hospitalEta,
      status:"NEW EMERGENCY",phase:"toEmergency",progress:0,aiSource:ai.aiSource
    };
    publish(currentRequest);
    updateLiveMap(currentRequest);
    $("userMapPosition").textContent=`🚑 ${selected.driver} is waiting at the demo base in ${selected.start==="A"?"Race Course":selected.start==="B"?"Saibaba Colony":"RS Puram"}, Coimbatore.`;
    $("driverReturnBadge").textContent="NEW EMERGENCY";
    $("driverReturn").innerHTML=`<strong>📱 Emergency sent to ${escapeHtml(selected.driver)}</strong><br>Ambulance movement is simulated from its demo base.`;
    addTimeline(`📱 Emergency sent to Driver Dashboard — ${selected.driver}`);
    $("systemStatus").textContent="Emergency Dispatched";
    $("systemDot").style.background="#ffbd3e";
  }catch(error){
    console.error("Emergency dispatch failed",error);
    const message=error instanceof Error?error.message:"An unexpected error prevented dispatch.";
    dispatchError.textContent=message;
    dispatchError.classList.remove("hidden");
    $("aiBadge").textContent="Dispatch failed"; $("aiBadge").className="badge";
    $("routeBox").textContent="No ambulance route is available because dispatch failed.";
    $("hospitalRouteBox").textContent="No hospital route is available because dispatch failed.";
    $("systemStatus").textContent="Dispatch Failed";
    $("systemDot").style.background="#d92d20";
    addTimeline(`Dispatch failed: ${message}`,"active");
  }finally{
    setLoading(false);
    $("sendBtn").disabled=false;
    $("demoBtn").disabled=false;
  }
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
    $("routeBox").innerHTML=`<div class="route-path">${(r.route||[]).map(escapeHtml).join(" → ")}</div><div><b>Road distance:</b> ${r.routeDistance?formatDistance(r.routeDistance):"--"} • <b>Estimated drive:</b> ${r.eta||"--"} min</div>`;
    if($("hospitalValue")) $("hospitalValue").textContent=r.hospital||"--";
    if($("hospitalRouteBox")) $("hospitalRouteBox").innerHTML=`<b>${escapeHtml(r.hospital||"--")}</b><br><b>Road distance:</b> ${r.hospitalRouteDistance?formatDistance(r.hospitalRouteDistance):"--"} • <b>Estimated drive:</b> ${r.hospitalEta||"--"} min`;
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
