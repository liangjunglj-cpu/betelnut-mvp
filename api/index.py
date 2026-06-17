import asyncio
import gzip
import json
import math
import random
import requests
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError

try:
    from .synthesis_engine import SUPPORTED_OPERATIONS, qgis_template, run_synthesis
    from .synthesis_theme import theme_payload
except ImportError:
    from synthesis_engine import SUPPORTED_OPERATIONS, qgis_template, run_synthesis
    from synthesis_theme import theme_payload

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
_OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


class TrafficRequest(BaseModel):
    south: float
    west: float
    north: float
    east: float


def _clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def _normalize_axis_degrees(angle):
    angle = angle % 180.0
    return angle + 180.0 if angle < 0 else angle


def _segment_axis_degrees(start, end):
    return _normalize_axis_degrees(math.degrees(math.atan2(end[1] - start[1], end[0] - start[0])))


def _segment_length(start, end):
    return math.sqrt((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2)


def _select_dominant_axes(path_network, fallback_axes):
    axis_weights = {}

    for path in path_network:
        for start, end in zip(path, path[1:]):
            length = _segment_length(start, end)
            if length <= 0:
                continue
            axis = _segment_axis_degrees(start, end)
            bucket = round(axis / 10.0) * 10.0
            bucket = _normalize_axis_degrees(bucket)
            axis_weights[bucket] = axis_weights.get(bucket, 0.0) + length

    if not axis_weights:
        return list(fallback_axes)

    sorted_axes = sorted(axis_weights.items(), key=lambda item: item[1], reverse=True)
    selected = []
    for axis, _ in sorted_axes:
        if all(abs(axis - chosen) > 20 and abs(axis - chosen) < 160 for chosen in selected):
            selected.append(axis)
        if len(selected) == len(fallback_axes):
            break

    for axis in fallback_axes:
        if len(selected) == len(fallback_axes):
            break
        if axis not in selected:
            selected.append(axis)

    return selected


def _split_path_by_direction(path, max_points_per_segment=8, angle_threshold=30):
    if len(path) < 2:
        return []

    segments = []
    current = [path[0], path[1]]
    previous_axis = _segment_axis_degrees(path[0], path[1])

    for point in path[2:]:
        current_axis = _segment_axis_degrees(current[-1], point)
        axis_delta = abs(current_axis - previous_axis)
        axis_delta = min(axis_delta, 180 - axis_delta)

        if axis_delta > angle_threshold or len(current) >= max_points_per_segment:
            if len(current) >= 2:
                segments.append(current)
            current = [current[-1], point]
            previous_axis = current_axis
        else:
            current.append(point)
            previous_axis = current_axis

    if len(current) >= 2:
        segments.append(current)

    return segments


def _path_total_length(path):
    return sum(_segment_length(start, end) for start, end in zip(path, path[1:]))


def _normalize_path_network(path_network, dominant_axes, min_length=0.00025):
    normalized = []
    for path in path_network:
        for segment in _split_path_by_direction(path):
            length = _path_total_length(segment)
            if length < min_length:
                continue

            axis = _segment_axis_degrees(segment[0], segment[-1])
            if dominant_axes:
                deltas = []
                for dominant in dominant_axes[:2]:
                    axis_delta = abs(axis - dominant)
                    deltas.append(min(axis_delta, 180 - axis_delta))
                if deltas and min(deltas) > 25:
                    continue

            normalized.append(segment)

    return normalized


def _sample_real_path_network(path_network, target_count):
    if not path_network:
        return []

    weighted = [(path, _path_total_length(path)) for path in path_network]
    total_weight = sum(weight for _, weight in weighted)
    if total_weight <= 0:
        return path_network[:target_count]

    sampled = list(path_network)
    while len(sampled) < target_count:
        r = random.uniform(0, total_weight)
        cumulative = 0.0
        chosen = weighted[-1][0]
        for path, weight in weighted:
            cumulative += weight
            if r <= cumulative:
                chosen = path
                break
        sampled.append(chosen)

    return sampled


def _build_empty_traffic_result(request: TrafficRequest, reason: str):
    bbox = f"{request.south},{request.west},{request.north},{request.east}"

    return {
        "vehicles": [],
        "foot": [],
        "_meta": {
            "vehicle_roads": 0,
            "foot_paths": 0,
            "bbox": bbox,
            "source": "empty-fallback",
            "reason": reason,
        }
    }


def _fetch_overpass_json(query):
    last_error = None
    headers = {
        "User-Agent": "Betelnut/1.0 (traffic-simulation)",
        "Accept": "application/json",
    }

    for endpoint in _OVERPASS_ENDPOINTS:
        try:
            response = requests.post(
                endpoint,
                data={"data": query},
                headers=headers,
                timeout=20,
            )
            response.raise_for_status()
            return response.json(), endpoint
        except Exception as exc:
            last_error = exc

    raise last_error or RuntimeError("No Overpass endpoint available")

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

        osm_data, overpass_endpoint = _fetch_overpass_json(query)

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
            result = _build_empty_traffic_result(request, "no-osm-paths")
            _traffic_cache[cache_key] = result
            return result

        vehicle_axes = _select_dominant_axes(vehicle_paths, fallback_axes=(0.0, 90.0))
        foot_axes = _select_dominant_axes(
            foot_paths,
            fallback_axes=(vehicle_axes[0], _normalize_axis_degrees(vehicle_axes[0] + 90.0))
        )

        vehicle_paths = _normalize_path_network(vehicle_paths, vehicle_axes)
        foot_paths = _normalize_path_network(foot_paths, foot_axes)

        if not vehicle_paths and not foot_paths:
            result = _build_empty_traffic_result(request, "no-normalized-paths")
            _traffic_cache[cache_key] = result
            return result

        vehicle_paths = _sample_real_path_network(vehicle_paths, target_count=max(len(vehicle_paths), 12))
        foot_paths = _sample_real_path_network(foot_paths, target_count=max(len(foot_paths), 18))

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
                "endpoint": overpass_endpoint,
            }
        }

        # Cache the result
        _traffic_cache[cache_key] = result

        return result

    except Exception as e:
        print(f"Traffic Simulation Error: {e}")
        fallback = _build_empty_traffic_result(request, type(e).__name__)
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


class SynthesisLayerRequest(BaseModel):
    name: str
    data: Dict[str, Any]


class SynthesisRequest(BaseModel):
    source_layer: SynthesisLayerRequest
    target_layer: Optional[SynthesisLayerRequest] = None
    operation: str
    params: Dict[str, Any] = {}


class SynthesisScriptRequest(BaseModel):
    source_name: str
    target_name: str = ""
    operation: str
    params: Dict[str, Any] = {}


@app.get("/api/synthesis/catalog")
async def get_synthesis_catalog():
    return {
        "status": "success",
        "crs": "EPSG:3414",
        "theme": theme_payload(),
        "operations": SUPPORTED_OPERATIONS,
    }


def _decode_synthesis_request(payload_format: str, raw_body: bytes) -> Dict[str, Any]:
    if payload_format == "gzip-json":
        try:
            return json.loads(gzip.decompress(raw_body).decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not decode compressed synthesis request: {str(exc)}")

    try:
        return json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode synthesis request JSON: {str(exc)}")


@app.post("/api/synthesis/run")
async def run_synthesis_endpoint(request: Request):
    try:
        payload = _decode_synthesis_request(
            request.headers.get("x-betelnut-payload-format", "").strip().lower(),
            await request.body(),
        )
        validated = SynthesisRequest.model_validate(payload)
        result = run_synthesis(
            source_payload=validated.source_layer.model_dump(),
            target_payload=validated.target_layer.model_dump() if validated.target_layer else None,
            operation=validated.operation,
            params=validated.params,
        )
        return {"status": "success", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid synthesis request: {str(exc)}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Synthesis Error: {str(exc)}")


@app.post("/api/synthesis/pyqgis-script")
async def get_pyqgis_script(request: SynthesisScriptRequest):
    try:
        script = qgis_template(
            {
                "sourceName": request.source_name,
                "targetName": request.target_name,
                "operation": request.operation,
                "params": request.params,
            }
        )
        return {
            "status": "success",
            "script": script,
            "crs": "EPSG:3414",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PyQGIS Template Error: {str(exc)}")

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
