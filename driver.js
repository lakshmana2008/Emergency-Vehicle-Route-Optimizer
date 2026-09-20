const $=id=>document.getElementById(id);
let request=null;
let animationTimer=null;
let animationStart=0;
const ANIMATION_MS=20000;

const mapNodes={
  A:{name:"Race Course",x:95,y:85},B:{name:"Saibaba Colony",x:315,y:65},C:{name:"Ukkadam",x:285,y:230},
  D:{name:"Town Hall",x:510,y:195},E:{name:"RS Puram",x:575,y:70},F:{name:"Gandhipuram",x:685,y:275},
  H1:{name:"Town Hall Emergency Hospital",x:610,y:195},H2:{name:"Saibaba Care Hospital",x:410,y:45},H3:{name:"Gandhipuram City Hospital",x:745,y:275}
};
const mapEdges=[["A","B",4],["A","C",5],["B","C",3],["B","E",4],["C","D",3],["C","F",8],["D","E",2],["D","F",4],["E","F",6],["D","H1",2],["B","H2",2],["F","H3",2]];

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setText(id,v){if($(id)) $(id).textContent=v;}

function mapSvg(routeIds=[],progress=0){
  const routeSet=new Set();
  for(let i=0;i<routeIds.length-1;i++) routeSet.add(routeIds[i]+"-"+routeIds[i+1]);
  const edges=mapEdges.map(([a,b,w])=>{
    const n1=mapNodes[a],n2=mapNodes[b];
    const active=routeSet.has(a+"-"+b)||routeSet.has(b+"-"+a);
    return `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" class="road ${active?'route-road':''}"/><text x="${(n1.x+n2.x)/2}" y="${(n1.y+n2.y)/2-8}" class="road-label">${w}m</text>`;
  }).join("");
  const nodes=Object.entries(mapNodes).map(([id,n])=>`<g><circle cx="${n.x}" cy="${n.y}" r="19" class="map-node"/><text x="${n.x}" y="${n.y+5}" text-anchor="middle" class="node-id">${id}</text><text x="${n.x}" y="${n.y+38}" text-anchor="middle" class="node-name">${escapeHtml(n.name)}</text></g>`).join("");
  let marker="";
  if(routeIds.length){
    const max=Math.max(0,routeIds.length-1); const pos=Math.min(max,progress*max); const i=Math.min(max-1,Math.floor(pos)); const t=max===0?0:pos-i;
    const from=mapNodes[routeIds[Math.max(0,i)]]; const to=mapNodes[routeIds[Math.min(max,i+1)]] || from;
    const x=from.x+(to.x-from.x)*t, y=from.y+(to.y-from.y)*t;
    marker=`<g class="ambulance-marker"><circle cx="${x}" cy="${y}" r="15"/><text x="${x}" y="${y+5}" text-anchor="middle">🚑</text></g>`;
  }
  return `<svg class="roadmap" viewBox="0 0 780 350" role="img" aria-label="Emergency route map"><rect x="0" y="0" width="780" height="350" rx="16" class="map-bg"/>${edges}${nodes}${marker}</svg>`;
}

function showRequest(r){
  request=r;
  if(!r) return;
  setText("driverVehicle",`AMBULANCE ${r.vehicleId || "--"}`);
  setText("driverName",`Welcome, ${r.driver || "Driver"}`);
  setText("driverAvailability",r.status === "Completed" ? "Trip completed • Waiting for next dispatch" : "Available • Emergency dispatch active");
  $("waiting").classList.add("hidden"); $("incoming").classList.remove("hidden");
  setText("incomingTime",r.timestamp); setText("driverType",r.type); setText("driverLocation",r.location); setText("driverPeople",r.people); setText("driverDetails",r.text); setText("driverPriority",r.priority);
  $("driverPriority").className="priority "+r.priority.toLowerCase();
  setText("routeFrom",r.vehicleStartName || "Vehicle Base"); setText("routeTo",r.location); setText("routeEta",r.eta+" min");
  $("driverRoute").innerHTML=`<b>To emergency:</b> ${r.route.map((x,i)=>`${i?'<b> ↓ </b>':''}${escapeHtml(x)}`).join("")}<br><br><b>Then to hospital:</b> ${(r.hospitalRoute||[]).map((x,i)=>`${i?'<b> ↓ </b>':''}${escapeHtml(x)}`).join("")}<br><br>🏥 <b>${escapeHtml(r.hospital||"Hospital")}</b> • ${r.hospitalEta||"--"} min`;
  $("routeMap").innerHTML=mapSvg(r.routeIds||[],0);
  setText("mapPosition","Vehicle waiting at "+(r.vehicleStartName||"Vehicle Base"));
  setText("statusBadge","NEW ALERT"); $("statusBadge").className="badge";
  setText("driverLog",`AI dispatcher sent this emergency to ${r.driver} (${r.vehicleId}). Awaiting driver acceptance.`);
  $("acceptBtn").disabled=false; $("acceptBtn").textContent="✓ ACCEPT EMERGENCY";
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
  if(status==="En Route") startMovement();
  else if(status==="To Hospital") startHospitalMovement();
  else stopMovement();

  if(status==="Accepted"){
    request.phase="toEmergency";
    publishUpdate(status,{progress:0,currentNode:request.vehicleStartName});
    setText("driverLog",`Driver ${request.driver} accepted the emergency. The route to ${request.location} is ready.`);
  } else if(status==="Arrived"){
    request.phase="atEmergency";
    publishUpdate(status,{progress:1,currentNode:request.location});
    setText("mapPosition","📍 Ambulance arrived at emergency location");
    $("routeMap").innerHTML=mapSvg(request.routeIds||[],1);
    setText("driverLog",`Ambulance arrived at ${request.location}. Click To Hospital to continue.`);
  } else if(status==="To Hospital"){
    request.phase="toHospital";
    publishUpdate(status,{progress:0,currentNode:request.location});
    setText("driverLog",`Hospital trip started. Driving to ${request.hospital}.`);
  } else if(status==="Hospital Arrived"){
    request.phase="hospitalArrived";
    publishUpdate(status,{progress:1,currentNode:request.hospital});
    setText("mapPosition","🏥 Ambulance arrived at "+request.hospital);
    $("routeMap").innerHTML=mapSvg(request.hospitalRouteIds||[],1);
    setText("driverLog",`Ambulance arrived at ${request.hospital}. You can now complete the emergency.`);
  } else if(status==="Completed"){
    request.phase="completed";
    publishUpdate(status,{progress:1,currentNode:request.hospital});
    setText("mapPosition","✓ Emergency completed at "+request.hospital);
    setText("driverLog",`Emergency completed by ${request.driver}. Hospital: ${request.hospital}. Return information sent to the emergency dashboard.`);
    setText("driverAvailability","Trip completed • Waiting for next dispatch");
  }
  setText("statusBadge",status.toUpperCase()); $("statusBadge").className="badge";
}

function startMovement(){
  stopMovement(); animationStart=performance.now();
  const tick=(now)=>{
    if(!request) return;
    const progress=Math.min(1,(now-animationStart)/ANIMATION_MS);
    const route=request.routeIds||[];
    const segment=Math.min(route.length-1,Math.floor(progress*Math.max(1,route.length-1)));
    const nodeName=mapNodes[route[Math.min(segment,route.length-1)]]?.name || "En route";
    $("routeMap").innerHTML=mapSvg(route,progress);
    setText("mapPosition",progress>=1?"Arrived at "+request.location:`En route • near ${nodeName}`);
    const remaining=Math.max(0,Math.ceil((request.eta||1)*(1-progress))); setText("routeEtaLive",remaining+" min remaining");
    publishUpdate("En Route",{progress,currentNode:progress>=1?request.location:nodeName,phase:"toEmergency"});
    if(progress<1){animationTimer=requestAnimationFrame(tick);}else{stopMovement(); publishUpdate("Arrived",{progress:1,currentNode:request.location,phase:"atEmergency"}); setText("statusBadge","ARRIVED"); $("statusBadge").className="badge"; setText("driverLog","Ambulance reached the emergency location. Click To Hospital.");}
  }; animationTimer=requestAnimationFrame(tick);
}
function startHospitalMovement(){
  stopMovement(); animationStart=performance.now();
  const tick=(now)=>{
    if(!request) return;
    const progress=Math.min(1,(now-animationStart)/ANIMATION_MS);
    const route=request.hospitalRouteIds||[];
    const segment=Math.min(route.length-1,Math.floor(progress*Math.max(1,route.length-1)));
    const nodeName=mapNodes[route[Math.min(segment,route.length-1)]]?.name || "En route to hospital";
    $("routeMap").innerHTML=mapSvg(route,progress);
    setText("mapPosition",progress>=1?"Arrived at "+request.hospital:`En route to hospital • near ${nodeName}`);
    const remaining=Math.max(0,Math.ceil((request.hospitalEta||1)*(1-progress))); setText("routeEtaLive",remaining+" min to hospital");
    publishUpdate("To Hospital",{progress,currentNode:progress>=1?request.hospital:nodeName,phase:"toHospital"});
    if(progress<1){animationTimer=requestAnimationFrame(tick);}else{stopMovement(); publishUpdate("Hospital Arrived",{progress:1,currentNode:request.hospital,phase:"hospitalArrived"}); setText("statusBadge","HOSPITAL ARRIVED"); $("statusBadge").className="badge"; setText("driverLog",`Ambulance arrived at ${request.hospital}. Click Completed.`);}
  }; animationTimer=requestAnimationFrame(tick);
}

function stopMovement(){if(animationTimer){cancelAnimationFrame(animationTimer);animationTimer=null;}}

window.addEventListener("storage",e=>{if(e.key==="emergency_dispatch_request"&&e.newValue){try{showRequest(JSON.parse(e.newValue));}catch{}}});
if("BroadcastChannel" in window){const bc=new BroadcastChannel("emergency_dispatch");bc.onmessage=e=>{if(e.data?.fromDriver) return;showRequest(e.data);};}
try{const saved=localStorage.getItem("emergency_dispatch_request");if(saved)showRequest(JSON.parse(saved));}catch{}

$("acceptBtn").addEventListener("click",()=>{
  updateStatus("Accepted"); $("acceptBtn").disabled=true; $("acceptBtn").textContent="✓ EMERGENCY ACCEPTED";
  setText("driverLog",`Driver ${request.driver} accepted the emergency. The user has been notified. Click En Route to start live demo movement.`);
});
document.querySelectorAll(".status-btn").forEach(btn=>btn.addEventListener("click",()=>updateStatus(btn.dataset.status)));
