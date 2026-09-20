# Emergency Vehicle Route Optimizer — Fixed AI Dispatch Demo

## What is fixed
- Emergency location comes from the caller's entered address/message.
- Town Hall, Gandhipuram, RS Puram, Ukkadam, Saibaba Colony and Race Course are mapped separately.
- The nearest available ambulance is selected using shortest travel time on the graph.
- Driver dashboard is no longer locked to A03; it displays whichever ambulance the dispatcher selected.
- Driver status updates are sent back to the Emergency Dashboard.
- The Emergency Dashboard restores the active emergency when you return from the Driver Dashboard instead of showing a blank fresh page.
- Completed status is stored and displayed to the caller.
- Dijkstra route is shown on the roadmap and the ambulance marker moves along that route during En Route.

## Run
1. Extract the ZIP.
2. Open the extracted folder in VS Code.
3. Open `index.html` with Live Server.
4. Click `Open Driver Dashboard` to open `driver.html` in another tab.
5. Enter a location such as `Town Hall, Coimbatore` and send the emergency.
6. On the driver tab, accept the emergency.
7. Click `En Route`, then `Arrived`, then `Completed`.
8. Return to the Emergency Dashboard. The same emergency remains visible and the driver's latest status is shown.

## Important
This is an academic prototype. The road network and vehicle locations are simulated. The browser AI is a pretrained model when it is available; a local extraction fallback keeps the demo working if the model cannot load. It is not connected to a real emergency service or live GPS.


## Hospital routing update
The system now selects the nearest demo hospital from the emergency location using Dijkstra, then provides a second shortest route from the emergency location to that hospital. The driver flow is: Accept → Go to Emergency → Arrived at Emergency → Go to Hospital → Arrived at Hospital → Completed. Hospital names and road coordinates are demo data for the academic prototype.
