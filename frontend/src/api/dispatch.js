import { supabase } from '../lib/supabaseClient';

export async function getDispatches(filters = {}) {
  let query = supabase
    .from('dispatches')
    .select(`
      *,
      quotations (
        quotation_id, total_amount_kwd, status,
        customers ( company_name, contact_person, industry ),
        requirements ( requirement_summary, location ),
        quotation_items (
          item_id, description, equipment_id, rental_start_date, rental_end_date,
          equipment_units ( equipment_id, serial_number, capacity, status, equipment_types(name) )
        )
      ),
      requirements ( requirement_id, requirement_summary, location ),
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

  const allUserIds = [
    ...(data ?? []).map(d => d.assigned_by),
    ...(data ?? []).map(d => d.cancelled_by),
  ].filter(Boolean);
  const userIds = [...new Set(allUserIds)];

  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('user_id, name, role').in('user_id', userIds);
    usersMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  // Also fetch approver name from quotation's approved_by
  const approverIds = [...new Set((data ?? [])
    .map(d => d.quotations?.approved_by).filter(Boolean))];
  let approversMap = {};
  if (approverIds.length > 0) {
    // approved_by is on quotation, fetch separately
    const quotIds = [...new Set((data ?? []).map(d => d.quotation_id).filter(Boolean))];
    if (quotIds.length > 0) {
      const { data: quots } = await supabase
        .from('quotations').select('quotation_id, approved_by')
        .in('quotation_id', quotIds);
      const qApproverIds = [...new Set((quots ?? []).map(q => q.approved_by).filter(Boolean))];
      if (qApproverIds.length > 0) {
        const { data: approvers } = await supabase
          .from('users').select('user_id, name').in('user_id', qApproverIds);
        approversMap = Object.fromEntries((approvers ?? []).map(u => [u.user_id, u]));
        (quots ?? []).forEach(q => {
          approversMap[q.quotation_id] = approversMap[q.approved_by];
        });
      }
    }
  }

  return (data ?? []).map(d => ({
    ...d,
    assigner:       usersMap[d.assigned_by]  ?? null,
    cancelledByUser: usersMap[d.cancelled_by] ?? null,
    quotationApprover: approversMap[d.quotation_id] ?? null,
  }));
}

export async function getApprovedQuotations() {
  const { data, error } = await supabase
    .from('quotations')
    .select(`
      quotation_id, total_amount_kwd, status, quotation_date, approved_by,
      customers ( company_name, contact_person, industry ),
      requirements ( requirement_summary, location, requirement_id ),
      quotation_items (
        item_id, description, quantity, unit, rental_start_date, rental_end_date,
        equipment_id,
        equipment_units (
          equipment_id, serial_number, capacity, status, location,
          equipment_types ( name )
        )
      )
    `)
    .eq('status', 'Approved')
    .order('quotation_date', { ascending: false });
  if (error) throw error;

  // Fetch approver names
  const approverIds = [...new Set((data ?? []).map(q => q.approved_by).filter(Boolean))];
  let approversMap = {};
  if (approverIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('user_id, name, role').in('user_id', approverIds);
    approversMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  return (data ?? []).map(q => ({
    ...q,
    approver: approversMap[q.approved_by] ?? null,
  }));
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
        dispatch_id: dispatch.dispatch_id,
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

export async function cancelDispatch(id, reason, userId) {
  const { data, error } = await supabase
    .from('dispatches')
    .update({
      status:       'Cancelled',
      cancel_reason: reason,
      cancelled_by: userId,
      cancelled_at: new Date().toISOString(),
    })
    .eq('dispatch_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getDispatchableEquipment() {
  const { data, error } = await supabase
    .from('equipment_units')
    .select(`equipment_id, serial_number, capacity, status, location, daily_rate_kwd, type_id, equipment_types(name, type_id)`)
    .in('status', ['Available', 'Reserved'])
    .order('type_id');
  if (error) throw error;
  return data ?? [];
}