import { supabase } from '../lib/supabaseClient';

// Creates ONE dispatch per quotation item on approval.
// Items with a fleet equipment_id get a full dispatch + dispatch_item.
// Items without an equipment_id are matched against available fleet units by
// description/type — handles the case where procurement was received before
// the quotation was approved (so the DB link was never written at receive-time).
export async function createDispatchesFromQuotation(quotation, assignedBy) {
  if (!quotation?.quotation_id) throw new Error('Quotation is required');

  const items = quotation.quotation_items ?? [];
  if (items.length === 0) return { created: [], pendingProcurement: [], errors: [] };

  const destination   = quotation.requirements?.location ?? '';
  const requirementId = quotation.requirement_id ?? quotation.requirements?.requirement_id ?? null;

  const created            = [];
  const pendingProcurement = [];
  const errors             = [];

  // Pre-load fleet data once for any items that are still missing an equipment_id
  const nullItems = items.filter(i => !i.equipment_id);
  let equipmentTypes     = [];
  let availableEquipment = [];
  if (nullItems.length > 0) {
    const [typesRes, eqRes] = await Promise.all([
      supabase.from('equipment_types').select('type_id, name'),
      supabase.from('equipment_units')
        .select('equipment_id, type_id, capacity, status')
        .in('status', ['Available', 'Reserved']),
    ]);
    equipmentTypes     = typesRes.data ?? [];
    availableEquipment = eqRes.data   ?? [];
  }
  // Tracks units claimed within this approval pass to prevent double-assignment
  const claimedIds = new Set();

  for (const item of items) {
    try {
      let equipmentId = item.equipment_id ?? null;

      // No fleet unit yet — attempt best-effort match by description prefix vs type name
      if (!equipmentId) {
        const descPart = (item.description || '').split(' — ')[0].trim().toLowerCase();
        const matchedType = equipmentTypes.find(t => {
          const tName = t.name.trim().toLowerCase();
          return descPart === tName || descPart.startsWith(tName + ' ');
        });
        if (matchedType) {
          const unit = availableEquipment.find(e =>
            e.type_id === matchedType.type_id && !claimedIds.has(e.equipment_id)
          );
          if (unit) {
            equipmentId = unit.equipment_id;
            claimedIds.add(equipmentId);
            // Persist the link so the quotation_item stays consistent
            await supabase
              .from('quotation_items')
              .update({ equipment_id: equipmentId })
              .eq('item_id', item.item_id);
          }
        }
      }

      if (equipmentId) {
        // Idempotency: skip if a non-cancelled dispatch already exists for this pair
        const { data: existing } = await supabase
          .from('dispatches')
          .select('dispatch_id')
          .eq('quotation_id', quotation.quotation_id)
          .eq('equipment_id', equipmentId)
          .neq('status', 'Cancelled')
          .limit(1);

        if (existing?.length > 0) {
          created.push({ dispatch: existing[0], item: { ...item, equipment_id: equipmentId } });
        } else {
          const dispatch = await createDispatch({
            quotation_id:   quotation.quotation_id,
            requirement_id: requirementId,
            assigned_by:    assignedBy,
            destination,
            status:         'Pending',
            dispatch_type:  'Full',
            equipment_id:   equipmentId,
            dispatch_date:  item.rental_start_date ?? null,
            return_date:    item.rental_end_date   ?? null,
            items_total:    1,
            notes:          item.description ?? null,
          }, [equipmentId]);
          created.push({ dispatch, item: { ...item, equipment_id: equipmentId } });
        }
      } else {
        // Still no match — equipment genuinely not in fleet yet
        pendingProcurement.push({ item });
      }
    } catch (err) {
      console.error('[createDispatchesFromQuotation] Failed for item:', item, err);
      errors.push({ item, error: err.message ?? String(err) });
    }
  }

  return { created, pendingProcurement, errors };
}

// Legacy single-dispatch helper — kept for backwards compatibility
export async function createDispatchFromQuotation(quotation, assignedBy) {
  const result = await createDispatchesFromQuotation(quotation, assignedBy);
  return result.created[0]?.dispatch ?? null;
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
    awaiting_equipment,   // not a DB column — conveyed via notes prefix
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
    console.error('[createDispatch] Error:', error?.message, '|', error?.details, '| code:', error?.code);
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