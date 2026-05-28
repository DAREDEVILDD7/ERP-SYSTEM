import { useEffect, useState, useCallback } from "react";
import {
  getProcurements,
  createProcurement,
  updateProcurement,
  getVendors,
  createVendor,
  getPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  submitPurchaseOrder,
  receiveProcurement,
} from "../../api/procurement";
import { getEquipmentTypes } from "../../api/equipment";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../lib/rolePermissions";
import StatusBadge from "../../components/common/StatusBadge";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import EmptyState from "../../components/common/EmptyState";
import { downloadPurchaseOrderPDF } from "../../lib/pdfGenerator";
import {
  Plus,
  ShoppingCart,
  X,
  Loader2,
  RefreshCw,
  FileText,
  Send,
  Download,
  Trash2,
  CheckCircle,
  Eye,
  Package,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "../../lib/supabaseClient";
import toast from "react-hot-toast";
import clsx from "clsx";

const TABS = ["Requests", "Purchase Orders", "Vendors"];
// const PROC_STATUSES = ['Draft','Pending Approval','Approved','PO Issued','Partially Delivered','Delivered','Received','Cancelled','Rejected'];
// const PO_STATUSES   = ['Draft','Submitted','Acknowledged','Partially Delivered','Delivered','Closed','Cancelled'];
const EMPTY_ITEM = {
  description: "",
  quantity: 1,
  unit: "Unit",
  unit_price_kwd: "",
  equipment_type_id: "",
};
const EMPTY_VENDOR = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  country: "Kuwait",
  category: "",
  payment_terms: "",
  notes: "",
};

export default function ProcurementPage() {
  const { profile, role } = useAuth();
  const [tab, setTab] = useState("Requests");
  const [procs, setProcs] = useState([]);
  const [pos, setPOs] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [eqTypes, setEqTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);

  // Modal: null | 'proc' | 'po' | 'vendor' | 'vendor-inline' | 'receive' | 'po-preview' | 'proc-preview'
  const [showModal, setShowModal] = useState(null);
  const [selected, setSelected] = useState(null);

  const canWrite = hasPermission(role, "procurement_create");
  const canApprove = hasPermission(role, "procurement_approve");
  const canPO = hasPermission(role, "po_create");
  const canVendor = hasPermission(role, "vendor_manage");

  // ── Procurement form ──
  const [procForm, setProcForm] = useState({
    title: "",
    description: "",
    type: "Purchase",
    vendor_id: "",
    priority: "Normal",
    required_by_date: "",
    lease_start_date: "",
    lease_end_date: "",
    lease_monthly_kwd: "",
    terms_conditions: "Standard procurement terms apply.",
    notes: "",
    status: "Draft",
  });
  const [procItems, setProcItems] = useState([{ ...EMPTY_ITEM }]);

  // ── PO form ──
  const [poForm, setPoForm] = useState({
    procurement_id: "",
    vendor_id: "",
    issue_date: new Date().toISOString().split("T")[0],
    expected_delivery: "",
    total_amount_kwd: "",
    terms_conditions: "Payment within 30 days upon delivery and inspection.",
    shipping_address: "KW Ops Yard, Kuwait",
    notes: "",
    status: "Draft",
  });

  // ── Vendor form ──
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR);

  // ── Receive form ──
  const [receiveItems, setReceiveItems] = useState([]);

  // ── PO preview ──
  const [previewPO, setPreviewPO] = useState(null);

  // ── Proc preview ──
  const [previewProc, setPreviewProc] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, po, v, et] = await Promise.all([
        getProcurements(),
        getPurchaseOrders(),
        getVendors(),
        getEquipmentTypes(),
      ]);
      setProcs(p);
      setPOs(po);
      setVendors(v);
      setEqTypes(et);
    } catch {
      toast.error("Failed to load procurement data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const ch = supabase
      .channel("procurement-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "procurements" },
        loadAll,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders" },
        loadAll,
      )
      .subscribe();
    return () => ch.unsubscribe();
  }, [loadAll]);

  // ── Procurement CRUD ──────────────────────────────────────────────────────
  const openProcAdd = () => {
    setProcForm({
      title: "",
      description: "",
      type: "Purchase",
      vendor_id: "",
      priority: "Normal",
      required_by_date: "",
      lease_start_date: "",
      lease_end_date: "",
      lease_monthly_kwd: "",
      terms_conditions: "Standard procurement terms apply.",
      notes: "",
      status: "Draft",
    });
    setProcItems([{ ...EMPTY_ITEM }]);
    setSelected(null);
    setShowModal("proc");
  };

  const openProcEdit = (p) => {
    setProcForm({
      title: p.title,
      description: p.description ?? "",
      type: p.type,
      vendor_id: p.vendor_id ?? "",
      priority: p.priority ?? "Normal",
      required_by_date: p.required_by_date ?? "",
      lease_start_date: p.lease_start_date ?? "",
      lease_end_date: p.lease_end_date ?? "",
      lease_monthly_kwd: p.lease_monthly_kwd ?? "",
      terms_conditions: p.terms_conditions ?? "",
      notes: p.notes ?? "",
      status: p.status,
    });
    setProcItems(
      p.procurement_items?.length > 0
        ? p.procurement_items.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unit: i.unit,
            unit_price_kwd: i.unit_price_kwd,
            equipment_type_id: i.equipment_type_id ?? "",
          }))
        : [{ ...EMPTY_ITEM }],
    );
    setSelected(p);
    setShowModal("proc");
  };

  const handleProcSave = async (e) => {
    e.preventDefault();
    if (!procForm.title.trim()) return toast.error("Enter procurement title");
    if (procItems.some((i) => !i.description))
      return toast.error("Fill all item descriptions");
    setFormLoading(true);
    try {
      if (selected) {
        await updateProcurement(selected.procurement_id, procForm);
        await supabase
          .from("procurement_items")
          .delete()
          .eq("procurement_id", selected.procurement_id);
        if (procItems.length > 0) {
          await supabase
            .from("procurement_items")
            .insert(
              procItems.map((i) => ({
                ...i,
                procurement_id: selected.procurement_id,
                equipment_type_id: i.equipment_type_id || null,
              })),
            );
        }
        toast.success("Procurement updated");
      } else {
        await createProcurement(
          { ...procForm, requested_by: profile.user_id },
          procItems.map((i) => ({
            ...i,
            equipment_type_id: i.equipment_type_id || null,
          })),
        );
        toast.success("Procurement request created");
      }
      setShowModal(null);
      loadAll();
    } catch (err) {
      toast.error(err.message || "Failed to save");
    } finally {
      setFormLoading(false);
    }
  };

  const handleProcApprove = async (id, approve) => {
    try {
      await updateProcurement(id, {
        status: approve ? "Approved" : "Rejected",
        approved_by: profile.user_id,
      });
      toast.success(approve ? "Approved" : "Rejected");
      loadAll();
    } catch {
      toast.error("Action failed");
    }
  };

  const handleProcSubmit = async (id) => {
    try {
      await updateProcurement(id, { status: "Pending Approval" });
      toast.success("Submitted for approval");
      loadAll();
    } catch {
      toast.error("Failed to submit");
    }
  };

  // ── Receive procurement ───────────────────────────────────────────────────
  const openReceive = (proc) => {
    setSelected(proc);
    setReceiveItems(
      (proc.procurement_items ?? []).map((item) => ({
        item_id: item.item_id,
        description: item.description,
        equipment_type_id: item.equipment_type_id,
        quantity: item.quantity,
        received_qty: item.quantity,
        received_date: new Date().toISOString().split("T")[0],
        fleet_location: "Yard",
        procurement_type: proc.type ?? "Purchase",
        lease_start: proc.lease_start_date ?? "",
        lease_end: proc.lease_end_date ?? "",
      })),
    );
    setShowModal("receive");
  };

  const handleReceive = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      await receiveProcurement(
        selected.procurement_id,
        receiveItems,
        profile.user_id,
      );
      toast.success("Procurement received — items added to equipment fleet");
      setShowModal(null);
      loadAll();
    } catch (err) {
      toast.error(err.message || "Failed to receive");
    } finally {
      setFormLoading(false);
    }
  };

  // ── PO CRUD ───────────────────────────────────────────────────────────────
  const openPOAdd = (proc = null) => {
    setPoForm({
      procurement_id: proc?.procurement_id ?? "",
      vendor_id: proc?.vendor_id ?? "",
      total_amount_kwd: proc?.total_amount_kwd ?? "",
      issue_date: new Date().toISOString().split("T")[0],
      expected_delivery: "",
      terms_conditions: "Payment within 30 days upon delivery and inspection.",
      shipping_address: "KW Ops Yard, Kuwait",
      notes: "",
      status: "Draft",
    });
    setSelected(proc);
    setShowModal("po");
  };

  const handlePOSave = async (e) => {
    e.preventDefault();
    if (!poForm.vendor_id) return toast.error("Select vendor");
    if (!poForm.total_amount_kwd) return toast.error("Enter amount");
    setFormLoading(true);
    try {
      await createPurchaseOrder({ ...poForm, created_by: profile.user_id });
      if (poForm.procurement_id) {
        await updateProcurement(poForm.procurement_id, { status: "PO Issued" });
      }
      toast.success("Purchase Order created");
      setShowModal(null);
      loadAll();
    } catch (err) {
      toast.error(err.message || "Failed");
    } finally {
      setFormLoading(false);
    }
  };

  const handleSubmitPO = async (po) => {
    try {
      await submitPurchaseOrder(po.po_id);
      toast.success("PO submitted to vendor");
      loadAll();
    } catch {
      toast.error("Failed to submit PO");
    }
  };

  const handleDelivered = async (po) => {
    try {
      await updatePurchaseOrder(po.po_id, {
        status: "Delivered",
        actual_delivery: new Date().toISOString().split("T")[0],
      });
      toast.success("Marked as delivered");
      loadAll();
    } catch {
      toast.error("Failed to update");
    }
  };

  // ── Vendor CRUD ───────────────────────────────────────────────────────────
  const openVendorAdd = (inline = false) => {
    setVendorForm(EMPTY_VENDOR);
    setShowModal(inline ? "vendor-inline" : "vendor");
  };

  const handleVendorSave = async (e) => {
    e.preventDefault();
    if (!vendorForm.name.trim()) return toast.error("Enter vendor name");
    setFormLoading(true);
    try {
      const newVendor = await createVendor(vendorForm);
      toast.success("Vendor added");
      const updatedVendors = await getVendors();
      setVendors(updatedVendors);
      if (showModal === "vendor-inline") {
        setProcForm((f) => ({ ...f, vendor_id: newVendor.vendor_id }));
        setShowModal("proc");
      } else {
        setShowModal(null);
        loadAll();
      }
    } catch (err) {
      toast.error(err.message || "Failed to add vendor");
    } finally {
      setFormLoading(false);
    }
  };

  // ── Proc items helpers ────────────────────────────────────────────────────
  const addProcItem = () => setProcItems((i) => [...i, { ...EMPTY_ITEM }]);
  const removeProcItem = (idx) => {
    if (procItems.length === 1)
      return toast.error("At least one item required");
    setProcItems((i) => i.filter((_, j) => j !== idx));
  };
  const setProcItem = (idx, field, val) =>
    setProcItems((items) =>
      items.map((item, i) => (i === idx ? { ...item, [field]: val } : item)),
    );

  const procTotal = procItems.reduce(
    (s, i) => s + Number(i.quantity || 0) * Number(i.unit_price_kwd || 0),
    0,
  );

  // ── Vendor Modal Component ────────────────────────────────────────────────
  const VendorModal = () => (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Add New Vendor</h3>
          <button
            onClick={() =>
              setShowModal(showModal === "vendor-inline" ? "proc" : null)
            }
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <form onSubmit={handleVendorSave} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vendor Name *
            </label>
            <input
              className="input"
              value={vendorForm.name}
              onChange={(e) =>
                setVendorForm((f) => ({ ...f, name: e.target.value }))
              }
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contact Person
              </label>
              <input
                className="input"
                value={vendorForm.contact_person}
                onChange={(e) =>
                  setVendorForm((f) => ({
                    ...f,
                    contact_person: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <input
                className="input"
                value={vendorForm.category}
                placeholder="e.g. Heavy Equipment"
                onChange={(e) =>
                  setVendorForm((f) => ({ ...f, category: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                className="input"
                value={vendorForm.phone}
                onChange={(e) =>
                  setVendorForm((f) => ({ ...f, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                className="input"
                value={vendorForm.email}
                onChange={(e) =>
                  setVendorForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Country
              </label>
              <input
                className="input"
                value={vendorForm.country}
                onChange={(e) =>
                  setVendorForm((f) => ({ ...f, country: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Terms
              </label>
              <input
                className="input"
                value={vendorForm.payment_terms}
                placeholder="e.g. Net 30"
                onChange={(e) =>
                  setVendorForm((f) => ({
                    ...f,
                    payment_terms: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <textarea
              className="input"
              rows={2}
              value={vendorForm.address}
              onChange={(e) =>
                setVendorForm((f) => ({ ...f, address: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              className="input"
              rows={2}
              value={vendorForm.notes}
              onChange={(e) =>
                setVendorForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() =>
                setShowModal(showModal === "vendor-inline" ? "proc" : null)
              }
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={formLoading}
              className="btn-primary flex items-center gap-2"
            >
              {formLoading && <Loader2 size={14} className="animate-spin" />}
              {formLoading ? "Saving…" : "Add Vendor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ── PO Preview popup ──────────────────────────────────────────────────────
  const POPreview = ({ po }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-900">{po.po_number}</h3>
            <p className="text-sm text-gray-400">Purchase Order</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                downloadPurchaseOrderPDF(
                  po,
                  po.procurements?.procurement_items ?? [],
                )
              }
              className="btn-secondary flex items-center gap-1 text-xs"
            >
              <Download size={13} /> PDF
            </button>
            <button
              onClick={() => setPreviewPO(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400">Vendor</p>
              <p className="font-medium text-gray-800">
                {po.vendors?.name ?? "—"}
              </p>
              {po.vendors?.contact_person && (
                <p className="text-xs text-gray-400">
                  {po.vendors.contact_person}
                </p>
              )}
              {po.vendors?.email && (
                <p className="text-xs text-gray-400">{po.vendors.email}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">Status</p>
              <StatusBadge status={po.status} />
              {po.submitted_at && (
                <p className="text-xs text-gray-400 mt-1">
                  Submitted:{" "}
                  {format(new Date(po.submitted_at), "dd MMM yyyy HH:mm")}
                </p>
              )}
              {po.actual_delivery && (
                <p className="text-xs text-green-600 mt-1">
                  Delivered:{" "}
                  {format(new Date(po.actual_delivery), "dd MMM yyyy")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">Issue Date</p>
              <p className="font-medium">
                {format(new Date(po.issue_date), "dd MMM yyyy")}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Expected Delivery</p>
              <p className="font-medium">
                {po.expected_delivery
                  ? format(new Date(po.expected_delivery), "dd MMM yyyy")
                  : "—"}
              </p>
            </div>
          </div>

          {po.procurements && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-medium text-blue-600 mb-1">
                Linked Procurement
              </p>
              <p className="text-sm font-medium text-blue-800">
                {po.procurements.procurement_id} — {po.procurements.title}
              </p>
              <p className="text-xs text-blue-500">
                Type: {po.procurements.type}
              </p>
            </div>
          )}

          {po.procurements?.procurement_items?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">
                Items
              </p>
              <div className="space-y-1">
                {po.procurements.procurement_items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-700">
                        {item.description}
                      </p>
                      {item.equipment_types?.name && (
                        <p className="text-xs text-gray-400">
                          {item.equipment_types.name}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">
                        Qty: {item.quantity}
                      </p>
                      <p className="font-medium text-gray-700">
                        KWD{" "}
                        {Number(item.unit_price_kwd).toLocaleString("en-US", {
                          minimumFractionDigits: 3,
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-3 text-right">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-xl font-bold text-gray-900">
              KWD{" "}
              {Number(po.total_amount_kwd).toLocaleString("en-US", {
                minimumFractionDigits: 3,
              })}
            </p>
          </div>

          {po.terms_conditions && (
            <div className="text-xs text-gray-400 bg-gray-50 rounded-xl p-3">
              <p className="font-medium text-gray-500 mb-1">
                Terms & Conditions
              </p>
              <p>{po.terms_conditions}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Proc Preview popup ────────────────────────────────────────────────────
  const ProcPreview = ({ proc }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-900">
              {proc.procurement_id}
            </h3>
            <p className="text-sm text-gray-400">{proc.title}</p>
          </div>
          <button
            onClick={() => setPreviewProc(null)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Type</p>
              <span
                className={clsx(
                  "badge border text-xs",
                  proc.type === "Purchase"
                    ? "bg-blue-50 text-blue-700 border-blue-100"
                    : "bg-purple-50 text-purple-700 border-purple-100",
                )}
              >
                {proc.type}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400">Status</p>
              <StatusBadge status={proc.status} />
            </div>
            <div>
              <p className="text-xs text-gray-400">Vendor</p>
              <p className="font-medium">{proc.vendors?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Priority</p>
              <p className="font-medium">{proc.priority}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Required By</p>
              <p className="font-medium">
                {proc.required_by_date
                  ? format(new Date(proc.required_by_date), "dd MMM yyyy")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Total (KWD)</p>
              <p className="font-bold text-gray-900">
                {Number(proc.total_amount_kwd).toLocaleString("en-US", {
                  minimumFractionDigits: 3,
                })}
              </p>
            </div>
          </div>

          {proc.type === "Lease" && (
            <div className="bg-purple-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-purple-500">Lease Start</p>
                <p className="font-medium text-purple-800">
                  {proc.lease_start_date ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-purple-500">Lease End</p>
                <p className="font-medium text-purple-800">
                  {proc.lease_end_date ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-purple-500">Monthly (KWD)</p>
                <p className="font-medium text-purple-800">
                  {proc.lease_monthly_kwd ?? "—"}
                </p>
              </div>
            </div>
          )}

          {proc.description && (
            <p className="text-sm text-gray-600">{proc.description}</p>
          )}
          {proc.notes && (
            <p className="text-sm text-gray-500 italic">{proc.notes}</p>
          )}

          {proc.procurement_items?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">
                Items
              </p>
              {proc.procurement_items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm mb-1"
                >
                  <div>
                    <p className="font-medium text-gray-700">
                      {item.description}
                    </p>
                    {item.equipment_types?.name && (
                      <p className="text-xs text-gray-400">
                        {item.equipment_types.name}
                      </p>
                    )}
                    {item.added_to_fleet && (
                      <p className="text-xs text-green-600 mt-0.5">
                        ✓ Added to fleet · {item.fleet_location}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-gray-500">Qty: {item.quantity}</p>
                    <p className="font-medium text-gray-700">
                      KWD {Number(item.unit_price_kwd || 0).toLocaleString()}
                    </p>
                    {item.received_qty > 0 && (
                      <p className="text-green-600">
                        Received: {item.received_qty}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Linked PO */}
          {proc.purchase_orders?.length > 0 && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-medium text-blue-600 mb-1">
                Purchase Orders
              </p>
              {proc.purchase_orders.map((po) => (
                <div
                  key={po.po_id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-mono text-blue-700">
                    {po.po_number}
                  </span>
                  <StatusBadge status={po.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Procurement</h2>
          <p className="text-sm text-gray-400">
            Purchases, leases, POs, and vendors
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadAll} className="btn-secondary p-2">
            <RefreshCw size={16} />
          </button>
          {canWrite && (
            <button
              onClick={openProcAdd}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} /> New Request
            </button>
          )}
          {canPO && (
            <button
              onClick={() => openPOAdd()}
              className="btn-secondary flex items-center gap-2"
            >
              <FileText size={15} /> New PO
            </button>
          )}
          {canVendor && (
            <button
              onClick={() => openVendorAdd(false)}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus size={15} /> Add Vendor
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="card p-1 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
              tab === t
                ? "bg-primary-500 text-white"
                : "text-gray-600 hover:bg-gray-50",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner fullscreen={false} />
      ) : (
        <>
          {/* ── Requests Tab ── */}
          {tab === "Requests" &&
            (procs.length === 0 ? (
              <EmptyState
                message="No procurement requests"
                icon={ShoppingCart}
              />
            ) : (
              <>
                {/* Desktop */}
                <div className="card hidden md:block overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">ID</th>
                        <th className="text-left px-5 py-3">Title</th>
                        <th className="text-left px-5 py-3">Type</th>
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-right px-5 py-3">Total (KWD)</th>
                        <th className="text-left px-5 py-3">Required By</th>
                        <th className="text-left px-5 py-3">PO</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-left px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {procs.map((p) => {
                        const linkedPO = pos.find(
                          (po) => po.procurement_id === p.procurement_id,
                        );
                        return (
                          <tr
                            key={p.procurement_id}
                            className="hover:bg-gray-50"
                          >
                            <td className="px-5 py-3 font-mono text-xs text-gray-400">
                              {p.procurement_id}
                            </td>
                            <td className="px-5 py-3 max-w-xs">
                              <p className="font-medium text-gray-800 truncate">
                                {p.title}
                              </p>
                              {p.notes && (
                                <p className="text-xs text-gray-400 truncate">
                                  {p.notes}
                                </p>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <span
                                className={clsx(
                                  "badge border text-xs",
                                  p.type === "Purchase"
                                    ? "bg-blue-50 text-blue-700 border-blue-100"
                                    : "bg-purple-50 text-purple-700 border-purple-100",
                                )}
                              >
                                {p.type}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-gray-500 text-xs">
                              {p.vendors?.name ?? "—"}
                            </td>
                            <td className="px-5 py-3 text-right font-medium text-gray-700">
                              {Number(p.total_amount_kwd).toLocaleString(
                                "en-US",
                                { minimumFractionDigits: 3 },
                              )}
                            </td>
                            <td className="px-5 py-3 text-gray-400 text-xs">
                              {p.required_by_date
                                ? format(
                                    new Date(p.required_by_date),
                                    "dd MMM yyyy",
                                  )
                                : "—"}
                            </td>
                            <td className="px-5 py-3">
                              {linkedPO ? (
                                <button
                                  onClick={() => setPreviewPO(linkedPO)}
                                  className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-mono"
                                >
                                  <Eye size={11} /> {linkedPO.po_number}
                                </button>
                              ) : (
                                <span className="text-gray-300 text-xs">
                                  No PO
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <StatusBadge status={p.status} />
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  onClick={() => setPreviewProc(p)}
                                  className="text-gray-400 hover:text-gray-600"
                                  title="Preview"
                                >
                                  <Eye size={14} />
                                </button>
                                {canWrite && p.status === "Draft" && (
                                  <>
                                    <button
                                      onClick={() => openProcEdit(p)}
                                      className="text-xs text-primary-500 hover:underline"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleProcSubmit(p.procurement_id)
                                      }
                                      className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg"
                                    >
                                      Submit
                                    </button>
                                  </>
                                )}
                                {canApprove &&
                                  p.status === "Pending Approval" && (
                                    <>
                                      <button
                                        onClick={() =>
                                          handleProcApprove(
                                            p.procurement_id,
                                            true,
                                          )
                                        }
                                        className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleProcApprove(
                                            p.procurement_id,
                                            false,
                                          )
                                        }
                                        className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-lg"
                                      >
                                        ✗
                                      </button>
                                    </>
                                  )}
                                {canPO && p.status === "Approved" && (
                                  <button
                                    onClick={() => openPOAdd(p)}
                                    className="text-xs bg-purple-500 text-white px-2 py-1 rounded-lg"
                                  >
                                    → PO
                                  </button>
                                )}
                                {canWrite &&
                                  ["Delivered", "PO Issued"].includes(
                                    p.status,
                                  ) && (
                                    <button
                                      onClick={() => openReceive(p)}
                                      className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1"
                                    >
                                      <Package size={11} /> Receive
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile */}
                <div className="md:hidden space-y-3">
                  {procs.map((p) => {
                    const linkedPO = pos.find(
                      (po) => po.procurement_id === p.procurement_id,
                    );
                    return (
                      <div key={p.procurement_id} className="card p-4">
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-medium text-gray-800 flex-1 pr-2">
                            {p.title}
                          </p>
                          <StatusBadge status={p.status} />
                        </div>
                        <p className="text-xs text-gray-400">
                          {p.procurement_id} · {p.type} ·{" "}
                          {p.vendors?.name ?? "No vendor"}
                        </p>
                        {p.notes && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {p.notes}
                          </p>
                        )}
                        {linkedPO && (
                          <button
                            onClick={() => setPreviewPO(linkedPO)}
                            className="text-xs text-primary-600 hover:underline flex items-center gap-1 mt-1"
                          >
                            <Eye size={11} /> {linkedPO.po_number}
                          </button>
                        )}
                        <p className="text-sm font-semibold text-gray-700 mt-1">
                          KWD {Number(p.total_amount_kwd).toLocaleString()}
                        </p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          <button
                            onClick={() => setPreviewProc(p)}
                            className="text-xs btn-secondary flex items-center gap-1"
                          >
                            <Eye size={12} /> Preview
                          </button>
                          {canWrite && p.status === "Draft" && (
                            <button
                              onClick={() => handleProcSubmit(p.procurement_id)}
                              className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg"
                            >
                              Submit
                            </button>
                          )}
                          {canApprove && p.status === "Pending Approval" && (
                            <button
                              onClick={() =>
                                handleProcApprove(p.procurement_id, true)
                              }
                              className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg"
                            >
                              Approve
                            </button>
                          )}
                          {canPO && p.status === "Approved" && (
                            <button
                              onClick={() => openPOAdd(p)}
                              className="text-xs bg-purple-500 text-white px-3 py-1 rounded-lg"
                            >
                              Create PO
                            </button>
                          )}
                          {canWrite &&
                            ["Delivered", "PO Issued"].includes(p.status) && (
                              <button
                                onClick={() => openReceive(p)}
                                className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg"
                              >
                                Receive
                              </button>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ))}

          {/* ── Purchase Orders Tab ── */}
          {tab === "Purchase Orders" &&
            (pos.length === 0 ? (
              <EmptyState message="No purchase orders" icon={FileText} />
            ) : (
              <>
                <div className="card hidden md:block overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">PO Number</th>
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-left px-5 py-3">Issue Date</th>
                        <th className="text-left px-5 py-3">
                          Expected Delivery
                        </th>
                        <th className="text-right px-5 py-3">Total (KWD)</th>
                        <th className="text-left px-5 py-3">Submitted</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-left px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pos.map((po) => (
                        <tr key={po.po_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-mono text-xs text-gray-700 font-medium">
                            {po.po_number}
                          </td>
                          <td className="px-5 py-3 text-gray-800">
                            {po.vendors?.name ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-gray-400 text-xs">
                            {format(new Date(po.issue_date), "dd MMM yyyy")}
                          </td>
                          <td className="px-5 py-3 text-gray-400 text-xs">
                            {po.expected_delivery
                              ? format(
                                  new Date(po.expected_delivery),
                                  "dd MMM yyyy",
                                )
                              : "—"}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-gray-800">
                            {Number(po.total_amount_kwd).toLocaleString(
                              "en-US",
                              { minimumFractionDigits: 3 },
                            )}
                          </td>
                          <td className="px-5 py-3 text-xs">
                            {po.submitted_at ? (
                              <span className="text-green-600">
                                {format(
                                  new Date(po.submitted_at),
                                  "dd MMM HH:mm",
                                )}
                              </span>
                            ) : (
                              <span className="text-gray-300">
                                Not submitted
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <StatusBadge status={po.status} />
                          </td>
                          <td className="px-5 py-3 flex items-center gap-2">
                            <button
                              onClick={() => setPreviewPO(po)}
                              className="text-gray-400 hover:text-gray-600"
                              title="Preview PO"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={() =>
                                downloadPurchaseOrderPDF(
                                  po,
                                  po.procurements?.procurement_items ?? [],
                                )
                              }
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <Download size={15} />
                            </button>
                            {po.status === "Draft" && (
                              <button
                                onClick={() => handleSubmitPO(po)}
                                className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg flex items-center gap-1"
                              >
                                <Send size={11} /> Submit
                              </button>
                            )}
                            {[
                              "Submitted",
                              "Acknowledged",
                              "Partially Delivered",
                            ].includes(po.status) && (
                              <button
                                onClick={() => handleDelivered(po)}
                                className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1"
                              >
                                <CheckCircle size={11} /> Delivered
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden space-y-3">
                  {pos.map((po) => (
                    <div key={po.po_id} className="card p-4">
                      <div className="flex justify-between mb-1">
                        <p className="font-medium text-gray-800 font-mono text-sm">
                          {po.po_number}
                        </p>
                        <StatusBadge status={po.status} />
                      </div>
                      <p className="text-xs text-gray-500">
                        {po.vendors?.name}
                      </p>
                      <p className="text-sm font-bold text-gray-800 mt-1">
                        KWD {Number(po.total_amount_kwd).toLocaleString()}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => setPreviewPO(po)}
                          className="text-xs btn-secondary flex items-center gap-1"
                        >
                          <Eye size={12} /> Preview
                        </button>
                        <button
                          onClick={() => downloadPurchaseOrderPDF(po, [])}
                          className="text-xs btn-secondary flex items-center gap-1"
                        >
                          <Download size={12} /> PDF
                        </button>
                        {po.status === "Draft" && (
                          <button
                            onClick={() => handleSubmitPO(po)}
                            className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg"
                          >
                            Submit
                          </button>
                        )}
                        {["Submitted", "Acknowledged"].includes(po.status) && (
                          <button
                            onClick={() => handleDelivered(po)}
                            className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg"
                          >
                            Delivered
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ))}

          {/* ── Vendors Tab ── */}
          {tab === "Vendors" && (
            <>
              <div className="flex justify-end">
                {canVendor && (
                  <button
                    onClick={() => openVendorAdd(false)}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Plus size={15} /> Add Vendor
                  </button>
                )}
              </div>
              {vendors.length === 0 ? (
                <EmptyState message="No vendors added" icon={ShoppingCart} />
              ) : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-left px-5 py-3">Contact</th>
                        <th className="text-left px-5 py-3">Category</th>
                        <th className="text-left px-5 py-3">Payment Terms</th>
                        <th className="text-left px-5 py-3">Country</th>
                        <th className="text-left px-5 py-3">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {vendors.map((v) => (
                        <tr key={v.vendor_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3">
                            <p className="font-medium text-gray-800">
                              {v.name}
                            </p>
                            <p className="text-xs text-gray-400">
                              {v.vendor_id}
                            </p>
                          </td>
                          <td className="px-5 py-3">
                            <p className="text-gray-600">
                              {v.contact_person ?? "—"}
                            </p>
                            <p className="text-xs text-gray-400">
                              {v.email ?? ""}
                            </p>
                          </td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {v.category ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {v.payment_terms ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {v.country}
                          </td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {v.phone ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Procurement Form Modal ── */}
      {showModal === "proc" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                {selected ? "Edit Procurement" : "New Procurement Request"}
              </h3>
              <button onClick={() => setShowModal(null)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleProcSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  className="input"
                  value={procForm.title}
                  onChange={(e) =>
                    setProcForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder="e.g. 2x Forklifts for Ahmadi Depot"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Type *
                  </label>
                  <select
                    className="input"
                    value={procForm.type}
                    onChange={(e) =>
                      setProcForm((f) => ({ ...f, type: e.target.value }))
                    }
                  >
                    <option value="Purchase">Purchase</option>
                    <option value="Lease">Lease</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority
                  </label>
                  <select
                    className="input"
                    value={procForm.priority}
                    onChange={(e) =>
                      setProcForm((f) => ({ ...f, priority: e.target.value }))
                    }
                  >
                    {["Low", "Normal", "High", "Urgent"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Vendor with inline add */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor
                </label>
                <div className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={procForm.vendor_id}
                    onChange={(e) =>
                      setProcForm((f) => ({ ...f, vendor_id: e.target.value }))
                    }
                  >
                    <option value="">Select vendor…</option>
                    {vendors.map((v) => (
                      <option key={v.vendor_id} value={v.vendor_id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => openVendorAdd(true)}
                    className="btn-secondary px-3 text-xs whitespace-nowrap flex items-center gap-1 shrink-0"
                  >
                    <Plus size={12} /> New Vendor
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Required By Date
                </label>
                <input
                  type="date"
                  className="input"
                  value={procForm.required_by_date}
                  onChange={(e) =>
                    setProcForm((f) => ({
                      ...f,
                      required_by_date: e.target.value,
                    }))
                  }
                />
              </div>

              {procForm.type === "Lease" && (
                <div className="grid grid-cols-3 gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">
                  <div>
                    <label className="block text-xs font-medium text-purple-700 mb-1">
                      Lease Start
                    </label>
                    <input
                      type="date"
                      className="input text-sm"
                      value={procForm.lease_start_date}
                      onChange={(e) =>
                        setProcForm((f) => ({
                          ...f,
                          lease_start_date: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-700 mb-1">
                      Lease End
                    </label>
                    <input
                      type="date"
                      className="input text-sm"
                      value={procForm.lease_end_date}
                      onChange={(e) =>
                        setProcForm((f) => ({
                          ...f,
                          lease_end_date: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-700 mb-1">
                      Monthly (KWD)
                    </label>
                    <input
                      type="number"
                      className="input text-sm"
                      value={procForm.lease_monthly_kwd}
                      onChange={(e) =>
                        setProcForm((f) => ({
                          ...f,
                          lease_monthly_kwd: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={procForm.description}
                  onChange={(e) =>
                    setProcForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={procForm.notes}
                  placeholder="Any additional notes…"
                  onChange={(e) =>
                    setProcForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>

              {/* Line items — fixed quantity visibility */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Items
                  </label>
                  <button
                    type="button"
                    onClick={addProcItem}
                    className="text-xs text-primary-500 hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Add Item
                  </button>
                </div>
                <div className="space-y-2">
                  {procItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50/50"
                    >
                      <div className="flex gap-2 items-start">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-5 gap-2">
                          {/* Equipment type */}
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">
                              Equipment Type
                            </label>
                            <select
                              className="input text-xs"
                              value={item.equipment_type_id}
                              onChange={(e) =>
                                setProcItem(
                                  idx,
                                  "equipment_type_id",
                                  e.target.value,
                                )
                              }
                            >
                              <option value="">Optional type…</option>
                              {eqTypes.map((t) => (
                                <option key={t.type_id} value={t.type_id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* Description */}
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">
                              Description *
                            </label>
                            <input
                              className="input text-xs"
                              placeholder="e.g. 50 Ton Forklift"
                              value={item.description}
                              onChange={(e) =>
                                setProcItem(idx, "description", e.target.value)
                              }
                              required
                            />
                          </div>
                          {/* Quantity — explicitly sized */}
                          <div className="sm:col-span-1">
                            <label className="block text-xs text-gray-500 mb-1">
                              Qty
                            </label>
                            <input
                              type="number"
                              min="1"
                              className="input text-xs text-center"
                              style={{ minWidth: "60px" }}
                              value={item.quantity}
                              onChange={(e) =>
                                setProcItem(idx, "quantity", e.target.value)
                              }
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProcItem(idx)}
                          className="text-red-400 hover:text-red-600 mt-5 shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {/* Unit + Price */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            Unit
                          </label>
                          <select
                            className="input text-xs"
                            value={item.unit}
                            onChange={(e) =>
                              setProcItem(idx, "unit", e.target.value)
                            }
                          >
                            {["Unit", "Set", "Lot", "Month", "Day"].map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            Unit Price (KWD)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="input text-xs"
                            placeholder="0.000"
                            value={item.unit_price_kwd}
                            onChange={(e) =>
                              setProcItem(idx, "unit_price_kwd", e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="text-right text-xs font-medium text-gray-500">
                        Line: KWD{" "}
                        {(
                          Number(item.quantity || 0) *
                          Number(item.unit_price_kwd || 0)
                        ).toLocaleString("en-US", { minimumFractionDigits: 3 })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-right mt-2 text-sm font-semibold text-gray-700 pr-1">
                  Total: KWD{" "}
                  {procTotal.toLocaleString("en-US", {
                    minimumFractionDigits: 3,
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Terms & Conditions
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={procForm.terms_conditions}
                  onChange={(e) =>
                    setProcForm((f) => ({
                      ...f,
                      terms_conditions: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="btn-primary flex items-center gap-2"
                >
                  {formLoading && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {formLoading
                    ? "Saving…"
                    : selected
                      ? "Update"
                      : "Create Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Receive Modal ── */}
      {showModal === "receive" && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Receive Procurement
                </h3>
                <p className="text-sm text-gray-400">
                  {selected.procurement_id} — {selected.title}
                </p>
              </div>
              <button onClick={() => setShowModal(null)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleReceive} className="p-5 space-y-4">
              <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
                <p className="font-medium mb-1">Confirming receipt will:</p>
                <ul className="text-xs space-y-0.5 list-disc list-inside text-blue-600">
                  <li>Update procurement status to Received</li>
                  <li>Add equipment units to the fleet</li>
                  <li>Mark linked PO as Delivered</li>
                </ul>
              </div>

              <div className="space-y-4">
                {receiveItems.map((item, idx) => (
                  <div
                    key={item.item_id}
                    className="border border-gray-100 rounded-xl p-4 bg-gray-50/30 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-800">
                        {item.description}
                      </p>
                      <span
                        className={clsx(
                          "badge border text-xs",
                          item.procurement_type === "Lease"
                            ? "bg-purple-50 text-purple-700 border-purple-100"
                            : "bg-blue-50 text-blue-700 border-blue-100",
                        )}
                      >
                        {item.procurement_type}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Received Qty (of {item.quantity})
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={item.quantity}
                          className="input text-sm"
                          value={item.received_qty}
                          onChange={(e) =>
                            setReceiveItems((items) =>
                              items.map((it, i) =>
                                i === idx
                                  ? {
                                      ...it,
                                      received_qty: Number(e.target.value),
                                    }
                                  : it,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Received Date
                        </label>
                        <input
                          type="date"
                          className="input text-sm"
                          value={item.received_date}
                          onChange={(e) =>
                            setReceiveItems((items) =>
                              items.map((it, i) =>
                                i === idx
                                  ? { ...it, received_date: e.target.value }
                                  : it,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Fleet Location
                        </label>
                        <input
                          className="input text-sm"
                          placeholder="e.g. Ahmadi Depot"
                          value={item.fleet_location}
                          onChange={(e) =>
                            setReceiveItems((items) =>
                              items.map((it, i) =>
                                i === idx
                                  ? { ...it, fleet_location: e.target.value }
                                  : it,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Type
                        </label>
                        <select
                          className="input text-sm"
                          value={item.procurement_type}
                          onChange={(e) =>
                            setReceiveItems((items) =>
                              items.map((it, i) =>
                                i === idx
                                  ? { ...it, procurement_type: e.target.value }
                                  : it,
                              ),
                            )
                          }
                        >
                          <option value="Purchase">Purchase</option>
                          <option value="Lease">Lease</option>
                        </select>
                      </div>
                      {item.procurement_type === "Lease" && (
                        <>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              Lease Start
                            </label>
                            <input
                              type="date"
                              className="input text-sm"
                              value={item.lease_start}
                              onChange={(e) =>
                                setReceiveItems((items) =>
                                  items.map((it, i) =>
                                    i === idx
                                      ? { ...it, lease_start: e.target.value }
                                      : it,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              Lease End
                            </label>
                            <input
                              type="date"
                              className="input text-sm"
                              value={item.lease_end}
                              onChange={(e) =>
                                setReceiveItems((items) =>
                                  items.map((it, i) =>
                                    i === idx
                                      ? { ...it, lease_end: e.target.value }
                                      : it,
                                  ),
                                )
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                    {!item.equipment_type_id && (
                      <p className="text-xs text-yellow-600 bg-yellow-50 px-3 py-2 rounded-lg">
                        ⚠ No equipment type linked — item will be marked
                        received but won't auto-add to fleet. Edit the
                        procurement item to link an equipment type.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="btn-primary flex items-center gap-2"
                >
                  {formLoading && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {formLoading
                    ? "Processing…"
                    : "Confirm Receipt & Add to Fleet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── PO Form Modal ── */}
      {showModal === "po" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                Create Purchase Order
              </h3>
              <button onClick={() => setShowModal(null)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <form onSubmit={handlePOSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor *
                </label>
                <select
                  className="input"
                  value={poForm.vendor_id}
                  onChange={(e) =>
                    setPoForm((f) => ({ ...f, vendor_id: e.target.value }))
                  }
                  required
                >
                  <option value="">Select vendor…</option>
                  {vendors.map((v) => (
                    <option key={v.vendor_id} value={v.vendor_id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Linked Procurement
                </label>
                <select
                  className="input"
                  value={poForm.procurement_id}
                  onChange={(e) => {
                    const p = procs.find(
                      (x) => x.procurement_id === e.target.value,
                    );
                    setPoForm((f) => ({
                      ...f,
                      procurement_id: e.target.value,
                      total_amount_kwd:
                        p?.total_amount_kwd ?? f.total_amount_kwd,
                      vendor_id: p?.vendor_id ?? f.vendor_id,
                    }));
                  }}
                >
                  <option value="">None</option>
                  {procs
                    .filter((p) => p.status === "Approved")
                    .map((p) => (
                      <option key={p.procurement_id} value={p.procurement_id}>
                        {p.procurement_id} — {p.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Issue Date
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={poForm.issue_date}
                    onChange={(e) =>
                      setPoForm((f) => ({ ...f, issue_date: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expected Delivery
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={poForm.expected_delivery}
                    onChange={(e) =>
                      setPoForm((f) => ({
                        ...f,
                        expected_delivery: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Total Amount (KWD) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="input"
                    value={poForm.total_amount_kwd}
                    onChange={(e) =>
                      setPoForm((f) => ({
                        ...f,
                        total_amount_kwd: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Shipping Address
                </label>
                <input
                  className="input"
                  value={poForm.shipping_address}
                  onChange={(e) =>
                    setPoForm((f) => ({
                      ...f,
                      shipping_address: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Terms & Conditions
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={poForm.terms_conditions}
                  onChange={(e) =>
                    setPoForm((f) => ({
                      ...f,
                      terms_conditions: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={poForm.notes}
                  onChange={(e) =>
                    setPoForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="btn-primary flex items-center gap-2"
                >
                  {formLoading && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {formLoading ? "Creating…" : "Create PO"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Vendor Modals ── */}
      {(showModal === "vendor" || showModal === "vendor-inline") && (
        <VendorModal />
      )}

      {/* ── PO Preview Popup ── */}
      {previewPO && <POPreview po={previewPO} />}

      {/* ── Procurement Preview Popup ── */}
      {previewProc && <ProcPreview proc={previewProc} />}
    </div>
  );
}
