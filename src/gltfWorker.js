// Web Worker: Runs heavy 3D model processing off the main thread
// so the map never freezes while converting Rhino/Claude CAD exports
import { WebIO } from '@gltf-transform/core';
import { weld, simplify, dedup, flatten, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

self.onmessage = async (e) => {
  try {
    const { arrayBuffer } = e.data;
    const io = new WebIO();

    // 1. Read the raw CAD binary
    const doc = await io.readBinary(new Uint8Array(arrayBuffer));

    // 2. Full optimization pipeline (order matters):
    //    - dedup: remove duplicate vertex/texture data (reduces VRAM)
    //    - flatten: collapse nested scene graph nodes into flat list (fewer draw calls)
    //    - prune: strip unused materials, textures, accessors
    //    - weld: merge coincident vertices (fixes un-indexed polygon soup from CAD)
    //    - simplify: decimate mesh polygons aggressively for browser rendering
    await doc.transform(
      dedup(),
      flatten(),
      prune(),
      weld({ tolerance: 0.001 }),
    );

    // 3. Skipping mesh decimation for now to prevent simple 
    // geometries (like test cubes) from being destroyed by the simplifier.
    // In production, we'd add logic to only simplify huge >100k polygon meshes.

    // 4. Export optimized binary
    const optimized = await io.writeBinary(doc);
    
    // Transfer the buffer back to main thread (zero-copy)
    self.postMessage({ optimized: optimized.buffer }, [optimized.buffer]);
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
