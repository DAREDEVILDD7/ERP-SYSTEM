// ═════════════════════════════════════════════════════════════════════════
// Analytics — read-only aggregations for the Analytics page.
//
// Design principle: every function is defensive.
//   * a table that isn't migrated on this environment returns [] / null,
//     never throws;
//   * a query that returns no rows resolves to an empty-result shape the
//     UI's "insufficient data" branch handles;
//   * date-range params default per-section, but callers may widen them.
//
// The returned shape is always `{ kpis, series, breakdowns, meta }` so the
// insight templates in lib/insightTemplates.js can read the same keys.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabaseClient';

// ── helpers ─────────────────────────────────────────────────────────────

// Returns { fromIso, toIso } for a rolling window ending "now"
// (inclusive of today, exclusive of tomorrow midnight).
function windowDays(days) {
  const to   = new Date();
  const from = new Date(); from.setDate(from.getDate() - days);
  return {
    fromIso: from.toISOString(),
    toIso:   to.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate:   to.toISOString().slice(0, 10),
  };
}

// A defensive wrapper: any Supabase error just logs & returns [] so the
// downstream aggregator can carry on with partial data.
async function safeQuery(builder, tag) {
  try {
    const { data, error } = await builder;
    if (error) {
      // "relation does not exist" or PGRST205 (schema cache miss) mean the
      // table isn't in this environment — fall through to empty data.
      console.warn(`[analytics:${tag}]`, error.message ?? error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn(`[analytics:${tag}] threw`, err?.message ?? err);
    return [];
  }
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return (t2 - t1) / 86_400_000;
}

// ── 4.1 Most rented equipment ───────────────────────────────────────────

export async function getMostRentedEquipment({ days = 30 } = {}) {
  const { fromIso } = windowDays(days);

  // Pull dispatches in window with their equipment → type join. Aggregation
  // is done client-side because Supabase can't GROUP BY across a nested
  // relation in the JS client without an RPC.
  const dispatches = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, equipment_id, equipment_units(type_id, equipment_types(type_id, name, category))')
      .gte('dispatch_date', fromIso),
    'mostRented.dispatches'
  );

  const byTypeMap = new Map();
  for (const d of dispatches) {
    const t = d.equipment_units?.equipment_types;
    if (!t?.type_id) continue;
    const key = t.type_id;
    if (!byTypeMap.has(key)) {
      byTypeMap.set(key, { type_id: key, name: t.name, category: t.category, rentals: 0 });
    }
    byTypeMap.get(key).rentals += 1;
  }
  const byType = [...byTypeMap.values()].sort((a, b) => b.rentals - a.rentals);
  const totalRentals = byType.reduce((s, x) => s + x.rentals, 0);
  const top = byType[0];

  return {
    kpis: {
      totalRentals,
      topName: top?.name ?? null,
      topRentals: top?.rentals ?? 0,
      topSharePct: totalRentals ? Math.round((top?.rentals ?? 0) * 100 / totalRentals) : 0,
      distinctTypes: byType.length,
    },
    series: [],
    breakdowns: { byType: byType.slice(0, 10) },
    meta: { windowDays: days },
  };
}

// ── 4.2 Most procured equipment ─────────────────────────────────────────

export async function getMostProcuredEquipment({ days = 90 } = {}) {
  const { fromIso } = windowDays(days);

  const procs = await safeQuery(
    supabase
      .from('procurements')
      .select('procurement_id, type, status, total_amount_kwd, created_at')
      .gte('created_at', fromIso),
    'mostProcured.procurements'
  );

  // Line items — optional. Some environments may not have procurement_items
  // populated with equipment_type_id, so we degrade to Buy/Lease-only.
  const procIds = procs.map(p => p.procurement_id);
  let items = [];
  if (procIds.length > 0) {
    items = await safeQuery(
      supabase
        .from('procurement_items')
        .select('procurement_id, equipment_type_id, unit_price_kwd, equipment_types(name, category)')
        .in('procurement_id', procIds),
      'mostProcured.items'
    );
  }

  const byType = {};
  for (const p of procs) {
    const t = p.type ?? 'Unspecified';
    if (!byType[t]) byType[t] = { type: t, count: 0, spend: 0 };
    byType[t].count += 1;
    if (!['Cancelled', 'Rejected'].includes(p.status)) {
      byType[t].spend += Number(p.total_amount_kwd ?? 0);
    }
  }

  const byCategory = new Map();
  for (const it of items) {
    const cat = it.equipment_types?.category ?? 'Uncategorised';
    const name = it.equipment_types?.name ?? cat;
    const key = `${cat}|${name}`;
    if (!byCategory.has(key)) {
      byCategory.set(key, { category: cat, name, count: 0, spend: 0 });
    }
    const b = byCategory.get(key);
    b.count += 1;
    b.spend += Number(it.unit_price_kwd ?? 0);
  }

  // Monthly buy vs lease
  const byMonth = {};
  for (const p of procs) {
    const m = (p.created_at ?? '').slice(0, 7); // YYYY-MM
    if (!m) continue;
    if (!byMonth[m]) byMonth[m] = { month: m, Buy: 0, Lease: 0, Other: 0 };
    const bucket = ['Buy', 'Lease'].includes(p.type) ? p.type : 'Other';
    byMonth[m][bucket] += 1;
  }

  const totalCount = procs.length;
  const totalSpend = Object.values(byType).reduce((s, x) => s + x.spend, 0);
  const avgDealSize = totalCount ? totalSpend / totalCount : 0;
  const buyCount = byType.Buy?.count ?? 0;
  const leaseCount = byType.Lease?.count ?? 0;

  return {
    kpis: {
      totalCount,
      totalSpend,
      avgDealSize,
      buyCount,
      leaseCount,
      buySharePct: totalCount ? Math.round(buyCount * 100 / totalCount) : 0,
    },
    series: {
      byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
    },
    breakdowns: {
      byType: Object.values(byType).sort((a, b) => b.spend - a.spend),
      byCategory: [...byCategory.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    },
    meta: { windowDays: days, hasLineItems: items.length > 0 },
  };
}

// ── 4.3 Recent leased / contracted equipment ────────────────────────────

export async function getRecentLeases({ days = 30 } = {}) {
  const { fromIso } = windowDays(days);

  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, lease_start_date, lease_end_date, lease_monthly_kwd, lease_returned_at, equipment_types(name, category)')
      .gte('lease_start_date', fromIso.slice(0, 10))
      .is('lease_returned_at', null)
      .order('lease_start_date', { ascending: false }),
    'recentLeases.new'
  );

  // Everything currently leased (not returned) — used for expiry bucketing.
  const active = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, lease_start_date, lease_end_date, lease_monthly_kwd, equipment_types(name)')
      .not('lease_start_date', 'is', null)
      .is('lease_returned_at', null),
    'recentLeases.active'
  );

  const today = new Date();
  const bucket = { d30: 0, d60: 0, d90: 0, later: 0 };
  const expiring30 = [];
  for (const u of active) {
    if (!u.lease_end_date) { bucket.later += 1; continue; }
    const diff = daysBetween(today, u.lease_end_date);
    if (diff == null) continue;
    if (diff <= 30) { bucket.d30 += 1; expiring30.push(u); }
    else if (diff <= 60) bucket.d60 += 1;
    else if (diff <= 90) bucket.d90 += 1;
    else bucket.later += 1;
  }

  const newLeases = units.length;
  const monthlyCommit = units.reduce((s, u) => s + Number(u.lease_monthly_kwd ?? 0), 0);
  const avgTerm = units.reduce((s, u, _, arr) => {
    const d = daysBetween(u.lease_start_date, u.lease_end_date);
    return d == null ? s : s + d / arr.length;
  }, 0);

  return {
    kpis: {
      newLeases,
      monthlyCommit,
      avgTermDays: Math.round(avgTerm),
      expiring30: bucket.d30,
      expiring60: bucket.d60,
      expiring90: bucket.d90,
    },
    series: [],
    breakdowns: {
      newUnits: units.slice(0, 20),
      expiringSoon: expiring30.slice(0, 10),
    },
    meta: { windowDays: days },
  };
}

// ── 4.4 Highest maintenance frequency ───────────────────────────────────

export async function getMaintenanceFrequency({ days = 180 } = {}) {
  const { fromIso } = windowDays(days);

  const jobs = await safeQuery(
    supabase
      .from('maintenance')
      .select('maintenance_id, equipment_id, status, issue_type, cost_kwd, service_date, equipment_units(equipment_id, capacity, equipment_types(name, category))')
      .gte('service_date', fromIso.slice(0, 10)),
    'maintFreq.jobs'
  );

  const perUnit = new Map();
  const perType = new Map();
  const perIssueType = new Map();
  let openCount = 0;
  let completedLastMonthCount = 0;
  const oneMonthAgo = Date.now() - 30 * 86_400_000;

  for (const j of jobs) {
    const uid = j.equipment_id;
    if (uid) {
      if (!perUnit.has(uid)) {
        perUnit.set(uid, {
          equipment_id: uid,
          type_name: j.equipment_units?.equipment_types?.name ?? 'Unknown',
          capacity: j.equipment_units?.capacity ?? null,
          jobs: 0,
          total_cost: 0,
        });
      }
      const u = perUnit.get(uid);
      u.jobs += 1;
      u.total_cost += Number(j.cost_kwd ?? 0);
    }
    const tname = j.equipment_units?.equipment_types?.name;
    if (tname) {
      if (!perType.has(tname)) perType.set(tname, { name: tname, jobs: 0, cost: 0 });
      const t = perType.get(tname);
      t.jobs += 1;
      t.cost += Number(j.cost_kwd ?? 0);
    }
    const it = j.issue_type ?? 'Other';
    perIssueType.set(it, (perIssueType.get(it) ?? 0) + 1);

    if (['Open', 'In Progress'].includes(j.status)) openCount += 1;
    if (j.status === 'Completed' && j.service_date && new Date(j.service_date).getTime() >= oneMonthAgo) {
      completedLastMonthCount += 1;
    }
  }

  const topUnits = [...perUnit.values()].sort((a, b) => b.jobs - a.jobs).slice(0, 15);
  const typeStats = [...perType.values()]
    .map(t => ({ ...t, avg_cost: t.jobs ? t.cost / t.jobs : 0 }))
    .sort((a, b) => b.jobs - a.jobs);
  const fleetMedianCost = typeStats.length ? median(typeStats.map(t => t.avg_cost).filter(Number.isFinite)) : 0;

  return {
    kpis: {
      totalJobs: jobs.length,
      topUnitId: topUnits[0]?.equipment_id ?? null,
      topUnitJobs: topUnits[0]?.jobs ?? 0,
      topTypeName: typeStats[0]?.name ?? null,
      openCount,
      completedLastMonthCount,
      avgCostPerJob: jobs.length
        ? jobs.reduce((s, j) => s + Number(j.cost_kwd ?? 0), 0) / jobs.length
        : 0,
      fleetMedianCost,
    },
    series: [],
    breakdowns: {
      topUnits,
      byType: typeStats.slice(0, 10),
      byIssueType: [...perIssueType.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    },
    meta: { windowDays: days },
  };
}

function median(arr) {
  if (!arr?.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// ── 4.5 Dispatch trends ─────────────────────────────────────────────────

export async function getDispatchTrends({ days = 90 } = {}) {
  const { fromIso } = windowDays(days);

  const rows = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, return_date, status')
      .gte('dispatch_date', fromIso),
    'dispatchTrends'
  );

  const byDay = new Map();
  const byStatus = new Map();
  let turnaroundSum = 0;
  let turnaroundCount = 0;
  let pendingBacklog = 0;

  for (const d of rows) {
    const day = (d.dispatch_date ?? '').slice(0, 10);
    if (day) {
      if (!byDay.has(day)) byDay.set(day, { day, total: 0 });
      byDay.get(day).total += 1;
      const s = d.status ?? 'Unknown';
      byDay.get(day)[s] = (byDay.get(day)[s] ?? 0) + 1;
    }
    const s = d.status ?? 'Unknown';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    if (['Pending', 'Assigned'].includes(d.status)) pendingBacklog += 1;

    const t = daysBetween(d.dispatch_date, d.return_date);
    if (t != null && t >= 0) { turnaroundSum += t; turnaroundCount += 1; }
  }

  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const totalDispatches = rows.length;
  const dailyAvg = daily.length ? totalDispatches / daily.length : 0;

  return {
    kpis: {
      totalDispatches,
      dailyAvg,
      avgTurnaroundDays: turnaroundCount ? turnaroundSum / turnaroundCount : 0,
      pendingBacklog,
    },
    series: { daily },
    breakdowns: {
      byStatus: [...byStatus.entries()].map(([name, value]) => ({ name, value })),
    },
    meta: { windowDays: days },
  };
}

// ── 4.6 Return trends ───────────────────────────────────────────────────

export async function getReturnTrends({ days = 90 } = {}) {
  const { fromIso } = windowDays(days);

  const returns = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, return_date, status')
      .not('return_date', 'is', null)
      .gte('return_date', fromIso),
    'returnTrends.dispatches'
  );

  const leaseReturns = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, lease_returned_at, equipment_types(name)')
      .not('lease_returned_at', 'is', null)
      .gte('lease_returned_at', new Date(Date.now() - 365 * 86_400_000).toISOString()),
    'returnTrends.leases'
  );

  const overdue = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, status, destination, equipment_id')
      .in('status', ['Assigned', 'In Transit', 'Pending'])
      .is('return_date', null)
      .lt('dispatch_date', new Date(Date.now() - 30 * 86_400_000).toISOString()),
    'returnTrends.overdue'
  );

  const byWeek = new Map();
  for (const r of returns) {
    const wk = weekKey(r.return_date);
    if (!wk) continue;
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
  }

  const byMonthLease = new Map();
  for (const l of leaseReturns) {
    const m = (l.lease_returned_at ?? '').slice(0, 7);
    if (!m) continue;
    byMonthLease.set(m, (byMonthLease.get(m) ?? 0) + 1);
  }

  const now = Date.now();
  const avgDaysOut = overdue.length
    ? overdue.reduce((s, r) => {
        const d = daysBetween(r.dispatch_date, new Date(now));
        return d == null ? s : s + d;
      }, 0) / overdue.length
    : 0;

  return {
    kpis: {
      rentalReturnsWindow: returns.length,
      leaseReturnsWindow: leaseReturns.length,
      overdueCount: overdue.length,
      avgDaysOutForOverdue: Math.round(avgDaysOut),
    },
    series: {
      byWeek: [...byWeek.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week)),
      byMonthLease: [...byMonthLease.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    },
    breakdowns: { overdue: overdue.slice(0, 10) },
    meta: { windowDays: days },
  };
}

function weekKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const daysOff = (d.getDay() + 6) % 7; // ISO-ish
  d.setDate(d.getDate() - daysOff);
  const wk = Math.ceil(((d - oneJan) / 86_400_000 + oneJan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// ── 4.7 Equipment utilization rate ──────────────────────────────────────

export async function getUtilization() {
  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, status, location, equipment_types(name, category)'),
    'utilization'
  );

  const perType = new Map();
  let totalInUse = 0, totalMaint = 0, totalAll = 0;

  for (const u of units) {
    const name = u.equipment_types?.name ?? 'Unknown';
    const cat = u.equipment_types?.category ?? 'Uncategorised';
    const key = `${cat}|${name}`;
    if (!perType.has(key)) {
      perType.set(key, { category: cat, name, total: 0, in_use: 0, idle: 0, in_maint: 0 });
    }
    const t = perType.get(key);
    t.total += 1;
    totalAll += 1;
    if (['Dispatched', 'Reserved'].includes(u.status)) { t.in_use += 1; totalInUse += 1; }
    else if (u.status === 'Available') t.idle += 1;
    else if (u.status === 'Maintenance') { t.in_maint += 1; totalMaint += 1; }
  }

  const rows = [...perType.values()].map(t => ({
    ...t,
    utilization_pct: (t.total - t.in_maint) > 0
      ? Math.round(t.in_use * 100 / (t.total - t.in_maint))
      : 0,
  }));
  rows.sort((a, b) => b.utilization_pct - a.utilization_pct);

  const fleetUtil = (totalAll - totalMaint) > 0
    ? Math.round(totalInUse * 100 / (totalAll - totalMaint))
    : 0;

  return {
    kpis: {
      fleetUtilPct: fleetUtil,
      totalUnits: totalAll,
      inUse: totalInUse,
      inMaint: totalMaint,
      topName: rows[0]?.name ?? null,
      topPct: rows[0]?.utilization_pct ?? 0,
      lowName: rows[rows.length - 1]?.name ?? null,
      lowPct: rows[rows.length - 1]?.utilization_pct ?? 0,
    },
    series: [],
    breakdowns: { byType: rows },
    meta: {},
  };
}

// ── 4.8 Revenue by equipment category ───────────────────────────────────

export async function getRevenueByCategory({ days = 90 } = {}) {
  const { fromIso } = windowDays(days);
  const fromDate = fromIso.slice(0, 10);

  // Rental revenue: invoices → quotations → quotation_items → equipment_units → equipment_types
  const invoices = await safeQuery(
    supabase
      .from('invoices')
      .select('invoice_id, quotation_id, status, total_amount_kwd, amount_paid_kwd, issue_date')
      .gte('issue_date', fromDate)
      .in('status', ['Sent', 'Paid', 'Partial']),
    'revByCat.invoices'
  );

  const quotationIds = [...new Set(invoices.map(i => i.quotation_id).filter(Boolean))];
  let items = [];
  if (quotationIds.length) {
    items = await safeQuery(
      supabase
        .from('quotation_items')
        .select('quotation_id, equipment_id, total_kwd, unit_rate_kwd, quantity, equipment_units(equipment_id, equipment_types(name, category))')
        .in('quotation_id', quotationIds),
      'revByCat.items'
    );
  }

  // Sum item-line KWD per quotation, then split each invoice's total_amount_kwd
  // across its items proportionally. When items are missing/zero, invoice
  // revenue is attributed to "Unallocated".
  const itemsByQuot = new Map();
  for (const it of items) {
    if (!itemsByQuot.has(it.quotation_id)) itemsByQuot.set(it.quotation_id, []);
    itemsByQuot.get(it.quotation_id).push(it);
  }

  const byCat = new Map();
  const bump = (cat, key, amount) => {
    if (!byCat.has(cat)) byCat.set(cat, { category: cat, revenue: 0, rental: 0, lease: 0 });
    byCat.get(cat).revenue += amount;
    byCat.get(cat)[key] += amount;
  };

  for (const inv of invoices) {
    const its = itemsByQuot.get(inv.quotation_id) ?? [];
    const total = Number(inv.total_amount_kwd ?? 0);
    const itemsSum = its.reduce((s, it) => s + Number(it.total_kwd ?? (it.quantity ?? 1) * (it.unit_rate_kwd ?? 0)), 0);
    if (!its.length || itemsSum <= 0) {
      bump('Unallocated', 'rental', total);
      continue;
    }
    for (const it of its) {
      const cat = it.equipment_units?.equipment_types?.category ?? 'Uncategorised';
      const line = Number(it.total_kwd ?? (it.quantity ?? 1) * (it.unit_rate_kwd ?? 0));
      const share = itemsSum > 0 ? (line / itemsSum) * total : 0;
      bump(cat, 'rental', share);
    }
  }

  // Lease revenue (paid lease_invoices)
  const leaseInv = await safeQuery(
    supabase
      .from('lease_invoices')
      .select('amount_kwd, status, paid_at, period_start, equipment_id, equipment_units(equipment_types(name, category))')
      .eq('status', 'Paid')
      .gte('paid_at', fromIso),
    'revByCat.leaseInv'
  );
  for (const li of leaseInv) {
    const cat = li.equipment_units?.equipment_types?.category ?? 'Uncategorised';
    bump(cat, 'lease', Number(li.amount_kwd ?? 0));
  }

  const rows = [...byCat.values()].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalRental = rows.reduce((s, r) => s + r.rental, 0);
  const totalLease = rows.reduce((s, r) => s + r.lease, 0);

  return {
    kpis: {
      totalRevenue,
      totalRental,
      totalLease,
      topCategory: rows[0]?.category ?? null,
      topRevenue: rows[0]?.revenue ?? 0,
      topSharePct: totalRevenue ? Math.round((rows[0]?.revenue ?? 0) * 100 / totalRevenue) : 0,
    },
    series: [],
    breakdowns: {
      byCategory: rows.map(r => ({
        ...r,
        sharePct: totalRevenue ? Math.round(r.revenue * 100 / totalRevenue) : 0,
      })),
    },
    meta: { windowDays: days, hasLineItems: items.length > 0 },
  };
}

// ── 4.9 Procurement vs leasing ──────────────────────────────────────────

export async function getProcurementVsLease({ days = 365 } = {}) {
  const { fromIso } = windowDays(days);

  const procs = await safeQuery(
    supabase
      .from('procurements')
      .select('procurement_id, type, status, total_amount_kwd, lease_monthly_kwd, created_at')
      .gte('created_at', fromIso),
    'procVsLease'
  );

  let buyCount = 0, leaseCount = 0;
  let buySpend = 0, leaseCommit = 0, leaseMonthly = 0;
  const active = procs.filter(p => !['Cancelled', 'Rejected'].includes(p.status));

  for (const p of active) {
    if (p.type === 'Buy') { buyCount += 1; buySpend += Number(p.total_amount_kwd ?? 0); }
    else if (p.type === 'Lease') {
      leaseCount += 1;
      leaseCommit += Number(p.total_amount_kwd ?? 0);
      leaseMonthly += Number(p.lease_monthly_kwd ?? 0);
    }
  }

  const avgBuyPrice = buyCount ? buySpend / buyCount : 0;
  const avgMonthly = leaseCount ? leaseMonthly / leaseCount : 0;
  const breakEvenMonths = avgMonthly > 0 ? avgBuyPrice / avgMonthly : null;
  const annualLeaseExtrapolated = leaseMonthly * 12;

  return {
    kpis: {
      buyCount, leaseCount,
      buySpend, leaseCommit,
      leaseMonthlyCommit: leaseMonthly,
      annualLeaseExtrapolated,
      breakEvenMonths,
    },
    series: [],
    breakdowns: {
      rows: [
        { type: 'Buy',   count: buyCount,   spend: buySpend,   monthly: 0 },
        { type: 'Lease', count: leaseCount, spend: leaseCommit, monthly: leaseMonthly },
      ],
    },
    meta: { windowDays: days },
  };
}

// ── 4.10 Idle vs active equipment ───────────────────────────────────────

export async function getIdleVsActive() {
  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, status, location, updated_at, equipment_types(name, category)')
      .order('updated_at', { ascending: true }),
    'idleVsActive'
  );

  let active = 0, idle = 0, maint = 0;
  const idleUnits = [];
  const byLocation = new Map();

  for (const u of units) {
    if (['Dispatched', 'Reserved'].includes(u.status)) active += 1;
    else if (u.status === 'Available') {
      idle += 1;
      idleUnits.push(u);
      if (u.location) byLocation.set(u.location, (byLocation.get(u.location) ?? 0) + 1);
    } else if (u.status === 'Maintenance') maint += 1;
  }

  // Longest idle streak = time since updated_at for status Available
  const now = Date.now();
  const longestIdle = idleUnits
    .map(u => ({
      ...u,
      idle_days: u.updated_at ? Math.floor((now - new Date(u.updated_at).getTime()) / 86_400_000) : 0,
    }))
    .sort((a, b) => b.idle_days - a.idle_days)
    .slice(0, 10);

  return {
    kpis: {
      active,
      idle,
      maint,
      total: units.length,
      idleSharePct: units.length ? Math.round(idle * 100 / units.length) : 0,
      longestIdleDays: longestIdle[0]?.idle_days ?? 0,
      longestIdleId: longestIdle[0]?.equipment_id ?? null,
    },
    series: [],
    breakdowns: {
      byStatus: [
        { name: 'Active',      value: active },
        { name: 'Idle',        value: idle },
        { name: 'Maintenance', value: maint },
      ],
      longestIdle,
      byLocation: [...byLocation.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    },
    meta: {},
  };
}

// ── 4.11 Top customers ──────────────────────────────────────────────────

export async function getTopCustomers({ days = 365 } = {}) {
  const { fromIso } = windowDays(days);

  const [customers, quotations, invoices] = await Promise.all([
    safeQuery(supabase.from('customers').select('customer_id, company_name'), 'topCustomers.customers'),
    safeQuery(
      supabase.from('quotations')
        .select('quotation_id, customer_id, status, created_at')
        .gte('created_at', fromIso),
      'topCustomers.quotations'
    ),
    safeQuery(
      supabase.from('invoices')
        .select('invoice_id, customer_id, status, total_amount_kwd, amount_paid_kwd, issue_date, created_at')
        .gte('created_at', fromIso),
      'topCustomers.invoices'
    ),
  ]);

  const map = new Map();
  const upsert = (id) => {
    if (!id) return null;
    if (!map.has(id)) map.set(id, { customer_id: id, company_name: null, approved_quotes: 0, billed_kwd: 0, paid_kwd: 0, last_quote_at: null, last_invoice_at: null });
    return map.get(id);
  };

  for (const c of customers) {
    const row = upsert(c.customer_id);
    if (row) row.company_name = c.company_name;
  }
  for (const q of quotations) {
    const row = upsert(q.customer_id);
    if (!row) continue;
    if (q.status === 'Approved') row.approved_quotes += 1;
    if (!row.last_quote_at || q.created_at > row.last_quote_at) row.last_quote_at = q.created_at;
  }
  for (const inv of invoices) {
    const row = upsert(inv.customer_id);
    if (!row) continue;
    if (['Sent', 'Paid', 'Partial'].includes(inv.status)) row.billed_kwd += Number(inv.total_amount_kwd ?? 0);
    if (inv.status === 'Paid' || inv.status === 'Partial') row.paid_kwd += Number(inv.amount_paid_kwd ?? 0);
    if (!row.last_invoice_at || inv.created_at > row.last_invoice_at) row.last_invoice_at = inv.created_at;
  }

  // Ignore customers with zero activity in the window
  const rows = [...map.values()]
    .filter(r => r.approved_quotes || r.billed_kwd)
    .sort((a, b) => b.billed_kwd - a.billed_kwd);

  const totalBilled = rows.reduce((s, r) => s + r.billed_kwd, 0);
  const top5Billed = rows.slice(0, 5).reduce((s, r) => s + r.billed_kwd, 0);

  const oneTime = rows.filter(r => r.approved_quotes === 1).length;

  const sixtyDays = Date.now() - 60 * 86_400_000;
  const atRisk = rows.slice(0, 10).filter(r => {
    const lastActivity = Math.max(
      r.last_quote_at ? new Date(r.last_quote_at).getTime() : 0,
      r.last_invoice_at ? new Date(r.last_invoice_at).getTime() : 0,
    );
    return r.billed_kwd > 0 && lastActivity < sixtyDays;
  });

  return {
    kpis: {
      topCustomer: rows[0]?.company_name ?? null,
      topBilled: rows[0]?.billed_kwd ?? 0,
      top5SharePct: totalBilled ? Math.round(top5Billed * 100 / totalBilled) : 0,
      oneTimeCount: oneTime,
      avgRevenuePerCustomer: rows.length ? totalBilled / rows.length : 0,
      totalBilled,
    },
    series: [],
    breakdowns: {
      top20: rows.slice(0, 20).map(r => ({
        ...r,
        outstanding: Math.max(0, r.billed_kwd - r.paid_kwd),
      })),
      atRisk,
    },
    meta: { windowDays: days },
  };
}

// ── 4.12 Maintenance cost trends ────────────────────────────────────────

export async function getMaintenanceCostTrends({ days = 365 } = {}) {
  const { fromIso } = windowDays(days);

  const jobs = await safeQuery(
    supabase
      .from('maintenance')
      .select('maintenance_id, service_date, completion_date, status, issue_type, cost_kwd')
      .gte('service_date', fromIso.slice(0, 10)),
    'maintCost.jobs'
  );

  const byMonth = new Map();
  const byIssueType = new Map();
  let ytd = 0, mtd = 0, totalJobs = 0, totalCost = 0;

  const now = new Date();
  const currentMonthKey = now.toISOString().slice(0, 7);
  const currentYear = now.getFullYear();

  for (const j of jobs) {
    if (j.status !== 'Completed') continue;
    totalJobs += 1;
    const cost = Number(j.cost_kwd ?? 0);
    totalCost += cost;
    const date = j.completion_date || j.service_date;
    if (!date) continue;
    const m = date.slice(0, 7);
    const y = Number(date.slice(0, 4));

    const itKey = j.issue_type || 'Other';
    if (!byMonth.has(m)) byMonth.set(m, { month: m, total: 0 });
    byMonth.get(m).total += cost;
    byMonth.get(m)[itKey] = (byMonth.get(m)[itKey] ?? 0) + cost;

    if (!byIssueType.has(itKey)) byIssueType.set(itKey, { name: itKey, cost: 0, jobs: 0 });
    byIssueType.get(itKey).cost += cost;
    byIssueType.get(itKey).jobs += 1;

    if (m === currentMonthKey) mtd += cost;
    if (y === currentYear) ytd += cost;
  }

  const series = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const topIssue = [...byIssueType.values()].sort((a, b) => b.cost - a.cost)[0];

  // month-over-month delta on total cost
  let momDeltaPct = null;
  if (series.length >= 2) {
    const last = series[series.length - 1].total;
    const prev = series[series.length - 2].total;
    if (prev > 0) momDeltaPct = Math.round(((last - prev) / prev) * 100);
  }

  return {
    kpis: {
      totalJobs,
      totalCost,
      ytdCost: ytd,
      mtdCost: mtd,
      avgCostPerJob: totalJobs ? totalCost / totalJobs : 0,
      topIssueType: topIssue?.name ?? null,
      topIssueCost: topIssue?.cost ?? 0,
      momDeltaPct,
    },
    series: { byMonth: series },
    breakdowns: {
      byIssueType: [...byIssueType.values()].sort((a, b) => b.cost - a.cost),
    },
    meta: { windowDays: days },
  };
}

// ── 4.13 Monthly operational KPIs ───────────────────────────────────────

export async function getMonthlyKPIs() {
  // "This month" = calendar month to date. "Prev month" = the full previous
  // calendar month. Both windows are computed once here so every child
  // query hits the same boundary.
  const now = new Date();
  const startThis = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endPrev   = startThis;

  const [
    invoicesThis, invoicesPrev,
    dispatchesThis, dispatchesPrev,
    maintThis, maintPrev,
    procsThis, procsPrev,
    customersThis, customersPrev,
    unitsRow,
    overdue,
  ] = await Promise.all([
    safeQuery(supabase.from('invoices').select('total_amount_kwd, amount_paid_kwd, issue_date, status').gte('issue_date', startThis.slice(0,10)), 'kpi.invThis'),
    safeQuery(supabase.from('invoices').select('total_amount_kwd, amount_paid_kwd, issue_date, status').gte('issue_date', startPrev.slice(0,10)).lt('issue_date', endPrev.slice(0,10)), 'kpi.invPrev'),
    safeQuery(supabase.from('dispatches').select('dispatch_id, dispatch_date, return_date').gte('dispatch_date', startThis), 'kpi.dispThis'),
    safeQuery(supabase.from('dispatches').select('dispatch_id, dispatch_date, return_date').gte('dispatch_date', startPrev).lt('dispatch_date', endPrev), 'kpi.dispPrev'),
    safeQuery(supabase.from('maintenance').select('maintenance_id, service_date, cost_kwd, status').gte('service_date', startThis.slice(0,10)), 'kpi.maintThis'),
    safeQuery(supabase.from('maintenance').select('maintenance_id, service_date, cost_kwd, status').gte('service_date', startPrev.slice(0,10)).lt('service_date', endPrev.slice(0,10)), 'kpi.maintPrev'),
    safeQuery(supabase.from('procurements').select('procurement_id, total_amount_kwd, status, created_at').gte('created_at', startThis), 'kpi.procThis'),
    safeQuery(supabase.from('procurements').select('procurement_id, total_amount_kwd, status, created_at').gte('created_at', startPrev).lt('created_at', endPrev), 'kpi.procPrev'),
    safeQuery(supabase.from('customers').select('customer_id, created_at').gte('created_at', startThis), 'kpi.custThis'),
    safeQuery(supabase.from('customers').select('customer_id, created_at').gte('created_at', startPrev).lt('created_at', endPrev), 'kpi.custPrev'),
    safeQuery(supabase.from('equipment_units').select('status'), 'kpi.units'),
    safeQuery(
      supabase.from('dispatches')
        .select('dispatch_id')
        .in('status', ['Assigned', 'In Transit', 'Pending'])
        .is('return_date', null)
        .lt('dispatch_date', new Date(Date.now() - 30 * 86_400_000).toISOString()),
      'kpi.overdue'
    ),
  ]);

  const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const avgTurnaround = (rows) => {
    const days = rows.map(r => daysBetween(r.dispatch_date, r.return_date)).filter(d => d != null && d >= 0);
    return days.length ? days.reduce((s, d) => s + d, 0) / days.length : 0;
  };

  const revThis = invoicesThis.filter(i => ['Sent', 'Paid', 'Partial'].includes(i.status));
  const revPrev = invoicesPrev.filter(i => ['Sent', 'Paid', 'Partial'].includes(i.status));

  let inUse = 0, allUnits = 0, inMaint = 0;
  for (const u of unitsRow) {
    allUnits += 1;
    if (['Dispatched', 'Reserved'].includes(u.status)) inUse += 1;
    else if (u.status === 'Maintenance') inMaint += 1;
  }
  const utilPct = (allUnits - inMaint) > 0 ? Math.round(inUse * 100 / (allUnits - inMaint)) : 0;

  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

  return {
    kpis: {
      revenue: sum(revThis, 'total_amount_kwd'),
      revenueDeltaPct: pct(sum(revThis, 'total_amount_kwd'), sum(revPrev, 'total_amount_kwd')),

      dispatches: dispatchesThis.length,
      dispatchesDeltaPct: pct(dispatchesThis.length, dispatchesPrev.length),
      avgTurnaroundDays: avgTurnaround(dispatchesThis),

      utilizationPct: utilPct,

      maintJobs: maintThis.length,
      maintSpend: sum(maintThis, 'cost_kwd'),
      maintSpendDeltaPct: pct(sum(maintThis, 'cost_kwd'), sum(maintPrev, 'cost_kwd')),

      procurementSpend: sum(procsThis.filter(p => !['Cancelled', 'Rejected'].includes(p.status)), 'total_amount_kwd'),
      procurementCount: procsThis.length,
      procurementDeltaPct: pct(procsThis.length, procsPrev.length),

      newCustomers: customersThis.length,
      newCustomersDeltaPct: pct(customersThis.length, customersPrev.length),

      overdueCount: overdue.length,
    },
    series: [],
    breakdowns: {},
    meta: {
      monthKey: now.toISOString().slice(0, 7),
      prevMonthKey: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7),
    },
  };
}
