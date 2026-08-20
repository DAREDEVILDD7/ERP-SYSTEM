# Database schema

Reference snapshot of the Supabase `public` schema as of **2026-08-14**.

**This is a reference document, not a migration.** Table order and
constraints are as-reported by the schema exporter and are not
guaranteed to execute in this sequence. The executable migrations live
in `frontend/*.sql` and are applied manually in the Supabase SQL editor.
When a migration changes a table, update the DDL below in the same
change so this file does not drift.

Only tables are captured here. The `SECURITY DEFINER` RPCs that guard
every privileged mutation (`verify_login`, the permissions and
password-reset functions, etc.) are described in
`docs/authorization.md`.

## Conventions

- **Human-readable primary keys.** Most business tables key on a `text`
  ID generated from a sequence with a `KW-<DOMAIN>-` prefix, e.g.
  `KW-USR-0001`, `KW-EQP-0042`. Year-scoped documents interpolate the
  year: `KW-QT-2026-0007`, `KW-REQ-2026-0031`, `KW-INV-2026-0012`,
  `KW-PRC-2026-0004`, `KW-PO-2026-0009`.
- **`uuid` keys are used for join/child rows** that are never spoken
  aloud — `quotation_items`, `dispatch_items`, `requirement_items`,
  `procurement_items`, `chat_mentions`, `audit_logs`, and the
  permission-override tables.
- **Money is `numeric` and suffixed `_kwd`.** There is no separate
  currency column; everything is Kuwaiti dinar.
- **Soft delete, not hard delete.** Master data carries `is_active
  boolean DEFAULT true` (`users`, `customers`, `vendors`,
  `equipment_types`). Equipment additionally has `is_retired` plus
  `retire_reason` / `retire_date`.
- **`created_at` / `updated_at`** are `timestamp with time zone
  DEFAULT now()` on nearly every table.
- **Actor columns are FKs to `users(user_id)`**, never free text —
  `created_by`, `prepared_by`, `approved_by`, `assigned_to`,
  `cancelled_by`, `reported_by`, `recorded_by`, `processed_by`.
- **`USER-DEFINED` in the DDL below is a Postgres enum type**
  (`user_role`, `equipment_status`, `requirement_status`,
  `quotation_status`, `dispatch_status`, `maintenance_status`,
  `invoice_status`, `procurement_type`, `procurement_status`,
  `po_status`). The exporter does not expand enum names; only
  `equipment_units.status` carries an inline `CHECK` listing its
  members.

## Domains

**Identity & access** — `users`, `login_attempts`, `session_logs`,
`password_reset_requests`, `password_reset_audit_log`, `audit_logs`.
Note `users.password` and `users.password_reset_token`: Supabase Auth
is switched off in the client and sign-in goes through the
`verify_login` RPC, so credentials live in `public.users`, not
`auth.users`. The `auth_id` FK to `auth.users(id)` is vestigial.

**Authorization** — `modules`, `role_permissions`,
`user_module_overrides`, `user_permission_overrides`. These four back
the exact evaluation order (Super Admin → user-level module override →
role permission → default deny) documented in `docs/authorization.md`.
`modules.module_key = 'system_maintenance'` is the maintenance-mode
flag.

**Sales pipeline** — `customers` → `requirements` /
`requirement_items` → `quotations` / `quotation_items` → `invoices`.
Note `quotations.requirement_id` is nullable: a quotation can be raised
without an originating requirement.

**Fleet** — `equipment_types` → `equipment_units`. Leasing state lives
on the unit (`lease_start_date`, `lease_end_date`, `lease_monthly_kwd`,
`lease_returned_at`) with `lease_extensions` and `lease_invoices` as
history tables.

**Operations** — `dispatches` / `dispatch_items` (a dispatch is `Full`
or partial via `dispatch_type`, with `items_total` /
`items_dispatched` / `items_returned` counters), and `maintenance`.

**Procurement** — `vendors` → `procurements` / `procurement_items` →
`purchase_orders`. `equipment_units.procurement_id` closes the loop
back to fleet when a delivered item is added
(`procurement_items.added_to_fleet`).

**Finance** — `finance_assets`, `finance_expenses`. The Finance module
in the app is **UI-only**; these tables exist but are not wired up. See
`docs/Finance-Requirements-Discovery.md` before touching them.

**Messaging** — `chat_messages`, `chat_mentions`, `notifications`.

## DDL

```sql
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.users (
  user_id text NOT NULL DEFAULT ('KW-USR-'::text || lpad((nextval('user_seq'::regclass))::text, 4, '0'::text)),
  auth_id uuid UNIQUE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role USER-DEFINED NOT NULL DEFAULT 'Sales Executive'::user_role,
  department text NOT NULL,
  is_active boolean DEFAULT true,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  username text UNIQUE,
  last_login timestamp with time zone,
  password_reset_token text,
  phone text,
  employee_id text UNIQUE,
  joined_date date DEFAULT CURRENT_DATE,
  notes text,
  password text,
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id)
);
CREATE TABLE public.customers (
  customer_id text NOT NULL DEFAULT ('KW-CUST-'::text || lpad((nextval('customer_seq'::regclass))::text, 4, '0'::text)),
  company_name text NOT NULL,
  contact_person text NOT NULL,
  phone text,
  email text,
  industry text,
  address text,
  country text DEFAULT 'Kuwait'::text,
  is_active boolean DEFAULT true,
  notes text,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (customer_id),
  CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.equipment_types (
  type_id text NOT NULL DEFAULT ('KW-ETP-'::text || lpad((nextval('equipment_type_seq'::regclass))::text, 4, '0'::text)),
  name text NOT NULL UNIQUE,
  description text,
  category text,
  default_daily_rate_kwd numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  default_capacity text,
  manufacturer text,
  unit text DEFAULT 'Unit'::text,
  image_url text DEFAULT 'https://ndpamwtycascibqeuawd.supabase.co/storage/v1/object/public/equipment-images/types/KW-ETP-0005.png'::text,
  CONSTRAINT equipment_types_pkey PRIMARY KEY (type_id)
);
CREATE TABLE public.equipment_units (
  equipment_id text NOT NULL DEFAULT ('KW-EQP-'::text || lpad((nextval('equipment_unit_seq'::regclass))::text, 4, '0'::text)),
  type_id text NOT NULL,
  serial_number text UNIQUE,
  capacity text,
  status USER-DEFINED DEFAULT 'Available'::equipment_status CHECK (status = ANY (ARRAY['Available'::equipment_status, 'Reserved'::equipment_status, 'Dispatched'::equipment_status, 'Maintenance'::equipment_status, 'Retired'::equipment_status, 'Locked'::equipment_status])),
  location text,
  daily_rate_kwd numeric NOT NULL DEFAULT 0,
  year_of_manufacture integer,
  last_maintenance_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  procurement_id text,
  procurement_type text,
  lease_start_date date,
  lease_end_date date,
  lease_monthly_kwd numeric,
  expected_return_date date,
  is_retired boolean DEFAULT false,
  retire_reason text,
  retire_date date,
  expected_available_date date,
  lease_returned_at timestamp with time zone,
  lease_returned_by text,
  lease_return_notes text,
  CONSTRAINT equipment_units_pkey PRIMARY KEY (equipment_id),
  CONSTRAINT equipment_units_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.equipment_types(type_id),
  CONSTRAINT equipment_units_procurement_id_fkey FOREIGN KEY (procurement_id) REFERENCES public.procurements(procurement_id),
  CONSTRAINT equipment_units_lease_returned_by_fkey FOREIGN KEY (lease_returned_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.requirements (
  requirement_id text NOT NULL DEFAULT ((('KW-REQ-'::text || EXTRACT(year FROM now())) || '-'::text) || lpad((nextval('requirement_seq'::regclass))::text, 4, '0'::text)),
  customer_id text NOT NULL,
  created_by text NOT NULL,
  assigned_to text,
  requested_by text NOT NULL,
  requirement_summary text NOT NULL,
  location text,
  start_date date,
  end_date date,
  status USER-DEFINED DEFAULT 'Pending Review'::requirement_status,
  priority text DEFAULT 'Normal'::text,
  notes text,
  operations_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT requirements_pkey PRIMARY KEY (requirement_id),
  CONSTRAINT requirements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id),
  CONSTRAINT requirements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id),
  CONSTRAINT requirements_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id)
);
CREATE TABLE public.quotations (
  quotation_id text NOT NULL DEFAULT ((('KW-QT-'::text || EXTRACT(year FROM now())) || '-'::text) || lpad((nextval('quotation_seq'::regclass))::text, 4, '0'::text)),
  requirement_id text,
  customer_id text NOT NULL,
  prepared_by text NOT NULL,
  approved_by text,
  status USER-DEFINED DEFAULT 'Draft'::quotation_status,
  quotation_date date DEFAULT CURRENT_DATE,
  valid_until date,
  subtotal_kwd numeric DEFAULT 0,
  vat_percent numeric DEFAULT 0,
  vat_amount_kwd numeric DEFAULT 0,
  total_amount_kwd numeric DEFAULT 0,
  terms_conditions text,
  notes text,
  rejection_reason text,
  pdf_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  discount_percent numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  CONSTRAINT quotations_pkey PRIMARY KEY (quotation_id),
  CONSTRAINT quotations_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES public.requirements(requirement_id),
  CONSTRAINT quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id),
  CONSTRAINT quotations_prepared_by_fkey FOREIGN KEY (prepared_by) REFERENCES public.users(user_id),
  CONSTRAINT quotations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.quotation_items (
  item_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  quotation_id text NOT NULL,
  equipment_id text,
  description text NOT NULL,
  quantity integer DEFAULT 1,
  unit text DEFAULT 'Days'::text,
  unit_rate_kwd numeric NOT NULL,
  total_kwd numeric DEFAULT ((quantity)::numeric * unit_rate_kwd),
  created_at timestamp with time zone DEFAULT now(),
  rental_start_date date,
  rental_end_date date,
  discount_percent numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  CONSTRAINT quotation_items_pkey PRIMARY KEY (item_id),
  CONSTRAINT quotation_items_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(quotation_id),
  CONSTRAINT quotation_items_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id)
);
CREATE TABLE public.dispatches (
  dispatch_id text NOT NULL DEFAULT ('KW-DSP-'::text || lpad((nextval('dispatch_seq'::regclass))::text, 4, '0'::text)),
  quotation_id text,
  requirement_id text,
  equipment_id text NOT NULL,
  assigned_by text,
  driver_name text,
  vehicle_type text,
  vehicle_plate text,
  destination text NOT NULL,
  status USER-DEFINED DEFAULT 'Pending'::dispatch_status,
  dispatch_date date,
  return_date date,
  actual_return_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  cancelled_by text,
  cancel_reason text,
  cancelled_at timestamp with time zone,
  dispatch_type text DEFAULT 'Full'::text,
  items_total integer DEFAULT 0,
  items_dispatched integer DEFAULT 0,
  items_returned integer DEFAULT 0,
  CONSTRAINT dispatches_pkey PRIMARY KEY (dispatch_id),
  CONSTRAINT dispatches_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(quotation_id),
  CONSTRAINT dispatches_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES public.requirements(requirement_id),
  CONSTRAINT dispatches_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id),
  CONSTRAINT dispatches_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(user_id),
  CONSTRAINT dispatches_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.maintenance (
  maintenance_id text NOT NULL DEFAULT ('KW-MNT-'::text || lpad((nextval('maintenance_seq'::regclass))::text, 4, '0'::text)),
  equipment_id text NOT NULL,
  reported_by text,
  assigned_to text,
  issue text NOT NULL,
  issue_type text,
  service_date date,
  completion_date date,
  cost_kwd numeric DEFAULT 0,
  status USER-DEFINED DEFAULT 'Open'::maintenance_status,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  cancelled_by text,
  cancel_reason text,
  cancelled_at timestamp with time zone,
  approved_by text,
  start_date date,
  CONSTRAINT maintenance_pkey PRIMARY KEY (maintenance_id),
  CONSTRAINT maintenance_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id),
  CONSTRAINT maintenance_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(user_id),
  CONSTRAINT maintenance_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id),
  CONSTRAINT maintenance_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(user_id),
  CONSTRAINT maintenance_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.invoices (
  invoice_id text NOT NULL DEFAULT ((('KW-INV-'::text || EXTRACT(year FROM now())) || '-'::text) || lpad((nextval('invoice_seq'::regclass))::text, 4, '0'::text)),
  quotation_id text NOT NULL,
  customer_id text NOT NULL,
  created_by text,
  total_amount_kwd numeric NOT NULL,
  amount_paid_kwd numeric DEFAULT 0,
  status USER-DEFINED DEFAULT 'Draft'::invoice_status,
  issue_date date DEFAULT CURRENT_DATE,
  due_date date,
  payment_date date,
  payment_method text,
  notes text,
  pdf_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (invoice_id),
  CONSTRAINT invoices_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(quotation_id),
  CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id),
  CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.chat_messages (
  chat_id text NOT NULL DEFAULT ('KW-CHAT-'::text || lpad((nextval('chat_seq'::regclass))::text, 4, '0'::text)),
  related_requirement text,
  related_quotation text,
  sender_id text NOT NULL,
  recipient_id text,
  department text,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  attachment_url text,
  created_at timestamp with time zone DEFAULT now(),
  message_type text DEFAULT 'text'::text,
  ref_id text,
  ref_type text,
  CONSTRAINT chat_messages_pkey PRIMARY KEY (chat_id),
  CONSTRAINT chat_messages_related_requirement_fkey FOREIGN KEY (related_requirement) REFERENCES public.requirements(requirement_id),
  CONSTRAINT chat_messages_related_quotation_fkey FOREIGN KEY (related_quotation) REFERENCES public.quotations(quotation_id),
  CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id),
  CONSTRAINT chat_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.audit_logs (
  log_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id text,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (log_id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.vendors (
  vendor_id text NOT NULL DEFAULT ('KW-VND-'::text || lpad((nextval('vendor_seq'::regclass))::text, 4, '0'::text)),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  country text DEFAULT 'Kuwait'::text,
  category text,
  payment_terms text,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT vendors_pkey PRIMARY KEY (vendor_id)
);
CREATE TABLE public.procurements (
  procurement_id text NOT NULL DEFAULT ((('KW-PRC-'::text || EXTRACT(year FROM now())) || '-'::text) || lpad((nextval('procurement_seq'::regclass))::text, 4, '0'::text)),
  title text NOT NULL,
  description text,
  type USER-DEFINED NOT NULL DEFAULT 'Purchase'::procurement_type,
  vendor_id text,
  requested_by text,
  approved_by text,
  status USER-DEFINED DEFAULT 'Draft'::procurement_status,
  priority text DEFAULT 'Normal'::text,
  required_by_date date,
  total_amount_kwd numeric DEFAULT 0,
  lease_start_date date,
  lease_end_date date,
  lease_monthly_kwd numeric,
  terms_conditions text DEFAULT 'Standard procurement terms apply.'::text,
  notes text,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT procurements_pkey PRIMARY KEY (procurement_id),
  CONSTRAINT procurements_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id),
  CONSTRAINT procurements_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(user_id),
  CONSTRAINT procurements_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.procurement_items (
  item_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  procurement_id text NOT NULL,
  equipment_type_id text,
  description text NOT NULL,
  quantity integer DEFAULT 1,
  unit text DEFAULT 'Unit'::text,
  unit_price_kwd numeric DEFAULT 0,
  total_kwd numeric DEFAULT ((quantity)::numeric * unit_price_kwd),
  delivered_qty integer DEFAULT 0,
  added_to_fleet boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  received_qty integer DEFAULT 0,
  received_date date,
  fleet_location text,
  fleet_added_at timestamp with time zone,
  lease_start date,
  lease_end date,
  procurement_type text DEFAULT 'Purchase'::text,
  capacity text DEFAULT 'N/A'::text,
  requested_capacity text,
  CONSTRAINT procurement_items_pkey PRIMARY KEY (item_id),
  CONSTRAINT procurement_items_procurement_id_fkey FOREIGN KEY (procurement_id) REFERENCES public.procurements(procurement_id),
  CONSTRAINT procurement_items_equipment_type_id_fkey FOREIGN KEY (equipment_type_id) REFERENCES public.equipment_types(type_id)
);
CREATE TABLE public.purchase_orders (
  po_id text NOT NULL DEFAULT ((('KW-PO-'::text || EXTRACT(year FROM now())) || '-'::text) || lpad((nextval('po_seq'::regclass))::text, 4, '0'::text)),
  po_number text DEFAULT ('PO-'::text || lpad((nextval('po_number_seq'::regclass))::text, 6, '0'::text)) UNIQUE,
  procurement_id text,
  vendor_id text,
  created_by text,
  status USER-DEFINED DEFAULT 'Draft'::po_status,
  issue_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  actual_delivery date,
  total_amount_kwd numeric DEFAULT 0,
  terms_conditions text DEFAULT 'Payment within 30 days upon delivery and inspection.'::text,
  shipping_address text DEFAULT 'KW Ops Yard, Kuwait'::text,
  notes text,
  submitted_at timestamp with time zone,
  pdf_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT purchase_orders_pkey PRIMARY KEY (po_id),
  CONSTRAINT purchase_orders_procurement_id_fkey FOREIGN KEY (procurement_id) REFERENCES public.procurements(procurement_id),
  CONSTRAINT purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id),
  CONSTRAINT purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.finance_assets (
  asset_id text NOT NULL DEFAULT ('KW-AST-'::text || lpad((nextval('asset_seq'::regclass))::text, 4, '0'::text)),
  name text NOT NULL,
  category text NOT NULL,
  value_kwd numeric NOT NULL DEFAULT 0,
  purchase_date date,
  depreciation_rate numeric DEFAULT 0,
  notes text,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT finance_assets_pkey PRIMARY KEY (asset_id),
  CONSTRAINT finance_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.finance_expenses (
  expense_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  po_id text,
  vendor_id text,
  category text NOT NULL,
  amount_kwd numeric NOT NULL,
  payment_date date,
  payment_method text,
  description text,
  recorded_by text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT finance_expenses_pkey PRIMARY KEY (expense_id),
  CONSTRAINT finance_expenses_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(po_id),
  CONSTRAINT finance_expenses_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id),
  CONSTRAINT finance_expenses_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.dispatch_items (
  item_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  dispatch_id text NOT NULL,
  equipment_id text NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  dispatch_status text DEFAULT 'Pending'::text,
  dispatched_at timestamp with time zone,
  returned_at timestamp with time zone,
  return_notes text,
  extended_return_date date,
  CONSTRAINT dispatch_items_pkey PRIMARY KEY (item_id),
  CONSTRAINT dispatch_items_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.dispatches(dispatch_id),
  CONSTRAINT dispatch_items_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id)
);
CREATE TABLE public.chat_mentions (
  mention_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  chat_id text NOT NULL,
  user_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chat_mentions_pkey PRIMARY KEY (mention_id),
  CONSTRAINT chat_mentions_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chat_messages(chat_id),
  CONSTRAINT chat_mentions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.requirement_items (
  item_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  requirement_id text NOT NULL,
  equipment_type_id text,
  description text NOT NULL,
  quantity integer DEFAULT 1,
  capacity text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  equipment_id text,
  CONSTRAINT requirement_items_pkey PRIMARY KEY (item_id),
  CONSTRAINT requirement_items_requirement_id_fkey FOREIGN KEY (requirement_id) REFERENCES public.requirements(requirement_id),
  CONSTRAINT requirement_items_equipment_type_id_fkey FOREIGN KEY (equipment_type_id) REFERENCES public.equipment_types(type_id),
  CONSTRAINT requirement_items_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id)
);
CREATE TABLE public.login_attempts (
  attempt_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  email text NOT NULL,
  ip_address text,
  success boolean DEFAULT false,
  attempted_at timestamp with time zone DEFAULT now(),
  CONSTRAINT login_attempts_pkey PRIMARY KEY (attempt_id)
);
CREATE TABLE public.lease_extensions (
  extension_id uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id text NOT NULL,
  previous_end_date date NOT NULL,
  new_end_date date NOT NULL,
  monthly_rate_kwd numeric,
  extension_notes text,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lease_extensions_pkey PRIMARY KEY (extension_id),
  CONSTRAINT lease_extensions_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id),
  CONSTRAINT lease_extensions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.lease_invoices (
  lease_invoice_id uuid NOT NULL DEFAULT gen_random_uuid(),
  equipment_id text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount_kwd numeric NOT NULL,
  status character varying NOT NULL DEFAULT 'Draft'::character varying CHECK (status::text = ANY (ARRAY['Draft'::character varying, 'Sent'::character varying, 'Paid'::character varying, 'Cancelled'::character varying]::text[])),
  notes text,
  created_by text,
  created_at timestamp with time zone DEFAULT now(),
  paid_at timestamp with time zone,
  paid_by text,
  CONSTRAINT lease_invoices_pkey PRIMARY KEY (lease_invoice_id),
  CONSTRAINT lease_invoices_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.equipment_units(equipment_id),
  CONSTRAINT lease_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id),
  CONSTRAINT lease_invoices_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.session_logs (
  session_log_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  username text NOT NULL,
  name text,
  role text,
  department text,
  logged_in_at timestamp with time zone NOT NULL DEFAULT now(),
  logged_out_at timestamp with time zone,
  session_duration_seconds integer DEFAULT 
CASE
    WHEN (logged_out_at IS NOT NULL) THEN (EXTRACT(epoch FROM (logged_out_at - logged_in_at)))::integer
    ELSE NULL::integer
END,
  user_agent text,
  CONSTRAINT session_logs_pkey PRIMARY KEY (session_log_id),
  CONSTRAINT session_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.notifications (
  notification_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type text NOT NULL DEFAULT 'system'::text,
  title text NOT NULL,
  message text NOT NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT notifications_pkey PRIMARY KEY (notification_id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.password_reset_requests (
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  requested_username text NOT NULL,
  status text NOT NULL DEFAULT 'Pending'::text CHECK (status = ANY (ARRAY['Pending'::text, 'In Progress'::text, 'Completed'::text, 'Rejected'::text])),
  processed_by text,
  processed_at timestamp with time zone,
  reject_reason text,
  source_ip text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT password_reset_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id),
  CONSTRAINT password_reset_requests_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(user_id)
);
CREATE TABLE public.password_reset_audit_log (
  audit_id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid,
  actor_user_id text,
  subject_user_id text,
  attempted_username text,
  action text NOT NULL,
  notes text,
  source_ip text,
  user_agent text,
  action_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_audit_log_pkey PRIMARY KEY (audit_id),
  CONSTRAINT password_reset_audit_log_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.password_reset_requests(request_id),
  CONSTRAINT password_reset_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id),
  CONSTRAINT password_reset_audit_log_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.role_permissions (
  role text NOT NULL,
  module_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role, module_key)
);
CREATE TABLE public.modules (
  module_key text NOT NULL,
  label text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT modules_pkey PRIMARY KEY (module_key)
);
CREATE TABLE public.user_permission_overrides (
  user_id text NOT NULL,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT false,
  granted_by text,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_permission_overrides_pkey PRIMARY KEY (user_id, permission_key),
  CONSTRAINT user_permission_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);
CREATE TABLE public.user_module_overrides (
  user_id text NOT NULL,
  module_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT user_module_overrides_pkey PRIMARY KEY (user_id, module_key),
  CONSTRAINT user_module_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id),
  CONSTRAINT user_module_overrides_module_key_fkey FOREIGN KEY (module_key) REFERENCES public.modules(module_key)
);
```
