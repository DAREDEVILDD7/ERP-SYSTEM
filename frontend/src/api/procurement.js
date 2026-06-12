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
        items.map(({ description, unit_price_kwd, equipment_type_id }) => ({
          description, unit_price_kwd, equipment_type_id,
          procurement_id: data.procurement_id,
        })),
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
        received_qty:     item.received_qty,
        received_date:    item.received_date,
        fleet_location:   item.fleet_location,
        lease_start:      item.lease_start || null,
        lease_end:        item.lease_end   || null,
        procurement_type: item.procurement_type || "Purchase",
        added_to_fleet:   true,
        fleet_added_at:   new Date().toISOString(),
      })
      .eq("item_id", item.item_id);

    // Add to equipment fleet if equipment_type_id specified
    if (item.equipment_type_id && item.received_qty > 0) {
      const capacityPart = item.description?.includes(' — ')
        ? item.description.split(' — ').slice(1).join(' — ').trim()
        : null;

      // Validate daily rate
      const dailyRate = Number(item.daily_rate_kwd);
      if (!dailyRate || dailyRate <= 0) {
        throw new Error(`Daily rate is required for: ${item.description}`);
      }

      const units = [];
      for (let i = 0; i < item.received_qty; i++) {
        const serial = item.serial_numbers?.[i]?.trim() || null;
        // Serial is required — enforced in UI but double-check here
        if (!serial) {
          throw new Error(`Serial number missing for unit ${i + 1} of: ${item.description}`);
        }
        units.push({
          type_id:          item.equipment_type_id,
          status:           'Available',
          location:         item.fleet_location || 'Yard',
          // daily_rate_kwd — stored per unit, entered during receive
          daily_rate_kwd:   dailyRate,
          procurement_id:   procurementId,
          procurement_type: item.procurement_type || 'Purchase',
          lease_start_date: item.lease_start || null,
          lease_end_date:   item.lease_end   || null,
          notes:            `Received from procurement ${procurementId}`,
          // serial_number — stored in equipment_units.serial_number (unique constraint)
          serial_number:    serial,
          capacity:         capacityPart,
        });
      }
      if (units.length > 0) {
        const { error } = await supabase.from('equipment_units').insert(units);
        if (error) {
          // Provide a clear message for duplicate serial number constraint violation
          if (error.code === '23505' && error.message?.includes('serial_number')) {
            const match = error.message.match(/Key \(serial_number\)=\(([^)]+)\)/);
            const dupSerial = match ? match[1] : 'unknown';
            throw new Error(`Serial number "${dupSerial}" already exists in the fleet. Each unit must have a unique serial number.`);
          }
          throw error;
        }
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
    .in("status", ["Submitted", "Acknowledged", "Partially Delivered", "Delivered"]);

  return true;
}