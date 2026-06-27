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

  const eqStatusMap = {};
  equipmentByStatus?.forEach(e => { eqStatusMap[e.status] = (eqStatusMap[e.status] || 0) + 1; });

  const reqStatusMap = {};
  requirementsByStatus?.forEach(r => { reqStatusMap[r.status] = (reqStatusMap[r.status] || 0) + 1; });

  return {
    stats: {
      totalEquipment:     totalEquipment    ?? 0,
      availableEquipment: availableEquipment ?? 0,
      activeRequirements: activeRequirements ?? 0,
      openQuotations:     openQuotations    ?? 0,
      pendingDispatches:  pendingDispatches  ?? 0,
      openMaintenance:    openMaintenance   ?? 0,
      totalRevenue,
    },
    recentRequirements:   recentRequirements ?? [],
    equipmentByStatus:    Object.entries(eqStatusMap).map(([name, value]) => ({ name, value })),
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
    { data: allMyQuotations },
  ] = await Promise.all([
    supabase.from('requirements').select('*', { count: 'exact', head: true }).eq('created_by', userId),
    supabase.from('quotations').select('*', { count: 'exact', head: true }).eq('prepared_by', userId),
    supabase.from('quotations').select('*', { count: 'exact', head: true }).eq('prepared_by', userId).eq('status', 'Sent'),
    supabase.from('quotations').select('quotation_id, status, total_amount_kwd, quotation_date, customers(company_name)').eq('prepared_by', userId).order('created_at', { ascending: false }).limit(6),
    supabase.from('requirements').select('requirement_id, requirement_summary, status, created_at, customers(company_name)').eq('created_by', userId).order('created_at', { ascending: false }).limit(6),
    supabase.from('quotations').select('status, total_amount_kwd').eq('prepared_by', userId),
  ]);

  const quotStatusMap = {};
  let myRevenue = 0;
  allMyQuotations?.forEach(q => {
    quotStatusMap[q.status] = (quotStatusMap[q.status] || 0) + 1;
    if (q.status === 'Approved') myRevenue += (q.total_amount_kwd || 0);
  });

  return {
    stats: {
      myRequirements:  myRequirements  ?? 0,
      myQuotations:    myQuotations    ?? 0,
      pendingApproval: pendingApproval ?? 0,
      myRevenue,
    },
    myRecentQuotations:   myRecentQuotations  ?? [],
    myRecentRequirements: myRecentRequirements ?? [],
    quotationsByStatus:   Object.entries(quotStatusMap).map(([name, value]) => ({ name, value })),
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
    { data: allRequirements },
  ] = await Promise.all([
    supabase.from('requirements').select('*', { count: 'exact', head: true }).in('status', ['Pending Review', 'Operations Review']),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Available'),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).in('status', ['Assigned', 'In Transit']),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).in('status', ['Open', 'In Progress']),
    supabase.from('requirements').select('requirement_id, requirement_summary, status, priority, created_at, customers(company_name)').in('status', ['Pending Review', 'Operations Review']).order('created_at', { ascending: false }).limit(8),
    supabase.from('equipment_units').select('location'),
    supabase.from('requirements').select('status'),
  ]);

  const locationMap = {};
  equipmentByLocation?.forEach(e => {
    if (e.location) locationMap[e.location] = (locationMap[e.location] || 0) + 1;
  });

  const reqStatusMap = {};
  allRequirements?.forEach(r => { reqStatusMap[r.status] = (reqStatusMap[r.status] || 0) + 1; });

  return {
    stats: { pendingReview: pendingReview ?? 0, availableEquipment: availableEquipment ?? 0, activeDispatches: activeDispatches ?? 0, openMaintenance: openMaintenance ?? 0 },
    pendingRequirements:  pendingRequirements ?? [],
    equipmentByLocation:  Object.entries(locationMap).map(([name, value]) => ({ name, value })),
    requirementsByStatus: Object.entries(reqStatusMap).map(([name, value]) => ({ name, value })),
  };
}

export async function fetchDispatchStats() {
  const [
    { count: pending },
    { count: inTransit },
    { count: completedToday },
    { data: activeDispatches },
    { data: allDispatches },
  ] = await Promise.all([
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).eq('status', 'In Transit'),
    supabase.from('dispatches').select('*', { count: 'exact', head: true }).eq('status', 'Completed').gte('updated_at', new Date().toISOString().split('T')[0]),
    supabase.from('dispatches').select('dispatch_id, status, destination, driver_name, vehicle_type, dispatch_date, equipment_units(equipment_types(name), capacity)').in('status', ['Pending', 'Assigned', 'In Transit']).order('dispatch_date', { ascending: true }).limit(10),
    supabase.from('dispatches').select('status'),
  ]);

  const dispStatusMap = {};
  allDispatches?.forEach(d => { dispStatusMap[d.status] = (dispStatusMap[d.status] || 0) + 1; });

  return {
    stats: {
      pending:        pending        ?? 0,
      inTransit:      inTransit      ?? 0,
      completedToday: completedToday ?? 0,
      assigned:       dispStatusMap['Assigned'] ?? 0,
    },
    activeDispatches: activeDispatches ?? [],
    dispatchByStatus: Object.entries(dispStatusMap).map(([name, value]) => ({ name, value })),
  };
}

export async function fetchMaintenanceStats() {
  const [
    { count: open },
    { count: inProgress },
    { count: completedThisMonth },
    { data: jobs },
    { data: allIssueTypes },
  ] = await Promise.all([
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).eq('status', 'Open'),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).eq('status', 'In Progress'),
    supabase.from('maintenance').select('*', { count: 'exact', head: true }).eq('status', 'Completed').gte('completion_date', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from('maintenance').select('maintenance_id, issue, issue_type, status, service_date, equipment_units(equipment_id, capacity, equipment_types(name))').in('status', ['Open', 'In Progress']).order('service_date', { ascending: true }).limit(10),
    supabase.from('maintenance').select('issue_type'),
  ]);

  const issueTypeMap = {};
  allIssueTypes?.forEach(j => {
    const t = j.issue_type || 'Other';
    issueTypeMap[t] = (issueTypeMap[t] || 0) + 1;
  });

  return {
    stats: { open: open ?? 0, inProgress: inProgress ?? 0, completedThisMonth: completedThisMonth ?? 0 },
    jobs:        jobs ?? [],
    byIssueType: Object.entries(issueTypeMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
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
    supabase.from('invoices').select('invoice_id, status, total_amount_kwd, issue_date, customers(company_name)').order('created_at', { ascending: false }).limit(6),
  ]);

  const totalBilled    = invoiceData?.reduce((s, i) => s + (i.total_amount_kwd  || 0), 0) ?? 0;
  const totalCollected = invoiceData?.reduce((s, i) => s + (i.amount_paid_kwd   || 0), 0) ?? 0;

  const invStatusMap = {};
  invoiceData?.forEach(i => { invStatusMap[i.status] = (invStatusMap[i.status] || 0) + 1; });

  return {
    stats: {
      pendingInvoices:  pendingInvoices ?? 0,
      approvalNeeded:   approvalNeeded  ?? 0,
      totalBilled,
      totalCollected,
      outstanding: totalBilled - totalCollected,
    },
    recentInvoices:  recentInvoices ?? [],
    invoiceByStatus: Object.entries(invStatusMap).map(([name, value]) => ({ name, value })),
  };
}

export async function fetchProcurementStats() {
  const today = new Date().toISOString().split('T')[0];

  const [
    { data: allProcs,    error: e1 },
    { data: allPOs,      error: e2 },
    { count: vendorCount, error: e3 },
    { data: recentProcs, error: e4 },
    { data: upcomingPOs, error: e5 },
  ] = await Promise.all([
    supabase.from('procurements').select('procurement_id, status, total_amount_kwd, type, priority'),
    supabase.from('purchase_orders').select('po_id, status, total_amount_kwd, expected_delivery'),
    supabase.from('vendors').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('procurements')
      .select('procurement_id, title, status, total_amount_kwd, created_at, type, priority, vendors(name)')
      .order('created_at', { ascending: false }).limit(5),
    supabase.from('purchase_orders')
      .select('po_id, po_number, status, expected_delivery, total_amount_kwd, vendors(name), procurements(title)')
      .not('status', 'in', '("Delivered","Cancelled")')
      .order('expected_delivery', { ascending: true }).limit(8),
  ]);

  if (e1 || e2 || e3) throw e1 || e2 || e3;

  const procs = allProcs ?? [];
  const pos   = allPOs   ?? [];

  const totalBudget = procs
    .filter(p => !['Cancelled', 'Rejected'].includes(p.status))
    .reduce((s, p) => s + (p.total_amount_kwd ?? 0), 0);

  const procByStatus = {};
  procs.forEach(p => { procByStatus[p.status] = (procByStatus[p.status] ?? 0) + 1; });

  const poByStatus = {};
  pos.forEach(p => { poByStatus[p.status] = (poByStatus[p.status] ?? 0) + 1; });

  return {
    stats: {
      totalProcurements:  procs.length,
      pendingApproval:    procs.filter(p => p.status === 'Pending Approval').length,
      activePOs:          pos.filter(p => p.status !== 'Delivered').length,
      totalVendors:       vendorCount ?? 0,
      totalBudget,
      overdueDeliveries:  pos.filter(p =>
        p.expected_delivery && p.expected_delivery < today && p.status !== 'Delivered'
      ).length,
    },
    procByStatus:       Object.entries(procByStatus).map(([name, value]) => ({ name, value })),
    poByStatus:         Object.entries(poByStatus).map(([name, value]) => ({ name, value })),
    recentProcurements: recentProcs ?? [],
    upcomingPOs:        upcomingPOs ?? [],
  };
}

export async function fetchITStats() {
  const todayStart    = new Date(); todayStart.setHours(0, 0, 0, 0);
  const eightHoursAgo = new Date(Date.now() - 8 * 3_600_000).toISOString();

  const [
    { data: allUsers,       error: e1 },
    { data: sessionToday,   error: e2 },
    { data: activeSessions, error: e3 },
    { data: equipmentData,  error: e4 },
    { count: openMaint,     error: e5 },
    { count: pendingProc,   error: e6 },
    { data: recentSessions, error: e7 },
    { data: maintJobs,      error: e8 },
  ] = await Promise.all([
    supabase.from('users').select('user_id, name, role, is_active'),
    supabase.from('session_logs').select('session_log_id', { count: 'exact', head: false })
      .gte('logged_in_at', todayStart.toISOString()),
    supabase.from('session_logs').select('session_log_id', { count: 'exact', head: false })
      .is('logged_out_at', null).gte('logged_in_at', eightHoursAgo),
    supabase.from('equipment_units').select('status'),
    supabase.from('maintenance').select('*', { count: 'exact', head: true })
      .in('status', ['Open', 'In Progress']),
    supabase.from('procurements').select('*', { count: 'exact', head: true })
      .in('status', ['Draft', 'Pending Approval']),
    supabase.from('session_logs')
      .select('session_log_id, username, name, role, department, logged_in_at, logged_out_at, session_duration_seconds, user_agent')
      .order('logged_in_at', { ascending: false }).limit(10),
    supabase.from('maintenance')
      .select('maintenance_id, issue, status, service_date, equipment_units(capacity, equipment_types(name))')
      .in('status', ['Open', 'In Progress'])
      .order('service_date', { ascending: true }).limit(6),
  ]);

  if (e1) throw e1;

  const users = allUsers ?? [];
  const roleMap = {};
  users.filter(u => u.is_active).forEach(u => {
    roleMap[u.role] = (roleMap[u.role] ?? 0) + 1;
  });

  const eqMap = {};
  (equipmentData ?? []).forEach(e => {
    eqMap[e.status] = (eqMap[e.status] ?? 0) + 1;
  });

  return {
    stats: {
      totalUsers:         users.length,
      activeUsers:        users.filter(u => u.is_active).length,
      activeSessions:     (activeSessions ?? []).length,
      loginsToday:        (sessionToday   ?? []).length,
      totalEquipment:     (equipmentData  ?? []).length,
      openMaintenance:    openMaint  ?? 0,
      pendingProcurement: pendingProc ?? 0,
    },
    usersByRole:       Object.entries(roleMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    equipmentByStatus: Object.entries(eqMap).map(([name, value]) => ({ name, value })),
    recentSessions:    recentSessions ?? [],
    maintenanceJobs:   maintJobs     ?? [],
  };
}

export async function fetchWarehouseStats() {
  const [
    { count: total },
    { count: available },
    { count: maintenance },
    { count: dispatched },
    { count: reserved },
    { data: byType },
  ] = await Promise.all([
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Available'),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Maintenance'),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Dispatched'),
    supabase.from('equipment_units').select('*', { count: 'exact', head: true }).eq('status', 'Reserved'),
    supabase.from('equipment_units').select('status, equipment_types(name)'),
  ]);

  const typeMap   = {};
  const statusMap = {};
  byType?.forEach(e => {
    const name = e.equipment_types?.name ?? 'Unknown';
    typeMap[name]       = (typeMap[name]       || 0) + 1;
    statusMap[e.status] = (statusMap[e.status] || 0) + 1;
  });

  return {
    stats: {
      total:       total       ?? 0,
      available:   available   ?? 0,
      maintenance: maintenance ?? 0,
      dispatched:  dispatched  ?? 0,
      reserved:    reserved    ?? 0,
    },
    byType:   Object.entries(typeMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
    byStatus: Object.entries(statusMap).map(([name, value]) => ({ name, value })),
  };
}
