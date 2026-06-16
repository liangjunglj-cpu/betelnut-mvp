export const WARM_EDITORIAL_THEME = {
  crs: 'EPSG:3414',
  palette: {
    paper: '#F7F1E6',
    ink: '#33291F',
    inkLight: '#B9AE9A',
    grid: '#E4DAC9',
    accent: '#7A1F12',
    sequential: ['#FBEFD8', '#EFC99E', '#DD9A68', '#C16A3D', '#963D1E'],
    categorical: ['#B5651D', '#6E7B5B', '#436672', '#A8843C', '#8C5A52', '#5B5340'],
    diverging: ['#963D1E', '#C8895A', '#EDE3D3', '#7FA0A6', '#436672'],
  },
};

export function hexToRgba(value, alpha = 1) {
  if (!value) return null;
  const hex = value.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    Math.round(Math.max(0, Math.min(1, alpha)) * 255),
  ];
}

export function defaultLayerStyle(role = 'categorical_poly', index = 0) {
  const categorical = WARM_EDITORIAL_THEME.palette.categorical;
  const sequential = WARM_EDITORIAL_THEME.palette.sequential;
  const fillHex = role === 'thematic_polygon'
    ? sequential[Math.min(index, sequential.length - 1)]
    : categorical[index % categorical.length];

  if (role === 'point') {
    return {
      role,
      fillColor: hexToRgba(WARM_EDITORIAL_THEME.palette.accent, 0.95),
      lineColor: hexToRgba(WARM_EDITORIAL_THEME.palette.paper, 0.45),
      pointColor: hexToRgba(WARM_EDITORIAL_THEME.palette.accent, 0.95),
      lineWidth: 1.2,
    };
  }

  if (role === 'centroid') {
    return {
      role,
      fillColor: hexToRgba(WARM_EDITORIAL_THEME.palette.ink, 1),
      lineColor: hexToRgba(WARM_EDITORIAL_THEME.palette.ink, 0),
      pointColor: hexToRgba(WARM_EDITORIAL_THEME.palette.ink, 1),
      lineWidth: 0.8,
    };
  }

  return {
    role,
    fillColor: hexToRgba(fillHex, role === 'context_boundary' ? 0 : 0.72),
    lineColor: hexToRgba(
      role === 'context_boundary' ? WARM_EDITORIAL_THEME.palette.inkLight : WARM_EDITORIAL_THEME.palette.ink,
      role === 'context_boundary' ? 0.6 : 0.72
    ),
    pointColor: hexToRgba(fillHex, 0.9),
    lineWidth: 1.4,
  };
}

export function pickChoroplethColor(properties, style) {
  const choropleth = style?.choropleth;
  if (!choropleth?.field || !Array.isArray(choropleth.breaks) || !Array.isArray(choropleth.colors)) {
    return style?.fillColor || defaultLayerStyle().fillColor;
  }

  const value = Number(properties?.[choropleth.field]);
  if (!Number.isFinite(value)) {
    return style?.fillColor || defaultLayerStyle().fillColor;
  }

  const index = choropleth.breaks.findIndex((stop) => value <= stop);
  if (index === -1) {
    return choropleth.colors[choropleth.colors.length - 1];
  }
  return choropleth.colors[index];
}
