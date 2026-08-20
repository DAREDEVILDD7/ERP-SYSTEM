// ═════════════════════════════════════════════════════════════════════════
// Insight templates — one function per analytics section (§§4.1–4.13).
//
// Each template is a pure function of the section's analysis result and
// returns an array of `{ severity, headline, body, cta? }` insights. The
// Analytics page renders these under each section's charts.
//
// Adding a new rule is a one-function edit here; no infra change required.
//
// ── House style, so every section reads like the same analyst ────────────
// A template answers the question that was asked FIRST, in a named subject —
// "Forklift 3T", never "FL0007" — then works outward through the same four
// moves, emitting only the ones its data actually supports:
//
//   1. the answer         — what is the top line, by name, quantified
//   2. the comparison     — against the previous period, the fleet average,
//                           or the rest of the book; never a bare number
//   3. the risk           — concentration, backlog, staleness, exposure
//   4. what to do         — one concrete next step, addressed to whoever
//                           owns it
//
// and closes with a one-line summary so a reader who stops after the first
// screen still leaves with the totals. Every claim is derived from a figure
// in `result`; nothing is asserted that the data cannot support, and a
// missing baseline is stated as missing rather than silently rendered as 0%.
// `trim()` caps the list so a data-rich window cannot bury the answer under
// a dozen bullets — it always preserves the lead and the closing summary.
// ═════════════════════════════════════════════════════════════════════════

import { pct, kwd, insight } from './insightHelpers';
import { trendPhrase, describeRange } from './analyticsLabels';

// ── Local helpers ───────────────────────────────────────────────────────

const s = (n) => (Number(n) === 1 ? '' : 's');

function n1(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(1) : '0.0';
}

// "up 18% against the previous 90 days" — the standard comparison clause.
// Returns null when there is no baseline, so callers can fall through to a
// different sentence instead of printing "up null%".
function vsPrev(delta, windowDays, { prev, current, unit } = {}) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const figures = (prev !== undefined && current !== undefined)
    ? ` (${prev}${unit ?? ''} → ${current}${unit ?? ''})`
    : '';
  return `${trendPhrase(delta)} against the previous ${windowDays} days${figures}`;
}

// Caps the bullet list without ever dropping the lead or the closing
// summary: those are the two the reader is guaranteed to see.
function trim(out, max = 6) {
  if (out.length <= max) return out;
  const head = out.slice(0, max - 1);
  head.push(out[out.length - 1]);
  return head;
}

// ── 4.1 ────────────────────────────────────────────────────────────────

export function tmpl_mostRentedEquipment(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    totalRentals, topName, topRentals, topSharePct, topTrendPct,
    rentalsDeltaPct, prevTotalRentals, distinctUnits, distinctTypes,
    busiestUnitLabel, busiestUnitRentals, avgPerUnit, dailyAvg,
  } = k;
  const byType = result.breakdowns?.byType ?? [];
  const byDestination = result.breakdowns?.byDestination ?? [];
  const winDays = result.meta?.windowDays ?? 30;

  if (!totalRentals) {
    out.push(insight('neutral', 'No rentals in the window',
      `No dispatches were recorded in the last ${winDays} days. Widen the range or check whether Dispatch is being logged.`));
    return out;
  }

  // 1 — the answer, by name.
  if (topName) {
    const trend = topTrendPct !== null && topTrendPct !== undefined
      ? ` Demand for it is ${trendPhrase(topTrendPct)} against the previous period.`
      : '';
    out.push(insight(
      topSharePct >= 50 ? 'warning' : 'positive',
      `${topName} leads with ${topRentals} rental${s(topRentals)}`,
      `${topSharePct}% of all ${totalRentals} dispatches over ${winDays} days, across ${byType[0]?.unitsUsed ?? 0} unit${s(byType[0]?.unitsUsed)} of that type.${trend}`,
    ));
  }

  // 2 — the comparison against the previous window.
  const overall = vsPrev(rentalsDeltaPct, winDays, {
    prev: prevTotalRentals, current: totalRentals,
  });
  if (overall && Math.abs(rentalsDeltaPct) >= 10) {
    out.push(insight(rentalsDeltaPct > 0 ? 'positive' : 'warning',
      `Rental volume ${trendPhrase(rentalsDeltaPct)}`,
      `${totalRentals} dispatches this period, ${overall}. ${rentalsDeltaPct > 0
        ? 'Check the fleet has the depth to hold this rate before quoting further out.'
        : 'Worth confirming with Sales whether this is seasonality or lost demand.'}`));
  }

  // The fastest-moving line is a different question from the biggest one.
  const surging = byType
    .filter(t => t.trendPct !== null && t.trendPct >= 40 && t.rentals >= 3 && t.type_id !== byType[0]?.type_id)
    .sort((a, b) => b.trendPct - a.trendPct)[0];
  if (surging) {
    out.push(insight('neutral', `${surging.name} is the fastest-growing line`,
      `${surging.prevRentals} → ${surging.rentals} rentals, ${trendPhrase(surging.trendPct)} on the previous ${winDays} days. It is not the largest line yet, but it is the one moving.`));
  }

  // A line that has gone quiet is as actionable as one that is growing.
  const fading = byType
    .filter(t => t.trendPct !== null && t.trendPct <= -40 && t.prevRentals >= 3)
    .sort((a, b) => a.trendPct - b.trendPct)[0];
  if (fading) {
    out.push(insight('warning', `${fading.name} demand ${trendPhrase(fading.trendPct)}`,
      `${fading.prevRentals} → ${fading.rentals} rentals against the previous ${winDays} days. If this holds, the units behind it are the first candidates for redeployment or remarketing.`));
  }

  // 3 — the risks: single-line concentration and single-unit dependency.
  if (topSharePct >= 40 && byType[1] && topRentals >= 2 * byType[1].rentals) {
    out.push(insight('warning', `Rental volume concentrated in one line`,
      `${topName} carries ${topSharePct}% of rentals and more than double the next line (${byType[1].name}, ${byType[1].rentals}). A supply outage here would cut revenue materially — consider redundant sourcing or a stock uplift.`));
  }

  if (busiestUnitLabel && busiestUnitRentals >= 3 && avgPerUnit > 0
      && busiestUnitRentals >= 2.5 * avgPerUnit) {
    out.push(insight('warning', `${busiestUnitLabel} is carrying an outsized share`,
      `${busiestUnitRentals} dispatches against a fleet average of ${avgPerUnit} per unit — ${n1(busiestUnitRentals / avgPerUnit)}×. Concentrating hours on one asset accelerates its wear and puts a single breakdown between you and a missed booking.`));
  }

  const top5 = byType.slice(0, 5).reduce((sum, x) => sum + x.rentals, 0);
  if (byType.length > 5 && top5 / totalRentals >= 0.8) {
    out.push(insight('neutral', 'The long tail is not contributing',
      `The top 5 of ${distinctTypes} types account for ${pct(top5, totalRentals)} of rentals. Review the bottom of the list for divestment or promotional pricing.`));
  }

  if (dailyAvg > 0 && dailyAvg < 1 && winDays >= 30) {
    out.push(insight('warning', 'Low rental activity',
      `${n1(dailyAvg)} dispatches per day over ${winDays} days. That is either a genuine demand slump or a logging gap in Dispatch — worth ruling the second out first.`));
  }

  // 4 — closing summary.
  const destClause = byDestination[0]
    ? ` Most activity routed to ${byDestination[0].name} (${byDestination[0].value} dispatch${byDestination[0].value === 1 ? '' : 'es'}).`
    : '';
  out.push(insight('neutral', `${totalRentals} rentals across ${distinctTypes} type${s(distinctTypes)}`,
    `${distinctUnits} distinct unit${s(distinctUnits)} dispatched at ${avgPerUnit} rental${s(avgPerUnit)} each, ${n1(dailyAvg)} per day.${destClause}`));

  return trim(out);
}

// ── 4.2 ────────────────────────────────────────────────────────────────

export function tmpl_mostProcuredEquipment(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    totalCount, totalSpend, buyCount, leaseCount, buySharePct,
    topEquipmentName, topEquipmentSharePct, spendDeltaPct, countDeltaPct,
    distinctSuppliers, topSupplierName, topSupplierSharePct,
  } = k;
  const monthly = result.series?.byMonth ?? [];
  const equipment = result.breakdowns?.byEquipment ?? [];
  const suppliers = result.breakdowns?.bySupplier ?? [];
  const winDays = result.meta?.windowDays ?? 90;

  if (!totalCount) {
    out.push(insight('neutral', 'No procurement activity',
      'No procurement records were created in the window. Growth here should track demand — check with Procurement if this looks off.'));
    return out;
  }

  // The equipment answer comes first, because that is what was asked.
  const top = equipment[0];
  if (top) {
    out.push(insight(
      topEquipmentSharePct >= 50 ? 'warning' : 'positive',
      `${top.name} is the most procured line`,
      `${top.quantity} unit${s(top.quantity)} at ${kwd(top.spend)} — ${topEquipmentSharePct}% of itemised spend over ${winDays} days, averaging ${kwd(top.avgUnitCost)} per unit across ${top.supplierCount} supplier${s(top.supplierCount)}.`,
    ));
  } else if (!result.meta?.hasLineItems) {
    out.push(insight('warning', 'Spend cannot be attributed to equipment',
      'Procurement records in this window carry no line items, so there is no equipment-level ranking. Capturing items against each procurement is what unlocks this analysis.'));
  }

  // Single-supplier concentration on a material line is a real sourcing risk.
  const soleSourced = equipment.filter(r => r.supplierCount === 1 && r.spend > 0);
  if (soleSourced.length && totalSpend > 0) {
    const share = soleSourced.reduce((sum, r) => sum + r.spend, 0);
    if (share / Math.max(1, k.equipmentSpend) >= 0.3) {
      out.push(insight('warning', `${soleSourced.length} equipment line${s(soleSourced.length)} sole-sourced`,
        `${pct(share, k.equipmentSpend)} of itemised spend comes from a single supplier per line — ${soleSourced.slice(0, 3).map(r => r.name).join(', ')}${soleSourced.length > 3 ? ' and others' : ''}. Qualify an alternate before a lead-time shock forces the issue.`));
    }
  }

  // Supplier-side concentration is the other half of the same exposure and
  // is invisible in a per-equipment view: three lines can each look
  // dual-sourced while one vendor sits behind most of the money.
  if (topSupplierName && topSupplierSharePct >= 50 && distinctSuppliers > 1) {
    out.push(insight('warning', `${topSupplierName} holds ${topSupplierSharePct}% of supplier spend`,
      `${kwd(k.topSupplierSpend)} of ${kwd(totalSpend)} across ${distinctSuppliers} supplier${s(distinctSuppliers)}, covering ${suppliers[0]?.equipmentCount ?? 0} equipment line${s(suppliers[0]?.equipmentCount)}. Renegotiation leverage and continuity risk both sit with one relationship.`));
  }

  // Fastest-growing line, measured against the same-length previous window.
  const surging = equipment
    .filter(r => r.trendPct !== null && r.trendPct >= 50 && r.quantity >= 2)
    .sort((a, b) => b.trendPct - a.trendPct)[0];
  if (surging) {
    out.push(insight('neutral', `${surging.name} demand up ${surging.trendPct}%`,
      `${surging.prevQuantity} → ${surging.quantity} units against the previous ${winDays} days. If this is a trend rather than a one-off, the reorder point for this line needs revisiting.`));
  }

  // A unit price well above the rest of the book is a negotiation opening.
  const priced = equipment.filter(r => r.avgUnitCost > 0 && r.quantity >= 2);
  if (priced.length >= 3) {
    const avgUnit = priced.reduce((sum, r) => sum + r.avgUnitCost, 0) / priced.length;
    const dear = [...priced].sort((a, b) => b.avgUnitCost - a.avgUnitCost)[0];
    if (avgUnit > 0 && dear.avgUnitCost >= 2 * avgUnit) {
      out.push(insight('neutral', `${dear.name} costs ${n1(dear.avgUnitCost / avgUnit)}× the average unit price`,
        `${kwd(dear.avgUnitCost)} per unit against ${kwd(avgUnit)} across the itemised book. That may be entirely correct for the specification — but it is the line where a benchmarking exercise would pay back fastest.`));
    }
  }

  if (spendDeltaPct !== null && Math.abs(spendDeltaPct) >= 15) {
    out.push(insight(spendDeltaPct > 0 ? 'warning' : 'positive',
      `Procurement spending ${spendDeltaPct > 0 ? 'increased' : 'decreased'} ${Math.abs(spendDeltaPct)}%`,
      `${kwd(k.prevSpend)} → ${kwd(totalSpend)} versus the previous ${winDays} days${countDeltaPct !== null && countDeltaPct !== undefined
        ? `, on ${trendPhrase(countDeltaPct)} order volume` : ''}. ${spendDeltaPct > 0
        ? 'Confirm the cash-flow impact is planned for.'
        : 'Check this reflects lower demand rather than stalled requisitions.'}`));
  } else if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const lastN = (last.Buy ?? 0) + (last.Lease ?? 0) + (last.Other ?? 0);
    const prevN = (prev.Buy ?? 0) + (prev.Lease ?? 0) + (prev.Other ?? 0);
    if (prevN > 0 && (lastN - prevN) / prevN >= 0.25) {
      out.push(insight('positive', `Procurement momentum: +${Math.round(((lastN - prevN) / prevN) * 100)}%`,
        `Purchase requests are accelerating month-on-month (${prevN} → ${lastN}). Ensure Finance is sighted on the cash-flow implications.`));
    }
  }

  if (buySharePct > 80) {
    out.push(insight('neutral', `${buySharePct}% of procurement is CapEx`,
      `Buy is dominating the mix (${buyCount} vs ${leaseCount} lease). If lease demand is growing, consider shifting new equipment to lease for CapEx relief.`));
  }

  out.push(insight('neutral', `Committed spend: ${kwd(totalSpend)}`,
    `Across ${totalCount} procurement record${s(totalCount)} with an average deal size of ${kwd(k.avgDealSize)}${topEquipmentName ? `, spanning ${k.distinctEquipment} distinct equipment line${s(k.distinctEquipment)} and ${distinctSuppliers} supplier${s(distinctSuppliers)}` : ''}.`));

  return trim(out);
}

// ── 4.3 ────────────────────────────────────────────────────────────────

export function tmpl_recentLeases(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    newLeases, monthlyCommit, expiring30, expiring60, avgTermDays,
    activeLeases, activeMonthlyCommit, monthlyAtRisk30, atRiskSharePct,
    expiredCount, newLeasesDeltaPct, prevNewLeases, topLeaseTypeName,
    soonestExpiryLabel, soonestExpiryDays,
  } = k;
  const expiringSoon = result.breakdowns?.expiringSoon ?? [];
  const byType = result.breakdowns?.byType ?? [];
  const winDays = result.meta?.windowDays ?? 30;

  // Anything already past its end date and not returned is a live billing
  // and compliance question, so it leads regardless of everything else.
  if (expiredCount > 0) {
    out.push(insight('critical', `${expiredCount} lease${s(expiredCount)} past the end date`,
      `${expiredCount} unit${s(expiredCount)} ${expiredCount === 1 ? 'is' : 'are'} still out with an expired lease and no recorded return. Either the renewal was never booked or the return was never logged — both need closing before the next invoice run.`));
  }

  if (expiring30 >= 5) {
    out.push(insight('warning', `${expiring30} leases expire within 30 days`,
      `${kwd(monthlyAtRisk30)} of monthly income — ${atRiskSharePct}% of the ${kwd(activeMonthlyCommit)} lease book — comes up for renewal inside a month. Start those conversations now; a bulk expiry cluster is a revenue cliff if any of these customers churn.`));
  } else if (expiring30 > 0) {
    out.push(insight('warning', `${expiring30} lease${s(expiring30)} expiring within 30 days`,
      `${kwd(monthlyAtRisk30)} per month is up for renewal${soonestExpiryLabel
        ? `, soonest ${soonestExpiryLabel} in ${soonestExpiryDays} day${s(soonestExpiryDays)}`
        : ''}. ${expiringSoon.length > 1 ? 'Sequence the renewals by end date rather than by account size.' : 'Confirm the renewal intent before the end date passes.'}`));
  }

  if (newLeases === 0) {
    out.push(insight('warning', 'No new leases signed',
      `The recent-lease pipeline is dry over the last ${winDays} days${prevNewLeases > 0 ? `, against ${prevNewLeases} in the period before` : ''}. Coordinate with Sales on lead flow before the expiry cluster above lands.`));
  } else {
    const trend = vsPrev(newLeasesDeltaPct, winDays, { prev: prevNewLeases, current: newLeases });
    out.push(insight(newLeasesDeltaPct !== null && newLeasesDeltaPct < -25 ? 'warning' : 'positive',
      `${newLeases} new lease${s(newLeases)} in the window`,
      `${kwd(monthlyCommit)} of new monthly commitment locked in at an average term of ${avgTermDays} days${trend ? ` — ${trend}` : ''}.`));
  }

  // Concentration inside the lease book itself.
  if (byType.length > 1 && activeMonthlyCommit > 0) {
    const lead = byType[0];
    const share = Math.round(lead.monthly * 100 / activeMonthlyCommit);
    if (share >= 50) {
      out.push(insight('warning', `${lead.name} is ${share}% of the lease book`,
        `${kwd(lead.monthly)} per month across ${lead.units} unit${s(lead.units)}. A single customer decision on this line moves the majority of lease income.`));
    }
  }

  if (expiring60 > 0 && expiring30 === 0) {
    out.push(insight('neutral', `${expiring60} lease${s(expiring60)} expiring in 31–60 days`,
      'Nothing lapses this month, which makes now the cheap time to open the renewal conversation rather than the urgent one.'));
  }

  out.push(insight('neutral', `${activeLeases} active lease${s(activeLeases)} · ${kwd(activeMonthlyCommit)}/month`,
    `${topLeaseTypeName ? `${topLeaseTypeName} is the largest line by commitment. ` : ''}${expiring30 + expiring60} unit${s(expiring30 + expiring60)} come up for renewal within 60 days.`));

  return trim(out);
}

// ── 4.4 ────────────────────────────────────────────────────────────────

export function tmpl_maintenanceFrequency(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    topUnitJobs, topUnitLabel, topTypeName, openCount, completedLastMonthCount,
    fleetMedianCost, avgCostPerJob, fleetAvgJobs, totalDowntimeDays, unitsInvolved,
  } = k;
  const byType = result.breakdowns?.byType ?? [];
  const units = result.breakdowns?.topUnits ?? [];
  const byIssueType = result.breakdowns?.byIssueType ?? [];
  const winDays = result.meta?.windowDays ?? 180;

  if (!k.totalJobs) {
    out.push(insight('neutral', 'No maintenance activity',
      'No maintenance jobs recorded in the window.'));
    return out;
  }

  const top = units[0];

  // Lead with the unit, by name, and quantify "significantly above average"
  // rather than asserting it.
  if (top && fleetAvgJobs > 0 && top.jobs >= 3 && top.jobs >= 1.5 * fleetAvgJobs) {
    out.push(insight('warning', `${top.label} is well above the fleet average`,
      `${top.jobs} maintenance visits in ${winDays} days against a fleet average of ${fleetAvgJobs} — ${n1(top.jobs / fleetAvgJobs)}×. ${top.downtime_days} days out of service and ${kwd(top.total_cost)} spent.`));
  }

  if (top && topUnitJobs >= 5) {
    out.push(insight('critical', `${topUnitLabel} may be approaching replacement`,
      `${topUnitJobs} shop visits${top.avg_interval_days != null ? ` at an average of one every ${top.avg_interval_days} days` : ''} and ${kwd(top.total_cost)} of accumulated repair cost. Maintenance frequency at this level normally means the economic case has shifted — compare against residual value before authorising the next repair.`));
  }

  // A short repair interval is the signal that a fix is not holding.
  const repeatOffenders = units.filter(u => u.avg_interval_days != null && u.avg_interval_days < 30 && u.jobs >= 3);
  if (repeatOffenders.length) {
    const r = repeatOffenders[0];
    out.push(insight('warning', `${r.label} returns every ${r.avg_interval_days} days`,
      `${repeatOffenders.length} unit${repeatOffenders.length === 1 ? ' is' : 's are'} back in the workshop inside a month of the previous repair. That pattern usually means the root cause is being missed rather than the asset simply ageing.`));
  }

  // Downtime concentration — a different question from visit count.
  if (top && totalDowntimeDays > 0 && top.downtime_days / totalDowntimeDays >= 0.3) {
    out.push(insight('warning', `${top.label} is ${pct(top.downtime_days, totalDowntimeDays)} of all downtime`,
      `${top.downtime_days} of ${totalDowntimeDays} lost fleet-days sit with a single unit. Availability, not just repair cost, is what this is costing.`));
  }

  // A unit that is expensive per visit is a different problem from one that
  // visits often, and the two rarely have the same fix.
  const costly = [...units]
    .filter(u => u.jobs >= 2 && u.avg_cost > 0)
    .sort((a, b) => b.avg_cost - a.avg_cost)[0];
  if (costly && avgCostPerJob > 0 && costly.avg_cost >= 2 * avgCostPerJob
      && costly.equipment_id !== top?.equipment_id) {
    out.push(insight('warning', `${costly.label} costs ${n1(costly.avg_cost / avgCostPerJob)}× the average visit`,
      `${kwd(costly.avg_cost)} per job against a fleet average of ${kwd(avgCostPerJob)} over ${costly.jobs} visit${s(costly.jobs)}. Few visits but expensive ones usually means major-component work rather than routine servicing — worth a condition assessment.`));
  }

  // A unit long overdue for service is a failure waiting to be scheduled.
  const overdue = units
    .filter(u => u.avg_interval_days != null && u.days_since_last != null
      && u.days_since_last > 2 * u.avg_interval_days && u.jobs >= 3)
    .sort((a, b) => b.days_since_last - a.days_since_last)[0];
  if (overdue) {
    out.push(insight('neutral', `${overdue.label} is overdue against its own pattern`,
      `Last serviced ${overdue.days_since_last} days ago against an average interval of ${overdue.avg_interval_days} days. Either the servicing has genuinely slipped or the unit has been standing — both are worth confirming before it is next dispatched.`));
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

  const dominant = byIssueType[0];
  if (dominant && k.totalJobs > 0 && dominant.value / k.totalJobs >= 0.4 && byIssueType.length > 1) {
    out.push(insight('neutral', `${dominant.name} accounts for ${pct(dominant.value, k.totalJobs)} of jobs`,
      `${dominant.value} of ${k.totalJobs} tickets share one failure mode across ${unitsInvolved} unit${s(unitsInvolved)}. A dominant mode across multiple assets is usually a specification, operator-technique or servicing-interval issue rather than bad luck.`));
  }

  out.push(insight(out.length ? 'neutral' : 'positive',
    `${k.totalJobs} job${s(k.totalJobs)} · ${totalDowntimeDays} fleet-days down · ${kwd(avgCostPerJob)} average`,
    `Across ${unitsInvolved} unit${s(unitsInvolved)} over ${winDays} days${openCount ? `, with ${openCount} job${s(openCount)} still open` : ', with nothing currently open'}.`));

  return trim(out);
}

// ── 4.5 ────────────────────────────────────────────────────────────────

export function tmpl_dispatchTrends(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    pendingBacklog, dailyAvg, avgTurnaroundDays, totalDispatches,
    dispatchesDeltaPct, prevTotalDispatches, turnaroundDeltaPct,
    prevAvgTurnaroundDays, completionPct, busiestDay, busiestDayCount,
    backlogVsDailyAvg, topEquipmentName, topDestination,
  } = k;
  const byStatus = result.breakdowns?.byStatus ?? [];
  const byEquipment = result.breakdowns?.byEquipment ?? [];
  const winDays = result.meta?.windowDays ?? 90;

  if (!totalDispatches) {
    out.push(insight('neutral', 'No dispatch activity', 'No dispatches in the selected window.'));
    return out;
  }

  // 1 + 2 — volume, always against the baseline.
  const trend = vsPrev(dispatchesDeltaPct, winDays, {
    prev: prevTotalDispatches, current: totalDispatches,
  });
  out.push(insight(
    dispatchesDeltaPct !== null && dispatchesDeltaPct <= -20 ? 'warning'
      : dispatchesDeltaPct !== null && dispatchesDeltaPct >= 20 ? 'positive' : 'neutral',
    `${totalDispatches} dispatches at ${n1(dailyAvg)}/day`,
    trend
      ? `Volume is ${trend}. ${dispatchesDeltaPct >= 20
        ? 'Confirm crew and fleet capacity can hold this rate.'
        : dispatchesDeltaPct <= -20
          ? 'Worth separating a genuine demand drop from a logging lag before acting on it.'
          : 'Broadly steady period on period.'}`
      : `No comparable activity in the previous ${winDays} days, so this window has no baseline to measure against.`,
  ));

  // 3 — congestion and turnaround.
  if (pendingBacklog > 2 * dailyAvg && dailyAvg > 0) {
    out.push(insight('critical', 'Operational congestion',
      `Pending backlog (${pendingBacklog}) is ${backlogVsDailyAvg}× the daily average of ${n1(dailyAvg)} — roughly ${backlogVsDailyAvg} days of work already queued. Add dispatch capacity today or start sequencing by customer commitment.`));
  } else if (pendingBacklog > 0) {
    out.push(insight('neutral', `${pendingBacklog} dispatch${pendingBacklog === 1 ? '' : 'es'} pending`,
      `About ${backlogVsDailyAvg ?? '—'} day${backlogVsDailyAvg === 1 ? '' : 's'} of queued work at the current rate — within normal working depth.`));
  }

  if (turnaroundDeltaPct !== null && turnaroundDeltaPct !== undefined && Math.abs(turnaroundDeltaPct) >= 15) {
    out.push(insight(turnaroundDeltaPct > 0 ? 'warning' : 'positive',
      `Turnaround ${trendPhrase(turnaroundDeltaPct)}`,
      `${n1(prevAvgTurnaroundDays)} → ${n1(avgTurnaroundDays)} days against the previous ${winDays} days. ${turnaroundDeltaPct > 0
        ? 'Every extra day out is a day the unit cannot be re-hired — this feeds straight into utilisation.'
        : 'Faster returns free the same fleet for more hires without any capital outlay.'}`));
  } else if (avgTurnaroundDays > 10) {
    out.push(insight('warning', `Turnaround averaging ${n1(avgTurnaroundDays)} days`,
      'Longer turnaround directly reduces utilisation. Review whether return logging is timely or whether crews need reinforcement.'));
  }

  if (completionPct < 60 && totalDispatches >= 10) {
    out.push(insight('warning', `Only ${completionPct}% of dispatches have a return logged`,
      `${totalDispatches - k.completedCount} of ${totalDispatches} are still open. Some of that is genuinely on hire; the rest is unlogged returns, and the two are indistinguishable from here — which makes every turnaround and utilisation figure in this workspace conservative.`));
  }

  if (busiestDay && busiestDayCount >= 3 && dailyAvg > 0 && busiestDayCount >= 3 * dailyAvg) {
    out.push(insight('neutral', `Peak day was ${busiestDayCount} dispatches`,
      `${busiestDay} ran at ${n1(busiestDayCount / dailyAvg)}× the daily average. If peaks like this are predictable, staffing to the peak rather than the mean is what keeps turnaround flat.`));
  }

  const statusLine = byStatus
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map(x => `${x.value} ${x.name.toLowerCase()}`)
    .join(' · ');
  out.push(insight('neutral', `${totalDispatches} dispatches over ${winDays} days`,
    `${statusLine || 'No status breakdown available'}.${topEquipmentName ? ` ${topEquipmentName} moved most often${byEquipment[0] ? ` (${byEquipment[0].dispatches})` : ''}.` : ''}${topDestination ? ` Busiest destination: ${topDestination}.` : ''}`));

  return trim(out);
}

// ── 4.6 ────────────────────────────────────────────────────────────────

export function tmpl_returnTrends(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    overdueCount, avgDaysOutForOverdue, rentalReturnsWindow, prevRentalReturns,
    returnsDeltaPct, avgReturnDays, worstOverdueLabel, worstOverdueDays,
    overdueOver60, overdueOver90, leaseReturnsWindow,
  } = k;
  const overdue = result.breakdowns?.overdue ?? [];
  const byDestination = result.breakdowns?.overdueByDestination ?? [];
  const winDays = result.meta?.windowDays ?? 90;

  if (overdueCount > 10) {
    out.push(insight('critical', `${overdueCount} overdue returns`,
      `Averaging ${avgDaysOutForOverdue} days out against a 30-day threshold${overdueOver90 ? `, and ${overdueOver90} of them past 90 days` : ''}. Route to the Operations Manager for collections escalation — at this volume it is a process failure, not a set of individual late returns.`));
  } else if (overdueCount > 0) {
    out.push(insight('warning', `${overdueCount} overdue return${s(overdueCount)}`,
      `Averaging ${avgDaysOutForOverdue} days out against the 30-day threshold. Follow up before this becomes a collections issue.`));
  } else {
    out.push(insight('positive', 'No overdue rentals',
      `All active dispatches are within the 30-day return threshold${rentalReturnsWindow ? `, and ${rentalReturnsWindow} unit${s(rentalReturnsWindow)} came back inside the window` : ''}.`));
  }

  // The single worst unit, by NAME — the one the collections call is about.
  if (worstOverdueLabel && worstOverdueDays > 60) {
    out.push(insight('critical', `${worstOverdueLabel} has been out ${worstOverdueDays} days`,
      `${worstOverdueDays - 30} days past the return threshold${overdue[0]?.destination ? `, last recorded at ${overdue[0].destination}` : ''}. At this age the question is whether the unit is recoverable at all — escalate beyond a reminder call.`));
  }

  if (overdueOver60 > 1) {
    out.push(insight('warning', `${overdueOver60} unit${s(overdueOver60)} out for more than 60 days`,
      `These are no longer late returns — they are unbilled assets off the balance sheet's working fleet. Each one is also a unit that cannot be re-hired, so the cost is the lost rental as well as the recovery.`));
  }

  const trend = vsPrev(returnsDeltaPct, winDays, {
    prev: prevRentalReturns, current: rentalReturnsWindow,
  });
  if (trend && Math.abs(returnsDeltaPct) >= 15) {
    out.push(insight('neutral', `Return volume ${trendPhrase(returnsDeltaPct)}`,
      `${rentalReturnsWindow} returns logged this period, ${trend}. Read this alongside dispatch volume — returns falling while dispatches hold means units are staying out longer.`));
  }

  if (avgReturnDays > 0) {
    out.push(insight(avgReturnDays > 30 ? 'warning' : 'neutral',
      `Average hire length ${n1(avgReturnDays)} days`,
      `Measured across ${rentalReturnsWindow} completed return${s(rentalReturnsWindow)} in the window. ${avgReturnDays > 30
        ? 'Above the 30-day threshold the overdue rule is written against, which suggests the threshold and the actual hire pattern have drifted apart.'
        : 'Comfortably inside the 30-day threshold the overdue rule uses.'}`));
  }

  if (byDestination.length && overdueCount > 0 && byDestination[0].value > 1) {
    out.push(insight('neutral', `Overdue units cluster at ${byDestination[0].name}`,
      `${byDestination[0].value} of ${overdueCount} overdue unit${s(overdueCount)} are at one site. A single collection run recovers more than a round of individual chase calls.`));
  }

  out.push(insight('neutral', `${rentalReturnsWindow} rental · ${leaseReturnsWindow} lease returns`,
    `Over the last ${winDays} days, with ${overdueCount} unit${s(overdueCount)} currently past the return threshold.`));

  return trim(out);
}

// ── 4.7 ────────────────────────────────────────────────────────────────

export function tmpl_utilization(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    fleetUtilPct, topName, topPct, lowName, lowPct, totalUnits,
    idleCount, inMaint, medianUtilPct, spreadPct, coldTypeCount, hotTypeCount,
    coldNames, hotNames, maintDragPct, typesTracked, topLocation, topLocationUtilPct,
  } = k;
  const cold = result.breakdowns?.cold ?? [];
  const byLocation = result.breakdowns?.byLocation ?? [];

  if (!totalUnits) {
    out.push(insight('neutral', 'No equipment records', 'Nothing in equipment_units yet.'));
    return out;
  }

  if (fleetUtilPct > 85) {
    out.push(insight('warning', `Fleet utilisation at ${fleetUtilPct}% — capacity ceiling`,
      `${k.inUse} of ${totalUnits - inMaint} hireable units are out. At this level the next enquiry is likely to be turned away rather than quoted — prepare a procurement plan or bring forward the returns in the overdue list.`));
  } else if (fleetUtilPct < 30) {
    out.push(insight('warning', `Fleet utilisation at ${fleetUtilPct}% — overstock`,
      `${idleCount} unit${s(idleCount)} available and unhired. Consider a promotional lease-out or divestment on the coldest lines before committing further capital to the fleet.`));
  } else {
    out.push(insight('positive', `Fleet utilisation at ${fleetUtilPct}%`,
      `${k.inUse} of ${totalUnits - inMaint} hireable units on hire${topName ? `; ${topName} leads at ${topPct}%` : ''}${lowName ? ` and ${lowName} trails at ${lowPct}%` : ''}.`));
  }

  // A healthy average can hide two unhealthy halves, which is the single
  // most common way a utilisation number misleads.
  if (spreadPct >= 60 && typesTracked >= 3) {
    out.push(insight('warning', `Utilisation is uneven across the fleet`,
      `${spreadPct} points separate the busiest and quietest lines, with a median of ${medianUtilPct}% against the ${fleetUtilPct}% average. The fleet-level figure is hiding both a capacity squeeze and idle capital — they need different responses.`));
  }

  if (coldTypeCount > 0) {
    out.push(insight('warning', `${coldTypeCount} line${s(coldTypeCount)} below 30% utilisation`,
      `${coldNames.join(', ')}${coldTypeCount > coldNames.length ? ' and others' : ''} — ${cold.reduce((sum, r) => sum + r.idle, 0)} idle unit${s(cold.reduce((sum, r) => sum + r.idle, 0))} between them. These are the candidates for redeployment, promotional pricing or divestment, in that order of cost.`));
  }

  if (hotTypeCount > 0 && fleetUtilPct <= 85) {
    out.push(insight('neutral', `${hotTypeCount} line${s(hotTypeCount)} running above 85%`,
      `${hotNames.join(', ')}${hotTypeCount > hotNames.length ? ' and others' : ''} are effectively fully committed while the fleet average sits at ${fleetUtilPct}%. Adding depth here — or moving idle stock from the cold lines toward the same customers — is cheaper than a broad fleet uplift.`));
  }

  if (maintDragPct >= 15) {
    out.push(insight('warning', `${maintDragPct}% of the fleet is in the workshop`,
      `${inMaint} of ${totalUnits} unit${s(totalUnits)} cannot be hired out at all. Utilisation is measured on the hireable fleet, so this is invisible in the headline figure — but it is real lost capacity.`));
  }

  if (byLocation.length > 1 && topLocation) {
    const quiet = [...byLocation].sort((a, b) => a.utilization_pct - b.utilization_pct)[0];
    if (quiet && topLocationUtilPct - quiet.utilization_pct >= 30) {
      out.push(insight('neutral', `${topLocation} is working harder than ${quiet.name}`,
        `${topLocationUtilPct}% against ${quiet.utilization_pct}% utilisation. Where the equipment is comparable, relocating stock is the cheapest capacity increase available.`));
    }
  }

  out.push(insight('neutral', `${k.inUse} on hire · ${idleCount} idle · ${inMaint} in maintenance`,
    `Across ${totalUnits} unit${s(totalUnits)} and ${typesTracked} equipment line${s(typesTracked)}, live as of now.`));

  return trim(out);
}

// ── 4.8 ────────────────────────────────────────────────────────────────

export function tmpl_revenueByCategory(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    totalRevenue, topCategory, topSharePct, totalRental, totalLease,
    revenueDeltaPct, prevRevenue, leaseSharePct, top3SharePct,
    topEquipmentName, topEquipmentRevenue, topEquipmentSharePct,
    unallocatedPct, invoiceCount, avgInvoiceValue, categoriesEarning,
  } = k;
  const rows = result.breakdowns?.byCategory ?? [];
  const byEquipment = result.breakdowns?.byEquipment ?? [];
  const winDays = result.meta?.windowDays ?? 90;

  if (!totalRevenue) {
    out.push(insight('neutral', 'No revenue attributed',
      'No invoices in the window matched the aggregation. If line items are missing an equipment link, revenue falls into Unallocated.'));
    return out;
  }

  // Lead with the named earner, not the category — a category is a bucket,
  // an equipment line is something the business can act on.
  if (topEquipmentName && topEquipmentSharePct > 0) {
    out.push(insight(topEquipmentSharePct >= 50 ? 'warning' : 'positive',
      `${topEquipmentName} is the largest single earner`,
      `${kwd(topEquipmentRevenue)} — ${topEquipmentSharePct}% of ${kwd(totalRevenue)} over ${winDays} days, across ${byEquipment.length} earning line${s(byEquipment.length)}.`));
  }

  const trend = vsPrev(revenueDeltaPct, winDays);
  if (trend && Math.abs(revenueDeltaPct) >= 10) {
    out.push(insight(revenueDeltaPct > 0 ? 'positive' : 'warning',
      `Revenue ${trendPhrase(revenueDeltaPct)} period on period`,
      `${kwd(prevRevenue)} → ${kwd(totalRevenue)} against the previous ${winDays} days. ${revenueDeltaPct > 0
        ? 'Check the growth is being carried by margin as well as volume — read this next to maintenance spend.'
        : 'Identify whether the fall is fewer invoices or smaller ones; the two have different fixes.'}`));
  }

  if (topSharePct > 50) {
    out.push(insight('warning', `${topCategory} concentrates ${topSharePct}% of revenue`,
      `A downturn in this single category would materially impact P&L${top3SharePct >= 90 ? `, and the top 3 carry ${top3SharePct}% between them` : ''}. Diversify or protect this line with dedicated support.`));
  } else if (top3SharePct >= 85 && categoriesEarning > 3) {
    out.push(insight('neutral', `Top 3 categories carry ${top3SharePct}% of revenue`,
      `No single category dominates, but the earning base is narrow across ${categoriesEarning} categor${categoriesEarning === 1 ? 'y' : 'ies'}. Worth knowing which of the three is most exposed to a single customer.`));
  }

  // The rental/lease mix is a cash-flow shape question, not just a split.
  if (leaseSharePct >= 40) {
    out.push(insight('positive', `Lease income is ${leaseSharePct}% of revenue`,
      `${kwd(totalLease)} of ${kwd(totalRevenue)} arrives as recurring lease billing rather than one-off rentals. That is the more predictable half of the book — protecting the renewals behind it is worth more than an equivalent rental uplift.`));
  } else if (leaseSharePct > 0 && leaseSharePct < 15) {
    out.push(insight('neutral', `Only ${leaseSharePct}% of revenue is recurring`,
      `${kwd(totalRental)} of ${kwd(totalRevenue)} comes from one-off rentals. A rental-weighted book has to be re-won every period; converting the steadiest customers to leases would smooth it.`));
  }

  // Attribution quality, stated plainly — the figures above are only as good
  // as this.
  if (unallocatedPct >= 20) {
    out.push(insight('warning', `${unallocatedPct}% of revenue is unallocated`,
      `${kwd(rows.find(r => r.category === 'Unallocated')?.revenue ?? 0)} could not be traced to an equipment category, because those invoices have no quotation line items behind them. Every category share above is understated by an unknown slice of that.`));
  }

  out.push(insight('neutral', `${kwd(totalRevenue)} across ${categoriesEarning} categor${categoriesEarning === 1 ? 'y' : 'ies'}`,
    `Rental ${pct(totalRental, totalRevenue)} · Lease ${leaseSharePct}% · ${invoiceCount} invoice${s(invoiceCount)} averaging ${kwd(avgInvoiceValue)}.`));

  return trim(out);
}

// ── 4.9 ────────────────────────────────────────────────────────────────

export function tmpl_procurementVsLease(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    breakEvenMonths, buyCount, leaseCount, buySpend, leaseMonthlyCommit,
    annualLeaseExtrapolated, avgBuyPrice, avgLeaseMonthly, buySharePct,
    comparableLines, buyFavouredCount, leaseFavouredCount, mixShiftPct,
    earlyBuyShare, lateBuyShare, cancelledCount,
  } = k;
  const comparable = result.breakdowns?.comparable ?? [];
  const byEquipment = result.breakdowns?.byEquipment ?? [];
  const winDays = result.meta?.windowDays ?? 365;

  if (!buyCount && !leaseCount) {
    out.push(insight('neutral', 'No procurement records', 'Nothing to compare in the selected window.'));
    return out;
  }

  if (breakEvenMonths != null && breakEvenMonths < 18) {
    out.push(insight('positive', `Buy break-even in ${Math.round(breakEvenMonths)} months`,
      `An average purchase of ${kwd(avgBuyPrice)} against an average lease of ${kwd(avgLeaseMonthly)}/month. Given typical hold periods, buying is the lower-cost option for the categories in scope.`));
  } else if (breakEvenMonths != null && breakEvenMonths > 36) {
    out.push(insight('positive', `Buy break-even in ${Math.round(breakEvenMonths)}+ months`,
      `An average purchase of ${kwd(avgBuyPrice)} would take over three years to beat ${kwd(avgLeaseMonthly)}/month of lease cost. Leasing remains the cheaper option — continue prioritising lease deals over CapEx.`));
  } else if (breakEvenMonths != null) {
    out.push(insight('neutral', `Buy break-even in ${Math.round(breakEvenMonths)} months`,
      `Between 18 and 36 months, the decision turns on how long the asset is actually held rather than on price. Buy where the utilisation is proven; lease where the demand is a trial.`));
  } else {
    out.push(insight('neutral', 'No like-for-like break-even available',
      `${buyCount} purchase${s(buyCount)} and ${leaseCount} lease${s(leaseCount)} in the window, but not both with the pricing needed to compare. Recording lease monthly rates alongside purchase totals is what makes this comparison possible.`));
  }

  // The fleet-wide break-even blends everything; the per-line answer is the
  // one anybody can act on.
  if (comparableLines > 0) {
    const clearest = [...comparable].sort((a, b) => (a.breakEvenMonths ?? 0) - (b.breakEvenMonths ?? 0))[0];
    out.push(insight('neutral', `${comparableLines} line${s(comparableLines)} can be compared directly`,
      `${buyFavouredCount} favour buying, ${leaseFavouredCount} favour leasing${clearest ? `. ${clearest.name} is the clearest case at ${Math.round(clearest.breakEvenMonths)} months to break even` : ''}. The fleet-wide figure above averages across very different assets — decide per line.`));
  }

  // Direction of travel in the mix.
  if (mixShiftPct != null && Math.abs(mixShiftPct) >= 20) {
    out.push(insight('neutral', `The mix has shifted ${Math.abs(mixShiftPct)} points toward ${mixShiftPct > 0 ? 'buying' : 'leasing'}`,
      `CapEx was ${earlyBuyShare}% of new procurement early in the window and ${lateBuyShare}% recently. ${mixShiftPct > 0
        ? 'Confirm the balance sheet impact is intentional rather than the result of individual approvals.'
        : 'That relieves CapEx but builds a recurring commitment — check the lease book against the renewal cliff.'}`));
  }

  if (buySharePct > 80 && leaseCount > 0) {
    out.push(insight('warning', `${buySharePct}% of procurement is CapEx`,
      `${kwd(buySpend)} committed outright against ${kwd(leaseMonthlyCommit)}/month of lease. Where a line's utilisation is unproven, leasing keeps the exit cheap — buying does not.`));
  }

  if (annualLeaseExtrapolated > 0 && buySpend > 0 && annualLeaseExtrapolated > buySpend) {
    out.push(insight('warning', 'Annualised lease cost now exceeds purchase spend',
      `${kwd(annualLeaseExtrapolated)}/year of lease commitment against ${kwd(buySpend)} of purchases over ${winDays} days. On the lines that are being leased indefinitely, that is rent being paid on an asset that would already have been owned.`));
  }

  if (cancelledCount > 0) {
    out.push(insight('neutral', `${cancelledCount} procurement${s(cancelledCount)} cancelled or rejected`,
      'Excluded from every figure above, since a cancelled order was never committed spend. A high rate here is worth reviewing as a requisition-quality issue in its own right.'));
  }

  out.push(insight('neutral', 'Buy vs Lease snapshot',
    `Buy: ${buyCount} unit${s(buyCount)} · ${kwd(buySpend)} committed. Lease: ${leaseCount} unit${s(leaseCount)} · ${kwd(leaseMonthlyCommit)}/mo (~${kwd(annualLeaseExtrapolated)}/yr)${byEquipment.length ? ` across ${byEquipment.length} equipment line${s(byEquipment.length)}` : ''}.`));

  return trim(out);
}

// ── 4.10 ───────────────────────────────────────────────────────────────

export function tmpl_idleVsActive(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    idle, active, idleSharePct, longestIdleDays, longestIdleLabel, total,
    maint, idleOver30, idleOver60, idleOver90, avgIdleDays,
    coldestTypeName, coldestTypeIdle, coldestTypeTotal, topIdleLocation,
    maintSharePct,
  } = k;
  const byLocation = result.breakdowns?.byLocation ?? [];

  if (!total) {
    out.push(insight('neutral', 'No equipment records', 'Nothing in equipment_units yet.'));
    return out;
  }

  // The name, not the id — the id is tooltip-only everywhere in this module.
  if (longestIdleDays > 60 && longestIdleLabel) {
    out.push(insight('warning', `${longestIdleLabel} has been idle ${longestIdleDays} days`,
      `Two months without a dispatch is past the point where the unit is simply between hires. Consider remarketing, redeploying to a busier yard, or moving toward divestment.`));
  }

  if (idleSharePct > 40) {
    out.push(insight('warning', `${idleSharePct}% of the fleet is idle`,
      `${idle} of ${total} unit${s(total)} are available and unhired, averaging ${avgIdleDays} days since last movement. Oversupply signal — align procurement pace with actual dispatch demand before the next order.`));
  }

  // Stale stock is a sharper signal than the idle count itself: 20 units
  // idle for three days is a working buffer, 20 idle for three months is not.
  if (idleOver90 > 0) {
    out.push(insight('critical', `${idleOver90} unit${s(idleOver90)} idle for over 90 days`,
      `These have not moved in a quarter. At that age the carrying cost — yard space, insurance, depreciation, periodic servicing — is being paid against no revenue at all. This is the divestment shortlist.`));
  } else if (idleOver60 > 0) {
    out.push(insight('warning', `${idleOver60} unit${s(idleOver60)} idle for over 60 days`,
      `Beyond two months, idle stock stops being a buffer and starts being cost. Redeploy or remarket before it reaches the 90-day mark.`));
  } else if (idleOver30 > 0) {
    out.push(insight('neutral', `${idleOver30} unit${s(idleOver30)} idle for over 30 days`,
      'Worth a look, but still inside the range where normal demand cycles explain it.'));
  }

  if (coldestTypeName && coldestTypeIdle >= 2 && coldestTypeIdle === coldestTypeTotal) {
    out.push(insight('warning', `Every ${coldestTypeName} is sitting idle`,
      `All ${coldestTypeTotal} unit${s(coldestTypeTotal)} of this line are unhired. A whole line at zero utilisation is a demand question, not a scheduling one — either the market has moved or the line is not being offered.`));
  }

  if (maintSharePct >= 15) {
    out.push(insight('warning', `${maint} unit${s(maint)} (${maintSharePct}%) in maintenance`,
      'A workshop holding this much of the fleet is itself a capacity constraint. Read this against the maintenance backlog before concluding the fleet is too small.'));
  }

  if (topIdleLocation && byLocation.length > 1 && byLocation[0].value >= 3) {
    out.push(insight('neutral', `Idle stock concentrates at ${topIdleLocation}`,
      `${byLocation[0].value} of ${idle} idle unit${s(idle)} sit at one location. If demand is elsewhere, relocation is the cheapest way to lift utilisation — no purchase required.`));
  }

  out.push(insight(out.length ? 'neutral' : 'positive', 'Live fleet state',
    `${active} active · ${idle} idle · ${maint} in maintenance across ${total} unit${s(total)}.`));

  return trim(out);
}

// ── 4.11 ───────────────────────────────────────────────────────────────

export function tmpl_topCustomers(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    top5SharePct, topCustomer, topBilled, topTrendPct, totalBilled,
    billedDeltaPct, prevTotalBilled, collectionRatePct, totalOutstanding,
    activeCustomers, avgRevenuePerCustomer, oneTimeCount,
    fastestGrowingName, fastestGrowingPct, largestDeclineName, largestDeclinePct,
    worstDebtorName, worstDebtorOutstanding,
  } = k;
  const outstandingRows = (result.breakdowns?.top20 ?? [])
    .filter(r => r.outstanding > 0.2 * r.billed_kwd && r.billed_kwd > 0);
  const winDays = result.meta?.windowDays ?? 365;

  if (!topCustomer) {
    out.push(insight('neutral', 'No customer activity',
      'No customers had billing or approved quotations in the window.'));
    return out;
  }

  out.push(insight('positive', `${topCustomer} is the largest account`,
    `${kwd(topBilled)} billed over ${winDays} days${topTrendPct !== null && topTrendPct !== undefined
      ? `, ${trendPhrase(topTrendPct)} on the previous period` : ''} — ${pct(topBilled, totalBilled)} of ${kwd(totalBilled)} across ${activeCustomers} active account${s(activeCustomers)}.`));

  if (top5SharePct > 60) {
    out.push(insight('warning', `Top 5 customers = ${top5SharePct}% of revenue`,
      `Customer-concentration risk: losing any one of five accounts would move the P&L visibly. Diversifying the book — or locking these five into longer terms — protects against a single-account loss.`));
  }

  const trend = vsPrev(billedDeltaPct, winDays);
  if (trend && Math.abs(billedDeltaPct) >= 15) {
    out.push(insight(billedDeltaPct > 0 ? 'positive' : 'warning',
      `Billing ${trendPhrase(billedDeltaPct)} across the book`,
      `${kwd(prevTotalBilled)} → ${kwd(totalBilled)} against the previous ${winDays} days${k.growingCount || k.shrinkingCount
        ? `, with ${k.growingCount} account${s(k.growingCount)} growing and ${k.shrinkingCount} contracting` : ''}.`));
  }

  if (largestDeclineName && largestDeclinePct <= -40) {
    out.push(insight('warning', `${largestDeclineName} is down ${Math.abs(largestDeclinePct)}%`,
      `The steepest decline in the book against the previous ${winDays} days. A drop this size is usually a lost tender or a competitor, not a quiet quarter — worth a direct call rather than a report.`));
  }

  if (fastestGrowingName && fastestGrowingPct >= 50) {
    out.push(insight('positive', `${fastestGrowingName} is up ${fastestGrowingPct}%`,
      `The fastest-growing account in the window. Accounts moving this fast are where an expanded fleet allocation or a longer-term agreement pays back soonest.`));
  }

  if (result.breakdowns?.atRisk?.length) {
    const first = result.breakdowns.atRisk[0];
    out.push(insight('warning', `${first.company_name} has gone quiet`,
      `A top-10 customer with ${kwd(first.billed_kwd)} billed but no quote or invoice activity in 60+ days${result.breakdowns.atRisk.length > 1
        ? `, and ${result.breakdowns.atRisk.length - 1} other${s(result.breakdowns.atRisk.length - 1)} in the same position` : ''}. Re-engage before the account drifts.`));
  }

  if (worstDebtorName && worstDebtorOutstanding > 0 && outstandingRows.length) {
    const worst = outstandingRows[0];
    out.push(insight('critical', `${worstDebtorName}: ${kwd(worstDebtorOutstanding)} outstanding`,
      `${pct(worst.outstanding, worst.billed_kwd)} of that account's billing is unpaid, within ${kwd(totalOutstanding)} outstanding across the book (${collectionRatePct}% collected). Route to Finance for follow-up.`));
  } else if (collectionRatePct < 70 && totalBilled > 0) {
    out.push(insight('warning', `Only ${collectionRatePct}% of billing has been collected`,
      `${kwd(totalOutstanding)} outstanding across ${activeCustomers} account${s(activeCustomers)}. Revenue recognised is not cash received — this is the gap between the two.`));
  }

  out.push(insight('neutral', `${activeCustomers} active account${s(activeCustomers)} · ${kwd(totalBilled)} billed`,
    `${kwd(avgRevenuePerCustomer)} average per customer, ${oneTimeCount} one-time buyer${s(oneTimeCount)}, ${collectionRatePct}% collected.`));

  return trim(out);
}

// ── 4.12 ───────────────────────────────────────────────────────────────

export function tmpl_maintenanceCostTrends(result) {
  const out = [];
  const k = result.kpis ?? {};
  const {
    totalCost, ytdCost, avgCostPerJob, topIssueType, topIssueCost, momDeltaPct,
    halfDeltaPct, monthlyRunRate, peakMonth, peakMonthCost,
    topUnitLabel, topUnitCost, topUnitSharePct, top5UnitSharePct,
    unitsWithCost, topTypeName, topTypeCost, openJobCount, totalJobs,
  } = k;
  const byIssueType = result.breakdowns?.byIssueType ?? [];
  const byUnit = result.breakdowns?.byUnit ?? [];
  const winDays = result.meta?.windowDays ?? 365;

  if (!totalJobs) {
    out.push(insight('neutral', 'No completed maintenance', 'Nothing to plot yet.'));
    return out;
  }

  // Lead with the unit driving the spend, by name — this section previously
  // could only talk about issue types, which is not something you can action.
  if (topUnitLabel && topUnitSharePct >= 15) {
    out.push(insight(topUnitSharePct >= 30 ? 'warning' : 'neutral',
      `${topUnitLabel} is ${topUnitSharePct}% of maintenance spend`,
      `${kwd(topUnitCost)} of ${kwd(totalCost)} across ${byUnit[0]?.jobs ?? 0} completed job${s(byUnit[0]?.jobs)}${byUnit[0]?.topIssue ? `, mostly ${byUnit[0].topIssue.toLowerCase()}` : ''}. A single asset carrying this much of the budget deserves a repair-or-replace decision rather than another ticket.`));
  }

  if (top5UnitSharePct >= 70 && unitsWithCost > 5) {
    out.push(insight('warning', `5 units carry ${top5UnitSharePct}% of the cost`,
      `Out of ${unitsWithCost} unit${s(unitsWithCost)} with recorded spend. Maintenance cost is not spread across an ageing fleet — it is concentrated, which means a small number of decisions would move most of the budget.`));
  }

  if (momDeltaPct != null && momDeltaPct > 30) {
    out.push(insight('warning', `Maintenance spend up ${momDeltaPct}% month-on-month`,
      `Against a ${kwd(monthlyRunRate)} monthly run rate over the window. Single months are volatile — check the half-over-half figure below before treating this as a trend.`));
  }

  if (halfDeltaPct != null && Math.abs(halfDeltaPct) >= 20) {
    out.push(insight(halfDeltaPct > 0 ? 'warning' : 'positive',
      `Underlying spend is ${trendPhrase(halfDeltaPct)}`,
      `Comparing the second half of the ${winDays}-day window against the first — a steadier read than month-on-month, which one large repair can swing entirely. ${halfDeltaPct > 0
        ? 'A sustained rise usually means the fleet is ageing into a higher cost band rather than having a bad month.'
        : 'Whatever changed in the first half appears to be holding.'}`));
  }

  if (topIssueType && totalCost > 0 && topIssueCost / totalCost > 0.5) {
    out.push(insight('warning', `${topIssueType} is ${pct(topIssueCost, totalCost)} of spend`,
      `${byIssueType[0]?.jobs ?? 0} job${s(byIssueType[0]?.jobs)} at ${kwd((byIssueType[0]?.jobs ?? 0) > 0 ? topIssueCost / byIssueType[0].jobs : 0)} average. A dominant failure mode is a root-cause investigation opportunity — bulk-fixing seals, filters or software can pay back quickly.`));
  }

  if (peakMonth && peakMonthCost > 0 && monthlyRunRate > 0 && peakMonthCost >= 2 * monthlyRunRate) {
    out.push(insight('neutral', `${peakMonth} was the peak at ${kwd(peakMonthCost)}`,
      `${n1(peakMonthCost / monthlyRunRate)}× the ${kwd(monthlyRunRate)} monthly run rate. Worth confirming that was a one-off major repair rather than the start of a step change.`));
  }

  if (topTypeName && topTypeCost > 0 && totalCost > 0 && topTypeCost / totalCost >= 0.4) {
    out.push(insight('neutral', `${topTypeName} costs the most to keep running`,
      `${kwd(topTypeCost)} — ${pct(topTypeCost, totalCost)} of maintenance spend for this equipment line. If this line is also earning proportionally, that is simply the cost of the work; if it is not, it is the first candidate for replacement.`));
  }

  if (openJobCount > 0) {
    out.push(insight('neutral', `${openJobCount} job${s(openJobCount)} not yet completed`,
      'Excluded from every figure here — an open job has no settled cost. Real spend for this window will land above what is shown once they close.'));
  }

  out.push(insight('neutral', `${kwd(ytdCost)} year-to-date`,
    `${kwd(totalCost)} over ${winDays} days across ${totalJobs} completed job${s(totalJobs)} — ${kwd(avgCostPerJob)} average, ${kwd(monthlyRunRate)} per month.`));

  return trim(out);
}

// ── 4.13 ───────────────────────────────────────────────────────────────

export function tmpl_monthlyKPIs(result) {
  const out = [];
  const raw = result.kpis ?? {};
  const trend = result.series?.trend ?? [];
  const meta = result.meta ?? {};
  const r = describeRange(meta);
  // "this month" only when the section actually ran the calendar-month
  // default; otherwise the actual queried period so the wording matches
  // the numbers. The "monthly" name is historical — this section moves
  // with the filter now.
  const isDefaultMonth = r.rangeMode === 'rolling' && !!meta.monthKey;
  const nounThis   = isDefaultMonth ? 'this month'
    : r.rangeMode === 'allTime' ? 'across all recorded activity'
    : r.rangeMode === 'explicit' ? 'in the selected period'
    : 'in this period';
  const priorNoun  = isDefaultMonth ? 'last month'
    : (r.previousPhrase ?? 'a comparable prior period');
  const priorAdverb = isDefaultMonth ? 'month-on-month'
    : `against ${r.previousPhrase ?? 'a comparable prior period'}`;

  // The scorecard is the one section with no natural "no activity" sentinel —
  // a quiet month is still a real month and must still produce a scorecard.
  // So instead of an early return it coerces its counters, which is what
  // stops a partially-populated payload from rendering "null dispatches at
  // null% fleet utilisation". The nullable comparison fields below are
  // deliberately NOT coerced: null there means "no prior month", which every
  // branch checks for, and turning that into 0 would report "flat" for a
  // comparison that was never possible.
  const nz = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const k = {
    ...raw,
    revenue: nz(raw.revenue),
    dispatches: nz(raw.dispatches),
    newCustomers: nz(raw.newCustomers),
    utilizationPct: nz(raw.utilizationPct),
    maintSpend: nz(raw.maintSpend),
    procurementSpend: nz(raw.procurementSpend),
    overdueCount: nz(raw.overdueCount),
    collected: nz(raw.collected),
    totalOutflow: nz(raw.totalOutflow),
    fleetInMaint: nz(raw.fleetInMaint),
    fleetTotal: nz(raw.fleetTotal),
  };

  const rev = k.revenue;
  const revDelta = k.revenueDeltaPct;
  const dispDelta = k.dispatchesDeltaPct;
  const maintDelta = k.maintSpendDeltaPct;

  // ── Executive summary ────────────────────────────────────────────────
  // The scorecard is six tiles with six arrows; the summary is the single
  // sentence a director would want if they read nothing else. It is
  // composed from whichever signals actually fired rather than templated,
  // so it never claims a direction the numbers do not show.
  const moves = [];
  if (revDelta != null) moves.push(`revenue ${trendPhrase(revDelta)}`);
  if (dispDelta != null) moves.push(`dispatches ${trendPhrase(dispDelta)}`);
  if (maintDelta != null) moves.push(`maintenance ${trendPhrase(maintDelta)}`);
  const headline = revDelta == null
    ? `${kwd(rev)} revenue ${nounThis}`
    : `${kwd(rev)} revenue, ${trendPhrase(revDelta)} on ${priorNoun}`;
  const health = (revDelta ?? 0) >= 0 && (k.costRatioPct == null || k.costRatioPct < 60)
    ? 'positive' : (revDelta ?? 0) < -15 ? 'warning' : 'neutral';
  const noPriorSentence = r.hasPrior
    ? `No comparable activity in ${priorNoun}.`
    : 'No prior period is comparable — this view spans the full history.';
  out.push(insight(health, headline,
    `${moves.length ? `${moves.join(', ')}.` : noPriorSentence} `
    + `${k.dispatches} dispatch${k.dispatches === 1 ? '' : 'es'} at ${k.utilizationPct}% fleet utilisation`
    + `${k.costRatioPct != null ? `, with maintenance and procurement together consuming ${k.costRatioPct}% of billed revenue` : ''}.`));

  if (revDelta != null && revDelta > 10 && k.utilizationPct > 80) {
    out.push(insight('positive', 'Growth on a fully-worked fleet',
      `Revenue up ${revDelta}% at ${k.utilizationPct}% utilisation. The fleet is monetising well, but there is little headroom left — further growth needs capacity, not just demand.`));
  }

  if (revDelta != null && Math.abs(revDelta) < 5 && maintDelta != null && maintDelta > 10) {
    out.push(insight('warning', 'Margin squeeze',
      `Revenue flat while maintenance spend rose ${maintDelta}% ${priorAdverb}. Cost per revenue unit is rising${k.maintRatioPct != null ? ` — maintenance is now ${k.maintRatioPct}% of billing` : ''}.`));
  }

  if (k.costRatioPct != null && k.costRatioPct >= 80) {
    out.push(insight('critical', `Outflow is ${k.costRatioPct}% of billed revenue`,
      `${kwd(k.totalOutflow)} of maintenance and procurement against ${kwd(rev)} invoiced ${nounThis}. Procurement is lumpy by nature, so one large order can produce this — but if it holds sustained, it is a margin problem, not timing.`));
  }

  // Six-month context behind the single MoM arrow.
  if (trend.length >= 3) {
    const last3 = trend.slice(-3);
    const first3 = trend.slice(0, 3);
    const recent = last3.reduce((sum, r) => sum + r.revenue, 0) / last3.length;
    const older = first3.reduce((sum, r) => sum + r.revenue, 0) / first3.length;
    if (older > 0) {
      const shift = Math.round(((recent - older) / older) * 100);
      if (Math.abs(shift) >= 15) {
        out.push(insight(shift > 0 ? 'positive' : 'warning',
          `Six-month trend: revenue ${trendPhrase(shift)}`,
          `${kwd(older)} average over the first three months against ${kwd(recent)} over the last three. Month-on-month moves are noisy at this volume; this is the direction that matters.`));
      }
    }
  }

  if (k.collectionRatePct != null && k.collectionRatePct < 60 && rev > 0) {
    out.push(insight('warning', `${k.collectionRatePct}% of ${isDefaultMonth ? "this month's" : 'the period’s'} billing collected`,
      `${kwd(Math.max(0, rev - k.collected))} still outstanding on invoices issued ${nounThis}. ${isDefaultMonth ? 'Early in a month this is normal; late in one it is a collections signal.' : 'A collections gap this size is worth routing to Finance.'}`));
  }

  if (k.overdueCount > 0) {
    out.push(insight('warning', `${k.overdueCount} overdue return${s(k.overdueCount)}`,
      'Units past the 30-day return threshold are unavailable for re-hire and unbilled. Route to the Operations Manager for collections.'));
  }

  if (k.fleetInMaint > 0 && k.fleetTotal > 0 && k.fleetInMaint / k.fleetTotal >= 0.15) {
    out.push(insight('warning', `${k.fleetInMaint} of ${k.fleetTotal} units in the workshop`,
      `The utilisation figure above excludes them, so the fleet is more constrained than ${k.utilizationPct}% suggests.`));
  }

  out.push(insight('neutral', `${kwd(rev)} revenue ${nounThis}`,
    `${k.dispatches} dispatch${k.dispatches === 1 ? '' : 'es'}${dispDelta != null ? ` (${dispDelta >= 0 ? '+' : ''}${dispDelta}%)` : ''} · ${k.newCustomers} new customer${s(k.newCustomers)} · ${kwd(k.maintSpend)} maintenance · ${kwd(k.procurementSpend)} procurement.`));

  return trim(out, 7);
}

// ── 4.15 ───────────────────────────────────────────────────────────────────

export function tmpl_fleetActionQueue(result) {
  const out = [];
  const k = result.kpis ?? {};
  const idle = result.breakdowns?.idle ?? [];
  const grounded = result.breakdowns?.grounded ?? [];
  const collection = result.breakdowns?.collection ?? [];

  if (!k.totalActions) {
    out.push(insight('positive', 'No actions required',
      `All signals are clear — no Available units idle past ${k.idleThresholdDays ?? 14} days, no grounded units with open jobs, no outstanding invoices above the collection threshold.`));
    return out;
  }

  // 1 — headline: total exposure across all three signals
  out.push(insight(
    k.highPriorityCount > 0 ? 'warning' : 'neutral',
    `${k.totalActions} action${k.totalActions === 1 ? '' : 's'} requiring attention — ${kwd(k.totalExposureKwd)} total exposure`,
    `${k.highPriorityCount} high-priority${k.idleCount ? `, ${k.idleCount} idle unit${k.idleCount === 1 ? '' : 's'} (${kwd(k.totalForgoneKwd)} forgone)` : ''}${k.groundedCount ? `, ${k.groundedCount} in workshop` : ''}${k.collectionCount ? `, ${k.collectionCount} collection${k.collectionCount === 1 ? '' : 's'} (${kwd(k.totalOutstandingKwd)})` : ''}.`,
  ));

  // 2 — idle: worst unit by name
  if (idle.length > 0) {
    const worst = idle[0];
    const dayText = worst.idle_days !== null ? `${worst.idle_days} days` : 'an extended period (never previously hired)';
    out.push(insight('warning', `${worst.unit_label} idle for ${dayText}`,
      `At ${kwd(worst.rate_kwd)}/day that is ${kwd(worst.forgone_kwd)} in forgone revenue${worst.location ? ` from ${worst.location}` : ''}.${idle.length > 1 ? ` ${idle.length - 1} other unit${idle.length > 2 ? 's' : ''} also idle.` : ''}`));
  }

  // 3 — grounded: longest downtime unit
  if (grounded.length > 0) {
    const worst = grounded[0];
    const dayText = worst.days_grounded !== null ? `${worst.days_grounded} day${worst.days_grounded === 1 ? '' : 's'}` : 'an unrecorded period';
    out.push(insight('warning', `${worst.unit_label} has been in the workshop for ${dayText}`,
      `${worst.issue_type ? `Issue: ${worst.issue_type.toLowerCase()}. ` : ''}${kwd(worst.forgone_kwd)} in lost dispatch capacity — every workshop day is a day this unit cannot be hired out.`));
  }

  // 4 — collection: highest outstanding balance
  if (collection.length > 0) {
    const worst = collection[0];
    out.push(insight('critical', `${worst.company_name}: ${kwd(worst.outstanding_kwd)} outstanding`,
      `Across ${worst.invoice_count} invoice${worst.invoice_count === 1 ? '' : 's'}${worst.oldest_invoice_date ? `, oldest from ${worst.oldest_invoice_date}` : ''}. Route to Finance — revenue invoiced is not revenue received.`));
  }

  // 5 — closing summary
  out.push(insight('neutral', `${kwd(k.totalForgoneKwd)} forgone · ${kwd(k.totalOutstandingKwd)} outstanding`,
    `Total exposure ${kwd(k.totalExposureKwd)} across idle, grounded, and collection signals. High-priority items first — address in this order: collections, grounded, idle.`));

  return trim(out);
}
