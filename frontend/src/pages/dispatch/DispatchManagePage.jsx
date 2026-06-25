import React, { useEffect, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUSES = ['All','Pending','Assigned','In Transit','Completed','Returned','Cancelled'];


const STATUS_COLORS = {
  Pending:    'bg-yellow-50 text-yellow-700 border-yellow-200',
  Assigned:   'bg-blue-50 text-blue-700 border-blue-200',
  'In Transit': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Completed:  'bg-green-50 text-green-700 border-green-200',
  Returned:   'bg-gray-50 text-gray-600 border-gray-200',
  Cancelled:  'bg-red-50 text-red-600 border-red-200',
};

// const ITEM_STATUS_COLORS = {
//   Pending:    'bg-yellow-50 text-yellow-600',
//   Dispatched: 'bg-blue-50 text-blue-700',
//   Returned:   'bg-green-50 text-green-700',
// };

export default function DispatchManagePage() {
  const { profile, role, loading: authLoading } = useAuth();


  const [dispatches,   setDispatches]   = useState([]);
  const [quotations,   setQuotations]   = useState([]);
  const [allEquipment, setAllEquipment] = useState([]);
  // const [loading,      setLoading]      = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm,     setShowForm]     = useState(false);
  const [expandedId,   setExpandedId]   = useState(null);
  const [previewQuote, setPreviewQuote] = useState(null);

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

  // Assign modal (Pending → Assigned with driver details)
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignForm,   setAssignForm]   = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'', notes:'' });
  const [assigning,    setAssigning]    = useState(false);

  // ── Dispatch Items modal ──────────────────────────────────────────────────
  const [dispatchItemsModal, setDispatchItemsModal] = useState(null);
  const [selectedItemIds,    setSelectedItemIds]    = useState([]);
  const [dispatchingItems,   setDispatchingItems]   = useState(false);
  // Per-item driver assignment: { [item_id]: { driver_name, vehicle_type, vehicle_plate } }
  // Also supports 'shared' mode where one driver applies to all selected items
  const [driverMode,         setDriverMode]         = useState('shared'); // 'shared' | 'per-item'
  const [sharedDriver,       setSharedDriver]       = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'' });
  const [perItemDrivers,     setPerItemDrivers]     = useState({});

  // ── Return Items modal ────────────────────────────────────────────────────
  const [returnModal,    setReturnModal]    = useState(null);
  const [returnSelects,  setReturnSelects]  = useState([]);
  const [returning,      setReturning]      = useState(false);
  const [returnDriver,   setReturnDriver]   = useState({ driver_name:'', vehicle_type:'', vehicle_plate:'' });

  const canWrite = hasPermission(role, 'dispatch_create');

  const load = useCallback(async () => {
    if (authLoading || !profile || !role) return;
    try {
      const [d, q, e] = await Promise.all([
        getDispatchesFast(statusFilter !== 'All' ? { status: statusFilter } : {}),
        getApprovedQuotations(),
        getDispatchableEquipment(),
      ]);
      setDispatches(d);
      setQuotations(q);
      setAllEquipment(e);
    } catch (err) {
      toast.error('Failed to load dispatch data');
      console.error(err);
    }
  }, [authLoading, profile, role, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('dispatch-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatches' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_items' }, load)
      .subscribe();
    return () => ch.unsubscribe();
  }, [load]);

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
      const avail = q.quotation_items.filter(i => i.equipment_id && i.equipment_units?.status === 'Available').map(i => i.equipment_id);
      setSelectedEqIds(avail);
      const starts = q.quotation_items.filter(i => i.rental_start_date).map(i => i.rental_start_date);
      const ends   = q.quotation_items.filter(i => i.rental_end_date).map(i => i.rental_end_date);
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
      // Create one dispatch per equipment item so each is separately trackable
      for (const eqId of selectedEqIds) {
        try {
          await createDispatch({
            ...form,
            assigned_by:  profile.user_id,
            quotation_id: form.quotation_id || null,
            equipment_id: eqId,
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

  // ── Dispatch Items (partial/full) ─────────────────────────────────────────
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
      const totalItems = dispatchItemsModal.dispatch_items?.length ?? 0;
      const pendingCount = (dispatchItemsModal.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending').length;

      // Build driver info to pass to dispatchItems
      const driverInfo = driverMode === 'shared'
        ? {
            driver_name:   sharedDriver.driver_name   || dispatchItemsModal.driver_name,
            vehicle_type:  sharedDriver.vehicle_type  || dispatchItemsModal.vehicle_type,
            vehicle_plate: sharedDriver.vehicle_plate || dispatchItemsModal.vehicle_plate,
            total_items:   totalItems,
          }
        : {
            total_items: totalItems,
            // Per-item driver info stored separately; dispatch header uses first item's driver
            driver_name:   perItemDrivers[selectedItemIds[0]]?.driver_name   || dispatchItemsModal.driver_name || '',
            vehicle_type:  perItemDrivers[selectedItemIds[0]]?.vehicle_type  || dispatchItemsModal.vehicle_type || '',
            vehicle_plate: perItemDrivers[selectedItemIds[0]]?.vehicle_plate || dispatchItemsModal.vehicle_plate || '',
          };

      await dispatchItems(
        dispatchItemsModal.dispatch_id,
        selectedItemIds,
        driverInfo,
      );

      toast.success(
        selectedItemIds.length === pendingCount
          ? `All ${selectedItemIds.length} item(s) dispatched`
          : `${selectedItemIds.length} of ${pendingCount} item(s) dispatched (partial dispatch)`
      );
      setDispatchItemsModal(null);
      setSelectedItemIds([]);
      setSharedDriver({ driver_name:'', vehicle_type:'', vehicle_plate:'' });
      setPerItemDrivers({});
      load();
    } catch (err) { toast.error(err.message || 'Failed to dispatch items');
    } finally { setDispatchingItems(false); }
  };

  // ── Return Items (partial/full) ───────────────────────────────────────────
  const openReturnItems = (dispatch) => {
    const dispatchedItems = (dispatch.dispatch_items ?? []).filter(i => i.dispatch_status === 'Dispatched');
    if (dispatchedItems.length === 0) return toast.error('No dispatched items to return');
    setReturnModal(dispatch);
    setReturnSelects(dispatchedItems.map(i => ({
      item_id:               i.item_id,
      equipment_id:          i.equipment_id,
      equipment_name:        `${i.equipment_units?.equipment_types?.name ?? ''} ${i.equipment_units?.capacity ?? ''}`.trim(),
      serial:                i.equipment_units?.serial_number ?? '',
      selected:              true,
      return_notes:          '',
      extended_return_date:  '',
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
        toReturn.map(r => ({
          item_id:               r.item_id,
          return_notes:          r.return_notes,
          extended_return_date:  r.extended_return_date || null,
        })),
        profile.user_id
      );

      // Update dispatch with return driver info if provided
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

      const notReturned    = returnSelects.filter(r => !r.selected);
      const extendedItems  = toReturn.filter(r => r.extended_return_date);
      let msg = `${toReturn.length} item(s) returned`;
      if (notReturned.length > 0)   msg += ` · ${notReturned.length} still outstanding`;
      if (extendedItems.length > 0) msg += ` · ${extendedItems.length} with extended dates`;
      toast.success(msg);

      setReturnModal(null);
      setReturnSelects([]);
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
          {/* Step 1 — Quote */}
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
                      <span className="text-sm font-semibold text-gray-600 ml-4">
                        KWD {Number(q.total_amount_kwd).toLocaleString()}
                      </span>
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
                      <p className="text-xs text-green-500 mt-0.5 flex items-center gap-1">
                        <User size={11}/> Approved by: {selectedQuote.approver.name}
                      </p>
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

          {/* Step 2 — Equipment */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs flex items-center justify-center font-bold">2</span>
              Select Equipment
              {selectedEqIds.length > 0 && (
                <span className="ml-auto text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full font-medium">
                  {selectedEqIds.length} selected
                </span>
              )}
            </h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-9" placeholder="Search available equipment…"
                value={eqSearch} onChange={e => setEqSearch(e.target.value)}/>
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

          {/* Step 3 — Details */}
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

            {/* Info box about partial dispatch */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              <p className="font-medium mb-1">ℹ Partial Dispatch Support</p>
              <p>After creating this dispatch, you can dispatch individual items one by one or in groups. Each item tracks its own dispatch and return status.</p>
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

  // ── Dispatch list ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dispatch Management</h2>
          <p className="text-sm text-gray-400">{filtered.length} dispatches</p>
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

      {/* Status filter */}
      <div className="card p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                statusFilter === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="card p-4 space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9"
              placeholder="Search by dispatch ID, quote ID, customer, driver, destination…"
              value={search} onChange={e => setSearch(e.target.value)}/>
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14}/></button>}
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={clsx('btn-secondary flex items-center gap-2', hasActiveFilters && 'ring-2 ring-primary-300')}>
            <Filter size={15}/> Filters
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

      {/* Dispatch list */}
      {filtered.length === 0 ? (
        <EmptyState message="No dispatches found" icon={Truck}/>
      ) : (
        <>
          {/* Desktop */}
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  {canWrite && (
                    <th className="w-10 px-3 py-3">
                      {filteredPendingIds.length > 0 && (
                        <button type="button" onClick={toggleSelectAll}
                          className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                            allPendingSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300 hover:border-primary-400')}>
                          {allPendingSelected && <Check size={12} className="text-white"/>}
                        </button>
                      )}
                    </th>
                  )}
                  <th className="w-8 px-3 py-3"></th>
                  <th className="text-left px-4 py-3">ID</th>
                  <th className="text-left px-4 py-3">Quotation / Customer</th>
                  <th className="text-left px-4 py-3">Approved By</th>
                  <th className="text-left px-4 py-3">Items Progress</th>
                  <th className="text-left px-4 py-3">Driver</th>
                  <th className="text-left px-4 py-3">Destination</th>
                  <th className="text-left px-4 py-3">Dispatch</th>
                  <th className="text-left px-4 py-3">Return</th>
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

                  return (
                    <React.Fragment key={d.dispatch_id}>
                      <tr
                        className={clsx('transition-colors cursor-pointer',
                          selectedDispatchIds.has(d.dispatch_id) ? 'bg-primary-50 hover:bg-primary-50' : 'hover:bg-gray-50')}
                        style={{ animation: 'dmRowFadeIn 0.25s ease both' }}
                        onClick={() => setExpandedId(isExpanded ? null : d.dispatch_id)}>
                        {canWrite && (
                          <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                            {d.status === 'Pending' && (
                              <button type="button" onClick={() => toggleDispatchSelect(d.dispatch_id)}
                                className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-150',
                                  selectedDispatchIds.has(d.dispatch_id)
                                    ? 'border-primary-500 bg-primary-500 scale-110' : 'border-gray-300 hover:border-primary-400')}>
                                {selectedDispatchIds.has(d.dispatch_id) && <Check size={12} className="text-white"/>}
                              </button>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-3 text-gray-400">
                          {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{d.dispatch_id}</td>
                        <td className="px-4 py-3">
                          {d.quotation_id ? (
                            <div>
                              <button type="button"
                                onClick={e => { e.stopPropagation(); setPreviewQuote(d.quotations); }}
                                className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-mono">
                                <Eye size={11}/> {d.quotation_id}
                              </button>
                              <p className="text-xs text-gray-500">{d.quotations?.customers?.company_name}</p>
                            </div>
                          ) : <span className="text-gray-300 text-xs">Manual</span>}
                        </td>
                        <td className="px-4 py-3">
                          {d.quotationApprover ? (
                            <div>
                              <p className="text-xs font-medium text-green-700">{d.quotationApprover.name}</p>
                              <p className="text-xs text-gray-400">{d.quotationApprover.role}</p>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {totalItems > 0 ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                  <div className="flex h-full rounded-full overflow-hidden">
                                    <div className="bg-green-400" style={{ width: `${(returnedItems.length / totalItems) * 100}%` }}/>
                                    <div className="bg-blue-400" style={{ width: `${(dispatchedItems.length / totalItems) * 100}%` }}/>
                                  </div>
                                </div>
                                <span className="text-gray-500 whitespace-nowrap">
                                  {returnedItems.length}↩ {dispatchedItems.length}→ {pendingItems.length}⏳
                                </span>
                              </div>
                              <p className="text-xs text-gray-400">{totalItems} total</p>
                            </div>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-sm">{d.driver_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 text-sm max-w-[120px] truncate">{d.destination}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                          {d.dispatch_date ? format(new Date(d.dispatch_date),'dd MMM yyyy') : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                          {d.return_date ? format(new Date(d.return_date),'dd MMM yyyy') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={d.status}/>
                            {d.dispatch_type === 'Partial' && (
                              <span className="text-xs bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded font-medium">Partial</span>
                            )}
                          </div>
                        </td>
                        {canWrite && (
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1 flex-wrap">
                              {/* Pending → Assign Driver */}
                              {d.status === 'Pending' && (
                                <button
                                  onClick={() => { setAssignTarget(d); setAssignForm({ driver_name: d.driver_name??'', vehicle_type: d.vehicle_type??'', vehicle_plate: d.vehicle_plate??'', notes: d.notes??'' }); }}
                                  className="text-xs bg-primary-500 text-white px-2 py-1 rounded-lg whitespace-nowrap">
                                  Assign Driver
                                </button>
                              )}

                              {/* Assigned → Dispatch Items */}
                              {['Assigned','In Transit'].includes(d.status) && pendingItems.length > 0 && (
                                <button onClick={() => openDispatchItems(d)}
                                  className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap">
                                  <SendHorizonal size={11}/> Dispatch Items
                                </button>
                              )}

                              {/* Return Items */}
                              {['Assigned','In Transit','Completed'].includes(d.status) && dispatchedItems.length > 0 && (
                                <button onClick={() => openReturnItems(d)}
                                  className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap">
                                  <RotateCcw size={11}/> Return Items
                                </button>
                              )}

                              {/* Cancel */}
                              {!['Cancelled','Returned'].includes(d.status) && (
                                <button onClick={() => { setCancelTarget(d); setCancelReason(''); }}
                                  className="text-gray-300 hover:text-red-500 transition-colors p-1">
                                  <XCircle size={14}/>
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>

                      {/* Expanded row — item-level detail */}
                      {isExpanded && (
                        <tr className="bg-gray-50/80" style={{ animation: 'dmSlideDown 0.2s ease' }}>
                          <td colSpan={canWrite ? 12 : 10} className="px-6 py-4">
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
                                      item.dispatch_status === 'Dispatched' ? 'bg-blue-400' : 'bg-yellow-400')}>
                                    </div>
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
                                          <Calendar size={10}/> Extended return: {format(new Date(item.extended_return_date), 'dd MMM yyyy')}
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

                              {/* Cancellation info */}
                              {d.status === 'Cancelled' && (
                                <div className="mt-2 space-y-1">
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

                              {/* Inline notes editor */}
                              {editingNotesId === d.dispatch_id ? (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 space-y-2"
                                  style={{ animation: 'dmPopIn 0.18s ease' }}>
                                  <p className="text-xs font-medium text-yellow-700">Edit Notes</p>
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
                                      className="shrink-0 text-yellow-500 hover:text-yellow-700 p-0.5 transition-colors">
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

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {filtered.map(d => {
              const pendingItems    = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Pending');
              const dispatchedItems = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Dispatched');
              const returnedItems   = (d.dispatch_items ?? []).filter(i => i.dispatch_status === 'Returned');
              const totalItems      = d.dispatch_items?.length ?? 0;

              return (
                <div key={d.dispatch_id}
                  className={clsx('card p-4 transition-colors', selectedDispatchIds.has(d.dispatch_id) && 'ring-2 ring-primary-300 bg-primary-50/30')}
                  style={{ animation: 'dmRowFadeIn 0.25s ease both' }}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-start gap-2">
                      {canWrite && d.status === 'Pending' && (
                        <button type="button" onClick={() => toggleDispatchSelect(d.dispatch_id)}
                          className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-all',
                            selectedDispatchIds.has(d.dispatch_id) ? 'border-primary-500 bg-primary-500' : 'border-gray-300')}>
                          {selectedDispatchIds.has(d.dispatch_id) && <Check size={12} className="text-white"/>}
                        </button>
                      )}
                      <div>
                        <p className="font-mono text-xs text-gray-400">{d.dispatch_id}</p>
                        {d.quotation_id && (
                          <button onClick={() => setPreviewQuote(d.quotations)}
                            className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                            <Eye size={11}/> {d.quotation_id}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={d.status}/>
                      {d.dispatch_type === 'Partial' && (
                        <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">Partial</span>
                      )}
                    </div>
                  </div>

                  {d.quotations?.customers && (
                    <p className="text-sm font-medium text-gray-700">{d.quotations.customers.company_name}</p>
                  )}
                  <p className="text-sm text-gray-600">→ {d.destination}</p>

                  {totalItems > 0 && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="flex h-full rounded-full overflow-hidden">
                          <div className="bg-green-400" style={{ width: `${(returnedItems.length / totalItems) * 100}%` }}/>
                          <div className="bg-blue-400" style={{ width: `${(dispatchedItems.length / totalItems) * 100}%` }}/>
                        </div>
                      </div>
                      <span>{returnedItems.length}↩ {dispatchedItems.length}→ {pendingItems.length}⏳ / {totalItems}</span>
                    </div>
                  )}

                  {d.driver_name && <p className="text-xs text-gray-400 mt-1">Driver: {d.driver_name}</p>}

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

      {/* ── Floating Bulk Action Bar ── */}
      {selectedDispatchIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white pl-4 pr-3 py-3 rounded-2xl shadow-2xl"
          style={{ animation: 'dmBulkBarSlide 0.28s cubic-bezier(0.34,1.56,0.64,1)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">{selectedDispatchIds.size}</span>
            <span className="text-gray-400 text-sm">dispatch{selectedDispatchIds.size !== 1 ? 'es' : ''} selected</span>
          </div>
          <div className="w-px h-5 bg-white/20"/>
          <button onClick={() => setShowBulkAssign(true)}
            className="flex items-center gap-1.5 text-sm bg-primary-500 hover:bg-primary-400 active:bg-primary-600 px-3 py-1.5 rounded-xl font-medium transition-colors">
            <Users size={14}/> Assign to Driver
          </button>
          <button onClick={clearSelection}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10 ml-0.5">
            <X size={15}/>
          </button>
        </div>
      )}

      {/* ── Bulk Assign Modal ── */}
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
              {/* Shared driver fields */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Truck size={14} className="text-gray-400"/> Driver & Vehicle <span className="text-red-500 text-xs">*</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Driver Name *</label>
                    <input className="input" placeholder="Full name"
                      value={bulkAssignForm.driver_name}
                      onChange={e => setBulkAssignForm(f => ({...f, driver_name: e.target.value}))}
                      autoFocus/>
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

              {/* Per-dispatch notes */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <ClipboardList size={14} className="text-gray-400"/> Per-Dispatch Notes
                </p>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {[...selectedDispatchIds].map((id, idx) => {
                    const d = dispatches.find(x => x.dispatch_id === id);
                    if (!d) return null;
                    const eqItem = d.dispatch_items?.[0]?.equipment_units;
                    const eqLabel = eqItem
                      ? `${eqItem.equipment_types?.name ?? ''} ${eqItem.capacity ?? ''}`.trim()
                      : null;
                    return (
                      <div key={id}
                        className="border border-gray-100 rounded-xl p-3 space-y-2 hover:border-gray-200 transition-colors"
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
                          <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-2 py-1.5">
                            Existing: {d.notes}
                          </p>
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
                  {bulkAssigning
                    ? `Assigning ${selectedDispatchIds.size}…`
                    : `Assign ${selectedDispatchIds.size} Dispatch${selectedDispatchIds.size !== 1 ? 'es' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Driver Modal ── */}
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

      {/* ── Dispatch Items Modal ── */}
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

              {/* Item selection */}
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
                {(dispatchItemsModal.dispatch_items ?? [])
                  .filter(i => i.dispatch_status === 'Pending')
                  .map(item => {
                    const isSelected = selectedItemIds.includes(item.item_id);
                    return (
                      <div key={item.item_id} className="space-y-2">
                        <button type="button"
                          onClick={() => setSelectedItemIds(prev =>
                            prev.includes(item.item_id) ? prev.filter(id => id !== item.item_id) : [...prev, item.item_id]
                          )}
                          className={clsx(
                            'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors',
                            isSelected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'
                          )}>
                          <div className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                            isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300')}>
                            {isSelected && <CheckCircle size={12} className="text-white"/>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              {item.equipment_units?.equipment_types?.name} {item.equipment_units?.capacity}
                            </p>
                            <p className="text-xs text-gray-400">
                              {item.equipment_id} · {item.equipment_units?.serial_number ?? '—'} · {item.equipment_units?.location ?? '—'}
                            </p>
                          </div>
                          <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded border border-yellow-100">Pending</span>
                        </button>

                        {/* Per-item driver fields (only shown in per-item mode when item is selected) */}
                        {isSelected && driverMode === 'per-item' && (
                          <div className="ml-8 grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Driver Name</label>
                              <input className="input text-xs"
                                placeholder="Driver name"
                                value={perItemDrivers[item.item_id]?.driver_name ?? ''}
                                onChange={e => setPerItemDrivers(prev => ({
                                  ...prev,
                                  [item.item_id]: { ...(prev[item.item_id] ?? {}), driver_name: e.target.value }
                                }))}/>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                              <input className="input text-xs"
                                placeholder="e.g. Flatbed"
                                value={perItemDrivers[item.item_id]?.vehicle_type ?? ''}
                                onChange={e => setPerItemDrivers(prev => ({
                                  ...prev,
                                  [item.item_id]: { ...(prev[item.item_id] ?? {}), vehicle_type: e.target.value }
                                }))}/>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Plate</label>
                              <input className="input text-xs"
                                placeholder="KWI 1234"
                                value={perItemDrivers[item.item_id]?.vehicle_plate ?? ''}
                                onChange={e => setPerItemDrivers(prev => ({
                                  ...prev,
                                  [item.item_id]: { ...(prev[item.item_id] ?? {}), vehicle_plate: e.target.value }
                                }))}/>
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

              {/* Driver assignment section */}
              <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <User size={14} className="text-gray-400"/> Driver Assignment
                  </p>
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <button type="button"
                      onClick={() => setDriverMode('shared')}
                      className={clsx('text-xs px-2.5 py-1 rounded-md transition-colors', driverMode === 'shared' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>
                      Same Driver
                    </button>
                    <button type="button"
                      onClick={() => setDriverMode('per-item')}
                      className={clsx('text-xs px-2.5 py-1 rounded-md transition-colors', driverMode === 'per-item' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>
                      Per Item
                    </button>
                  </div>
                </div>

                {driverMode === 'shared' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Driver Name</label>
                      <input className="input text-xs"
                        placeholder="Full name"
                        value={sharedDriver.driver_name}
                        onChange={e => setSharedDriver(f => ({...f, driver_name: e.target.value}))}/>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                      <input className="input text-xs"
                        placeholder="e.g. Flatbed"
                        value={sharedDriver.vehicle_type}
                        onChange={e => setSharedDriver(f => ({...f, vehicle_type: e.target.value}))}/>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Vehicle Plate</label>
                      <input className="input text-xs"
                        placeholder="KWI 1234"
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

      {/* ── Return Items Modal ── */}
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
                <p>Select which items are being returned now. Unselected items remain Dispatched (outstanding). You can set an extended return date for items not yet returned.</p>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">
                  Dispatched Items ({returnSelects.length})
                </p>
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

                    {/* Return notes + extended date */}
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

              {/* Return driver */}
              <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <User size={14} className="text-gray-400"/> Returning Driver <span className="text-xs font-normal text-gray-400">(optional)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Driver Name</label>
                    <input className="input text-xs"
                      placeholder="Full name"
                      value={returnDriver.driver_name}
                      onChange={e => setReturnDriver(f => ({...f, driver_name: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle Type</label>
                    <input className="input text-xs"
                      placeholder="e.g. Flatbed"
                      value={returnDriver.vehicle_type}
                      onChange={e => setReturnDriver(f => ({...f, vehicle_type: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Vehicle Plate</label>
                    <input className="input text-xs"
                      placeholder="KWI 1234"
                      value={returnDriver.vehicle_plate}
                      onChange={e => setReturnDriver(f => ({...f, vehicle_plate: e.target.value}))}/>
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">Return Summary</p>
                <p>✓ Returning now: <span className="font-medium text-green-700">{returnSelects.filter(r => r.selected).length} item(s)</span></p>
                <p>⏳ Still outstanding: <span className="font-medium text-orange-600">{returnSelects.filter(r => !r.selected).length} item(s)</span></p>
                {returnSelects.filter(r => !r.selected && r.extended_return_date).length > 0 && (
                  <p>📅 Extended return dates set: <span className="font-medium text-orange-600">{returnSelects.filter(r => !r.selected && r.extended_return_date).length} item(s)</span></p>
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

      {/* ── Cancel Modal ── */}
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

      {/* ── Quotation Preview Popup ── */}
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
        @keyframes dmFadeIn      { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dmSlideUp     { from { opacity: 0; transform: translateY(20px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes dmSlideDown   { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes dmRowFadeIn   { from { opacity: 0; transform: translateX(-6px) } to { opacity: 1; transform: translateX(0) } }
        @keyframes dmBulkBarSlide { from { opacity: 0; transform: translate(-50%, 20px) scale(0.94) } to { opacity: 1; transform: translate(-50%, 0) scale(1) } }
        @keyframes dmCheckBounce { 0% { transform: scale(1) } 40% { transform: scale(1.25) } 75% { transform: scale(0.9) } 100% { transform: scale(1) } }
        @keyframes dmPopIn       { from { opacity: 0; transform: scale(0.93) } to { opacity: 1; transform: scale(1) } }
      `}</style>
    </div>
  );
}