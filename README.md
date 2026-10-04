# Emergency Vehicle Route Optimizer — Fixed AI Dispatch Demo

## What is fixed
- Emergency location comes from the caller's entered address/message.
- Town Hall, Gandhipuram, RS Puram, Ukkadam, Saibaba Colony and Race Course are mapped separately.
- The nearest available ambulance is selected using shortest travel time on the graph.
- Driver dashboard is no longer locked to A03; it displays whichever ambulance the dispatcher selected.
- Driver status updates are sent back to the Emergency Dashboard.
- The Emergency Dashboard restores the active emergency when you return from the Driver Dashboard instead of showing a blank fresh page.
- Completed status is stored and displayed to the caller.
- OpenStreetMap is used on both dashboards to show the selected vehicle, incident, hospital, and simulated route.
- OpenStreetMap tiles are used on both dashboards to show the simulated vehicle, emergency, hospital, and route locations.

## Run
1. Extract the ZIP.
2. Open the extracted folder in VS Code.
3. Open `index.html` with Live Server.
4. Use **Open** in the header to switch between Caller view, Driver view, and Help. No login is required.
5. Enter a location such as `Town Hall, Coimbatore` and send the emergency.
6. On the Ambulance profile, accept the emergency and use the single **Next step** button to start each trip.
7. Arrival is simulated automatically; complete the trip after the ambulance reaches the hospital.
8. Switch back to Patient / User. The same emergency and the driver's latest status are shown.

## Important
This is an academic prototype. OpenStreetMap provides the map background; demo locations, routes, vehicle positions, and movement are simulated and are not live GPS or turn-by-turn road directions. Internet access is required to load Leaflet and OpenStreetMap tiles. The browser AI is a pretrained model when it is available; a local extraction fallback keeps the demo working if the model cannot load. It is not connected to a real emergency service.


## Hospital routing update
The system now selects the nearest demo hospital from the emergency location using Dijkstra, then provides a second shortest route from the emergency location to that hospital. The driver flow is: Accept → Go to Emergency → Arrived at Emergency → Go to Hospital → Arrived at Hospital → Completed. Hospital names and road coordinates are demo data for the academic prototype.
