const $=id=>document.getElementById(id);
let request=null;
let animationTimer=null;
let animationStart=0;
const ANIMATION_MS=20000;
function showDriverDashboard(){
  const dashboard = $("driverDashboard");
  if (dashboard) dashboard.classList.remove("hidden");
  if(request){
    driverMapBounds=null;
    const onHospitalTrip=request.phase==="toHospital"||request.phase==="hospitalArrived"||request.phase==="completed";
    updateDriverMap(onHospitalTrip?request.hospitalRouteIds||[]:request.routeIds||[],Number(request.progress||0),request.phase||"toEmergency");
  }
}

const mapNodes={
  A:{name:"Race Course",position:[11.0056,76.9744]},
  B:{name:"Saibaba Colony",position:[11.0232,76.9545]},
  C:{name:"Ukkadam",position:[10.9957,76.9618]},
  D:{name:"Town Hall",position:[10.9925,76.9607]},
  E:{name:"RS Puram",position:[11.0048,76.9674]},
  F:{name:"Gandhipuram",position:[11.0168,76.9674]},
  H1:{name:"Town Hall Emergency Hospital",position:[10.9941,76.9635]},
  H2:{name:"Saibaba Care Hospital",position:[11.0187,76.9510]},
  H3:{name:"Gandhipuram City Hospital",position:[11.0194,76.9701]}
};
let driverMap = null;
let driverMapRoute = null;
let driverMapMarkers = [];
let driverMapBounds = null;

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setText(id,v){if($(id)) $(id).textContent=v;}
function setNextStep(status,label,disabled=false){
  const button=$("nextStepBtn");
  if(!button) return;
  button.classList.toggle("hidden",!status);
  button.dataset.status=status||"";
  button.textContent=label;
  button.disabled=disabled;
}

function syncRequestActions(r){
  const status=r.status||"NEW EMERGENCY";
  const acceptButton=$("acceptBtn");
  const accepted=status!=="NEW EMERGENCY";
  acceptButton.disabled=accepted;
  acceptButton.textContent=accepted?"✓ EMERGENCY ACCEPTED":"✓ ACCEPT EMERGENCY";
  if(status==="Accepted") setNextStep("En Route","🚑 Start driving to emergency");
  else if(status==="En Route") setNextStep("En Route","🚑 Continue to emergency");
  else if(status==="Arrived") setNextStep("To Hospital","🏥 Start driving to hospital");
  else if(status==="To Hospital") setNextStep("To Hospital","🏥 Continue to hospital");
  else if(status==="Hospital Arrived") setNextStep("Completed","✓ Complete emergency");
  else setNextStep(null,status==="Completed"?"Trip completed":"");
}

function routePosition(routeIds,progress){
  if(!routeIds?.length) return null;
  const segments=routeIds.length-1;
  if(!segments) return mapNodes[routeIds[0]]?.position || null;
  const position=Math.max(0,Math.min(1,progress))*segments;
  const segment=Math.min(segments-1,Math.floor(position));
  const fraction=position-segment;
  const from=mapNodes[routeIds[segment]]?.position;
  const to=mapNodes[routeIds[segment+1]]?.position;
  if(!from || !to) return null;
  return [from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction];
}

function updateDriverMap(routeIds=[],progress=0,phase="toEmergency"){
  if(!driverMap){
    const element=$("routeLeafletMap");
    if(!element || !window.L) return;
    driverMap=window.L.map(element,{scrollWheelZoom:false}).setView([11.0168,76.9558],12);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(driverMap);
  }
  driverMap.invalidateSize();
  if(driverMapRoute) driverMapRoute.remove();
  driverMapMarkers.forEach(marker=>marker.remove());
  driverMapMarkers=[];

  const path=(routeIds||[]).map(id=>mapNodes[id]?.position).filter(Boolean);
  if(path.length>1) driverMapRoute=window.L.polyline(path,{color:"#1769e0",weight:5}).addTo(driverMap);
  if(request){
    const emergency=mapNodes[request.locationId]?.position;
    const hospital=mapNodes[request.hospitalId]?.position;
    const base=mapNodes[request.vehicleStart]?.position;
    const current=phase==="atEmergency"?emergency:phase==="hospitalArrived"||phase==="completed"?hospital:routePosition(routeIds,progress)||base;
    [[emergency,request.location||"Emergency"],[hospital,request.hospital||"Hospital"],[current,`${request.vehicleId||"Ambulance"} — ${request.driver||"Driver"}`]].forEach(([position,label])=>{
      if(position) driverMapMarkers.push(window.L.marker(position).addTo(driverMap).bindPopup(`<b>${escapeHtml(label)}</b>`));
    });
    const bounds=window.L.latLngBounds([...(path||[]),...(emergency?[emergency]:[]),...(hospital?[hospital]:[]),...(base?[base]:[])]);
    if(!driverMapBounds || !driverMapBounds.equals(bounds)){
      driverMapBounds=bounds;
      driverMap.fitBounds(bounds.pad(0.2));
    }
  }else if(path.length){
    const bounds=window.L.latLngBounds(path);
    if(!driverMapBounds || !driverMapBounds.equals(bounds)){
      driverMapBounds=bounds;
      driverMap.fitBounds(bounds.pad(0.2));
    }
  }
}

function showRequest(r){
  request=r;
  if(!r) return;
  setText("driverVehicle",`AMBULANCE ${r.vehicleId || "--"}`);
  setText("driverName",`Welcome, ${r.driver || "Driver"}`);
  setText("driverAvailability",r.status === "Completed" ? "Trip completed • Waiting for next dispatch" : r.status&&r.status!=="NEW EMERGENCY" ? "Emergency in progress" : "Available • Waiting for emergency");
  setText("incomingTitle",r.status==="Completed"?"EMERGENCY COMPLETED":r.status&&r.status!=="NEW EMERGENCY"?"EMERGENCY IN PROGRESS":"NEW EMERGENCY RECEIVED");
  $("waiting").classList.add("hidden"); $("incoming").classList.remove("hidden");
  setText("incomingTime",r.timestamp); setText("driverType",r.type); setText("driverLocation",r.location); setText("driverPeople",r.people); setText("driverDetails",r.text); setText("driverPriority",r.priority);
  $("driverPriority").className="priority "+r.priority.toLowerCase();
  setText("routeFrom",r.vehicleStartName || "Vehicle Base"); setText("routeTo",r.location); setText("routeEta",r.eta+" min");
  $("driverRoute").innerHTML=`<b>To emergency:</b> ${r.route.map((x,i)=>`${i?'<b> ↓ </b>':''}${escapeHtml(x)}`).join("")}<br><br><b>Then to hospital:</b> ${(r.hospitalRoute||[]).map((x,i)=>`${i?'<b> ↓ </b>':''}${escapeHtml(x)}`).join("")}<br><br>🏥 <b>${escapeHtml(r.hospital||"Hospital")}</b> • ${r.hospitalEta||"--"} min`;
  const onHospitalTrip=r.phase==="toHospital"||r.phase==="hospitalArrived"||r.phase==="completed";
  const route=onHospitalTrip?r.hospitalRouteIds||[]:r.routeIds||[];
  updateDriverMap(route,Number(r.progress||0),r.phase||"toEmergency");
  setText("mapPosition",r.currentNode?`Ambulance location: ${r.currentNode}`:"Vehicle waiting at "+(r.vehicleStartName||"Vehicle Base"));
  setText("statusBadge",(r.status||"NEW ALERT").toUpperCase()); $("statusBadge").className="badge";
  syncRequestActions(r);
  setText("driverLog",r.status&&r.status!=="NEW EMERGENCY"?`Current step: ${r.status}. Use the button above to continue.`:`A request was sent to ${r.driver} (${r.vehicleId}). Accept to begin.`);
}

function publishUpdate(status,extra={}){
  if(!request) return;
  request={...request,status,...extra,lastUpdate:Date.now()};
  localStorage.setItem("emergency_dispatch_request",JSON.stringify(request));
  localStorage.setItem("emergency_dispatch_updated",String(Date.now()));
  if("BroadcastChannel" in window){const bc=new BroadcastChannel("emergency_dispatch");bc.postMessage({...request,fromDriver:true});bc.close();}
}

function updateStatus(status){
  if(!request) return;
  if(status==="Completed" && request.phase!=="hospitalArrived") {
    setText("driverLog","Please complete the hospital trip before marking the emergency completed."); return;
  }
  if(status==="En Route"){
    setNextStep(null,"Driving to emergency...",true);
    startMovement(Number(request.progress)||0);
  }else if(status==="To Hospital"){
    setNextStep(null,"Driving to hospital...",true);
    startHospitalMovement(Number(request.progress)||0);
  }
  else stopMovement();

  if(status==="Accepted"){
    request.phase="toEmergency";
    publishUpdate(status,{progress:0,currentNode:request.vehicleStartName});
    syncRequestActions(request);
    setText("driverLog",`Driver ${request.driver} accepted the emergency. The route to ${request.location} is ready.`);
  } else if(status==="Arrived"){
    request.phase="atEmergency";
    publishUpdate(status,{progress:1,currentNode:request.location});
    setText("mapPosition","📍 Ambulance arrived at emergency location");
    updateDriverMap(request.routeIds||[],1,"atEmergency");
    syncRequestActions(request);
    setText("driverLog",`Ambulance arrived at ${request.location}. Click To Hospital to continue.`);
  } else if(status==="To Hospital"){
    request.phase="toHospital";
    publishUpdate(status,{progress:0,currentNode:request.location});
    setText("driverLog",`Hospital trip started. Driving to ${request.hospital}.`);
  } else if(status==="Hospital Arrived"){
    request.phase="hospitalArrived";
    publishUpdate(status,{progress:1,currentNode:request.hospital});
    setText("mapPosition","🏥 Ambulance arrived at "+request.hospital);
    updateDriverMap(request.hospitalRouteIds||[],1,"hospitalArrived");
    syncRequestActions(request);
    setText("driverLog",`Ambulance arrived at ${request.hospital}. You can now complete the emergency.`);
  } else if(status==="Completed"){
    request.phase="completed";
    publishUpdate(status,{progress:1,currentNode:request.hospital});
    setText("mapPosition","✓ Emergency completed at "+request.hospital);
    setText("driverLog",`Emergency completed by ${request.driver}. Hospital: ${request.hospital}. Return information sent to the emergency dashboard.`);
    setText("driverAvailability","Trip completed • Waiting for next dispatch");
    syncRequestActions(request);
  }
  setText("statusBadge",status.toUpperCase()); $("statusBadge").className="badge";
}

function startMovement(startProgress=0){
  stopMovement(); animationStart=performance.now()-Math.max(0,Math.min(1,startProgress))*ANIMATION_MS;
  const tick=(now)=>{
    if(!request) return;
    const progress=Math.min(1,(now-animationStart)/ANIMATION_MS);
    const route=request.routeIds||[];
    const segment=Math.min(route.length-1,Math.floor(progress*Math.max(1,route.length-1)));
    const nodeName=mapNodes[route[Math.min(segment,route.length-1)]]?.name || "En route";
    updateDriverMap(route,progress,"toEmergency");
    setText("mapPosition",progress>=1?"Arrived at "+request.location:`En route • near ${nodeName}`);
    const remaining=Math.max(0,Math.ceil((request.eta||1)*(1-progress))); setText("routeEtaLive",remaining+" min remaining");
    publishUpdate("En Route",{progress,currentNode:progress>=1?request.location:nodeName,phase:"toEmergency"});
    if(progress<1){animationTimer=requestAnimationFrame(tick);}else{stopMovement(); publishUpdate("Arrived",{progress:1,currentNode:request.location,phase:"atEmergency"}); setText("statusBadge","ARRIVED"); $("statusBadge").className="badge"; syncRequestActions(request); setText("driverLog","Ambulance reached the emergency location. Start the hospital trip when ready.");}
  }; animationTimer=requestAnimationFrame(tick);
}
function startHospitalMovement(startProgress=0){
  stopMovement(); animationStart=performance.now()-Math.max(0,Math.min(1,startProgress))*ANIMATION_MS;
  const tick=(now)=>{
    if(!request) return;
    const progress=Math.min(1,(now-animationStart)/ANIMATION_MS);
    const route=request.hospitalRouteIds||[];
    const segment=Math.min(route.length-1,Math.floor(progress*Math.max(1,route.length-1)));
    const nodeName=mapNodes[route[Math.min(segment,route.length-1)]]?.name || "En route to hospital";
    updateDriverMap(route,progress,"toHospital");
    setText("mapPosition",progress>=1?"Arrived at "+request.hospital:`En route to hospital • near ${nodeName}`);
    const remaining=Math.max(0,Math.ceil((request.hospitalEta||1)*(1-progress))); setText("routeEtaLive",remaining+" min to hospital");
    publishUpdate("To Hospital",{progress,currentNode:progress>=1?request.hospital:nodeName,phase:"toHospital"});
    if(progress<1){animationTimer=requestAnimationFrame(tick);}else{stopMovement(); publishUpdate("Hospital Arrived",{progress:1,currentNode:request.hospital,phase:"hospitalArrived"}); setText("statusBadge","HOSPITAL ARRIVED"); $("statusBadge").className="badge"; syncRequestActions(request); setText("driverLog",`Ambulance arrived at ${request.hospital}. Complete the emergency when ready.`);}
  }; animationTimer=requestAnimationFrame(tick);
}

function stopMovement(){if(animationTimer){cancelAnimationFrame(animationTimer);animationTimer=null;}}

window.addEventListener("storage",e=>{if(e.key==="emergency_dispatch_request"&&e.newValue){try{showRequest(JSON.parse(e.newValue));}catch(err){console.warn("Could not read emergency update",err);}}});
if("BroadcastChannel" in window){const bc=new BroadcastChannel("emergency_dispatch");bc.onmessage=e=>{if(e.data?.fromDriver) return;showRequest(e.data);};}
try{const saved=localStorage.getItem("emergency_dispatch_request");if(saved)showRequest(JSON.parse(saved));}catch(err){console.warn("Could not restore emergency request",err);}

showDriverDashboard();

if ($("acceptBtn")) $("acceptBtn").addEventListener("click",()=>{
  updateStatus("Accepted");
  setText("driverLog",`Driver ${request.driver} accepted the emergency. Use the next-step button to start the trip.`);
});
if($("nextStepBtn")) $("nextStepBtn").addEventListener("click",event=>{
  const status=event.currentTarget.dataset.status;
  if(status) updateStatus(status);
});
