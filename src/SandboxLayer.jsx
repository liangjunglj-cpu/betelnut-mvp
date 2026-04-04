import React, { useRef, useCallback, useState } from 'react';
import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import { GLTFLoader } from '@loaders.gl/gltf';
import { DracoLoader } from '@loaders.gl/draco';
import { Upload, Trash2, Loader } from 'lucide-react';

/**
 * Creates the deck.gl ScenegraphLayer for rendering placed 3D models on the map.
 * 
 * @param {Array} placedModels - Array of { id, name, modelUrl, position: [lng, lat, alt], rotation: [pitch, yaw, roll], scale }
 * @param {boolean} visible - Whether the sandbox layer is visible
 * @param {function} setPlacedModels - React state setter to update model positions on drag
 * @param {string} selectedModelId - ID of the currently selected model
 * @returns {Array<ScenegraphLayer>} An array of deck.gl layer instances
 */
export function createSandboxLayers(placedModels, visible, setPlacedModels, selectedModelId) {
  if (!visible) return [];
  
  // Group instances by unique blob URL to optimize rendering
  const groups = {};
  placedModels.forEach(m => {
    if (!groups[m.modelUrl]) groups[m.modelUrl] = [];
    groups[m.modelUrl].push(m);
  });

  return Object.entries(groups).map(([url, groupModels], index) => {
    return new ScenegraphLayer({
      id: `sandbox-model-${index}`,
      data: groupModels,
      scenegraph: url,
      loaders: [GLTFLoader, DracoLoader],
      getPosition: d => d.position,
      getOrientation: d => d.rotation,
      sizeScale: 1,
      getScale: d => [d.scale, d.scale, d.scale],
      
      // Material colors. Tint to light blue if selected, else pristine white to allow original PBR render to show through.
      getColor: d => d.id === selectedModelId ? [150, 200, 255, 255] : [255, 255, 255, 255],
      
      // Re-enable PBR lighting now that we added a LightingEffect to DeckGL in App.jsx
      _lighting: 'pbr',
      
      visible,
      pickable: true,
      autoHighlight: true,
      
      // PERFORMANCE: Only rebuild GPU buffers when data items are added/removed
      // (not on every drag move which just changes position values)
      dataComparator: (newData, oldData) => {
        if (newData.length !== oldData.length) return false;
        for (let i = 0; i < newData.length; i++) {
          if (newData[i].id !== oldData[i].id) return false;
        }
        return true;
      },
      
      // PERFORMANCE: Tell deck.gl exactly which accessors change on interaction
      // so it only updates the specific GPU attribute buffers, not all of them
      updateTriggers: {
        getPosition: groupModels.map(d => d.position.join(',')),
        getOrientation: groupModels.map(d => d.rotation.join(',')),
        getScale: groupModels.map(d => d.scale),
        getColor: [selectedModelId],
      },
      
      // Movement is now gumball-only (no free-drag on model)
      // Click to select, then use gumball arrows to transform
      onClick: (info) => {
        if (info.object && setPlacedModels) {
          // Dispatch a custom event so App.jsx can set selectedModelId
          window.dispatchEvent(new CustomEvent('sandbox-select', { detail: info.object.id }));
        }
      },
      parameters: {
        depthTest: true,
      },
    });
  });
}

/**
 * Sandbox Panel UI component — handles file upload, model list, and transform controls.
 */
export default function SandboxPanel({
  placedModels,
  setPlacedModels,
  selectedModelId,
  setSelectedModelId,
  pendingModelUrl,
  setPendingModelUrl,
  pendingModelName,
  setPendingModelName,
  isPlacing,
  setIsPlacing,
  onGenerateRender,
  isRendering,
  renderedImage,
  gridSize,
  setGridSize,
  updateModel,
}) {
  const fileInputRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Handle file upload — runs weld + simplify in a Web Worker off the main thread
  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['glb', 'gltf'].includes(ext)) {
      alert('Please upload a .glb or .gltf file');
      return;
    }
    
    // Show processing indicator
    setIsProcessing(true);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Spawn a Web Worker to run heavy gltf-transform processing off the main thread
      const worker = new Worker(new URL('./gltfWorker.js', import.meta.url), { type: 'module' });
      
      const optimizedGlb = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.error) {
            reject(new Error(e.data.error));
          } else {
            resolve(new Uint8Array(e.data.optimized));
          }
          worker.terminate();
        };
        worker.onerror = (e) => { reject(e); worker.terminate(); };
        worker.postMessage({ arrayBuffer }, [arrayBuffer]);
      });
      
      // Force the correct MIME type for the optimized binary
      const typedBlob = new Blob([optimizedGlb], { type: 'model/gltf-binary' });
      const blobUrl = URL.createObjectURL(typedBlob);
      
      const optimizedName = file.name.replace(/\.(glb|gltf)$/i, '_optimized.glb');
      
      setPendingModelUrl(blobUrl);
      setPendingModelName(optimizedName);
      setIsPlacing(true);
      
    } catch (err) {
      console.error("Worker processing failed, using raw file:", err);
      // Fallback: If worker fails, just load it natively
      const typedBlob = new Blob([file], { type: 'model/gltf-binary' });
      const blobUrl = URL.createObjectURL(typedBlob);
      
      setPendingModelUrl(blobUrl);
      setPendingModelName(file.name);
      setIsPlacing(true);
    } finally {
      setIsProcessing(false);
    }
  }, [setPendingModelUrl, setPendingModelName, setIsPlacing]);

  const loadTestCube = async () => {
    try {
      const res = await fetch('/test_cube.glb');
      const blob = await res.blob();
      const file = new File([blob], 'test_cube.glb', { type: 'model/gltf-binary' });
      handleFileUpload(file);
    } catch (err) {
      console.error('Test cube load failed:', err);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    handleFileUpload(file);
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    handleFileUpload(file);
    e.target.value = ''; // Reset so same file can be re-uploaded
  }, [handleFileUpload]);

  // Note: updateModel is now passed from App.jsx (centralized for Gumball + controls)

  // Remove a model
  const removeModel = useCallback((id) => {
    setPlacedModels(prev => {
      const model = prev.find(m => m.id === id);
      // Clean up the blob URL from memory if it's the last instance
      const isLastInstance = prev.filter(m => m.modelUrl === model?.modelUrl).length === 1;
      if (model && isLastInstance && model.modelUrl.startsWith('blob:')) {
        URL.revokeObjectURL(model.modelUrl);
      }
      return prev.filter(m => m.id !== id);
    });
    if (selectedModelId === id) setSelectedModelId(null);
  }, [setPlacedModels, selectedModelId, setSelectedModelId]);

  const selectedModel = placedModels.find(m => m.id === selectedModelId);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Upload Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-sm p-6 text-center cursor-pointer transition-all
          ${isPlacing
            ? 'border-green-500 bg-green-50'
            : 'border-gray-300 hover:border-black hover:bg-gray-50'
          }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={handleFileInputChange}
        />
        {isProcessing ? (
          <>
            <Loader size={24} className="mx-auto text-gray-500 mb-2 animate-spin" />
            <p className="text-sm text-gray-500 font-medium">Optimizing geometry...</p>
            <p className="text-xs text-gray-400">Welding vertices & decimating mesh</p>
          </>
        ) : isPlacing ? (
          <>
            <div className="text-green-600 font-semibold text-sm mb-1">
              📍 Click on the map to place: {pendingModelName}
            </div>
            <p className="text-xs text-green-500">Click anywhere on the map to position your model</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsPlacing(false);
                setPendingModelUrl(null);
                setPendingModelName(null);
              }}
              className="mt-2 text-xs text-red-500 hover:text-red-700 underline"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <Upload size={24} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600 font-medium">Drop a .glb file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <button onClick={(e) => { e.stopPropagation(); loadTestCube(); }} className="mt-4 bg-blue-500 text-white px-3 py-1 text-xs z-20 relative">Test Upload Cube</button>
          </>
        )}
      </div>

      {/* Placed Models List */}
      {placedModels.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">
            Placed Models ({placedModels.length})
          </h3>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {placedModels.map(model => (
              <div
                key={model.id}
                onClick={() => setSelectedModelId(model.id === selectedModelId ? null : model.id)}
                className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors border-l-2
                  ${model.id === selectedModelId
                    ? 'border-black bg-gray-100 text-black'
                    : 'border-transparent text-gray-600 hover:bg-gray-50'
                  }`}
              >
                <span className="truncate flex-1">{model.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeModel(model.id); }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transform Controls (for selected model) */}
      {selectedModel && (
        <div className="border-t border-gray-200 pt-3">
          <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-1">
            Transform: <span className="text-black">{selectedModel.name}</span>
          </h3>

          {/* Grid Size Selector */}
          <div className="mb-3">
            <label className="text-xs text-gray-500 mb-1 block">Grid Snap</label>
            <div className="flex gap-1">
              {[
                { label: 'Free', value: 0 },
                { label: '5m', value: 0.000045 },
                { label: '10m', value: 0.00009 },
                { label: '25m', value: 0.000225 },
                { label: '50m', value: 0.00045 },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setGridSize(opt.value)}
                  className={`px-2 py-1 text-[10px] uppercase tracking-wide border transition-colors
                    ${gridSize === opt.value
                      ? 'bg-black text-white border-black'
                      : 'bg-white text-gray-500 border-gray-300 hover:border-black'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Position Inputs */}
          <div className="space-y-2">
            <div>
              <label className="text-[10px] uppercase text-gray-400 tracking-wider">Position (lng, lat, alt)</label>
              <div className="flex gap-1 mt-1">
                <input type="number" step="0.0001"
                  value={selectedModel.position[0]?.toFixed(5) || 0}
                  onChange={e => updateModel(selectedModel.id, { position: [parseFloat(e.target.value), selectedModel.position[1], selectedModel.position[2]] })}
                  className="w-1/3 border border-gray-300 rounded px-1.5 py-1 text-xs outline-none focus:border-red-500"
                  style={{ borderLeftColor: '#E53935', borderLeftWidth: 3 }}
                />
                <input type="number" step="0.0001"
                  value={selectedModel.position[1]?.toFixed(5) || 0}
                  onChange={e => updateModel(selectedModel.id, { position: [selectedModel.position[0], parseFloat(e.target.value), selectedModel.position[2]] })}
                  className="w-1/3 border border-gray-300 rounded px-1.5 py-1 text-xs outline-none focus:border-green-600"
                  style={{ borderLeftColor: '#43A047', borderLeftWidth: 3 }}
                />
                <input type="number" step="1" min="0"
                  value={Math.round(selectedModel.position[2] || 0)}
                  onChange={e => updateModel(selectedModel.id, { position: [selectedModel.position[0], selectedModel.position[1], parseFloat(e.target.value) || 0] })}
                  className="w-1/3 border border-gray-300 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-500"
                  style={{ borderLeftColor: '#1E88E5', borderLeftWidth: 3 }}
                />
              </div>
            </div>

            {/* Compact Rotation Inputs */}
            <div>
              <label className="text-[10px] uppercase text-gray-400 tracking-wider">Rotation (pitch, yaw, roll)</label>
              <div className="flex gap-1 mt-1">
                {['Pitch', 'Yaw', 'Roll'].map((axis, i) => (
                  <input key={axis} type="number" step="5" min="-180" max="180"
                    value={selectedModel.rotation?.[i] || 0}
                    onChange={e => {
                      const newRot = [...(selectedModel.rotation || [0, 0, 0])];
                      newRot[i] = parseInt(e.target.value) || 0;
                      updateModel(selectedModel.id, { rotation: newRot });
                    }}
                    className="w-1/3 border border-gray-300 rounded px-1.5 py-1 text-xs outline-none focus:border-yellow-500"
                    title={axis}
                  />
                ))}
              </div>
              <div className="flex gap-1 mt-0.5">
                <span className="w-1/3 text-[9px] text-gray-400 text-center">P°</span>
                <span className="w-1/3 text-[9px] text-gray-400 text-center">Y°</span>
                <span className="w-1/3 text-[9px] text-gray-400 text-center">R°</span>
              </div>
            </div>

            {/* Scale Input */}
            <div>
              <label className="text-[10px] uppercase text-gray-400 tracking-wider">Scale</label>
              <input type="number" step="0.1" min="0.001"
                value={selectedModel.scale || 1}
                onChange={e => updateModel(selectedModel.id, { scale: parseFloat(e.target.value) || 1 })}
                className="w-full mt-1 border border-gray-300 rounded px-1.5 py-1 text-xs outline-none focus:border-black"
              />
            </div>
          </div>

          <p className="text-[10px] text-gray-400 mt-2 italic">
            💡 Drag the gumball arrows on the map for visual positioning
          </p>
        </div>
      )}

      {/* AI Render Section */}
      {placedModels.length > 0 && (
        <div className="border-t border-gray-200 pt-3 mt-auto">
          <button
            onClick={onGenerateRender}
            disabled={isRendering}
            className={`w-full py-3 px-4 flex items-center justify-center font-bold text-xs uppercase tracking-widest transition-all border
              ${isRendering
                ? 'bg-gray-300 text-gray-500 border-gray-300 cursor-wait'
                : 'bg-black text-white hover:bg-gray-800 border-black'
              }`}
          >
            {isRendering ? 'Generating Render...' : '✨ Generate AI Render'}
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Uses Gemini to create a photorealistic visualization of your placed models
          </p>

          {/* Rendered Image Preview */}
          {renderedImage && (
            <div className="mt-3">
              <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">AI Render Preview</h3>
              <img
                src={renderedImage}
                alt="AI Generated Render"
                className="w-full border border-gray-200 shadow-sm"
              />
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {placedModels.length === 0 && !isPlacing && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400">
          <p className="text-sm">No models placed yet</p>
          <p className="text-xs mt-1">Upload a GLB file to get started</p>
        </div>
      )}
    </div>
  );
}
