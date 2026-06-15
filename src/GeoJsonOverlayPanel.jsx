import React, { useRef, useState, useCallback } from 'react';
import { Upload, MapPinned, Trash2 } from 'lucide-react';

function renderValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function GeoJsonOverlayPanel({
  overlayMeta,
  selectedFeature,
  error,
  active,
  onToggle,
  onUpload,
  onClear,
}) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const file = event.dataTransfer?.files?.[0];
    onUpload(file);
  }, [onUpload]);

  const handleFileInputChange = useCallback((event) => {
    const file = event.target.files?.[0];
    onUpload(file);
    event.target.value = '';
  }, [onUpload]);

  const featureProperties = selectedFeature?.properties
    ? Object.entries(selectedFeature.properties).slice(0, 10)
    : [];

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-serif text-[11px] font-semibold uppercase tracking-widest text-black">GeoJSON Overlay</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Singapore EPSG:3414 or WGS84</p>
        </div>
        {overlayMeta && (
          <button
            onClick={onToggle}
            className={`w-8 h-4 rounded-full flex items-center p-0.5 ${active ? 'bg-black' : 'bg-gray-300'}`}
            aria-label="Toggle GeoJSON overlay"
          >
            <div className={`w-3 h-3 bg-white rounded-full transition-transform ${active ? 'translate-x-4' : ''}`} />
          </button>
        )}
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        className={`border border-dashed p-4 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-black bg-gray-50' : 'border-gray-300 hover:border-black hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".geojson,.json"
          className="hidden"
          onChange={handleFileInputChange}
        />
        <Upload size={18} className="mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-600 font-medium">Drop a Singapore GeoJSON file here</p>
        <p className="text-[11px] text-gray-400 mt-1">Source CRS is auto-detected between EPSG:3414 and WGS84.</p>
      </div>

      {error && (
        <div className="mt-3 border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {overlayMeta && (
        <div className="mt-3 border border-gray-200 bg-gray-50 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-black">{overlayMeta.fileName}</p>
              <p className="text-[11px] text-gray-500">{overlayMeta.featureCount} features · {overlayMeta.geometryTypes.join(', ')}</p>
              <p className="text-[11px] text-gray-400">{overlayMeta.crs}</p>
              {(overlayMeta.discardedCoordinateCount > 0 || overlayMeta.discardedFeatureCount > 0) && (
                <p className="text-[11px] text-amber-700 mt-1">
                  Skipped {overlayMeta.discardedCoordinateCount} coordinates and {overlayMeta.discardedFeatureCount} empty features outside Singapore.
                </p>
              )}
            </div>
            <button
              onClick={onClear}
              className="text-gray-400 hover:text-red-600 transition-colors"
              aria-label="Remove uploaded overlay"
            >
              <Trash2 size={16} />
            </button>
          </div>

          <div className="text-[11px] text-gray-600 flex items-start gap-2">
            <MapPinned size={14} className="mt-0.5 shrink-0" />
            <span>The uploaded layer is normalized into the map display CRS automatically.</span>
          </div>

          {selectedFeature && (
            <div className="border-t border-gray-200 pt-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Selected Feature</p>
              <p className="text-xs font-semibold text-black mb-2">{selectedFeature.geometryType || 'Feature'}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {featureProperties.length ? featureProperties.map(([key, value]) => (
                  <div key={key} className="text-[11px] text-gray-700 break-words">
                    <strong className="text-black">{key}:</strong> {renderValue(value)}
                  </div>
                )) : (
                  <p className="text-[11px] text-gray-500">This feature has no properties.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
