import proj4 from 'proj4';

const EPSG_3414 = 'EPSG:3414';
const WGS84 = 'EPSG:4326';
const SINGAPORE_BOUNDS = {
  west: 103.55,
  east: 104.1,
  south: 1.15,
  north: 1.5,
};

proj4.defs(
  EPSG_3414,
  '+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs'
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeToFeatureCollection(input) {
  if (input?.type === 'FeatureCollection') return clone(input);
  if (input?.type === 'Feature') {
    return { type: 'FeatureCollection', features: [clone(input)] };
  }
  if (input?.type && input?.coordinates) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: clone(input) }],
    };
  }
  throw new Error('Unsupported GeoJSON payload. Please upload a valid GeoJSON FeatureCollection, Feature, or Geometry.');
}

function validateCRS(crs) {
  if (!crs) return;
  const crsName = String(crs?.properties?.name || crs?.name || '').toUpperCase();
  if (!crsName) return;
  if (!crsName.includes('3414')) {
    throw new Error('This overlay only accepts Singapore EPSG:3414 GeoJSON.');
  }
}

function transformCoordinate(coord, stats) {
  if (!Array.isArray(coord) || coord.length < 2) {
    throw new Error('Encountered an invalid coordinate while reading the GeoJSON file.');
  }

  const [lng, lat] = proj4(EPSG_3414, WGS84, [coord[0], coord[1]]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('Failed to transform one or more coordinates from EPSG:3414.');
  }

  stats.minLng = Math.min(stats.minLng, lng);
  stats.maxLng = Math.max(stats.maxLng, lng);
  stats.minLat = Math.min(stats.minLat, lat);
  stats.maxLat = Math.max(stats.maxLat, lat);

  if (
    lng < SINGAPORE_BOUNDS.west ||
    lng > SINGAPORE_BOUNDS.east ||
    lat < SINGAPORE_BOUNDS.south ||
    lat > SINGAPORE_BOUNDS.north
  ) {
    stats.outOfSingaporeCount += 1;
  }

  return coord.length > 2 ? [lng, lat, coord[2]] : [lng, lat];
}

function transformCoordinates(coordinates, stats) {
  if (!Array.isArray(coordinates)) {
    throw new Error('Encountered malformed coordinates in the uploaded GeoJSON.');
  }

  if (typeof coordinates[0] === 'number') {
    return transformCoordinate(coordinates, stats);
  }

  return coordinates.map((entry) => transformCoordinates(entry, stats));
}

function summarizeGeometryTypes(features) {
  return [...new Set(features.map((feature) => feature.geometry?.type).filter(Boolean))];
}

export function normalizeSingaporeGeoJson(input, fileName = 'Uploaded GeoJSON') {
  validateCRS(input?.crs);
  const featureCollection = normalizeToFeatureCollection(input);

  const stats = {
    minLng: Infinity,
    maxLng: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
    outOfSingaporeCount: 0,
  };

  const features = featureCollection.features.map((feature, index) => {
    if (!feature?.geometry?.type || feature.geometry.coordinates === undefined && feature.geometry.type !== 'GeometryCollection') {
      throw new Error(`Feature ${index + 1} is missing a valid geometry.`);
    }

    let geometry;
    if (feature.geometry.type === 'GeometryCollection') {
      geometry = {
        ...feature.geometry,
        geometries: feature.geometry.geometries.map((geometryEntry) => ({
          ...geometryEntry,
          coordinates: transformCoordinates(geometryEntry.coordinates, stats),
        })),
      };
    } else {
      geometry = {
        ...feature.geometry,
        coordinates: transformCoordinates(feature.geometry.coordinates, stats),
      };
    }

    return {
      ...feature,
      properties: feature.properties || {},
      geometry,
    };
  });

  if (!features.length) {
    throw new Error('The uploaded GeoJSON does not contain any features.');
  }

  if (!Number.isFinite(stats.minLng) || !Number.isFinite(stats.minLat)) {
    throw new Error('The uploaded GeoJSON did not produce any valid Singapore coordinates.');
  }

  if (stats.outOfSingaporeCount > 0) {
    throw new Error('The uploaded GeoJSON contains coordinates outside Singapore after EPSG:3414 transformation.');
  }

  return {
    data: {
      type: 'FeatureCollection',
      features,
    },
    meta: {
      fileName,
      featureCount: features.length,
      geometryTypes: summarizeGeometryTypes(features),
      bounds: [
        [stats.minLng, stats.minLat],
        [stats.maxLng, stats.maxLat],
      ],
      crs: 'EPSG:3414 (SVY21 / Singapore TM)',
    },
  };
}

