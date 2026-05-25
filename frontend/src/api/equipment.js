import { supabase } from '../lib/supabaseClient';

export async function getEquipmentTypes() {
  const { data, error } = await supabase
    .from('equipment_types')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data;
}

export async function getEquipmentUnits(filters = {}) {
  let query = supabase
    .from('equipment_units')
    .select('*, equipment_types ( name, category )')
    .order('equipment_id');

  if (filters.status)  query = query.eq('status', filters.status);
  if (filters.type_id) query = query.eq('type_id', filters.type_id);
  if (filters.location) query = query.ilike('location', `%${filters.location}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getEquipmentUnit(id) {
  const { data, error } = await supabase
    .from('equipment_units')
    .select(`
      *,
      equipment_types ( * ),
      dispatches ( dispatch_id, destination, status, dispatch_date, driver_name ),
      maintenance ( maintenance_id, issue, status, service_date, cost_kwd )
    `)
    .eq('equipment_id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createEquipmentType(payload) {
  const { data, error } = await supabase
    .from('equipment_types')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createEquipmentUnit(payload) {
  const { data, error } = await supabase
    .from('equipment_units')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEquipmentUnit(id, payload) {
  const { data, error } = await supabase
    .from('equipment_units')
    .update(payload)
    .eq('equipment_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}