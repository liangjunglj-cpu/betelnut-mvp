/**
 * RenderCapture — captures the deck.gl viewport as a screenshot and sends it
 * to the backend for AI image generation via Gemini Nano Banana 2.
 */

/**
 * Captures the current deck.gl canvas as a base64 PNG string.
 * 
 * @returns {string|null} Base64 data URL of the canvas, or null if canvas not found
 */
export function captureViewport() {
  // deck.gl renders to a canvas element — find it in the DOM
  const canvas = document.querySelector('#deckgl-overlay canvas') 
    || document.querySelector('canvas');
  
  if (!canvas) {
    console.error('Could not find deck.gl canvas for screenshot');
    return null;
  }

  try {
    // Capture as PNG data URL
    // NOTE: This requires preserveDrawingBuffer: true on the DeckGL component
    const dataUrl = canvas.toDataURL('image/png');
    
    // Check if the capture is actually valid (not just a transparent rectangle)
    if (dataUrl.length < 100) {
      console.warn('Canvas capture returned empty image — drawing buffer may not be preserved');
      return null;
    }
    
    return dataUrl;
  } catch (err) {
    console.error(
      'Failed to capture canvas. This is usually because Google 3D tiles taint the canvas with cross-origin pixels.\n' +
      'Try disabling Google 3D Context before generating the AI render, or use the CARTO basemap instead.\n',
      err
    );
    return null;
  }
}

/**
 * Builds a contextual prompt for the AI render based on the current scene state.
 * 
 * @param {Object} params
 * @param {Object|null} params.selectedBuilding - The currently selected URA building
 * @param {Array} params.placedModels - Array of placed 3D models
 * @param {Object} params.viewState - Current map view state (zoom, pitch, bearing)
 * @returns {string} The generated prompt
 */
export function buildRenderPrompt({ selectedBuilding, placedModels, viewState }) {
  const modelCount = placedModels.length;
  const modelNames = placedModels.map(m => m.name).join(', ');
  
  const address = selectedBuilding?.properties?.ADDRESS || 'Singapore urban area';
  const siteId = selectedBuilding?.properties?.INC_CRC || '';
  
  const isAerial = (viewState?.pitch || 0) < 30;
  const viewAngle = isAerial ? 'aerial/bird\'s-eye view' : 'street-level perspective';

  return [
    `Transform this map screenshot into a photorealistic architectural visualization.`,
    `The scene shows ${modelCount} proposed building${modelCount > 1 ? 's' : ''} (${modelNames}) placed at ${address}${siteId ? ` (Site: ${siteId})` : ''}.`,
    `Render the proposed structures as modern, completed buildings that blend naturally with the surrounding urban context.`,
    `Maintain the ${viewAngle} camera angle from the screenshot.`,
    `Include realistic tropical vegetation, shadows, sky, and ambient lighting typical of Singapore.`,
    `The surrounding buildings and roads should remain photorealistic — only enhance, do not remove existing context.`,
    `Style: professional architectural visualization, high detail, natural lighting.`
  ].join(' ');
}

/**
 * Sends the captured viewport and prompt to the backend for AI rendering.
 * 
 * @param {string} imageBase64 - Base64 data URL of the viewport screenshot
 * @param {string} prompt - The text prompt for the AI
 * @returns {Object} { status, rendered_image_base64 } or throws error
 */
export async function requestAIRender(imageBase64, prompt) {
  // Strip the data URL prefix to send raw base64
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch('/api/generate-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_base64: base64Data,
      prompt: prompt,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Server error: ${response.status}`);
  }

  return response.json();
}
