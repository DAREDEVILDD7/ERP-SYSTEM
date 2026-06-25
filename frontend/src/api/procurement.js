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
      const capacityPart = item.capacity?.trim()
        || (item.description?.includes(' — ')
          ? item.description.split(' — ').slice(1).join(' — ').trim()
          : null)
        || null;

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
        const { data: insertedUnits, error } = await supabase
          .from('equipment_units')
          .insert(units)
          .select('equipment_id');
        if (error) {
          if (error.code === '23505' && error.message?.includes('serial_number')) {
            const match = error.message.match(/Key \(serial_number\)=\(([^)]+)\)/);
            const dupSerial = match ? match[1] : 'unknown';
            throw new Error(`Serial number "${dupSerial}" already exists in the fleet. Each unit must have a unique serial number.`);
          }
          throw error;
        }

        // Auto-link newly received units to quotation items that are still
        // waiting for this equipment type (equipment_id = null).
        // We update the link for ANY quotation status so that approval-time
        // dispatch creation finds the equipment_id even when procurement was
        // received before the quotation was approved.
        // Dispatches are only created immediately for already-Approved quotations.
        if (insertedUnits && insertedUnits.length > 0) {
          try {
            const { data: eqType } = await supabase
              .from('equipment_types')
              .select('name')
              .eq('type_id', item.equipment_type_id)
              .single();

            if (eqType) {
              // Fetch ALL quotation items with no equipment_id — across all statuses
              const { data: allPendingItems } = await supabase
                .from('quotation_items')
                .select('item_id, quotation_id, description, rental_start_date, rental_end_date')
                .is('equipment_id', null)
                .order('created_at', { ascending: true });

              if (allPendingItems && allPendingItems.length > 0) {
                // Fetch quotation metadata for all matched quotations in one round-trip
                const allQIds = [...new Set(allPendingItems.map(i => i.quotation_id))];
                const { data: allQuotes } = await supabase
                  .from('quotations')
                  .select('quotation_id, status, requirement_id, requirements(location)')
                  .in('quotation_id', allQIds);
                const quoteMap = Object.fromEntries((allQuotes ?? []).map(q => [q.quotation_id, q]));

                const typeLower = eqType.name.toLowerCase().trim();
                const matching  = allPendingItems.filter(qi => {
                  const descPart = (qi.description || '').split(' — ')[0].trim().toLowerCase();
                  // Exact match OR type name is a prefix (handles capacity variants like "Crane 25 Ton")
                  return descPart === typeLower || descPart.startsWith(typeLower + ' ');
                });

                const availableUnits = [...insertedUnits];
                for (const qi of matching) {
                  if (availableUnits.length === 0) break;
                  const unit  = availableUnits.shift();
                  const quote = quoteMap[qi.quotation_id];

                  // Always write the equipment link — approval-time dispatch creation depends on it
                  await supabase
                    .from('quotation_items')
                    .update({ equipment_id: unit.equipment_id })
                    .eq('item_id', qi.item_id);

                  // Create dispatch immediately only if the quotation is already Approved
                  if (quote?.status === 'Approved') {
                    // Idempotency: skip if a non-cancelled dispatch already exists
                    const { data: existingDsp } = await supabase
                      .from('dispatches')
                      .select('dispatch_id')
                      .eq('quotation_id', qi.quotation_id)
                      .eq('equipment_id', unit.equipment_id)
                      .neq('status', 'Cancelled')
                      .limit(1);

                    if (!existingDsp?.length) {
                      const { data: dispatch, error: dErr } = await supabase
                        .from('dispatches')
                        .insert({
                          quotation_id:   qi.quotation_id,
                          requirement_id: quote.requirement_id || null,
                          equipment_id:   unit.equipment_id,
                          destination:    quote.requirements?.location || '',
                          status:         'Pending',
                          dispatch_type:  'Full',
                          dispatch_date:  qi.rental_start_date || null,
                          return_date:    qi.rental_end_date   || null,
                          items_total:    1,
                          assigned_by:    userId,
                          notes:          qi.description || null,
                        })
                        .select()
                        .single();

                      if (!dErr && dispatch) {
                        await supabase
                          .from('dispatch_items')
                          .insert({
                            dispatch_id:     dispatch.dispatch_id,
                            equipment_id:    unit.equipment_id,
                            dispatch_status: 'Pending',
                          });
                      }
                    }
                  }
                }
              }
            }
          } catch (autoLinkErr) {
            console.warn('[receiveProcurement] Auto-link to pending quotations failed (non-blocking):', autoLinkErr);
          }
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