import { create } from 'zustand';

export const useAppStore = create((set, get) => ({
  // ── Requirements ──────────────────────────────────────
  requirements: [],
  requirementsLoaded: false,
  requirementsFilters: {
    search: '', status: 'All', priority: 'All',
    dateFrom: '', dateTo: '', customer: '',
  },
  setRequirements: (data) => set({ requirements: data, requirementsLoaded: true }),
  setRequirementsFilters: (filters) => set(s => ({
    requirementsFilters: { ...s.requirementsFilters, ...filters }
  })),
  clearRequirementsCache: () => set({ requirementsLoaded: false }),

  // ── Quotations ────────────────────────────────────────
  quotations: [],
  quotationsLoaded: false,
  quotationsFilters: {
    search: '', status: 'All', preparedBy: '', dateFrom: '', dateTo: '',
  },
  setQuotations: (data) => set({ quotations: data, quotationsLoaded: true }),
  setQuotationsFilters: (filters) => set(s => ({
    quotationsFilters: { ...s.quotationsFilters, ...filters }
  })),
  clearQuotationsCache: () => set({ quotationsLoaded: false }),

  // ── Equipment ─────────────────────────────────────────
  equipmentUnits: [],
  equipmentTypes: [],
  equipmentLoaded: false,
  equipmentFilters: {
    search: '', status: 'All', typeId: 'All',
  },
  setEquipmentUnits: (data) => set({ equipmentUnits: data, equipmentLoaded: true }),
  setEquipmentTypes: (data) => set({ equipmentTypes: data }),
  setEquipmentFilters: (filters) => set(s => ({
    equipmentFilters: { ...s.equipmentFilters, ...filters }
  })),
  clearEquipmentCache: () => set({ equipmentLoaded: false }),

  // ── Customers ─────────────────────────────────────────
  customers: [],
  customersLoaded: false,
  setCustomers: (data) => set({ customers: data, customersLoaded: true }),
  clearCustomersCache: () => set({ customersLoaded: false }),

  // ── Dispatches ────────────────────────────────────────
  dispatches: [],
  dispatchesLoaded: false,
  dispatchesFilters: { status: 'All' },
  setDispatches: (data) => set({ dispatches: data, dispatchesLoaded: true }),
  setDispatchesFilters: (filters) => set(s => ({
    dispatchesFilters: { ...s.dispatchesFilters, ...filters }
  })),
  clearDispatchesCache: () => set({ dispatchesLoaded: false }),
}));