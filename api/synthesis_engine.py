from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from pyproj import CRS, Transformer
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, shape, mapping
from shapely.ops import transform as shapely_transform, unary_union
from shapely.strtree import STRtree

from synthesis_theme import EPSG_3414, EPSG_4326, THEME, resolve_style

SINGAPORE_BOUNDS = {
    "west": 103.55,
    "east": 104.1,
    "south": 1.15,
    "north": 1.5,
}

SUPPORTED_OPERATIONS = [
    {
        "id": "nearest_distance",
        "label": "Nearest Distance",
        "description": "Measure the nearest distance from each source feature to the target layer in EPSG:3414.",
        "requiresTarget": True,
        "params": [
            {"id": "source_measure", "label": "Source Measure", "type": "select", "default": "boundary", "options": ["boundary", "centroid", "geometry"]},
            {"id": "target_label_field", "label": "Target Label Field", "type": "text", "default": ""},
            {"id": "distance_field", "label": "Distance Field", "type": "text", "default": "distance_m"},
            {"id": "class_count", "label": "Class Count", "type": "number", "default": 5},
        ],
    },
    {
        "id": "count_within",
        "label": "Count Within Polygon",
        "description": "Count how many target features fall within or intersect each source polygon.",
        "requiresTarget": True,
        "params": [
            {"id": "predicate", "label": "Predicate", "type": "select", "default": "intersects", "options": ["intersects", "within", "contains", "touches", "overlaps"]},
            {"id": "count_field", "label": "Count Field", "type": "text", "default": "feature_count"},
            {"id": "class_count", "label": "Class Count", "type": "number", "default": 5},
        ],
    },
    {
        "id": "buffer",
        "label": "Buffer",
        "description": "Create a metric buffer around the source features.",
        "requiresTarget": False,
        "params": [
            {"id": "distance_m", "label": "Buffer Distance (m)", "type": "number", "default": 400},
            {"id": "dissolve", "label": "Dissolve Output", "type": "boolean", "default": False},
        ],
    },
    {
        "id": "clip",
        "label": "Clip",
        "description": "Clip the source layer by the target layer extent.",
        "requiresTarget": True,
        "params": [],
    },
    {
        "id": "intersection",
        "label": "Intersection",
        "description": "Intersect the source layer with the target layer.",
        "requiresTarget": True,
        "params": [],
    },
    {
        "id": "difference",
        "label": "Difference",
        "description": "Subtract the target geometry from the source layer.",
        "requiresTarget": True,
        "params": [],
    },
    {
        "id": "dissolve",
        "label": "Dissolve",
        "description": "Merge features by a shared attribute field.",
        "requiresTarget": False,
        "params": [
            {"id": "field", "label": "Dissolve Field", "type": "text", "default": ""},
        ],
    },
    {
        "id": "centroid",
        "label": "Centroids",
        "description": "Create centroid points from the source geometry.",
        "requiresTarget": False,
        "params": [],
    },
]

_to_sg_transformer = Transformer.from_crs(CRS.from_string(EPSG_4326), CRS.from_string(EPSG_3414), always_xy=True)
_to_wgs84_transformer = Transformer.from_crs(CRS.from_string(EPSG_3414), CRS.from_string(EPSG_4326), always_xy=True)


def _clone(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clone(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clone(v) for v in value]
    return value


def _is_within_singapore(lng: float, lat: float) -> bool:
    return (
        SINGAPORE_BOUNDS["west"] <= lng <= SINGAPORE_BOUNDS["east"]
        and SINGAPORE_BOUNDS["south"] <= lat <= SINGAPORE_BOUNDS["north"]
    )


def _collect_coordinate_samples(value: Any, samples: Optional[List[Sequence[float]]] = None, limit: int = 128) -> List[Sequence[float]]:
    samples = samples or []
    if value is None or len(samples) >= limit:
        return samples
    if isinstance(value, list):
        if (
            len(value) >= 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            samples.append(value)
            return samples
        for entry in value:
            if len(samples) >= limit:
                break
            _collect_coordinate_samples(entry, samples, limit)
        return samples
    if isinstance(value, dict):
        for entry in value.values():
            if len(samples) >= limit:
                break
            _collect_coordinate_samples(entry, samples, limit)
    return samples


def _parse_explicit_crs(payload: Dict[str, Any]) -> Optional[str]:
    crs = payload.get("crs")
    if not crs:
        return None
    crs_name = str(crs.get("properties", {}).get("name") or crs.get("name") or "").upper()
    if not crs_name:
        return None
    if "3414" in crs_name or "SVY21" in crs_name:
        return EPSG_3414
    if "4326" in crs_name or "CRS84" in crs_name or "WGS84" in crs_name:
        return EPSG_4326
    raise ValueError("This synthesis flow only supports Singapore GeoJSON in EPSG:3414 or WGS84.")


def _detect_source_crs(feature_collection: Dict[str, Any]) -> str:
    explicit = _parse_explicit_crs(feature_collection)
    if explicit:
        return explicit

    samples = _collect_coordinate_samples(feature_collection)
    wgs84_hits = 0
    projected_hits = 0
    for coord in samples:
        x, y = float(coord[0]), float(coord[1])
        if _is_within_singapore(x, y):
            wgs84_hits += 1
        try:
            lng, lat = _to_wgs84_transformer.transform(x, y)
            if math.isfinite(lng) and math.isfinite(lat) and _is_within_singapore(lng, lat):
                projected_hits += 1
        except Exception:
            continue

    if wgs84_hits >= projected_hits and wgs84_hits > 0:
        return EPSG_4326
    if projected_hits > 0:
        return EPSG_3414
    return EPSG_4326


def _normalize_feature_collection(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload_type = payload.get("type")
    if payload_type == "FeatureCollection":
        return _clone(payload)
    if payload_type == "Feature":
        return {"type": "FeatureCollection", "features": [_clone(payload)]}
    if payload_type and payload.get("coordinates") is not None:
        return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": _clone(payload)}]}
    raise ValueError("Unsupported GeoJSON payload. Please upload a valid GeoJSON FeatureCollection, Feature, or Geometry.")


def _to_epsg3414(geometry, source_crs: str):
    if source_crs == EPSG_3414:
        return geometry
    return shapely_transform(_to_sg_transformer.transform, geometry)


def _to_wgs84(geometry):
    return shapely_transform(_to_wgs84_transformer.transform, geometry)


def _sanitize_geometry(geometry):
    if geometry.is_empty:
        return None
    fixed = geometry.buffer(0) if not geometry.is_valid and geometry.geom_type in {"Polygon", "MultiPolygon"} else geometry
    if fixed.is_empty:
        return None
    return fixed


def _geometry_type_counts(features: List[Dict[str, Any]]) -> List[str]:
    return sorted({feature["geometry"].geom_type for feature in features if feature.get("geometry")})


def _coerce_feature_collection(name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    feature_collection = _normalize_feature_collection(payload)
    source_crs = _detect_source_crs(feature_collection)
    features = []
    minx = math.inf
    miny = math.inf
    maxx = -math.inf
    maxy = -math.inf
    for idx, feature in enumerate(feature_collection.get("features", []), start=1):
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        geometry = _sanitize_geometry(_to_epsg3414(shape(geometry_payload), source_crs))
        if geometry is None:
            continue
        bounds = geometry.bounds
        minx = min(minx, bounds[0])
        miny = min(miny, bounds[1])
        maxx = max(maxx, bounds[2])
        maxy = max(maxy, bounds[3])
        features.append(
            {
                "id": feature.get("id", f"{name}-{idx}"),
                "properties": _clone(feature.get("properties") or {}),
                "geometry": geometry,
            }
        )

    if not features:
        raise ValueError(f"Layer '{name}' did not contain usable geometry after CRS normalization.")

    return {
        "name": name,
        "sourceCrs": source_crs,
        "features": features,
        "geometryTypes": _geometry_type_counts(features),
        "bounds3414": [minx, miny, maxx, maxy],
    }


def _quantile_breaks(values: List[float], classes: int) -> List[float]:
    sorted_values = sorted(value for value in values if value is not None)
    if not sorted_values:
        return []
    if len(sorted_values) <= 1:
        return [sorted_values[0]]
    breaks = []
    for idx in range(1, classes + 1):
        position = (len(sorted_values) - 1) * idx / classes
        lower = math.floor(position)
        upper = math.ceil(position)
        if lower == upper:
            value = sorted_values[lower]
        else:
            ratio = position - lower
            value = sorted_values[lower] * (1 - ratio) + sorted_values[upper] * ratio
        if not breaks or value > breaks[-1]:
            breaks.append(value)
    return breaks


def _classify_numeric_field(values: List[float], field: str, title: str, classes: int = 5) -> Optional[Dict[str, Any]]:
    filtered = [value for value in values if isinstance(value, (int, float))]
    if not filtered:
        return None
    breaks = _quantile_breaks(filtered, classes)
    labels = []
    floor = min(filtered)
    for upper in breaks:
        labels.append(f"{floor:.1f} - {upper:.1f}")
        floor = upper
    colors = [resolve_style("thematic_polygon")["fillColor"] for _ in breaks]
    for idx, color in enumerate(colors):
        colors[idx] = [*THEME_COLOR_TO_RGBA(THEME["sequential"][min(idx, len(THEME["sequential"]) - 1)])]
    return {
        "type": "choropleth",
        "field": field,
        "title": title,
        "method": "quantile",
        "breaks": breaks,
        "labels": labels,
        "colors": colors,
    }


def THEME_COLOR_TO_RGBA(hex_value: str) -> List[int]:
    hex_value = hex_value.lstrip("#")
    return [int(hex_value[0:2], 16), int(hex_value[2:4], 16), int(hex_value[4:6], 16), 214]


def _feature_collection_response(features: List[Dict[str, Any]], *, layer_name: str, source_layers: List[str], style: Dict[str, Any], analysis: Dict[str, Any]) -> Dict[str, Any]:
    bounds = _combined_bounds([feature["geometry"] for feature in features])
    wgs84_features = []
    for feature in features:
        geometry_wgs84 = _to_wgs84(feature["geometry"])
        if geometry_wgs84.is_empty:
            continue
        wgs84_features.append(
            {
                "type": "Feature",
                "id": feature.get("id"),
                "properties": feature.get("properties", {}),
                "geometry": mapping(geometry_wgs84),
            }
        )

    return {
        "data": {
            "type": "FeatureCollection",
            "features": wgs84_features,
        },
        "meta": {
            "fileName": layer_name,
            "featureCount": len(wgs84_features),
            "geometryTypes": sorted({feature["geometry"]["type"] for feature in wgs84_features}),
            "bounds": bounds,
            "crs": f"Source CRS: {EPSG_3414} (SVY21 / Singapore TM)",
            "sourceLayers": source_layers,
            "analysis": analysis,
            "style": style,
        },
    }


def _combined_bounds(geometries: Iterable[Any]) -> List[List[float]]:
    minx = math.inf
    miny = math.inf
    maxx = -math.inf
    maxy = -math.inf
    for geometry in geometries:
        bounds = _to_wgs84(geometry).bounds
        minx = min(minx, bounds[0])
        miny = min(miny, bounds[1])
        maxx = max(maxx, bounds[2])
        maxy = max(maxy, bounds[3])
    return [[minx, miny], [maxx, maxy]]


def _relationship(left, right, predicate: str) -> bool:
    if predicate == "intersects":
        return left.intersects(right)
    if predicate == "within":
        return left.within(right)
    if predicate == "contains":
        return left.contains(right)
    if predicate == "touches":
        return left.touches(right)
    if predicate == "overlaps":
        return left.overlaps(right)
    raise ValueError(f"Unsupported predicate '{predicate}'.")


def _measure_geometry(geometry, mode: str):
    if mode == "centroid":
        return geometry.centroid
    if mode == "boundary":
        return geometry.boundary if geometry.geom_type not in {"Point", "MultiPoint"} else geometry
    return geometry


def run_synthesis(source_payload: Dict[str, Any], target_payload: Optional[Dict[str, Any]], operation: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    params = params or {}
    source_layer = _coerce_feature_collection(source_payload.get("name", "Source Layer"), source_payload["data"])
    target_layer = _coerce_feature_collection(target_payload.get("name", "Target Layer"), target_payload["data"]) if target_payload else None

    if operation == "nearest_distance":
        if not target_layer:
            raise ValueError("Nearest distance requires a target layer.")
        measure_mode = params.get("source_measure", "boundary")
        distance_field = params.get("distance_field", "distance_m")
        target_label_field = params.get("target_label_field") or ""
        class_count = int(params.get("class_count", 5))
        target_geometries = [feature["geometry"] for feature in target_layer["features"]]
        tree = STRtree(target_geometries)
        result_features = []
        distances = []
        for feature in source_layer["features"]:
            measured = _measure_geometry(feature["geometry"], measure_mode)
            nearest_index = tree.nearest(measured)
            nearest_geometry = target_geometries[int(nearest_index)] if nearest_index is not None else None
            nearest_feature = target_layer["features"][int(nearest_index)] if nearest_index is not None else None
            distance = measured.distance(nearest_geometry) if nearest_geometry is not None else None
            distances.append(distance or 0.0)
            properties = _clone(feature["properties"])
            properties[distance_field] = round(distance or 0.0, 3)
            if target_label_field and nearest_feature:
                properties["nearest_target"] = nearest_feature["properties"].get(target_label_field)
            result_features.append({**feature, "properties": properties})

        style = resolve_style("thematic_polygon")
        choropleth = _classify_numeric_field(distances, distance_field, "Nearest distance (m)", class_count)
        if choropleth:
            style["choropleth"] = choropleth
        return _feature_collection_response(
            result_features,
            layer_name=f"{source_layer['name']} · nearest distance",
            source_layers=[source_layer["name"], target_layer["name"]],
            style=style,
            analysis={
                "operation": operation,
                "metricCrs": EPSG_3414,
                "sourceMeasure": measure_mode,
            },
        )

    if operation == "count_within":
        if not target_layer:
            raise ValueError("Count within requires a target layer.")
        predicate = params.get("predicate", "intersects")
        count_field = params.get("count_field", "feature_count")
        class_count = int(params.get("class_count", 5))
        target_geometries = [feature["geometry"] for feature in target_layer["features"]]
        tree = STRtree(target_geometries)
        result_features = []
        counts = []
        for feature in source_layer["features"]:
            hits = 0
            for candidate_index in tree.query(feature["geometry"]):
                candidate = target_geometries[int(candidate_index)]
                if _relationship(feature["geometry"], candidate, predicate):
                    hits += 1
            counts.append(hits)
            properties = _clone(feature["properties"])
            properties[count_field] = hits
            result_features.append({**feature, "properties": properties})

        style = resolve_style("thematic_polygon")
        choropleth = _classify_numeric_field(counts, count_field, "Count within polygon", class_count)
        if choropleth:
            style["choropleth"] = choropleth
        return _feature_collection_response(
            result_features,
            layer_name=f"{source_layer['name']} · count within",
            source_layers=[source_layer["name"], target_layer["name"]],
            style=style,
            analysis={
                "operation": operation,
                "metricCrs": EPSG_3414,
                "predicate": predicate,
            },
        )

    if operation == "buffer":
        distance_m = float(params.get("distance_m", 400))
        dissolve = bool(params.get("dissolve", False))
        buffered_features = []
        for feature in source_layer["features"]:
            buffered = _sanitize_geometry(feature["geometry"].buffer(distance_m))
            if buffered is None:
                continue
            buffered_features.append({**feature, "geometry": buffered})
        if dissolve and buffered_features:
            merged = unary_union([feature["geometry"] for feature in buffered_features])
            buffered_features = [{"id": f"{source_layer['name']}-buffer", "properties": {"buffer_m": distance_m}, "geometry": merged}]
        return _feature_collection_response(
            buffered_features,
            layer_name=f"{source_layer['name']} · {int(distance_m)}m buffer",
            source_layers=[source_layer["name"]],
            style=resolve_style("categorical_poly", fill=THEME["categorical"][1]),
            analysis={
                "operation": operation,
                "metricCrs": EPSG_3414,
                "distance_m": distance_m,
                "dissolve": dissolve,
            },
        )

    if operation in {"clip", "intersection", "difference"}:
        if not target_layer:
            raise ValueError(f"{operation} requires a target layer.")
        target_union = unary_union([feature["geometry"] for feature in target_layer["features"]])
        result_features = []
        for feature in source_layer["features"]:
            if operation == "clip":
                result = feature["geometry"].intersection(target_union)
            elif operation == "intersection":
                result = feature["geometry"].intersection(target_union)
            else:
                result = feature["geometry"].difference(target_union)
            result = _sanitize_geometry(result)
            if result is None:
                continue
            properties = _clone(feature["properties"])
            properties["analysis_op"] = operation
            result_features.append({**feature, "properties": properties, "geometry": result})
        return _feature_collection_response(
            result_features,
            layer_name=f"{source_layer['name']} · {operation}",
            source_layers=[source_layer["name"], target_layer["name"]],
            style=resolve_style("categorical_poly", fill=THEME["categorical"][2]),
            analysis={"operation": operation, "metricCrs": EPSG_3414},
        )

    if operation == "dissolve":
        field = str(params.get("field") or "").strip()
        if not field:
            raise ValueError("Dissolve requires a field name.")
        grouped: Dict[Any, List[Any]] = defaultdict(list)
        sample_props: Dict[Any, Dict[str, Any]] = {}
        for feature in source_layer["features"]:
            key = feature["properties"].get(field)
            grouped[key].append(feature["geometry"])
            sample_props[key] = feature["properties"]
        result_features = []
        for key, geometries in grouped.items():
            merged = _sanitize_geometry(unary_union(geometries))
            if merged is None:
                continue
            properties = _clone(sample_props[key])
            properties["dissolve_field"] = field
            result_features.append({"id": f"{source_layer['name']}-{key}", "properties": properties, "geometry": merged})
        return _feature_collection_response(
            result_features,
            layer_name=f"{source_layer['name']} · dissolve",
            source_layers=[source_layer["name"]],
            style=resolve_style("categorical_poly", fill=THEME["categorical"][4]),
            analysis={"operation": operation, "metricCrs": EPSG_3414, "field": field},
        )

    if operation == "centroid":
        result_features = []
        for feature in source_layer["features"]:
            centroid = feature["geometry"].centroid
            properties = _clone(feature["properties"])
            properties["source_geometry"] = feature["geometry"].geom_type
            result_features.append({**feature, "properties": properties, "geometry": centroid})
        return _feature_collection_response(
            result_features,
            layer_name=f"{source_layer['name']} · centroids",
            source_layers=[source_layer["name"]],
            style=resolve_style("centroid"),
            analysis={"operation": operation, "metricCrs": EPSG_3414},
        )

    raise ValueError(f"Unsupported synthesis operation '{operation}'.")


def qgis_template(spec: Dict[str, Any]) -> str:
    operation = spec.get("operation", "nearest_distance")
    params = spec.get("params") or {}
    source_name = spec.get("sourceName", "source_layer")
    target_name = spec.get("targetName", "target_layer")
    class_count = int(params.get("class_count", 5))
    distance_field = params.get("distance_field", "distance_m")
    count_field = params.get("count_field", "feature_count")
    dissolve_field = params.get("field", "zone_id")
    buffer_distance = float(params.get("distance_m", 400))
    predicate = params.get("predicate", "intersects")
    predicate_codes = {"intersects": 0, "contains": 1, "touches": 3, "overlaps": 4, "within": 5}
    qgis_predicate = predicate_codes.get(predicate, 0)

    operation_blocks = {
        "nearest_distance": f"""processing.run(\"native:distancetonearesthublinetohub\", {{
    \"INPUT\": source_layer,
    \"HUBS\": target_layer,
    \"FIELD\": \"{params.get('target_label_field') or ''}\",
    \"UNIT\": 0,
    \"OUTPUT\": output_path,
}})
distance_field = \"{distance_field}\"
apply_quantile_choropleth(source_layer, distance_field, {class_count})
""",
        "count_within": f"""processing.run(\"native:countpointsinpolygon\", {{
    \"POLYGONS\": source_layer,
    \"POINTS\": target_layer,
    \"FIELD\": \"{count_field}\",
    \"OUTPUT\": output_path,
}})
apply_quantile_choropleth(source_layer, \"{count_field}\", {class_count})
""",
        "buffer": f"""processing.run(\"native:buffer\", {{
    \"INPUT\": source_layer,
    \"DISTANCE\": {buffer_distance},
    \"SEGMENTS\": 24,
    \"END_CAP_STYLE\": 0,
    \"JOIN_STYLE\": 0,
    \"MITER_LIMIT\": 2,
    \"DISSOLVE\": {str(bool(params.get('dissolve', False))).lower()},
    \"OUTPUT\": output_path,
}})
""",
        "clip": """processing.run(\"native:clip\", {\"INPUT\": source_layer, \"OVERLAY\": target_layer, \"OUTPUT\": output_path})\n""",
        "intersection": """processing.run(\"native:intersection\", {\"INPUT\": source_layer, \"OVERLAY\": target_layer, \"OUTPUT\": output_path})\n""",
        "difference": """processing.run(\"native:difference\", {\"INPUT\": source_layer, \"OVERLAY\": target_layer, \"OUTPUT\": output_path})\n""",
        "dissolve": f"""processing.run(\"native:dissolve\", {{
    \"INPUT\": source_layer,
    \"FIELD\": [\"{dissolve_field}\"],
    \"OUTPUT\": output_path,
}})
""",
        "centroid": """processing.run(\"native:centroids\", {\"INPUT\": source_layer, \"ALL_PARTS\": False, \"OUTPUT\": output_path})\n""",
    }

    return f"""from qgis.core import *
import processing

PROJECT_CRS = \"EPSG:3414\"
PAPER = \"{THEME['paper']}\"
INK = \"{THEME['ink']}\"
INK_LIGHT = \"{THEME['ink_light']}\"
SEQUENTIAL = {THEME['sequential']}
CATEGORICAL = {THEME['categorical']}

SOURCE_PATH = r\"C:/replace/{source_name}.geojson\"
TARGET_PATH = r\"C:/replace/{target_name}.geojson\"
OUTPUT_PATH = r\"C:/replace/{operation}_output.geojson\"

project = QgsProject.instance()
project.setCrs(QgsCoordinateReferenceSystem(PROJECT_CRS))

def load_layer(path, layer_name):
    layer = QgsVectorLayer(path, layer_name, \"ogr\")
    if not layer.isValid():
        raise RuntimeError(f\"Could not load layer: {{path}}\")
    project.addMapLayer(layer)
    return layer

def reproject_to_sg(layer, layer_name):
    result = processing.run(\"native:reprojectlayer\", {{
        \"INPUT\": layer,
        \"TARGET_CRS\": QgsCoordinateReferenceSystem(PROJECT_CRS),
        \"OUTPUT\": \"memory:\"
    }})
    reproj = result[\"OUTPUT\"]
    reproj.setName(layer_name)
    project.addMapLayer(reproj)
    return reproj

def apply_quantile_choropleth(layer, field_name, classes=5):
    symbol = QgsFillSymbol.createSimple({{\"outline_color\": INK, \"outline_width\": \"0.4\"}})
    renderer = QgsGraduatedSymbolRenderer()
    renderer.setClassAttribute(field_name)
    renderer.setClassificationMethod(QgsClassificationQuantile())
    renderer.updateClasses(layer, classes)
    for idx, range_item in enumerate(renderer.ranges()):
        color = QColor(SEQUENTIAL[min(idx, len(SEQUENTIAL) - 1)])
        symbol = QgsFillSymbol.createSimple({{
            \"color\": color.name(),
            \"outline_color\": INK,
            \"outline_width\": \"0.4\"
        }})
        range_item.setSymbol(symbol)
    layer.setRenderer(renderer)
    layer.triggerRepaint()

source_raw = load_layer(SOURCE_PATH, \"{source_name}\")
source_layer = reproject_to_sg(source_raw, \"{source_name} (EPSG:3414)\")
target_layer = None
output_path = OUTPUT_PATH

if TARGET_PATH:
    target_raw = load_layer(TARGET_PATH, \"{target_name}\")
    target_layer = reproject_to_sg(target_raw, \"{target_name} (EPSG:3414)\")

# Operation: {operation}
{operation_blocks.get(operation, '')}

# Predicate code reference used by join-by-location templates:
# intersects=0, contains=1, touches=3, overlaps=4, within=5
PREDICATE_CODE = {qgis_predicate}
"""
