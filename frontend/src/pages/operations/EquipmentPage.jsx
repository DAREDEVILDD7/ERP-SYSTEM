import { useEffect, useCallback, useState, useRef } from "react";
import { useRealtimeRefresh } from "../../hooks/useRealtimeRefresh";
import {
  getEquipmentUnitsWithProcurement,
  getEquipmentTypes,
  createEquipmentUnit,
  updateEquipmentUnit,
  retireEquipment,
  getSerialNumbersByType,
  confirmLeaseReturn,
  extendLease,
  getLeaseExtensions,
} from "../../api/equipment";
import { createLeaseInvoice } from "../../api/finance";
import { createMaintenanceJob } from "../../api/maintenance";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../lib/rolePermissions";
import { useAppStore } from "../../store/useAppStore";
import StatusBadge from "../../components/common/StatusBadge";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import EmptyState from "../../components/common/EmptyState";
import {
  Plus,
  Search,
  Package,
  RefreshCw,
  X,
  Loader2,
  Eye,
  Archive,
  Wrench,
  Calendar,
  RotateCcw,
  FileText,
  AlertTriangle,
  Clock,
  CheckCircle,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import clsx from "clsx";
import { createEquipmentType } from "../../api/equipment";

const EQ_TABLES = ['equipment_units','equipment_types','lease_extensions','lease_invoices'];

const ALL_STATUSES = [
  "Available",
  "Reserved",
  "Dispatched",
  "Maintenance",
  "Retired",
];
const STATUS_RING = {
  Available: "ring-green-300 bg-green-50 text-green-700",
  Reserved: "ring-yellow-300 bg-yellow-50 text-yellow-700",
  Dispatched: "ring-blue-300 bg-blue-50 text-blue-700",
  Maintenance: "ring-red-300 bg-red-50 text-red-700",
  Retired: "ring-gray-300 bg-gray-100 text-gray-500",
};
const ISSUE_TYPES = [
  "Mechanical",
  "Electrical",
  "Hydraulic",
  "Tyre",
  "Cooling",
  "Body",
  "Other",
];

export default function EquipmentPage() {
  const { profile, role, loading: authLoading } = useAuth();

  const {
    equipmentUnits,
    equipmentTypes,
    equipmentLoaded,
    equipmentFilters,
    setEquipmentUnits,
    setEquipmentTypes,
    setEquipmentFilters,
    clearEquipmentCache,
  } = useAppStore();

  const [loading, setLoading] = useState(!equipmentLoaded);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [viewRetired, setViewRetired] = useState(false);
  const [retireTarget, setRetireTarget] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [previewUnit, setPreviewUnit] = useState(null);

  // Maintenance issue modal — shown when status set to Maintenance
  const [maintenanceModal, setMaintenanceModal] = useState(null);
  const [maintenanceIssue, setMaintenanceIssue] = useState("");
  const [maintenanceType, setMaintenanceType] = useState("Mechanical");
  const [setPendingStatus] = useState(null);

  // New equipment type modal
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [newTypeForm, setNewTypeForm] = useState({
    name: "",
    category: "",
    description: "",
    default_capacity: "",
    default_daily_rate_kwd: "",
    manufacturer: "",
    unit: "Unit",
  });
  const [typeFormLoading, setTypeFormLoading] = useState(false);

  // Lease management state
  const [leaseTarget,       setLeaseTarget]       = useState(null);
  const [leaseModal,        setLeaseModal]        = useState(null); // 'return' | 'extend' | 'invoice'
  const [leaseActionLoading, setLeaseActionLoading] = useState(false);
  const [leaseReturnForm,   setLeaseReturnForm]   = useState({ notes: '', confirmed_at: '' });
  const [leaseExtendForm,   setLeaseExtendForm]   = useState({ new_end_date: '', notes: '', monthly_rate_kwd: '' });
  const [leaseInvoiceForm,  setLeaseInvoiceForm]  = useState({ period_start: '', period_end: '', amount_kwd: '', notes: '', status: 'Draft' });
  const [leaseExtensions,   setLeaseExtensions]   = useState([]);

  // Equipment type search state
  const [typeSearch, setTypeSearch] = useState("");
  const [showTypeSearch, setShowTypeSearch] = useState(false);

  // Serial number suggestions
  const [serialSuggestions, setSerialSuggestions] = useState([]);
  const [showSerialDrop, setShowSerialDrop] = useState(false);
  const serialRef = useRef(null);

  const [form, setForm] = useState({
    type_id: "",
    serial_number: "",
    capacity: "",
    status: "Available",
    location: "",
    daily_rate_kwd: "",
    year_of_manufacture: "",
    notes: "",
  });

  const { search, status: statusFilter, typeId: typeFilter } = equipmentFilters;
  const canWrite = hasPermission(role, "equipment_create");

  const load = useCallback(
    async (force = false) => {
      if (authLoading || !profile || !role) return;
      if (equipmentLoaded && !force) return;
      setLoading(true);
      try {
        const [u, t] = await Promise.all([
          getEquipmentUnitsWithProcurement(),
          getEquipmentTypes(),
        ]);
        setEquipmentUnits(u);
        setEquipmentTypes(t);
      } catch {
        toast.error("Failed to load equipment");
      } finally {
        setLoading(false);
      }
    },
    [authLoading, profile, role, equipmentLoaded, setEquipmentUnits, setEquipmentTypes],
  );

  useEffect(() => {
    load();
  }, [load]);

  const realtimeEquipLoad = useCallback(() => {
    clearEquipmentCache();
    load(true);
  }, [clearEquipmentCache, load]);
  useRealtimeRefresh(EQ_TABLES, realtimeEquipLoad);

  // Status counts from all units (unfiltered)
  const statusCounts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = equipmentUnits.filter((u) => u.status === s).length;
    return acc;
  }, {});

  // Equipment type search filter
  const filteredTypes = equipmentTypes.filter(
    (t) =>
      !typeSearch ||
      t.name.toLowerCase().includes(typeSearch.toLowerCase()) ||
      t.category?.toLowerCase().includes(typeSearch.toLowerCase()),
  );

  const handleCreateType = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!newTypeForm.name.trim()) return toast.error("Enter type name");
    setTypeFormLoading(true);
    try {
      const newType = await createEquipmentType(newTypeForm);
      const updatedTypes = await getEquipmentTypes();
      setEquipmentTypes(updatedTypes);
      setForm((f) => ({ ...f, type_id: newType.type_id }));
      setShowTypeModal(false);
      toast.success(`Equipment type "${newType.name}" created`);
    } catch (err) {
      toast.error(err.message || "Failed to create type");
    } finally {
      setTypeFormLoading(false);
    }
  };

  // Procured items count for card
  const procuredCount = equipmentUnits.filter((u) => u.procurement_id).length;

  // Filtering
  const allFiltered = equipmentUnits.filter((u) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      u.equipment_types?.name?.toLowerCase().includes(q) ||
      u.equipment_id?.toLowerCase().includes(q) ||
      u.serial_number?.toLowerCase().includes(q) ||
      u.location?.toLowerCase().includes(q) ||
      u.capacity?.toLowerCase().includes(q) ||
      u.status?.toLowerCase().includes(q) ||
      u.equipment_types?.category?.toLowerCase().includes(q) ||
      String(u.daily_rate_kwd)?.includes(q);
    const matchStatus =
      statusFilter === "All" || statusFilter === "procured"
        ? true
        : u.status === statusFilter;
    const matchProcured =
      statusFilter === "procured" ? !!u.procurement_id : true;
    const matchType = typeFilter === "All" || u.type_id === typeFilter;
    return matchSearch && matchStatus && matchProcured && matchType;
  });

  const activeFiltered = allFiltered.filter((u) => u.status !== "Retired");
  const retiredFiltered = allFiltered.filter((u) => u.status === "Retired");
  const procuredItems = allFiltered.filter((u) => u.procurement_id);

  const hasActiveFilters =
    statusFilter !== "All" || typeFilter !== "All" || search;

  const openAdd = () => {
    setForm({
      type_id: "",
      serial_number: "",
      capacity: "",
      status: "Available",
      location: "",
      daily_rate_kwd: "",
      year_of_manufacture: "",
      notes: "",
    });
    setSelected(null);
    setSerialSuggestions([]);
    setShowModal(true);
  };

  const openEdit = (unit) => {
    setForm({
      type_id: unit.type_id,
      serial_number: unit.serial_number ?? "",
      capacity: unit.capacity ?? "",
      status: unit.status,
      location: unit.location ?? "",
      daily_rate_kwd: unit.daily_rate_kwd,
      year_of_manufacture: unit.year_of_manufacture ?? "",
      notes: unit.notes ?? "",
    });
    setSelected(unit);
    setShowModal(true);
  };

  const handleTypeChange = async (typeId) => {
    setForm((f) => ({
      ...f,
      type_id: typeId,
      serial_number: "",
      capacity: "",
    }));
    if (typeId) {
      const serials = await getSerialNumbersByType(typeId);
      setSerialSuggestions(serials);
    } else {
      setSerialSuggestions([]);
    }
  };

  const handleSerialSelect = (suggestion) => {
    setForm((f) => ({
      ...f,
      serial_number: suggestion.serial_number,
      capacity: suggestion.capacity ?? f.capacity,
    }));
    setShowSerialDrop(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.type_id) return toast.error("Select equipment type");
    if (!form.daily_rate_kwd) return toast.error("Enter daily rate");
    setFormLoading(true);
    try {
      if (selected) {
        await updateEquipmentUnit(selected.equipment_id, form);
        toast.success("Equipment updated");
      } else {
        await createEquipmentUnit(form);
        toast.success("Equipment unit added");
      }
      setShowModal(false);
      clearEquipmentCache();
      load(true);
    } catch (err) {
      toast.error(err.message || "Failed");
    } finally {
      setFormLoading(false);
    }
  };

  // Handle status change — if setting to Maintenance, show issue modal first
  const handleStatusChange = async (unit, newStatus) => {
    if (newStatus === "Maintenance") {
      setMaintenanceModal(unit);
      setMaintenanceIssue("");
      setMaintenanceType("Mechanical");
      setPendingStatus(newStatus);
      return;
    }
    if (newStatus === "Retired") {
      setRetireTarget(unit);
      setRetireReason("");
      return;
    }
    try {
      await updateEquipmentUnit(unit.equipment_id, { status: newStatus });
      toast.success("Status updated");
      setEquipmentUnits(
        equipmentUnits.map((u) =>
          u.equipment_id === unit.equipment_id
            ? { ...u, status: newStatus }
            : u,
        ),
      );
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleMaintenanceConfirm = async () => {
    if (!maintenanceIssue.trim())
      return toast.error("Please describe the issue");
    setFormLoading(true);
    try {
      // Update equipment status (trigger will auto-create maintenance log)
      // But we update the notes to pass issue through — or create maintenance directly
      await updateEquipmentUnit(maintenanceModal.equipment_id, {
        status: "Maintenance",
      });
      // Create maintenance job with the issue
      await createMaintenanceJob({
        equipment_id: maintenanceModal.equipment_id,
        issue: maintenanceIssue,
        issue_type: maintenanceType,
        service_date: new Date().toISOString().split("T")[0],
        status: "Open",
        reported_by: profile.user_id,
        notes: `Status changed to Maintenance from Equipment Fleet`,
      });
      toast.success("Equipment set to Maintenance — job logged");
      setMaintenanceModal(null);
      clearEquipmentCache();
      load(true);
    } catch (err) {
      toast.error(err.message || "Failed");
    } finally {
      setFormLoading(false);
    }
  };

  const handleRetireConfirm = async () => {
    if (!retireReason.trim()) return toast.error("Enter retire reason");
    setRetiring(true);
    try {
      await retireEquipment(retireTarget.equipment_id, retireReason);
      toast.success("Equipment retired");
      setRetireTarget(null);
      setRetireReason("");
      clearEquipmentCache();
      load(true);
    } catch {
      toast.error("Failed to retire");
    } finally {
      setRetiring(false);
    }
  };

  // ── Lease helpers ──────────────────────────────────────────────────────────
  const getLeaseInfo = (u) => {
    if (u.procurement_type !== 'Lease' || !u.lease_end_date) return null;
    if (u.lease_returned_at) return { status: 'Returned', daysLeft: null, isExpired: false, isExpiring: false };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(u.lease_end_date); end.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((end - today) / 86400000);
    const isExpired  = daysLeft < 0;
    const isExpiring = !isExpired && daysLeft <= 14;
    const status = isExpired ? 'Expired' : isExpiring ? 'Expiring' : 'Active';
    return { status, daysLeft, isExpired, isExpiring };
  };

  const openLeaseAction = async (unit, action) => {
    setLeaseTarget(unit);
    setLeaseModal(action);
    if (action === 'return') {
      setLeaseReturnForm({ notes: '', confirmed_at: new Date().toISOString().split('T')[0] });
    } else if (action === 'extend') {
      setLeaseExtendForm({ new_end_date: unit.lease_end_date ?? '', notes: '', monthly_rate_kwd: '' });
      const exts = await getLeaseExtensions(unit.equipment_id).catch(() => []);
      setLeaseExtensions(exts);
    } else if (action === 'invoice') {
      const start = unit.lease_start_date ?? '';
      const end   = unit.lease_end_date   ?? '';
      // Auto-calculate amount from daily rate × days if both dates are set
      let autoAmount = '';
      if (start && end && unit.daily_rate_kwd) {
        const days = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
        autoAmount = (Number(unit.daily_rate_kwd) * days).toFixed(3);
      }
      setLeaseInvoiceForm({ period_start: start, period_end: end, amount_kwd: autoAmount, notes: '', status: 'Draft' });
    }
  };

  const handleLeaseReturn = async () => {
    if (!leaseTarget) return;
    setLeaseActionLoading(true);
    try {
      await confirmLeaseReturn(leaseTarget.equipment_id, leaseReturnForm, profile.user_id);
      toast.success('Lease return confirmed — equipment retired from fleet');
      setLeaseModal(null); setLeaseTarget(null);
      clearEquipmentCache(); load(true);
    } catch (err) {
      toast.error(err.message || 'Failed to confirm return');
    } finally { setLeaseActionLoading(false); }
  };

  const handleLeaseExtend = async () => {
    if (!leaseExtendForm.new_end_date) return toast.error('Select new end date');
    if (leaseTarget?.lease_end_date && leaseExtendForm.new_end_date <= leaseTarget.lease_end_date)
      return toast.error('New end date must be after current end date');
    setLeaseActionLoading(true);
    try {
      await extendLease(leaseTarget.equipment_id, {
        newEndDate:     leaseExtendForm.new_end_date,
        notes:          leaseExtendForm.notes,
        monthlyRateKwd: leaseExtendForm.monthly_rate_kwd,
      }, profile.user_id);
      toast.success('Lease extended successfully');
      setLeaseModal(null); setLeaseTarget(null);
      clearEquipmentCache(); load(true);
    } catch (err) {
      toast.error(err.message || 'Failed to extend lease');
    } finally { setLeaseActionLoading(false); }
  };

  const handleLeaseInvoice = async () => {
    if (!leaseInvoiceForm.period_start) return toast.error('Enter period start date');
    if (!leaseInvoiceForm.period_end)   return toast.error('Enter period end date');
    if (!leaseInvoiceForm.amount_kwd)   return toast.error('Enter invoice amount');
    if (leaseInvoiceForm.period_end < leaseInvoiceForm.period_start) return toast.error('Period end must be after period start');
    setLeaseActionLoading(true);
    try {
      await createLeaseInvoice({
        equipment_id:  leaseTarget.equipment_id,
        period_start:  leaseInvoiceForm.period_start,
        period_end:    leaseInvoiceForm.period_end,
        amount_kwd:    Number(leaseInvoiceForm.amount_kwd),
        notes:         leaseInvoiceForm.notes || null,
        status:        leaseInvoiceForm.status,
        created_by:    profile.user_id,
      });
      toast.success('Lease invoice created — visible in Finance → Lease Invoices');
      setLeaseModal(null); setLeaseTarget(null);
    } catch (err) {
      toast.error(err.message || 'Failed to create lease invoice');
    } finally { setLeaseActionLoading(false); }
  };

  const displayedUnits = viewRetired ? retiredFiltered : activeFiltered;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Equipment Fleet
          </h2>
          <p className="text-sm text-gray-400">
            {displayedUnits.length} shown · {equipmentUnits.length} total
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              clearEquipmentCache();
              load(true);
            }}
            className="btn-secondary p-2"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setViewRetired((v) => !v)}
            className={clsx(
              "btn-secondary flex items-center gap-2",
              viewRetired && "ring-2 ring-gray-300",
            )}
          >
            <Archive size={15} />{" "}
            {viewRetired
              ? "Active Fleet"
              : `Retired (${statusCounts["Retired"]})`}
          </button>
          {canWrite && (
            <button
              onClick={openAdd}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} /> Add Unit
            </button>
          )}
        </div>
      </div>

      {/* Status + Procured cards */}
      {!viewRetired && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {ALL_STATUSES.filter((s) => s !== "Retired").map((s) => (
            <button
              key={s}
              onClick={() =>
                setEquipmentFilters({ status: statusFilter === s ? "All" : s })
              }
              className={clsx(
                "card p-3 text-center transition-all ring-0 hover:shadow-md",
                statusFilter === s && `ring-2 ${STATUS_RING[s]}`,
              )}
            >
              <p className="text-2xl font-bold text-gray-800">
                {statusCounts[s]}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{s}</p>
            </button>
          ))}
          {/* Procured items card */}
          <button
            onClick={() =>
              setEquipmentFilters({
                status: statusFilter === "procured" ? "All" : "procured",
              })
            }
            className={clsx(
              "card p-3 text-center transition-all ring-0 hover:shadow-md",
              statusFilter === "procured" &&
                "ring-2 ring-indigo-300 bg-indigo-50 text-indigo-700",
            )}
          >
            <p className="text-2xl font-bold text-gray-800">{procuredCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">Procured</p>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              className="input pl-9"
              placeholder="Search by type, ID, serial, capacity, location, category…"
              value={search}
              onChange={(e) => setEquipmentFilters({ search: e.target.value })}
            />
            {search && (
              <button
                onClick={() => setEquipmentFilters({ search: "" })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            className="input w-48"
            value={typeFilter}
            onChange={(e) => setEquipmentFilters({ typeId: e.target.value })}
          >
            <option value="All">All Types</option>
            {equipmentTypes.map((t) => (
              <option key={t.type_id} value={t.type_id}>
                {t.name}
              </option>
            ))}
          </select>
          {!viewRetired && (
            <select
              className="input w-40"
              value={statusFilter}
              onChange={(e) => setEquipmentFilters({ status: e.target.value })}
            >
              <option value="All">All Statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          {hasActiveFilters && (
            <button
              onClick={() =>
                setEquipmentFilters({
                  search: "",
                  status: "All",
                  typeId: "All",
                })
              }
              className="btn-secondary text-xs px-3 whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Procured items banner */}
      {!viewRetired && procuredItems.length > 0 && (
        <div className="card p-4 bg-purple-50 border border-purple-100">
          <p className="text-sm font-medium text-purple-700 mb-2">
            🛒 {procuredItems.length} Procured Item
            {procuredItems.length !== 1 ? "s" : ""} in Fleet
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {procuredItems.slice(0, 4).map((u) => (
              <div
                key={u.equipment_id}
                className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-xs"
              >
                <span className="font-medium text-gray-700">
                  {u.equipment_types?.name} {u.capacity}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "badge border text-xs",
                      u.procurement_type === "Lease"
                        ? "bg-purple-50 text-purple-700 border-purple-100"
                        : "bg-blue-50 text-blue-700 border-blue-100",
                    )}
                  >
                    {u.procurement_type ?? "Purchase"}
                  </span>
                  <StatusBadge status={u.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner fullscreen={false} />
      ) : displayedUnits.length === 0 ? (
        <EmptyState
          message={
            viewRetired
              ? "No retired equipment"
              : "No equipment matches your search"
          }
          icon={Package}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-5 py-3">ID</th>
                    <th className="text-left px-5 py-3">Type</th>
                    <th className="text-left px-5 py-3">Serial</th>
                    <th className="text-left px-5 py-3">Capacity</th>
                    <th className="text-left px-5 py-3">Location</th>
                    <th className="text-left px-5 py-3">Rate/Day</th>
                    <th className="text-left px-5 py-3">Source</th>
                    <th className="text-left px-5 py-3">Return Date</th>
                    <th className="text-left px-5 py-3">Status</th>
                    {viewRetired && (
                      <th className="text-left px-5 py-3">Retire Reason</th>
                    )}
                    {canWrite && !viewRetired && (
                      <th className="text-left px-5 py-3">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayedUnits.map((u) => (
                    <tr
                      key={u.equipment_id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">
                        {u.equipment_id}
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">
                          {u.equipment_types?.name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {u.equipment_types?.category}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {u.serial_number ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        {u.capacity ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {u.location ?? "—"}
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-700">
                        KWD {Number(u.daily_rate_kwd).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {u.procurement_id ? (
                          <div className="space-y-1">
                            <span className={clsx('badge border text-xs', u.procurement_type === 'Lease' ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-blue-50 text-blue-700 border-blue-100')}>
                              {u.procurement_type ?? 'Purchase'}
                            </span>
                            {(() => {
                              const li = getLeaseInfo(u);
                              if (!li) return null;
                              if (li.status === 'Returned') return (
                                <p className="flex items-center gap-1 text-green-600">
                                  <CheckCircle size={10}/> Returned
                                </p>
                              );
                              if (li.isExpired) return (
                                <>
                                  <p className="text-gray-400">Until {format(new Date(u.lease_end_date),'dd MMM yy')}</p>
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md eq-pulse-red">
                                    <AlertTriangle size={9}/> Expired {Math.abs(li.daysLeft)}d ago
                                  </span>
                                </>
                              );
                              if (li.isExpiring) return (
                                <>
                                  <p className="text-gray-400">Until {format(new Date(u.lease_end_date),'dd MMM yy')}</p>
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-md eq-pulse-orange">
                                    <Clock size={9}/> {li.daysLeft}d left
                                  </span>
                                </>
                              );
                              return <p className="text-gray-400">Until {format(new Date(u.lease_end_date),'dd MMM yy')}</p>;
                            })()}
                          </div>
                        ) : (
                          <span className="text-gray-300">Own</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {u.expected_return_date ? (
                          <span className="text-orange-600 font-medium">
                            {format(
                              new Date(u.expected_return_date),
                              "dd MMM yyyy",
                            )}
                          </span>
                        ) : u.status === "Available" ? (
                          <span className="text-green-500">In yard</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={u.status} />
                      </td>
                      {viewRetired && (
                        <td className="px-5 py-3 text-xs text-gray-500 max-w-xs">
                          <p className="truncate">{u.retire_reason ?? "—"}</p>
                          {u.retire_date && (
                            <p className="text-gray-400">
                              {format(new Date(u.retire_date), "dd MMM yyyy")}
                            </p>
                          )}
                        </td>
                      )}
                      {canWrite && !viewRetired && (
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <select
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                              value={u.status}
                              onChange={(e) =>
                                handleStatusChange(u, e.target.value)
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ALL_STATUSES.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                            <button onClick={() => openEdit(u)} className="text-xs text-primary-500 hover:underline">
                              Edit
                            </button>
                            <button onClick={() => setPreviewUnit(u)} className="text-gray-400 hover:text-gray-600">
                              <Eye size={14} />
                            </button>
                            {/* Lease action buttons */}
                            {(() => {
                              const li = getLeaseInfo(u);
                              if (!li || li.status === 'Returned') return null;
                              return (
                                <div className="flex items-center gap-1 ml-1 pl-1 border-l border-gray-100">
                                  {(li.isExpired || li.status === 'Active' || li.isExpiring) && (
                                    <button title="Confirm Lease Return"
                                      onClick={() => openLeaseAction(u, 'return')}
                                      className="p-1 rounded-lg text-green-600 hover:bg-green-50 transition-colors">
                                      <RotateCcw size={13}/>
                                    </button>
                                  )}
                                  {!li.isExpired && (
                                    <button title="Extend Lease"
                                      onClick={() => openLeaseAction(u, 'extend')}
                                      className="p-1 rounded-lg text-orange-500 hover:bg-orange-50 transition-colors">
                                      <TrendingUp size={13}/>
                                    </button>
                                  )}
                                  <button title="Create Lease Invoice"
                                    onClick={() => openLeaseAction(u, 'invoice')}
                                    className="p-1 rounded-lg text-purple-500 hover:bg-purple-50 transition-colors">
                                    <FileText size={13}/>
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {displayedUnits.map((u) => (
              <div key={u.equipment_id} className="card p-4">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">
                    {u.equipment_types?.name}
                  </p>
                  <StatusBadge status={u.status} />
                </div>
                <p className="text-xs text-gray-400">
                  {u.equipment_id} · {u.serial_number ?? "—"} · {u.capacity}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {u.location ?? "—"} · KWD{" "}
                  {Number(u.daily_rate_kwd).toLocaleString()}/day
                </p>
                {u.expected_return_date && (
                  <p className="text-xs text-orange-600 mt-1 font-medium">
                    Return:{" "}
                    {format(new Date(u.expected_return_date), "dd MMM yyyy")}
                  </p>
                )}
                {/* Lease expiry badge for mobile */}
                {(() => {
                  const li = getLeaseInfo(u);
                  if (!li) return null;
                  if (li.status === 'Returned') return <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle size={10}/> Lease returned</p>;
                  if (li.isExpired) return (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md mt-1 eq-pulse-red">
                      <AlertTriangle size={9}/> Lease expired {Math.abs(li.daysLeft)}d ago
                    </span>
                  );
                  if (li.isExpiring) return (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md mt-1">
                      <Clock size={9}/> Lease expires in {li.daysLeft}d
                    </span>
                  );
                  return null;
                })()}
                {u.retire_reason && viewRetired && (
                  <p className="text-xs text-gray-400 mt-1">
                    Retired: {u.retire_reason}
                  </p>
                )}
                {canWrite && !viewRetired && (
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="flex gap-2">
                      <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 flex-1" value={u.status} onChange={(e) => handleStatusChange(u, e.target.value)}>
                        {ALL_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                      <button onClick={() => openEdit(u)} className="text-xs text-primary-500 hover:underline px-2">Edit</button>
                    </div>
                    {(() => {
                      const li = getLeaseInfo(u);
                      if (!li || li.status === 'Returned') return null;
                      return (
                        <div className="flex gap-1.5 flex-wrap">
                          {(li.isExpired || li.isExpiring || li.status === 'Active') && (
                            <button onClick={() => openLeaseAction(u, 'return')}
                              className="flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-lg">
                              <RotateCcw size={11}/> Return
                            </button>
                          )}
                          {!li.isExpired && (
                            <button onClick={() => openLeaseAction(u, 'extend')}
                              className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-lg">
                              <TrendingUp size={11}/> Extend
                            </button>
                          )}
                          <button onClick={() => openLeaseAction(u, 'invoice')}
                            className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-lg">
                            <FileText size={11}/> Invoice
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Add/Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                {selected ? "Edit Equipment Unit" : "Add Equipment Unit"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {/* Equipment Type with search + add new */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Equipment Type *
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    {/* Show selected type or search */}
                    <div
                      className="input flex items-center justify-between cursor-pointer"
                      onClick={() => setShowTypeSearch((v) => !v)}
                    >
                      <span
                        className={
                          form.type_id ? "text-gray-800" : "text-gray-400"
                        }
                      >
                        {form.type_id
                          ? (equipmentTypes.find(
                              (t) => t.type_id === form.type_id,
                            )?.name ?? "Unknown type")
                          : "Search and select type…"}
                      </span>
                      {form.type_id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setForm((f) => ({ ...f, type_id: "" }));
                          }}
                          className="text-gray-300 hover:text-gray-500 ml-2"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    {showTypeSearch && (
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
                              placeholder="Search equipment types…"
                              value={typeSearch}
                              onChange={(e) => setTypeSearch(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {filteredTypes.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-3">
                              No types found
                            </p>
                          ) : (
                            filteredTypes.map((t) => (
                              <button
                                key={t.type_id}
                                type="button"
                                onClick={() => {
                                  handleTypeChange(t.type_id);
                                  setShowTypeSearch(false);
                                  setTypeSearch("");
                                }}
                                className={clsx(
                                  "w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors",
                                  form.type_id === t.type_id && "bg-primary-50",
                                )}
                              >
                                <p className="font-medium text-gray-800">
                                  {t.name}
                                </p>
                                {t.category && (
                                  <p className="text-gray-400">{t.category}</p>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                        <div className="p-2 border-t border-gray-100">
                          <button
                            type="button"
                            onClick={() => {
                              setShowTypeSearch(false);
                              setShowTypeModal(true);
                            }}
                            className="w-full flex items-center gap-2 text-xs text-primary-600 hover:bg-primary-50 px-2 py-1.5 rounded-lg"
                          >
                            <Plus size={12} /> Add new equipment type
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Serial number with auto-suggest */}
              <div ref={serialRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Serial Number
                </label>
                <input
                  className="input"
                  placeholder={
                    serialSuggestions.length > 0
                      ? "Type or select existing serial…"
                      : "e.g. FLT-010 (new unit)"
                  }
                  value={form.serial_number}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, serial_number: e.target.value }));
                    setShowSerialDrop(true);
                  }}
                  onFocus={() => setShowSerialDrop(true)}
                  autoComplete="off"
                />

                {showSerialDrop && serialSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 overflow-hidden">
                    <p className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                      Existing serials for this type — select to add another
                      unit, or type a new one:
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                      {serialSuggestions
                        .filter(
                          (s) =>
                            !form.serial_number ||
                            s.serial_number
                              .toLowerCase()
                              .includes(form.serial_number.toLowerCase()),
                        )
                        .map((s) => (
                          <button
                            key={s.equipment_id}
                            type="button"
                            onClick={() => handleSerialSelect(s)}
                            className="w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0"
                          >
                            <span className="font-medium text-gray-700">
                              {s.serial_number}
                            </span>
                            {s.capacity && (
                              <span className="text-gray-400 ml-2">
                                · {s.capacity}
                              </span>
                            )}
                            <span className="text-gray-300 ml-2">
                              ({s.equipment_id})
                            </span>
                          </button>
                        ))}
                    </div>
                    <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
                      <button
                        type="button"
                        onClick={() => setShowSerialDrop(false)}
                        className="text-xs text-primary-500 hover:underline"
                      >
                        + This is a new serial number
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Capacity
                  </label>
                  <input
                    className="input"
                    value={form.capacity}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, capacity: e.target.value }))
                    }
                    placeholder="e.g. 50 Ton"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Daily Rate (KWD) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="input"
                    value={form.daily_rate_kwd}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, daily_rate_kwd: e.target.value }))
                    }
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Year of Manufacture
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={form.year_of_manufacture}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        year_of_manufacture: e.target.value,
                      }))
                    }
                    placeholder="e.g. 2020"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value }))
                    }
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  className="input"
                  value={form.location}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, location: e.target.value }))
                  }
                  placeholder="e.g. Ahmadi Depot"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  className="input resize-y"
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
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
                  {formLoading ? "Saving…" : selected ? "Update" : "Add Unit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Maintenance Issue Modal ── */}
      {maintenanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Wrench size={18} className="text-orange-500" /> Set Equipment to
              Maintenance
            </h3>
            <div className="bg-orange-50 rounded-xl p-3 text-sm text-orange-700">
              <p className="font-medium">
                {maintenanceModal.equipment_types?.name}{" "}
                {maintenanceModal.capacity}
              </p>
              <p className="text-xs text-orange-500 mt-0.5">
                {maintenanceModal.equipment_id}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issue Description *
              </label>
              <textarea
                className="input resize-y"
                rows={3}
                value={maintenanceIssue}
                onChange={(e) => setMaintenanceIssue(e.target.value)}
                placeholder="Describe the maintenance issue…"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issue Type
              </label>
              <select
                className="input"
                value={maintenanceType}
                onChange={(e) => setMaintenanceType(e.target.value)}
              >
                {ISSUE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setMaintenanceModal(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleMaintenanceConfirm}
                disabled={formLoading || !maintenanceIssue.trim()}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {formLoading && <Loader2 size={14} className="animate-spin" />}
                Confirm & Log Issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Retire Modal ── */}
      {retireTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Archive size={18} className="text-gray-500" /> Retire Equipment
            </h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">
                {retireTarget.equipment_types?.name} {retireTarget.capacity}
              </span>{" "}
              — {retireTarget.equipment_id}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Retirement <span className="text-red-500">*</span>
              </label>
              <textarea
                className="input resize-y"
                rows={3}
                value={retireReason}
                onChange={(e) => setRetireReason(e.target.value)}
                placeholder="e.g. End of service life, irreparable damage…"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRetireTarget(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleRetireConfirm}
                disabled={retiring || !retireReason.trim()}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {retiring && <Loader2 size={14} className="animate-spin" />}
                Confirm Retire
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unit Preview Modal ── */}
      {previewUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {previewUnit.equipment_id}
                </h3>
                <p className="text-sm text-gray-400">
                  {previewUnit.equipment_types?.name} · {previewUnit.capacity}
                </p>
              </div>
              <button
                onClick={() => setPreviewUnit(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Serial</p>
                  <p className="font-medium">
                    {previewUnit.serial_number ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Capacity</p>
                  <p className="font-medium">{previewUnit.capacity ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Location</p>
                  <p className="font-medium">{previewUnit.location ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Daily Rate</p>
                  <p className="font-medium">
                    KWD {Number(previewUnit.daily_rate_kwd).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Year</p>
                  <p className="font-medium">
                    {previewUnit.year_of_manufacture ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Status</p>
                  <StatusBadge status={previewUnit.status} />
                </div>
              </div>

              {previewUnit.procurement_id && (
                <div className="bg-purple-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-purple-600 mb-1">
                    Procurement Source
                  </p>
                  <p className="text-sm text-purple-800">
                    {previewUnit.procurements?.title}
                  </p>
                  <p className="text-xs text-purple-500">
                    {previewUnit.procurement_type ?? "Purchase"}
                    {previewUnit.procurement_type === "Lease" && previewUnit.lease_end_date &&
                      ` · Lease until ${format(new Date(previewUnit.lease_end_date), "dd MMM yyyy")}`}
                    {previewUnit.procurement_type === "Lease" && previewUnit.lease_start_date &&
                      ` (from ${format(new Date(previewUnit.lease_start_date), "dd MMM yyyy")})`}
                  </p>
                </div>
              )}

              {previewUnit.expected_return_date && (
                <div className="bg-orange-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-orange-600">
                    Expected Return
                  </p>
                  <p className="text-sm font-medium text-orange-700">
                    {format(
                      new Date(previewUnit.expected_return_date),
                      "dd MMM yyyy",
                    )}
                  </p>
                </div>
              )}

              {previewUnit.notes && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-gray-500">Notes</p>
                  <p className="text-sm text-gray-700 mt-0.5">
                    {previewUnit.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── Confirm Lease Return Modal ── */}
      {leaseModal === 'return' && leaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" style={{ animation: 'eqFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ animation: 'eqSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <RotateCcw size={17} className="text-green-500"/> Confirm Lease Return
              </h3>
              <button onClick={() => { setLeaseModal(null); setLeaseTarget(null); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Equipment info */}
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                <p className="text-sm font-semibold text-purple-800">{leaseTarget.equipment_types?.name} {leaseTarget.capacity}</p>
                <p className="text-xs text-purple-500 mt-0.5">{leaseTarget.equipment_id} · {leaseTarget.serial_number ?? '—'}</p>
                {leaseTarget.lease_end_date && (
                  <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                    <Calendar size={10}/> Lease end: {format(new Date(leaseTarget.lease_end_date), 'dd MMM yyyy')}
                    {getLeaseInfo(leaseTarget)?.isExpired && (
                      <span className="ml-1 text-red-600 font-medium">— Expired</span>
                    )}
                  </p>
                )}
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500"/>
                <span>Confirming this will <strong>retire the equipment from the fleet</strong> and record the return. The unit will no longer appear as active. This action cannot be undone.</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <Calendar size={13} className="text-primary-400"/> Return Date
                </label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                  <input type="date" className="input pl-9 eq-date"
                    value={leaseReturnForm.confirmed_at}
                    onChange={e => setLeaseReturnForm(f => ({...f, confirmed_at: e.target.value}))}/>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Return Notes</label>
                <textarea className="input resize-y" rows={2}
                  placeholder="Condition on return, any damages noted…"
                  value={leaseReturnForm.notes}
                  onChange={e => setLeaseReturnForm(f => ({...f, notes: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => { setLeaseModal(null); setLeaseTarget(null); }} className="btn-secondary">Cancel</button>
                <button onClick={handleLeaseReturn} disabled={leaseActionLoading}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors">
                  {leaseActionLoading ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
                  {leaseActionLoading ? 'Confirming…' : 'Confirm Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Extend Lease Modal ── */}
      {leaseModal === 'extend' && leaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" style={{ animation: 'eqFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ animation: 'eqSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <TrendingUp size={17} className="text-orange-500"/> Extend Lease Period
              </h3>
              <button onClick={() => { setLeaseModal(null); setLeaseTarget(null); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Equipment info */}
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                <p className="text-sm font-semibold text-orange-800">{leaseTarget.equipment_types?.name} {leaseTarget.capacity}</p>
                <p className="text-xs text-orange-500 mt-0.5">{leaseTarget.equipment_id} · {leaseTarget.serial_number ?? '—'}</p>
                {leaseTarget.lease_end_date && (
                  <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                    <Calendar size={10}/> Current end: <span className="font-semibold ml-1">{format(new Date(leaseTarget.lease_end_date), 'dd MMM yyyy')}</span>
                  </p>
                )}
              </div>

              {/* Previous extensions */}
              {leaseExtensions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Previous Extensions</p>
                  {leaseExtensions.map(ext => (
                    <div key={ext.extension_id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2" style={{ animation: 'eqPopIn 0.2s ease' }}>
                      <span className="text-gray-500 line-through">{ext.previous_end_date && format(new Date(ext.previous_end_date), 'dd MMM yyyy')}</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <span className="font-medium text-gray-700">{ext.new_end_date && format(new Date(ext.new_end_date), 'dd MMM yyyy')}</span>
                      {ext.extension_notes && <span className="text-gray-400 ml-2 truncate max-w-[100px]">{ext.extension_notes}</span>}
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New End Date <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-400 pointer-events-none"/>
                  <input type="date" className="input pl-9 eq-date"
                    min={leaseTarget.lease_end_date ?? undefined}
                    value={leaseExtendForm.new_end_date}
                    onChange={e => setLeaseExtendForm(f => ({...f, new_end_date: e.target.value}))}/>
                </div>
                {leaseExtendForm.new_end_date && leaseTarget.lease_end_date && leaseExtendForm.new_end_date > leaseTarget.lease_end_date && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle size={10}/>
                    Extended by {Math.ceil((new Date(leaseExtendForm.new_end_date) - new Date(leaseTarget.lease_end_date)) / 86400000)} days
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Monthly Rate (KWD) <span className="text-xs text-gray-400 font-normal">optional</span></label>
                <input type="number" min="0" step="0.001" className="input"
                  placeholder="Override monthly lease rate for extended period…"
                  value={leaseExtendForm.monthly_rate_kwd}
                  onChange={e => setLeaseExtendForm(f => ({...f, monthly_rate_kwd: e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Extension Notes</label>
                <textarea className="input resize-y" rows={2}
                  placeholder="Reason for extension, contract amendment reference…"
                  value={leaseExtendForm.notes}
                  onChange={e => setLeaseExtendForm(f => ({...f, notes: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => { setLeaseModal(null); setLeaseTarget(null); }} className="btn-secondary">Cancel</button>
                <button onClick={handleLeaseExtend} disabled={leaseActionLoading || !leaseExtendForm.new_end_date}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors">
                  {leaseActionLoading ? <Loader2 size={14} className="animate-spin"/> : <TrendingUp size={14}/>}
                  {leaseActionLoading ? 'Extending…' : 'Extend Lease'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Lease Invoice Modal ── */}
      {leaseModal === 'invoice' && leaseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" style={{ animation: 'eqFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ animation: 'eqSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={17} className="text-purple-500"/> Create Lease Invoice
              </h3>
              <button onClick={() => { setLeaseModal(null); setLeaseTarget(null); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Equipment info */}
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                <p className="text-sm font-semibold text-purple-800">{leaseTarget.equipment_types?.name} {leaseTarget.capacity}</p>
                <p className="text-xs text-purple-500 mt-0.5">{leaseTarget.equipment_id} · {leaseTarget.serial_number ?? '—'}</p>
                <p className="text-xs text-purple-600 mt-1">Daily Rate: KWD {Number(leaseTarget.daily_rate_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</p>
                {leaseTarget.procurements?.vendors?.name && (
                  <p className="text-xs text-purple-500 mt-0.5">Vendor: {leaseTarget.procurements.vendors.name}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Period Start <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none"/>
                    <input type="date" className="input pl-9 eq-date"
                      value={leaseInvoiceForm.period_start}
                      onChange={e => {
                        const start = e.target.value;
                        setLeaseInvoiceForm(f => {
                          const days = (start && f.period_end) ? Math.max(1, Math.ceil((new Date(f.period_end) - new Date(start)) / 86400000)) : null;
                          const auto = days && leaseTarget.daily_rate_kwd ? (Number(leaseTarget.daily_rate_kwd) * days).toFixed(3) : f.amount_kwd;
                          return {...f, period_start: start, amount_kwd: auto};
                        });
                      }}/>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Period End <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none"/>
                    <input type="date" className="input pl-9 eq-date"
                      value={leaseInvoiceForm.period_end}
                      onChange={e => {
                        const end = e.target.value;
                        setLeaseInvoiceForm(f => {
                          const days = (f.period_start && end) ? Math.max(1, Math.ceil((new Date(end) - new Date(f.period_start)) / 86400000)) : null;
                          const auto = days && leaseTarget.daily_rate_kwd ? (Number(leaseTarget.daily_rate_kwd) * days).toFixed(3) : f.amount_kwd;
                          return {...f, period_end: end, amount_kwd: auto};
                        });
                      }}/>
                  </div>
                </div>
              </div>

              {/* Day count */}
              {leaseInvoiceForm.period_start && leaseInvoiceForm.period_end && leaseInvoiceForm.period_end >= leaseInvoiceForm.period_start && (
                <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600 flex items-center justify-between" style={{ animation: 'eqPopIn 0.18s ease' }}>
                  <span>{Math.ceil((new Date(leaseInvoiceForm.period_end) - new Date(leaseInvoiceForm.period_start)) / 86400000)} days</span>
                  <span>× KWD {Number(leaseTarget.daily_rate_kwd).toLocaleString()} / day</span>
                  <span className="font-semibold text-purple-700">= KWD {leaseInvoiceForm.amount_kwd}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (KWD) <span className="text-red-500">*</span></label>
                <input type="number" min="0" step="0.001" className="input"
                  value={leaseInvoiceForm.amount_kwd}
                  onChange={e => setLeaseInvoiceForm(f => ({...f, amount_kwd: e.target.value}))}
                  placeholder="Auto-calculated or enter manually"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                  <select className="input" value={leaseInvoiceForm.status}
                    onChange={e => setLeaseInvoiceForm(f => ({...f, status: e.target.value}))}>
                    {['Draft','Sent','Paid','Cancelled'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <textarea className="input resize-y" rows={2}
                  placeholder="Invoice reference, payment terms…"
                  value={leaseInvoiceForm.notes}
                  onChange={e => setLeaseInvoiceForm(f => ({...f, notes: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => { setLeaseModal(null); setLeaseTarget(null); }} className="btn-secondary">Cancel</button>
                <button onClick={handleLeaseInvoice} disabled={leaseActionLoading}
                  className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors">
                  {leaseActionLoading ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>}
                  {leaseActionLoading ? 'Creating…' : 'Create Invoice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Equipment Type Modal ── */}
      {showTypeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                Add New Equipment Type
              </h3>
              <button
                onClick={() => setShowTypeModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateType} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type Name *{" "}
                  <span className="text-xs text-gray-400">
                    (must be unique)
                  </span>
                </label>
                <input
                  className="input"
                  value={newTypeForm.name}
                  onChange={(e) =>
                    setNewTypeForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Mini Excavator"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  <select
                    className="input"
                    value={newTypeForm.category}
                    onChange={(e) =>
                      setNewTypeForm((f) => ({
                        ...f,
                        category: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select…</option>
                    {[
                      "Crane",
                      "Material Handling",
                      "Lifting",
                      "Transport",
                      "Trailer",
                      "Tanker",
                      "Power",
                      "Other",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Capacity
                  </label>
                  <input
                    className="input"
                    value={newTypeForm.default_capacity}
                    onChange={(e) =>
                      setNewTypeForm((f) => ({
                        ...f,
                        default_capacity: e.target.value,
                      }))
                    }
                    placeholder="e.g. 50 Ton"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Daily Rate (KWD)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="input"
                    value={newTypeForm.default_daily_rate_kwd}
                    onChange={(e) =>
                      setNewTypeForm((f) => ({
                        ...f,
                        default_daily_rate_kwd: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Manufacturer
                  </label>
                  <input
                    className="input"
                    value={newTypeForm.manufacturer}
                    onChange={(e) =>
                      setNewTypeForm((f) => ({
                        ...f,
                        manufacturer: e.target.value,
                      }))
                    }
                    placeholder="e.g. Liebherr, Komatsu"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Unit
                  </label>
                  <select
                    className="input"
                    value={newTypeForm.unit}
                    onChange={(e) =>
                      setNewTypeForm((f) => ({ ...f, unit: e.target.value }))
                    }
                  >
                    {["Unit", "Set", "Fleet"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  className="input resize-y"
                  rows={2}
                  value={newTypeForm.description}
                  onChange={(e) =>
                    setNewTypeForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Brief description of this equipment type…"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowTypeModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={typeFormLoading}
                  className="btn-primary flex items-center gap-2"
                >
                  {typeFormLoading && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {typeFormLoading ? "Creating…" : "Create Type"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <style>{`
        @keyframes eqFadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes eqSlideUp { from { opacity:0; transform:translateY(18px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes eqPopIn   { from { opacity:0; transform:scale(0.93) } to { opacity:1; transform:scale(1) } }
        @keyframes eqPulseRed    { 0%,100% { opacity:1 } 50% { opacity:0.55 } }
        @keyframes eqPulseOrange { 0%,100% { opacity:1 } 50% { opacity:0.6 } }
        .eq-pulse-red    { animation: eqPulseRed    2s ease-in-out infinite; }
        .eq-pulse-orange { animation: eqPulseOrange 2.5s ease-in-out infinite; }
        .eq-date { color-scheme: light; }
        .eq-date::-webkit-calendar-picker-indicator {
          cursor: pointer; opacity: 0.45; margin-right: 2px;
          filter: invert(36%) sepia(75%) saturate(400%) hue-rotate(210deg);
        }
        .eq-date::-webkit-calendar-picker-indicator:hover { opacity: 0.9; }
        .eq-date:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,0.15); }
      `}</style>
    </div>
  );
}
