// One React component per analytics section (§§4.1–4.13). Each is a thin
// presentational layer: it reads a single useAnalytics(...) query and
// renders KPIs + a chart + an InsightList wired to the matching template.
//
// Every section is deliberately isolated — a failing query, an empty
// result, or a template that raises will only affect its own tile.

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Label,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import {
  Package, ShoppingCart, Calendar, Wrench, Truck, RefreshCcw, Gauge,
  DollarSign, Repeat, Activity, Users, LineChart as LineChartIcon,
  LayoutDashboard,
} from 'lucide-react';

import { useAnalytics } from '../../hooks/useAnalytics';
import SectionCard from './SectionCard';
import InsightList from './InsightList';
import {
  NEO_TOOLTIP_STYLE, Bar3D, ActivePieShape, DonutCentre,
} from '../dashboard/DashUtils';
import { kwd } from '../../lib/insightHelpers';
import {
  tmpl_mostRentedEquipment, tmpl_mostProcuredEquipment, tmpl_recentLeases,
  tmpl_maintenanceFrequency, tmpl_dispatchTrends, tmpl_returnTrends,
  tmpl_utilization, tmpl_revenueByCategory, tmpl_procurementVsLease,
  tmpl_idleVsActive, tmpl_topCustomers, tmpl_maintenanceCostTrends,
  tmpl_monthlyKPIs,
} from '../../lib/insightTemplates';

const PALETTE = ['#EE1C25', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

// Common runInsight helper: templates are pure but a malformed row could
// theoretically throw. Never let a template crash a whole section.
function safeInsights(fn, result) {
  try { return fn(result) ?? []; }
  catch (e) {
    console.warn('[insight template]', e?.message ?? e);
    return [];
  }
}

// Small KPI pill used across sections.
function Kpi({ label, value, sub }) {
  return (
    <div className="neo-inset px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 truncate">{label}</p>
      <p className="text-lg font-bold text-slate-800 leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
    </div>
  );
}

// ── 4.1 Most rented equipment ────────────────────────────────────────────

export function MostRentedSection({ params }) {
  const q = useAnalytics('most_rented', params);
  const d = q.data;

  return (
    <SectionCard
      title="Most rented equipment"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 30} days`}
      icon={Package}
      {...q}
      hasData={(r) => r?.kpis?.totalRentals > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Top type" value={d.kpis.topName ?? '—'} sub={`${d.kpis.topRentals} rentals`} />
            <Kpi label="Top share" value={`${d.kpis.topSharePct}%`} />
            <Kpi label="Total rentals" value={d.kpis.totalRentals} />
            <Kpi label="Types active" value={d.kpis.distinctTypes} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={d.breakdowns.byType} layout="vertical" margin={{ left: 24, right: 12 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                <Bar dataKey="rentals" shape={Bar3D}>
                  {d.breakdowns.byType.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <InsightList insights={safeInsights(tmpl_mostRentedEquipment, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.2 Most procured equipment ──────────────────────────────────────────

export function MostProcuredSection({ params }) {
  const q = useAnalytics('most_procured', params);
  const d = q.data;

  return (
    <SectionCard
      title="Most procured equipment"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 90} days`}
      icon={ShoppingCart}
      {...q}
      hasData={(r) => r?.kpis?.totalCount > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Procurements" value={d.kpis.totalCount} />
            <Kpi label="Total spend" value={kwd(d.kpis.totalSpend)} />
            <Kpi label="Avg deal" value={kwd(d.kpis.avgDealSize)} />
            <Kpi label="Buy share" value={`${d.kpis.buySharePct}%`} sub={`${d.kpis.buyCount} buy · ${d.kpis.leaseCount} lease`} />
          </div>
          {d.series?.byMonth?.length ? (
            <div className="h-52">
              <ResponsiveContainer>
                <BarChart data={d.series.byMonth} margin={{ left: 12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Buy"   stackId="a" fill="#EE1C25" shape={Bar3D} />
                  <Bar dataKey="Lease" stackId="a" fill="#3b82f6" shape={Bar3D} />
                  <Bar dataKey="Other" stackId="a" fill="#94a3b8" shape={Bar3D} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <InsightList insights={safeInsights(tmpl_mostProcuredEquipment, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.3 Recent leases ────────────────────────────────────────────────────

export function RecentLeasesSection({ params }) {
  const q = useAnalytics('recent_leases', params);
  const d = q.data;

  return (
    <SectionCard
      title="Recent lease activity"
      subtitle={`Last ${d?.meta?.windowDays ?? 30} days`}
      icon={Calendar}
      {...q}
      hasData={(r) => (r?.kpis?.newLeases > 0) || (r?.kpis?.expiring30 > 0) || (r?.kpis?.expiring60 > 0)}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="New leases" value={d.kpis.newLeases} />
            <Kpi label="Monthly commit" value={kwd(d.kpis.monthlyCommit)} />
            <Kpi label="Avg term" value={`${d.kpis.avgTermDays}d`} />
            <Kpi label="Expiring ≤30d" value={d.kpis.expiring30} />
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wide text-slate-400 mb-2">Expiring soon</h4>
            {d.breakdowns.expiringSoon?.length ? (
              <ul className="divide-y neo-divider text-sm">
                {d.breakdowns.expiringSoon.map(u => (
                  <li key={u.equipment_id} className="py-2 flex items-center justify-between gap-3">
                    <span className="truncate text-slate-700">{u.equipment_id} · {u.equipment_types?.name ?? '—'}</span>
                    <span className="text-xs text-slate-400">→ {u.lease_end_date}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400 italic">No leases expiring in the next 30 days.</p>
            )}
          </div>

          <InsightList insights={safeInsights(tmpl_recentLeases, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.4 Maintenance frequency ────────────────────────────────────────────

export function MaintenanceFrequencySection({ params }) {
  const q = useAnalytics('maintenance_frequency', params);
  const d = q.data;

  return (
    <SectionCard
      title="Highest maintenance load"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 180} days`}
      icon={Wrench}
      {...q}
      hasData={(r) => r?.kpis?.totalJobs > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Top offender" value={d.kpis.topUnitId ?? '—'} sub={`${d.kpis.topUnitJobs} jobs`} />
            <Kpi label="Open jobs" value={d.kpis.openCount} />
            <Kpi label="Avg cost/job" value={kwd(d.kpis.avgCostPerJob)} />
            <Kpi label="Total jobs" value={d.kpis.totalJobs} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={d.breakdowns.topUnits} layout="vertical" margin={{ left: 24, right: 12 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="equipment_id" tick={{ fontSize: 10 }} width={110} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                <Bar dataKey="jobs" shape={Bar3D} fill="#EE1C25" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <InsightList insights={safeInsights(tmpl_maintenanceFrequency, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.5 Dispatch trends ──────────────────────────────────────────────────

export function DispatchTrendsSection({ params }) {
  const q = useAnalytics('dispatch_trends', params);
  const d = q.data;

  return (
    <SectionCard
      title="Dispatch trends"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 90} days`}
      icon={Truck}
      {...q}
      hasData={(r) => r?.kpis?.totalDispatches > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Dispatches" value={d.kpis.totalDispatches} />
            <Kpi label="Daily avg" value={d.kpis.dailyAvg.toFixed(1)} />
            <Kpi label="Avg turnaround" value={`${d.kpis.avgTurnaroundDays.toFixed(1)}d`} />
            <Kpi label="Backlog" value={d.kpis.pendingBacklog} />
          </div>
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={d.series.daily} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                <XAxis dataKey="day" tick={{ fontSize: 9 }} minTickGap={30} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="total" stroke="#EE1C25" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <InsightList insights={safeInsights(tmpl_dispatchTrends, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.6 Return trends ────────────────────────────────────────────────────

export function ReturnTrendsSection({ params }) {
  const q = useAnalytics('return_trends', params);
  const d = q.data;

  return (
    <SectionCard
      title="Return trends"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 90} days`}
      icon={RefreshCcw}
      {...q}
      hasData={(r) => (r?.kpis?.rentalReturnsWindow > 0) || (r?.kpis?.overdueCount > 0)}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Rental returns" value={d.kpis.rentalReturnsWindow} />
            <Kpi label="Lease returns" value={d.kpis.leaseReturnsWindow} />
            <Kpi label="Overdue" value={d.kpis.overdueCount} />
            <Kpi label="Avg days out" value={`${d.kpis.avgDaysOutForOverdue}d`} />
          </div>
          {d.series?.byWeek?.length ? (
            <div className="h-40">
              <ResponsiveContainer>
                <AreaChart data={d.series.byWeek} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <InsightList insights={safeInsights(tmpl_returnTrends, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.7 Utilization ──────────────────────────────────────────────────────

export function UtilizationSection({ params }) {
  const q = useAnalytics('utilization', params);
  const d = q.data;

  return (
    <SectionCard
      title="Fleet utilisation"
      subtitle="Live · % of non-maintenance fleet in use"
      icon={Gauge}
      {...q}
      hasData={(r) => r?.kpis?.totalUnits > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Fleet" value={`${d.kpis.fleetUtilPct}%`} />
            <Kpi label="Highest" value={d.kpis.topName ?? '—'} sub={`${d.kpis.topPct}%`} />
            <Kpi label="Lowest" value={d.kpis.lowName ?? '—'} sub={`${d.kpis.lowPct}%`} />
            <Kpi label="In use" value={`${d.kpis.inUse}/${d.kpis.totalUnits}`} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={d.breakdowns.byType.slice(0, 10)} layout="vertical" margin={{ left: 24, right: 12 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} formatter={(v) => `${v}%`} />
                <Bar dataKey="utilization_pct" shape={Bar3D}>
                  {d.breakdowns.byType.map((r, i) => (
                    <Cell key={i} fill={r.utilization_pct > 85 ? '#EE1C25' : r.utilization_pct > 50 ? '#10b981' : '#f59e0b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <InsightList insights={safeInsights(tmpl_utilization, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.8 Revenue by category ──────────────────────────────────────────────

export function RevenueByCategorySection({ params }) {
  const q = useAnalytics('revenue_by_category', params);
  const d = q.data;

  return (
    <SectionCard
      title="Revenue by equipment category"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 90} days`}
      icon={DollarSign}
      {...q}
      hasData={(r) => r?.kpis?.totalRevenue > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Total revenue" value={kwd(d.kpis.totalRevenue)} />
            <Kpi label="Rental" value={kwd(d.kpis.totalRental)} />
            <Kpi label="Lease" value={kwd(d.kpis.totalLease)} />
            <Kpi label="Top cat share" value={`${d.kpis.topSharePct}%`} sub={d.kpis.topCategory ?? '—'} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={d.breakdowns.byCategory.slice(0, 10)} layout="vertical" margin={{ left: 24, right: 12 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={110} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} formatter={(v) => kwd(v)} />
                <Bar dataKey="revenue" shape={Bar3D}>
                  {d.breakdowns.byCategory.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!d.meta.hasLineItems && (
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              Line-item detail is unavailable — revenue is attributed by best-effort quotation lookup.
            </p>
          )}
          <InsightList insights={safeInsights(tmpl_revenueByCategory, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.9 Procurement vs lease ─────────────────────────────────────────────

export function ProcurementVsLeaseSection({ params }) {
  const q = useAnalytics('procurement_vs_lease', params);
  const d = q.data;

  return (
    <SectionCard
      title="Procurement vs leasing"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 365} days`}
      icon={Repeat}
      {...q}
      hasData={(r) => (r?.kpis?.buyCount + r?.kpis?.leaseCount) > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Buy" value={d.kpis.buyCount} sub={kwd(d.kpis.buySpend)} />
            <Kpi label="Lease" value={d.kpis.leaseCount} sub={`${kwd(d.kpis.leaseMonthlyCommit)}/mo`} />
            <Kpi label="12-mo lease ext." value={kwd(d.kpis.annualLeaseExtrapolated)} />
            <Kpi label="Break-even" value={d.kpis.breakEvenMonths != null ? `${d.kpis.breakEvenMonths.toFixed(1)} mo` : '—'} />
          </div>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={d.breakdowns.rows} margin={{ left: 20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} formatter={(v, k) => k === 'spend' ? kwd(v) : v} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="count" fill="#3b82f6" shape={Bar3D} />
                <Bar dataKey="spend" fill="#EE1C25" shape={Bar3D} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <InsightList insights={safeInsights(tmpl_procurementVsLease, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.10 Idle vs active ─────────────────────────────────────────────────

export function IdleVsActiveSection({ params }) {
  const q = useAnalytics('idle_vs_active', params);
  const d = q.data;

  return (
    <SectionCard
      title="Idle vs active (live)"
      subtitle="Live-warehouse status"
      icon={Activity}
      {...q}
      hasData={(r) => r?.kpis?.total > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Active" value={d.kpis.active} />
            <Kpi label="Idle" value={d.kpis.idle} sub={`${d.kpis.idleSharePct}%`} />
            <Kpi label="Maintenance" value={d.kpis.maint} />
            <Kpi label="Longest idle" value={`${d.kpis.longestIdleDays}d`} sub={d.kpis.longestIdleId ?? '—'} />
          </div>
          <div className="h-52 grid grid-cols-1 md:grid-cols-2 gap-3">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={d.breakdowns.byStatus} dataKey="value" nameKey="name"
                     cx="50%" cy="50%" innerRadius={44} outerRadius={70}
                     paddingAngle={4} stroke="white" strokeWidth={2}
                     activeShape={ActivePieShape}>
                  {d.breakdowns.byStatus.map((_, i) => (
                    <Cell key={i} fill={['#10b981','#f59e0b','#EE1C25'][i % 3]} />
                  ))}
                  <Label content={<DonutCentre total={d.kpis.total} label="units" />} position="center" />
                </Pie>
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="overflow-y-auto">
              <h4 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Longest idle</h4>
              <ul className="divide-y neo-divider text-xs">
                {d.breakdowns.longestIdle.slice(0, 6).map(u => (
                  <li key={u.equipment_id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="truncate text-slate-700">{u.equipment_id}</span>
                    <span className="text-slate-400 shrink-0">{u.idle_days}d</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <InsightList insights={safeInsights(tmpl_idleVsActive, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.11 Top customers ──────────────────────────────────────────────────

export function TopCustomersSection({ params }) {
  const q = useAnalytics('top_customers', params);
  const d = q.data;

  return (
    <SectionCard
      title="Top customers"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 365} days`}
      icon={Users}
      {...q}
      hasData={(r) => (r?.breakdowns?.top20?.length ?? 0) > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Top account" value={d.kpis.topCustomer ?? '—'} sub={kwd(d.kpis.topBilled)} />
            <Kpi label="Top-5 share" value={`${d.kpis.top5SharePct}%`} />
            <Kpi label="Avg rev/cust" value={kwd(d.kpis.avgRevenuePerCustomer)} />
            <Kpi label="One-timers" value={d.kpis.oneTimeCount} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b neo-divider">
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium text-right">Approved</th>
                  <th className="py-2 font-medium text-right">Billed</th>
                  <th className="py-2 font-medium text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y neo-divider">
                {d.breakdowns.top20.slice(0, 8).map(c => (
                  <tr key={c.customer_id}>
                    <td className="py-2 truncate max-w-[200px]">{c.company_name ?? '—'}</td>
                    <td className="py-2 text-right">{c.approved_quotes}</td>
                    <td className="py-2 text-right">{kwd(c.billed_kwd)}</td>
                    <td className={`py-2 text-right ${c.outstanding > 0 ? 'text-primary-600 font-semibold' : ''}`}>{kwd(c.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InsightList insights={safeInsights(tmpl_topCustomers, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.12 Maintenance cost trends ─────────────────────────────────────────

export function MaintenanceCostSection({ params }) {
  const q = useAnalytics('maintenance_cost', params);
  const d = q.data;

  return (
    <SectionCard
      title="Maintenance cost trends"
      subtitle={`Rolling ${d?.meta?.windowDays ?? 365} days`}
      icon={LineChartIcon}
      {...q}
      hasData={(r) => r?.kpis?.totalJobs > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="MTD" value={kwd(d.kpis.mtdCost)} />
            <Kpi label="YTD" value={kwd(d.kpis.ytdCost)} />
            <Kpi label="Avg/job" value={kwd(d.kpis.avgCostPerJob)} />
            <Kpi label="Top issue" value={d.kpis.topIssueType ?? '—'} sub={kwd(d.kpis.topIssueCost)} />
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={d.series.byMonth} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} formatter={(v) => kwd(v)} />
                <Area type="monotone" dataKey="total" stroke="#EE1C25" fill="#EE1C25" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <InsightList insights={safeInsights(tmpl_maintenanceCostTrends, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.13 Monthly KPIs ────────────────────────────────────────────────────

function KpiTile({ label, value, delta, tone = 'neutral' }) {
  const arrow = delta == null ? null : delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
  const color = delta == null ? 'text-slate-400' : delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400';
  return (
    <div className="neo-kpi p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-bold text-slate-800 leading-tight">{value}</p>
      {delta != null && (
        <p className={`text-xs mt-0.5 ${color}`}>{arrow} {Math.abs(delta)}%</p>
      )}
    </div>
  );
}

export function MonthlyKPIsSection() {
  const q = useAnalytics('monthly_kpis');
  const d = q.data;

  return (
    <SectionCard
      title="Executive scorecard"
      subtitle={d?.meta?.monthKey ? `${d.meta.monthKey} vs ${d.meta.prevMonthKey}` : 'Current month vs previous month'}
      icon={LayoutDashboard}
      {...q}
      hasData={() => !!d}
      className="col-span-full"
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiTile label="Revenue"     value={kwd(d.kpis.revenue)}        delta={d.kpis.revenueDeltaPct} />
            <KpiTile label="Dispatches"  value={d.kpis.dispatches}          delta={d.kpis.dispatchesDeltaPct} />
            <KpiTile label="Utilisation" value={`${d.kpis.utilizationPct}%`} />
            <KpiTile label="Maint spend" value={kwd(d.kpis.maintSpend)}     delta={d.kpis.maintSpendDeltaPct} />
            <KpiTile label="Procurement" value={kwd(d.kpis.procurementSpend)} delta={d.kpis.procurementDeltaPct} />
            <KpiTile label="New customers" value={d.kpis.newCustomers}      delta={d.kpis.newCustomersDeltaPct} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Avg turnaround" value={`${d.kpis.avgTurnaroundDays.toFixed(1)}d`} />
            <Kpi label="Maint jobs" value={d.kpis.maintJobs} />
            <Kpi label="Procurement count" value={d.kpis.procurementCount} />
            <Kpi label="Overdue returns" value={d.kpis.overdueCount} />
          </div>
          <InsightList insights={safeInsights(tmpl_monthlyKPIs, d)} />
        </div>
      )}
    </SectionCard>
  );
}
