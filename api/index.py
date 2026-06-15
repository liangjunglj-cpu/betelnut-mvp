import asyncio
import math
import random
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 1. Initialize FastAPI App
app = FastAPI(
    title="3D City Planner - Digital Twin API",
    description="Backend proxy for Betelnut geospatial and AI services",
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
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')
DATAGOV_API_KEY = os.environ.get('DATAGOV_API_KEY', '')

# Helper for data.gov.sg headers
def get_datagov_headers():
    headers = {}
    if DATAGOV_API_KEY:
        headers["api-key"] = DATAGOV_API_KEY
    return headers


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

# --- Dynamic Traffic Simulation ---
# Caches Overpass results by rounded bounding box to avoid redundant requests
_traffic_cache = {}


class TrafficRequest(BaseModel):
    south: float
    west: float
    north: float
    east: float


def _clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def _build_interpolated_path(start, end, segments, jitter_lon=0.0, jitter_lat=0.0, bounds=None):
    path = []
    west = south = east = north = None
    if bounds:
        west, south, east, north = bounds

    for i in range(segments + 1):
        t = i / segments
        lon = start[0] + (end[0] - start[0]) * t
        lat = start[1] + (end[1] - start[1]) * t

        if 0 < i < segments:
            lon += random.uniform(-jitter_lon, jitter_lon)
            lat += random.uniform(-jitter_lat, jitter_lat)

        if bounds:
            lon = _clamp(lon, west, east)
            lat = _clamp(lat, south, north)

        path.append([lon, lat])

    return path


def _build_synthetic_network(south, west, north, east):
    lon_span = max(east - west, 0.002)
    lat_span = max(north - south, 0.002)
    center_lon = (west + east) / 2
    center_lat = (south + north) / 2
    bounds = (west, south, east, north)
    margin_lon = lon_span * 0.08
    margin_lat = lat_span * 0.08
    jitter_lon = lon_span * 0.025
    jitter_lat = lat_span * 0.025

    def point(x_ratio, y_ratio):
        return [
            west + margin_lon + (lon_span - margin_lon * 2) * x_ratio,
            south + margin_lat + (lat_span - margin_lat * 2) * y_ratio,
        ]

    vehicle_paths = []
    for row_ratio in (0.22, 0.5, 0.78):
        vehicle_paths.append(
            _build_interpolated_path(point(0.0, row_ratio), point(1.0, row_ratio), 5, jitter_lon, jitter_lat, bounds)
        )
    for col_ratio in (0.26, 0.5, 0.74):
        vehicle_paths.append(
            _build_interpolated_path(point(col_ratio, 0.0), point(col_ratio, 1.0), 5, jitter_lon, jitter_lat, bounds)
        )
    vehicle_paths.append(
        _build_interpolated_path(point(0.08, 0.18), point(0.92, 0.82), 6, jitter_lon * 0.7, jitter_lat * 0.7, bounds)
    )
    vehicle_paths.append(
        _build_interpolated_path(point(0.1, 0.82), point(0.9, 0.18), 6, jitter_lon * 0.7, jitter_lat * 0.7, bounds)
    )

    foot_paths = []
    for row_ratio in (0.14, 0.32, 0.5, 0.68, 0.86):
        foot_paths.append(
            _build_interpolated_path(point(0.04, row_ratio), point(0.96, row_ratio), 7, jitter_lon * 1.2, jitter_lat * 1.2, bounds)
        )
    for col_ratio in (0.15, 0.35, 0.5, 0.65, 0.85):
        foot_paths.append(
            _build_interpolated_path(point(col_ratio, 0.04), point(col_ratio, 0.96), 7, jitter_lon * 1.2, jitter_lat * 1.2, bounds)
        )
    foot_paths.append(
        _build_interpolated_path(point(0.12, 0.18), point(0.88, 0.82), 8, jitter_lon, jitter_lat, bounds)
    )
    foot_paths.append(
        _build_interpolated_path(point(0.12, 0.82), point(0.88, 0.18), 8, jitter_lon, jitter_lat, bounds)
    )
    foot_paths.append([
        [center_lon - lon_span * 0.16, center_lat - lat_span * 0.12],
        [center_lon - lon_span * 0.05, center_lat - lat_span * 0.02],
        [center_lon + lon_span * 0.08, center_lat + lat_span * 0.04],
        [center_lon + lon_span * 0.18, center_lat + lat_span * 0.16],
    ])
    foot_paths.append([
        [center_lon - lon_span * 0.2, center_lat + lat_span * 0.14],
        [center_lon - lon_span * 0.07, center_lat + lat_span * 0.05],
        [center_lon + lon_span * 0.05, center_lat - lat_span * 0.03],
        [center_lon + lon_span * 0.16, center_lat - lat_span * 0.14],
    ])

    return vehicle_paths, foot_paths


def _build_fallback_traffic_result(request: TrafficRequest, reason: str):
    vehicle_paths, foot_paths = _build_synthetic_network(request.south, request.west, request.north, request.east)
    bbox = f"{request.south},{request.west},{request.north},{request.east}"

    return {
        "vehicles": _generate_trips(vehicle_paths, 60, 2.0),
        "foot": _generate_trips(foot_paths, 110, 0.5),
        "_meta": {
            "vehicle_roads": len(vehicle_paths),
            "foot_paths": len(foot_paths),
            "bbox": bbox,
            "source": "synthetic-fallback",
            "reason": reason,
        }
    }

def _haversine_deg(lon1, lat1, lon2, lat2):
    """Returns approximate distance in degrees (rough, for weighting only)."""
    return math.sqrt((lon2 - lon1)**2 + (lat2 - lat1)**2)

def _generate_trips(path_network, count, speed_multiplier, poi_points=None):
    """
    Generate simulated trip animations along road/path segments.
    If poi_points are provided, paths near POIs get more trips.
    """
    if not path_network:
        return []

    # Weight paths by proximity to POIs when any are supplied.
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
    2. Synthesizes trip paths for deck.gl TripsLayer rendering
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

        if not vehicle_paths and not foot_paths:
            result = _build_fallback_traffic_result(request, "no-osm-paths")
            _traffic_cache[cache_key] = result
            return result

        if len(vehicle_paths) < 4 or len(foot_paths) < 6:
            synthetic_vehicle_paths, synthetic_foot_paths = _build_synthetic_network(
                request.south, request.west, request.north, request.east
            )
            if len(vehicle_paths) < 4:
                vehicle_paths.extend(synthetic_vehicle_paths[:4 - len(vehicle_paths)])
            if len(foot_paths) < 6:
                foot_paths.extend(synthetic_foot_paths[:6 - len(foot_paths)])

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
                "source": "osm",
            }
        }

        # Cache the result
        _traffic_cache[cache_key] = result

        return result

    except Exception as e:
        print(f"Traffic Simulation Error: {e}")
        fallback = _build_fallback_traffic_result(request, type(e).__name__)
        _traffic_cache[cache_key] = fallback
        return fallback


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
