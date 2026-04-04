import React, { useState, useEffect, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { Tile3DLayer, TileLayer, TripsLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core';
import { createSandboxLayers } from './SandboxLayer';

// Access Google API Key from Vite env
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Create a realistic lighting setup for 3D models (PBR rendering)
const ambientLight = new AmbientLight({
  color: [255, 255, 255],
  intensity: 1.5
});
const dirLight = new DirectionalLight({
  color: [255, 255, 255],
  intensity: 2.5,
  direction: [1, -2, -1]
});
const lightingEffect = new LightingEffect({ ambientLight, dirLight });

const MapCanvas = React.memo(({
  viewState, setViewState, activeLayers, uraData, historicSitesData, 
  touristAttractionsData, parksData, geeTileUrl, trafficData,
  placedModels, setPlacedModels, selectedModelId, setSelectedBuilding, selectedBuilding,
  isPlacing, handleMapClick, deckRef
}) => {
  const [time, setTime] = useState(0);

  // PERFORMANCE: Heavy Traffic Animation Loop isolated to this component!
  // It will ONLY trigger re-renders inside MapCanvas. The UI panels will not lag!
  useEffect(() => {
    if (!activeLayers.footTraffic && !activeLayers.vehicleTraffic) return;
    let animation;
    const animate = () => {
      setTime(t => (t + 5) % 3000);
      animation = window.requestAnimationFrame(animate);
    };
    animate();
    return () => window.cancelAnimationFrame(animation);
  }, [activeLayers.footTraffic, activeLayers.vehicleTraffic]);

  // 1. Clean Minimalist Vector/Raster Basemap (Carto Light)
  const cartoBasemapLayer = useMemo(() => new TileLayer({
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
  }), [activeLayers.cartoBasemap]);

  // 2. Google 3D Tiles — conditionally excluded when off to free GPU memory entirely
  const google3DTilesLayer = useMemo(() => activeLayers.google3D ? new Tile3DLayer({
    id: 'google-3d-tiles',
    data: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_MAPS_API_KEY}`,
    operation: 'terrain+draw',
    loadOptions: {
      tileset: {
        maximumScreenSpaceError: 20,
        maximumMemoryUsage: 256,
        viewDistanceScale: 1.0,
        skipLevelOfDetail: true,
        memoryAdjustedScreenSpaceError: true,
        updateTransforms: false,
      }
    },
    onTilesetLoad: (tileset) => {
      tileset.options.maximumScreenSpaceError = 20;
    }
  }) : null, [activeLayers.google3D]);

  const uraLayer = useMemo(() => new GeoJsonLayer({
    id: 'ura-conservation-layer',
    data: uraData,
    visible: activeLayers.uraConservation,
    pickable: true,
    autoHighlight: true,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 2,
    material: false,
    getFillColor: d => {
      if (selectedBuilding && selectedBuilding.properties?.OBJECTID === d.properties?.OBJECTID) {
        return [0, 0, 0, 150];
      }
      return [217, 160, 45, 60]
    },
    getLineColor: [0, 0, 0, 255],
    updateTriggers: {
      getFillColor: [selectedBuilding]
    },
    onClick: ({ object }) => {
      if (object) setSelectedBuilding(object);
    }
  }), [uraData, activeLayers.uraConservation, selectedBuilding]);

  const historicSitesLayer = useMemo(() => new GeoJsonLayer({
    id: 'historic-sites-layer',
    data: historicSitesData,
    visible: activeLayers.historicSites,
    pickable: true,
    autoHighlight: true,
    material: false,
    pointRadiusMinPixels: 14,
    pointRadiusMaxPixels: 14,
    getFillColor: [217, 160, 45, 255],
    getLineColor: [120, 80, 20, 255],
    lineWidthMinPixels: 2,
    pointType: 'circle+text',
    getText: () => 'H',
    getTextSize: 14,
    getTextColor: [255, 255, 255, 255],
    getTextAlignmentBaseline: 'center',
    textFontFamily: 'sans-serif',
    getTextPixelOffset: [0, 0],
    onClick: ({ object }) => {
      if (object && object.properties) {
        const name = object.properties.NAME || object.properties.Name || object.properties.name || 'Historic Site';
        const desc = object.properties.DESCRIPTION || object.properties.Description || object.properties.description || '';
        setSelectedBuilding({
          ...object,
          properties: { ...object.properties, NAME: name, ADDRESS: desc, _type: 'historic-site' }
        });
      }
    }
  }), [historicSitesData, activeLayers.historicSites]);

  // NEW DYNAMIC OSM POLYGONS: Tourist Attractions
  const touristAttractionsLayer = useMemo(() => new GeoJsonLayer({
    id: 'tourist-attractions-layer',
    data: touristAttractionsData,
    visible: activeLayers.touristAttractions,
    pickable: true,
    autoHighlight: true,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 2,
    material: false,
    getFillColor: d => {
      if (selectedBuilding && selectedBuilding.properties?.NAME === d.properties?.NAME) {
         return [0, 0, 0, 150];
      }
      return [147, 51, 234, 100];
    },
    getLineColor: [88, 28, 135, 255],
    updateTriggers: {
      getFillColor: [selectedBuilding]
    },
    onClick: ({ object }) => {
      if (object && object.properties) {
        setSelectedBuilding({
          ...object,
          properties: { ...object.properties, ADDRESS: "Tourism/Attraction Site", _type: 'tourist-attraction' }
        });
      }
    }
  }), [touristAttractionsData, activeLayers.touristAttractions, selectedBuilding]);

  // NEW DYNAMIC OSM POLYGONS: Parks
  const parksLayer = useMemo(() => new GeoJsonLayer({
    id: 'parks-layer',
    data: parksData,
    visible: activeLayers.parks,
    pickable: true,
    autoHighlight: true,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 2,
    material: false,
    getFillColor: d => {
      if (selectedBuilding && selectedBuilding.properties?.NAME === d.properties?.NAME) {
         return [0, 0, 0, 150];
      }
      return [34, 197, 94, 80];
    },
    getLineColor: [21, 128, 61, 255],
    updateTriggers: {
      getFillColor: [selectedBuilding]
    },
    onClick: ({ object }) => {
      if (object && object.properties) {
        setSelectedBuilding({
          ...object,
          properties: { ...object.properties, ADDRESS: "Park / Reserve", _type: 'park' }
        });
      }
    }
  }), [parksData, activeLayers.parks, selectedBuilding]);

  const vegetationLayer = useMemo(() => new TileLayer({
    id: 'gee-vegetation-layer',
    data: geeTileUrl,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    visible: activeLayers.vegetation && geeTileUrl !== null,
    opacity: 0.6,
    renderSubLayers: props => {
      const { boundingBox } = props.tile;
      return new BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]]
      });
    }
  }), [geeTileUrl, activeLayers.vegetation]);

  const footTrafficLayer = new TripsLayer({
    id: 'foot-traffic-layer',
    data: trafficData.foot,
    getPath: d => d.path,
    getTimestamps: d => d.timestamps,
    getColor: [59, 130, 246], // Blue pulse
    opacity: 0.8,
    widthMinPixels: 4,
    jointRounded: true,
    capRounded: true,
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
    jointRounded: true,
    capRounded: true,
    trailLength: 300,
    currentTime: time,
    shadowEnabled: false,
    visible: activeLayers.vehicleTraffic
  });

  const sandboxLayers = createSandboxLayers(placedModels, activeLayers.sandbox, setPlacedModels, selectedModelId);

  return (
    <DeckGL
      ref={deckRef}
      initialViewState={viewState}
      onViewStateChange={({ viewState }) => setViewState(viewState)}
      controller={!isPlacing}
      onClick={isPlacing ? handleMapClick : undefined}
      getCursor={() => isPlacing ? 'crosshair' : 'grab'}
      useDevicePixels={window.devicePixelRatio > 1 ? 1.5 : true}
      _glOptions={{ preserveDrawingBuffer: true }}
      layers={[
        cartoBasemapLayer,
        google3DTilesLayer,
        vegetationLayer,
        uraLayer,
        historicSitesLayer,
        touristAttractionsLayer,
        parksLayer,
        footTrafficLayer,
        vehicleTrafficLayer,
        ...sandboxLayers
      ].filter(Boolean)}
      parameters={{ clearColor: [0.95, 0.95, 0.95, 1] }}
      effects={[lightingEffect]}
    />
  );
});

export default MapCanvas;
