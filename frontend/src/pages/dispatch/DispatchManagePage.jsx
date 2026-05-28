import { useEffect, useState, useCallback } from 'react';
import {
  getDispatches, createDispatch, updateDispatch,
  cancelDispatch, getApprovedQuotations, getDispatchableEquipment,
} from '../../api/dispatch';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import {
  Plus, Truck, X, Loader2, RefreshCw, Search,
  ChevronDown, ChevronUp, Package, CheckCircle,
  AlertTriangle, ArrowLeft, User, XCircle, Eye,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUSES = ['All','Pending','Assigned','In Transit','Completed','Returned','Cancelled'];
const DSP_STATUSES = ['Pending','Assigned','In Transit','Completed','Returned','Cancelled'];

const STATUS_NEXT = {
  'Pending':    'Assigned',
  'Assigned':   'In Transit',
  'In Transit': 'Completed',
  'Completed':  'Returned',
};

const EMPTY_FORM = {
  quotation_id:'', driver_name:'', vehicle_type:'',
  vehicle_plate:'', destination:'', dispatch_date:'',
  return_date:'', notes:'', status:'Pending',
};

export default function DispatchManagePage() {
  const { profile, role } = useAuth();

  const [dispatches,   setDispatches]   = useState([]);
  const [quotations,   setQuotations]   = useState([]);
  const [allEquipment, setAllEquipment] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm,     setShowForm]     = useState(false);
  const [expandedId,   setExpandedId]   = useState(null);
  const [previewQuote, setPreviewQuote] = useState(null);

  // Form
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [selectedEqIds, setSelectedEqIds] = useState([]);
  const [formLoading,   setFormLoading]   = useState(false);
  const [quoteSearch,   setQuoteSearch]   = useState('');
  const [eqSearch,      setEqSearch]      = useState('');
  const [selectedQuote, setSelectedQuote] = useState(null);

  // Cancel modal
  const [cancelTarget,  setCancelTarget]  = useState(null);
  const [cancelReason,  setCancelReason]  = useState('');
  const [cancelling,    setCancelling]    = useState(false);

  // // Maintenance issue modal (when setting status to Maintenance from dispatch)
  // const [maintenanceModal, setMaintenanceModal] = useState(null);
  // const [maintenanceIssue, setMaintenanceIssue] = useState('');

  const canWrite = hasPermission(role, 'dispatch_create');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, q, e] = await Promise.all([
        getDispatches(statusFilter !== 'All' ? { status: statusFilter } : {}),
        getApprovedQuotations(),
        getDispatchableEquipment(),
      ]);
      setDispatches(d);
      setQuotations(q);
      setAllEquipment(e);
    } catch (err) {
      toast.error('Failed to load dispatch data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('dispatch-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatches' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_items' }, load)
      .subscribe();
    return () => ch.unsubscribe();
  }, [load]);

  const handleQuoteSelect = (qId) => {
    const q = quotations.find(q => q.quotation_id === qId);
    setSelectedQuote(q ?? null);
    setForm(f => ({
      ...f,
      quotation_id: qId,
      destination: q?.requirements?.location ?? f.destination,
    }));
    if (q?.quotation_items) {
      const availFromQuote = q.quotation_items
        .filter(i => i.equipment_id && i.equipment_units?.status === 'Available')
        .map(i => i.equipment_id);
      setSelectedEqIds(availFromQuote);
      const starts = q.quotation_items.filter(i => i.rental_start_date).map(i => i.rental_start_date);
      const ends   = q.quotation_items.filter(i => i.rental_end_date).map(i => i.rental_end_date);
      if (starts.length > 0) setForm(f => ({ ...f, dispatch_date: starts[0] }));
      if (ends.length > 0)   setForm(f => ({ ...f, return_date: ends[ends.length - 1] }));
    }
  };

  const toggleEquipment = (eqId) => {
    setSelectedEqIds(prev => prev.includes(eqId) ? prev.filter(id => id !== eqId) : [...prev, eqId]);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (selectedEqIds.length === 0) return toast.error('Select at least one equipment');
    if (!form.destination.trim())   return toast.error('Enter destination');
    setFormLoading(true);
    try {
      const payload = {
        ...form,
        assigned_by:  profile.user_id,
        quotation_id: form.quotation_id || null,
        equipment_id: selectedEqIds[0],
      };
      await createDispatch(payload, selectedEqIds);
      toast.success(`Dispatch created with ${selectedEqIds.length} item(s)`);
      setShowForm(false);
      resetForm();
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to create dispatch');
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM); setSelectedEqIds([]);
    setSelectedQuote(null); setQuoteSearch(''); setEqSearch('');
  };

  const quickStatus = async (id, status) => {
    try {
      await updateDispatch(id, {
        status,
        ...(status === 'Returned'  ? { actual_return_date: new Date().toISOString().split('T')[0] } : {}),
        ...(status === 'Completed' ? { actual_return_date: new Date().toISOString().split('T')[0] } : {}),
      });
      toast.success(`Status → ${status}`);
      load();
    } catch { toast.error('Failed to update status'); }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) return toast.error('Please enter a reason for cancellation');
    setCancelling(true);
    try {
      await cancelDispatch(cancelTarget.dispatch_id, cancelReason, profile.user_id);
      toast.success('Dispatch cancelled');
      setCancelTarget(null); setCancelReason('');
      load();
    } catch { toast.error('Failed to cancel dispatch');
    } finally { setCancelling(false); }
  };

  // Filtered
  const filteredQuotes = quotations.filter(q => {
    if (!quoteSearch) return true;
    const s = quoteSearch.toLowerCase();
    return (
      q.quotation_id?.toLowerCase().includes(s) ||
      q.customers?.company_name?.toLowerCase().includes(s) ||
      q.requirements?.requirement_summary?.toLowerCase().includes(s)
    );
  });

  const filteredEquipment = allEquipment.filter(e => {
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

  const quoteEquipment = selectedQuote?.quotation_items?.filter(i => i.equipment_id) ?? [];

  // ── New dispatch form ──────────────────────────────────────────────────────
  if (showForm) {
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
                        <p className="text-sm font-medium text-gray-800">
                          {q.customers?.company_name}
                          {q.customers?.industry && <span className="text-gray-400 font-normal"> — {q.customers.industry}</span>}
                        </p>
                        <p className="text-xs text-gray-400">{q.quotation_id} · {q.requirements?.requirement_summary?.slice(0,50)}</p>
                        {q.approver && (
                          <p className="text-xs text-green-600">Approved by: {q.approver.name}</p>
                        )}
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
                    <p className="text-sm font-semibold text-green-800">
                      {selectedQuote.quotation_id} — {selectedQuote.customers?.company_name}
                      {selectedQuote.customers?.industry && ` (${selectedQuote.customers.industry})`}
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">{selectedQuote.requirements?.requirement_summary}</p>
                    {selectedQuote.approver && (
                      <p className="text-xs text-green-500 mt-0.5 flex items-center gap-1">
                        <User size={11}/> Approved by: {selectedQuote.approver.name}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => { setSelectedQuote(null); setForm(f => ({...f, quotation_id:''})); setSelectedEqIds([]); }}
                    className="text-green-400 hover:text-green-600 ml-2"><X size={16}/></button>
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
                            {item.rental_start_date && (
                              <span className="text-gray-400">· {item.rental_start_date} → {item.rental_end_date}</span>
                            )}
                          </div>
                          {isAvail && (
                            <button type="button" onClick={() => toggleEquipment(item.equipment_id)}
                              className={clsx('px-2 py-0.5 rounded text-xs font-medium transition-colors',
                                isSelected ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
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
              Select Additional Equipment
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
                <p className="text-sm text-gray-400 text-center py-6">No available equipment found</p>
              ) : filteredEquipment.map(eq => {
                const isSelected = selectedEqIds.includes(eq.equipment_id);
                const isReserved = eq.status === 'Reserved';
                return (
                  <button key={eq.equipment_id} type="button"
                    onClick={() => toggleEquipment(eq.equipment_id)}
                    className={clsx('w-full flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0 transition-colors text-left',
                      isSelected ? 'bg-primary-50' : isReserved ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50')}>
                    <div className="flex items-center gap-3">
                      <div className={clsx('w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
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
                <p className="text-xs font-semibold text-primary-700 mb-2">Selected for dispatch:</p>
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
                  onChange={e => setForm(f=>({...f, destination:e.target.value}))} required/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
                <input className="input" value={form.driver_name} onChange={e => setForm(f=>({...f,driver_name:e.target.value}))} placeholder="Full name"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                <input className="input" value={form.vehicle_type} onChange={e => setForm(f=>({...f,vehicle_type:e.target.value}))} placeholder="e.g. Flatbed Trailer"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Plate</label>
                <input className="input" value={form.vehicle_plate} onChange={e => setForm(f=>({...f,vehicle_plate:e.target.value}))} placeholder="e.g. KWI 12345"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
                <input type="date" className="input" value={form.dispatch_date} onChange={e => setForm(f=>({...f,dispatch_date:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Return</label>
                <input type="date" className="input" value={form.return_date} onChange={e => setForm(f=>({...f,return_date:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select className="input" value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                  {DSP_STATUSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea className="input resize-y" rows={2} value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}/>
            </div>
          </div>

          <div className="flex justify-end gap-3 pb-6">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={formLoading || selectedEqIds.length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {formLoading && <Loader2 size={15} className="animate-spin"/>}
              {formLoading ? 'Creating…' : `Create Dispatch (${selectedEqIds.length} item${selectedEqIds.length !== 1 ? 's' : ''})`}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── Dispatch list ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dispatch Management</h2>
          <p className="text-sm text-gray-400">{dispatches.length} dispatches</p>
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
      <div className="card p-4">
        <div className="flex gap-2 overflow-x-auto">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                statusFilter === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? <LoadingSpinner fullscreen={false}/> : dispatches.length === 0 ? (
        <EmptyState message="No dispatches found" icon={Truck}/>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="w-8 px-3 py-3"></th>
                  <th className="text-left px-5 py-3">ID</th>
                  <th className="text-left px-5 py-3">Quotation / Customer</th>
                  <th className="text-left px-5 py-3">Approved By</th>
                  <th className="text-left px-5 py-3">Equipment</th>
                  <th className="text-left px-5 py-3">Driver</th>
                  <th className="text-left px-5 py-3">Destination</th>
                  <th className="text-left px-5 py-3">Dispatch</th>
                  <th className="text-left px-5 py-3">Return</th>
                  <th className="text-left px-5 py-3">Status</th>
                  {canWrite && <th className="text-left px-5 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dispatches.map(d => (
                  <>
                    <tr key={d.dispatch_id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === d.dispatch_id ? null : d.dispatch_id)}>
                      <td className="px-3 py-3 text-gray-400">
                        {expandedId === d.dispatch_id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">{d.dispatch_id}</td>
                      <td className="px-5 py-3">
                        {d.quotation_id ? (
                          <div>
                            <button type="button"
                              onClick={e => { e.stopPropagation(); setPreviewQuote(d.quotations); }}
                              className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-mono">
                              <Eye size={11}/> {d.quotation_id}
                            </button>
                            <p className="text-xs text-gray-500">{d.quotations?.customers?.company_name}</p>
                            {d.quotations?.customers?.industry && (
                              <p className="text-xs text-gray-400">{d.quotations.customers.industry}</p>
                            )}
                          </div>
                        ) : <span className="text-gray-300 text-xs">Manual dispatch</span>}
                      </td>
                      <td className="px-5 py-3">
                        {d.quotationApprover ? (
                          <div>
                            <p className="text-xs font-medium text-green-700">{d.quotationApprover.name}</p>
                            <p className="text-xs text-gray-400">{d.quotationApprover.role}</p>
                          </div>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1">
                          <Package size={13} className="text-gray-400"/>
                          <span className="text-sm text-gray-700 font-medium">
                            {d.dispatch_items?.length ?? 0} item{(d.dispatch_items?.length ?? 0) !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-600 text-sm">{d.driver_name || '—'}</td>
                      <td className="px-5 py-3 text-gray-600 text-sm">{d.destination}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {d.dispatch_date ? format(new Date(d.dispatch_date),'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {d.return_date ? format(new Date(d.return_date),'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={d.status}/></td>
                      {canWrite && (
                        <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {STATUS_NEXT[d.status] && (
                              <button onClick={() => quickStatus(d.dispatch_id, STATUS_NEXT[d.status])}
                                className="text-xs bg-primary-500 text-white px-2 py-1 rounded-lg">
                                → {STATUS_NEXT[d.status]}
                              </button>
                            )}
                            {!['Cancelled','Completed','Returned'].includes(d.status) && (
                              <button onClick={() => { setCancelTarget(d); setCancelReason(''); }}
                                className="text-xs bg-red-50 text-red-500 px-2 py-1 rounded-lg hover:bg-red-100">
                                <XCircle size={12}/>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* Expanded row */}
                    {expandedId === d.dispatch_id && (
                      <tr key={`${d.dispatch_id}-expand`} className="bg-gray-50/80">
                        <td colSpan={canWrite ? 11 : 10} className="px-8 py-4">
                          <div className="space-y-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              Equipment ({d.dispatch_items?.length ?? 0} items)
                            </p>
                            {d.dispatch_items?.map(item => (
                              <div key={item.item_id} className="flex items-center gap-4 p-3 bg-white rounded-lg border border-gray-100">
                                <Package size={14} className="text-gray-400 shrink-0"/>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-800">
                                    {item.equipment_units?.equipment_types?.name} {item.equipment_units?.capacity}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    {item.equipment_id} · Serial: {item.equipment_units?.serial_number ?? '—'} · {item.equipment_units?.location ?? '—'}
                                  </p>
                                </div>
                                <StatusBadge status={item.equipment_units?.status ?? 'Unknown'}/>
                              </div>
                            ))}

                            {/* Assigner + cancellation info */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mt-2">
                              {d.assigner && (
                                <div className="bg-white rounded-lg border border-gray-100 p-2">
                                  <p className="text-gray-400">Assigned By</p>
                                  <p className="font-medium text-gray-700">{d.assigner.name}</p>
                                </div>
                              )}
                              {d.status === 'Cancelled' && d.cancelledByUser && (
                                <div className="bg-red-50 rounded-lg border border-red-100 p-2">
                                  <p className="text-red-400">Cancelled By</p>
                                  <p className="font-medium text-red-700">{d.cancelledByUser.name}</p>
                                  {d.cancelled_at && <p className="text-red-400">{format(new Date(d.cancelled_at),'dd MMM yyyy HH:mm')}</p>}
                                </div>
                              )}
                              {d.cancel_reason && (
                                <div className="bg-red-50 rounded-lg border border-red-100 p-2 col-span-2">
                                  <p className="text-red-400">Cancellation Reason</p>
                                  <p className="font-medium text-red-700">{d.cancel_reason}</p>
                                </div>
                              )}
                            </div>

                            {d.notes && (
                              <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                                <p className="text-xs text-yellow-700"><span className="font-semibold">Notes:</span> {d.notes}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {dispatches.map(d => (
              <div key={d.dispatch_id} className="card p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-mono text-xs text-gray-400">{d.dispatch_id}</p>
                    {d.quotation_id && (
                      <button onClick={() => setPreviewQuote(d.quotations)}
                        className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                        <Eye size={11}/> {d.quotation_id}
                      </button>
                    )}
                  </div>
                  <StatusBadge status={d.status}/>
                </div>
                {d.quotations?.customers && (
                  <p className="text-sm font-medium text-gray-700">{d.quotations.customers.company_name}</p>
                )}
                {d.quotationApprover && (
                  <p className="text-xs text-green-600">Approved by: {d.quotationApprover.name}</p>
                )}
                <p className="text-sm text-gray-600 mt-1">→ {d.destination}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {d.dispatch_items?.length ?? 0} equipment · {d.driver_name || 'No driver'}
                </p>
                {d.dispatch_date && (
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(d.dispatch_date),'dd MMM yyyy')}
                    {d.return_date && ` → ${format(new Date(d.return_date),'dd MMM yyyy')}`}
                  </p>
                )}
                {d.cancel_reason && (
                  <p className="text-xs text-red-500 mt-1">Cancelled: {d.cancel_reason}</p>
                )}
                <div className="flex gap-2 mt-2 flex-wrap">
                  {canWrite && STATUS_NEXT[d.status] && (
                    <button onClick={() => quickStatus(d.dispatch_id, STATUS_NEXT[d.status])}
                      className="text-xs bg-primary-500 text-white px-3 py-1.5 rounded-lg">
                      → {STATUS_NEXT[d.status]}
                    </button>
                  )}
                  {canWrite && !['Cancelled','Completed','Returned'].includes(d.status) && (
                    <button onClick={() => { setCancelTarget(d); setCancelReason(''); }}
                      className="text-xs bg-red-50 text-red-500 px-3 py-1.5 rounded-lg border border-red-100">
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Cancel modal ── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <XCircle size={18} className="text-red-500"/> Cancel Dispatch
            </h3>
            <p className="text-sm text-gray-500">
              Cancelling: <span className="font-medium text-gray-700">{cancelTarget.dispatch_id}</span>
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

      {/* ── Quotation preview popup ── */}
      {previewQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-semibold text-gray-900">{previewQuote.quotation_id}</h3>
                <p className="text-sm text-gray-400">
                  {previewQuote.customers?.company_name}
                  {previewQuote.customers?.industry && ` — ${previewQuote.customers.industry}`}
                  {previewQuote.customers?.contact_person && ` — ${previewQuote.customers.contact_person}`}
                </p>
              </div>
              <button onClick={() => setPreviewQuote(null)} className="text-gray-400 hover:text-gray-600 p-2">
                <X size={20}/>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Requirement */}
              {previewQuote.requirements?.requirement_summary && (
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-blue-600 mb-1">Linked Requirement</p>
                  <p className="text-sm text-blue-800">{previewQuote.requirements.requirement_summary}</p>
                  {previewQuote.requirements.location && (
                    <p className="text-xs text-blue-500 mt-0.5">📍 {previewQuote.requirements.location}</p>
                  )}
                </div>
              )}

              {/* Equipment items */}
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Equipment</p>
                <div className="space-y-2">
                  {previewQuote.quotation_items?.map((item, idx) => (
                    <div key={item.item_id ?? idx} className="flex items-start justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{item.description}</p>
                        {item.equipment_id && (
                          <p className="text-xs text-gray-400 font-mono">{item.equipment_id}</p>
                        )}
                        {item.rental_start_date && (
                          <p className="text-xs text-gray-400">
                            {item.rental_start_date} → {item.rental_end_date}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">{item.quantity} × {item.unit}</p>
                        <p className="text-sm font-semibold text-gray-700">
                          KWD {Number(item.unit_rate_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}
                        </p>
                        {item.equipment_units?.status && (
                          <StatusBadge status={item.equipment_units.status}/>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t border-gray-100 pt-3 flex flex-col items-end gap-1 text-sm">
                <div className="flex gap-8 text-gray-600">
                  <span>Total</span>
                  <span className="font-bold text-gray-900">
                    KWD {Number(previewQuote.total_amount_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}