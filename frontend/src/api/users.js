import { supabase } from '../lib/supabaseClient';

export async function getUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

export async function updateUser(id, payload) {
  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('user_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createSystemUser(name, username, email, role, department, password) {
  // Create auth user via admin (needs service role — do this via Supabase dashboard)
  // Here we just insert the profile row assuming auth user exists
  const { data, error } = await supabase
    .from('users')
    .insert({ name, username, email, role, department, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}