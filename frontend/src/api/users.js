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


