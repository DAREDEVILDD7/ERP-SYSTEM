import { supabase } from "../lib/supabaseClient";

export async function getProcurements(filters = {}) {
  let query = supabase
    .from("procurements")
    .select(
      `
      *,
      vendors ( vendor_id, name, contact_person, email, phone ),
      users!procurements_requested_by_fkey ( name, role ),
      procurement_items (
        *,
        equipment_types ( name, category )
      ),
      purchase_orders (
        po_id, po_number, status, total_amount_kwd,
        issue_date, expected_delivery, submitted_at
      )
    `,
    )
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.type) query = query.eq("type", filters.type);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getProcurement(id) {
  const { data, error } = await supabase
    .from("procurements")
    .select(
      `
      *,
      vendors ( * ),
      users!procurements_requested_by_fkey ( name, role ),
      procurement_items ( *, equipment_types ( name, category ) ),
      purchase_orders ( * )
    `,
    )
    .eq("procurement_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createProcurement(payload, items) {
  const { data, error } = await supabase
    .from("procurements")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  if (items?.length > 0) {
    const { error: ie } = await supabase
      .from("procurement_items")
      .insert(
        items.map((i) => ({ ...i, procurement_id: data.procurement_id })),
      );
    if (ie) throw ie;
  }
  return data;
}

export async function updateProcurement(id, payload) {
  const { data, error } = await supabase
    .from("procurements")
    .update(payload)
    .eq("procurement_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getVendors() {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createVendor(payload) {
  const { data, error } = await supabase
    .from("vendors")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVendor(id, payload) {
  const { data, error } = await supabase
    .from("vendors")
    .update(payload)
    .eq("vendor_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPurchaseOrders(filters = {}) {
  let query = supabase
    .from("purchase_orders")
    .select(
      `
      *,
      vendors ( name, contact_person, email, phone, address ),
      procurements (
        procurement_id, title, type, total_amount_kwd,
        procurement_items ( *, equipment_types(name) )
      ),
      users!purchase_orders_created_by_fkey ( name )
    `,
    )
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createPurchaseOrder(payload) {
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePurchaseOrder(id, payload) {
  const { data, error } = await supabase
    .from("purchase_orders")
    .update(payload)
    .eq("po_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function submitPurchaseOrder(id) {
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ status: "Submitted", submitted_at: new Date().toISOString() })
    .eq("po_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Mark procurement as received + add items to equipment fleet
export async function receiveProcurement(procurementId, items, userId) {
  // Update each item with received info
  for (const item of items) {
    await supabase
      .from("procurement_items")
      .update({
        received_qty: item.received_qty,
        received_date: item.received_date,
        fleet_location: item.fleet_location,
        lease_start: item.lease_start || null,
        lease_end: item.lease_end || null,
        procurement_type: item.procurement_type || "Purchase",
        added_to_fleet: true,
        fleet_added_at: new Date().toISOString(),
      })
      .eq("item_id", item.item_id);

    // Add to equipment fleet if equipment_type_id specified
    if (item.equipment_type_id && item.received_qty > 0) {
      const units = [];
      for (let i = 0; i < item.received_qty; i++) {
        units.push({
          type_id: item.equipment_type_id,
          status: "Available",
          location: item.fleet_location || "Yard",
          daily_rate_kwd: 0,
          procurement_id: procurementId,
          procurement_type: item.procurement_type || "Purchase",
          lease_start_date: item.lease_start || null,
          lease_end_date: item.lease_end || null,
          notes: `Received from procurement ${procurementId}`,
        });
      }
      if (units.length > 0) {
        const { error } = await supabase.from("equipment_units").insert(units);
        if (error) throw error;
      }
    }
  }

  // Update procurement status to Received
  await supabase
    .from("procurements")
    .update({ status: "Received" })
    .eq("procurement_id", procurementId);

  // Update linked PO if exists
  await supabase
    .from("purchase_orders")
    .update({
      status: "Delivered",
      actual_delivery: new Date().toISOString().split("T")[0],
    })
    .eq("procurement_id", procurementId)
    .in("status", ["Submitted", "Acknowledged", "Partially Delivered"]);

  return true;
}
