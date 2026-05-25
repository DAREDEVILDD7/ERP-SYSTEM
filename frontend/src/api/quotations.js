import { supabase } from '../lib/supabaseClient';

export async function getQuotations(filters = {}) {
  let query = supabase
    .from('quotations')
    .select(`
      *,
      customers ( customer_id, company_name, contact_person, email, phone ),
      requirements ( requirement_id, requirement_summary, location ),
      users!quotations_prepared_by_fkey ( name, role ),
      quotation_items ( * )
    `)
    .order('created_at', { ascending: false });

  if (filters.status)      query = query.eq('status', filters.status);
  if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
  if (filters.prepared_by) query = query.eq('prepared_by', filters.prepared_by);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getQuotation(id) {
  const { data, error } = await supabase
    .from('quotations')
    .select(`
      *,
      customers ( * ),
      requirements ( * ),
      users!quotations_prepared_by_fkey ( name, role, department ),
      quotation_items ( *, equipment_units ( equipment_id, capacity, serial_number, equipment_types ( name ) ) )
    `)
    .eq('quotation_id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createQuotation(payload, items) {
  const { data: quotation, error } = await supabase
    .from('quotations')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  if (items?.length > 0) {
    const { error: itemsError } = await supabase
      .from('quotation_items')
      .insert(items.map(item => ({ ...item, quotation_id: quotation.quotation_id })));
    if (itemsError) throw itemsError;
  }
  return quotation;
}

export async function updateQuotation(id, payload) {
  const { data, error } = await supabase
    .from('quotations')
    .update(payload)
    .eq('quotation_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateQuotationItems(quotationId, items) {
  // Delete existing items then reinsert
  const { error: deleteError } = await supabase
    .from('quotation_items')
    .delete()
    .eq('quotation_id', quotationId);
  if (deleteError) throw deleteError;

  if (items?.length > 0) {
    const { error: insertError } = await supabase
      .from('quotation_items')
      .insert(items.map(i => ({ ...i, quotation_id: quotationId })));
    if (insertError) throw insertError;
  }
}

export async function getAvailableEquipment() {
  const { data, error } = await supabase
    .from('equipment_units')
    .select('equipment_id, serial_number, capacity, status, location, daily_rate_kwd, equipment_types ( name )')
    .in('status', ['Available', 'Reserved'])
    .order('status');
  if (error) throw error;
  return data;
}