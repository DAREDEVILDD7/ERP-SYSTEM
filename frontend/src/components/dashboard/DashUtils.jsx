// Shared neomorphism + 3D chart utilities for all role dashboards.

export const NEO_TOOLTIP_STYLE = {
  background: '#e2e8f0',
  borderRadius: 12,
  border: 'none',
  boxShadow: '4px 4px 10px rgba(163,177,198,0.65), -4px -4px 10px rgba(255,255,255,0.88)',
  fontSize: 12,
  color: '#1e293b',
};

// Custom 3D bar shape — works for both vertical and horizontal bar orientations.
// Draws a front face + lighter top face + darker right/end-cap face.
export function Bar3D({ x, y, width, height, fill }) {
  if (!fill || !width || !height || width <= 0 || height <= 0) return null;
  const d = 5; // depth offset in pixels
  return (
    <g>
      {/* front face */}
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />
      {/* top / leading face — lighter */}
      <polygon
        points={`${x},${y} ${x + width},${y} ${x + width + d},${y - d} ${x + d},${y - d}`}
        style={{ fill, filter: 'brightness(1.32)' }}
      />
      {/* right / end-cap face — darker */}
      <polygon
        points={`${x + width},${y} ${x + width},${y + height} ${x + width + d},${y + height - d} ${x + width + d},${y - d}`}
        style={{ fill, filter: 'brightness(0.72)' }}
      />
    </g>
  );
}

// Shared donut centre label — pass label prop for the unit text.
export function DonutCentre({ viewBox, total, label = 'total' }) {
  const { cx, cy } = viewBox ?? {};
  if (!cx || !cy) return null;
  return (
    <g>
      <text
        x={cx} y={cy - 7}
        textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 22, fontWeight: 700, fill: '#1e293b' }}
      >
        {total}
      </text>
      <text
        x={cx} y={cy + 12}
        textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 11, fill: '#94a3b8' }}
      >
        {label}
      </text>
    </g>
  );
}

// SVG drop-shadow filter string for PieChart <defs>.
// Each PieChart has its own SVG, so re-using id "nps" is safe.
export const PIE_FILTER_DEF = (
  <defs>
    <filter id="nps" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="4" stdDeviation="5" floodColor="rgba(163,177,198,0.8)" />
    </filter>
  </defs>
);

export const PIE_STYLE = { filter: 'url(#nps)' };
