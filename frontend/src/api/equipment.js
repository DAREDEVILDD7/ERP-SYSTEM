import { supabase } from "../lib/supabaseClient";

export async function getEquipmentTypes() {
  const { data, error } = await supabase
    .from("equipment_types")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getEquipmentUnits(filters = {}) {
  let query = supabase
    .from("equipment_units")
    .select("*, equipment_types(name, category)")
    .order("equipment_id");
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.type_id) query = query.eq("type_id", filters.type_id);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getEquipmentUnitsWithProcurement(filters = {}) {
  let query = supabase
    .from("equipment_units")
    .select(
      `
      *,
      equipment_types ( name, category ),
      procurements (
        procurement_id, title, type,
        lease_start_date, lease_end_date, lease_monthly_kwd,
        vendors ( name )
      )
    `,
    )
    .order("equipment_id");

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.type_id) query = query.eq("type_id", filters.type_id);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getSerialNumbersByType(typeId) {
  const { data, error } = await supabase
    .from("equipment_units")
    .select("serial_number, capacity, equipment_id")
    .eq("type_id", typeId)
    .not("serial_number", "is", null)
    .order("serial_number");
  if (error) throw error;
  return data ?? [];
}

export async function getEquipmentUnit(id) {
  const { data, error } = await supabase
    .from("equipment_units")
    .select(
      `
      *,
      equipment_types(*),
      dispatches(dispatch_id, destination, status, dispatch_date, driver_name, return_date),
      maintenance(maintenance_id, issue, status, service_date, start_date, completion_date, cost_kwd)
    `,
    )
    .eq("equipment_id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createEquipmentType(payload) {
  // Validate required fields
  if (!payload.name?.trim()) throw new Error("Equipment type name is required");

  // Check for duplicate name
  const { data: existing } = await supabase
    .from("equipment_types")
    .select("type_id")
    .ilike("name", payload.name.trim())
    .single();

  if (existing)
    throw new Error(`Equipment type "${payload.name}" already exists`);

  const { data, error } = await supabase
    .from("equipment_types")
    .insert({ ...payload, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEquipmentType(id, payload) {
  const { data, error } = await supabase
    .from("equipment_types")
    .update(payload)
    .eq("type_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createEquipmentUnit(payload) {
  const { data, error } = await supabase
    .from("equipment_units")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEquipmentUnit(id, payload) {
  const { data, error } = await supabase
    .from("equipment_units")
    .update(payload)
    .eq("equipment_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function retireEquipment(id, reason) {
  const { data, error } = await supabase
    .from("equipment_units")
    .update({
      status: "Retired",
      is_retired: true,
      retire_reason: reason,
      retire_date: new Date().toISOString().split("T")[0],
    })
    .eq("equipment_id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getDispatchableEquipment(excludeIds = []) {
  let query = supabase
    .from("equipment_units")
    .select(
      `equipment_id, serial_number, capacity, status, location, daily_rate_kwd, type_id, equipment_types(name, type_id)`,
    )
    .in("status", ["Available", "Reserved"])
    .order("type_id");
  if (excludeIds.length > 0) {
    query = query.not("equipment_id", "in", `(${excludeIds.join(",")})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
