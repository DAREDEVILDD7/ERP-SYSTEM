import { supabase } from '../lib/supabaseClient';

// Creates a single dispatch for an entire quotation (all equipment items grouped together)
// Call this on quotation approval instead of looping per-item
export async function createDispatchFromQuotation(quotation, assignedBy) {
  if (!quotation?.quotation_id) throw new Error('Quotation is required');

  // Collect all equipment IDs from quotation items
  const equipmentIds = (quotation.quotation_items ?? [])
    .filter(item => item.equipment_id)
    .map(item => item.equipment_id);

  if (equipmentIds.length === 0) {
    console.warn('[createDispatchFromQuotation] No equipment items found in quotation');
    return null;
  }

  const destination = quotation.requirements?.location ?? '';
  const startDates  = (quotation.quotation_items ?? []).filter(i => i.rental_start_date).map(i => i.rental_start_date);
  const endDates    = (quotation.quotation_items ?? []).filter(i => i.rental_end_date).map(i => i.rental_end_date);

  const payload = {
    quotation_id:   quotation.quotation_id,
    requirement_id: quotation.requirement_id ?? quotation.requirements?.requirement_id ?? null,
    assigned_by:    assignedBy,
    destination:    destination,
    status:         'Pending',
    dispatch_type:  'Full',
    equipment_id:   equipmentIds[0], // primary equipment reference
    dispatch_date:  startDates.length > 0 ? startDates[0] : null,
    return_date:    endDates.length > 0 ? endDates[endDates.length - 1] : null,
    items_total:    equipmentIds.length,
  };

  return createDispatch(payload, equipmentIds);
}

export async function getDispatchesFast(filters = {}) {
  let query = supabase
    .from('dispatches')
    .select(`
      dispatch_id, quotation_id, requirement_id, equipment_id,
      assigned_by, cancelled_by, driver_name, vehicle_type,
      vehicle_plate, destination, status, dispatch_type,
      dispatch_date, return_date, actual_return_date,
      notes, cancel_reason, cancelled_at, created_at,
      items_total, items_dispatched, items_returned,
      quotations (
        quotation_id, total_amount_kwd, approved_by,
        customers ( company_name, industry, contact_person ),
        requirements ( requirement_summary, location )
      ),
      dispatch_items (
        item_id, equipment_id, dispatch_status,
        dispatched_at, returned_at, return_notes, extended_return_date,
        equipment_units (
          equipment_id, serial_number, capacity, status, location,
          equipment_types ( name )
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (filters.status && filters.status !== 'All') {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Batch-fetch user names
  const userIds = [...new Set([
    ...(data ?? []).map(d => d.assigned_by),
    ...(data ?? []).map(d => d.cancelled_by),
  ].filter(Boolean))];

  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('user_id, name, role')
      .in('user_id', userIds);
    if (usersError) console.error('[getDispatchesFast] users fetch error:', usersError);
    usersMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  // Batch-fetch approver names from quotations
  const approverIds = [...new Set(
    (data ?? []).map(d => d.quotations?.approved_by).filter(Boolean)
  )];
  let approversMap = {};
  if (approverIds.length > 0) {
    const { data: approvers, error: approversError } = await supabase
      .from('users')
      .select('user_id, name, role')
      .in('user_id', approverIds);
    if (approversError) console.error('[getDispatchesFast] approvers fetch error:', approversError);
    approversMap = Object.fromEntries((approvers ?? []).map(u => [u.user_id, u]));
  }

  return (data ?? []).map(d => ({
    ...d,
    assigner:          usersMap[d.assigned_by]                 ?? null,
    cancelledByUser:   usersMap[d.cancelled_by]                ?? null,
    quotationApprover: approversMap[d.quotations?.approved_by] ?? null,
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

  const approverIds = [...new Set((data ?? []).map(q => q.approved_by).filter(Boolean))];
  let approversMap = {};
  if (approverIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('user_id, name, role')
      .in('user_id', approverIds);
    if (usersError) console.error('[getApprovedQuotations] users fetch error:', usersError);
    approversMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  return (data ?? []).map(q => ({ ...q, approver: approversMap[q.approved_by] ?? null }));
}

export async function createDispatch(payload, equipmentIds = []) {
  const {
    assigner, cancelledByUser, quotationApprover,
    quotations, dispatch_items,
    ...cleanPayload
  } = payload;

  // Ensure status defaults to Pending
  if (!cleanPayload.status) cleanPayload.status = 'Pending';

  const { data: dispatch, error } = await supabase
    .from('dispatches')
    .insert({ ...cleanPayload, items_total: equipmentIds.length })
    .select()
    .single();

  if (error) {
    console.error('[createDispatch] Error:', error);
    throw error;
  }

  if (equipmentIds.length > 0) {
    const { error: itemsError } = await supabase
      .from('dispatch_items')
      .insert(
        equipmentIds.map(eqId => ({
          dispatch_id:     dispatch.dispatch_id,
          equipment_id:    eqId,
          dispatch_status: 'Pending',
        }))
      );
    if (itemsError) {
      console.error('[createDispatch] dispatch_items insert error:', itemsError);
      throw itemsError;
    }
  }

  return dispatch;
}

export async function updateDispatch(id, payload) {
  const {
    assigner, cancelledByUser, quotationApprover,
    quotations, dispatch_items,
    ...cleanPayload
  } = payload;

  const { data, error } = await supabase
    .from('dispatches')
    .update(cleanPayload)
    .eq('dispatch_id', id)
    .select()
    .single();

  if (error) {
    console.error('[updateDispatch] Error:', error);
    throw error;
  }
  return data;
}

export async function cancelDispatch(id, reason, userId) {
  if (!id)     throw new Error('Dispatch ID is required');
  if (!reason) throw new Error('Cancellation reason is required');
  if (!userId) throw new Error('User ID is required');

  const { data, error } = await supabase
    .from('dispatches')
    .update({
      status:        'Cancelled',
      cancel_reason: reason,
      cancelled_by:  userId,
      cancelled_at:  new Date().toISOString(),
    })
    .eq('dispatch_id', id)
    .select()
    .single();

  if (error) {
    console.error('[cancelDispatch] Error:', error);
    throw error;
  }
  return data;
}

// Dispatch selected items (partial or full)
export async function dispatchItems(dispatchId, itemIds, driverInfo = {}) {
  if (!dispatchId)        throw new Error('Dispatch ID is required');
  if (!itemIds?.length)   throw new Error('No items selected to dispatch');

  const now = new Date().toISOString();

  // Update each selected dispatch_item to Dispatched
  for (const itemId of itemIds) {
    const { error } = await supabase
      .from('dispatch_items')
      .update({ dispatch_status: 'Dispatched', dispatched_at: now })
      .eq('item_id', itemId);
    if (error) {
      console.error(`[dispatchItems] Failed to update item ${itemId}:`, error);
      throw error;
    }
  }

  // Update dispatch with driver info if provided (strip non-column fields)
  const { total_items, ...driverFields } = driverInfo;
  const hasDriverInfo = driverFields.driver_name || driverFields.vehicle_type || driverFields.vehicle_plate;
  if (hasDriverInfo) {
    const { error } = await supabase
      .from('dispatches')
      .update({
        ...driverFields,
        dispatch_type: itemIds.length < (total_items ?? itemIds.length) ? 'Partial' : 'Full',
      })
      .eq('dispatch_id', dispatchId);
    if (error) {
      console.error('[dispatchItems] Failed to update dispatch driver info:', error);
      throw error;
    }
  }
}

// Return selected items (partial or full)
export async function returnItems(dispatchId, returns, actionedBy) {
  if (!dispatchId)    throw new Error('Dispatch ID is required');
  if (!returns?.length) throw new Error('No items to return');

  const now = new Date().toISOString();

  for (const ret of returns) {
    const { error } = await supabase
      .from('dispatch_items')
      .update({
        dispatch_status:      'Returned',
        returned_at:          now,
        return_notes:         ret.return_notes         || null,
        extended_return_date: ret.extended_return_date || null,
      })
      .eq('item_id', ret.item_id);
    if (error) {
      console.error(`[returnItems] Failed to return item ${ret.item_id}:`, error);
      throw error;
    }
  }

  // Non-blocking audit log — must await the query itself, .catch() doesn't work on PostgrestBuilder
  try {
    await supabase.from('audit_logs').insert({
      action:     'ITEMS_RETURNED',
      table_name: 'dispatch_items',
      record_id:  dispatchId,
      new_values: { returned_items: returns.length, actioned_by: actionedBy },
    });
  } catch (auditError) {
    console.warn('[returnItems] Audit log failed (non-blocking):', auditError);
  }
}

export async function getDispatchableEquipment() {
  const { data, error } = await supabase
    .from('equipment_units')
    .select(`
      equipment_id, serial_number, capacity, status, location,
      daily_rate_kwd, type_id, equipment_types(name, type_id)
    `)
    .in('status', ['Available', 'Reserved'])
    .order('type_id');
  if (error) throw error;
  return data ?? [];
}