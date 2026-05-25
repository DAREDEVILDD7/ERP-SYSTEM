import { supabase } from '../lib/supabaseClient';

export async function getDispatches(filters = {}) {
  let query = supabase
    .from('dispatches')
    .select(`
      *,
      equipment_units ( equipment_id, serial_number, capacity, equipment_types ( name ) ),
      quotations ( quotation_id, total_amount_kwd ),
      requirements ( requirement_id, requirement_summary ),
      users!dispatches_assigned_by_fkey ( name )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createDispatch(payload) {
  const { data, error } = await supabase
    .from('dispatches')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
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