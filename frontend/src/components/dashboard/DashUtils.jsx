// Shared chart utilities — aurora glassmorphism theme.
import { Sector } from 'recharts';

// ── Tooltip ───────────────────────────────────────────────────────────────
export const TOOLTIP_STYLE = {
  background: 'rgba(255, 255, 255, 0.92)',
  backdropFilter: 'blur(14px) saturate(180%)',
  WebkitBackdropFilter: 'blur(14px) saturate(180%)',
  borderRadius: 12,
  border: '1px solid rgba(255, 255, 255, 0.65)',
  boxShadow: '0 4px 24px rgba(238,28,37,0.12), 0 1px 4px rgba(0,0,0,0.05)',
  fontSize: 12,
  color: '#334155',
  padding: '8px 14px',
};
export const NEO_TOOLTIP_STYLE = TOOLTIP_STYLE;

// ── Active pie segment — expands outward + soft glow ring on hover ────────
export function ActivePieShape(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  if (!cx || !cy) return null;
  return (
    <g>
      {/* outer glow halo */}
      <Sector
        cx={cx} cy={cy}
        innerRadius={outerRadius + 3}
        outerRadius={outerRadius + 14}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        fillOpacity={0.14}
      />
      {/* mid glow ring */}
      <Sector
        cx={cx} cy={cy}
        innerRadius={outerRadius + 1}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        fillOpacity={0.28}
      />
      {/* main expanded segment */}
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        fillOpacity={0.95}
      />
    </g>
  );
}

// ── Bar with directional shine overlay for glass depth ────────────────────
// Works for both vertical (width < height) and horizontal (width > height) bars.
export function Bar3D({ x, y, width, height, fill }) {
  if (!fill || !width || !height || width <= 0 || height <= 0) return null;
  const w = Math.abs(width);
  const h = Math.abs(height);
  const r = Math.min(3, w / 2, h / 2);
  const isH = w > h * 1.5;
  return (
    <g>
      {/* base bar */}
      <rect x={x} y={y} width={w} height={h} rx={r} ry={r}
        fill={fill} fillOpacity={0.88} />
      {/* shine overlay — left cap for horizontal, top cap for vertical */}
      {isH
        ? <rect x={x} y={y} width={Math.round(w * 0.28)} height={h}
            rx={r} ry={r} fill="white" fillOpacity={0.20} />
        : <rect x={x} y={y} width={w} height={Math.round(h * 0.34)}
            rx={r} ry={r} fill="white" fillOpacity={0.22} />
      }
    </g>
  );
}

// ── Donut centre label ─────────────────────────────────────────────────────
export function DonutCentre({ viewBox, total, label = 'total' }) {
  const { cx, cy } = viewBox ?? {};
  if (!cx || !cy) return null;
  return (
    <g>
      <text x={cx} y={cy - 7}
        textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 22, fontWeight: 700, fill: '#1e293b' }}>
        {total}
      </text>
      <text x={cx} y={cy + 12}
        textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 11, fill: '#94a3b8', letterSpacing: '0.03em' }}>
        {label}
      </text>
    </g>
  );
}

// ── Compat stubs ──────────────────────────────────────────────────────────
export const PIE_FILTER_DEF = null;
export const PIE_STYLE = {};
