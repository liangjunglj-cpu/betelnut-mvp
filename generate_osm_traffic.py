import requests
import json
import random
import math

# Orchard Road bounding box
# BBox: South Lat, West Lng, North Lat, East Lng
bbox = "1.297,103.830,1.305,103.844"

# Overpass QL query to grab highways (roads) and footways
query = f"""
[out:json][timeout:25];
(
  way["highway"~"primary|secondary|tertiary|residential"]({bbox});
  way["highway"~"footway|pedestrian|path"]({bbox});
);
out body;
>;
out skel qt;
"""

print("Fetching OSM Data from Overpass...")
res = requests.post("https://overpass-api.de/api/interpreter", data={"data": query})
data = res.json()

# Parse nodes
nodes = {}
for element in data['elements']:
    if element['type'] == 'node':
        nodes[element['id']] = [element['lon'], element['lat']]

# Parse ways into segments
vehicle_paths = []
foot_paths = []

for element in data['elements']:
    if element['type'] == 'way':
        if 'tags' not in element: continue
        highway = element['tags'].get('highway', '')
        
        # Build coordinates array for the way
        coords = []
        for ref in element['nodes']:
            if ref in nodes:
                coords.append(nodes[ref])
                
        if len(coords) < 2: continue
        
        if highway in ["primary", "secondary", "tertiary", "residential"]:
            vehicle_paths.append(coords)
        elif highway in ["footway", "pedestrian", "path"]:
            foot_paths.append(coords)
            
print(f"Parsed {len(vehicle_paths)} road segments and {len(foot_paths)} footway segments.")

# Generate Trips from the paths
def generate_trips(path_network, count, speed_multiplier):
    trips = []
    # Pick random paths and simulate an entity moving along it
    for _ in range(count):
        if not path_network:
            break
        path = random.choice(path_network)
        
        # Optionally reverse direction
        if random.random() > 0.5:
            path = list(reversed(path))
            
        timestamps = []
        current_time = random.uniform(0, 1000)
        
        for i in range(len(path)):
            if i == 0:
                timestamps.append(current_time)
            else:
                # Calculate distance to infer time
                lon1, lat1 = path[i-1]
                lon2, lat2 = path[i]
                # rough distance in degrees
                dist = math.sqrt((lon2 - lon1)**2 + (lat2 - lat1)**2)
                # arbitrary time addition based on dist and speed
                time_taken = dist * 1000000 / speed_multiplier
                current_time += max(20, time_taken)
                timestamps.append(current_time)
                
        trips.append({
            "path": path,
            "timestamps": timestamps
        })
    return trips

print("Simulating trips...")
# generate 100 vehicles (fast) and 200 pedestrians (slower)
vehicle_trips = generate_trips(vehicle_paths, 100, speed_multiplier=2.0)
foot_trips = generate_trips(foot_paths, 200, speed_multiplier=0.5)

output = {
    "vehicles": vehicle_trips,
    "foot": foot_trips
}

out_path = "client/public/traffic_data.json"
with open(out_path, 'w') as f:
    json.dump(output, f)

print(f"Successfully generated realistic traffic patterns! Saved to {out_path}")
