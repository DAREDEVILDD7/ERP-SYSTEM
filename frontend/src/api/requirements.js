import { supabase } from '../lib/supabaseClient';

export async function getRequirements(filters = {}) {
  let query = supabase
    .from('requirements')
    .select(`
      *,
      customers ( customer_id, company_name, contact_person ),
      users!requirements_created_by_fkey ( name, role )
    `)
    .order('created_at', { ascending: false });

  if (filters.status)      query = query.eq('status', filters.status);
  if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
  if (filters.created_by)  query = query.eq('created_by', filters.created_by);
  if (filters.search)      query = query.ilike('requirement_summary', `%${filters.search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRequirement(id) {
  const { data, error } = await supabase
    .from('requirements')
    .select(`
      *,
      customers ( * ),
      users!requirements_created_by_fkey ( name, role, department ),
      quotations (
        quotation_id, status, total_amount_kwd, quotation_date,
        users!quotations_prepared_by_fkey ( name )
      ),
      chat_messages (
        *,
        users!chat_messages_sender_id_fkey ( name, role, department )
      )
    `)
    .eq('requirement_id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createRequirement(payload) {
  const { data, error } = await supabase
    .from('requirements')
    .insert({ ...payload, status: 'Pending Review' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRequirement(id, payload) {
  const { data, error } = await supabase
    .from('requirements')
    .update(payload)
    .eq('requirement_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('customer_id, company_name, contact_person')
    .eq('is_active', true)
    .order('company_name');
  if (error) throw error;
  return data ?? [];
}