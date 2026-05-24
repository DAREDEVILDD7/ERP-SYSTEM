import { supabase } from '../lib/supabaseClient';

export async function fetchAdminStats() {
  const [
    { count: totalEquipment },
    { count: availableEquipment },
    { count: activeRequirements },
    { count: openQuotations },
    { count: pendingDispatches },
    { count: openMaintenance },
    { data: revenueData },
    { data: recentRequirements },
    { data: equipmentByStatus },
    { data: requirementsByStatus },
  ] = await Promise.all([
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Available'),
    supabase.from('requirements').select('*', { count: 'exact', head: true }).not('status', 'in', '("Completed","Rejected","Cancelled")'),
    supabase.from('quotations').select('*', { count: 'exact', head: true }).in('status', ['Draft', 'Sent']),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).in('status', ['Pending', 'Assigned', 'In Transit']),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).in('status', ['Open', 'In Progress']),
    supabase.from('quotations').select('total_amount_kwd').eq('status', 'Approved'),
    supabase.from('requirements').select('requirement_id, requirement_summary, status, created_at, customers(company_name)').order('created_at', { ascending: false }).limit(5),
    supabase.from('equipment_units').select('status'),
    supabase.from('requirements').select('status'),
  ]);

  const totalRevenue = revenueData?.reduce((sum, q) => sum + (q.total_amount_kwd || 0), 0) ?? 0;

  // Count equipment by status
  const eqStatusMap = {};
  equipmentByStatus?.forEach(e => {
    eqStatusMap[e.status] = (eqStatusMap[e.status] || 0) + 1;
  });

  // Count requirements by status
  const reqStatusMap = {};
  requirementsByStatus?.forEach(r => {
    reqStatusMap[r.status] = (reqStatusMap[r.status] || 0) + 1;
  });

  return {
    stats: {
      totalEquipment:    totalEquipment ?? 0,
      availableEquipment: availableEquipment ?? 0,
      activeRequirements: activeRequirements ?? 0,
      openQuotations:    openQuotations ?? 0,
      pendingDispatches: pendingDispatches ?? 0,
      openMaintenance:   openMaintenance ?? 0,
      totalRevenue,
    },
    recentRequirements: recentRequirements ?? [],
    equipmentByStatus:  Object.entries(eqStatusMap).map(([name, value]) => ({ name, value })),
    requirementsByStatus: Object.entries(reqStatusMap).map(([name, value]) => ({ name, value })),
  };
}

export async function fetchSalesStats(userId) {
  const [
    { count: myRequirements },
    { count: myQuotations },
    { count: pendingApproval },
    { data: myRecentQuotations },
    { data: myRecentRequirements },
  ] = await Promise.all([
    supabase.from('requirements').select('*', { count: 'exact', head: true }).eq('created_by', userId),
    supabase.from('quotations').select('*', { count: 'exact', head: true }).eq('prepared_by', userId),
    supabase.from('quotations').select('*', { count: 'exact', head: true }).eq('prepared_by', userId).eq('status', 'Sent'),
    supabase.from('quotations').select('quotation_id, status, total_amount_kwd, quotation_date, customers(company_name)').eq('prepared_by', userId).order('created_at', { ascending: false }).limit(5),
    supabase.from('requirements').select('requirement_id, requirement_summary, status, created_at, customers(company_name)').eq('created_by', userId).order('created_at', { ascending: false }).limit(5),
  ]);

  return {
    stats: {
      myRequirements:  myRequirements ?? 0,
      myQuotations:    myQuotations ?? 0,
      pendingApproval: pendingApproval ?? 0,
    },
    myRecentQuotations:   myRecentQuotations ?? [],
    myRecentRequirements: myRecentRequirements ?? [],
  };
}

export async function fetchOperationsStats() {
  const [
    { count: pendingReview },
    { count: availableEquipment },
    { count: activeDispatches },
    { count: openMaintenance },
    { data: pendingRequirements },
    { data: equipmentByLocation },
  ] = await Promise.all([
    supabase.from('requirements').select('*', { count: 'exact', head: true }).in('status', ['Pending Review', 'Operations Review']),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Available'),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).in('status', ['Assigned', 'In Transit']),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).in('status', ['Open', 'In Progress']),
    supabase.from('requirements').select('requirement_id, requirement_summary, status, priority, created_at, customers(company_name)').in('status', ['Pending Review', 'Operations Review']).order('created_at', { ascending: false }).limit(8),
    supabase.from('equipment_units').select('location'),
  ]);

  const locationMap = {};
  equipmentByLocation?.forEach(e => {
    if (e.location) locationMap[e.location] = (locationMap[e.location] || 0) + 1;
  });

  return {
    stats: { pendingReview: pendingReview ?? 0, availableEquipment: availableEquipment ?? 0, activeDispatches: activeDispatches ?? 0, openMaintenance: openMaintenance ?? 0 },
    pendingRequirements: pendingRequirements ?? [],
    equipmentByLocation: Object.entries(locationMap).map(([name, value]) => ({ name, value })),
  };
}

export async function fetchDispatchStats() {
  const [
    { count: pending },
    { count: inTransit },
    { count: completedToday },
    { data: activeDispatches },
  ] = await Promise.all([
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).eq('status', 'In Transit'),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).eq('status', 'Completed').gte('updated_at', new Date().toISOString().split('T')[0]),
    supabase.from('dispatches').select('dispatch_id, status, destination, driver_name, vehicle_type, dispatch_date, equipment_units(equipment_types(name), capacity)').in('status', ['Pending', 'Assigned', 'In Transit']).order('dispatch_date', { ascending: true }).limit(10),
  ]);

  return {
    stats: { pending: pending ?? 0, inTransit: inTransit ?? 0, completedToday: completedToday ?? 0 },
    activeDispatches: activeDispatches ?? [],
  };
}

export async function fetchMaintenanceStats() {
  const [
    { count: open },
    { count: inProgress },
    { count: completedThisMonth },
    { data: jobs },
  ] = await Promise.all([
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).eq('status', 'Open'),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).eq('status', 'In Progress'),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).eq('status', 'Completed').gte('completion_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from('maintenance').select('maintenance_id, issue, issue_type, status, service_date, equipment_units(equipment_id, capacity, equipment_types(name))').in('status', ['Open', 'In Progress']).order('service_date', { ascending: true }).limit(10),
  ]);

  return {
    stats: { open: open ?? 0, inProgress: inProgress ?? 0, completedThisMonth: completedThisMonth ?? 0 },
    jobs: jobs ?? [],
  };
}

export async function fetchFinanceStats() {
  const [
    { count: pendingInvoices },
    { count: approvalNeeded },
    { data: invoiceData },
    { data: recentInvoices },
  ] = await Promise.all([
    supabase.from('invoices').select('*', { count: 'exact', head: true }).in('status', ['Draft', 'Sent']),
    supabase.from('quotations').select('*', { count: 'exact', head: true }).eq('status', 'Sent'),
    supabase.from('invoices').select('total_amount_kwd, amount_paid_kwd, status'),
    supabase.from('invoices').select('invoice_id, status, total_amount_kwd, issue_date, customers(company_name)').order('created_at', { ascending: false }).limit(5),
  ]);

  const totalBilled = invoiceData?.reduce((s, i) => s + (i.total_amount_kwd || 0), 0) ?? 0;
  const totalCollected = invoiceData?.reduce((s, i) => s + (i.amount_paid_kwd || 0), 0) ?? 0;

  return {
    stats: { pendingInvoices: pendingInvoices ?? 0, approvalNeeded: approvalNeeded ?? 0, totalBilled, totalCollected },
    recentInvoices: recentInvoices ?? [],
  };
}

export async function fetchWarehouseStats() {
  const [
    { count: total },
    { count: available },
    { count: maintenance },
    { data: byType },
  ] = await Promise.all([
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Available'),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Maintenance'),
    supabase.from('equipment_units').select('status, equipment_types(name)'),
  ]);

  const typeMap = {};
  byType?.forEach(e => {
    const name = e.equipment_types?.name ?? 'Unknown';
    typeMap[name] = (typeMap[name] || 0) + 1;
  });

  return {
    stats: { total: total ?? 0, available: available ?? 0, maintenance: maintenance ?? 0 },
    byType: Object.entries(typeMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
  };
}