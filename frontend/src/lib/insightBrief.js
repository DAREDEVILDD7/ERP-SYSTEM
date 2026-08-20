// ═════════════════════════════════════════════════════════════════════════
// Analysis brief — the "business analyst" layer over the insight templates.
//
// The templates in insightTemplates.js stay exactly as they are: pure
// functions returning `{ severity, headline, body }` bullets. This module
// reads a section's analysis result AND its template output and folds them
// into the seven fields a human analyst would lead with:
//
//   keyFinding · trend · topContributor · rootCause
//   riskLevel  · recommendedAction · confidence
//
// It is additive by design. Nothing here replaces a template, no template had
// to change shape to support it, and a section with no entry in SECTION_BRIEF
// still gets a usable brief from the generic path below.
//
// Every accessor is defensive and `buildBrief` never throws: a brief is
// decoration on top of a section that has already rendered its numbers, so
// failing to produce one must never take the section down with it.
// ═════════════════════════════════════════════════════════════════════════

import { kwd, pct } from './insightHelpers';
import { confidenceFrom, trendPhrase, describeRange } from './analyticsLabels';

// Template severities, ordered. The worst one that fired sets the risk level.
const SEVERITY_RANK = { positive: 0, neutral: 1, warning: 2, critical: 3 };
const RISK_BY_SEVERITY = ['Low', 'Low', 'Elevated', 'High'];

function worstSeverity(insights) {
  let worst = 'neutral';
  for (const i of insights ?? []) {
    if ((SEVERITY_RANK[i?.severity] ?? 1) > (SEVERITY_RANK[worst] ?? 1)) {
      worst = i.severity;
    }
  }
  return worst;
}

function firstOfSeverity(insights, severities) {
  for (const s of severities) {
    const hit = (insights ?? []).find(i => i?.severity === s);
    if (hit) return hit;
  }
  return null;
}

function dateLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Per-section accessors ───────────────────────────────────────────────
// Each returns partial brief fields; anything omitted falls back to the
// generic derivation. `k` is result.kpis, `b` result.breakdowns, `m` meta.

const SECTION_BRIEF = {
  most_procured: (k, b, m) => {
    const top = (b.byEquipment ?? [])[0] ?? null;
    const rows = b.byEquipment ?? [];
    const suppliers = new Set(rows.flatMap(r => r.suppliers ?? [])).size;
    return {
      sample: k.totalCount,
      keyFinding: top
        ? `${top.name} accounted for ${k.topEquipmentSharePct}% of procurement spend ${describeRange(m).periodPhrase} — ${kwd(top.spend)} across ${top.quantity} unit${top.quantity === 1 ? '' : 's'}.`
        : `${k.totalCount} procurement record${k.totalCount === 1 ? '' : 's'} totalling ${kwd(k.totalSpend)}, but no line items are linked to an equipment type yet.`,
      trend: k.spendDeltaPct === null
        ? `${describeRange(m).hasPrior ? `No comparable spend in ${describeRange(m).previousPhrase}, so this period has no baseline to measure against.` : 'No prior period is comparable — this view spans the full history.'}`
        : `Procurement spending is ${trendPhrase(k.spendDeltaPct)} compared with ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${kwd(k.prevSpend)} → ${kwd(k.totalSpend)}).`,
      topContributor: top
        ? {
          label: top.name,
          detail: `${top.quantity} unit${top.quantity === 1 ? '' : 's'} · ${kwd(top.spend)} · ${kwd(top.avgUnitCost)} avg · ${top.supplierCount} supplier${top.supplierCount === 1 ? '' : 's'}`,
          meta: top.type_id ? `Type ID ${top.type_id}` : null,
        }
        : null,
      rootCause: !m.hasLineItems
        ? 'Procurement records exist but carry no itemised lines, so spend cannot be attributed to specific equipment. The ranking below will populate once line items are captured.'
        : top && top.supplierCount === 1
          ? `${top.name} is sourced from a single supplier${top.suppliers?.[0] ? ` (${top.suppliers[0]})` : ''}, which concentrates both price and lead-time exposure on one relationship.`
          : top && top.trendPct !== null && top.trendPct > 40
            ? `Demand for ${top.name} rose ${top.trendPct}% against the previous period — the spend increase is volume-driven rather than a price change.`
            : suppliers > 0
              ? `Spend is spread across ${suppliers} supplier${suppliers === 1 ? '' : 's'} and ${rows.length} equipment line${rows.length === 1 ? '' : 's'}; no single sourcing anomaly stands out.`
              : null,
      recommendedAction: top && top.supplierCount === 1
        ? `Qualify a second supplier for ${top.name} before the next order cycle, and benchmark the ${kwd(top.avgUnitCost)} average unit cost against the market.`
        : k.spendDeltaPct !== null && k.spendDeltaPct > 25
          ? `Take the ${k.spendDeltaPct}% spend increase to Finance for a cash-flow review before approving the next tranche.`
          : null,
    };
  },

  maintenance_frequency: (k, b, m) => {
    const top = (b.topUnits ?? [])[0] ?? null;
    const aboveAvg = (b.topUnits ?? []).filter(u => u.jobs > k.fleetAvgJobs * 1.5);
    return {
      sample: k.totalJobs,
      keyFinding: top
        ? `${top.label} required maintenance ${top.jobs} time${top.jobs === 1 ? '' : 's'} ${describeRange(m).periodPhrase} — ${k.fleetAvgJobs > 0 ? `${(top.jobs / k.fleetAvgJobs).toFixed(1)}× the fleet average of ${k.fleetAvgJobs}` : 'the highest in the fleet'} — costing ${kwd(top.total_cost)} and ${top.downtime_days} days out of service.`
        : `${k.totalJobs} maintenance job${k.totalJobs === 1 ? '' : 's'} recorded, none attributable to a specific unit.`,
      trend: top?.avg_interval_days != null
        ? `${top.label} is returning to the workshop every ${top.avg_interval_days} days on average; last seen ${dateLabel(top.last_service) ?? 'date unknown'}.`
        : `${k.unitsInvolved} unit${k.unitsInvolved === 1 ? '' : 's'} generated ${k.totalJobs} job${k.totalJobs === 1 ? '' : 's'} and ${k.totalDowntimeDays} days of downtime across the window.`,
      topContributor: top
        ? {
          label: top.label,
          detail: `${top.jobs} jobs · ${top.downtime_days}d downtime · ${kwd(top.total_cost)}${top.avg_interval_days != null ? ` · every ${top.avg_interval_days}d` : ''}`,
          meta: [top.equipment_id && `Unit ${top.equipment_id}`, top.serial_number && `S/N ${top.serial_number}`, top.location]
            .filter(Boolean).join(' · ') || null,
        }
        : null,
      rootCause: top && top.avg_interval_days != null && top.avg_interval_days < 30
        ? `Repeat visits under 30 days apart usually mean the underlying fault is not being resolved — the previous repair is not holding, or a root cause upstream of the symptom is being treated.`
        : (b.byIssueType ?? [])[0] && k.totalJobs > 0
          ? `${b.byIssueType[0].name} accounts for ${pct(b.byIssueType[0].value, k.totalJobs)} of all jobs in the window, which points at a dominant failure mode rather than random wear.`
          : null,
      recommendedAction: top && top.jobs >= 5
        ? `Pull ${top.label}'s repair history and compare accumulated cost (${kwd(top.total_cost)}) against residual value before authorising the next repair — maintenance frequency at this level usually signals the asset is approaching replacement.`
        : aboveAvg.length > 1
          ? `${aboveAvg.length} units are running well above the fleet average. Schedule a joint inspection rather than treating each ticket separately.`
          : null,
    };
  },

  most_rented: (k, b, m) => {
    const byType = b.byType ?? [];
    const surging = byType
      .filter(t => t.trendPct !== null && t.trendPct >= 40 && t.rentals >= 3)
      .sort((a, x) => x.trendPct - a.trendPct)[0];
    return {
      sample: k.totalRentals,
      keyFinding: k.topName
        ? `${k.topName} drove ${k.topSharePct}% of all rentals (${k.topRentals} of ${k.totalRentals}) ${describeRange(m).periodPhrase}.`
        : null,
      trend: k.rentalsDeltaPct === null || k.rentalsDeltaPct === undefined
        ? `${describeRange(m).hasPrior ? `No comparable dispatch activity in ${describeRange(m).previousPhrase}, so this period has no baseline.` : 'No prior period is comparable — this view spans the full history.'}`
        : `Rental volume is ${trendPhrase(k.rentalsDeltaPct)} against ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${k.prevTotalRentals} → ${k.totalRentals})${surging ? `, with ${surging.name} the fastest-growing line at ${trendPhrase(surging.trendPct)}` : ''}.`,
      topContributor: k.topName
        ? {
          label: k.topName,
          detail: `${k.topRentals} rentals · ${k.topSharePct}% of volume${k.topTrendPct !== null && k.topTrendPct !== undefined ? ` · ${trendPhrase(k.topTrendPct)}` : ''}`,
          meta: byType[0]?.type_id ? `Type ID ${byType[0].type_id}` : null,
        }
        : null,
      rootCause: k.busiestUnitLabel && k.avgPerUnit > 0 && k.busiestUnitRentals >= 2.5 * k.avgPerUnit
        ? `${k.busiestUnitLabel} alone took ${k.busiestUnitRentals} of those dispatches against a fleet average of ${k.avgPerUnit} per unit — the volume is concentrated on one asset, not spread across the line.`
        : k.distinctUnits > 0
          ? `${k.totalRentals} dispatches spread across ${k.distinctUnits} unit${k.distinctUnits === 1 ? '' : 's'} and ${k.distinctTypes} equipment line${k.distinctTypes === 1 ? '' : 's'}.`
          : null,
      recommendedAction: k.topSharePct >= 50
        ? `${k.topName} carries over half of rental volume. Confirm the fleet has redundant depth on this line before the next peak — a single outage here is a revenue event, not a scheduling one.`
        : surging
          ? `Demand for ${surging.name} is ${trendPhrase(surging.trendPct)}. Revisit stock levels on this line before it becomes the constraint.`
          : null,
    };
  },

  utilization: (k, b) => ({
    sample: k.totalUnits,
    keyFinding: `Fleet utilisation is ${k.fleetUtilPct}% — ${k.inUse} of ${k.totalUnits - k.inMaint} hireable units are on hire, across ${k.typesTracked} equipment line${k.typesTracked === 1 ? '' : 's'}.`,
    trend: k.spreadPct >= 60
      ? `The fleet average hides a ${k.spreadPct}-point spread between lines (median ${k.medianUtilPct}%): ${k.hotTypeCount} line${k.hotTypeCount === 1 ? '' : 's'} above 85% and ${k.coldTypeCount} below 30%.`
      : `Utilisation is broadly even across lines — median ${k.medianUtilPct}% against a ${k.fleetUtilPct}% fleet average.`,
    topContributor: k.topName
      ? { label: k.topName, detail: `${k.topPct}% utilised — highest of any line`, meta: null }
      : null,
    rootCause: k.maintDragPct >= 15
      ? `${k.inMaint} unit${k.inMaint === 1 ? '' : 's'} (${k.maintDragPct}% of the fleet) sit in the workshop and are excluded from the denominator, so real available capacity is lower than the headline suggests.`
      : k.lowName
        ? `${k.lowName} trails at ${k.lowPct}%, dragging the fleet average down.`
        : null,
    recommendedAction: k.fleetUtilPct > 85
      ? 'The fleet is at its capacity ceiling. Bring forward overdue returns and prepare a procurement plan before enquiries start being declined.'
      : (k.coldTypeCount > 0 && (b.cold ?? []).length)
        ? `Redeploy or remarket the ${b.cold.reduce((s2, r) => s2 + r.idle, 0)} idle units on ${k.coldNames.join(', ')} before committing capital to new stock.`
        : null,
  }),

  idle_vs_active: (k, b) => ({
    sample: k.total,
    keyFinding: `${k.idle} of ${k.total} units (${k.idleSharePct}%) are idle right now; ${k.active} are on hire and ${k.maint} are in maintenance.`,
    trend: k.idleOver90 > 0
      ? `${k.idleOver90} unit${k.idleOver90 === 1 ? ' has' : 's have'} not moved in over 90 days, and ${k.idleOver30} in over 30 — average ${k.avgIdleDays} days since last movement.`
      : `Idle stock averages ${k.avgIdleDays} days since last movement, with ${k.idleOver30} unit${k.idleOver30 === 1 ? '' : 's'} past 30 days.`,
    topContributor: k.longestIdleLabel
      ? {
        // The NAME, with the id demoted to hover detail — the id was
        // previously the label here, which is the rule this module exists
        // to enforce.
        label: k.longestIdleLabel,
        detail: `${k.longestIdleDays} days without a dispatch`,
        meta: k.longestIdleId ? `Unit ${k.longestIdleId}` : null,
      }
      : null,
    rootCause: k.coldestTypeName && k.coldestTypeIdle === k.coldestTypeTotal && k.coldestTypeTotal >= 2
      ? `Every one of the ${k.coldestTypeTotal} ${k.coldestTypeName} units is unhired — a whole line at zero utilisation points at demand or offer coverage, not at scheduling.`
      : k.topIdleLocation && (b.byLocation ?? []).length > 1
        ? `Idle stock concentrates at ${k.topIdleLocation}, which may be a location problem rather than a demand one.`
        : null,
    recommendedAction: k.idleOver90 > 0
      ? `Put the ${k.idleOver90} unit${k.idleOver90 === 1 ? '' : 's'} idle beyond 90 days on a divestment or remarketing shortlist — they are accruing carrying cost against no revenue.`
      : k.idleSharePct > 40
        ? 'Idle share above 40% is an oversupply signal. Align procurement pace with actual dispatch demand before the next order.'
        : null,
  }),

  dispatch_trends: (k, b, m) => ({
    sample: k.totalDispatches,
    keyFinding: `${k.totalDispatches} dispatches ${describeRange(m).periodPhrase} — ${k.dailyAvg?.toFixed?.(1) ?? k.dailyAvg}/day with a ${k.avgTurnaroundDays?.toFixed?.(1) ?? k.avgTurnaroundDays}-day average turnaround.`,
    trend: k.dispatchesDeltaPct === null || k.dispatchesDeltaPct === undefined
      ? `${describeRange(m).hasPrior ? `No comparable activity in ${describeRange(m).previousPhrase}, so this period has no baseline.` : 'No prior period is comparable — this view spans the full history.'}`
      : `Volume is ${trendPhrase(k.dispatchesDeltaPct)} against ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${k.prevTotalDispatches} → ${k.totalDispatches})${k.turnaroundDeltaPct !== null && k.turnaroundDeltaPct !== undefined ? `, and turnaround is ${trendPhrase(k.turnaroundDeltaPct)}` : ''}.`,
    topContributor: k.topEquipmentName
      ? {
        label: k.topEquipmentName,
        detail: `${(b.byEquipment ?? [])[0]?.dispatches ?? 0} dispatches — the most-moved line${k.topDestination ? `, mostly to ${k.topDestination}` : ''}`,
        meta: null,
      }
      : null,
    rootCause: k.pendingBacklog > 0
      ? `${k.pendingBacklog} dispatches are still pending — roughly ${k.backlogVsDailyAvg ?? '—'} days of queued work at the current rate, which is what the turnaround figure is absorbing.`
      : k.completionPct < 60
        ? `Only ${k.completionPct}% of dispatches have a return logged, so turnaround is measured on the minority that closed and is optimistic by construction.`
        : null,
    recommendedAction: (k.backlogVsDailyAvg != null && k.backlogVsDailyAvg > 2)
      ? 'Backlog is over two days of work. Add dispatch capacity or sequence the queue by customer commitment rather than by arrival order.'
      : (k.turnaroundDeltaPct != null && k.turnaroundDeltaPct > 15)
        ? `Turnaround has lengthened ${k.turnaroundDeltaPct}%. Each extra day out is a day the unit cannot be re-hired — check whether returns are slow or simply logged late.`
        : null,
  }),

  return_trends: (k, b, m) => ({
    sample: k.rentalReturnsWindow + k.overdueCount,
    keyFinding: k.overdueCount > 0
      ? `${k.overdueCount} rental${k.overdueCount === 1 ? ' is' : 's are'} overdue, averaging ${k.avgDaysOutForOverdue} days out against a 30-day threshold.`
      : 'Every active rental is inside the 30-day return threshold.',
    trend: k.returnsDeltaPct === null || k.returnsDeltaPct === undefined
      ? `${k.rentalReturnsWindow} rental and ${k.leaseReturnsWindow} lease returns logged; no comparable prior period to measure against.`
      : `Return volume is ${trendPhrase(k.returnsDeltaPct)} against ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${k.prevRentalReturns} → ${k.rentalReturnsWindow}), at an average hire length of ${k.avgReturnDays} days.`,
    topContributor: k.worstOverdueLabel
      ? {
        label: k.worstOverdueLabel,
        detail: `${k.worstOverdueDays} days out — ${Math.max(0, k.worstOverdueDays - 30)} past the threshold`,
        meta: k.worstOverdueId ? `Unit ${k.worstOverdueId}` : null,
      }
      : null,
    rootCause: (b.overdueByDestination ?? [])[0] && k.overdueCount > 1 && b.overdueByDestination[0].value > 1
      ? `${b.overdueByDestination[0].value} of the ${k.overdueCount} overdue units sit at ${b.overdueByDestination[0].name} — this is a collection-route problem more than a per-customer one.`
      : k.avgReturnDays > 30
        ? `Average hire length (${k.avgReturnDays} days) already exceeds the 30-day threshold the overdue rule is written against, so the rule and the actual hire pattern have drifted apart.`
        : null,
    recommendedAction: k.overdueOver90 > 0
      ? `${k.overdueOver90} unit${k.overdueOver90 === 1 ? '' : 's'} have been out over 90 days. Escalate beyond reminder calls — at that age recoverability itself is the question.`
      : k.overdueCount > 10
        ? 'Overdue volume at this level is a process failure rather than a set of late returns. Route to the Operations Manager for a collections sweep.'
        : null,
  }),

  revenue_by_category: (k, b, m) => ({
    sample: (b.byCategory ?? []).length,
    keyFinding: k.topEquipmentName
      ? `${k.topEquipmentName} is the largest single earner at ${kwd(k.topEquipmentRevenue)} — ${k.topEquipmentSharePct}% of ${kwd(k.totalRevenue)} ${describeRange(m).periodPhrase}.`
      : k.topCategory
        ? `${k.topCategory} generated ${k.topSharePct}% of ${kwd(k.totalRevenue)} total revenue.`
        : null,
    trend: k.revenueDeltaPct === null || k.revenueDeltaPct === undefined
      ? `${describeRange(m).hasPrior ? `No comparable billing in ${describeRange(m).previousPhrase}, so this period has no baseline.` : 'No prior period is comparable — this view spans the full history.'}`
      : `Revenue is ${trendPhrase(k.revenueDeltaPct)} against ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${kwd(k.prevRevenue)} → ${kwd(k.totalRevenue)}), split ${pct(k.totalRental, k.totalRevenue)} rental / ${k.leaseSharePct}% lease.`,
    topContributor: k.topEquipmentName
      ? {
        label: k.topEquipmentName,
        detail: `${kwd(k.topEquipmentRevenue)} · ${k.topEquipmentSharePct}% of revenue`,
        meta: (b.byEquipment ?? [])[0]?.type_id ? `Type ID ${b.byEquipment[0].type_id}` : null,
      }
      : k.topCategory
        ? { label: k.topCategory, detail: `${k.topSharePct}% of revenue`, meta: null }
        : null,
    rootCause: k.unallocatedPct >= 20
      ? `${k.unallocatedPct}% of revenue could not be traced to an equipment category — those invoices carry no quotation line items, so every share above is understated by an unknown slice of that.`
      : k.topSharePct > 50
        ? `${k.topCategory} carries over half the book on its own; the category mix is not the diversification it appears to be.`
        : null,
    recommendedAction: k.leaseSharePct < 15 && k.totalRevenue > 0
      ? `Only ${k.leaseSharePct}% of revenue is recurring. Converting the steadiest rental customers to leases would smooth a book that currently has to be re-won every period.`
      : k.topSharePct > 50
        ? `Protect ${k.topCategory} with dedicated support and stock depth — a downturn in one category would move the P&L on its own.`
        : null,
  }),

  procurement_vs_lease: (k, b, m) => {
    const clearest = [...(b.comparable ?? [])]
      .sort((a, x) => (a.breakEvenMonths ?? 0) - (x.breakEvenMonths ?? 0))[0];
    return {
      sample: (k.buyCount ?? 0) + (k.leaseCount ?? 0),
      keyFinding: k.breakEvenMonths != null
        ? `Buying breaks even against leasing at roughly ${Math.round(k.breakEvenMonths)} months — ${kwd(k.avgBuyPrice)} average purchase against ${kwd(k.avgLeaseMonthly)} per month.`
        : `${k.buyCount} purchase${k.buyCount === 1 ? '' : 's'} (${kwd(k.buySpend)}) against ${k.leaseCount} lease${k.leaseCount === 1 ? '' : 's'} (${kwd(k.leaseMonthlyCommit)}/month), with no like-for-like line to compare.`,
      trend: k.mixShiftPct != null
        ? `The mix has moved ${Math.abs(k.mixShiftPct)} points toward ${k.mixShiftPct > 0 ? 'buying' : 'leasing'} across the ${describeRange(m).shortPeriod} (CapEx ${k.earlyBuyShare}% → ${k.lateBuyShare}% of new procurement).`
        : `CapEx is ${k.buySharePct}% of procurement volume over the window; the series is too short to read a direction from.`,
      topContributor: clearest
        ? {
          label: clearest.name,
          detail: `break-even at ${Math.round(clearest.breakEvenMonths)} months — the clearest buy/lease case in the book`,
          meta: clearest.type_id ? `Type ID ${clearest.type_id}` : null,
        }
        : k.topLineName
          ? { label: k.topLineName, detail: `largest committed line (${k.topLineMode})`, meta: null }
          : null,
      rootCause: !m.hasLineItems
        ? 'Procurements in this window carry no line items, so the comparison can only be made fleet-wide — and a fleet-wide break-even blends assets with completely different economics.'
        : k.comparableLines === 0
          ? 'No equipment line has been both bought and leased in this window, so every break-even here is an average across unlike assets rather than a like-for-like price.'
          : null,
      recommendedAction: k.comparableLines > 0
        ? `Decide per line rather than fleet-wide: ${k.buyFavouredCount} line${k.buyFavouredCount === 1 ? '' : 's'} favour buying and ${k.leaseFavouredCount} favour leasing on current pricing.`
        : (k.annualLeaseExtrapolated > 0 && k.annualLeaseExtrapolated > k.buySpend)
          ? `Annualised lease commitment (${kwd(k.annualLeaseExtrapolated)}) now exceeds purchase spend (${kwd(k.buySpend)}). Review the indefinitely-leased lines for conversion to ownership.`
          : null,
    };
  },

  top_customers: (k, b, m) => ({
    sample: k.activeCustomers ?? (k.top5SharePct != null ? 5 : 0),
    keyFinding: k.topCustomer
      ? `${k.topCustomer} is the largest account at ${kwd(k.topBilled)} billed; the top 5 represent ${k.top5SharePct}% of ${kwd(k.totalBilled)} across ${k.activeCustomers} active account${k.activeCustomers === 1 ? '' : 's'}.`
      : null,
    trend: k.billedDeltaPct === null || k.billedDeltaPct === undefined
      ? `${describeRange(m).hasPrior ? `No comparable billing in ${describeRange(m).previousPhrase}, so this period has no baseline.` : 'No prior period is comparable — this view spans the full history.'}`
      : `Billing is ${trendPhrase(k.billedDeltaPct)} against ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${kwd(k.prevTotalBilled)} → ${kwd(k.totalBilled)}), with ${k.growingCount} account${k.growingCount === 1 ? '' : 's'} growing and ${k.shrinkingCount} contracting.`,
    topContributor: k.topCustomer
      ? {
        label: k.topCustomer,
        detail: `${kwd(k.topBilled)} billed${k.topTrendPct !== null && k.topTrendPct !== undefined ? ` · ${trendPhrase(k.topTrendPct)}` : ''}`,
        meta: null,
      }
      : null,
    rootCause: k.largestDeclineName && k.largestDeclinePct <= -40
      ? `${k.largestDeclineName} is down ${Math.abs(k.largestDeclinePct)}% period on period — the steepest decline in the book, and large enough to explain a flat total on its own.`
      : k.atRiskCount > 0
        ? `${k.atRiskCount} top-10 account${k.atRiskCount === 1 ? ' has' : 's have'} billed in this window but shown no quote or invoice activity for 60+ days.`
        : k.collectionRatePct < 70
          ? `${kwd(k.totalOutstanding)} of billing is uncollected (${k.collectionRatePct}% collected) — revenue recognised is running ahead of cash received.`
          : null,
    recommendedAction: k.worstDebtorName && k.worstDebtorOutstanding > 0
      ? `Route ${k.worstDebtorName} (${kwd(k.worstDebtorOutstanding)} outstanding) to Finance, and review the wider ${kwd(k.totalOutstanding)} debtor book while it is open.`
      : k.top5SharePct > 60
        ? 'Top-5 concentration above 60% is a single-account-loss risk. Either diversify the book or lock these accounts into longer terms.'
        : null,
  }),

  maintenance_cost: (k, b, m) => ({
    sample: k.totalJobs,
    keyFinding: k.topUnitLabel && k.topUnitSharePct >= 15
      ? `${k.topUnitLabel} accounts for ${k.topUnitSharePct}% of ${kwd(k.totalCost)} maintenance spend — ${kwd(k.topUnitCost)} across ${(b.byUnit ?? [])[0]?.jobs ?? 0} completed job${((b.byUnit ?? [])[0]?.jobs ?? 0) === 1 ? '' : 's'}.`
      : `${kwd(k.totalCost)} of maintenance spend across ${k.totalJobs} job${k.totalJobs === 1 ? '' : 's'}, averaging ${kwd(k.avgCostPerJob)} each.`,
    trend: k.halfDeltaPct != null
      ? `Underlying spend is ${trendPhrase(k.halfDeltaPct)} comparing the second half of the ${describeRange(m).shortPeriod} against the first${k.momDeltaPct != null ? ` (month-on-month reads ${trendPhrase(k.momDeltaPct)}, which one large repair can swing entirely)` : ''}.`
      : k.momDeltaPct != null
        ? `Maintenance spend is ${trendPhrase(k.momDeltaPct)} month-on-month against a ${kwd(k.monthlyRunRate)} run rate.`
        : null,
    topContributor: k.topUnitLabel
      ? {
        label: k.topUnitLabel,
        detail: `${kwd(k.topUnitCost)} · ${k.topUnitSharePct}% of spend${(b.byUnit ?? [])[0]?.topIssue ? ` · mostly ${b.byUnit[0].topIssue.toLowerCase()}` : ''}`,
        meta: [k.topUnitId && `Unit ${k.topUnitId}`, (b.byUnit ?? [])[0]?.serial_number && `S/N ${b.byUnit[0].serial_number}`]
          .filter(Boolean).join(' · ') || null,
      }
      : k.topIssueType
        ? { label: k.topIssueType, detail: `${kwd(k.topIssueCost)} — the dominant failure mode`, meta: null }
        : null,
    rootCause: k.top5UnitSharePct >= 70 && k.unitsWithCost > 5
      ? `Five of ${k.unitsWithCost} units carry ${k.top5UnitSharePct}% of the cost — this is concentrated in a handful of assets rather than spread across an ageing fleet.`
      : k.topIssueType && k.totalCost > 0 && k.topIssueCost / k.totalCost > 0.5
        ? `${k.topIssueType} accounts for ${pct(k.topIssueCost, k.totalCost)} of spend, which points at one dominant failure mode rather than general wear.`
        : k.openJobCount > 0
          ? `${k.openJobCount} job${k.openJobCount === 1 ? ' is' : 's are'} still open and carry no settled cost, so the figures here are a floor rather than the final total.`
          : null,
    recommendedAction: k.topUnitLabel && k.topUnitSharePct >= 30
      ? `Take ${k.topUnitLabel} to a repair-or-replace decision: ${kwd(k.topUnitCost)} on one asset is ${k.topUnitSharePct}% of the maintenance budget for this window.`
      : k.halfDeltaPct != null && k.halfDeltaPct > 20
        ? `Spend is rising on an underlying basis, not just month to month. Budget the ${kwd(k.monthlyRunRate)} run rate forward at the higher level rather than the window average.`
        : null,
  }),

  recent_leases: (k, b, m) => ({
    sample: k.activeLeases ?? k.newLeases,
    keyFinding: k.expiredCount > 0
      ? `${k.expiredCount} lease${k.expiredCount === 1 ? ' is' : 's are'} past their end date with no recorded return, inside an active book of ${k.activeLeases} unit${k.activeLeases === 1 ? '' : 's'} worth ${kwd(k.activeMonthlyCommit)} per month.`
      : `${k.newLeases} new lease${k.newLeases === 1 ? '' : 's'} ${describeRange(m).periodPhrase}, worth ${kwd(k.monthlyCommit)} per month, against an active book of ${kwd(k.activeMonthlyCommit)} per month.`,
    trend: k.newLeasesDeltaPct === null || k.newLeasesDeltaPct === undefined
      ? `${describeRange(m).hasPrior ? `No comparable lease starts in ${describeRange(m).previousPhrase}, so this period has no baseline.` : 'No prior period is comparable — this view spans the full history.'}`
      : `New lease volume is ${trendPhrase(k.newLeasesDeltaPct)} against ${describeRange(m).previousPhrase ?? 'a comparable prior period'} (${k.prevNewLeases} → ${k.newLeases}), at an average term of ${k.avgTermDays} days.`,
    topContributor: k.soonestExpiryLabel
      ? {
        label: k.soonestExpiryLabel,
        detail: `next to expire — ${k.soonestExpiryDays} day${k.soonestExpiryDays === 1 ? '' : 's'} away`,
        meta: (b.expiringSoon ?? [])[0]?.equipment_id ? `Unit ${b.expiringSoon[0].equipment_id}` : null,
      }
      : k.topLeaseTypeName
        ? { label: k.topLeaseTypeName, detail: 'largest line by monthly commitment', meta: null }
        : null,
    rootCause: k.expiring30 > 0
      ? `${k.expiring30} lease${k.expiring30 === 1 ? '' : 's'} expire within 30 days, putting ${kwd(k.monthlyAtRisk30)} — ${k.atRiskSharePct}% of monthly lease income — up for renewal at once.`
      : null,
    recommendedAction: k.expiredCount > 0
      ? 'Close the expired-but-unreturned leases first: each is either an unbooked renewal or an unlogged return, and both distort billing until resolved.'
      : k.atRiskSharePct >= 25
        ? `Sequence the ≤30-day renewals by end date rather than account size — ${k.atRiskSharePct}% of the lease book turns over inside a month.`
        : null,
  }),

  monthly_kpis: (k, b, m) => {
    // The scorecard's phrasing has to follow the filter — the brief used
    // to hardcode "this month" and "prior month", which was factually
    // wrong the moment a user picked a custom range or All Time. Every
    // sentence below is now derived from the meta the fetcher actually
    // stamped (see analytics.js getMonthlyKPIs), so a 13-day custom range
    // reads as "between X and Y", and All Time drops the comparison
    // outright rather than inventing a nonexistent prior.
    const r = describeRange(m);
    // A short subject for the lead sentence: "this month" only when the
    // default calendar-month path ran, else the actual period the queries
    // hit. `subjectPhrase` reads as a subject ("KWD X in <subject>"),
    // `contextPhrase` as an adverbial ("<X> across the selected period").
    const isDefaultMonth = r.rangeMode === 'rolling' && !!m?.monthKey;
    const subjectPhrase = isDefaultMonth
      ? 'this month'
      : r.rangeMode === 'allTime'
        ? 'across all recorded activity'
        : r.rangeMode === 'explicit'
          ? `between ${m?.fromDate} and ${m?.toDate}`
          : 'in the selected period';
    return {
      // Not `k.dispatches` alone: a period can bill revenue, run
      // maintenance and raise purchase orders without a single dispatch,
      // and that period still deserves a scorecard brief. Only a period
      // with none of the four is empty.
      sample: (k.dispatches ?? 0) + (k.maintJobs ?? 0) + (k.procurementCount ?? 0)
        + ((k.revenue ?? 0) > 0 ? 1 : 0),
      keyFinding: `${kwd(k.revenue)} revenue ${subjectPhrase} from ${k.dispatches} dispatch${k.dispatches === 1 ? '' : 'es'} at ${k.utilizationPct}% utilisation${k.costRatioPct != null ? `, with maintenance and procurement consuming ${k.costRatioPct}% of it` : ''}.`,
      // Comparison sentence honours whether a prior period is even
      // meaningful. All Time collapses to a plain "no prior period"
      // rather than "no prior month" — the previous wording was
      // month-specific.
      trend: !r.hasPrior
        ? 'No prior period is comparable — this view spans the full history.'
        : k.revenueDeltaPct != null
          ? `Revenue is ${trendPhrase(k.revenueDeltaPct)} against ${r.previousPhrase}; dispatches ${trendPhrase(k.dispatchesDeltaPct)} and maintenance spend ${trendPhrase(k.maintSpendDeltaPct)}.`
          : `No comparable activity in ${r.previousPhrase}, so this period has no baseline.`,
      topContributor: k.revenuePerDispatch > 0
        ? {
          label: `${kwd(k.revenuePerDispatch)} per dispatch`,
          detail: `${k.dispatches} dispatch${k.dispatches === 1 ? '' : 'es'} at ${(k.avgTurnaroundDays ?? 0).toFixed(1)}-day average turnaround`,
          meta: null,
        }
        : null,
      rootCause: k.costRatioPct != null && k.costRatioPct >= 80
        ? `${kwd(k.totalOutflow)} of maintenance and procurement against ${kwd(k.revenue)} invoiced ${subjectPhrase}. Procurement is lumpy, so one large order can produce this — but sustained, it is a margin problem.`
        : k.fleetTotal > 0 && k.fleetInMaint / k.fleetTotal >= 0.15
          ? `${k.fleetInMaint} of ${k.fleetTotal} units are in the workshop and excluded from the utilisation denominator, so the fleet is more constrained than ${k.utilizationPct}% suggests.`
          : k.collectionRatePct != null && k.collectionRatePct < 60
            ? `Only ${k.collectionRatePct}% of billing ${subjectPhrase} has been collected — ${kwd(Math.max(0, (k.revenue ?? 0) - (k.collected ?? 0)))} is still outstanding on invoices issued in this period.`
            : null,
      recommendedAction: k.overdueCount > 0
        ? `${k.overdueCount} overdue return${k.overdueCount === 1 ? '' : 's'} are unavailable for re-hire and unbilled — the cheapest capacity available right now. Route to the Operations Manager.`
        : null,
    };
  },
};

/**
 * Fold an analysis result plus its template insights into an analyst brief.
 *
 * @param sectionKey  key from hooks/useAnalytics SECTIONS
 * @param result      the `{ kpis, series, breakdowns, meta }` payload
 * @param insights    output of the section's insight template
 * @returns the brief, or null when there is nothing worth stating
 */
export function buildBrief(sectionKey, result, insights = []) {
  try {
    if (!result || typeof result !== 'object') return null;
    const k = result.kpis ?? {};
    const b = result.breakdowns ?? {};
    const m = result.meta ?? {};

    let section = {};
    const fn = SECTION_BRIEF[sectionKey];
    if (fn) {
      try { section = fn(k, b, m) ?? {}; }
      catch (e) {
        // A shape mismatch in one accessor must not cost the whole brief —
        // the generic fallbacks below still produce something truthful.
        console.warn(`[brief:${sectionKey}] accessor failed`, e?.message ?? e);
        section = {};
      }
    }

    // Nothing to analyse. Every accessor reports the row count its findings
    // rest on, and at zero the section's template has already early-returned
    // its own "no activity in this window" bullet. Composing a brief on top
    // of that produces confident-sounding sentences about nothing — "0
    // procurement records totalling KWD 0, but no line items are linked" —
    // and on a genuinely empty deployment every section rendered one.
    //
    // Presence of the key is what distinguishes the two failure modes: an
    // accessor that SET `sample` and got 0, null or NaN is saying "there is
    // nothing here"; one that omitted it (or a section with no accessor at
    // all, falling through to the generic path) is saying "I don't know",
    // and that still earns a brief from the template's own lead insight.
    if ('sample' in section && !(Number(section.sample) > 0)) return null;

    const severity = worstSeverity(insights);
    const lead = firstOfSeverity(insights, ['critical', 'warning', 'positive', 'neutral']);
    const action = firstOfSeverity(insights, ['critical', 'warning']);

    const keyFinding = section.keyFinding ?? lead?.headline ?? null;
    // A brief with no finding at all is noise; the section's own empty state
    // has already said the useful thing.
    if (!keyFinding) return null;

    const confidence = m.confidence ?? confidenceFrom({
      sampleSize: section.sample ?? 0,
      fieldCoverage: 1,
      windowDays: m.windowDays ?? 0,
    });

    return {
      keyFinding,
      trend: section.trend ?? null,
      topContributor: section.topContributor ?? null,
      rootCause: section.rootCause ?? null,
      riskLevel: RISK_BY_SEVERITY[SEVERITY_RANK[severity] ?? 1],
      recommendedAction:
        section.recommendedAction ?? action?.body ?? lead?.cta ?? null,
      confidence,
    };
  } catch (e) {
    console.warn('[buildBrief] failed', e?.message ?? e);
    return null;
  }
}
