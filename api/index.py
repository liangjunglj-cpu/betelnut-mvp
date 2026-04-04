import ee
import asyncio
import math
import random
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google.oauth2 import service_account

# 1. Initialize FastAPI App
app = FastAPI(
    title="3D City Planner - Digital Twin API",
    description="Backend proxy for Google Earth Engine analytical layers",
    version="1.0.0"
)

# Allow CORS so your frontend can communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with your frontend URL (e.g., "http://localhost:3000")
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
try:
    from dotenv import load_dotenv
    load_dotenv(override=True)  # override=True ensures .env values replace stale env vars
except ImportError:
    print("python-dotenv not found, relying on native environment variables.")

# --- CONFIGURATION ---
# Keys are safely loaded from the local .env file or Vercel Environment Variables
SERVICE_ACCOUNT_FILE = 'service-account.json'
URA_ACCESS_KEY = os.environ.get('URA_ACCESS_KEY', '') 
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')
DATAGOV_API_KEY = os.environ.get('DATAGOV_API_KEY', '')

# Helper for data.gov.sg headers
def get_datagov_headers():
    headers = {}
    if DATAGOV_API_KEY:
        headers["api-key"] = DATAGOV_API_KEY
    return headers


# 2. Google Earth Engine Authentication & Initialization
@app.on_event("startup")
def startup_event():
    """Initialize Google Earth Engine on application startup."""
    try:
        # Load credentials from the service account JSON
        credentials = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE)
        # Apply the required Earth Engine scope
        scoped_credentials = credentials.with_scopes(['https://www.googleapis.com/auth/earthengine'])
        
        # Initialize the Earth Engine Python API
        ee.Initialize(scoped_credentials)
        print("Successfully initialized Google Earth Engine.")
    except Exception as e:
        print(f"Error initializing Google Earth Engine: {e}")
        # In a real app, you might want to stop startup if GEE fails to initialize


# --- DATA.GOV.SG POLLING HELPER ---
async def poll_datagov_download(dataset_id, max_retries=5, delay=2.0):
    """
    Handles the asynchronous polling for Data.gov.sg poll-download API.
    dataset_id: The ID of the dataset (e.g. 'd_8c8162ffb9deb8d11b00623048f65a70')
    """
    url = f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download"
    
    for i in range(max_retries):
        try:
            res = requests.get(url, headers=get_datagov_headers(), timeout=30)
            
            # 201 means export is still being prepared
            if res.status_code == 201:
                print(f"Data.gov.sg Export Pending for {dataset_id} (Attempt {i+1}/{max_retries}), retrying...")
                await asyncio.sleep(delay)
                continue

            res.raise_for_status()
            data = res.json()
            
            if data.get('code') == 0 and 'data' in data and 'url' in data['data']:
                download_url = data['data']['url']
                dl_res = requests.get(download_url, timeout=45)
                dl_res.raise_for_status()
                return dl_res.json()
            
            # If we get a 200 but no URL yet, wait and retry
            await asyncio.sleep(delay)
        except Exception as e:
            if i == max_retries - 1:
                raise e
            await asyncio.sleep(delay)
            
    raise Exception(f"Data.gov.sg Export timed out for {dataset_id}")


# --- URA API INTEGRATION ---
def get_ura_token():
    """Fetches the temporary token from URA Data Service."""
    url = "https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1"
    headers = {"AccessKey": URA_ACCESS_KEY}
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        if data.get("Status") == "Success":
            return data.get("Result")
    raise Exception("Failed to get URA Token")

@app.get("/api/ura/conservation-data")
async def get_conservation_data():
    """
    Fetches Conservation Data. 
    (Note: For the MVP, we are routing to the openly available URA GeoJSON from Data.gov.sg 
    because it returns the actual 2D polygon geometry needed for the map overlay).
    """
    try:
        dataset_id = "d_8c8162ffb9deb8d11b00623048f65a70" # URA Conservation Area GEOJSON
        data = await poll_datagov_download(dataset_id)
        return {"status": "success", "data": data}
    except Exception as e:
        print(f"URA Proxy Error: {e}")
        return {"status": "error", "code": "SERVER_ERROR", "message": str(e)}


@app.get("/api/datagov/historic-sites")
async def get_historic_sites():
    """
    Fetches NHB Historic Sites GeoJSON from data.gov.sg.
    """
    try:
        dataset_id = "d_31e16b12809e66673e90d8b04fdee1b2"  # Historic Sites (GEOJSON)
        data = await poll_datagov_download(dataset_id)
        return {"status": "success", "data": data}
    except Exception as e:
        print(f"Historic Sites Proxy Error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/datagov/tourist-attractions")
async def get_tourist_attractions():
    """
    Fetches Tourist Attractions GeoJSON from data.gov.sg.
    """
    try:
        dataset_id = "d_0f2f47515425404e6c9d2a040dd87354"
        data = await poll_datagov_download(dataset_id)
        return {"status": "success", "data": data}
    except Exception as e:
        print(f"Tourist Attractions Proxy Error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/datagov/parks")
async def get_parks():
    """
    Fetches Parks GeoJSON from data.gov.sg.
    """
    try:
        dataset_id = "d_0542d48f0991541706b58059381a6eca"
        data = await poll_datagov_download(dataset_id)
        return {"status": "success", "data": data}
    except Exception as e:
        print(f"Parks Proxy Error: {e}")
        return {"status": "error", "message": str(e)}


# --- Dynamic Traffic Simulation ---
# Caches Overpass results by rounded bounding box to avoid redundant requests
_traffic_cache = {}

_osm_polygon_cache = {}

class OsmPolygonRequest(BaseModel):
    south: float
    west: float
    north: float
    east: float
    layers: list[str]

@app.post("/api/osm/polygons")
async def get_osm_polygons(request: OsmPolygonRequest):
    """
    Fetches exact footprint Polygons for Parks and Tourist Attractions via Overpass API.
    Replaces the single-point Datagov datasets with actual geometric boundaries.
    """
    bbox = f"{request.south},{request.west},{request.north},{request.east}"
    cache_key = (round(request.south, 3), round(request.west, 3), round(request.north, 3), round(request.east, 3), tuple(sorted(request.layers)))

    if cache_key in _osm_polygon_cache:
        return _osm_polygon_cache[cache_key]

    try:
        # Build query based on requested layers
        query_elements = []
        if "parks" in request.layers:
            query_elements.append(f'way["leisure"="park"]({bbox});')
            query_elements.append(f'way["leisure"="nature_reserve"]({bbox});')
            query_elements.append(f'way["boundary"="national_park"]({bbox});')
        if "attractions" in request.layers:
            query_elements.append(f'way["tourism"~"attraction|museum|theme_park"]({bbox});')
            query_elements.append(f'way["historic"~"monument|memorial|ruins"]({bbox});')

        if not query_elements:
            return {"type": "FeatureCollection", "features": []}

        query_body = "\n".join(query_elements)
        query = f"""
        [out:json][timeout:25];
        (
          {query_body}
        );
        out body;
        >;
        out skel qt;
        """

        res = requests.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=35)
        
        if res.status_code == 504:
             return {"status": "error", "code": "TIMEOUT", "message": "Overpass API Timeout"}
        
        res.raise_for_status()
        osm_data = res.json()

        nodes = {el["id"]: [el["lon"], el["lat"]] for el in osm_data.get("elements", []) if el["type"] == "node"}
        
        features = []
        for el in osm_data.get("elements", []):
            if el["type"] == "way" and "tags" in el:
                coords = [nodes[ref] for ref in el.get("nodes", []) if ref in nodes]
                if len(coords) > 2:
                    # Close the polygon
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])
                    
                    tags = el["tags"]
                    poly_type = "park" if "leisure" in tags or "boundary" in tags else "tourist-attraction"
                    
                    features.append({
                        "type": "Feature",
                        "properties": {
                            "NAME": tags.get("name", "Unnamed " + poly_type.title().replace("-", " ")),
                            "_type": poly_type
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [coords]
                        }
                    })

        geojson = {
            "type": "FeatureCollection",
            "features": features
        }
        _osm_polygon_cache[cache_key] = geojson
        return geojson

    except Exception as e:
        print(f"OSM Polygon Error: {e}")
        return {"type": "FeatureCollection", "features": []}


class TrafficRequest(BaseModel):
    south: float
    west: float
    north: float
    east: float

def _haversine_deg(lon1, lat1, lon2, lat2):
    """Returns approximate distance in degrees (rough, for weighting only)."""
    return math.sqrt((lon2 - lon1)**2 + (lat2 - lat1)**2)

def _generate_trips(path_network, count, speed_multiplier, poi_points=None):
    """
    Generate simulated trip animations along road/path segments.
    If poi_points are provided, paths near POIs get more trips (attraction weighting).
    """
    if not path_network:
        return []

    # Weight paths by proximity to POIs (tourist attractions, parks, monuments)
    weights = []
    for path in path_network:
        if not path or len(path) < 2:
            weights.append(0.1)
            continue
        midpoint = path[len(path) // 2]
        w = 1.0
        if poi_points:
            for poi in poi_points:
                dist = _haversine_deg(midpoint[0], midpoint[1], poi[0], poi[1])
                if dist < 0.005:    # ~500m radius
                    w += 3.0
                elif dist < 0.01:   # ~1km radius
                    w += 1.5
                elif dist < 0.02:   # ~2km radius
                    w += 0.5
        weights.append(w)

    total_weight = sum(weights)
    if total_weight == 0:
        return []

    trips = []
    for _ in range(count):
        # Weighted random path selection
        r = random.uniform(0, total_weight)
        cumulative = 0
        chosen_idx = 0
        for i, w in enumerate(weights):
            cumulative += w
            if r <= cumulative:
                chosen_idx = i
                break

        path = path_network[chosen_idx]
        if len(path) < 2:
            continue

        # Optionally reverse direction
        if random.random() > 0.5:
            path = list(reversed(path))

        timestamps = []
        current_time = random.uniform(0, 1000)

        for i in range(len(path)):
            if i == 0:
                timestamps.append(current_time)
            else:
                lon1, lat1 = path[i - 1]
                lon2, lat2 = path[i]
                dist = math.sqrt((lon2 - lon1)**2 + (lat2 - lat1)**2)
                time_taken = dist * 1000000 / speed_multiplier
                current_time += max(20, time_taken)
                timestamps.append(current_time)

        trips.append({"path": path, "timestamps": timestamps})

    return trips


@app.post("/api/traffic/simulate")
async def simulate_traffic(request: TrafficRequest):
    """
    Generates dynamic traffic simulation for the given viewport bounds.
    1. Fetches road/footpath geometry from Overpass API (OSM)
    2. Fetches POI locations (attractions, parks) from data.gov.sg cache
    3. Generates attraction-weighted trip simulations
    """
    # Round bounds to 3 decimal places for cache key (~110m resolution)
    cache_key = (
        round(request.south, 3), round(request.west, 3),
        round(request.north, 3), round(request.east, 3)
    )

    if cache_key in _traffic_cache:
        return _traffic_cache[cache_key]

    try:
        bbox = f"{request.south},{request.west},{request.north},{request.east}"

        # Fetch road + footpath geometry from Overpass (OSM)
        query = f"""
        [out:json][timeout:25];
        (
          way["highway"~"primary|secondary|tertiary|residential"]({bbox});
          way["highway"~"footway|pedestrian|path|cycleway"]({bbox});
        );
        out body;
        >;
        out skel qt;
        """

        overpass_res = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
            timeout=30
        )
        overpass_res.raise_for_status()
        osm_data = overpass_res.json()

        # Parse nodes
        nodes = {}
        for el in osm_data.get("elements", []):
            if el["type"] == "node":
                nodes[el["id"]] = [el["lon"], el["lat"]]

        # Parse ways into vehicle/foot path segments
        vehicle_paths = []
        foot_paths = []
        for el in osm_data.get("elements", []):
            if el["type"] != "way" or "tags" not in el:
                continue
            highway = el["tags"].get("highway", "")
            coords = [nodes[ref] for ref in el.get("nodes", []) if ref in nodes]
            if len(coords) < 2:
                continue
            if highway in ("primary", "secondary", "tertiary", "residential"):
                vehicle_paths.append(coords)
            elif highway in ("footway", "pedestrian", "path", "cycleway"):
                foot_paths.append(coords)

        # Collect POI points for weighting (simple: use viewport center area)
        # In production this would query cached POI data; for now we pass empty
        # and the weighting gracefully falls back to uniform distribution
        poi_points = []

        # Generate trips (scale count with road network density, cap at reasonable limits)
        vehicle_count = min(max(len(vehicle_paths) * 2, 30), 150)
        foot_count = min(max(len(foot_paths) * 3, 50), 250)

        vehicle_trips = _generate_trips(vehicle_paths, vehicle_count, 2.0, poi_points)
        foot_trips = _generate_trips(foot_paths, foot_count, 0.5, poi_points)

        result = {
            "vehicles": vehicle_trips,
            "foot": foot_trips,
            "_meta": {
                "vehicle_roads": len(vehicle_paths),
                "foot_paths": len(foot_paths),
                "bbox": bbox,
            }
        }

        # Cache the result
        _traffic_cache[cache_key] = result

        return result

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Overpass API timed out. Try a smaller viewport.")
    except Exception as e:
        print(f"Traffic Simulation Error: {e}")
        raise HTTPException(status_code=500, detail=f"Traffic Simulation Error: {str(e)}")


@app.get("/api/weather/forecast-2h")
async def get_weather_forecast_2h():
    """
    Proxies the data.gov.sg 2-hour weather forecast real-time API.
    Returns area-level forecasts with coordinates for map matching.
    """
    try:
        res = requests.get("https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast", headers=get_datagov_headers())
        res.raise_for_status()
        return res.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weather API Error: {str(e)}")


# 3. GEE Layer Endpoint
@app.get("/api/gee-layer/vegetation")
async def get_vegetation_layer():
    """
    Generates a GEE tile URL for a recent MODIS NDVI (Vegetation) image.
    Returns the XYZ tile format for the frontend to render.
    """
    try:
        # Load the MODIS 16-day NDVI collection
        dataset = ee.ImageCollection('MODIS/061/MOD13A2') \
            .filterDate('2023-01-01', '2023-12-31') # Filtering to a recent year
        
        # Select the NDVI band and create a median composite for a clean image
        ndvi = dataset.select('NDVI').median()

        # Define Visualization Parameters
        # MODIS NDVI values range from -2000 to 10000, but most vegetation is in the 0-9000 range.
        vis_params = {
            'min': 0.0,
            'max': 9000.0,
            'palette': ['red', 'yellow', 'green'] # Simple red to green palette
        }

        # Generate the Map ID and Tile Fetcher URL
        # getMapId evaluates the image and visualization params to generate temporary XYZ tiles
        map_id_dict = ee.Image(ndvi).getMapId(vis_params)
        
        # Extract the XYZ tile URL template provided by GEE
        tile_fetch_url = map_id_dict['tile_fetcher'].url_format

        return {
            "status": "success",
            "layer_name": "Vegetation (MODIS NDVI)",
            "tile_fetch_url": tile_fetch_url
        }

    except Exception as e:
        # Catch and return any GEE processing errors securely
        raise HTTPException(status_code=500, detail=f"Failed to generate GEE layer: {str(e)}")


# --- LLM Chat Endpoint ---
class ChatRequest(BaseModel):
    message: str
    context: str = ""

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    if OPENROUTER_API_KEY == 'YOUR_OPENROUTER_API_KEY_HERE' or not OPENROUTER_API_KEY:
        raise HTTPException(status_code=401, detail="OpenRouter API Key not configured in backend.")
        
    system_prompt = (
        "You are Betelnut, a Map-First Conservation Copilot for Singapore urban planning.\n\n"
        "When a site is selected, structure your response with these sections using markdown:\n\n"
        "## Conservation Assessment\n"
        "- **Heritage Status:** Identify the conservation designation (URA Conservation Area, National Monument, Historic Site, etc.) and what protections apply.\n"
        "- **Regulatory Framework:** Cite relevant URA guidelines, Planning Act provisions, or NHB requirements that govern this site.\n"
        "- **Design Controls:** Specify height limits, facade retention requirements, material restrictions, setback rules, or any gazetted constraints.\n"
        "- **Approval Pathway:** Outline the approval process — which authorities (URA, NHB, NParks, LTA) must review, and what documentation is required.\n\n"
        "## Physical & Environmental Implications\n"
        "- **Structural Considerations:** Assess ground conditions, adjacent building proximity, foundation constraints, or load-bearing heritage fabric.\n"
        "- **Environmental Context:** Note vegetation, drainage, microclimate, or ecological factors from the surrounding landscape (parks, tree canopy, waterways).\n"
        "- **Traffic & Access:** Evaluate pedestrian footfall, vehicular access constraints, service vehicle routing, and any conflicts with conservation boundaries.\n"
        "- **Risk Factors:** Highlight flooding risk, vibration sensitivity of heritage structures, noise impact, or construction staging challenges.\n\n"
        "Keep each bullet concise (1-2 sentences). Use the spatial analysis context provided to ground your assessment in what the user is actually seeing on the map. "
        "Be specific to Singapore planning regulations."
    )
    full_prompt = f"---\nSPATIAL ANALYSIS CONTEXT:\n{request.context}\n---\n\nUSER QUERY:\n{request.message}"

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "google/gemini-2.5-pro",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": full_prompt}
                ]
            }
        )
        response.raise_for_status()
        data = response.json()
        return {"status": "success", "reply": data['choices'][0]['message']['content']}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM API Error: {str(e)}")


# --- AI Render Endpoint (Gemini Nano Banana 2 via OpenRouter) ---
# Uses the same OPENROUTER_API_KEY as the chat endpoint — no extra key needed.

class RenderRequest(BaseModel):
    image_base64: str
    prompt: str

@app.post("/api/generate-render")
async def generate_render(request: RenderRequest):
    """
    Takes a base64 screenshot of the map viewport + a text prompt,
    sends it to Gemini Nano Banana 2 (gemini-3.1-flash-image-preview)
    via OpenRouter for photorealistic architectural visualization.
    """
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=401,
            detail="OPENROUTER_API_KEY not configured in .env"
        )

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "google/gemini-3.1-flash-image-preview",
                "modalities": ["text", "image"],
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{request.image_base64}"
                                }
                            },
                            {
                                "type": "text",
                                "text": request.prompt
                            }
                        ]
                    }
                ]
            }
        )
        response.raise_for_status()
        data = response.json()

        # Extract the response — check for image content in the reply
        if data.get("choices") and data["choices"][0].get("message"):
            message = data["choices"][0]["message"]
            content = message.get("content", "")

            # OpenRouter may return image as base64 in content parts
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "image_url":
                        img_url = part.get("image_url", {}).get("url", "")
                        if img_url.startswith("data:image"):
                            # Extract base64 from data URL
                            b64_data = img_url.split(",", 1)[1] if "," in img_url else img_url
                            return {
                                "status": "success",
                                "rendered_image_base64": b64_data,
                            }
            
            # If content is a string, it might be a text-only response
            if isinstance(content, str) and content:
                raise HTTPException(
                    status_code=500,
                    detail=f"Model returned text instead of image: {content[:200]}"
                )

        raise HTTPException(
            status_code=500,
            detail="No image returned from Nano Banana 2"
        )

    except requests.exceptions.HTTPError as e:
        error_body = e.response.text if e.response else str(e)
        raise HTTPException(status_code=500, detail=f"OpenRouter API Error: {error_body}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Render Error: {str(e)}")
