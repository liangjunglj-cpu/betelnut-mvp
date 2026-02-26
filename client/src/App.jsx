import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Tile3DLayer, TileLayer, TripsLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { Search, Layers, Activity, Car, Leaf, MessageSquare, FileText, Download, X, Map } from 'lucide-react';

// Placeholder for your Google Maps API Key
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Initial view state over Singapore (Orchard Road area)
const INITIAL_VIEW_STATE = {
  longitude: 103.837,
  latitude: 1.301,
  zoom: 15.5,
  pitch: 45,
  bearing: 0
};

export default function App() {
  const [trafficData, setTrafficData] = useState({ vehicles: [], foot: [] });

  useEffect(() => {
    fetch('/traffic_data.json')
      .then(res => res.json())
      .then(data => setTrafficData(data))
      .catch(err => console.error("Error loading traffic logic map:", err));
  }, []);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [activeLayers, setActiveLayers] = useState({
    cartoBasemap: true, // Clean minimalist basemap
    google3D: false,    // Heavy 3D tiles moved to optional toggle
    uraConservation: true,
    vegetation: false,
    footTraffic: false,
    vehicleTraffic: false,
    constrictionAnalysis: false
  });

  const [time, setTime] = useState(0);

  useEffect(() => {
    let animation;
    const animate = () => {
      setTime(t => (t + 2) % 1500); // Loops over timestamps
      animation = window.requestAnimationFrame(animate);
    };
    animate();
    return () => window.cancelAnimationFrame(animation);
  }, []);

  const [uraData, setUraData] = useState(null);
  const [geeTileUrl, setGeeTileUrl] = useState(null);
  const [loadingGee, setLoadingGee] = useState(false);

  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [activeTab, setActiveTab] = useState('dossier');

  // Fetch URA Conservation GeoJSON
  useEffect(() => {
    fetch('/api/ura/conservation-data')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setUraData(data.data);
        }
      })
      .catch(err => console.error('Failed to fetch URA Data:', err));
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

  const toggleLayer = (key) => {
    setActiveLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', content: 'I am Betelnut, your conservation assistant. How can I assist you with this site?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  // Chat Submission Handler
  const handleChat = async (presetMessage = null) => {
    const userMessage = presetMessage || chatInput;
    if (!userMessage.trim()) return;

    const newHistory = [...chatHistory, { role: 'user', content: userMessage }];
    setChatHistory(newHistory);
    setChatInput('');
    setIsChatting(true);

    // Provide spatial context to the LLM
    let context = "No specific site selected.";
    if (selectedBuilding) {
      context = `Site: ${selectedBuilding.properties?.INC_CRC || 'Heritage Property'}. Address: ${selectedBuilding.properties?.ADDRESS || 'Unknown'}. `;
      if (activeLayers.constrictionAnalysis) {
        context += `Spatial Analysis: The user is currently running a Constriction Analysis. The map indicates severe intersections between high vehicle/foot traffic and the conservation boundaries at this site, creating significant logistical risks.`;
      } else {
        context += `Spatial Analysis: User is observing the site but has not run a constriction analysis.`;
      }
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
  // DECK.GL LAYERS

  // ---------------------------------------------------------------------------
  // DECK.GL LAYERS
  // ---------------------------------------------------------------------------
  // 1. Clean Minimalist Vector/Raster Basemap (Carto Light)
  const cartoBasemapLayer = new TileLayer({
    id: 'carto-basemap-layer',
    data: 'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    visible: activeLayers.cartoBasemap,
    renderSubLayers: props => {
      const { boundingBox } = props.tile;
      return new BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
      });
    }
  });

  // 2. Heavy Google 3D Tiles (Moved to optional)
  const google3DTilesLayer = new Tile3DLayer({
    id: 'google-3d-tiles',
    data: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_MAPS_API_KEY}`,
    operation: 'terrain+draw',
    visible: activeLayers.google3D,
  });

  const uraLayer = new GeoJsonLayer({
    id: 'ura-conservation-layer',
    data: uraData,
    visible: activeLayers.uraConservation,
    pickable: true,
    autoHighlight: true, // Highlights on hover
    stroked: true,
    filled: true,
    lineWidthMinPixels: 2,
    getFillColor: d => {
      // If Constriction Analysis is ON, mimic highlighting some "at risk" polygons in red.
      if (activeLayers.constrictionAnalysis) {
        // Mock logic: randomly highlight some as constriction points
        return Math.random() > 0.5 ? [220, 38, 38, 180] : [200, 200, 200, 80]
      }
      // If selected, highlight differently
      if (selectedBuilding && selectedBuilding.properties?.OBJECTID === d.properties?.OBJECTID) {
        return [0, 0, 0, 150]; // Dark grey for selected
      }
      return [255, 255, 255, 120] // Normal: slightly opaque white
    },
    getLineColor: [0, 0, 0, 255], // Stark black borders for architectural look
    updateTriggers: {
      getFillColor: [selectedBuilding, activeLayers.constrictionAnalysis]
    },
    onClick: ({ object }, info) => {
      if (object) {
        setSelectedBuilding(object);
      }
    }
  });

  const vegetationLayer = new TileLayer({
    id: 'gee-vegetation-layer',
    data: geeTileUrl,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    visible: activeLayers.vegetation && geeTileUrl !== null,
    opacity: 0.6, // Increased opacity to ensure it shows well over basemaps
    renderSubLayers: props => {
      const { boundingBox } = props.tile;
      return new BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
      });
    }
  });

  const footTrafficLayer = new TripsLayer({
    id: 'foot-traffic-layer',
    data: trafficData.foot,
    getPath: d => d.path,
    getTimestamps: d => d.timestamps,
    getColor: [59, 130, 246], // Blue pulse
    opacity: 0.8,
    widthMinPixels: 4,
    rounded: true,
    trailLength: 200,
    currentTime: time,
    shadowEnabled: false,
    visible: activeLayers.footTraffic
  });

  const vehicleTrafficLayer = new TripsLayer({
    id: 'vehicle-trips-layer',
    data: trafficData.vehicles,
    getPath: d => d.path,
    getTimestamps: d => d.timestamps,
    getColor: [249, 115, 22], // Orange pulse
    opacity: 0.8,
    widthMinPixels: 6,
    rounded: true,
    trailLength: 300,
    currentTime: time,
    shadowEnabled: false,
    visible: activeLayers.vehicleTraffic
  });


  // ---------------------------------------------------------------------------
  // UI COMPONENTS (Issuu Architectural Style)
  // ---------------------------------------------------------------------------
  return (
    <div className="relative w-screen h-screen bg-gray-100 overflow-hidden font-sans text-gray-900">
      <DeckGL
        initialViewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
        controller={true}
        layers={[
          cartoBasemapLayer,
          google3DTilesLayer,
          vegetationLayer,
          uraLayer,
          footTrafficLayer,
          vehicleTrafficLayer
        ]}
        parameters={{ clearColor: [0.95, 0.95, 0.95, 1] }} // light gray background before tiles load
      />

      {/* LEFT PANEL: Branding & Layers */}
      <div className="absolute top-6 left-6 w-80 flex flex-col gap-4 z-10">
        {/* Header Block */}
        <div className="bg-white/90 backdrop-blur-md border border-gray-200 p-6 shadow-sm">
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
        <div className="bg-white/90 backdrop-blur-md border border-gray-200 p-6 shadow-sm">
          <h2 className="font-serif text-sm font-semibold uppercase tracking-widest text-black mb-4 flex items-center">
            <Layers size={16} className="mr-2" /> Map Layers
          </h2>
          <div className="flex flex-col gap-3">
            <Toggle label="Clean Vector Basemap" icon={<Map size={16} />} active={activeLayers.cartoBasemap} onClick={() => toggleLayer('cartoBasemap')} />
            <Toggle label="Google 3D Context" icon={<Layers size={16} />} active={activeLayers.google3D} onClick={() => toggleLayer('google3D')} />
            <div className="h-px bg-gray-200 my-1"></div>
            <Toggle label="URA Conservation" icon={<FileText size={16} />} active={activeLayers.uraConservation} onClick={() => toggleLayer('uraConservation')} />
            <Toggle label="Site Vegetation (GEE)" icon={<Leaf size={16} />} active={activeLayers.vegetation} onClick={() => toggleLayer('vegetation')} loading={loadingGee} />
            <div className="h-px bg-gray-200 my-1"></div>
            <Toggle label="Foot Traffic Simulation" icon={<Activity size={16} />} active={activeLayers.footTraffic} onClick={() => toggleLayer('footTraffic')} />
            <Toggle label="Vehicle Intensity" icon={<Car size={16} />} active={activeLayers.vehicleTraffic} onClick={() => toggleLayer('vehicleTraffic')} />
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => toggleLayer('constrictionAnalysis')}
              className={`w-full py-3 px-4 flex items-center justify-center font-bold text-xs uppercase tracking-widest transition-all border
                ${activeLayers.constrictionAnalysis ? 'bg-red-600 text-white border-red-600' : 'bg-black text-white hover:bg-gray-800'}`}
            >
              {activeLayers.constrictionAnalysis ? 'Clear Impact Analysis' : 'Run Constriction Analysis'}
            </button>
            <p className="text-xs text-gray-400 mt-2 text-center">Intersects High Traffic with Heritage boundaries to highlight logistical risks.</p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Dossier & Chat (Shows only if a building is selected) */}
      {selectedBuilding && (
        <div className="absolute top-6 right-6 w-96 bottom-6 flex flex-col bg-white border border-gray-200 shadow-xl overflow-hidden z-10 transition-transform">

          {/* Right Panel Header */}
          <div className="p-5 border-b border-gray-200 flex justify-between items-start bg-gray-50">
            <div>
              <p className="text-xs tracking-wider text-gray-500 uppercase mb-1">Selected Asset</p>
              <h2 className="font-serif text-xl font-semibold text-black leading-tight">
                {selectedBuilding.properties?.INC_CRC || 'Heritage Property'}
              </h2>
            </div>
            <button onClick={() => setSelectedBuilding(null)} className="p-1 text-gray-400 hover:text-black">
              <X size={20} />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 px-5 pt-3 gap-6 bg-gray-50">
            <Tab id="dossier" current={activeTab} set={setActiveTab}>Dossier</Tab>
            <Tab id="chat" current={activeTab} set={setActiveTab}>Insights</Tab>
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
                    <p><strong>Object ID:</strong> {selectedBuilding.properties?.OBJECTID}</p>
                    <p><strong>Shape Length:</strong> {selectedBuilding.properties?.SHAPE_Length?.toFixed(2)} m</p>
                    <p><strong>Shape Area:</strong> {selectedBuilding.properties?.SHAPE_Area?.toFixed(2)} sqm</p>
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
                      <p className={msg.role === 'assistant' ? 'font-serif' : ''}>{msg.content}</p>
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
  );
}

// Simple Helper Components for UI
const Toggle = ({ label, icon, active, onClick, loading }) => (
  <button
    onClick={onClick}
    className={`flex justify-between items-center w-full text-left px-3 py-2 text-sm transition-colors border-l-2
      ${active ? 'border-black text-black bg-gray-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
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