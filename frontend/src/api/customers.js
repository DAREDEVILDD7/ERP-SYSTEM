import { supabase } from '../lib/supabaseClient';

export async function getCustomers(search = '') {
  let query = supabase
    .from('customers')
    .select('*')
    .eq('is_active', true)
    .order('company_name');

  if (search) {
    query = query.or(
      `company_name.ilike.%${search}%,contact_person.ilike.%${search}%,industry.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}


export async function createCustomer(payload) {
  const { data, error } = await supabase
    .from('customers')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id, payload) {
  const { data, error } = await supabase
    .from('customers')
    .update(payload)
    .eq('customer_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}