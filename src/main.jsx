import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// NOTE: WebGPU adapter (@luma.gl/webgpu) was tested but conflicts with
// deck.gl v9's async device initialization. Keeping WebGL2 for stability.
// WebGPU can be re-enabled once deck.gl officially supports it.

createRoot(document.getElementById('root')).render(
  <App />
)
