import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WebMercatorViewport } from '@deck.gl/core';
import { Search, Layers, Activity, Car, Leaf, MessageSquare, FileText, Download, X, Map, Box, Landmark, Star, TreePine } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import SandboxPanel from './SandboxLayer';
import { captureViewport, buildRenderPrompt, requestAIRender } from './RenderCapture';
import Gumball from './Gumball';
import MapCanvas from './MapCanvas';
import LandingPage from './LandingPage';

// Initial view state over Singapore (Orchard Road area)
const INITIAL_VIEW_STATE = {
  longitude: 103.837,
  latitude: 1.301,
  zoom: 15.5,
  pitch: 45,
  bearing: 0
};

export default function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [activeLayers, setActiveLayers] = useState({
    cartoBasemap: true, // Clean minimalist basemap
    google3D: false,    // Heavy 3D tiles moved to optional toggle
    uraConservation: true,
    historicSites: false, // NHB Historic Sites
    touristAttractions: false, // STB Tourist Attractions
    parks: false, // NParks
    vegetation: false,
    footTraffic: false,
    vehicleTraffic: false,
    sandbox: false       // Sandbox mode for 3D model placement
  });

  // Layer category accordion state
  const [openCategories, setOpenCategories] = useState({
    basemaps: true,
    heritage: true,
    environment: false,
    tools: true
  });
  const toggleCategory = (key) => setOpenCategories(prev => ({ ...prev, [key]: !prev[key] }));

  const [trafficData, setTrafficData] = useState({ vehicles: [], foot: [] });
  const [isTrafficLoading, setIsTrafficLoading] = useState(false);
  const [touristAttractionsData, setTouristAttractionsData] = useState(null);
  const [parksData, setParksData] = useState(null);

  // DYNAMIC TRAFFIC FETCHING: Re-fetch trip simulation based on viewport bounds
  useEffect(() => {
    if (!activeLayers.footTraffic && !activeLayers.vehicleTraffic) return;

    const timer = setTimeout(() => {
      // Calculate view bounds
      const viewport = new WebMercatorViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        pitch: viewState.pitch,
        bearing: viewState.bearing
      });
      const bounds = viewport.getBounds(); // [minLng, minLat, maxLng, maxLat]

      setIsTrafficLoading(true);
      fetch('/api/traffic/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ south: bounds[1], west: bounds[0], north: bounds[3], east: bounds[2] })
      })
        .then(res => res.json())
        .then(data => {
          if (data && (data.vehicles || data.foot)) {
            setTrafficData(data);
          } else {
            // Fallback to static sample data for Orchard area if dynamic fails
            fetch('/traffic_data.json')
              .then(res => res.json())
              .then(fallback => setTrafficData(fallback));
          }
        })
        .catch(() => {
          fetch('/traffic_data.json')
            .then(res => res.json())
            .then(fallback => setTrafficData(fallback));
        })
        .finally(() => setIsTrafficLoading(false));
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [viewState.longitude, viewState.latitude, viewState.zoom, activeLayers.footTraffic, activeLayers.vehicleTraffic]);

  // NEW DYNAMIC OSM POLYGONS FETCHING
  useEffect(() => {
    if (!activeLayers.parks && !activeLayers.touristAttractions) return;

    const timer = setTimeout(() => {
      const viewport = new WebMercatorViewport({
        width: window.innerWidth, height: window.innerHeight,
        longitude: viewState.longitude, latitude: viewState.latitude, zoom: viewState.zoom,
        pitch: viewState.pitch, bearing: viewState.bearing
      });
      const bounds = viewport.getBounds();
      
      const layersToFetch = [];
      if (activeLayers.parks) layersToFetch.push('parks');
      if (activeLayers.touristAttractions) layersToFetch.push('attractions');

      fetch('/api/osm/polygons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ south: bounds[1], west: bounds[0], north: bounds[3], east: bounds[2], layers: layersToFetch })
      })
        .then(res => res.json())
        .then(data => {
          // If API fails or returns error status, try to load fallback
          if (!data || data.status === 'error' || !data.features || data.features.length === 0) {
            // ONLY load fallback if we don't already have some data (don't overwrite good data with old fallback)
            fetch('/data/osm_fallback.geojson')
              .then(res => res.json())
              .then(fallback => {
                if (activeLayers.parks) setParksData(prev => prev || { ...fallback, features: fallback.features.filter(f => f.properties._type === 'park') });
                if (activeLayers.touristAttractions) setTouristAttractionsData(prev => prev || { ...fallback, features: fallback.features.filter(f => f.properties._type === 'tourist-attraction') });
              });
            return;
          }

          if (activeLayers.parks) {
             setParksData({
               ...data, 
               features: data.features.filter(f => f.properties._type === 'park')
             });
          }
          if (activeLayers.touristAttractions) {
             setTouristAttractionsData({
               ...data,
               features: data.features.filter(f => f.properties._type === 'tourist-attraction')
             });
          }
        })
        .catch(() => {
          // Network error fallback — apply _type filter matching the success path
          fetch('/data/osm_fallback.geojson').then(r => r.json()).then(fb => {
             if (activeLayers.parks) setParksData(prev => prev || { ...fb, features: fb.features.filter(f => f.properties._type === 'park') });
             if (activeLayers.touristAttractions) setTouristAttractionsData(prev => prev || { ...fb, features: fb.features.filter(f => f.properties._type === 'tourist-attraction') });
          });
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [viewState.longitude, viewState.latitude, viewState.zoom, activeLayers.parks, activeLayers.touristAttractions]);

  // --- SANDBOX STATE ---
  const [placedModels, setPlacedModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [pendingModelUrl, setPendingModelUrl] = useState(null);
  const [pendingModelName, setPendingModelName] = useState(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderedImage, setRenderedImage] = useState(null);
  const [gridSize, setGridSize] = useState(0.0001); // ~11m grid at Singapore latitude
  const deckRef = useRef(null);

  // Stable callback to update a single model's properties (used by Gumball + controls)
  const updateModel = useCallback((id, patch) => {
    setPlacedModels(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }, []);

  // Derive selected model object
  const selectedModel = placedModels.find(m => m.id === selectedModelId) || null;

  // --- GENERAL APP STATE ---
  const [uraData, setUraData] = useState(null);
  const [historicSitesData, setHistoricSitesData] = useState(null);
  const [geeTileUrl, setGeeTileUrl] = useState(null);
  const [loadingGee, setLoadingGee] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [activeTab, setActiveTab] = useState('dossier');
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', content: 'I am Betelnut, your conservation assistant. How can I assist you with this site?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  // --- EFFECTS ---
  // Listen for model selection from ScenegraphLayer click
  useEffect(() => {
    const handler = (e) => setSelectedModelId(e.detail);
    window.addEventListener('sandbox-select', handler);
    return () => window.removeEventListener('sandbox-select', handler);
  }, []);

  // Load ALL fallback data immediately so layers render instantly on toggle.
  // Then upgrade with live API data in the background.
  useEffect(() => {
    // Load fallback first for instant display
    // URA fallback is wrapped in {status, data} format — unwrap to raw GeoJSON
    fetch('/data/ura_fallback.geojson').then(r => r.json()).then(fb => {
      const geojson = fb.data || fb; // unwrap if wrapped, use raw if already GeoJSON
      setUraData(prev => prev || geojson);
    });
    fetch('/data/osm_fallback.geojson').then(r => r.json()).then(fb => {
      setParksData(prev => prev || { ...fb, features: fb.features.filter(f => f.properties._type === 'park') });
      setTouristAttractionsData(prev => prev || { ...fb, features: fb.features.filter(f => f.properties._type === 'tourist-attraction') });
    });
    fetch('/data/historic_sites_fallback.geojson').then(r => r.json()).then(fb => {
      setHistoricSitesData(prev => prev || fb);
    });

    // Then try live API data (overwrites fallback if successful)
    fetch('/api/ura/conservation-data')
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setUraData(data.data); })
      .catch(() => {});
    fetch('/api/datagov/historic-sites')
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setHistoricSitesData(data.data); })
      .catch(() => {});
    fetch('/api/datagov/tourist-attractions')
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setTouristAttractionsData(data.data); })
      .catch(() => {});
    fetch('/api/datagov/parks')
      .then(res => res.json())
      .then(data => { if (data.status === 'success') setParksData(data.data); })
      .catch(() => {});
  }, []);

  // Fetch GEE Vegetation Layer
  useEffect(() => {
    if (activeLayers.vegetation && !geeTileUrl) {
      setLoadingGee(true);
      fetch('http://127.0.0.1:8000/api/gee-layer/vegetation')
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success') setGeeTileUrl(data.tile_fetch_url);
        })
        .finally(() => setLoadingGee(false));
    }
  }, [activeLayers.vegetation, geeTileUrl]);

  // Handle click-to-place: when sandbox is active and a model is pending, place it at click location
  const handleMapClick = useCallback((info) => {
    if (!isPlacing || !pendingModelUrl) return;
    if (!info.coordinate) return;

    const [lng, lat] = info.coordinate;
    // Auto-detect terrain altitude from 3D tile intersection
    const altitude = info.coordinate[2] || 0;
    
    const newModel = {
      id: `model-${Date.now()}`,
      name: pendingModelName || 'Untitled Model',
      modelUrl: pendingModelUrl,
      position: [lng, lat, altitude],
      rotation: [0, 0, 0],
      // Rhino exports in millimeters; deck.gl works in meters.
      // Default scale of 1.0 means 1 Rhino unit = 1 meter.
      // If the model appears too large/small, this is the first thing to adjust.
      scale: 1,
    };

    setPlacedModels(prev => [...prev, newModel]);
    setSelectedModelId(newModel.id);
    setIsPlacing(false);
    setPendingModelUrl(null);
    setPendingModelName(null);

    // Auto-switch to sandbox tab in right panel
    setActiveTab('sandbox');
  }, [isPlacing, pendingModelUrl, pendingModelName]);

  // Handle AI render generation
  const handleGenerateRender = useCallback(async () => {
    setIsRendering(true);
    setRenderedImage(null);
    try {
      const screenshot = captureViewport();
      if (!screenshot) throw new Error('Could not capture viewport');

      const prompt = buildRenderPrompt({
        selectedBuilding,
        placedModels,
        viewState: viewState,
      });

      const result = await requestAIRender(screenshot, prompt);
      if (result.rendered_image_base64) {
        setRenderedImage(`data:image/png;base64,${result.rendered_image_base64}`);
      }
    } catch (err) {
      console.error('AI Render failed:', err);
      alert(`AI Render failed: ${err.message}`);
    }
    setIsRendering(false);
  }, [selectedBuilding, placedModels]);

  const toggleLayer = (key) => {
    setActiveLayers(prev => {
      const newState = { ...prev, [key]: !prev[key] };
      if (key === 'sandbox' && newState.sandbox) {
        setActiveTab('sandbox');
      }
      return newState;
    });
  };

  // Chat Submission Handler
  const handleChat = async (presetMessage = null) => {
    const userMessage = presetMessage || chatInput;
    if (!userMessage.trim()) return;

    const newHistory = [...chatHistory, { role: 'user', content: userMessage }];
    setChatHistory(newHistory);
    setChatInput('');
    setIsChatting(true);

    // Provide rich spatial context to the LLM
    let context = "No specific site selected.";
    if (selectedBuilding) {
      const props = selectedBuilding.properties || {};
      const siteType = props._type || 'conservation-area';
      const name = props.NAME || props.Name || props.name || 'Unknown';
      const address = props.ADDRESS || props.Address || 'Unknown';
      const siteId = props.INC_CRC || props.OBJECTID || 'N/A';
      const description = props.DESCRIPTION || props.Description || '';

      context = `Site Name: ${name}\nSite ID: ${siteId}\nAddress: ${address}\nType: ${siteType}\n`;
      if (description) context += `Description: ${description}\n`;

      // Include active layers as spatial context
      const activeOverlays = [];
      if (activeLayers.uraConservation) activeOverlays.push('URA Conservation Areas');
      if (activeLayers.historicSites) activeOverlays.push('NHB Historic Sites');
      if (activeLayers.touristAttractions) activeOverlays.push('Tourist Attractions');
      if (activeLayers.parks) activeOverlays.push('Parks & Reserves');
      if (activeLayers.vegetation) activeOverlays.push('NDVI Vegetation Index');
      if (activeLayers.footTraffic) activeOverlays.push('Foot Traffic Simulation');
      if (activeLayers.vehicleTraffic) activeOverlays.push('Vehicle Traffic Intensity');
      context += `Active Map Overlays: ${activeOverlays.join(', ') || 'None'}\n`;
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, context })
      });
      const data = await res.json();
      if (res.ok) {
        setChatHistory([...newHistory, { role: 'assistant', content: data.reply }]);
      } else {
        setChatHistory([...newHistory, { role: 'assistant', content: `[System Error]: ${data.detail}` }]);
      }
    } catch (err) {
      setChatHistory([...newHistory, { role: 'assistant', content: `[Connection Error]: Could not reach backend.` }]);
    }
    setIsChatting(false);
  };

  // ---------------------------------------------------------------------------
  // UI COMPONENTS (Issuu Architectural Style)

  // ---------------------------------------------------------------------------
  // UI COMPONENTS (Issuu Architectural Style)
  // ---------------------------------------------------------------------------
  return (
    <>
    {showLanding && <LandingPage onEnter={() => setShowLanding(false)} />}
    <div
      className="relative w-screen h-screen bg-gray-100 overflow-hidden font-sans text-gray-900"
      style={{ opacity: showLanding ? 0 : 1, transition: 'opacity 0.8s ease-in-out', pointerEvents: showLanding ? 'none' : 'auto' }}
    >
      <MapCanvas
        viewState={viewState}
        setViewState={setViewState}
        activeLayers={activeLayers}
        uraData={uraData}
        historicSitesData={historicSitesData}
        touristAttractionsData={touristAttractionsData}
        parksData={parksData}
        geeTileUrl={geeTileUrl}
        trafficData={trafficData}
        placedModels={placedModels}
        setPlacedModels={setPlacedModels}
        selectedModelId={selectedModelId}
        setSelectedBuilding={setSelectedBuilding}
        selectedBuilding={selectedBuilding}
        isPlacing={isPlacing}
        handleMapClick={handleMapClick}
        deckRef={deckRef}
      />

      {/* Gumball Transform Widget — renders axis arrows + rotation ring on selected model */}
      {activeLayers.sandbox && selectedModel && (
        <Gumball
          selectedModel={selectedModel}
          viewState={viewState}
          updateModel={updateModel}
          gridSize={gridSize}
          deckRef={deckRef}
        />
      )}

      {/* LEFT PANEL: Branding & Layers */}
      <div className="absolute top-6 left-6 w-80 flex flex-col gap-4 z-10 bottom-6">
        {/* Header Block */}
        <div className="bg-white/90 backdrop-blur-md border border-gray-200 p-6 shadow-sm shrink-0">
          <h1 className="font-serif text-2xl font-semibold uppercase tracking-widest text-black mb-1">Betelnut</h1>
          <p className="text-xs tracking-wider text-gray-500 uppercase">Map-First Conservation</p>

          <div className="mt-6 flex items-center border border-gray-300 px-3 py-2 bg-white">
            <Search size={16} className="text-gray-400 mr-2" />
            <input
              type="text"
              placeholder="Search address (e.g. 28 Orchard)"
              className="bg-transparent text-sm w-full outline-none placeholder-gray-400"
            />
          </div>
        </div>

        {/* Layers Block */}
        <div className="bg-white/90 backdrop-blur-md border border-gray-200 p-6 shadow-sm flex flex-col min-h-0">
          <h2 className="font-serif text-sm font-semibold uppercase tracking-widest text-black mb-4 flex items-center shrink-0">
            <Layers size={16} className="mr-2" /> Map Layers
          </h2>
          
          {/* Scrollable Categories Context */}
          <div className="flex-1 overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
            <LayerCategory title="Basemaps" id="basemaps" openCategories={openCategories} toggleCategory={toggleCategory}>
              <Toggle label="Clean Vector Basemap" icon={<Map size={16} />} active={activeLayers.cartoBasemap} onClick={() => toggleLayer('cartoBasemap')} />
              <Toggle label="Google 3D Context" icon={<Layers size={16} />} active={activeLayers.google3D} onClick={() => toggleLayer('google3D')} />
            </LayerCategory>

            <LayerCategory title="Heritage & Attractions" id="heritage" openCategories={openCategories} toggleCategory={toggleCategory}>
              <Toggle label="URA Conservation" icon={<FileText size={16} />} active={activeLayers.uraConservation} onClick={() => toggleLayer('uraConservation')} bgHint="bg-amber-100/60" />
              <Toggle label="NHB Historic Sites" icon={<Landmark size={16} />} active={activeLayers.historicSites} onClick={() => toggleLayer('historicSites')} bgHint="bg-amber-100/60" />
              <Toggle label="Tourist Attractions" icon={<Star size={16} />} active={activeLayers.touristAttractions} onClick={() => toggleLayer('touristAttractions')} bgHint="bg-purple-100/60" />
            </LayerCategory>

            <LayerCategory title="Environment & Traffic" id="environment" openCategories={openCategories} toggleCategory={toggleCategory}>
              <Toggle label="Parks & Reserves" icon={<TreePine size={16} />} active={activeLayers.parks} onClick={() => toggleLayer('parks')} bgHint="bg-green-100/60" />
              <Toggle label="Site Vegetation (GEE)" icon={<Leaf size={16} />} active={activeLayers.vegetation} onClick={() => toggleLayer('vegetation')} loading={loadingGee} bgHint="bg-emerald-100/60" />
              <Toggle label="Foot Traffic Simulation" icon={<Activity size={16} />} active={activeLayers.footTraffic} loading={activeLayers.footTraffic && isTrafficLoading} onClick={() => toggleLayer('footTraffic')} bgHint="bg-blue-100/60" />
              <Toggle label="Vehicle Intensity" icon={<Car size={16} />} active={activeLayers.vehicleTraffic} loading={activeLayers.vehicleTraffic && isTrafficLoading} onClick={() => toggleLayer('vehicleTraffic')} bgHint="bg-orange-100/60" />
            </LayerCategory>

            <LayerCategory title="Tools" id="tools" openCategories={openCategories} toggleCategory={toggleCategory}>
              <Toggle label="Sandbox Mode" icon={<Box size={16} />} active={activeLayers.sandbox} onClick={() => toggleLayer('sandbox')} />
            </LayerCategory>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 shrink-0">
            <button
              onClick={() => toggleLayer('sandbox')}
              className={`w-full py-3 px-4 flex items-center justify-center font-bold text-xs uppercase tracking-widest transition-all border
                ${activeLayers.sandbox ? 'bg-black text-white border-black' : 'bg-black text-white hover:bg-gray-800 border-black'}`}
            >
              <Box size={16} className="mr-2" />
              {activeLayers.sandbox ? 'Exit Sandbox' : 'Enter Sandbox Mode'}
            </button>
            <p className="text-[10px] text-gray-400 mt-2 text-center">Drop 3D models onto the geospatial twin to validate contextual fit.</p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Dossier, Chat, Sandbox (Shows if building selected OR sandbox active) */}
      {(selectedBuilding || activeLayers.sandbox) && (
        <div className="absolute top-6 right-6 w-96 bottom-6 flex flex-col bg-white border border-gray-200 shadow-xl overflow-hidden z-10 transition-transform">

          {/* Right Panel Header */}
          <div className="p-5 border-b border-gray-200 flex justify-between items-start bg-gray-50">
            <div>
              <p className="text-xs tracking-wider text-gray-500 uppercase mb-1">
                {selectedBuilding ? 'Selected Asset' : 'Sandbox View'}
              </p>
              <h2 className="font-serif text-xl font-semibold text-black leading-tight">
                {selectedBuilding?.properties?.NAME || selectedBuilding?.properties?.INC_CRC || (activeLayers.sandbox ? 'Sandbox Mode' : 'Heritage Property')}
              </h2>
            </div>
            {selectedBuilding && (
              <button onClick={() => setSelectedBuilding(null)} className="p-1 text-gray-400 hover:text-black">
                <X size={20} />
              </button>
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 px-5 pt-3 gap-6 bg-gray-50">
            <Tab id="dossier" current={activeTab} set={setActiveTab}>Dossier</Tab>
            <Tab id="chat" current={activeTab} set={setActiveTab}>Insights</Tab>
            <Tab id="sandbox" current={activeTab} set={setActiveTab}>Sandbox</Tab>
            <Tab id="export" current={activeTab} set={setActiveTab}>Export</Tab>
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-5 bg-white">

            {/* DOSSIER TAB */}
            {activeTab === 'dossier' && (
              <div className="animate-fade-in flex flex-col gap-6">
                <div>
                  <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">Geometric Properties</h3>
                  <div className="space-y-2 text-sm border-l-2 border-black pl-3">
                    <p><strong>Object ID:</strong> {selectedBuilding?.properties?.OBJECTID || 'N/A'}</p>
                    <p><strong>Shape Length:</strong> {selectedBuilding?.properties?.SHAPE_Length?.toFixed(2) || 'N/A'} m</p>
                    <p><strong>Shape Area:</strong> {selectedBuilding?.properties?.SHAPE_Area?.toFixed(2) || 'N/A'} sqm</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3">Constraints Log</h3>
                  <div className="space-y-3">
                    <textarea className="w-full text-sm border border-gray-300 p-3 outline-none resize-none focus:border-black" rows="3" placeholder="Notes on adjacent structures, access limitations, etc..."></textarea>
                    <label className="flex items-center text-sm gap-2">
                      <input type="checkbox" className="accent-black w-4 h-4" /> Requires Structural Monitoring
                    </label>
                    <label className="flex items-center text-sm gap-2">
                      <input type="checkbox" className="accent-black w-4 h-4" /> Night-time Logistics Only
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* CHAT TAB / INSIGHTS */}
            {activeTab === 'chat' && (
              <div className="animate-fade-in flex flex-col h-full">
                <div className="flex-1 overflow-y-auto mb-4 border border-gray-200 p-3 text-sm flex flex-col gap-3 bg-gray-50">
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={`p-3 shadow-sm rounded-sm max-w-[85%] ${msg.role === 'user' ? 'bg-black text-white self-end' : 'bg-white border border-gray-300 self-start'}`}>
                      {msg.role === 'assistant' ? (
                        <div className="font-serif prose prose-sm prose-gray max-w-none [&_h2]:text-sm [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:border-b [&_h2]:border-gray-200 [&_h2]:pb-1 [&_ul]:mt-1 [&_ul]:mb-2 [&_li]:my-0.5 [&_strong]:text-gray-900">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                    </div>
                  ))}
                  {isChatting && (
                    <div className="bg-white border border-gray-300 p-3 shadow-sm self-start max-w-[85%] rounded-sm">
                      <p className="italic text-gray-500 font-serif">Betelnut is analyzing...</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center border border-gray-300 p-2 bg-white">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                    placeholder="Query the AI..."
                    className="flex-1 outline-none text-sm bg-transparent"
                  />
                  <button onClick={() => handleChat()} disabled={isChatting} className="bg-black text-white p-1.5 hover:bg-gray-800 transition-colors disabled:bg-gray-400">
                    <MessageSquare size={16} />
                  </button>
                </div>
                <div className="flex gap-2 mt-2">
                  <span onClick={() => handleChat("Assess Logistical Risk.")} className="text-[10px] uppercase border text-black bg-gray-100 hover:bg-gray-200 px-2 py-1 cursor-pointer transition-colors">Assess Logistical Risk</span>
                  <span onClick={() => handleChat("Generate Action Plan.")} className="text-[10px] uppercase border text-black bg-gray-100 hover:bg-gray-200 px-2 py-1 cursor-pointer transition-colors">Generate Action Plan</span>
                </div>
              </div>
            )}

            {/* SANDBOX TAB */}
            {activeTab === 'sandbox' && (
              <div className="animate-fade-in h-full">
                <SandboxPanel
                  placedModels={placedModels}
                  setPlacedModels={setPlacedModels}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  pendingModelUrl={pendingModelUrl}
                  setPendingModelUrl={setPendingModelUrl}
                  pendingModelName={pendingModelName}
                  setPendingModelName={setPendingModelName}
                  isPlacing={isPlacing}
                  setIsPlacing={setIsPlacing}
                  onGenerateRender={handleGenerateRender}
                  isRendering={isRendering}
                  renderedImage={renderedImage}
                  gridSize={gridSize}
                  setGridSize={setGridSize}
                  updateModel={updateModel}
                />
              </div>
            )}

            {/* EXPORT TAB */}
            {activeTab === 'export' && (
              <div className="animate-fade-in flex flex-col items-center justify-center h-full text-center">
                <FileText size={48} className="text-gray-300 mb-4" />
                <h3 className="font-serif text-lg mb-2">Conservation Action Sheet</h3>
                <p className="text-sm text-gray-500 mb-6">Generate a printable 1-page PDF summarizing the building dossier, map analysis, and constraint checklist.</p>
                <button onClick={() => window.print()} className="bg-black text-white px-6 py-2 uppercase text-xs tracking-widest font-bold flex items-center gap-2 hover:bg-gray-800">
                  <Download size={16} /> Export to PDF
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
    </>
  );
}

// Simple Helper Components for UI
const LayerCategory = ({ title, id, openCategories, toggleCategory, children }) => (
  <div className="mb-3">
    <button 
      onClick={() => toggleCategory(id)}
      className="w-full flex items-center justify-between font-serif text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1 border-b border-gray-100 hover:text-black hover:border-black transition-colors"
    >
      {title}
      <span className="text-lg leading-none font-sans font-light">{openCategories[id] ? '−' : '+'}</span>
    </button>
    <div className={`flex flex-col gap-1 overflow-hidden transition-all duration-300 ease-in-out origin-top ${openCategories[id] ? 'max-h-[500px] opacity-100 mb-4' : 'max-h-0 opacity-0'}`}>
      {children}
    </div>
  </div>
);

const Toggle = ({ label, icon, active, onClick, loading, bgHint }) => (
  <button
    onClick={onClick}
    className={`flex justify-between items-center w-full text-left px-3 py-2 text-sm transition-colors border-l-2
      ${active ? `border-black text-black ${bgHint || 'bg-gray-50'}` : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
  >
    <span className="flex items-center gap-2">{icon} {label}</span>
    {loading ? <span className="text-xs italic text-gray-400">...</span> : (
      <div className={`w-8 h-4 rounded-full flex items-center p-0.5 ${active ? 'bg-black' : 'bg-gray-300'}`}>
        <div className={`w-3 h-3 bg-white rounded-full transition-transform ${active ? 'translate-x-4' : ''}`} />
      </div>
    )}
  </button>
);

const Tab = ({ id, current, set, children }) => (
  <button
    onClick={() => set(id)}
    className={`pb-2 text-sm uppercase tracking-widest font-semibold transition-colors
      ${current === id ? 'text-black border-b-2 border-black' : 'text-gray-400 hover:text-gray-600'}`}
  >
    {children}
  </button>
);

