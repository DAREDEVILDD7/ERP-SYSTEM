import { supabase } from '../lib/supabaseClient';

export async function getMaintenanceJobs(filters = {}) {
  let query = supabase
    .from('maintenance')
    .select(`
      *,
      equipment_units (
        equipment_id, serial_number, capacity, location,
        equipment_types ( name )
      )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;

  // Fetch reporter and assignee names separately to avoid FK hint issues
  const userIds = [...new Set([
    ...data.map(j => j.reported_by),
    ...data.map(j => j.assigned_to),
  ].filter(Boolean))];

  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('user_id, name, role')
      .in('user_id', userIds);
    usersMap = Object.fromEntries((users ?? []).map(u => [u.user_id, u]));
  }

  return data.map(j => ({
    ...j,
    reporter: usersMap[j.reported_by] ?? null,
    assignee: usersMap[j.assigned_to] ?? null,
  }));
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