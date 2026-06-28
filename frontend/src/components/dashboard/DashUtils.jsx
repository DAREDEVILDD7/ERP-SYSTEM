// Shared chart utilities — aurora glassmorphism theme.

// Glass-card tooltip — matches the aurora card aesthetic
export const TOOLTIP_STYLE = {
  background: 'rgba(255, 255, 255, 0.88)',
  backdropFilter: 'blur(14px) saturate(180%)',
  WebkitBackdropFilter: 'blur(14px) saturate(180%)',
  borderRadius: 12,
  border: '1px solid rgba(255, 255, 255, 0.60)',
  boxShadow: '0 4px 24px rgba(99, 102, 241, 0.12), 0 1px 4px rgba(0,0,0,0.04)',
  fontSize: 12,
  color: '#334155',
  padding: '8px 14px',
};
export const NEO_TOOLTIP_STYLE = TOOLTIP_STYLE;

// Flat rounded-end bar — works for both vertical and horizontal BarChart layouts.
export function Bar3D({ x, y, width, height, fill }) {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const r = Math.min(3, Math.abs(width) / 2, Math.abs(height) / 2);
  return (
    <rect
      x={x} y={y} width={width} height={height}
      rx={r} ry={r} fill={fill} fillOpacity={0.88}
    />
  );
}

// Shared donut centre label — shows total + unit text.
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
        style={{ fontSize: 11, fill: '#94a3b8', letterSpacing: '0.02em' }}
      >
        {label}
      </text>
    </g>
  );
}

// Drop-shadow filter removed — glass cards don't need it.
export const PIE_FILTER_DEF = null;
export const PIE_STYLE = {};
