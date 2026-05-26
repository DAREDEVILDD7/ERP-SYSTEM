import { supabase } from '../lib/supabaseClient';

export async function getDispatches(filters = {}) {
  let query = supabase
    .from('dispatches')
    .select(`
      *,
      quotations (
        quotation_id, total_amount_kwd, status,
        customers ( company_name )
      ),
      requirements ( requirement_id, requirement_summary ),
      dispatch_items (
        item_id, equipment_id, notes,
        equipment_units (
          equipment_id, serial_number, capacity, status, location,
          equipment_types ( name )
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;

  // Fetch assigner separately
  const userIds = [...new Set((data ?? []).map(d => d.assigned_by).filter(Boolean))];
  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('user_id, name').in('user_id', userIds);
    usersMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  return (data ?? []).map(d => ({ ...d, assigner: usersMap[d.assigned_by] ?? null }));
}

export async function getApprovedQuotations() {
  const { data, error } = await supabase
    .from('quotations')
    .select(`
      quotation_id, total_amount_kwd, status, quotation_date,
      customers ( company_name, contact_person ),
      requirements ( requirement_summary, location ),
      quotation_items (
        item_id, description, quantity, unit,
        equipment_id, rental_start_date, rental_end_date,
        equipment_units (
          equipment_id, serial_number, capacity, status, location,
          equipment_types ( name )
        )
      )
    `)
    .eq('status', 'Approved')
    .order('quotation_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createDispatch(payload, equipmentIds = []) {
  const { data: dispatch, error } = await supabase
    .from('dispatches')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  if (equipmentIds.length > 0) {
    const { error: itemsError } = await supabase
      .from('dispatch_items')
      .insert(equipmentIds.map(eqId => ({
        dispatch_id:  dispatch.dispatch_id,
        equipment_id: eqId,
      })));
    if (itemsError) throw itemsError;
  }

  return dispatch;
}

export async function updateDispatch(id, payload) {
  const { data, error } = await supabase
    .from('dispatches')
    .update(payload)
    .eq('dispatch_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDispatch(id) {
  const { error } = await supabase
    .from('dispatches')
    .delete()
    .eq('dispatch_id', id);
  if (error) throw error;
}