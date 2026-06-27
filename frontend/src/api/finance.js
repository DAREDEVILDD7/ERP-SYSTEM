import { supabase } from '../lib/supabaseClient';

export async function getInvoices(filters = {}) {
  let query = supabase
    .from('invoices')
    .select(`
      *,
      customers ( company_name, contact_person, email, phone ),
      quotations (
        quotation_id, total_amount_kwd, status,
        requirements ( requirement_summary )
      )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) {
    // Will filter client-side
  }

  const { data, error } = await query;
  if (error) throw error;

  // Fetch creator names separately
  const userIds = [...new Set((data ?? []).map(i => i.created_by).filter(Boolean))];
  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('user_id, name').in('user_id', userIds);
    usersMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  return (data ?? []).map(i => ({ ...i, creator: usersMap[i.created_by] ?? null }));
}

export async function createInvoice(payload) {
  const { data, error } = await supabase
    .from('invoices')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateInvoice(id, payload) {
  const { data, error } = await supabase
    .from('invoices')
    .update(payload)
    .eq('invoice_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Lease Invoices ────────────────────────────────────────────────────────────

export async function getLeaseInvoices(filters = {}) {
  let query = supabase
    .from('lease_invoices')
    .select(`
      *,
      equipment_units (
        equipment_id, serial_number, capacity, lease_start_date, lease_end_date,
        daily_rate_kwd,
        equipment_types ( name, category ),
        procurements ( title, vendors ( name ) )
      )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;

  const userIds = [...new Set((data ?? []).map(i => i.created_by).filter(Boolean))];
  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('user_id, name').in('user_id', userIds);
    usersMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  return (data ?? []).map(i => ({ ...i, creator: usersMap[i.created_by] ?? null }));
}

export async function createLeaseInvoice(payload) {
  const { data, error } = await supabase
    .from('lease_invoices')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLeaseInvoice(id, payload) {
  const { data, error } = await supabase
    .from('lease_invoices')
    .update(payload)
    .eq('lease_invoice_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLeasedEquipment() {
  const { data, error } = await supabase
    .from('equipment_units')
    .select(`
      equipment_id, serial_number, capacity, status,
      lease_start_date, lease_end_date, daily_rate_kwd,
      lease_returned_at,
      equipment_types ( name ),
      procurements ( title, vendors ( name ) )
    `)
    .eq('procurement_type', 'Lease')
    .is('lease_returned_at', null)
    .order('lease_end_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getPendingQuotations() {
  const { data, error } = await supabase
    .from('quotations')
    .select(`
      *,
      customers ( company_name, contact_person ),
      requirements ( requirement_summary )
    `)
    .eq('status', 'Approved')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}