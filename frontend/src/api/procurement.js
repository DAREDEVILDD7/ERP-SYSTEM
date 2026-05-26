import { supabase } from '../lib/supabaseClient';

export async function getProcurements(filters = {}) {
  let query = supabase
    .from('procurements')
    .select(`
      *,
      vendors ( vendor_id, name, contact_person ),
      users!procurements_requested_by_fkey ( name, role ),
      procurement_items ( * )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.type)   query = query.eq('type',   filters.type);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getProcurement(id) {
  const { data, error } = await supabase
    .from('procurements')
    .select(`
      *,
      vendors ( * ),
      users!procurements_requested_by_fkey ( name, role ),
      procurement_items ( *, equipment_types ( name ) ),
      purchase_orders ( * )
    `)
    .eq('procurement_id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createProcurement(payload, items) {
  const { data, error } = await supabase
    .from('procurements')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  if (items?.length > 0) {
    const { error: ie } = await supabase
      .from('procurement_items')
      .insert(items.map(i => ({ ...i, procurement_id: data.procurement_id })));
    if (ie) throw ie;
  }
  return data;
}

export async function updateProcurement(id, payload) {
  const { data, error } = await supabase
    .from('procurements')
    .update(payload)
    .eq('procurement_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getVendors() {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createVendor(payload) {
  const { data, error } = await supabase
    .from('vendors')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVendor(id, payload) {
  const { data, error } = await supabase
    .from('vendors')
    .update(payload)
    .eq('vendor_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPurchaseOrders(filters = {}) {
  let query = supabase
    .from('purchase_orders')
    .select(`
      *,
      vendors ( name, contact_person, email ),
      procurements ( procurement_id, title, type ),
      users!purchase_orders_created_by_fkey ( name )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createPurchaseOrder(payload) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePurchaseOrder(id, payload) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update(payload)
    .eq('po_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function submitPurchaseOrder(id) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'Submitted', submitted_at: new Date().toISOString() })
    .eq('po_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addToFleet(item, equipmentTypeId, location) {
  // Create equipment unit from procurement item
  const { data, error } = await supabase
    .from('equipment_units')
    .insert({
      type_id: equipmentTypeId,
      description: item.description,
      quantity: item.quantity,
      status: 'Available',
      location,
      daily_rate_kwd: 0,
      notes: `Added from procurement ${item.procurement_id}`,
    })
    .select()
    .single();
  if (error) throw error;

  // Mark item as added to fleet
  await supabase
    .from('procurement_items')
    .update({ added_to_fleet: true })
    .eq('item_id', item.item_id);

  return data;
}