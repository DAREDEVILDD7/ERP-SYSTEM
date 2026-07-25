import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import {
  getDispatchesFast, createDispatch, updateDispatch, cancelDispatch,
  getApprovedQuotations, getDispatchableEquipment,
  dispatchItems, returnItems,
} from '../../api/dispatch';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import EmptyState from '../../components/common/EmptyState';
import {
  Plus, Truck, X, Loader2, RefreshCw, Search, Filter,
  ChevronDown, ChevronUp, CheckCircle,
  AlertTriangle, ArrowLeft, User, XCircle, Eye,
  RotateCcw, SendHorizonal, Calendar, Check, Pencil, Users, ClipboardList,
  MapPin, Package, Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUSES = ['All','Pending','Assigned','In Transit','Completed','Returned','Cancelled'];
const DISPATCH_TABLES = ['dispatches','dispatch_items','equipment_units'];

const STATUS_COLORS = {
  Pending:      'bg-yellow-50 text-yellow-700 border-yellow-200',
  Assigned:     'bg-blue-50 text-blue-700 border-blue-200',
  'In Transit': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Completed:    'bg-green-50 text-green-700 border-green-200',
  Returned:     'bg-gray-50 text-gray-600 border-gray-200',
  Cancelled:    'bg-red-50 text-red-600 border-red-200',
};

// Left sidebar border colours per status — use inline style (avoids Tailwind JIT purge)
const STATUS_SIDEBAR = {
  Pending:      { color: '#fb923c', r: 251, g: 146, b: 60  },
  Assigned:     { color: '#3b82f6', r: 59,  g: 130, b: 246 },
  'In Transit': { color: '#6366f1', r: 99,  g: 102, b: 241 },
  Completed:    { color: '#22c55e', r: 34,  g: 197, b: 94  },
  Returned:     { color: '#9ca3af', r: 156, g: 163, b: 175 },
  Cancelled:    { color: '#f87171', r: 248, g: 113, b: 113 },
};

// Sk is re-exported from shared Skeleton.jsx for use in this file
function Sk({ className = '', style }) {
  return <div className={clsx('sk rounded', className)} style={style}/>;
}

function EquipmentImage({ typeId, imageUrl, typeName, className = '', contain = false }) {
  const [failed, setFailed] = useState(false);
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;

  const src = imageUrl ||
    (typeId && supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/equipment-images/types/${typeId}.jpg`
      : null);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={clsx('flex flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200', className)}>
        <Truck size={22} className="text-gray-300" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={typeName || 'Equipment'}
      className={clsx(contain ? 'object-contain' : 'object-cover', className)}
      onError={() => setFailed(true)}
    />
  );
}

export default function DispatchManagePage() {
  const { profile, role, loading: authLoading } = useAuth();
  const location = useLocation();

  const [dispatches,   setDispatches]   = useState([]);
  const [quotations,   setQuotations]   = useState([]);
  const [allEquipment, setAllEquipment] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm,     setShowForm]     = useState(false);
  const [expandedId,   setExpandedId]   = useState(null);
  const [previewQuote, setPreviewQuote] = useState(null);
  const [selectedDispatchId, setSelectedDispatchId] = useState(null);
  const [ongoingPage,       setOngoingPage]       = useState(0);
  const [hoveredDot,        setHoveredDot]        = useState(null);
  const [exitingMap,        setExitingMap]        = useState(new Map()); // id → dispatch snapshot
  const [pageLoading,       setPageLoading]       = useState(true);
  const [loadError,         setLoadError]         = useState(false);

  // Search + filter state
  const [search,       setSearch]       = useState('');
  const [showFilters,  setShowFilters]  = useState(false);
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [destSearch,   setDestSearch]   = useState('');

  // New dispatch form
  const [form,          setForm]          = useState({ quotation_id:'', driver_name:'', vehicle_type:'', vehicle_plate:'', destination:'', dispatch_date:'', return_date:'', notes:'', status:'Pending' });
  const [selectedEqIds, setSelectedEqIds] = useState([]);
  const [formLoading,   setFormLoading]   = useState(false);
  const [quoteSearch,   setQuoteSearch]   = useState('');
  const [eqSearch,      setEqSearch]      = useState('');
  const [selectedQuote, setSelectedQuote] = useState(null);

  // Multi-select for bulk assign
  const [selectedDispatchIds, setSelectedDispatchIds] = useState(new Set());
  const [showBulkAssign,      setShowBulkAssign]      = useState(false);
  const [bulkAssignForm,      setBulkAssignForm]      = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'' });
  const [bulkPerNotes,        setBulkPerNotes]        = useState({});
  const [bulkAssigning,       setBulkAssigning]       = useState(false);

  // Inline notes editing
  const [editingNotesId,  setEditingNotesId]  = useState(null);
  const [notesEditValue,  setNotesEditValue]  = useState('');
  const [savingNotes,     setSavingNotes]     = useState(false);

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling,   setCancelling]   = useState(false);

  // Assign modal
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignForm,   setAssignForm]   = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'', notes:'' });
  const [assigning,    setAssigning]    = useState(false);

  // Dispatch Items modal
  const [dispatchItemsModal, setDispatchItemsModal] = useState(null);
  const [selectedItemIds,    setSelectedItemIds]    = useState([]);
  const [dispatchingItems,   setDispatchingItems]   = useState(false);
  const [driverMode,         setDriverMode]         = useState('shared');
  const [sharedDriver,       setSharedDriver]       = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'' });
  const [perItemDrivers,     setPerItemDrivers]     = useState({});

  // Return Items modal
  const [returnModal,    setReturnModal]    = useState(null);
  const [returnSelects,  setReturnSelects]  = useState([]);
  const [returning,      setReturning]      = useState(false);
  const [returnDriver,   setReturnDriver]   = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'' });

  const canWrite = hasPermission(role, 'dispatch_create');

  const load = useCallback(async (silent = false) => {
    if (authLoading || !profile || !role) return;
    if (!silent) setPageLoading(true);
    try {
      const [d, q, e] = await Promise.all([
        getDispatchesFast(),
        getApprovedQuotations(),
        getDispatchableEquipment(),
      ]);
      setDispatches(d);
      setQuotations(q);
      setAllEquipment(e);
      setLoadError(false);
    } catch (err) {
      toast.error('Failed to load dispatch data');
      console.error(err);
      setLoadError(true);
    } finally {
      setPageLoading(false);
    }
  }, [authLoading, profile, role]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(DISPATCH_TABLES, () => load(true));

  useEffect(() => {
    if (location.state?.openId) {
      setSelectedDispatchId(location.state.openId);
      setExpandedId(location.state.openId);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = dispatches.filter(d => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      d.dispatch_id?.toLowerCase().includes(q) ||
      d.quotation_id?.toLowerCase().includes(q) ||
      d.quotations?.customers?.company_name?.toLowerCase().includes(q) ||
      d.driver_name?.toLowerCase().includes(q) ||
      d.destination?.toLowerCase().includes(q);
    const matchDriver  = !driverSearch || d.driver_name?.toLowerCase().includes(driverSearch.toLowerCase());
    const matchDest    = !destSearch   || d.destination?.toLowerCase().includes(destSearch.toLowerCase());
    const matchStatus  = statusFilter === 'All' || d.status === statusFilter;
    const matchFrom    = !dateFrom || (d.dispatch_date ?? '') >= dateFrom;
    const matchTo      = !dateTo   || (d.dispatch_date ?? '') <= dateTo;
    return matchSearch && matchDriver && matchDest && matchStatus && matchFrom && matchTo;
  });

  const hasActiveFilters = dateFrom || dateTo || driverSearch || destSearch;

  // ── New dispatch form ─────────────────────────────────────────────────────
  const handleQuoteSelect = (qId) => {
    const q = quotations.find(q => q.quotation_id === qId);
    setSelectedQuote(q ?? null);
    setForm(f => ({ ...f, quotation_id: qId, destination: q?.requirements?.location ?? f.destination }));
    if (q?.quotation_items) {
      const avail  = q.quotation_items.filter(i => i.equipment_id && i.equipment_units?.status === 'Available').map(i => i.equipment_id);
      const starts = q.quotation_items.filter(i => i.rental_start_date).map(i => i.rental_start_date);
      const ends   = q.quotation_items.filter(i => i.rental_end_date).map(i => i.rental_end_date);
      setSelectedEqIds(avail);
      if (starts.length > 0) setForm(f => ({ ...f, dispatch_date: starts[0] }));
      if (ends.length > 0)   setForm(f => ({ ...f, return_date: ends[ends.length - 1] }));
    }
  };

  const toggleEquipment = (eqId) =>
    setSelectedEqIds(prev => prev.includes(eqId) ? prev.filter(id => id !== eqId) : [...prev, eqId]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (selectedEqIds.length === 0) return toast.error('Select at least one equipment item');
    if (!form.destination.trim())   return toast.error('Enter destination');
    setFormLoading(true);
    const errors = [];
    let created = 0;
    try {
      for (const eqId of selectedEqIds) {
        try {
          await createDispatch({
            ...form,
            assigned_by:   profile.user_id,
            quotation_id:  form.quotation_id || null,
            equipment_id:  eqId,
            dispatch_type: 'Full',
          }, [eqId]);
          created++;
        } catch (itemErr) {
          console.error('[handleSave] Dispatch failed for equipment', eqId, itemErr);
          errors.push(eqId);
        }
      }
      if (errors.length === 0) {
        toast.success(`${created} dispatch order${created !== 1 ? 's' : ''} created`);
      } else if (created > 0) {
        toast(`${created} dispatch${created !== 1 ? 'es' : ''} created · ${errors.length} failed`, { icon: '⚠️' });
      } else {
        throw new Error(`All ${errors.length} dispatch orders failed`);
      }
      setShowForm(false);
      resetForm();
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to create dispatches');
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ quotation_id:'', driver_name:'', vehicle_type:'', vehicle_plate:'', destination:'', dispatch_date:'', return_date:'', notes:'', status:'Pending' });
    setSelectedEqIds([]); setSelectedQuote(null); setQuoteSearch(''); setEqSearch('');
  };

  // ── Multi-select helpers ──────────────────────────────────────────────────
  const toggleDispatchSelect = (id) => {
    setSelectedDispatchIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredPendingIds = filtered.filter(d => d.status === 'Pending').map(d => d.dispatch_id);
  const allPendingSelected = filteredPendingIds.length > 0 && filteredPendingIds.every(id => selectedDispatchIds.has(id));

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedDispatchIds(new Set());
    } else {
      setSelectedDispatchIds(new Set(filteredPendingIds));
    }
  };

  const clearSelection = () => setSelectedDispatchIds(new Set());

  // ── Bulk Assign ───────────────────────────────────────────────────────────
  const handleBulkAssign = async () => {
    if (!bulkAssignForm.driver_name.trim()) return toast.error('Enter driver name');
    const ids = [...selectedDispatchIds];
    setBulkAssigning(true);
    let succeeded = 0;
    const errors = [];
    for (const id of ids) {
      try {
        const dispatch = dispatches.find(d => d.dispatch_id === id);
        if (!dispatch || dispatch.status !== 'Pending') continue;
        await updateDispatch(id, {
          status:        'Assigned',
          driver_name:   bulkAssignForm.driver_name,
          vehicle_type:  bulkAssignForm.vehicle_type  || null,
          vehicle_plate: bulkAssignForm.vehicle_plate || null,
          notes:         bulkPerNotes[id] || dispatch.notes || null,
          assigned_by:   profile.user_id,
        });
        succeeded++;
      } catch (err) {
        console.error('[handleBulkAssign] Failed for dispatch', id, err);
        errors.push(id);
      }
    }
    setBulkAssigning(false);
    if (errors.length === 0) {
      toast.success(`${succeeded} dispatch${succeeded !== 1 ? 'es' : ''} assigned to ${bulkAssignForm.driver_name}`);
    } else if (succeeded > 0) {
      toast(`${succeeded} assigned · ${errors.length} failed`, { icon: '⚠️' });
    } else {
      toast.error(`Failed to assign all ${errors.length} dispatches`);
    }
    setSelectedDispatchIds(new Set());
    setShowBulkAssign(false);
    setBulkAssignForm({ driver_name:'', vehicle_type:'', vehicle_plate:'' });
    setBulkPerNotes({});
    load();
  };

  // ── Inline Notes Save ─────────────────────────────────────────────────────
  const saveNotes = async (dispatchId) => {
    setSavingNotes(true);
    try {
      await updateDispatch(dispatchId, { notes: notesEditValue.trim() || null });
      toast.success('Notes saved');
      setEditingNotesId(null);
      load();
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!cancelReason.trim()) return toast.error('Please enter a reason');
    setCancelling(true);
    try {
      await cancelDispatch(cancelTarget.dispatch_id, cancelReason, profile.user_id);
      toast.success('Dispatch cancelled');
      setCancelTarget(null); setCancelReason('');
      load();
    } catch { toast.error('Failed to cancel');
    } finally { setCancelling(false); }
  };

  // ── Assign ────────────────────────────────────────────────────────────────
  const handleAssign = async () => {
    if (!assignForm.driver_name.trim()) return toast.error('Enter driver name');
    setAssigning(true);
    try {
      await updateDispatch(assignTarget.dispatch_id, {
        status:        'Assigned',
        driver_name:   assignForm.driver_name,
        vehicle_type:  assignForm.vehicle_type,
        vehicle_plate: assignForm.vehicle_plate,
        notes:         assignForm.notes,
        assigned_by:   profile.user_id,
      });
      toast.success('Dispatch assigned');
      setAssignTarget(null);
      setAssignForm({ driver_name:'', vehicle_type:'', vehicle_plate:'', notes:'' });
      load();
    } catch { toast.error('Failed to assign');
    } finally { setAssigning(false); }
  };

  // ── Dispatch Items ────────────────────────────────────────────────────────
  const openDispatchItems = (dispatch) => {
    const pendingItems = (dispatch.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending');
    if (pendingItems.length === 0) return toast.error('No pending items to dispatch');
    setDispatchItemsModal(dispatch);
    setSelectedItemIds(pendingItems.map(i => i.item_id));
    setDriverMode('shared');
    setSharedDriver({ driver_name: dispatch.driver_name ?? '', vehicle_type: dispatch.vehicle_type ?? '', vehicle_plate: dispatch.vehicle_plate ?? '' });
    setPerItemDrivers({});
  };

  const handleDispatchItems = async () => {
    if (selectedItemIds.length === 0) return toast.error('Select at least one item to dispatch');
    setDispatchingItems(true);
    try {
      const totalItems  = dispatchItemsModal.dispatch_items?.length ?? 0;
      const pendingCount = (dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').length;
      const driverInfo = driverMode === 'shared'
        ? {
            driver_name:   sharedDriver.driver_name   || dispatchItemsModal.driver_name,
            vehicle_type:  sharedDriver.vehicle_type  || dispatchItemsModal.vehicle_type,
            vehicle_plate: sharedDriver.vehicle_plate || dispatchItemsModal.vehicle_plate,
            total_items:   totalItems,
          }
        : {
            total_items: totalItems,
            driver_name:   perItemDrivers[selectedItemIds[0]]?.driver_name   || dispatchItemsModal.driver_name || '',
            vehicle_type:  perItemDrivers[selectedItemIds[0]]?.vehicle_type  || dispatchItemsModal.vehicle_type || '',
            vehicle_plate: perItemDrivers[selectedItemIds[0]]?.vehicle_plate || dispatchItemsModal.vehicle_plate || '',
          };

      await dispatchItems(dispatchItemsModal.dispatch_id, selectedItemIds, driverInfo);
      toast.success(
        selectedItemIds.length === pendingCount
          ? `All ${selectedItemIds.length} item(s) dispatched`
          : `${selectedItemIds.length} of ${pendingCount} item(s) dispatched (partial dispatch)`
      );
      const exitId   = dispatchItemsModal.dispatch_id;
      const exitSnap = { ...dispatchItemsModal }; // freeze current data so animation survives a silent reload
      setDispatchItemsModal(null); setSelectedItemIds([]);
      setSharedDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' }); setPerItemDrivers({});
      setExitingMap(prev => new Map([...prev, [exitId, exitSnap]]));
      setTimeout(() => {
        // animation finished — drop snapshot and deselect if still selected
        setExitingMap(prev => { const m = new Map(prev); m.delete(exitId); return m; });
        setSelectedDispatchId(cur => cur === exitId ? null : cur);
        // no load() here — useRealtimeRefresh fires load(true) silently when dispatch_items change
      }, 680);
    } catch (err) { toast.error(err.message || 'Failed to dispatch items');
    } finally { setDispatchingItems(false); }
  };

  // ── Return Items ──────────────────────────────────────────────────────────
  const openReturnItems = (dispatch) => {
    const dispatchedItems = (dispatch.dispatch_items ?? []).filter(i => i.dispatch_status === 'Dispatched');
    if (dispatchedItems.length === 0) return toast.error('No dispatched items to return');
    setReturnModal(dispatch);
    setReturnSelects(dispatchedItems.map(i => ({
      item_id:              i.item_id,
      equipment_id:         i.equipment_id,
      equipment_name:       `${i.equipment_units?.equipment_types?.name ?? ''} ${i.equipment_units?.capacity ?? ''}`.trim(),
      serial:               i.equipment_units?.serial_number ?? '',
      selected:             true,
      return_notes:         '',
      extended_return_date: '',
    })));
    setReturnDriver({ driver_name: dispatch.driver_name ?? '', vehicle_type: dispatch.vehicle_type ?? '', vehicle_plate: '' });
  };

  const handleReturnItems = async () => {
    const toReturn = returnSelects.filter(r => r.selected);
    if (toReturn.length === 0) return toast.error('Select at least one item to return');
    setReturning(true);
    try {
      await returnItems(
        returnModal.dispatch_id,
        toReturn.map(r => ({ item_id: r.item_id, return_notes: r.return_notes, extended_return_date: r.extended_return_date || null })),
        profile.user_id
      );
      if (returnDriver.driver_name?.trim()) {
        try {
          await updateDispatch(returnModal.dispatch_id, {
            driver_name:   returnDriver.driver_name,
            vehicle_type:  returnDriver.vehicle_type  || returnModal.vehicle_type,
            vehicle_plate: returnDriver.vehicle_plate || returnModal.vehicle_plate,
          });
        } catch (driverErr) {
          console.warn('[handleReturnItems] Failed to update return driver info:', driverErr);
        }
      }
      const notReturned   = returnSelects.filter(r => !r.selected);
      const extendedItems = toReturn.filter(r => r.extended_return_date);
      let msg = `${toReturn.length} item(s) returned`;
      if (notReturned.length > 0)   msg += ` · ${notReturned.length} still outstanding`;
      if (extendedItems.length > 0) msg += ` · ${extendedItems.length} with extended dates`;
      toast.success(msg);
      setReturnModal(null); setReturnSelects([]);
      setReturnDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' });
      load();
    } catch (err) { toast.error(err.message || 'Failed to process returns');
    } finally { setReturning(false); }
  };

  // ── Form view ─────────────────────────────────────────────────────────────
  if (showForm) {
    const filteredQuotes = quotations.filter(q => {
      if (!quoteSearch) return true;
      const s = quoteSearch.toLowerCase();
      return q.quotation_id?.toLowerCase().includes(s) ||
        q.customers?.company_name?.toLowerCase().includes(s) ||
        q.requirements?.requirement_summary?.toLowerCase().includes(s);
    });

    const filteredEquipment = allEquipment.filter(e => {
      if (!eqSearch) return true;
      const s = eqSearch.toLowerCase();
      return e.equipment_types?.name?.toLowerCase().includes(s) ||
        e.equipment_id?.toLowerCase().includes(s) ||
        e.serial_number?.toLowerCase().includes(s) ||
        e.capacity?.toLowerCase().includes(s) ||
        e.location?.toLowerCase().includes(s);
    });

    const quoteEquipment = selectedQuote?.quotation_items?.filter(i => i.equipment_id) ?? [];

    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary p-2"><ArrowLeft size={16}/></button>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">New Dispatch</h2>
            <p className="text-sm text-gray-400">Link to an approved quotation and select equipment</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs flex items-center justify-center font-bold">1</span>
              Link to Approved Quotation (optional)
            </h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-9" placeholder="Search by quote ID, customer, or requirement…"
                value={quoteSearch} onChange={e => setQuoteSearch(e.target.value)}/>
            </div>

            {quoteSearch && (
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {filteredQuotes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No approved quotations found</p>
                ) : filteredQuotes.map(q => (
                  <button key={q.quotation_id} type="button"
                    onClick={() => { handleQuoteSelect(q.quotation_id); setQuoteSearch(''); }}
                    className={clsx('w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0',
                      form.quotation_id === q.quotation_id && 'bg-primary-50')}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{q.customers?.company_name}</p>
                        <p className="text-xs text-gray-400">{q.quotation_id} · {q.requirements?.requirement_summary?.slice(0,50)}</p>
                        {q.approver && <p className="text-xs text-green-600">Approved by: {q.approver.name}</p>}
                      </div>
                      <span className="text-sm font-semibold text-gray-600 ml-4">KWD {Number(q.total_amount_kwd).toLocaleString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedQuote && (
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-green-800">{selectedQuote.quotation_id} — {selectedQuote.customers?.company_name}</p>
                    <p className="text-xs text-green-600 mt-0.5">{selectedQuote.requirements?.requirement_summary}</p>
                    {selectedQuote.approver && (
                      <p className="text-xs text-green-500 mt-0.5 flex items-center gap-1"><User size={11}/> Approved by: {selectedQuote.approver.name}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => { setSelectedQuote(null); setForm(f => ({...f, quotation_id:''})); setSelectedEqIds([]); }}>
                    <X size={16} className="text-green-400"/>
                  </button>
                </div>
                {quoteEquipment.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-green-700 mb-2">Equipment in quotation:</p>
                    {quoteEquipment.map(item => {
                      const isAvail    = item.equipment_units?.status === 'Available';
                      const isSelected = selectedEqIds.includes(item.equipment_id);
                      return (
                        <div key={item.item_id} className={clsx('flex items-center justify-between px-3 py-2 rounded-lg text-xs', isAvail ? 'bg-white' : 'bg-red-50')}>
                          <div className="flex items-center gap-2">
                            {isAvail ? <CheckCircle size={12} className="text-green-500"/> : <AlertTriangle size={12} className="text-red-500"/>}
                            <span className="font-medium text-gray-700">{item.equipment_units?.equipment_types?.name} {item.equipment_units?.capacity}</span>
                            <span className="text-gray-400">{item.equipment_id}</span>
                            {!isAvail && <span className="text-red-500">({item.equipment_units?.status})</span>}
                            {item.rental_start_date && <span className="text-gray-400">· {item.rental_start_date} → {item.rental_end_date}</span>}
                          </div>
                          {isAvail && (
                            <button type="button" onClick={() => toggleEquipment(item.equipment_id)}
                              className={clsx('px-2 py-0.5 rounded text-xs font-medium',
                                isSelected ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600')}>
                              {isSelected ? '✓ Selected' : 'Select'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs flex items-center justify-center font-bold">2</span>
              Select Equipment
              {selectedEqIds.length > 0 && (
                <span className="ml-auto text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full font-medium">{selectedEqIds.length} selected</span>
              )}
            </h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-9" placeholder="Search available equipment…" value={eqSearch} onChange={e => setEqSearch(e.target.value)}/>
            </div>
            <div className="border border-gray-100 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              {filteredEquipment.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No available equipment</p>
              ) : filteredEquipment.map(eq => {
                const isSelected = selectedEqIds.includes(eq.equipment_id);
                const isReserved = eq.status === 'Reserved';
                return (
                  <button key={eq.equipment_id} type="button"
                    onClick={() => toggleEquipment(eq.equipment_id)}
                    className={clsx('w-full flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0 transition-colors text-left',
                      isSelected ? 'bg-primary-50' : isReserved ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50')}>
                    <div className="flex items-center gap-3">
                      <div className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                        isSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300')}>
                        {isSelected && <CheckCircle size={12} className="text-white"/>}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{eq.equipment_types?.name} {eq.capacity}</p>
                        <p className="text-xs text-gray-400">{eq.equipment_id} · {eq.serial_number ?? 'No serial'} · {eq.location ?? '—'}</p>
                      </div>
                    </div>
                    <StatusBadge status={eq.status}/>
                  </button>
                );
              })}
            </div>
            {selectedEqIds.length > 0 && (
              <div className="bg-primary-50 rounded-xl p-3 space-y-1">
                <p className="text-xs font-semibold text-primary-700 mb-2">Selected ({selectedEqIds.length} items):</p>
                {selectedEqIds.map(id => {
                  const eq = allEquipment.find(e => e.equipment_id === id)
                    || quoteEquipment.find(i => i.equipment_id === id)?.equipment_units;
                  return (
                    <div key={id} className="flex items-center justify-between text-xs">
                      <span className="text-primary-800">{eq?.equipment_types?.name ?? 'Unknown'} {eq?.capacity} — {id}</span>
                      <button type="button" onClick={() => toggleEquipment(id)} className="text-primary-400 hover:text-primary-600"><X size={12}/></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs flex items-center justify-center font-bold">3</span>
              Dispatch Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destination *</label>
                <input className="input" placeholder="e.g. Ahmadi Refinery Gate 3" value={form.destination}
                  onChange={e => setForm(f => ({...f,destination:e.target.value}))} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
                <input className="input" value={form.driver_name} onChange={e => setForm(f => ({...f,driver_name:e.target.value}))} placeholder="Full name"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                <input className="input" value={form.vehicle_type} onChange={e => setForm(f => ({...f,vehicle_type:e.target.value}))} placeholder="e.g. Flatbed Trailer"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Plate</label>
                <input className="input" value={form.vehicle_plate} onChange={e => setForm(f => ({...f,vehicle_plate:e.target.value}))} placeholder="e.g. KWI 12345"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
                <input type="date" className="input" value={form.dispatch_date} onChange={e => setForm(f => ({...f,dispatch_date:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Return</label>
                <input type="date" className="input" value={form.return_date} onChange={e => setForm(f => ({...f,return_date:e.target.value}))}/>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea className="input resize-y" rows={2} value={form.notes} onChange={e => setForm(f => ({...f,notes:e.target.value}))}/>
            </div>
          </div>

          <div className="flex justify-end gap-3 pb-6">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={formLoading || selectedEqIds.length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {formLoading && <Loader2 size={15} className="animate-spin"/>}
              {formLoading
                ? `Creating ${selectedEqIds.length} dispatch order${selectedEqIds.length !== 1 ? 's' : ''}…`
                : `Create ${selectedEqIds.length} Dispatch Order${selectedEqIds.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const statsTotal     = dispatches.length;
  const statsPending   = dispatches.filter(d => d.status === 'Pending').length;
  const statsActive    = dispatches.filter(d => ['Assigned','In Transit'].includes(d.status)).length;
  const statsCompleted = dispatches.filter(d => ['Completed','Returned'].includes(d.status)).length;

  const ongoingDispatches = dispatches.filter(d => ['Pending','Assigned','In Transit'].includes(d.status));

  const sel = selectedDispatchId
    ? dispatches.find(d => d.dispatch_id === selectedDispatchId)
    : ongoingDispatches[0] ?? null;

  const selEq = sel ? (() => {
    const type = sel.dispatch_items?.[0]?.equipment_units?.equipment_types;
    const unit = sel.dispatch_items?.[0]?.equipment_units;
    return { typeId: type?.type_id ?? null, typeName: type?.name ?? null, imageUrl: type?.image_url ?? null, serial: unit?.serial_number ?? null, capacity: unit?.capacity ?? null };
  })() : null;

  const selPendingItems    = (sel?.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending');
  const selDispatchedItems = (sel?.dispatch_items ?? []).filter(i => i.dispatch_status === 'Dispatched');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dispatch Dashboard</h2>
          <p className="text-sm text-gray-400">{dispatches.length} total dispatches</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16}/></button>
          {canWrite && (
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16}/> New Dispatch
            </button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {pageLoading ? (
          [0,1,2,3].map(i => (
            <div key={i} className="card p-4 flex items-center justify-between gap-2">
              <div className="space-y-2">
                <Sk className="h-3 w-28"/>
                <Sk className="h-8 w-12"/>
              </div>
              <Sk className="h-11 w-11 rounded-xl shrink-0"/>
            </div>
          ))
        ) : (
          [
            { label: 'Total dispatches:',    value: statsTotal,     icon: Package,     numColor: 'text-gray-800',   iconBg: 'bg-gray-100',   iconColor: 'text-gray-500'   },
            { label: 'Pickup packages:',     value: statsActive,    icon: Truck,       numColor: 'text-blue-600',   iconBg: 'bg-blue-50',    iconColor: 'text-blue-400'   },
            { label: 'Pending packages:',    value: statsPending,   icon: Clock,       numColor: 'text-orange-500', iconBg: 'bg-orange-50',  iconColor: 'text-orange-400' },
            { label: 'Packages delivered:',  value: statsCompleted, icon: CheckCircle, numColor: 'text-green-600',  iconBg: 'bg-green-50',   iconColor: 'text-green-500'  },
          ].map(({ label, value, icon: Icon, numColor, iconBg, iconColor }) => (
            <div key={label} className="card p-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className={clsx('text-3xl font-bold tabular-nums leading-none', numColor)}>{value}</p>
              </div>
              <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
                <Icon size={20} className={iconColor}/>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Ongoing Delivery */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Left: Ongoing dispatch list — first 5 + expand, stretches to grid row height */}
        <div className="lg:col-span-2 card overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 shrink-0 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Ongoing Delivery</h3>
            {!pageLoading && !loadError && ongoingDispatches.length > 0 && (
              <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                {ongoingDispatches.length}
              </span>
            )}
          </div>

          {pageLoading ? (
            <div className="divide-y divide-gray-100">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="px-4 py-3.5 border-l-4 border-l-transparent">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-2">
                      <Sk className="h-2.5 w-16"/>
                      <Sk className="h-4 w-36"/>
                      <div className="flex gap-1.5">
                        <Sk className="h-5 w-24 rounded-full"/>
                        <Sk className="h-5 w-20 rounded-full"/>
                        <Sk className="h-5 w-14 rounded-full"/>
                      </div>
                      <div className="flex items-center gap-2 pt-0.5">
                        <Sk className="h-3 w-14"/>
                        <Sk className="h-3 w-3"/>
                        <Sk className="h-3 w-20"/>
                      </div>
                    </div>
                    <Sk className="h-16 w-28 rounded-xl shrink-0"/>
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-14 text-center px-4">
              <AlertTriangle size={36} className="text-red-200 mb-2"/>
              <p className="text-sm text-red-400 font-medium">Failed to load dispatches</p>
              <p className="text-xs text-gray-400 mt-1">Check your connection and try again</p>
              <button
                type="button"
                onClick={() => load()}
                className="mt-4 text-xs font-medium text-blue-500 hover:text-blue-700 underline underline-offset-2 transition-colors">
                Retry
              </button>
            </div>
          ) : ongoingDispatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Truck size={36} className="text-gray-200 mb-2"/>
              <p className="text-sm text-gray-400">No active dispatches</p>
            </div>
          ) : (
            (() => {
              const OG_PAGE_SIZE = 5;
              const totalPages   = Math.ceil(ongoingDispatches.length / OG_PAGE_SIZE);
              const safePage     = Math.min(ongoingPage, Math.max(0, totalPages - 1));
              const pageItems    = ongoingDispatches.slice(safePage * OG_PAGE_SIZE, (safePage + 1) * OG_PAGE_SIZE);

              // Snapshots that are animating out but were removed from dispatches by a silent reload —
              // keep them in the render list so the animation always plays to completion.
              const exitingOnly  = [...exitingMap.values()].filter(
                d => !pageItems.some(p => p.dispatch_id === d.dispatch_id)
              );
              const renderItems  = [...pageItems, ...exitingOnly];

              return (
                <>
                  <div className="divide-y divide-gray-100 flex-1">
                    {renderItems.map(d => {
                      const type    = d.dispatch_items?.[0]?.equipment_units?.equipment_types;
                      const unit    = d.dispatch_items?.[0]?.equipment_units;
                      const isSel   = sel?.dispatch_id === d.dispatch_id;
                      const exiting = exitingMap.has(d.dispatch_id);
                      return (
                        <div key={d.dispatch_id} className={exiting ? 'dm-swipe-out' : undefined}>
                          <button type="button"
                            onClick={() => setSelectedDispatchId(d.dispatch_id)}
                            className={clsx(
                              'w-full text-left px-4 py-3.5 border-l-4 transition-all duration-200',
                              isSel ? '' : 'hover:bg-gray-50/80'
                            )}
                            style={(() => {
                              const s = STATUS_SIDEBAR[d.status] ?? { color: '#d1d5db', r: 209, g: 213, b: 219 };
                              return isSel ? {
                                borderLeftColor: s.color,
                                backgroundColor: `rgba(${s.r},${s.g},${s.b},0.07)`,
                                boxShadow: `inset 0 0 0 1px rgba(${s.r},${s.g},${s.b},0.2), inset 0 0 28px rgba(${s.r},${s.g},${s.b},0.10)`,
                              } : {
                                borderLeftColor: 'transparent',
                              };
                            })()}>
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] text-gray-400 mb-0.5">Dispatch ID:</p>
                                <p className="font-bold text-gray-900 text-sm leading-tight truncate">{d.dispatch_id}</p>
                                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                  {type?.name && (
                                    <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{type.name}{unit?.capacity ? ` · ${unit.capacity}` : ''}</span>
                                  )}
                                  {d.quotations?.customers?.company_name && (
                                    <span className="text-[11px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">{d.quotations.customers.company_name}</span>
                                  )}
                                  <StatusBadge status={d.status}/>
                                </div>
                                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-500">
                                  <span>🇰🇼 Kuwait</span>
                                  <span className="text-gray-300">→</span>
                                  <span className="text-gray-700 font-medium truncate">🏢 {d.destination}</span>
                                </div>
                              </div>
                              <EquipmentImage
                                typeId={type?.type_id}
                                imageUrl={type?.image_url}
                                typeName={type?.name}
                                contain
                                className="h-16 w-28 rounded-xl bg-gray-100 shrink-0"/>
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Dot pagination */}
                  {totalPages > 1 && (() => {
                    // Windowed algorithm: always show first + last, window of current±1, ellipsis gaps
                    const buildItems = () => {
                      if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
                      const left  = Math.max(1, safePage - 1);
                      const right = Math.min(totalPages - 2, safePage + 1);
                      const out   = [0];
                      if (left > 1)              out.push('left-dot');
                      for (let i = left; i <= right; i++) out.push(i);
                      if (right < totalPages - 2) out.push('right-dot');
                      out.push(totalPages - 1);
                      return out;
                    };
                    const items = buildItems();

                    return (
                      <div
                        className="flex items-center justify-center border-t border-gray-100 shrink-0"
                        style={{ padding: '9px 12px', gap: '5px', overflowX: 'auto', scrollbarWidth: 'none' }}>
                        {items.map((item) => {
                          /* ── Ellipsis button ── */
                          if (item === 'left-dot' || item === 'right-dot') {
                            const isLeft = item === 'left-dot';
                            const target = isLeft
                              ? Math.max(0, safePage - 3)
                              : Math.min(totalPages - 1, safePage + 3);
                            return (
                              <button
                                key={item}
                                type="button"
                                onMouseEnter={() => setHoveredDot(null)}
                                onClick={() => setOngoingPage(target)}
                                style={{
                                  width: 22, height: 22,
                                  borderRadius: '50%',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0, border: 'none', cursor: 'pointer',
                                  backgroundColor: 'transparent',
                                  transition: 'background-color 0.15s',
                                }}
                                onMouseLeave={() => setHoveredDot(null)}
                                className="hover:bg-gray-100">
                                <span style={{ fontSize: 9, fontWeight: 800, color: '#9ca3af', letterSpacing: '0.5px', userSelect: 'none', pointerEvents: 'none' }}>···</span>
                              </button>
                            );
                          }

                          /* ── Page dot ── */
                          const isActive = item === safePage;
                          const dist     = hoveredDot !== null ? item - hoveredDot : null;
                          const scale    = dist === 0 ? 1.75 : 1;
                          const tx       = dist === null ? 0 : dist === -1 ? -3 : dist === 1 ? 3 : 0;
                          return (
                            <button
                              key={item}
                              type="button"
                              onMouseEnter={() => setHoveredDot(item)}
                              onMouseLeave={() => setHoveredDot(null)}
                              onClick={() => setOngoingPage(item)}
                              style={{
                                width: 22, height: 22,
                                borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                                transform: `translateX(${tx}px) scale(${scale})`,
                                transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background-color 0.15s',
                                backgroundColor: isActive ? '#3b82f6' : hoveredDot === item ? '#bfdbfe' : '#e5e7eb',
                                zIndex: dist === 0 ? 10 : 1,
                                position: 'relative',
                                border: 'none',
                                cursor: 'pointer',
                              }}>
                              <span style={{
                                fontSize: 9,
                                fontWeight: 700,
                                lineHeight: 1,
                                color: isActive ? '#fff' : '#6b7280',
                                userSelect: 'none',
                                pointerEvents: 'none',
                              }}>{item + 1}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              );
            })()
          )}
        </div>

        {/* Right: Detail panel — stretches to match left panel height */}
        <div className="lg:col-span-3 card overflow-hidden flex flex-col">
          {pageLoading ? (
            <>
              {/* Header skeleton */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-3">
                  <Sk className="h-4 w-28"/>
                  <Sk className="h-3 w-3 rounded-full"/>
                  <Sk className="h-3 w-16"/>
                </div>
                <Sk className="h-5 w-5 rounded"/>
              </div>
              {/* Hero image skeleton */}
              <Sk className="h-44 rounded-none shrink-0"/>
              {/* Info strip skeleton */}
              <div className="flex divide-x divide-gray-100 border-b border-gray-100 shrink-0">
                {[0,1,2,3].map(i => (
                  <div key={i} className="flex-1 px-4 py-3 space-y-2">
                    <Sk className="h-2.5 w-12"/>
                    <div className="flex items-center gap-2">
                      {i === 0 && <Sk className="h-8 w-8 rounded-full shrink-0"/>}
                      <div className="space-y-1.5 flex-1">
                        <Sk className="h-3.5 w-20"/>
                        <Sk className="h-2.5 w-14"/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Timeline skeleton */}
              <div className="px-5 py-4 border-b border-gray-100 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="text-center space-y-1.5">
                    <Sk className="h-2.5 w-20 mx-auto"/>
                    <Sk className="h-3 w-3 rounded-full mx-auto"/>
                  </div>
                  <Sk className="flex-1 h-1.5"/>
                  <div className="text-center space-y-1.5">
                    <Sk className="h-2.5 w-20 mx-auto"/>
                    <Sk className="h-3 w-3 rounded-full mx-auto"/>
                  </div>
                </div>
                <Sk className="h-2.5 w-48 mx-auto"/>
              </div>
              {/* Buttons skeleton */}
              <div className="px-5 py-3 flex gap-2">
                <Sk className="h-9 w-32 rounded-lg"/>
                <Sk className="h-9 w-24 rounded-lg"/>
              </div>
            </>
          ) : !sel ? (
            <div className="flex flex-col items-center justify-center flex-1 py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                <Package size={28} className="text-gray-300"/>
              </div>
              <p className="text-sm font-medium text-gray-400">Select a dispatch to view details</p>
              <p className="text-xs text-gray-300 mt-1">Click any dispatch on the left</p>
            </div>
          ) : (
            <>
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm">Dispatch Details</span>
                  <span className={clsx('w-2 h-2 rounded-full',
                    sel.status === 'In Transit' ? 'bg-blue-500' :
                    sel.status === 'Assigned'   ? 'bg-blue-400' :
                    sel.status === 'Pending'    ? 'bg-orange-400' :
                    sel.status === 'Completed'  ? 'bg-green-500' : 'bg-gray-400'
                  )}/>
                  <span className={clsx('text-sm font-medium',
                    sel.status === 'In Transit' ? 'text-blue-600' :
                    sel.status === 'Assigned'   ? 'text-blue-500' :
                    sel.status === 'Pending'    ? 'text-orange-500' :
                    sel.status === 'Completed'  ? 'text-green-600' : 'text-gray-500'
                  )}>{sel.status}</span>
                </div>
                <button type="button" onClick={() => setSelectedDispatchId(null)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
                  <X size={15}/>
                </button>
              </div>

              {/* Equipment image */}
              <div className="relative h-44 bg-gray-900 overflow-hidden shrink-0">
                <EquipmentImage
                  typeId={selEq?.typeId}
                  imageUrl={selEq?.imageUrl}
                  typeName={selEq?.typeName}
                  contain
                  className="w-full h-full rounded-none"/>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
                  <p className="text-white font-bold text-base leading-tight">
                    {selEq?.typeName || 'Equipment'}{selEq?.capacity ? ` · ${selEq.capacity}` : ''}
                  </p>
                  {selEq?.serial && <p className="text-white/60 text-xs font-mono mt-0.5">{selEq.serial}</p>}
                </div>
              </div>

              {/* Info strip — Driver | Tracking | Equipment | Destination */}
              <div className="flex items-start gap-0 border-b border-gray-100 shrink-0 divide-x divide-gray-100">
                {/* Driver */}
                <div className="flex-1 px-4 py-3 min-w-0">
                  <p className="text-[11px] text-gray-400 mb-1.5">Driver</p>
                  {sel.driver_name ? (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <User size={13} className="text-blue-500"/>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{sel.driver_name}</p>
                        {sel.vehicle_plate && <p className="text-[11px] text-gray-400 truncate">{sel.vehicle_plate}</p>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Unassigned</p>
                  )}
                </div>
                {/* Tracking number */}
                <div className="flex-1 px-4 py-3 min-w-0">
                  <p className="text-[11px] text-gray-400 mb-1.5">Tracking number</p>
                  <p className="text-xs font-mono font-semibold text-gray-800 truncate">{sel.dispatch_id}</p>
                  {sel.quotation_id && (
                    <button type="button" onClick={() => setPreviewQuote(sel.quotations)}
                      className="text-[11px] text-blue-500 hover:underline flex items-center gap-0.5 mt-0.5">
                      <Eye size={9}/> {sel.quotation_id}
                    </button>
                  )}
                </div>
                {/* Equipment type */}
                <div className="flex-1 px-4 py-3 min-w-0">
                  <p className="text-[11px] text-gray-400 mb-1.5">Equipment</p>
                  <p className="text-sm font-semibold text-gray-800 truncate">{selEq?.typeName ?? '—'}</p>
                  {selEq?.capacity && <p className="text-[11px] text-gray-400">{selEq.capacity}</p>}
                </div>
                {/* Destination */}
                <div className="flex-1 px-4 py-3 min-w-0">
                  <p className="text-[11px] text-gray-400 mb-1.5">Destination</p>
                  <p className="text-sm font-semibold text-gray-800 truncate flex items-center gap-1">
                    <MapPin size={11} className="text-gray-400 shrink-0"/>{sel.destination}
                  </p>
                  {sel.quotations?.customers?.company_name && (
                    <p className="text-[11px] text-gray-400 truncate mt-0.5">{sel.quotations.customers.company_name}</p>
                  )}
                </div>
              </div>

              {/* Date timeline */}
              <div className="px-5 py-3 border-b border-gray-100 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="text-center shrink-0">
                    <p className="text-[11px] text-gray-400 mb-1">{sel.dispatch_date ? format(new Date(sel.dispatch_date), 'MMM d, yyyy') : '—'}</p>
                    <div className="w-3 h-3 rounded-full bg-blue-500 mx-auto"/>
                  </div>
                  <div className="flex-1 relative h-1 bg-gray-100 rounded-full overflow-hidden">
                    {(sel.dispatch_items?.length ?? 0) > 0 && (
                      <div className="absolute inset-y-0 left-0 rounded-full bg-blue-400 transition-all"
                        style={{ width: `${Math.max(
                          ((sel.dispatch_items.filter(i => i.dispatch_status !== 'Pending').length) / sel.dispatch_items.length) * 100,
                          sel.status === 'Completed' || sel.status === 'Returned' ? 100 : 0
                        )}%` }}/>
                    )}
                  </div>
                  <div className="text-center shrink-0">
                    <p className="text-[11px] text-gray-400 mb-1">{sel.return_date ? format(new Date(sel.return_date), 'MMM d, yyyy') : '—'}</p>
                    <div className={clsx('w-3 h-3 rounded-full mx-auto',
                      sel.status === 'Completed' || sel.status === 'Returned' ? 'bg-green-500' : 'bg-gray-200')}/>
                  </div>
                </div>
                {(sel.dispatch_items?.length ?? 0) > 0 && (
                  <p className="text-[11px] text-gray-400 mt-2 text-center">
                    {sel.dispatch_items.filter(i => i.dispatch_status === 'Returned').length} returned ·{' '}
                    {sel.dispatch_items.filter(i => i.dispatch_status === 'Dispatched').length} in transit ·{' '}
                    {sel.dispatch_items.filter(i => i.dispatch_status === 'Pending').length} pending
                  </p>
                )}
              </div>

              {/* Action buttons + notes */}
              <div className="px-5 py-3 flex-1 flex flex-col justify-between gap-3">
                {sel.notes && (
                  <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
                    <span className="font-medium">Notes:</span> {sel.notes}
                  </p>
                )}
                {canWrite && (
                  <div className="flex gap-2 flex-wrap">
                    {sel.status === 'Pending' && (
                      <button
                        onClick={() => { setAssignTarget(sel); setAssignForm({ driver_name: sel.driver_name??'', vehicle_type: sel.vehicle_type??'', vehicle_plate: sel.vehicle_plate??'', notes: sel.notes??'' }); }}
                        className="btn-primary flex items-center gap-1.5 text-sm">
                        <User size={13}/> Assign Driver
                      </button>
                    )}
                    {['Assigned','In Transit'].includes(sel.status) && selPendingItems.length > 0 && (
                      <button onClick={() => openDispatchItems(sel)}
                        className="flex items-center gap-1.5 text-sm bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 transition-colors">
                        <SendHorizonal size={13}/> Dispatch Items
                      </button>
                    )}
                    {['Assigned','In Transit','Completed'].includes(sel.status) && selDispatchedItems.length > 0 && (
                      <button onClick={() => openReturnItems(sel)}
                        className="flex items-center gap-1.5 text-sm bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors">
                        <RotateCcw size={13}/> Return Items
                      </button>
                    )}
                    {!['Cancelled','Returned'].includes(sel.status) && (
                      <button onClick={() => { setCancelTarget(sel); setCancelReason(''); }}
                        className="flex items-center gap-1.5 text-sm bg-red-50 text-red-500 border border-red-100 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
                        <XCircle size={13}/> Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Track Order */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              Track Order
              <span className="text-xs font-normal text-gray-400">({filtered.length})</span>
            </h3>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {STATUSES.map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={clsx('px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                    statusFilter === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-9 text-sm"
                placeholder="Search dispatch ID, customer, driver, destination…"
                value={search} onChange={e => setSearch(e.target.value)}/>
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={13}/></button>}
            </div>
            <button onClick={() => setShowFilters(v => !v)}
              className={clsx('btn-secondary flex items-center gap-1.5 text-sm', hasActiveFilters && 'ring-2 ring-primary-300')}>
              <Filter size={14}/> Filters
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-100">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Driver</label>
                <input className="input text-sm" placeholder="Filter…" value={driverSearch} onChange={e => setDriverSearch(e.target.value)}/>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Destination</label>
                <input className="input text-sm" placeholder="Filter…" value={destSearch} onChange={e => setDestSearch(e.target.value)}/>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From Date</label>
                <input type="date" className="input text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)}/>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To Date</label>
                <input type="date" className="input text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)}/>
              </div>
              {hasActiveFilters && (
                <div className="col-span-2 sm:col-span-4 flex justify-end">
                  <button onClick={() => { setDateFrom(''); setDateTo(''); setDriverSearch(''); setDestSearch(''); }}
                    className="text-xs text-red-400 hover:underline">Clear filters</button>
                </div>
              )}
            </div>
          )}
        </div>

        {pageLoading ? (
          <>
            {/* Desktop table skeleton */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    {[40,100,120,140,120,100,120,90,80,80].map((w,i) => (
                      <th key={i} className="px-4 py-3"><Sk className="h-3" style={{ width: w }}/></th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[0,1,2,3,4,5,6,7].map(i => (
                    <tr key={i}>
                      <td className="px-4 py-3.5"><Sk className="h-4 w-4 rounded"/></td>
                      <td className="px-4 py-3.5"><div className="flex items-center gap-2"><Sk className="h-9 w-9 rounded-lg shrink-0"/><div className="space-y-1.5"><Sk className="h-3 w-24"/><Sk className="h-2.5 w-16"/></div></div></td>
                      <td className="px-4 py-3.5"><div className="space-y-1"><Sk className="h-3 w-32"/><Sk className="h-2.5 w-20"/></div></td>
                      <td className="px-4 py-3.5"><Sk className="h-3 w-24"/></td>
                      <td className="px-4 py-3.5"><Sk className="h-3 w-20"/></td>
                      <td className="px-4 py-3.5"><Sk className="h-3 w-28"/></td>
                      <td className="px-4 py-3.5"><div className="space-y-1.5"><Sk className="h-2.5 w-16"/><Sk className="h-2.5 w-16"/></div></td>
                      <td className="px-4 py-3.5"><Sk className="h-4 w-16 rounded-full"/></td>
                      <td className="px-4 py-3.5"><Sk className="h-4 w-16 rounded-full"/></td>
                      <td className="px-4 py-3.5"><div className="flex gap-1"><Sk className="h-6 w-14 rounded-lg"/><Sk className="h-6 w-14 rounded-lg"/></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile skeleton */}
            <div className="md:hidden divide-y divide-gray-100">
              {[0,1,2,3].map(i => (
                <div key={i} className="p-4 flex gap-3">
                  <Sk className="h-14 w-14 rounded-xl shrink-0"/>
                  <div className="flex-1 space-y-2">
                    <Sk className="h-2.5 w-20"/>
                    <Sk className="h-4 w-32"/>
                    <Sk className="h-3 w-40"/>
                    <div className="flex gap-2 pt-1">
                      <Sk className="h-7 w-24 rounded-lg"/>
                      <Sk className="h-7 w-20 rounded-lg"/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : filtered.length === 0 ? (
          <EmptyState message="No dispatches found" icon={Truck}/>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                    {canWrite && (
                      <th className="w-10 px-3 py-3">
                        {filteredPendingIds.length > 0 && (
                          <button type="button" onClick={toggleSelectAll}
                            className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center',
                              allPendingSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300')}>
                            {allPendingSelected && <Check size={12} className="text-white"/>}
                          </button>
                        )}
                      </th>
                    )}
                    <th className="w-8 px-3 py-3"></th>
                    <th className="text-left px-4 py-3">ID / Quote</th>
                    <th className="text-left px-4 py-3">Customer</th>
                    <th className="text-left px-4 py-3">Equipment</th>
                    <th className="text-left px-4 py-3">Driver</th>
                    <th className="text-left px-4 py-3">Destination</th>
                    <th className="text-left px-4 py-3">Dates</th>
                    <th className="text-left px-4 py-3">Progress</th>
                    <th className="text-left px-4 py-3">Status</th>
                    {canWrite && <th className="text-left px-4 py-3">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(d => {
                    const pendingItems    = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending');
                    const dispatchedItems = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Dispatched');
                    const returnedItems   = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Returned');
                    const totalItems      = d.dispatch_items?.length ?? 0;
                    const isExpanded      = expandedId === d.dispatch_id;
                    const primaryType     = d.dispatch_items?.[0]?.equipment_units?.equipment_types;
                    const primaryUnit     = d.dispatch_items?.[0]?.equipment_units;

                    return (
                      <React.Fragment key={d.dispatch_id}>
                        <tr
                          className={clsx('transition-colors cursor-pointer',
                            selectedDispatchIds.has(d.dispatch_id) ? 'bg-primary-50 hover:bg-primary-50' : 'hover:bg-gray-50')}
                          onClick={() => setExpandedId(isExpanded ? null : d.dispatch_id)}>
                          {canWrite && (
                            <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                              {d.status === 'Pending' && (
                                <button type="button" onClick={() => toggleDispatchSelect(d.dispatch_id)}
                                  className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center',
                                    selectedDispatchIds.has(d.dispatch_id) ? 'border-primary-500 bg-primary-500' : 'border-gray-300 hover:border-primary-400')}>
                                  {selectedDispatchIds.has(d.dispatch_id) && <Check size={12} className="text-white"/>}
                                </button>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-3 text-gray-400">
                            {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs text-gray-400">{d.dispatch_id}</p>
                            {d.quotation_id && (
                              <button type="button"
                                onClick={e => { e.stopPropagation(); setPreviewQuote(d.quotations); }}
                                className="flex items-center gap-1 text-xs text-primary-500 hover:underline">
                                <Eye size={10}/> {d.quotation_id}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm text-gray-800">{d.quotations?.customers?.company_name ?? <span className="text-gray-400 italic text-xs">Manual</span>}</p>
                            {d.quotationApprover && <p className="text-xs text-green-600">{d.quotationApprover.name}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <EquipmentImage
                                typeId={primaryType?.type_id}
                                imageUrl={primaryType?.image_url}
                                typeName={primaryType?.name}
                                className="w-9 h-9 rounded-lg shrink-0"/>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-700 truncate">{primaryType?.name ?? '—'}</p>
                                <p className="text-xs text-gray-400 font-mono truncate">{primaryUnit?.serial_number ?? '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{d.driver_name || <span className="text-gray-300 text-xs">Unassigned</span>}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-[120px] truncate">{d.destination}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            <div>{d.dispatch_date ? format(new Date(d.dispatch_date),'dd MMM yy') : '—'}</div>
                            {d.return_date && <div className="text-gray-300">→ {format(new Date(d.return_date),'dd MMM yy')}</div>}
                          </td>
                          <td className="px-4 py-3">
                            {totalItems > 0 ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                    <div className="flex h-full overflow-hidden">
                                      <div className="bg-green-400" style={{ width: `${(returnedItems.length / totalItems) * 100}%` }}/>
                                      <div className="bg-blue-400" style={{ width: `${(dispatchedItems.length / totalItems) * 100}%` }}/>
                                    </div>
                                  </div>
                                  <span className="text-xs text-gray-500">{returnedItems.length}↩ {dispatchedItems.length}→ {pendingItems.length}⏳</span>
                                </div>
                              </div>
                            ) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={d.status}/></td>
                          {canWrite && (
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1 flex-wrap">
                                {d.status === 'Pending' && (
                                  <button
                                    onClick={() => { setAssignTarget(d); setAssignForm({ driver_name: d.driver_name??'', vehicle_type: d.vehicle_type??'', vehicle_plate: d.vehicle_plate??'', notes: d.notes??'' }); }}
                                    className="text-xs bg-primary-500 text-white px-2 py-1 rounded-lg whitespace-nowrap">
                                    Assign
                                  </button>
                                )}
                                {['Assigned','In Transit'].includes(d.status) && pendingItems.length > 0 && (
                                  <button onClick={() => openDispatchItems(d)}
                                    className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg flex items-center gap-0.5 whitespace-nowrap">
                                    <SendHorizonal size={10}/> Dispatch
                                  </button>
                                )}
                                {['Assigned','In Transit','Completed'].includes(d.status) && dispatchedItems.length > 0 && (
                                  <button onClick={() => openReturnItems(d)}
                                    className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-0.5 whitespace-nowrap">
                                    <RotateCcw size={10}/> Return
                                  </button>
                                )}
                                {!['Cancelled','Returned'].includes(d.status) && (
                                  <button onClick={() => { setCancelTarget(d); setCancelReason(''); }}
                                    className="text-gray-300 hover:text-red-500 transition-colors p-1">
                                    <XCircle size={13}/>
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>

                        {/* Expanded row */}
                        {isExpanded && (
                          <tr className="bg-gray-50/80">
                            <td colSpan={canWrite ? 11 : 9} className="px-6 py-4">
                              <div className="space-y-3">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                  Equipment Items ({totalItems})
                                </p>
                                {(d.dispatch_items ?? []).map(item => (
                                  <div key={item.item_id}
                                    className={clsx('flex items-center justify-between p-3 rounded-xl border text-sm',
                                      item.dispatch_status === 'Returned'   ? 'bg-green-50 border-green-100' :
                                      item.dispatch_status === 'Dispatched' ? 'bg-blue-50 border-blue-100' :
                                      'bg-white border-gray-100')}>
                                    <div className="flex items-center gap-3">
                                      <div className={clsx('w-2.5 h-2.5 rounded-full shrink-0',
                                        item.dispatch_status === 'Returned'   ? 'bg-green-400' :
                                        item.dispatch_status === 'Dispatched' ? 'bg-blue-400' : 'bg-yellow-400')}/>
                                      <div>
                                        <p className="font-medium text-gray-800">
                                          {item.equipment_units?.equipment_types?.name} {item.equipment_units?.capacity}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                          {item.equipment_id} · {item.equipment_units?.serial_number ?? '—'} · {item.equipment_units?.location ?? '—'}
                                        </p>
                                        {item.dispatched_at && (
                                          <p className="text-xs text-blue-500">Dispatched: {format(new Date(item.dispatched_at), 'dd MMM yyyy HH:mm')}</p>
                                        )}
                                        {item.returned_at && (
                                          <p className="text-xs text-green-600">Returned: {format(new Date(item.returned_at), 'dd MMM yyyy HH:mm')}</p>
                                        )}
                                        {item.extended_return_date && (
                                          <p className="text-xs text-orange-600 flex items-center gap-1">
                                            <Calendar size={10}/> Extended: {format(new Date(item.extended_return_date), 'dd MMM yyyy')}
                                          </p>
                                        )}
                                        {item.return_notes && <p className="text-xs text-gray-500 italic">{item.return_notes}</p>}
                                      </div>
                                    </div>
                                    <span className={clsx('px-2 py-1 rounded-lg text-xs font-medium border', STATUS_COLORS[item.dispatch_status] ?? 'bg-gray-50 text-gray-600 border-gray-100')}>
                                      {item.dispatch_status}
                                    </span>
                                  </div>
                                ))}

                                {d.status === 'Cancelled' && (
                                  <div className="space-y-1">
                                    {d.cancelledByUser && (
                                      <div className="bg-red-50 rounded-lg px-3 py-2 text-xs">
                                        <p className="text-red-400">Cancelled by: <span className="font-medium text-red-700">{d.cancelledByUser.name}</span></p>
                                        {d.cancelled_at && <p className="text-red-300">{format(new Date(d.cancelled_at), 'dd MMM yyyy HH:mm')}</p>}
                                      </div>
                                    )}
                                    {d.cancel_reason && (
                                      <div className="bg-red-50 rounded-lg px-3 py-2 text-xs">
                                        <p className="text-red-400">Reason: <span className="font-medium text-red-700">{d.cancel_reason}</span></p>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {editingNotesId === d.dispatch_id ? (
                                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-2">
                                    <textarea className="input text-xs resize-y w-full" rows={2}
                                      value={notesEditValue}
                                      onChange={e => setNotesEditValue(e.target.value)}
                                      placeholder="Add dispatch notes…"
                                      autoFocus/>
                                    <div className="flex gap-2">
                                      <button onClick={() => saveNotes(d.dispatch_id)} disabled={savingNotes}
                                        className="text-xs bg-primary-500 text-white px-2.5 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50">
                                        {savingNotes ? <Loader2 size={11} className="animate-spin"/> : <Check size={11}/>} Save
                                      </button>
                                      <button onClick={() => setEditingNotesId(null)}
                                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancel</button>
                                    </div>
                                  </div>
                                ) : d.notes ? (
                                  <div className="bg-yellow-50 rounded-lg px-3 py-2 text-xs text-yellow-700 flex items-start justify-between gap-2">
                                    <span><span className="font-medium">Notes:</span> {d.notes}</span>
                                    {canWrite && !['Cancelled'].includes(d.status) && (
                                      <button type="button"
                                        onClick={() => { setEditingNotesId(d.dispatch_id); setNotesEditValue(d.notes ?? ''); }}
                                        className="shrink-0 text-yellow-500 hover:text-yellow-700 p-0.5">
                                        <Pencil size={11}/>
                                      </button>
                                    )}
                                  </div>
                                ) : canWrite && !['Cancelled','Returned'].includes(d.status) ? (
                                  <button type="button"
                                    onClick={() => { setEditingNotesId(d.dispatch_id); setNotesEditValue(''); }}
                                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                                    <Pencil size={11}/> Add notes
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-50">
              {filtered.map(d => {
                const pendingItems    = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending');
                const dispatchedItems = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Dispatched');
                const returnedItems   = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Returned');
                const totalItems      = d.dispatch_items?.length ?? 0;
                const primaryType     = d.dispatch_items?.[0]?.equipment_units?.equipment_types;

                return (
                  <div key={d.dispatch_id} className={clsx('p-4', selectedDispatchIds.has(d.dispatch_id) && 'bg-primary-50/30')}>
                    <div className="flex gap-3">
                      <EquipmentImage
                        typeId={primaryType?.type_id}
                        imageUrl={primaryType?.image_url}
                        typeName={primaryType?.name}
                        className="w-14 h-14 rounded-xl shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="font-mono text-xs text-gray-400">{d.dispatch_id}</p>
                          <StatusBadge status={d.status}/>
                        </div>
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {d.quotations?.customers?.company_name ?? 'Manual Dispatch'}
                        </p>
                        <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                          <MapPin size={10} className="shrink-0"/> {d.destination}
                        </p>
                        {d.driver_name && <p className="text-xs text-gray-400 mt-0.5">Driver: {d.driver_name}</p>}
                        {totalItems > 0 && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                              <div className="flex h-full overflow-hidden">
                                <div className="bg-green-400" style={{ width: `${(returnedItems.length / totalItems) * 100}%` }}/>
                                <div className="bg-blue-400" style={{ width: `${(dispatchedItems.length / totalItems) * 100}%` }}/>
                              </div>
                            </div>
                            <span className="text-xs text-gray-400">{returnedItems.length}↩ {dispatchedItems.length}→ {pendingItems.length}⏳</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {canWrite && d.status === 'Pending' && (
                        <button onClick={() => { setAssignTarget(d); setAssignForm({ driver_name: d.driver_name??'', vehicle_type: d.vehicle_type??'', vehicle_plate: d.vehicle_plate??'', notes: d.notes??'' }); }}
                          className="text-xs bg-primary-500 text-white px-3 py-1.5 rounded-lg">Assign Driver</button>
                      )}
                      {canWrite && ['Assigned','In Transit'].includes(d.status) && pendingItems.length > 0 && (
                        <button onClick={() => openDispatchItems(d)} className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg">Dispatch Items</button>
                      )}
                      {canWrite && ['Assigned','In Transit','Completed'].includes(d.status) && dispatchedItems.length > 0 && (
                        <button onClick={() => openReturnItems(d)} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg">Return Items</button>
                      )}
                      {canWrite && !['Cancelled','Returned'].includes(d.status) && (
                        <button onClick={() => { setCancelTarget(d); setCancelReason(''); }}
                          className="text-xs bg-red-50 text-red-500 px-3 py-1.5 rounded-lg border border-red-100">Cancel</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedDispatchIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white pl-4 pr-3 py-3 rounded-2xl shadow-2xl"
          style={{ animation: 'dmBulkBarSlide 0.28s cubic-bezier(0.34,1.56,0.64,1)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">{selectedDispatchIds.size}</span>
            <span className="text-gray-400 text-sm">dispatch{selectedDispatchIds.size !== 1 ? 'es' : ''} selected</span>
          </div>
          <div className="w-px h-5 bg-white/20"/>
          <button onClick={() => setShowBulkAssign(true)}
            className="flex items-center gap-1.5 text-sm bg-primary-500 hover:bg-primary-400 px-3 py-1.5 rounded-xl font-medium transition-colors">
            <Users size={14}/> Assign to Driver
          </button>
          <button onClick={clearSelection}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10 ml-0.5">
            <X size={15}/>
          </button>
        </div>
      )}

      {/* Bulk Assign Modal */}
      {showBulkAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          style={{ animation: 'dmFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            style={{ animation: 'dmSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10 rounded-t-2xl">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Users size={16} className="text-primary-500"/> Bulk Assign Driver
                </h3>
                <p className="text-sm text-gray-400">{selectedDispatchIds.size} dispatch{selectedDispatchIds.size !== 1 ? 'es' : ''} · all will be set to Assigned</p>
              </div>
              <button onClick={() => setShowBulkAssign(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-5">
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Truck size={14} className="text-gray-400"/> Driver & Vehicle <span className="text-red-500 text-xs">*</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Driver Name *</label>
                    <input className="input" placeholder="Full name"
                      value={bulkAssignForm.driver_name}
                      onChange={e => setBulkAssignForm(f => ({...f, driver_name: e.target.value}))} autoFocus/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                    <input className="input" placeholder="e.g. Flatbed"
                      value={bulkAssignForm.vehicle_type}
                      onChange={e => setBulkAssignForm(f => ({...f, vehicle_type: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle Plate</label>
                    <input className="input" placeholder="KWI 1234"
                      value={bulkAssignForm.vehicle_plate}
                      onChange={e => setBulkAssignForm(f => ({...f, vehicle_plate: e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <ClipboardList size={14} className="text-gray-400"/> Per-Dispatch Notes
                </p>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {[...selectedDispatchIds].map((id, idx) => {
                    const d = dispatches.find(x => x.dispatch_id === id);
                    if (!d) return null;
                    const eqItem  = d.dispatch_items?.[0]?.equipment_units;
                    const eqLabel = eqItem ? `${eqItem.equipment_types?.name ?? ''} ${eqItem.capacity ?? ''}`.trim() : null;
                    return (
                      <div key={id}
                        className="border border-gray-100 rounded-xl p-3 space-y-2"
                        style={{ animation: `dmPopIn 0.2s ease ${idx * 0.04}s both` }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-mono text-gray-400 truncate">{id}</p>
                            {d.quotations?.customers?.company_name && (
                              <p className="text-sm font-medium text-gray-800 truncate">{d.quotations.customers.company_name}</p>
                            )}
                            <p className="text-xs text-gray-500 truncate">→ {d.destination}</p>
                            {eqLabel && <p className="text-xs text-gray-400">{eqLabel}{d.dispatch_items?.length > 1 ? ` +${d.dispatch_items.length - 1} more` : ''}</p>}
                          </div>
                          <StatusBadge status={d.status}/>
                        </div>
                        {d.notes && (
                          <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-2 py-1.5">Existing: {d.notes}</p>
                        )}
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Notes for this dispatch</label>
                          <input className="input text-xs"
                            placeholder={d.notes ? 'Override notes…' : 'Special instructions…'}
                            value={bulkPerNotes[id] ?? ''}
                            onChange={e => setBulkPerNotes(prev => ({...prev, [id]: e.target.value}))}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => setShowBulkAssign(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleBulkAssign}
                  disabled={bulkAssigning || !bulkAssignForm.driver_name.trim()}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  {bulkAssigning && <Loader2 size={14} className="animate-spin"/>}
                  {bulkAssigning ? `Assigning ${selectedDispatchIds.size}…` : `Assign ${selectedDispatchIds.size} Dispatch${selectedDispatchIds.size !== 1 ? 'es' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Driver Modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          style={{ animation: 'dmFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
            style={{ animation: 'dmSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Truck size={18} className="text-primary-500"/> Assign Driver & Vehicle
            </h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">{assignTarget.dispatch_id}</span>
              {assignTarget.quotations?.customers?.company_name && ` — ${assignTarget.quotations.customers.company_name}`}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name *</label>
                <input className="input" value={assignForm.driver_name}
                  onChange={e => setAssignForm(f => ({...f, driver_name: e.target.value}))}
                  placeholder="Full name" autoFocus/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                <input className="input" value={assignForm.vehicle_type}
                  onChange={e => setAssignForm(f => ({...f, vehicle_type: e.target.value}))}
                  placeholder="e.g. Flatbed Trailer"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Plate</label>
                <input className="input" value={assignForm.vehicle_plate}
                  onChange={e => setAssignForm(f => ({...f, vehicle_plate: e.target.value}))}
                  placeholder="e.g. KWI 12345"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input resize-y" rows={2} value={assignForm.notes}
                  onChange={e => setAssignForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Special instructions…"/>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setAssignTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleAssign} disabled={assigning || !assignForm.driver_name.trim()}
                className="btn-primary flex items-center gap-2 disabled:opacity-50">
                {assigning && <Loader2 size={14} className="animate-spin"/>}
                {assigning ? 'Assigning…' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Items Modal */}
      {dispatchItemsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          style={{ animation: 'dmFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
            style={{ animation: 'dmSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <SendHorizonal size={16} className="text-blue-500"/> Dispatch Items
                </h3>
                <p className="text-sm text-gray-400">{dispatchItemsModal.dispatch_id} — {dispatchItemsModal.destination}</p>
              </div>
              <button onClick={() => { setDispatchItemsModal(null); setSelectedItemIds([]); setSharedDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' }); setPerItemDrivers({}); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-medium mb-1">Select items to dispatch now</p>
                <p>You can dispatch a subset of items (partial dispatch). Remaining items stay Pending and can be dispatched later.</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">
                  Pending Items ({(dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').length})
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedItemIds((dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').map(i => i.item_id))}
                    className="text-xs text-primary-500 hover:underline">Select all</button>
                  <span className="text-gray-300">·</span>
                  <button type="button" onClick={() => setSelectedItemIds([])}
                    className="text-xs text-gray-400 hover:underline">Deselect all</button>
                </div>
              </div>
              <div className="space-y-2">
                {(dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').map(item => {
                  const isSelected = selectedItemIds.includes(item.item_id);
                  return (
                    <div key={item.item_id} className="space-y-2">
                      <button type="button"
                        onClick={() => setSelectedItemIds(prev =>
                          prev.includes(item.item_id) ? prev.filter(id => id !== item.item_id) : [...prev, item.item_id]
                        )}
                        className={clsx('w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors',
                          isSelected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200')}>
                        <div className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                          isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300')}>
                          {isSelected && <CheckCircle size={12} className="text-white"/>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">
                            {item.equipment_units?.equipment_types?.name} {item.equipment_units?.capacity}
                          </p>
                          <p className="text-xs text-gray-400">
                            {item.equipment_id} · {item.equipment_units?.serial_number ?? '—'}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded border border-yellow-100">Pending</span>
                      </button>
                      {isSelected && driverMode === 'per-item' && (
                        <div className="ml-8 grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Driver Name</label>
                            <input className="input text-xs" placeholder="Driver name"
                              value={perItemDrivers[item.item_id]?.driver_name ?? ''}
                              onChange={e => setPerItemDrivers(prev => ({ ...prev, [item.item_id]: { ...(prev[item.item_id] ?? {}), driver_name: e.target.value } }))}/>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                            <input className="input text-xs" placeholder="e.g. Flatbed"
                              value={perItemDrivers[item.item_id]?.vehicle_type ?? ''}
                              onChange={e => setPerItemDrivers(prev => ({ ...prev, [item.item_id]: { ...(prev[item.item_id] ?? {}), vehicle_type: e.target.value } }))}/>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Plate</label>
                            <input className="input text-xs" placeholder="KWI 1234"
                              value={perItemDrivers[item.item_id]?.vehicle_plate ?? ''}
                              onChange={e => setPerItemDrivers(prev => ({ ...prev, [item.item_id]: { ...(prev[item.item_id] ?? {}), vehicle_plate: e.target.value } }))}/>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {selectedItemIds.length > 0 && (
                <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                  <p className="font-medium">
                    Dispatching {selectedItemIds.length} of {(dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').length} pending items
                    {selectedItemIds.length < (dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').length && ' (Partial Dispatch)'}
                  </p>
                </div>
              )}
              <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <User size={14} className="text-gray-400"/> Driver Assignment
                  </p>
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <button type="button" onClick={() => setDriverMode('shared')}
                      className={clsx('text-xs px-2.5 py-1 rounded-md transition-colors', driverMode === 'shared' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>
                      Same Driver
                    </button>
                    <button type="button" onClick={() => setDriverMode('per-item')}
                      className={clsx('text-xs px-2.5 py-1 rounded-md transition-colors', driverMode === 'per-item' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>
                      Per Item
                    </button>
                  </div>
                </div>
                {driverMode === 'shared' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Driver Name</label>
                      <input className="input text-xs" placeholder="Full name"
                        value={sharedDriver.driver_name}
                        onChange={e => setSharedDriver(f => ({...f, driver_name: e.target.value}))}/>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                      <input className="input text-xs" placeholder="e.g. Flatbed"
                        value={sharedDriver.vehicle_type}
                        onChange={e => setSharedDriver(f => ({...f, vehicle_type: e.target.value}))}/>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Vehicle Plate</label>
                      <input className="input text-xs" placeholder="KWI 1234"
                        value={sharedDriver.vehicle_plate}
                        onChange={e => setSharedDriver(f => ({...f, vehicle_plate: e.target.value}))}/>
                    </div>
                  </div>
                )}
                {driverMode === 'per-item' && (
                  <p className="text-xs text-gray-400">Enter driver details per item above.</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => { setDispatchItemsModal(null); setSelectedItemIds([]); setSharedDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' }); setPerItemDrivers({}); }} className="btn-secondary">Cancel</button>
                <button onClick={handleDispatchItems} disabled={dispatchingItems || selectedItemIds.length === 0}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  {dispatchingItems && <Loader2 size={14} className="animate-spin"/>}
                  {dispatchingItems ? 'Dispatching…' : `Dispatch ${selectedItemIds.length} Item${selectedItemIds.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Return Items Modal */}
      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          style={{ animation: 'dmFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
            style={{ animation: 'dmSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <RotateCcw size={16} className="text-green-500"/> Process Returns
                </h3>
                <p className="text-sm text-gray-400">{returnModal.dispatch_id} — {returnModal.destination}</p>
              </div>
              <button onClick={() => { setReturnModal(null); setReturnSelects([]); setReturnDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' }); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              {returnModal?.notes && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800 flex items-start gap-2">
                  <ClipboardList size={14} className="text-yellow-500 mt-0.5 shrink-0"/>
                  <div><span className="font-medium">Dispatch notes:</span> {returnModal.notes}</div>
                </div>
              )}
              <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-xs text-green-700">
                <p className="font-medium mb-1">Partial return supported</p>
                <p>Select which items are being returned now. Unselected items remain Dispatched. You can set an extended return date for items not yet returned.</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Dispatched Items ({returnSelects.length})</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setReturnSelects(rs => rs.map(r => ({...r, selected:true})))}
                    className="text-xs text-primary-500 hover:underline">Select all</button>
                  <span className="text-gray-300">·</span>
                  <button type="button" onClick={() => setReturnSelects(rs => rs.map(r => ({...r, selected:false})))}
                    className="text-xs text-gray-400 hover:underline">Deselect all</button>
                </div>
              </div>
              <div className="space-y-3">
                {returnSelects.map((ret, idx) => (
                  <div key={ret.item_id}
                    className={clsx('border rounded-xl p-4 space-y-3 transition-colors',
                      ret.selected ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100')}>
                    <div className="flex items-start gap-3">
                      <button type="button"
                        onClick={() => setReturnSelects(rs => rs.map((r, i) => i === idx ? {...r, selected: !r.selected} : r))}
                        className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5',
                          ret.selected ? 'border-green-500 bg-green-500' : 'border-gray-300')}>
                        {ret.selected && <CheckCircle size={12} className="text-white"/>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{ret.equipment_name}</p>
                        <p className="text-xs text-gray-400">{ret.equipment_id} · {ret.serial ?? '—'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-8">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Return Notes</label>
                        <input className="input text-xs" placeholder="Condition, issues, etc."
                          value={ret.return_notes}
                          onChange={e => setReturnSelects(rs => rs.map((r, i) => i===idx ? {...r, return_notes: e.target.value} : r))}/>
                      </div>
                      {!ret.selected && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                            <Calendar size={10}/> Extended Return Date
                          </label>
                          <input type="date" className="input text-xs" value={ret.extended_return_date}
                            onChange={e => setReturnSelects(rs => rs.map((r, i) => i===idx ? {...r, extended_return_date: e.target.value} : r))}/>
                          {ret.extended_return_date && (
                            <p className="text-xs text-orange-600 mt-0.5">
                              Expected by {format(new Date(ret.extended_return_date), 'dd MMM yyyy')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <User size={14} className="text-gray-400"/> Returning Driver <span className="text-xs font-normal text-gray-400">(optional)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Driver Name</label>
                    <input className="input text-xs" placeholder="Full name"
                      value={returnDriver.driver_name}
                      onChange={e => setReturnDriver(f => ({...f, driver_name: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                    <input className="input text-xs" placeholder="e.g. Flatbed"
                      value={returnDriver.vehicle_type}
                      onChange={e => setReturnDriver(f => ({...f, vehicle_type: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle Plate</label>
                    <input className="input text-xs" placeholder="KWI 1234"
                      value={returnDriver.vehicle_plate}
                      onChange={e => setReturnDriver(f => ({...f, vehicle_plate: e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">Return Summary</p>
                <p>✓ Returning now: <span className="font-medium text-green-700">{returnSelects.filter(r => r.selected).length} item(s)</span></p>
                <p>⏳ Still outstanding: <span className="font-medium text-orange-600">{returnSelects.filter(r => !r.selected).length} item(s)</span></p>
                {returnSelects.filter(r => !r.selected && r.extended_return_date).length > 0 && (
                  <p>📅 Extended dates set: <span className="font-medium text-orange-600">{returnSelects.filter(r => !r.selected && r.extended_return_date).length} item(s)</span></p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button onClick={() => { setReturnModal(null); setReturnSelects([]); setReturnDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' }); }} className="btn-secondary">Cancel</button>
                <button onClick={handleReturnItems} disabled={returning || returnSelects.filter(r => r.selected).length === 0}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                  {returning && <Loader2 size={14} className="animate-spin"/>}
                  {returning ? 'Processing…' : `Confirm Return (${returnSelects.filter(r => r.selected).length} items)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          style={{ animation: 'dmFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
            style={{ animation: 'dmSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <XCircle size={18} className="text-red-500"/> Cancel Dispatch
            </h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">{cancelTarget.dispatch_id}</span>
              {cancelTarget.quotations?.customers?.company_name && ` — ${cancelTarget.quotations.customers.company_name}`}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Cancellation <span className="text-red-500">*</span>
              </label>
              <textarea className="input resize-y" rows={3} value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Please specify why this dispatch is being cancelled…"/>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setCancelTarget(null)} className="btn-secondary">Keep Dispatch</button>
              <button onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {cancelling && <Loader2 size={14} className="animate-spin"/>}
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quotation Preview */}
      {previewQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          style={{ animation: 'dmFadeIn 0.18s ease' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            style={{ animation: 'dmSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
              <div>
                <h3 className="font-semibold text-gray-900">{previewQuote.quotation_id}</h3>
                <p className="text-sm text-gray-400">
                  {previewQuote.customers?.company_name}
                  {previewQuote.customers?.industry && ` — ${previewQuote.customers.industry}`}
                </p>
              </div>
              <button onClick={() => setPreviewQuote(null)} className="text-gray-400 hover:text-gray-600 p-2"><X size={20}/></button>
            </div>
            <div className="p-5 space-y-4">
              {previewQuote.requirements?.requirement_summary && (
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-blue-600 mb-1">Linked Requirement</p>
                  <p className="text-sm text-blue-800">{previewQuote.requirements.requirement_summary}</p>
                  {previewQuote.requirements.location && <p className="text-xs text-blue-500 mt-0.5">📍 {previewQuote.requirements.location}</p>}
                </div>
              )}
              {previewQuote.quotation_items?.map((item, idx) => (
                <div key={item.item_id ?? idx} className="flex items-start justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.description}</p>
                    {item.equipment_id && <p className="text-xs text-gray-400 font-mono">{item.equipment_id}</p>}
                    {item.rental_start_date && <p className="text-xs text-gray-400">{item.rental_start_date} → {item.rental_end_date}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{item.quantity} × {item.unit}</p>
                    <p className="text-sm font-semibold text-gray-700">KWD {Number(item.unit_rate_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</p>
                    {item.equipment_units?.status && <StatusBadge status={item.equipment_units.status}/>}
                  </div>
                </div>
              ))}
              <div className="border-t border-gray-100 pt-3 text-right">
                <p className="text-xl font-bold text-gray-900">KWD {Number(previewQuote.total_amount_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes dmFadeIn       { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dmSlideUp      { from { opacity: 0; transform: translateY(20px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes dmBulkBarSlide { from { opacity: 0; transform: translate(-50%, 20px) scale(0.94) } to { opacity: 1; transform: translate(-50%, 0) scale(1) } }
        @keyframes dmPopIn        { from { opacity: 0; transform: scale(0.93) } to { opacity: 1; transform: scale(1) } }
        @keyframes dmSwipeOut {
          0%   { transform: translateX(0)     scale(1);    opacity: 1;    max-height: 180px; border-top-width: 1px; }
          12%  { transform: translateX(5%)    scale(0.99); opacity: 1;    max-height: 180px; border-top-width: 1px; }
          62%  { transform: translateX(112%)  scale(0.97); opacity: 0;    max-height: 180px; border-top-width: 1px; }
          100% { transform: translateX(112%)  scale(0.97); opacity: 0;    max-height: 0;     border-top-width: 0;   }
        }
        .dm-swipe-out {
          animation: dmSwipeOut 0.62s linear forwards;
          overflow: hidden;
          will-change: transform, opacity;
        }
        .dm-swipe-out button { pointer-events: none; }
        /* .sk shimmer is now in global index.css */
      `}</style>
    </div>
  );
}
