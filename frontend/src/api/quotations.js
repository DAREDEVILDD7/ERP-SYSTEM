import { supabase } from "../lib/supabaseClient";

let _creating = false;

export async function getQuotations(filters = {}) {
  let query = supabase
    .from("quotations")
    .select(
      `
      quotation_id, requirement_id, customer_id, prepared_by,
      approved_by, status, quotation_date, valid_until,
      subtotal_kwd, vat_percent, vat_amount_kwd, total_amount_kwd,
      discount_amount, discount_percent,
      terms_conditions, notes, rejection_reason, created_at,
      customers ( customer_id, company_name, contact_person, email, phone, industry ),
      requirements ( requirement_id, requirement_summary, location, status ),
      quotation_items ( * )
    `,
    )
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.customer_id) query = query.eq("customer_id", filters.customer_id);
  if (filters.prepared_by) query = query.eq("prepared_by", filters.prepared_by);

  const { data, error } = await query;
  if (error) throw error;

  const allUserIds = [
    ...(data ?? []).map((q) => q.prepared_by),
    ...(data ?? []).map((q) => q.approved_by),
  ].filter(Boolean);
  const userIds = [...new Set(allUserIds)];

  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("user_id, name, role")
      .in("user_id", userIds);
    usersMap = Object.fromEntries((users ?? []).map((u) => [u.user_id, u]));
  }

  return (data ?? []).map((q) => ({
    ...q,
    users: usersMap[q.prepared_by] ?? null,
    approver: usersMap[q.approved_by] ?? null,
  }));
}

export async function getQuotation(id) {
  const { data, error } = await supabase
    .from("quotations")
    .select(
      `
      *,
      customers ( * ),
      requirements ( * ),
      quotation_items (
        *,
        equipment_units (
          equipment_id, capacity, serial_number, status,
          equipment_types ( name, type_id )
        )
      )
    `,
    )
    .eq("quotation_id", id)
    .single();
  if (error) throw error;

  const userIds = [data?.prepared_by, data?.approved_by].filter(Boolean);
  let usersMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("user_id, name, role, department")
      .in("user_id", userIds);
    usersMap = Object.fromEntries((users ?? []).map((u) => [u.user_id, u]));
  }

  return {
    ...data,
    users: usersMap[data?.prepared_by] ?? null,
    approver: usersMap[data?.approved_by] ?? null,
  };
}

export async function createQuotation(payload, items) {
  if (_creating) throw new Error('Please wait, already saving a quotation.');
  _creating = true;
  try {
    const { data: quotation, error } = await supabase
      .from('quotations')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    if (items?.length > 0) {
      // The form already supplies the correct unit_rate_kwd for equipment items,
      // but we optionally re-confirm the rate from the DB for safety.
      const equipmentIds = items.map(i => i.equipment_id).filter(Boolean);
      let rateMap = {};
      if (equipmentIds.length > 0) {
        const { data: eqData } = await supabase
          .from('equipment_units')
          .select('equipment_id, daily_rate_kwd')
          .in('equipment_id', equipmentIds);
        rateMap = Object.fromEntries(
          (eqData ?? []).map(e => [e.equipment_id, e.daily_rate_kwd])
        );
      }

      // Build rows using ONLY columns that exist in quotation_items.
      // item_type  → not a DB column (UI-only); excluded.
      // total_kwd  → DB DEFAULT (quantity * unit_rate_kwd); let DB compute it.
      // procurement_id → not a DB column; excluded.
      const rows = items.map(item => {
        const confirmedRate = item.equipment_id && rateMap[item.equipment_id] != null
          ? Number(rateMap[item.equipment_id])
          : Number(item.unit_rate_kwd ?? 0);

        return {
          quotation_id:      quotation.quotation_id,
          description:       (item.description ?? '').trim(),
          quantity:          Number(item.quantity)  || 1,
          unit:              item.unit              ?? 'Days',
          unit_rate_kwd:     confirmedRate,
          equipment_id:      item.equipment_id      || null,
          rental_start_date: item.rental_start_date || null,
          rental_end_date:   item.rental_end_date   || null,
          discount_amount:   Number(item.discount_amount ?? 0),
        };
      });

      const { error: itemsError } = await supabase
        .from('quotation_items')
        .insert(rows);
      if (itemsError) throw itemsError;
    }

    // Post system message to requirement chat thread
    if (payload.requirement_id && payload.prepared_by) {
      await postQuoteCreatedChatMessage(
        quotation.quotation_id,
        payload.requirement_id,
        payload.prepared_by,
        'Sales'
      );
    }

    return quotation;
  } finally {
    _creating = false;
  }
}

export async function updateQuotation(id, payload) {
  // Strip any fields that shouldn't be sent to avoid type errors
  const { users, approver, requirements, customers, quotation_items, ...cleanPayload } = payload;

  const { data, error } = await supabase
    .from('quotations')
    .update(cleanPayload)
    .eq('quotation_id', id)
    .select()
    .single();

  if (error) {
    console.error('[updateQuotation] Error:', error);
    throw error;
  }
  return data;
}

export async function updateQuotationItems(quotationId, items) {
  const { error: deleteError } = await supabase
    .from("quotation_items")
    .delete()
    .eq("quotation_id", quotationId);
  if (deleteError) throw deleteError;

  if (items?.length > 0) {
    // Explicitly pick only valid DB columns — never spread unknown fields.
    const rows = items.map(item => ({
      quotation_id:      quotationId,
      description:       (item.description ?? '').trim(),
      quantity:          Number(item.quantity)  || 1,
      unit:              item.unit              ?? 'Days',
      unit_rate_kwd:     Number(item.unit_rate_kwd ?? 0),
      equipment_id:      item.equipment_id      || null,
      rental_start_date: item.rental_start_date || null,
      rental_end_date:   item.rental_end_date   || null,
      discount_amount:   Number(item.discount_amount ?? 0),
      // item_type  → not a DB column; excluded
      // total_kwd  → DB DEFAULT; let DB compute it
      // procurement_id → not a DB column; excluded
    }));

    const { error: insertError } = await supabase
      .from("quotation_items")
      .insert(rows);
    if (insertError) throw insertError;
  }
}

export async function deleteQuotation(id) {
  const { data: q } = await supabase
    .from("quotations")
    .select("status")
    .eq("quotation_id", id)
    .single();
  if (q?.status !== "Draft")
    throw new Error("Only Draft quotations can be deleted");
  const { error } = await supabase
    .from("quotations")
    .delete()
    .eq("quotation_id", id);
  if (error) throw error;
}

export async function getAvailableEquipment() {
  const { data, error } = await supabase
    .from("equipment_units")
    .select(
      `equipment_id, serial_number, capacity, status, location, daily_rate_kwd, type_id, equipment_types(name, type_id)`,
    )
    .in("status", ["Available", "Reserved"])
    .order("status");
  if (error) throw error;
  return data ?? [];
}

export async function getEquipmentStockByType() {
  const { data, error } = await supabase
    .from("equipment_units")
    .select("type_id, status, equipment_id, equipment_types(name, type_id)");
  if (error) throw error;

  const map = {};
  (data ?? []).forEach((u) => {
    const key = u.type_id;
    if (!map[key])
      map[key] = {
        type_id: key,
        name: u.equipment_types?.name,
        available: 0,
        reserved: 0,
        total: 0,
      };
    map[key].total++;
    if (u.status === "Available") map[key].available++;
    if (u.status === "Reserved") map[key].reserved++;
  });
  return map;
}

export async function postQuoteCreatedChatMessage(quotationId, requirementId, userId, department) {
  if (!requirementId) return;
  const { error } = await supabase.from('chat_messages').insert({
    related_requirement: requirementId,
    sender_id:    userId,
    department:   department,
    message:      `Quote Created — ${quotationId}`,
    message_type: 'quote_ref',
    ref_id:       quotationId,
    ref_type:     'quotation',
  });
  if (error) console.error('Failed to post quote chat message:', error);
}