import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  createQuotation,
  updateQuotation,
  updateQuotationItems,
  getAvailableEquipment,
  getEquipmentStockByType,
} from "../../api/quotations";
import { getRequirements } from "../../api/requirements";
import { getCustomers, createCustomer } from "../../api/customers";
import { getProcurements } from "../../api/procurement";
import { useDraft } from "../../hooks/useDraft";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Package,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Building2,
} from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";

const EMPTY_ITEM = {
  description: "",
  quantity: 1,
  unit: "Days",
  unit_rate_kwd: "",
  equipment_id: null,
  item_type: "equipment",
  procurement_id: null,
  rental_start_date: "",
  rental_end_date: "",
  discount_amount: 0,
};

const INDUSTRIES = [
  "Oil & Gas",
  "Engineering",
  "Construction",
  "Logistics",
  "Manufacturing",
  "Government",
  "Other",
];

// // Format customer for display
// const formatCustomer = (c) =>
//   c ? `${c.company_name}${c.industry ? ` — ${c.industry}` : ''}${c.contact_person ? ` — ${c.contact_person}` : ''}` : '';

export default function QuotationForm({
  existing,
  prefilledRequirement,
  onSuccess,
  onCancel,
}) {
  const { profile } = useAuth();
  const isEdit = !!existing;
  const submitRef = useRef(false);

  const [customers, setCustomers] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [procurements, setProcurements] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerLoading, setNewCustomerLoading] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    company_name: "",
    contact_person: "",
    phone: "",
    email: "",
    industry: "",
    address: "",
    notes: "",
  });

  // Equipment search
  const [eqSearch, setEqSearch] = useState("");
  const [showEqSearch, setShowEqSearch] = useState(null);

  const customerSearchRef = useRef(null);
  const draftKey = isEdit ? `quot-edit-${existing?.quotation_id}` : "quot-new";

  const INIT_FORM = {
    customer_id:
      existing?.customer_id ?? prefilledRequirement?.customer_id ?? "",
    requirement_id:
      existing?.requirement_id ?? prefilledRequirement?.requirement_id ?? "",
    quotation_date:
      existing?.quotation_date ?? new Date().toISOString().split("T")[0],
    valid_until: existing?.valid_until ?? "",
    vat_percent: existing?.vat_percent ?? 0,
    discount_amount: existing?.discount_amount ?? 0,
    terms_conditions:
      existing?.terms_conditions ??
      "Payment within 30 days. Equipment subject to availability.",
    notes: existing?.notes ?? "",
    status: existing?.status ?? "Draft",
  };

  const [form, setForm, clearDraft, hasDraft] = useDraft(draftKey, INIT_FORM);

  const INIT_ITEMS =
    isEdit && existing?.quotation_items?.length > 0
      ? existing.quotation_items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unit_rate_kwd: i.unit_rate_kwd,
          equipment_id: i.equipment_id ?? null,
          item_type: i.equipment_id ? "equipment" : "service",
          procurement_id: null,
          rental_start_date: i.rental_start_date ?? "",
          rental_end_date: i.rental_end_date ?? "",
          discount_amount: i.discount_amount ?? 0,
        }))
      : [{ ...EMPTY_ITEM }];

  const [items, setItems, clearItemsDraft] = useDraft(
    `${draftKey}-items`,
    INIT_ITEMS,
  );

  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [c, e, sm, p] = await Promise.all([
        getCustomers(),
        getAvailableEquipment(),
        getEquipmentStockByType(),
        getProcurements(),
      ]);
      setCustomers(c);
      setEquipment(e);
      setStockMap(sm);
      setProcurements(
        p.filter((x) => ["Approved", "Delivered"].includes(x.status)),
      );
    } catch {
      toast.error("Failed to load form data");
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (form.customer_id) {
      getRequirements({ customer_id: form.customer_id })
        .then(setRequirements)
        .catch(() => {});
    }
  }, [form.customer_id]);

  // Close customer dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (
        customerSearchRef.current &&
        !customerSearchRef.current.contains(e.target)
      ) {
        setShowCustomerSearch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const set = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const setItem = (idx, field, val) => {
    setItems((items) =>
      items.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: val };

        if (field === "equipment_id" && val) {
          const eq = equipment.find((e) => e.equipment_id === val);
          if (eq) {
            updated.unit_rate_kwd = eq.daily_rate_kwd;
            updated.description = `${eq.equipment_types?.name} ${eq.capacity} — Rental`;
            updated.item_type = "equipment";
          }
          setShowEqSearch(null);
          setEqSearch("");
        }
        if (field === "procurement_id" && val) {
          const pr = procurements.find((p) => p.procurement_id === val);
          if (pr) {
            updated.description = pr.title;
            updated.unit_rate_kwd = pr.total_amount_kwd;
            updated.item_type = "procurement";
            updated.equipment_id = null;
          }
        }
        if (field === "item_type") {
          updated.equipment_id = null;
          updated.procurement_id = null;
          updated.description = "";
          updated.unit_rate_kwd = "";
          updated.rental_start_date = "";
          updated.rental_end_date = "";
        }
        return updated;
      }),
    );
  };

  const addItem = () => setItems((i) => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => {
    if (items.length === 1) return toast.error("At least one item required");
    setItems((i) => i.filter((_, j) => j !== idx));
    if (showEqSearch === idx) setShowEqSearch(null);
  };

  const getStockInfo = (item) => {
    if (item.item_type !== "equipment" || !item.equipment_id) return null;
    const eq = equipment.find((e) => e.equipment_id === item.equipment_id);
    if (!eq) return null;
    const typeId = eq.type_id ?? eq.equipment_types?.type_id;
    const stock = stockMap[typeId];
    if (!stock) return null;
    const usedInForm = items.filter((i) => {
      if (!i.equipment_id) return false;
      const e2 = equipment.find((e) => e.equipment_id === i.equipment_id);
      return (e2?.type_id ?? e2?.equipment_types?.type_id) === typeId;
    }).length;
    return {
      available: stock.available,
      usedInForm,
      ok: usedInForm <= stock.available,
    };
  };

  const filteredEquipment = equipment.filter((e) => {
    if (!eqSearch) return true;
    const s = eqSearch.toLowerCase();
    return (
      e.equipment_types?.name?.toLowerCase().includes(s) ||
      e.equipment_id?.toLowerCase().includes(s) ||
      e.serial_number?.toLowerCase().includes(s) ||
      e.capacity?.toLowerCase().includes(s) ||
      e.location?.toLowerCase().includes(s)
    );
  });

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch) return true;
    const s = customerSearch.toLowerCase();
    return (
      c.company_name?.toLowerCase().includes(s) ||
      c.contact_person?.toLowerCase().includes(s) ||
      c.industry?.toLowerCase().includes(s) ||
      c.customer_id?.toLowerCase().includes(s)
    );
  });

  const selectedCustomer = customers.find(
    (c) => c.customer_id === form.customer_id,
  );

  // Totals
  const itemsSubtotal = items.reduce(
    (s, i) => s + Number(i.quantity) * Number(i.unit_rate_kwd || 0),
    0,
  );
  const headerDiscount = Number(form.discount_amount || 0);
  const afterDiscount = Math.max(0, itemsSubtotal - headerDiscount);
  const vatAmt = afterDiscount * (Number(form.vat_percent) / 100);
  const total = afterDiscount + vatAmt;

  const stockViolations = items.filter((item) => {
    const info = getStockInfo(item);
    return info && !info.ok;
  });

  // Create new customer inline
  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!newCustomerForm.company_name.trim())
      return toast.error("Enter company name");
    if (!newCustomerForm.contact_person.trim())
      return toast.error("Enter contact person");
    setNewCustomerLoading(true);
    try {
      const newCust = await createCustomer(newCustomerForm);
      const updated = await getCustomers();
      setCustomers(updated);
      set("customer_id", newCust.customer_id);
      setShowNewCustomer(false);
      setNewCustomerForm({
        company_name: "",
        contact_person: "",
        phone: "",
        email: "",
        industry: "",
        address: "",
        notes: "",
      });
      toast.success("Customer created and selected");
    } catch (err) {
      toast.error(err.message || "Failed to create customer");
    } finally {
      setNewCustomerLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitRef.current) return;
    if (!form.customer_id) return toast.error("Please select a customer");
    if (items.some((i) => !i.description?.trim()))
      return toast.error("Fill in all item descriptions");
    if (items.some((i) => !i.unit_rate_kwd))
      return toast.error("Fill in all rates");
    if (stockViolations.length > 0)
      return toast.error("Some items exceed available stock");

    submitRef.current = true;
    setSaving(true);
    try {
      const payload = {
        ...form,
        prepared_by: profile.user_id,
        subtotal_kwd: itemsSubtotal,
        discount_amount: headerDiscount,
        discount_percent:
          itemsSubtotal > 0 ? (headerDiscount / itemsSubtotal) * 100 : 0,
        vat_amount_kwd: vatAmt,
        total_amount_kwd: total,
        vat_percent: Number(form.vat_percent),
        requirement_id: form.requirement_id || null,
      };

      const cleanItems = items.map(
        ({ item_type, procurement_id, ...rest }) => ({
          description: rest.description,
          quantity: Number(rest.quantity),
          unit: rest.unit,
          unit_rate_kwd: Number(rest.unit_rate_kwd),
          equipment_id: rest.equipment_id || null,
          rental_start_date: rest.rental_start_date || null,
          rental_end_date: rest.rental_end_date || null,
          discount_amount: Number(rest.discount_amount || 0),
        }),
      );

      if (isEdit) {
        await updateQuotation(existing.quotation_id, payload);
        await updateQuotationItems(existing.quotation_id, cleanItems);
        toast.success("Quotation updated");
      } else {
        await createQuotation(payload, cleanItems);
        toast.success("Quotation created");
      }
      clearDraft();
      clearItemsDraft();
      onSuccess();
    } catch (err) {
      toast.error(err.message || "Failed to save quotation");
    } finally {
      setSaving(false);
      submitRef.current = false;
    }
  };

  if (dataLoading)
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 size={28} className="animate-spin text-primary-500" />
        <p className="text-sm text-gray-400">Loading form data…</p>
      </div>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? "Edit Quotation" : "New Quotation"}
          </h2>
          <p className="text-sm text-gray-400">
            {isEdit ? existing.quotation_id : "Create a new quotation"}
          </p>
        </div>
      </div>

      {!isEdit && hasDraft() && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-yellow-700">📝 Draft restored</p>
          <button
            type="button"
            onClick={() => {
              clearDraft();
              clearItemsDraft();
              window.location.reload();
            }}
            className="text-xs text-yellow-600 hover:underline ml-4"
          >
            Clear draft
          </button>
        </div>
      )}

      {stockViolations.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-700">
            {stockViolations.length} item(s) exceed available stock.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Quotation Details */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">
            Quotation Details
          </h3>

          {/* Customer search with inline create */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1" ref={customerSearchRef}>
                {/* Selected customer display / search input */}
                <div
                  className={clsx(
                    "input flex items-center gap-2 cursor-pointer",
                    !form.customer_id && "text-gray-400",
                  )}
                  onClick={() => {
                    setShowCustomerSearch(true);
                    setCustomerSearch("");
                  }}
                >
                  {selectedCustomer ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Building2
                        size={14}
                        className="text-primary-500 shrink-0"
                      />
                      <span className="text-gray-800 font-medium truncate">
                        {selectedCustomer.company_name}
                      </span>
                      {selectedCustomer.industry && (
                        <span className="text-xs text-gray-400 shrink-0">
                          — {selectedCustomer.industry}
                        </span>
                      )}
                      {selectedCustomer.contact_person && (
                        <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
                          — {selectedCustomer.contact_person}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search size={14} />
                      Search customer by name, industry, or contact…
                    </span>
                  )}
                  {form.customer_id && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        set("customer_id", "");
                      }}
                      className="text-gray-300 hover:text-gray-500 ml-auto shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Customer dropdown */}
                {showCustomerSearch && (
                  <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
                    <div className="p-2 border-b border-gray-100">
                      <div className="relative">
                        <Search
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                          autoFocus
                          className="input pl-7 text-sm"
                          placeholder="Type to search…"
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">
                          No customers found
                        </p>
                      ) : (
                        filteredCustomers.map((c) => (
                          <button
                            key={c.customer_id}
                            type="button"
                            onClick={() => {
                              set("customer_id", c.customer_id);
                              setShowCustomerSearch(false);
                              setCustomerSearch("");
                            }}
                            className={clsx(
                              "w-full flex items-start gap-3 px-4 py-3 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors",
                              form.customer_id === c.customer_id &&
                                "bg-primary-50",
                            )}
                          >
                            <Building2
                              size={16}
                              className="text-gray-400 mt-0.5 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800">
                                {c.company_name}
                              </p>
                              <p className="text-xs text-gray-400">
                                {[c.industry, c.contact_person, c.phone]
                                  .filter(Boolean)
                                  .join(" — ")}
                              </p>
                              <p className="text-xs text-gray-300 font-mono">
                                {c.customer_id}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="p-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomerSearch(false);
                          setShowNewCustomer(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        <Plus size={14} /> Create new customer
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick add customer button */}
              <button
                type="button"
                onClick={() => setShowNewCustomer(true)}
                className="btn-secondary px-3 text-xs whitespace-nowrap flex items-center gap-1 shrink-0"
                title="Add new customer"
              >
                <Plus size={12} /> New
              </button>
            </div>
          </div>

          {/* Inline new customer form */}
          {showNewCustomer && (
            <div className="border-2 border-primary-100 rounded-xl p-4 bg-primary-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-primary-700 flex items-center gap-2">
                  <Building2 size={14} /> New Customer
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Company Name *
                  </label>
                  <input
                    className="input text-sm"
                    value={newCustomerForm.company_name}
                    onChange={(e) =>
                      setNewCustomerForm((f) => ({
                        ...f,
                        company_name: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Contact Person *
                  </label>
                  <input
                    className="input text-sm"
                    value={newCustomerForm.contact_person}
                    onChange={(e) =>
                      setNewCustomerForm((f) => ({
                        ...f,
                        contact_person: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Industry
                  </label>
                  <select
                    className="input text-sm"
                    value={newCustomerForm.industry}
                    onChange={(e) =>
                      setNewCustomerForm((f) => ({
                        ...f,
                        industry: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select…</option>
                    {INDUSTRIES.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Phone
                  </label>
                  <input
                    className="input text-sm"
                    value={newCustomerForm.phone}
                    onChange={(e) =>
                      setNewCustomerForm((f) => ({
                        ...f,
                        phone: e.target.value,
                      }))
                    }
                    placeholder="+965 XXXXXXXX"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    className="input text-sm"
                    value={newCustomerForm.email}
                    onChange={(e) =>
                      setNewCustomerForm((f) => ({
                        ...f,
                        email: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Address
                  </label>
                  <input
                    className="input text-sm"
                    value={newCustomerForm.address}
                    onChange={(e) =>
                      setNewCustomerForm((f) => ({
                        ...f,
                        address: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(false)}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateCustomer}
                  disabled={newCustomerLoading}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
                >
                  {newCustomerLoading && (
                    <Loader2 size={12} className="animate-spin" />
                  )}
                  {newCustomerLoading ? "Creating…" : "Create & Select"}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Linked Requirement
              </label>
              <select
                className="input"
                value={form.requirement_id}
                onChange={(e) => set("requirement_id", e.target.value)}
              >
                <option value="">None</option>
                {requirements.map((r) => (
                  <option key={r.requirement_id} value={r.requirement_id}>
                    {r.requirement_id} — {r.requirement_summary?.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quotation Date
              </label>
              <input
                type="date"
                className="input"
                value={form.quotation_date}
                onChange={(e) => set("quotation_date", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Valid Until
              </label>
              <input
                type="date"
                className="input"
                value={form.valid_until}
                onChange={(e) => set("valid_until", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {["Draft", "Sent", "Approved", "Rejected", "Expired"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discount Amount (KWD)
              </label>
              <input
                type="number"
                min="0"
                step="0.001"
                className="input"
                placeholder="0.000"
                value={form.discount_amount}
                onChange={(e) => set("discount_amount", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                VAT %
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="input"
                value={form.vat_percent}
                onChange={(e) => set("vat_percent", e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
            <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
            <button
              type="button"
              onClick={addItem}
              className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5"
            >
              <Plus size={13} /> Add Item
            </button>
          </div>

          <div className="space-y-4">
            {items.map((item, idx) => {
              const stockInfo = getStockInfo(item);
              const isOverStock = stockInfo && !stockInfo.ok;
              const isEqOpen = showEqSearch === idx;

              return (
                <div
                  key={idx}
                  className={clsx(
                    "rounded-xl border p-4 space-y-3 transition-colors",
                    isOverStock
                      ? "border-red-200 bg-red-50/50"
                      : "border-gray-100 bg-gray-50/30",
                  )}
                >
                  {/* Item type + remove */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-400">
                      #{idx + 1}
                    </span>
                    {["equipment", "procurement", "service"].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setItem(idx, "item_type", t)}
                        className={clsx(
                          "px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors",
                          item.item_type === t
                            ? "bg-primary-500 text-white"
                            : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="ml-auto text-gray-300 hover:text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* Equipment selector */}
                  {item.item_type === "equipment" && (
                    <div className="space-y-2">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowEqSearch(isEqOpen ? null : idx);
                            setEqSearch("");
                          }}
                          className={clsx(
                            "input w-full text-left flex items-center justify-between text-sm",
                            isOverStock && "border-red-300",
                          )}
                        >
                          <span
                            className={
                              item.equipment_id
                                ? "text-gray-800"
                                : "text-gray-400"
                            }
                          >
                            {item.equipment_id
                              ? (() => {
                                  const eq = equipment.find(
                                    (e) => e.equipment_id === item.equipment_id,
                                  );
                                  return eq
                                    ? `${eq.equipment_types?.name} ${eq.capacity} — ${eq.equipment_id}`
                                    : item.equipment_id;
                                })()
                              : "Search and select equipment…"}
                          </span>
                          {isEqOpen ? (
                            <ChevronUp
                              size={14}
                              className="text-gray-400 shrink-0"
                            />
                          ) : (
                            <ChevronDown
                              size={14}
                              className="text-gray-400 shrink-0"
                            />
                          )}
                        </button>

                        {isEqOpen && (
                          <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
                            <div className="p-2 border-b border-gray-100">
                              <div className="relative">
                                <Search
                                  size={13}
                                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                                />
                                <input
                                  autoFocus
                                  className="input pl-7 text-xs"
                                  placeholder="Search by type, serial, capacity, location…"
                                  value={eqSearch}
                                  onChange={(e) => setEqSearch(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                {eqSearch && (
                                  <button
                                    onClick={() => setEqSearch("")}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="max-h-56 overflow-y-auto">
                              {filteredEquipment.length === 0 ? (
                                <p className="text-xs text-gray-400 text-center py-4">
                                  No equipment found
                                </p>
                              ) : (
                                filteredEquipment.map((eq) => {
                                  const typeId =
                                    eq.type_id ?? eq.equipment_types?.type_id;
                                  const typeStock = stockMap[typeId];
                                  const avail = typeStock?.available ?? 0;
                                  const isSelected =
                                    item.equipment_id === eq.equipment_id;
                                  return (
                                    <button
                                      key={eq.equipment_id}
                                      type="button"
                                      onClick={() =>
                                        setItem(
                                          idx,
                                          "equipment_id",
                                          eq.equipment_id,
                                        )
                                      }
                                      className={clsx(
                                        "w-full flex items-center justify-between px-4 py-2.5 text-left border-b border-gray-50 last:border-0 transition-colors text-xs",
                                        isSelected
                                          ? "bg-primary-50"
                                          : "hover:bg-gray-50",
                                      )}
                                    >
                                      <div>
                                        <p className="font-medium text-gray-800">
                                          {eq.equipment_types?.name}{" "}
                                          {eq.capacity}
                                        </p>
                                        <p className="text-gray-400">
                                          {eq.equipment_id} ·{" "}
                                          {eq.serial_number ?? "No serial"} ·{" "}
                                          {eq.location ?? "—"}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2 ml-3 shrink-0">
                                        <span
                                          className={clsx(
                                            "px-2 py-0.5 rounded-full text-xs font-medium",
                                            avail === 0
                                              ? "bg-red-100 text-red-600"
                                              : avail <= 1
                                                ? "bg-yellow-100 text-yellow-700"
                                                : "bg-green-100 text-green-700",
                                          )}
                                        >
                                          {avail} avail
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                            <div className="p-2 border-t border-gray-100 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setShowEqSearch(null)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {stockInfo && (
                        <div
                          className={clsx(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium",
                            stockInfo.ok
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700",
                          )}
                        >
                          {stockInfo.ok ? (
                            <CheckCircle size={12} />
                          ) : (
                            <AlertTriangle size={12} />
                          )}
                          <span>
                            {stockInfo.available} unit(s) available of this type
                          </span>
                          <div className="ml-1 flex-1 max-w-16 h-1.5 bg-white/60 rounded-full overflow-hidden">
                            <div
                              className={clsx(
                                "h-full rounded-full",
                                stockInfo.ok ? "bg-green-500" : "bg-red-500",
                              )}
                              style={{
                                width: `${Math.min(100, (stockInfo.available / Math.max(stockInfo.usedInForm, stockInfo.available, 1)) * 100)}%`,
                              }}
                            />
                          </div>
                          {!stockInfo.ok && (
                            <span className="font-bold">EXCEEDS STOCK</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Procurement selector */}
                  {item.item_type === "procurement" && (
                    <select
                      className="input text-sm"
                      value={item.procurement_id ?? ""}
                      onChange={(e) =>
                        setItem(idx, "procurement_id", e.target.value || null)
                      }
                    >
                      <option value="">Select approved procurement…</option>
                      {procurements.map((p) => (
                        <option key={p.procurement_id} value={p.procurement_id}>
                          {p.procurement_id} — {p.title} — KWD{" "}
                          {Number(p.total_amount_kwd).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  )}

                  {item.item_type === "service" && (
                    <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                      <Package size={12} /> Manual / Service item
                    </div>
                  )}

                  {/* Description, Qty, Unit, Rate */}
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 sm:col-span-5">
                      <input
                        className="input text-sm"
                        placeholder="Description *"
                        value={item.description}
                        onChange={(e) =>
                          setItem(idx, "description", e.target.value)
                        }
                        required
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        type="number"
                        min="1"
                        className="input text-sm"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) =>
                          setItem(idx, "quantity", e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <select
                        className="input text-sm"
                        value={item.unit}
                        onChange={(e) => setItem(idx, "unit", e.target.value)}
                      >
                        {[
                          "Days",
                          "Hours",
                          "Months",
                          "Lumpsum",
                          "Trip",
                          "Unit",
                        ].map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        className={clsx(
                          "input text-sm",
                          isOverStock && "border-red-300",
                        )}
                        placeholder="Rate KWD"
                        value={item.unit_rate_kwd}
                        onChange={(e) =>
                          setItem(idx, "unit_rate_kwd", e.target.value)
                        }
                        required
                      />
                    </div>
                  </div>

                  {/* Rental dates + item discount */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Rental Start
                      </label>
                      <input
                        type="date"
                        className="input text-xs"
                        value={item.rental_start_date}
                        onChange={(e) =>
                          setItem(idx, "rental_start_date", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Rental End / Return
                      </label>
                      <input
                        type="date"
                        className="input text-xs"
                        value={item.rental_end_date}
                        onChange={(e) =>
                          setItem(idx, "rental_end_date", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Item Discount (KWD)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        className="input text-xs"
                        placeholder="0.000"
                        value={item.discount_amount}
                        onChange={(e) =>
                          setItem(idx, "discount_amount", e.target.value)
                        }
                      />
                    </div>
                  </div>

                  {/* Line total */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      {item.rental_start_date && item.rental_end_date
                        ? `Rental: ${item.rental_start_date} → ${item.rental_end_date}`
                        : ""}
                    </span>
                    <span className="font-semibold text-gray-700">
                      Line: KWD{" "}
                      {Math.max(
                        0,
                        Number(item.quantity) *
                          Number(item.unit_rate_kwd || 0) -
                          Number(item.discount_amount || 0),
                      ).toLocaleString("en-US", { minimumFractionDigits: 3 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals summary */}
          <div className="mt-6 border-t border-gray-100 pt-4 space-y-1.5 flex flex-col items-end text-sm">
            <div className="flex gap-10 text-gray-600">
              <span>Subtotal</span>
              <span className="font-medium w-44 text-right">
                KWD{" "}
                {itemsSubtotal.toLocaleString("en-US", {
                  minimumFractionDigits: 3,
                })}
              </span>
            </div>
            {headerDiscount > 0 && (
              <div className="flex gap-10 text-red-500">
                <span>Discount</span>
                <span className="font-medium w-44 text-right">
                  - KWD{" "}
                  {headerDiscount.toLocaleString("en-US", {
                    minimumFractionDigits: 3,
                  })}
                </span>
              </div>
            )}
            {headerDiscount > 0 && (
              <div className="flex gap-10 text-gray-600">
                <span>After Discount</span>
                <span className="font-medium w-44 text-right">
                  KWD{" "}
                  {afterDiscount.toLocaleString("en-US", {
                    minimumFractionDigits: 3,
                  })}
                </span>
              </div>
            )}
            {Number(form.vat_percent) > 0 && (
              <div className="flex gap-10 text-gray-600">
                <span>VAT ({form.vat_percent}%)</span>
                <span className="font-medium w-44 text-right">
                  KWD{" "}
                  {vatAmt.toLocaleString("en-US", { minimumFractionDigits: 3 })}
                </span>
              </div>
            )}
            <div className="flex gap-10 font-bold text-gray-900 text-base border-t border-gray-200 pt-2 mt-1">
              <span>Total</span>
              <span className="w-44 text-right">
                KWD{" "}
                {total.toLocaleString("en-US", { minimumFractionDigits: 3 })}
              </span>
            </div>
          </div>
        </div>

        {/* Terms */}
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">
            Terms & Notes
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Terms & Conditions
            </label>
            <textarea
              className="input resize-y"
              rows={3}
              value={form.terms_conditions}
              onChange={(e) => set("terms_conditions", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal Notes
            </label>
            <textarea
              className="input resize-y"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pb-6">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || stockViolations.length > 0}
            className={clsx(
              "btn-primary flex items-center gap-2",
              (saving || stockViolations.length > 0) &&
                "opacity-60 cursor-not-allowed",
            )}
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving
              ? "Saving…"
              : isEdit
                ? "Update Quotation"
                : "Create Quotation"}
          </button>
        </div>
      </form>
    </div>
  );
}
