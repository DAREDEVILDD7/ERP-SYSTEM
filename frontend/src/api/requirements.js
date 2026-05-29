import { supabase } from '../lib/supabaseClient';

export async function getRequirements(filters = {}) {
  let query = supabase
    .from('requirements')
    .select(`
      *,
      customers ( customer_id, company_name, contact_person ),
      users!requirements_created_by_fkey ( user_id, name, role )
    `)
    .order('created_at', { ascending: false });

  if (filters.status)      query = query.eq('status', filters.status);
  if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
  if (filters.created_by)  query = query.eq('created_by', filters.created_by);

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
      requirement_items (
        *,
        equipment_types ( name, category )
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

export async function createRequirement(payload, items = []) {
  const { data, error } = await supabase
    .from('requirements')
    .insert({ ...payload, status: 'Pending Review' })
    .select()
    .single();
  if (error) throw error;

  if (items.length > 0) {
    const { error: itemsError } = await supabase
      .from('requirement_items')
      .insert(items.map(i => ({ ...i, requirement_id: data.requirement_id })));
    if (itemsError) console.error('Failed to insert requirement items:', itemsError);
  }

  return data;
}

export async function updateRequirement(id, payload, items = null) {
  const { data, error } = await supabase
    .from('requirements')
    .update(payload)
    .eq('requirement_id', id)
    .select()
    .single();
  if (error) throw error;

  // If items provided, replace them
  if (items !== null) {
    await supabase.from('requirement_items').delete().eq('requirement_id', id);
    if (items.length > 0) {
      await supabase.from('requirement_items').insert(
        items.map(i => ({ ...i, requirement_id: id }))
      );
    }
  }

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