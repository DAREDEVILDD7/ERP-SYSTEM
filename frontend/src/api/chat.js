import { supabase } from '../lib/supabaseClient';

export async function getChatThreads(userId) {
  // Get all requirements that have chat messages involving this user
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`
      related_requirement,
      requirements ( requirement_id, requirement_summary, status, customers ( company_name ) )
    `)
    .not('related_requirement', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Deduplicate by requirement
  const seen = new Set();
  return (data ?? []).filter(m => {
    if (!m.related_requirement || seen.has(m.related_requirement)) return false;
    seen.add(m.related_requirement);
    return true;
  });
}

export async function getChatMessages(requirementId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(`*, users!chat_messages_sender_id_fkey ( name, role, department )`)
    .eq('related_requirement', requirementId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(payload) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}