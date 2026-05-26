import { supabase } from '../lib/supabaseClient';

export async function createUserInSupabase(name, username, email, role, department, password) {
  // We create auth user via admin API — requires service role
  // Since we can't use service role in frontend, we create via Supabase directly
  // and instruct to confirm manually, OR use this approach:

  // 1. Create the auth user via signUp (they'll be unconfirmed)
  const { supabase: supabaseAdmin } = await import('../lib/supabaseClient');
  const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });
  if (authError) throw authError;

  // 2. Insert profile row
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      auth_id: authData.user?.id,
      name, username, email, role, department, is_active: true,
    })
    .select()
    .single();
  if (error) throw error;

  return data;
}
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