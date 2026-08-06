// ═════════════════════════════════════════════════════════════════════════
// Insight templates — one function per analytics section (§§4.1–4.13).
//
// Each template is a pure function of the section's analysis result and
// returns an array of `{ severity, headline, body, cta? }` insights. The
// Analytics page renders these under each section's charts.
//
// Adding a new rule is a one-function edit here; no infra change required.
// ═════════════════════════════════════════════════════════════════════════

import { pct, kwd, insight } from './insightHelpers';

// ── 4.1 ────────────────────────────────────────────────────────────────

export function tmpl_mostRentedEquipment(result) {
  const out = [];
  const { totalRentals, topName, topRentals, topSharePct } = result.kpis;
  const byType = result.breakdowns?.byType ?? [];
  const winDays = result.meta?.windowDays ?? 30;

  if (!totalRentals) {
    out.push(insight('neutral', 'No rentals in the window',
      `No dispatches were recorded in the last ${winDays} days. Widen the range or check whether Dispatch is being logged.`));
    return out;
  }

  if (topSharePct >= 40 && byType[1] && topRentals >= 2 * byType[1].rentals) {
    out.push(insight('warning', `${topName} concentrates ${topSharePct}% of rentals`,
      `A single category is driving most rental volume. A supply outage in this line would materially cut revenue — consider redundant sourcing or a stock uplift.`));
  }

  const top5 = byType.slice(0, 5).reduce((s, x) => s + x.rentals, 0);
  if (byType.length > 5 && top5 / totalRentals >= 0.8) {
    out.push(insight('neutral', 'Long tail is not contributing',
      `Your top 5 categories account for ${pct(top5, totalRentals)} of rentals. Review the bottom categories for divestment or promotional pricing.`));
  }

  if (totalRentals < winDays / 30) {
    out.push(insight('warning', 'Low rental activity',
      `Fewer than 1 rental per day on average over the last ${winDays} days. This may indicate a demand slump or a data-logging gap.`));
  }

  if (topSharePct > 0 && topRentals > 0 && !out.length) {
    out.push(insight('positive', `${topName} is your top revenue driver`,
      `${topName} accounts for ${topSharePct}% of rentals this period across ${byType.length} categories dispatched — steady leadership.`));
  }

  return out;
}

// ── 4.2 ────────────────────────────────────────────────────────────────

export function tmpl_mostProcuredEquipment(result) {
  const out = [];
  const { totalCount, totalSpend, buyCount, leaseCount, buySharePct } = result.kpis;
  const monthly = result.series?.byMonth ?? [];

  if (!totalCount) {
    out.push(insight('neutral', 'No procurement activity',
      'No procurement records were created in the window. Growth here should track demand — check with Procurement if this looks off.'));
    return out;
  }

  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const lastN = (last.Buy ?? 0) + (last.Lease ?? 0) + (last.Other ?? 0);
    const prevN = (prev.Buy ?? 0) + (prev.Lease ?? 0) + (prev.Other ?? 0);
    if (prevN > 0 && (lastN - prevN) / prevN >= 0.25) {
      out.push(insight('positive', `Procurement momentum: +${Math.round(((lastN - prevN)/prevN)*100)}%`,
        `Purchase requests are accelerating month-on-month (${prevN} → ${lastN}). Ensure Finance is sighted on the cash-flow implications.`));
    }
  }

  if (buySharePct > 80) {
    out.push(insight('neutral', `${buySharePct}% of procurement is CapEx`,
      `Buy is dominating the mix (${buyCount} vs ${leaseCount} lease). If lease demand is growing, consider shifting new equipment to lease for CapEx relief.`));
  }

  out.push(insight('neutral', `Committed spend: ${kwd(totalSpend)}`,
    `Across ${totalCount} procurement records with an average deal size of ${kwd(result.kpis.avgDealSize)}.`));

  return out;
}

// ── 4.3 ────────────────────────────────────────────────────────────────

export function tmpl_recentLeases(result) {
  const out = [];
  const { newLeases, monthlyCommit, expiring30 } = result.kpis;

  if (expiring30 >= 5) {
    out.push(insight('warning', `${expiring30} leases expire within 30 days`,
      `Start renewal conversations now — a bulk expiry cluster is a revenue cliff if any of these customers churn.`));
  }

  if (newLeases === 0) {
    out.push(insight('warning', 'No new leases signed',
      'The recent-lease pipeline is dry. Coordinate with Sales on lead flow.'));
  } else {
    out.push(insight('positive', `${newLeases} new leases in the window`,
      `${kwd(monthlyCommit)} of monthly commitment locked in. Average term ${result.kpis.avgTermDays} days.`));
  }

  return out;
}

// ── 4.4 ────────────────────────────────────────────────────────────────

export function tmpl_maintenanceFrequency(result) {
  const out = [];
  const { topUnitJobs, topUnitId, topTypeName, openCount, completedLastMonthCount, fleetMedianCost, avgCostPerJob } = result.kpis;
  const byType = result.breakdowns?.byType ?? [];

  if (!result.kpis.totalJobs) {
    out.push(insight('neutral', 'No maintenance activity',
      'No maintenance jobs recorded in the window.'));
    return out;
  }

  if (topUnitJobs >= 5) {
    out.push(insight('warning', `${topUnitId} is a retire candidate`,
      `This unit has been in the shop ${topUnitJobs} times in the analysis window. Compare accumulated cost to residual value before authorising the next repair.`));
  }

  const topType = byType[0];
  if (topType && fleetMedianCost > 0 && topType.avg_cost > 2 * fleetMedianCost) {
    out.push(insight('warning', `${topTypeName} costs 2× the fleet median`,
      `Consider phasing out this model or negotiating a service contract — average cost per job is ${kwd(topType.avg_cost)} vs a fleet median of ${kwd(fleetMedianCost)}.`));
  }

  if (openCount > completedLastMonthCount) {
    out.push(insight('critical', 'Maintenance backlog is growing',
      `${openCount} open/in-progress jobs vs only ${completedLastMonthCount} completed last month. Add capacity or escalate.`));
  }

  if (!out.length) {
    out.push(insight('positive', 'Maintenance load looks healthy',
      `${result.kpis.totalJobs} jobs handled with an average cost of ${kwd(avgCostPerJob)} per job.`));
  }
  return out;
}

// ── 4.5 ────────────────────────────────────────────────────────────────

export function tmpl_dispatchTrends(result) {
  const out = [];
  const { pendingBacklog, dailyAvg, avgTurnaroundDays, totalDispatches } = result.kpis;

  if (!totalDispatches) {
    out.push(insight('neutral', 'No dispatch activity', 'No dispatches in the selected window.'));
    return out;
  }

  if (pendingBacklog > 2 * dailyAvg && dailyAvg > 0) {
    out.push(insight('critical', 'Operational congestion',
      `Pending backlog (${pendingBacklog}) is more than 2× the daily average (${dailyAvg.toFixed(1)}). Consider adding dispatch capacity today.`));
  }

  if (avgTurnaroundDays > 10) {
    out.push(insight('warning', `Turnaround averaging ${avgTurnaroundDays.toFixed(1)} days`,
      'Longer turnaround directly reduces utilization. Review whether return logging is timely or whether crews need reinforcement.'));
  }

  if (!out.length) {
    out.push(insight('positive', 'Dispatch pipeline is healthy',
      `${totalDispatches} dispatches in the window, ${dailyAvg.toFixed(1)}/day average.`));
  }
  return out;
}

// ── 4.6 ────────────────────────────────────────────────────────────────

export function tmpl_returnTrends(result) {
  const out = [];
  const { overdueCount, avgDaysOutForOverdue } = result.kpis;

  if (overdueCount > 10) {
    out.push(insight('critical', `${overdueCount} overdue returns`,
      `Average ${avgDaysOutForOverdue} days out. Route to the Operations Manager for collections escalation.`));
  } else if (overdueCount > 0) {
    out.push(insight('warning', `${overdueCount} overdue returns`,
      `Average ${avgDaysOutForOverdue} days past the 30-day threshold. Follow up before this becomes a collections issue.`));
  } else {
    out.push(insight('positive', 'No overdue rentals',
      'All active dispatches are within the 30-day return threshold.'));
  }
  return out;
}

// ── 4.7 ────────────────────────────────────────────────────────────────

export function tmpl_utilization(result) {
  const out = [];
  const { fleetUtilPct, topName, topPct, lowName, lowPct, totalUnits } = result.kpis;

  if (!totalUnits) {
    out.push(insight('neutral', 'No equipment records', 'Nothing in equipment_units yet.'));
    return out;
  }

  if (fleetUtilPct > 85) {
    out.push(insight('warning', `Fleet utilisation at ${fleetUtilPct}% — capacity ceiling`,
      'The fleet is running near maximum. Prepare a procurement plan before dispatches start being turned away.'));
  } else if (fleetUtilPct < 30) {
    out.push(insight('warning', `Fleet utilisation at ${fleetUtilPct}% — overstock`,
      'Most equipment is sitting idle. Consider a promotional lease-out or divestment on the coldest categories.'));
  } else {
    out.push(insight('positive', `Fleet utilisation at ${fleetUtilPct}%`,
      `${topName ?? '—'} leads at ${topPct}%; ${lowName ?? '—'} trails at ${lowPct}%.`));
  }

  return out;
}

// ── 4.8 ────────────────────────────────────────────────────────────────

export function tmpl_revenueByCategory(result) {
  const out = [];
  const { totalRevenue, topCategory, topSharePct, totalRental, totalLease } = result.kpis;
  const rows = result.breakdowns?.byCategory ?? [];

  if (!totalRevenue) {
    out.push(insight('neutral', 'No revenue attributed',
      'No invoices in the window matched the aggregation. If line items are missing an equipment link, revenue falls into Unallocated.'));
    return out;
  }

  if (topSharePct > 50) {
    out.push(insight('warning', `${topCategory} concentrates ${topSharePct}% of revenue`,
      'A downturn in this single category would materially impact P&L. Diversify or protect this line with dedicated support.'));
  }

  const leaseShare = totalRevenue ? Math.round((totalLease * 100) / totalRevenue) : 0;
  out.push(insight('neutral', `Rental ${pct(totalRental, totalRevenue)} · Lease ${leaseShare}%`,
    `${kwd(totalRevenue)} total revenue across ${rows.length} categor${rows.length === 1 ? 'y' : 'ies'}.`));

  return out;
}

// ── 4.9 ────────────────────────────────────────────────────────────────

export function tmpl_procurementVsLease(result) {
  const out = [];
  const { breakEvenMonths, buyCount, leaseCount, buySpend, leaseMonthlyCommit, annualLeaseExtrapolated } = result.kpis;

  if (!buyCount && !leaseCount) {
    out.push(insight('neutral', 'No procurement records', 'Nothing to compare in the selected window.'));
    return out;
  }

  if (breakEvenMonths != null && breakEvenMonths < 18) {
    out.push(insight('positive', `Buy break-even in ${breakEvenMonths.toFixed(0)} months`,
      'Given typical hold periods, buying is the lower-cost option for the categories in scope.'));
  } else if (breakEvenMonths != null && breakEvenMonths > 36) {
    out.push(insight('positive', `Buy break-even in ${breakEvenMonths.toFixed(0)}+ months`,
      'Leasing remains the cheaper option. Continue prioritising lease deals over CapEx.'));
  }

  out.push(insight('neutral', 'Buy vs Lease snapshot',
    `Buy: ${buyCount} units · ${kwd(buySpend)} committed. Lease: ${leaseCount} units · ${kwd(leaseMonthlyCommit)}/mo (~${kwd(annualLeaseExtrapolated)}/yr).`));

  return out;
}

// ── 4.10 ───────────────────────────────────────────────────────────────

export function tmpl_idleVsActive(result) {
  const out = [];
  const { idle, active, idleSharePct, longestIdleDays, longestIdleId, total } = result.kpis;

  if (!total) {
    out.push(insight('neutral', 'No equipment records', 'Nothing in equipment_units yet.'));
    return out;
  }

  if (longestIdleDays > 60 && longestIdleId) {
    out.push(insight('warning', `${longestIdleId} has been idle ${longestIdleDays} days`,
      'Consider remarketing, redeploying to a busier warehouse, or moving toward divestment.'));
  }

  if (idleSharePct > 40) {
    out.push(insight('warning', `${idleSharePct}% of the fleet is idle`,
      'Oversupply signal — align procurement pace with actual dispatch demand.'));
  } else {
    out.push(insight('positive', 'Live fleet state',
      `${active} active · ${idle} idle · ${result.kpis.maint} in maintenance.`));
  }

  return out;
}

// ── 4.11 ───────────────────────────────────────────────────────────────

export function tmpl_topCustomers(result) {
  const out = [];
  const { top5SharePct, topCustomer, topBilled } = result.kpis ?? {};
  const outstandingRows = (result.breakdowns?.top20 ?? []).filter(r => r.outstanding > 0.2 * r.billed_kwd && r.billed_kwd > 0);

  if (!topCustomer) {
    out.push(insight('neutral', 'No customer activity',
      'No customers had billing or approved quotations in the window.'));
    return out;
  }

  if (top5SharePct > 60) {
    out.push(insight('warning', `Top 5 customers = ${top5SharePct}% of revenue`,
      'Customer-concentration risk. Diversifying the book protects against a single-account loss.'));
  }

  if (result.breakdowns?.atRisk?.length) {
    const first = result.breakdowns.atRisk[0];
    out.push(insight('warning', `${first.company_name} is quiet`,
      `A top-10 customer with billing but no quote or invoice activity in 60+ days. Re-engage before the account drifts.`));
  }

  if (outstandingRows.length) {
    const worst = outstandingRows[0];
    out.push(insight('critical', `${worst.company_name}: ${kwd(worst.outstanding)} outstanding`,
      `${pct(worst.outstanding, worst.billed_kwd)} of billing is unpaid. Route to Finance for follow-up.`));
  }

  if (!out.length) {
    out.push(insight('positive', `${topCustomer} is your #1 account`,
      `${kwd(topBilled)} billed in the window.`));
  }
  return out;
}

// ── 4.12 ───────────────────────────────────────────────────────────────

export function tmpl_maintenanceCostTrends(result) {
  const out = [];
  const { totalCost, ytdCost, avgCostPerJob, topIssueType, topIssueCost, momDeltaPct } = result.kpis;

  if (!result.kpis.totalJobs) {
    out.push(insight('neutral', 'No completed maintenance', 'Nothing to plot yet.'));
    return out;
  }

  if (momDeltaPct != null && momDeltaPct > 30) {
    out.push(insight('warning', `Maintenance spend up ${momDeltaPct}% MoM`,
      'Spike detected. Investigate whether a specific unit or issue type is driving the jump.'));
  }

  if (topIssueType && totalCost > 0 && topIssueCost / totalCost > 0.5) {
    out.push(insight('warning', `${topIssueType} is ${pct(topIssueCost, totalCost)} of spend`,
      'A dominant failure mode is often a root-cause investigation opportunity — bulk-fixing seals, filters, or software can pay back quickly.'));
  }

  out.push(insight('neutral', 'YTD maintenance',
    `${kwd(ytdCost)} year-to-date · ${kwd(avgCostPerJob)} average per job.`));

  return out;
}

// ── 4.13 ───────────────────────────────────────────────────────────────

export function tmpl_monthlyKPIs(result) {
  const out = [];
  const k = result.kpis;

  const rev = k.revenue;
  const revDelta = k.revenueDeltaPct;
  const dispDelta = k.dispatchesDeltaPct;
  const maintDelta = k.maintSpendDeltaPct;

  if (revDelta != null && revDelta > 10 && k.utilizationPct > 80) {
    out.push(insight('positive', 'Healthy growth',
      `Revenue ${revDelta > 0 ? 'up' : 'down'} ${Math.abs(revDelta)}% MoM at ${k.utilizationPct}% utilisation. Fleet is monetising well.`));
  }

  if (revDelta != null && Math.abs(revDelta) < 5 && maintDelta != null && maintDelta > 10) {
    out.push(insight('warning', 'Margin squeeze',
      `Revenue flat while maintenance spend rose ${maintDelta}% MoM. Cost per revenue unit is rising.`));
  }

  if (k.overdueCount > 0) {
    out.push(insight('warning', `${k.overdueCount} overdue returns`,
      'Route to the Operations Manager for collections.'));
  }

  out.push(insight('neutral', `${kwd(rev)} revenue this month`,
    `${k.dispatches} dispatches (${dispDelta != null ? (dispDelta >= 0 ? '+' : '') + dispDelta + '%' : ''}) · ${k.newCustomers} new customers.`));

  return out;
}
