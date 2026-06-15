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

function isWithinSingapore(lng, lat) {
  return !(
    lng < SINGAPORE_BOUNDS.west ||
    lng > SINGAPORE_BOUNDS.east ||
    lat < SINGAPORE_BOUNDS.south ||
    lat > SINGAPORE_BOUNDS.north
  );
}

function trackCoordinate(lng, lat, stats) {
  stats.keptCoordinateCount += 1;
  stats.minLng = Math.min(stats.minLng, lng);
  stats.maxLng = Math.max(stats.maxLng, lng);
  stats.minLat = Math.min(stats.minLat, lat);
  stats.maxLat = Math.max(stats.maxLat, lat);
}

function transformCoordinate(coord, stats) {
  if (!Array.isArray(coord) || coord.length < 2) {
    throw new Error('Encountered an invalid coordinate while reading the GeoJSON file.');
  }

  const [lng, lat] = proj4(EPSG_3414, WGS84, [coord[0], coord[1]]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('Failed to transform one or more coordinates from EPSG:3414.');
  }

  if (!isWithinSingapore(lng, lat)) {
    stats.discardedCoordinateCount += 1;
    return null;
  }

  trackCoordinate(lng, lat, stats);
  return coord.length > 2 ? [lng, lat, coord[2]] : [lng, lat];
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [...first]];
}

function pruneGeometry(geometry, stats) {
  if (!geometry?.type) {
    throw new Error('Encountered a geometry without a valid type in the uploaded GeoJSON.');
  }

  switch (geometry.type) {
    case 'Point': {
      const coordinate = transformCoordinate(geometry.coordinates, stats);
      return coordinate ? { ...geometry, coordinates: coordinate } : null;
    }
    case 'MultiPoint': {
      const coordinates = geometry.coordinates
        .map((coordinate) => transformCoordinate(coordinate, stats))
        .filter(Boolean);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'LineString': {
      const coordinates = geometry.coordinates
        .map((coordinate) => transformCoordinate(coordinate, stats))
        .filter(Boolean);
      return coordinates.length >= 2 ? { ...geometry, coordinates } : null;
    }
    case 'MultiLineString': {
      const coordinates = geometry.coordinates
        .map((line) => line.map((coordinate) => transformCoordinate(coordinate, stats)).filter(Boolean))
        .filter((line) => line.length >= 2);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'Polygon': {
      const coordinates = geometry.coordinates
        .map((ring) => ring.map((coordinate) => transformCoordinate(coordinate, stats)).filter(Boolean))
        .map((ring) => closeRing(ring))
        .filter((ring) => ring.length >= 4);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'MultiPolygon': {
      const coordinates = geometry.coordinates
        .map((polygon) => polygon
          .map((ring) => ring.map((coordinate) => transformCoordinate(coordinate, stats)).filter(Boolean))
          .map((ring) => closeRing(ring))
          .filter((ring) => ring.length >= 4)
        )
        .filter((polygon) => polygon.length);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'GeometryCollection': {
      const geometries = geometry.geometries
        .map((entry) => pruneGeometry(entry, stats))
        .filter(Boolean);
      return geometries.length ? { ...geometry, geometries } : null;
    }
    default:
      throw new Error(`Unsupported geometry type "${geometry.type}" in the uploaded GeoJSON.`);
  }
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
    keptCoordinateCount: 0,
    discardedCoordinateCount: 0,
    discardedFeatureCount: 0,
  };

  const features = featureCollection.features.map((feature, index) => {
    if (!feature?.geometry?.type || feature.geometry.coordinates === undefined && feature.geometry.type !== 'GeometryCollection') {
      throw new Error(`Feature ${index + 1} is missing a valid geometry.`);
    }

    const geometry = pruneGeometry(feature.geometry, stats);
    if (!geometry) {
      stats.discardedFeatureCount += 1;
      return null;
    }

    return {
      ...feature,
      properties: feature.properties || {},
      geometry,
    };
  }).filter(Boolean);

  if (!features.length) {
    throw new Error('The uploaded GeoJSON did not contain any geometry inside Singapore after EPSG:3414 transformation.');
  }

  if (!Number.isFinite(stats.minLng) || !Number.isFinite(stats.minLat)) {
    throw new Error('The uploaded GeoJSON did not produce any valid Singapore coordinates.');
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
      discardedCoordinateCount: stats.discardedCoordinateCount,
      discardedFeatureCount: stats.discardedFeatureCount,
    },
  };
}
