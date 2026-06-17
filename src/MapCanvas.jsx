import React, { useState, useEffect, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { Tile3DLayer, TileLayer, TripsLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core';
import { createSandboxLayers } from './SandboxLayer';
import { defaultLayerStyle, pickChoroplethColor } from './synthesisTheme';

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

function summarizeAnalysisTitle(layer) {
  const choropleth = layer?.style?.choropleth;
  if (choropleth?.title) return choropleth.title;
  return layer?.meta?.fileName || 'Analysis Layer';
}

function summarizeAnalysisSubtitle(layer) {
  const method = layer?.style?.choropleth?.method;
  const classCount = layer?.style?.choropleth?.breaks?.length;
  if (method && classCount) {
    return `${layer.meta.fileName} · ${method} ${classCount}`;
  }
  return layer?.meta?.analysis?.operation
    ? `${layer.meta.fileName} · ${layer.meta.analysis.operation}`
    : layer?.meta?.fileName || '';
}

function rgbaCss(color = []) {
  const [r = 0, g = 0, b = 0, a = 255] = color;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(255, a)) / 255})`;
}

const MapCanvas = React.memo(({
  viewState, setViewState, activeLayers, uraData, historicSitesData,
  trafficData, uploadedLayers, placedModels, setPlacedModels, selectedModelId,
  setSelectedBuilding, setSelectedGeoJsonFeature, selectedBuilding, isPlacing, handleDeckClick, deckRef
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
      if (object) {
        setSelectedGeoJsonFeature(null);
        setSelectedBuilding(object);
      }
    }
  }), [uraData, activeLayers.uraConservation, selectedBuilding, setSelectedBuilding, setSelectedGeoJsonFeature]);

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
        setSelectedGeoJsonFeature(null);
        const name = object.properties.NAME || object.properties.Name || object.properties.name || 'Historic Site';
        const desc = object.properties.DESCRIPTION || object.properties.Description || object.properties.description || '';
        setSelectedBuilding({
          ...object,
          properties: { ...object.properties, NAME: name, ADDRESS: desc, _type: 'historic-site' }
        });
      }
    }
  }), [historicSitesData, activeLayers.historicSites, setSelectedBuilding, setSelectedGeoJsonFeature]);

  const uploadedGeoJsonLayers = useMemo(() => uploadedLayers.map((layer, index) => {
    const fallbackStyle = defaultLayerStyle(layer.style?.role || 'categorical_poly', index);
    const resolvedStyle = {
      ...fallbackStyle,
      ...(layer.style || {}),
    };
    const isAnalysisLayer = layer.kind === 'analysis';

    return new GeoJsonLayer({
      id: `uploaded-geojson-layer-${layer.id}`,
      data: layer.data,
      visible: layer.active,
      pickable: true,
      autoHighlight: true,
      stroked: true,
      filled: true,
      lineWidthMinPixels: Math.max(isAnalysisLayer ? 1.6 : 1.2, resolvedStyle.lineWidth || 1.4),
      pointRadiusMinPixels: 6,
      pointRadiusMaxPixels: 10,
      material: false,
      opacity: isAnalysisLayer ? 0.96 : 0.9,
      getFillColor: (feature) => pickChoroplethColor(feature.properties, resolvedStyle),
      getLineColor: resolvedStyle.lineColor || fallbackStyle.lineColor,
      getPointRadius: 8,
      getPointFillColor: resolvedStyle.pointColor || resolvedStyle.fillColor || fallbackStyle.pointColor,
      onClick: ({ object }) => {
        if (!object) return;
        setSelectedBuilding(null);
        setSelectedGeoJsonFeature({
          layerId: layer.id,
          layerName: layer.meta.fileName,
          geometryType: object.geometry?.type || 'Feature',
          properties: object.properties || {},
        });
      }
    });
  }), [uploadedLayers, setSelectedBuilding, setSelectedGeoJsonFeature]);

  const activeAnalysisLayer = useMemo(
    () => [...uploadedLayers].filter((layer) => layer.active && layer.kind === 'analysis').at(-1) || null,
    [uploadedLayers]
  );

  const activeAnalysisLegend = useMemo(() => {
    const choropleth = activeAnalysisLayer?.style?.choropleth;
    if (!choropleth?.field || !Array.isArray(choropleth.colors) || !choropleth.colors.length) {
      return null;
    }

    return {
      title: summarizeAnalysisTitle(activeAnalysisLayer),
      subtitle: summarizeAnalysisSubtitle(activeAnalysisLayer),
      field: choropleth.field,
      entries: choropleth.colors.map((color, index) => ({
        color,
        label: choropleth.labels?.[index] || `Class ${index + 1}`,
      })),
    };
  }, [activeAnalysisLayer]);

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
    <>
      <DeckGL
        ref={deckRef}
        initialViewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
        controller={!isPlacing}
        getCursor={() => isPlacing ? 'crosshair' : 'grab'}
        useDevicePixels={window.devicePixelRatio > 1 ? 1.5 : true}
        _glOptions={{ preserveDrawingBuffer: true }}
        layers={[
          cartoBasemapLayer,
          google3DTilesLayer,
          ...uploadedGeoJsonLayers,
          uraLayer,
          historicSitesLayer,
          footTrafficLayer,
          vehicleTrafficLayer,
          ...sandboxLayers
        ].filter(Boolean)}
        parameters={{ clearColor: [0.95, 0.95, 0.95, 1] }}
        effects={[lightingEffect]}
        onClick={handleDeckClick}
      />

      {activeAnalysisLayer && (
        <div className="pointer-events-none absolute top-6 left-[22rem] z-10 max-w-xl">
          <div className="border border-[#d8ccb8] bg-[#F7F1E6]/95 px-4 py-3 shadow-sm backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#7A1F12]">Active Analysis Layer</p>
            <h3 className="mt-1 font-serif text-lg text-[#33291F]">{summarizeAnalysisTitle(activeAnalysisLayer)}</h3>
            <p className="mt-1 text-xs text-[#6d6153]">{summarizeAnalysisSubtitle(activeAnalysisLayer)}</p>
          </div>
        </div>
      )}

      {activeAnalysisLegend && (
        <div className="pointer-events-none absolute bottom-6 left-[22rem] z-10 w-64">
          <div className="border border-[#d8ccb8] bg-[#F7F1E6]/96 p-4 shadow-sm backdrop-blur-sm">
            <p className="font-serif text-sm text-[#33291F]">{activeAnalysisLegend.title}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#6d6153]">
              {activeAnalysisLegend.field.replace(/_/g, ' ')}
            </p>
            <div className="mt-3 space-y-2">
              {activeAnalysisLegend.entries.map((entry, index) => (
                <div key={`${activeAnalysisLegend.field}-${index}`} className="flex items-center gap-3 text-xs text-[#33291F]">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-[#8e7c67]"
                    style={{ backgroundColor: rgbaCss(entry.color) }}
                  />
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default MapCanvas;
