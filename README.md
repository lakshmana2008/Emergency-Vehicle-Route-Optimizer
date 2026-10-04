# Emergency Vehicle Route Optimizer

## Map and route integration
- Enter a street, landmark, town, or city and the app looks it up with OpenStreetMap Nominatim.
- Three simulated ambulance locations are placed near each incident and compared using OSRM road-driving times; the closest reachable route is selected. These locations are not real ambulances or live GPS.
- Nearby hospitals are discovered from OpenStreetMap (with Nominatim fallback if Overpass is unavailable) and ranked by OSRM driving time. Both routes are shown on OSM maps.
- The driver dashboard accepts the emergency and simulates progress along the returned road geometry.
- Driver status updates are shared with the caller dashboard, and the active request is restored when the page is reopened.

## Run
1. Extract the ZIP.
2. Open the extracted folder in VS Code.
3. Open `index.html` with Live Server. Internet access is required for map tiles and routing lookups.
4. Use **Open** in the header to switch between Caller view, Driver view, and Help. No login is required.
5. Enter the emergency details and a full location, for example `Thanjavur, Tamil Nadu`, then send the emergency.
6. In Driver view, accept the emergency and use the single **Next step** button for each trip.
7. Arrival is simulated automatically; complete the trip after the ambulance reaches the hospital.
8. Switch back to Patient / User. The same emergency and the driver's latest status are shown.

## Important
OpenStreetMap map data and OSRM road-driving routes are fetched from public services and may be unavailable or rate-limited. Their drive times do not include live traffic or emergency-vehicle rules. Ambulance locations and availability are simulated near each entered incident; the demo has no real ambulance locations, dispatch availability, or live GPS. The animated vehicle is simulated. This academic prototype is not connected to emergency services.
