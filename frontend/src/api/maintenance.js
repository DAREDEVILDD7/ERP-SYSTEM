import { supabase } from '../lib/supabaseClient';

export async function getMaintenanceJobs(filters = {}) {
  let query = supabase
    .from('maintenance')
    .select(`
      *,
      equipment_units ( equipment_id, serial_number, capacity, location, equipment_types ( name ) ),
      users!maintenance_reported_by_fkey ( name ),
      users!maintenance_assigned_to_fkey ( name )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createMaintenanceJob(payload) {
  const { data, error } = await supabase
    .from('maintenance')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMaintenanceJob(id, payload) {
  const { data, error } = await supabase
    .from('maintenance')
    .update(payload)
    .eq('maintenance_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}