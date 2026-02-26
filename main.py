import ee
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
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
# Keys are safely loaded from the local .env file or Vercel Environment Variables
SERVICE_ACCOUNT_FILE = 'service-account.json'
URA_ACCESS_KEY = os.environ.get('URA_ACCESS_KEY', '') 
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')


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
    because it returns the actual 2D polygon geometry needed for the map overlay, 
    but the token logic is set up above for querying planning approvals).
    """
    try:
        # Example: Fetching the URA Master Plan Conservation Area polygons
        # In a full production app, you might use the URA token to fetch live planning decisions here
        dataset_id = "d_8c8162ffb9deb8d11b00623048f65a70" # URA Conservation Area GEOJSON
        url = f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download"
        
        init_res = requests.get(url).json()
        if init_res['code'] == 0:
            download_url = init_res['data']['url']
            geojson_data = requests.get(download_url).json()
            return {"status": "success", "data": geojson_data}
        else:
            raise Exception("Failed to fetch URA GeoJSON")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        
    system_prompt = "You are a Map-First Conservation Copilot. Use the provided spatial constraint context to inform your urban planning and conservation advice. Be concise, objective, and format your output clearly. Structure your response as an architectural or conservation professional would."
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
