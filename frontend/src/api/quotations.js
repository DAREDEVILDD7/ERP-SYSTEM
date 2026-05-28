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
  if (_creating) throw new Error("Please wait, already saving a quotation.");
  _creating = true;
  try {
    const { data: quotation, error } = await supabase
      .from("quotations")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    if (items?.length > 0) {
      const { error: itemsError } = await supabase
        .from("quotation_items")
        .insert(
          items.map((item) => ({
            ...item,
            quotation_id: quotation.quotation_id,
          })),
        );
      if (itemsError) throw itemsError;
    }
    return quotation;
  } finally {
    _creating = false;
  }
}

export async function updateQuotation(id, payload) {
  const { data, error } = await supabase
    .from("quotations")
    .update(payload)
    .eq("quotation_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateQuotationItems(quotationId, items) {
  const { error: deleteError } = await supabase
    .from("quotation_items")
    .delete()
    .eq("quotation_id", quotationId);
  if (deleteError) throw deleteError;

  if (items?.length > 0) {
    const { error: insertError } = await supabase
      .from("quotation_items")
      .insert(items.map((i) => ({ ...i, quotation_id: quotationId })));
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
