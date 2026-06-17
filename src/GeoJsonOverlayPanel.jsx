import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Layers2, LoaderCircle, MapPinned, Sparkles, Trash2, Upload } from 'lucide-react';

function renderValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildDefaultParams(operation) {
  return Object.fromEntries((operation?.params || []).map((param) => [param.id, param.default]));
}

function featureFieldHints(layer) {
  const metaOptions = layer?.meta?.fieldOptions?.all;
  if (Array.isArray(metaOptions) && metaOptions.length) return metaOptions.slice(0, 12);
  if (!layer?.data?.features?.length) return [];
  const fields = new Set();
  layer.data.features.slice(0, 8).forEach((feature) => {
    Object.keys(feature.properties || {}).forEach((key) => fields.add(key));
  });
  return [...fields].slice(0, 8);
}

function semanticFieldOptions(layer, purpose = 'all') {
  const options = layer?.meta?.fieldOptions?.[purpose];
  if (Array.isArray(options) && options.length) return options;
  return featureFieldHints(layer);
}

function resolveFieldOptions(param, sourceLayer, targetLayer) {
  if (param.type !== 'field-select') return [];
  const layer = param.fieldSource === 'target' ? targetLayer : sourceLayer;
  const hints = semanticFieldOptions(layer, param.fieldPurpose || 'all');
  const options = hints.map((field) => ({ value: field, label: field }));
  if (param.allowEmpty) {
    options.unshift({ value: '', label: param.emptyLabel || 'None' });
  }
  return options;
}

function geometryFamily(layer) {
  const types = layer?.meta?.geometryTypes || [];
  if (types.some((type) => type.includes('Polygon'))) return 'polygon';
  if (types.some((type) => type.includes('Line'))) return 'line';
  if (types.some((type) => type.includes('Point'))) return 'point';
  return 'other';
}

function geometryRoleLabel(layer) {
  const family = geometryFamily(layer);
  if (family === 'polygon') return 'Area';
  if (family === 'point') return 'Point';
  if (family === 'line') return 'Line';
  return 'Layer';
}

function layerOptionLabel(layer) {
  return `${layer.meta.fileName} · ${geometryRoleLabel(layer)}`;
}

function compareFeatureCountDescending(left, right) {
  return (right?.meta?.featureCount || 0) - (left?.meta?.featureCount || 0);
}

function compareFeatureCountAscending(left, right) {
  return (left?.meta?.featureCount || 0) - (right?.meta?.featureCount || 0);
}

function suggestLayerPair(layers, operationId) {
  const nonAnalysisLayers = layers.filter((layer) => layer.kind !== 'analysis');
  const pool = nonAnalysisLayers.length ? nonAnalysisLayers : layers;
  const ordered = [...pool].sort(compareFeatureCountDescending);
  const fallbackSource = ordered[0] || null;
  const fallbackTarget = ordered.find((layer) => layer.id !== fallbackSource?.id) || fallbackSource;

  if (!fallbackSource) {
    return { sourceLayerId: '', targetLayerId: '' };
  }

  if (operationId === 'nearest_distance' || operationId === 'count_within') {
    const polygonSource = [...pool]
      .filter((layer) => geometryFamily(layer) === 'polygon')
      .sort(compareFeatureCountDescending)[0];
    const lineSource = [...pool]
      .filter((layer) => geometryFamily(layer) === 'line')
      .sort(compareFeatureCountDescending)[0];
    const source = polygonSource || lineSource || fallbackSource;
    const pointTarget = [...pool]
      .filter((layer) => layer.id !== source.id && geometryFamily(layer) === 'point')
      .sort(compareFeatureCountAscending)[0];
    const polygonTarget = [...pool]
      .filter((layer) => layer.id !== source.id && geometryFamily(layer) === 'polygon')
      .sort(compareFeatureCountAscending)[0];
    const target = pointTarget || polygonTarget || fallbackTarget;
    return {
      sourceLayerId: source.id,
      targetLayerId: target?.id || source.id,
    };
  }

  if (operationId === 'clip' || operationId === 'intersection' || operationId === 'difference') {
    const polygonLayers = [...pool]
      .filter((layer) => geometryFamily(layer) === 'polygon')
      .sort(compareFeatureCountDescending);
    const source = polygonLayers[0] || fallbackSource;
    const target = polygonLayers.find((layer) => layer.id !== source.id) || fallbackTarget;
    return {
      sourceLayerId: source.id,
      targetLayerId: target?.id || source.id,
    };
  }

  return {
    sourceLayerId: fallbackSource.id,
    targetLayerId: fallbackTarget?.id || fallbackSource.id,
  };
}

export default function GeoJsonOverlayPanel({
  uploadedLayers,
  selectedFeature,
  uploadError,
  synthesisError,
  synthesisBusy,
  operations,
  pyqgisScript,
  onUpload,
  onToggleLayer,
  onRemoveLayer,
  onRunSynthesis,
  onGeneratePyQgis,
  onCopyPyQgis,
}) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const previousOperationRef = useRef('');
  const [analysisState, setAnalysisState] = useState({
    sourceLayerId: '',
    targetLayerId: '',
    operation: '',
    params: {},
  });

  const selectedOperation = useMemo(
    () => operations.find((entry) => entry.id === analysisState.operation) || operations[0] || null,
    [analysisState.operation, operations]
  );

  useEffect(() => {
    if (!operations.length) return;
    setAnalysisState((prev) => {
      const operation = prev.operation || operations[0].id;
      const resolved = operations.find((entry) => entry.id === operation) || operations[0];
      return {
        ...prev,
        operation: resolved.id,
        params: Object.keys(prev.params || {}).length ? prev.params : buildDefaultParams(resolved),
      };
    });
  }, [operations]);

  useEffect(() => {
    if (!selectedOperation) return;
    setAnalysisState((prev) => ({
      ...prev,
      params: buildDefaultParams(selectedOperation),
    }));
  }, [selectedOperation?.id]);

  useEffect(() => {
    if (!uploadedLayers.length || !selectedOperation) return;
    const operationChanged = previousOperationRef.current !== selectedOperation.id;
    previousOperationRef.current = selectedOperation.id;

    setAnalysisState((prev) => {
      const validLayerIds = new Set(uploadedLayers.map((layer) => layer.id));
      const sourceValid = validLayerIds.has(prev.sourceLayerId);
      const targetValid = validLayerIds.has(prev.targetLayerId);
      const duplicatePairing = selectedOperation.requiresTarget
        && uploadedLayers.length > 1
        && prev.sourceLayerId
        && prev.sourceLayerId === prev.targetLayerId;
      if (!operationChanged && sourceValid && (!selectedOperation.requiresTarget || targetValid) && !duplicatePairing) {
        return prev;
      }

      const suggested = suggestLayerPair(uploadedLayers, selectedOperation.id);
      return {
        ...prev,
        sourceLayerId: suggested.sourceLayerId || prev.sourceLayerId || uploadedLayers[0].id,
        targetLayerId: selectedOperation.requiresTarget
          ? (suggested.targetLayerId || prev.targetLayerId || uploadedLayers[1]?.id || uploadedLayers[0].id)
          : prev.targetLayerId,
      };
    });
  }, [uploadedLayers, selectedOperation]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer?.files || []);
    onUpload(files);
  }, [onUpload]);

  const handleFileInputChange = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    onUpload(files);
    event.target.value = '';
  }, [onUpload]);

  const updateParam = useCallback((paramId, value, type) => {
    setAnalysisState((prev) => ({
      ...prev,
      params: {
        ...prev.params,
        [paramId]: type === 'number'
          ? Number(value)
          : type === 'boolean'
            ? Boolean(value)
            : value,
      },
    }));
  }, []);

  const canRunSynthesis = selectedOperation
    && analysisState.sourceLayerId
    && (!selectedOperation.requiresTarget || analysisState.targetLayerId);

  const activeSourceLayer = uploadedLayers.find((layer) => layer.id === analysisState.sourceLayerId);
  const activeTargetLayer = uploadedLayers.find((layer) => layer.id === analysisState.targetLayerId);

  const sourceHints = featureFieldHints(activeSourceLayer);
  const targetHints = featureFieldHints(activeTargetLayer);
  const targetSemanticLabels = semanticFieldOptions(activeTargetLayer, 'label');
  const sourceSemanticDissolve = semanticFieldOptions(activeSourceLayer, 'dissolve');
  const featureProperties = selectedFeature?.properties
    ? Object.entries(selectedFeature.properties).slice(0, 12)
    : [];
  const nearestDistanceHint = selectedOperation?.id === 'nearest_distance'
    ? `Nearest distance reads from the source layer into the target layer. For subzone-to-MRT analysis, use the subzone area as Source and the MRT or station layer as Target.`
    : '';

  useEffect(() => {
    if (!selectedOperation) return;
    setAnalysisState((prev) => {
      const nextParams = { ...prev.params };
      let changed = false;

      (selectedOperation.params || []).forEach((param) => {
        if (param.type !== 'field-select') return;
        const options = resolveFieldOptions(param, activeSourceLayer, activeTargetLayer);
        const allowedValues = new Set(options.map((option) => option.value));
        const currentValue = nextParams[param.id] ?? param.default ?? '';
        if (!allowedValues.size) {
          if (currentValue !== '') {
            nextParams[param.id] = '';
            changed = true;
          }
          return;
        }
        if (!allowedValues.has(currentValue)) {
          nextParams[param.id] = options[0]?.value ?? '';
          changed = true;
        }
      });

      return changed ? { ...prev, params: nextParams } : prev;
    });
  }, [selectedOperation, activeSourceLayer, activeTargetLayer]);

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-serif text-[11px] font-semibold uppercase tracking-widest text-black">Analysis Layers</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Singapore EPSG:3414 synthesis + Warm Editorial theme</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          {uploadedLayers.length} layer{uploadedLayers.length === 1 ? '' : 's'}
        </span>
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
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
        <Upload size={18} className="mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-600 font-medium">Drop one or more Singapore GeoJSON files here</p>
        <p className="text-[11px] text-gray-400 mt-1">Uploaded layers are normalized for map display and synthesis runs in EPSG:3414.</p>
      </div>

      {(uploadError || synthesisError) && (
        <div className="mt-3 space-y-2">
          {uploadError && (
            <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{uploadError}</div>
          )}
          {synthesisError && (
            <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{synthesisError}</div>
          )}
        </div>
      )}

      {!!uploadedLayers.length && (
        <div className="mt-3 space-y-3">
          {uploadedLayers.map((layer, index) => (
            <div key={layer.id} className="border border-gray-200 bg-gray-50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-black">{layer.meta.fileName}</p>
                  <p className="text-[11px] text-gray-500">
                    {layer.meta.featureCount} features · {layer.meta.geometryTypes.join(', ')}
                  </p>
                  <p className="text-[11px] text-gray-400">{layer.meta.crs}</p>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {layer.kind === 'analysis' ? 'Derived analysis layer' : 'Uploaded source layer'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onToggleLayer(layer.id)}
                    className={`w-8 h-4 rounded-full flex items-center p-0.5 ${layer.active ? 'bg-black' : 'bg-gray-300'}`}
                    aria-label={`Toggle ${layer.meta.fileName}`}
                  >
                    <div className={`w-3 h-3 bg-white rounded-full transition-transform ${layer.active ? 'translate-x-4' : ''}`} />
                  </button>
                  <button
                    onClick={() => onRemoveLayer(layer.id)}
                    className="text-gray-400 hover:text-red-600 transition-colors"
                    aria-label={`Remove ${layer.meta.fileName}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-gray-600 flex items-start gap-2">
                <MapPinned size={14} className="mt-0.5 shrink-0" />
                <span>
                  Styled as {layer.style?.role || 'categorical_poly'} with the Warm Editorial palette.
                  {index === 0 ? ' Use these layers as source/target inputs below.' : ''}
                </span>
              </div>

              {layer.kind === 'analysis' && layer.style?.choropleth && (
                <div className="text-[11px] text-[#7A1F12]">
                  Thematic result: {layer.style.choropleth.title} using {layer.style.choropleth.method} classes.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!!uploadedLayers.length && !!selectedOperation && (
        <div className="mt-4 border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <p className="font-serif text-[11px] font-semibold uppercase tracking-widest text-black flex items-center gap-2">
              <Sparkles size={14} />
              Singapore Synthesis
            </p>
            <p className="text-[11px] text-gray-500 mt-1">{selectedOperation.description}</p>
          </div>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Source Layer</span>
            <select
              value={analysisState.sourceLayerId}
              onChange={(event) => setAnalysisState((prev) => ({ ...prev, sourceLayerId: event.target.value }))}
              className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {uploadedLayers.map((layer) => (
                <option key={layer.id} value={layer.id}>{layerOptionLabel(layer)}</option>
              ))}
            </select>
            {selectedOperation.id === 'nearest_distance' && (
              <p className="mt-1 text-[11px] text-gray-400">Current source role: {geometryRoleLabel(activeSourceLayer)} layer to be classified.</p>
            )}
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Operation</span>
            <select
              value={analysisState.operation}
              onChange={(event) => setAnalysisState((prev) => ({ ...prev, operation: event.target.value }))}
              className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {operations.map((operation) => (
                <option key={operation.id} value={operation.id}>{operation.label}</option>
              ))}
            </select>
          </label>

          {selectedOperation.requiresTarget && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">Target Layer</span>
              <select
                value={analysisState.targetLayerId}
                onChange={(event) => setAnalysisState((prev) => ({ ...prev, targetLayerId: event.target.value }))}
                className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                {uploadedLayers
                  .filter((layer) => layer.id !== analysisState.sourceLayerId || uploadedLayers.length === 1)
                  .map((layer) => (
                    <option key={layer.id} value={layer.id}>{layerOptionLabel(layer)}</option>
                  ))}
              </select>
              {nearestDistanceHint && (
                <p className="mt-1 text-[11px] text-gray-400">{nearestDistanceHint}</p>
              )}
            </label>
          )}

          {(selectedOperation.params || []).map((param) => {
            const fieldOptions = param.type === 'field-select'
              ? resolveFieldOptions(param, activeSourceLayer, activeTargetLayer)
              : [];
            return (
            <label key={param.id} className="block">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">{param.label}</span>
              {param.type === 'field-select' ? (
                <select
                  value={analysisState.params?.[param.id] ?? param.default ?? ''}
                  onChange={(event) => updateParam(param.id, event.target.value, 'text')}
                  className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
                  disabled={!fieldOptions.length}
                >
                  {fieldOptions.length ? (
                    fieldOptions.map((option) => (
                      <option key={`${param.id}-${option.value || 'empty'}`} value={option.value}>{option.label}</option>
                    ))
                  ) : (
                    <option value="">No fields available</option>
                  )}
                </select>
              ) : param.type === 'select' ? (
                <select
                  value={analysisState.params?.[param.id] ?? param.default}
                  onChange={(event) => updateParam(param.id, event.target.value, param.type)}
                  className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {param.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : param.type === 'boolean' ? (
                <select
                  value={String(Boolean(analysisState.params?.[param.id] ?? param.default))}
                  onChange={(event) => updateParam(param.id, event.target.value === 'true', param.type)}
                  className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : (
                <input
                  type={param.type === 'number' ? 'number' : 'text'}
                  value={analysisState.params?.[param.id] ?? param.default}
                  onChange={(event) => updateParam(param.id, event.target.value, param.type)}
                  className="mt-1 w-full border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              )}
              {param.type !== 'field-select' && param.id.includes('field') && (sourceHints.length || targetHints.length) && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Suggested fields: {[...new Set([...sourceHints, ...targetHints])].join(', ') || 'No sample attributes found'}
                </p>
              )}
              {param.type === 'field-select' && (
                <>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {param.fieldSource === 'target'
                      ? `Pulled from target layer attributes: ${targetHints.join(', ') || 'No sample attributes found'}`
                      : `Pulled from source layer attributes: ${sourceHints.join(', ') || 'No sample attributes found'}`}
                  </p>
                  {param.fieldPurpose === 'label' && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      Semantic filter keeps short scalar fields that behave well as readable labels.
                      Eligible target labels: {targetSemanticLabels.join(', ') || 'No suitable label fields detected'}.
                    </p>
                  )}
                  {param.fieldPurpose === 'dissolve' && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      Dissolve choices are limited to lower-cardinality scalar fields.
                      Eligible source fields: {sourceSemanticDissolve.join(', ') || 'No suitable dissolve fields detected'}.
                    </p>
                  )}
                </>
              )}
            </label>
            );
          })}

          <div className="flex gap-2">
            <button
              onClick={() => onRunSynthesis(analysisState)}
              disabled={!canRunSynthesis || synthesisBusy}
              className="flex-1 bg-black text-white px-3 py-2 text-xs uppercase tracking-widest font-semibold disabled:bg-gray-300 disabled:text-gray-500"
            >
              {synthesisBusy ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle size={14} className="animate-spin" />
                  Running
                </span>
              ) : 'Run Synthesis'}
            </button>
            <button
              onClick={() => onGeneratePyQgis(analysisState)}
              disabled={!canRunSynthesis}
              className="flex-1 border border-gray-300 bg-white px-3 py-2 text-xs uppercase tracking-widest font-semibold text-black disabled:text-gray-400"
            >
              PyQGIS Script
            </button>
          </div>
        </div>
      )}

      {pyqgisScript && (
        <div className="mt-4 border border-gray-200 bg-gray-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 flex items-center gap-2">
              <Layers2 size={13} />
              PyQGIS Template
            </p>
            <button
              onClick={onCopyPyQgis}
              className="text-[11px] text-gray-600 hover:text-black flex items-center gap-1"
            >
              <Copy size={13} />
              Copy
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-white border border-gray-200 p-3 text-[11px] text-gray-700">
            {pyqgisScript}
          </pre>
        </div>
      )}

      {selectedFeature && (
        <div className="mt-4 border border-gray-200 bg-gray-50 p-3">
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Selected Feature</p>
          <p className="text-xs font-semibold text-black mb-1">{selectedFeature.layerName || 'Layer Feature'}</p>
          <p className="text-[11px] text-gray-500 mb-2">{selectedFeature.geometryType || 'Feature'}</p>
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
  );
}
