import proj4 from 'proj4';

const EPSG_3414 = 'EPSG:3414';
const WGS84 = 'EPSG:4326';
const SINGAPORE_BOUNDS = {
  west: 103.55,
  east: 104.1,
  south: 1.15,
  north: 1.5,
};
const FIELD_SAMPLE_LIMIT = 6;
const FIELD_SET_LIMIT = 512;
const SYSTEM_FIELD_PATTERN = /^(objectid|fid|gid|id|shape(?:_.*)?|geom(?:etry)?|_.*)$/i;

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

function parseExplicitCRS(crs) {
  if (!crs) return null;
  const crsName = String(crs?.properties?.name || crs?.name || '').toUpperCase();
  if (!crsName) return null;
  if (crsName.includes('3414') || crsName.includes('SVY21')) return EPSG_3414;
  if (crsName.includes('4326') || crsName.includes('CRS84') || crsName.includes('WGS84')) return WGS84;
  throw new Error('This overlay only accepts Singapore GeoJSON in EPSG:3414 or WGS84 (EPSG:4326).');
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

function isPlausibleLngLat(coord) {
  return (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1]) &&
    coord[0] >= -180 &&
    coord[0] <= 180 &&
    coord[1] >= -90 &&
    coord[1] <= 90
  );
}

function collectCoordinateSamples(value, samples = [], limit = 128) {
  if (!value || samples.length >= limit) return samples;
  if (Array.isArray(value)) {
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      samples.push(value);
      return samples;
    }

    value.forEach((entry) => {
      if (samples.length < limit) collectCoordinateSamples(entry, samples, limit);
    });
  }
  else if (typeof value === 'object') {
    Object.values(value).forEach((entry) => {
      if (samples.length < limit) collectCoordinateSamples(entry, samples, limit);
    });
  }

  return samples;
}

function detectSourceCRS(featureCollection, explicitCRS) {
  if (explicitCRS) return explicitCRS;

  const samples = collectCoordinateSamples(featureCollection);
  let wgs84InBounds = 0;
  let wgs84Plausible = 0;
  let svy21InBounds = 0;

  samples.forEach((coord) => {
    const [x, y] = coord;
    if (isWithinSingapore(x, y)) wgs84InBounds += 1;
    if (isPlausibleLngLat(coord)) wgs84Plausible += 1;

    const [lng, lat] = proj4(EPSG_3414, WGS84, [x, y]);
    if (Number.isFinite(lng) && Number.isFinite(lat) && isWithinSingapore(lng, lat)) {
      svy21InBounds += 1;
    }
  });

  if (wgs84InBounds > svy21InBounds) return WGS84;
  if (svy21InBounds > wgs84InBounds) return EPSG_3414;
  if (wgs84InBounds > 0) return WGS84;
  if (svy21InBounds > 0) return EPSG_3414;
  if (wgs84Plausible > 0) return WGS84;
  return EPSG_3414;
}

function normalizeCoordinate(coord, sourceCrs, stats) {
  if (!Array.isArray(coord) || coord.length < 2) {
    throw new Error('Encountered an invalid coordinate while reading the GeoJSON file.');
  }

  const [lng, lat] = sourceCrs === EPSG_3414
    ? proj4(EPSG_3414, WGS84, [coord[0], coord[1]])
    : [coord[0], coord[1]];

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`Failed to normalize one or more coordinates from ${sourceCrs}.`);
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

function pruneGeometry(geometry, sourceCrs, stats) {
  if (!geometry?.type) {
    throw new Error('Encountered a geometry without a valid type in the uploaded GeoJSON.');
  }

  switch (geometry.type) {
    case 'Point': {
      const coordinate = normalizeCoordinate(geometry.coordinates, sourceCrs, stats);
      return coordinate ? { ...geometry, coordinates: coordinate } : null;
    }
    case 'MultiPoint': {
      const coordinates = geometry.coordinates
        .map((coordinate) => normalizeCoordinate(coordinate, sourceCrs, stats))
        .filter(Boolean);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'LineString': {
      const coordinates = geometry.coordinates
        .map((coordinate) => normalizeCoordinate(coordinate, sourceCrs, stats))
        .filter(Boolean);
      return coordinates.length >= 2 ? { ...geometry, coordinates } : null;
    }
    case 'MultiLineString': {
      const coordinates = geometry.coordinates
        .map((line) => line.map((coordinate) => normalizeCoordinate(coordinate, sourceCrs, stats)).filter(Boolean))
        .filter((line) => line.length >= 2);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'Polygon': {
      const coordinates = geometry.coordinates
        .map((ring) => ring.map((coordinate) => normalizeCoordinate(coordinate, sourceCrs, stats)).filter(Boolean))
        .map((ring) => closeRing(ring))
        .filter((ring) => ring.length >= 4);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'MultiPolygon': {
      const coordinates = geometry.coordinates
        .map((polygon) => polygon
          .map((ring) => ring.map((coordinate) => normalizeCoordinate(coordinate, sourceCrs, stats)).filter(Boolean))
          .map((ring) => closeRing(ring))
          .filter((ring) => ring.length >= 4)
        )
        .filter((polygon) => polygon.length);
      return coordinates.length ? { ...geometry, coordinates } : null;
    }
    case 'GeometryCollection': {
      const geometries = geometry.geometries
        .map((entry) => pruneGeometry(entry, sourceCrs, stats))
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

function classifyPropertyValue(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'other';
}

function fieldKeywordScore(fieldName) {
  const name = String(fieldName || '').toLowerCase();
  let score = 0;
  if (/(^|_)(name|label|title)(_|$)/.test(name)) score += 6;
  if (/(station|subzone|zone|planning|district|road|street|block|building|site|parcel|type|code|desc|address)/.test(name)) score += 3;
  if (/(mrt|lta|ura|nhb)/.test(name)) score += 2;
  if (SYSTEM_FIELD_PATTERN.test(name)) score -= 5;
  return score;
}

function rankField(field) {
  return fieldKeywordScore(field.name)
    + (field.labelEligible ? 4 : 0)
    + (field.dissolveEligible ? 2 : 0)
    + Math.min(field.completeness, 1) * 2
    - Math.min(field.averageLength / 80, 1.5);
}

function buildFieldCatalog(features) {
  const featureCount = features.length;
  const stats = new Map();

  features.forEach((feature) => {
    const props = feature.properties || {};
    Object.entries(props).forEach(([key, value]) => {
      if (!stats.has(key)) {
        stats.set(key, {
          name: key,
          nonNullCount: 0,
          stringCount: 0,
          numberCount: 0,
          booleanCount: 0,
          otherCount: 0,
          totalLength: 0,
          maxLength: 0,
          uniqueValues: new Set(),
          sampleValues: [],
        });
      }
      const field = stats.get(key);
      const kind = classifyPropertyValue(value);
      if (kind === 'empty') return;

      field.nonNullCount += 1;
      if (kind === 'string') {
        field.stringCount += 1;
        field.totalLength += value.length;
        field.maxLength = Math.max(field.maxLength, value.length);
      } else if (kind === 'number') {
        field.numberCount += 1;
        field.totalLength += String(value).length;
        field.maxLength = Math.max(field.maxLength, String(value).length);
      } else if (kind === 'boolean') {
        field.booleanCount += 1;
        field.totalLength += String(value).length;
        field.maxLength = Math.max(field.maxLength, String(value).length);
      } else {
        field.otherCount += 1;
      }

      if (field.uniqueValues.size < FIELD_SET_LIMIT) {
        field.uniqueValues.add(String(value));
      }
      if (field.sampleValues.length < FIELD_SAMPLE_LIMIT) {
        const sample = String(value);
        if (!field.sampleValues.includes(sample)) {
          field.sampleValues.push(sample);
        }
      }
    });
  });

  const fieldCatalog = [...stats.values()].map((field) => {
    const scalarCount = field.stringCount + field.numberCount + field.booleanCount;
    const dominantType = field.stringCount >= field.numberCount && field.stringCount >= field.booleanCount
      ? 'string'
      : field.numberCount >= field.booleanCount
        ? 'number'
        : 'boolean';
    const completeness = featureCount ? field.nonNullCount / featureCount : 0;
    const averageLength = scalarCount ? field.totalLength / scalarCount : 0;
    const uniqueCount = field.uniqueValues.size;
    const systemLike = SYSTEM_FIELD_PATTERN.test(field.name);
    const keywordScore = fieldKeywordScore(field.name);

    const labelEligible = scalarCount > 0
      && field.otherCount === 0
      && completeness >= 0.2
      && averageLength > 0
      && averageLength <= 80
      && field.maxLength <= 120
      && uniqueCount >= 2
      && (dominantType === 'string' || dominantType === 'number')
      && (!systemLike || keywordScore > 0);

    const dissolveEligible = scalarCount > 0
      && field.otherCount === 0
      && completeness >= 0.2
      && uniqueCount >= 1
      && uniqueCount < featureCount
      && uniqueCount <= Math.min(200, Math.max(12, Math.round(featureCount * 0.95)));

    return {
      name: field.name,
      dominantType,
      completeness: Number(completeness.toFixed(3)),
      uniqueCount,
      averageLength: Number(averageLength.toFixed(1)),
      maxLength: field.maxLength,
      sampleValues: field.sampleValues,
      labelEligible,
      dissolveEligible,
      systemLike,
      score: rankField({
        name: field.name,
        completeness,
        averageLength,
        labelEligible,
        dissolveEligible,
      }),
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    fieldCatalog,
    fieldOptions: {
      all: fieldCatalog.map((field) => field.name),
      label: fieldCatalog.filter((field) => field.labelEligible).map((field) => field.name),
      dissolve: fieldCatalog.filter((field) => field.dissolveEligible).map((field) => field.name),
      summary: fieldCatalog
        .filter((field) => field.dominantType !== 'other' && !field.systemLike)
        .slice(0, 8)
        .map((field) => field.name),
    },
  };
}

export function selectFeatureCollectionFields(featureCollection, keepFields = []) {
  const allowed = new Set((keepFields || []).filter(Boolean));
  return {
    type: 'FeatureCollection',
    features: (featureCollection?.features || []).map((feature) => ({
      type: 'Feature',
      id: feature.id,
      properties: Object.fromEntries(
        Object.entries(feature.properties || {}).filter(([key]) => allowed.has(key))
      ),
      geometry: roundGeometryPrecision(feature.geometry),
    })),
  };
}

function roundCoordinateValue(value, precision = 6) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function roundCoordinates(value, precision = 6) {
  if (!Array.isArray(value)) return value;
  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return value.map((entry, index) => index < 2 ? roundCoordinateValue(entry, precision) : entry);
  }
  return value.map((entry) => roundCoordinates(entry, precision));
}

function roundGeometryPrecision(geometry, precision = 6) {
  if (!geometry?.type) return geometry;
  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: (geometry.geometries || []).map((entry) => roundGeometryPrecision(entry, precision)),
    };
  }
  if (geometry.coordinates === undefined) return geometry;
  return {
    ...geometry,
    coordinates: roundCoordinates(geometry.coordinates, precision),
  };
}

export function normalizeSingaporeGeoJson(input, fileName = 'Uploaded GeoJSON') {
  const featureCollection = normalizeToFeatureCollection(input);
  const sourceCrs = detectSourceCRS(featureCollection, parseExplicitCRS(input?.crs));

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

    const geometry = pruneGeometry(feature.geometry, sourceCrs, stats);
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
    throw new Error(`The uploaded GeoJSON did not contain any geometry inside Singapore after normalization from ${sourceCrs}.`);
  }

  if (!Number.isFinite(stats.minLng) || !Number.isFinite(stats.minLat)) {
    throw new Error('The uploaded GeoJSON did not produce any valid Singapore coordinates.');
  }

  const { fieldCatalog, fieldOptions } = buildFieldCatalog(features);

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
      crs: sourceCrs === EPSG_3414
        ? 'Source CRS: EPSG:3414 (SVY21 / Singapore TM)'
        : 'Source CRS: EPSG:4326 (WGS84 longitude/latitude)',
      discardedCoordinateCount: stats.discardedCoordinateCount,
      discardedFeatureCount: stats.discardedFeatureCount,
      fieldCatalog,
      fieldOptions,
    },
  };
}
