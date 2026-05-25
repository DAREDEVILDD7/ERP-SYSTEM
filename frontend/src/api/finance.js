import { supabase } from '../lib/supabaseClient';

export async function getInvoices(filters = {}) {
  let query = supabase
    .from('invoices')
    .select(`
      *,
      customers ( company_name, contact_person, email ),
      quotations ( quotation_id, total_amount_kwd ),
      users!invoices_created_by_fkey ( name )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createInvoice(payload) {
  const { data, error } = await supabase
    .from('invoices')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateInvoice(id, payload) {
  const { data, error } = await supabase
    .from('invoices')
    .update(payload)
    .eq('invoice_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPendingQuotations() {
  const { data, error } = await supabase
    .from('quotations')
    .select(`
      *,
      customers ( company_name ),
      requirements ( requirement_summary ),
      users!quotations_prepared_by_fkey ( name )
    `)
    .eq('status', 'Sent')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}