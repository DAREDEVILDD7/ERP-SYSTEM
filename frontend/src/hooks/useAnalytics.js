// React Query wrapper for the Analytics page. Each section key maps to a
// specific fetch function in api/analytics.js and its own stale time
// (§3.3 of docs/AI-Analytics-Design.md). Two sections subscribe to live
// realtime updates — idle_vs_active (§4.10) and top_customers, added so the
// Priority Signals ribbon's data-quality rules (zero/negative/missing-value
// quotes, computed inside getTopCustomers) react to a newly created
// anomalous quotation within the debounce window instead of waiting out
// top_customers's 30-minute stale time. Everything else relies on
// stale-time-driven refetching so we do not over-consume the Supabase
// realtime quota.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useRealtimeRefresh } from './useRealtimeRefresh';
import {
  getMostRentedEquipment,
  getMostProcuredEquipment,
  getRecentLeases,
  getMaintenanceFrequency,
  getDispatchTrends,
  getReturnTrends,
  getUtilization,
  getRevenueByCategory,
  getProcurementVsLease,
  getIdleVsActive,
  getTopCustomers,
  getMaintenanceCostTrends,
  getMonthlyKPIs,
  getUnitPnL,
  getForwardForecast,
  getFleetActionQueue,
} from '../api/analytics';

const MINUTE = 60_000;

// Per-section registry: fetcher, stale time, realtime table subscriptions.
export const SECTIONS = {
  most_rented:            { fetch: getMostRentedEquipment,     stale:  5 * MINUTE, defaultParams: { days: 30 }  },
  most_procured:          { fetch: getMostProcuredEquipment,   stale: 30 * MINUTE, defaultParams: { days: 90 }  },
  recent_leases:          { fetch: getRecentLeases,            stale:  5 * MINUTE, defaultParams: { days: 30 }  },
  maintenance_frequency:  { fetch: getMaintenanceFrequency,    stale: 15 * MINUTE, defaultParams: { days: 180 } },
  dispatch_trends:        { fetch: getDispatchTrends,          stale:  2 * MINUTE, defaultParams: { days: 90 }  },
  return_trends:          { fetch: getReturnTrends,            stale:  2 * MINUTE, defaultParams: { days: 90 }  },
  utilization:            { fetch: getUtilization,             stale:      MINUTE, defaultParams: {}            },
  revenue_by_category:    { fetch: getRevenueByCategory,       stale:  5 * MINUTE, defaultParams: { days: 90 }  },
  procurement_vs_lease:   { fetch: getProcurementVsLease,      stale: 30 * MINUTE, defaultParams: { days: 365 } },
  idle_vs_active:         { fetch: getIdleVsActive,            stale:      MINUTE, defaultParams: {}, realtime: ['equipment_units'] },
  top_customers:          { fetch: getTopCustomers,            stale: 30 * MINUTE, defaultParams: { days: 365 }, realtime: ['quotations'] },
  maintenance_cost:       { fetch: getMaintenanceCostTrends,   stale: 15 * MINUTE, defaultParams: { days: 365 } },
  monthly_kpis:           { fetch: getMonthlyKPIs,             stale:  5 * MINUTE, defaultParams: {}            },
  unit_pnl:               { fetch: getUnitPnL,                  stale: 15 * MINUTE, defaultParams: { days: 90 }  },
  forward_forecast:       { fetch: getForwardForecast,          stale: 15 * MINUTE, defaultParams: { horizonDays: 90 } },
  fleet_action_queue:     { fetch: getFleetActionQueue,          stale:  2 * MINUTE, defaultParams: {}            },
};

export function useAnalytics(sectionKey, params = {}) {
  const cfg = SECTIONS[sectionKey];
  const qc = useQueryClient();

  const merged = { ...(cfg?.defaultParams ?? {}), ...params };
  const queryKey = ['analytics', sectionKey, merged];

  const query = useQuery({
    queryKey,
    queryFn: () => cfg.fetch(merged),
    staleTime: cfg?.stale ?? 5 * MINUTE,
    retry: 1,
    enabled: !!cfg,
    // The fetchers already handle their own errors and always resolve, so
    // this exists mostly to keep the query object consistent — but we also
    // want a hard failure (network offline entirely, for example) to
    // present as an error rather than a stuck loading state.
  });

  const refetch = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['analytics', sectionKey] });
  }, [qc, sectionKey]);

  // Only subscribe to realtime for sections that opted in. useRealtimeRefresh
  // is a no-op when passed an empty array, so this call is always safe.
  useRealtimeRefresh(cfg?.realtime ?? [], refetch);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isRefetching: query.isFetching && !query.isLoading,
    error: query.error,
    refetch,
    // A value that changes exactly when new data lands (initial load, a date
    // range change, a Refresh) — additive passthrough of React Query's own
    // timestamp, used only to key chart re-entrance animations. Nothing that
    // reads this object by its existing named fields is affected by this
    // being present.
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
