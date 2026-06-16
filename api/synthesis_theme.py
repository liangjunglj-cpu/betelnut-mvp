from __future__ import annotations

from typing import Dict, List

EPSG_3414 = "EPSG:3414"
EPSG_4326 = "EPSG:4326"

THEME = {
    "paper": "#F7F1E6",
    "ink": "#33291F",
    "ink_light": "#B9AE9A",
    "grid": "#E4DAC9",
    "accent": "#7A1F12",
    "sequential": ["#FBEFD8", "#EFC99E", "#DD9A68", "#C16A3D", "#963D1E"],
    "categorical": ["#B5651D", "#6E7B5B", "#436672", "#A8843C", "#8C5A52", "#5B5340"],
    "diverging": ["#963D1E", "#C8895A", "#EDE3D3", "#7FA0A6", "#436672"],
}

ROLE_STYLES: Dict[str, Dict[str, object]] = {
    "context_boundary": {
        "fill": None,
        "stroke": THEME["ink_light"],
        "fillOpacity": 0.0,
        "strokeOpacity": 0.6,
        "lineWidth": 1.4,
    },
    "base_polygon": {
        "fill": THEME["paper"],
        "stroke": THEME["ink"],
        "fillOpacity": 0.78,
        "strokeOpacity": 0.55,
        "lineWidth": 1.4,
    },
    "thematic_polygon": {
        "fill": THEME["sequential"][2],
        "stroke": THEME["ink"],
        "fillOpacity": 0.72,
        "strokeOpacity": 0.55,
        "lineWidth": 1.4,
    },
    "categorical_poly": {
        "fill": THEME["categorical"][0],
        "stroke": THEME["ink"],
        "fillOpacity": 0.72,
        "strokeOpacity": 0.85,
        "lineWidth": 1.4,
    },
    "point": {
        "fill": THEME["accent"],
        "stroke": THEME["paper"],
        "fillOpacity": 0.95,
        "strokeOpacity": 0.4,
        "lineWidth": 1.2,
    },
    "centroid": {
        "fill": THEME["ink"],
        "stroke": None,
        "fillOpacity": 1.0,
        "strokeOpacity": 0.0,
        "lineWidth": 0.0,
    },
}


def hex_to_rgba(value: str | None, alpha: float = 1.0) -> List[int] | None:
    if not value:
        return None
    value = value.lstrip("#")
    return [
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
        round(max(0.0, min(1.0, alpha)) * 255),
    ]


def resolve_style(role: str, *, fill: str | None = None, stroke: str | None = None) -> Dict[str, object]:
    base = ROLE_STYLES.get(role, ROLE_STYLES["categorical_poly"])
    fill_hex = fill if fill is not None else base.get("fill")
    stroke_hex = stroke if stroke is not None else base.get("stroke")
    fill_opacity = float(base.get("fillOpacity", 1.0))
    stroke_opacity = float(base.get("strokeOpacity", 1.0))
    return {
        "role": role,
        "fillColor": hex_to_rgba(fill_hex, fill_opacity),
        "lineColor": hex_to_rgba(stroke_hex, stroke_opacity),
        "pointColor": hex_to_rgba(fill_hex or THEME["accent"], fill_opacity),
        "lineWidth": float(base.get("lineWidth", 1.0)),
    }


def theme_payload() -> Dict[str, object]:
    return {
        "crs": EPSG_3414,
        "palette": THEME,
        "roleStyles": {role: resolve_style(role) for role in ROLE_STYLES},
        "classificationDefaults": {
            "method": "quantile",
            "classes": 5,
        },
    }
