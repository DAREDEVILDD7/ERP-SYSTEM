// Shared chart utilities — clean, segmented, professional theme.

// Clean white-card tooltip — no neomorphic shadow
export const TOOLTIP_STYLE = {
  background: '#ffffff',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 16px rgba(15,23,42,0.08)',
  fontSize: 12,
  color: '#334155',
  padding: '8px 12px',
};
export const NEO_TOOLTIP_STYLE = TOOLTIP_STYLE;

// Flat rounded-end bar — replaces the 3D bar shape.
// Works for both vertical and horizontal BarChart layouts.
export function Bar3D({ x, y, width, height, fill }) {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const r = Math.min(3, Math.abs(width) / 2, Math.abs(height) / 2);
  return (
    <rect
      x={x} y={y} width={width} height={height}
      rx={r} ry={r} fill={fill} fillOpacity={0.86}
    />
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

// Drop-shadow removed for the clean segmented look — kept as no-ops for compat.
export const PIE_FILTER_DEF = null;
export const PIE_STYLE = {};
