import { useEffect, useCallback, useState, useRef } from 'react';
import {
  getEquipmentUnitsWithProcurement, getEquipmentTypes,
  createEquipmentUnit, updateEquipmentUnit, retireEquipment,
  getSerialNumbersByType,
} from '../../api/equipment';
import { createMaintenanceJob } from '../../api/maintenance';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import { useAppStore } from '../../store/useAppStore';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import {
  Plus, Search, Package, RefreshCw, X, Loader2,
  Eye, Archive, Wrench,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const ALL_STATUSES = ['Available','Reserved','Dispatched','Maintenance','Retired'];
const STATUS_RING  = {
  Available:   'ring-green-300 bg-green-50 text-green-700',
  Reserved:    'ring-yellow-300 bg-yellow-50 text-yellow-700',
  Dispatched:  'ring-blue-300 bg-blue-50 text-blue-700',
  Maintenance: 'ring-red-300 bg-red-50 text-red-700',
  Retired:     'ring-gray-300 bg-gray-100 text-gray-500',
};
const ISSUE_TYPES = ['Mechanical','Electrical','Hydraulic','Tyre','Cooling','Body','Other'];

export default function EquipmentPage() {
  const { profile, role } = useAuth();
  const {
    equipmentUnits, equipmentTypes, equipmentLoaded, equipmentFilters,
    setEquipmentUnits, setEquipmentTypes, setEquipmentFilters, clearEquipmentCache,
  } = useAppStore();

  const [loading,     setLoading]     = useState(!equipmentLoaded);
  const [showModal,   setShowModal]   = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [viewRetired, setViewRetired] = useState(false);
  const [retireTarget,setRetireTarget]= useState(null);
  const [retireReason,setRetireReason]= useState('');
  const [retiring,    setRetiring]    = useState(false);
  const [previewUnit, setPreviewUnit] = useState(null);

  // Maintenance issue modal — shown when status set to Maintenance
  const [maintenanceModal, setMaintenanceModal] = useState(null);
  const [maintenanceIssue, setMaintenanceIssue] = useState('');
  const [maintenanceType,  setMaintenanceType]  = useState('Mechanical');
  const [setPendingStatus]     = useState(null);

  // Serial number suggestions
  const [serialSuggestions, setSerialSuggestions] = useState([]);
  const [showSerialDrop,    setShowSerialDrop]    = useState(false);
  const serialRef = useRef(null);

  const [form, setForm] = useState({
    type_id:'', serial_number:'', capacity:'', status:'Available',
    location:'', daily_rate_kwd:'', year_of_manufacture:'', notes:'',
  });

  const { search, status: statusFilter, typeId: typeFilter } = equipmentFilters;
  const canWrite = hasPermission(role, 'equipment_create');

  const load = useCallback(async (force = false) => {
    if (equipmentLoaded && !force) return;
    setLoading(true);
    try {
      const [u, t] = await Promise.all([
        getEquipmentUnitsWithProcurement(),
        getEquipmentTypes(),
      ]);
      setEquipmentUnits(u);
      setEquipmentTypes(t);
    } catch { toast.error('Failed to load equipment'); }
    finally { setLoading(false); }
  }, [equipmentLoaded, setEquipmentUnits, setEquipmentTypes]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('equipment-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_units' }, () => {
        clearEquipmentCache(); load(true);
      })
      .subscribe();
    return () => ch.unsubscribe();
  }, [clearEquipmentCache, load]);

  // Status counts from all units (unfiltered)
  const statusCounts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = equipmentUnits.filter(u => u.status === s).length;
    return acc;
  }, {});

  // Filtering
  const allFiltered = equipmentUnits.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      u.equipment_types?.name?.toLowerCase().includes(q) ||
      u.equipment_id?.toLowerCase().includes(q) ||
      u.serial_number?.toLowerCase().includes(q) ||
      u.location?.toLowerCase().includes(q) ||
      u.capacity?.toLowerCase().includes(q) ||
      u.status?.toLowerCase().includes(q) ||
      u.equipment_types?.category?.toLowerCase().includes(q) ||
      String(u.daily_rate_kwd)?.includes(q);
    const matchStatus = statusFilter === 'All' || u.status === statusFilter;
    const matchType   = typeFilter   === 'All' || u.type_id === typeFilter;
    return matchSearch && matchStatus && matchType;
  });

  const activeFiltered  = allFiltered.filter(u => u.status !== 'Retired');
  const retiredFiltered = allFiltered.filter(u => u.status === 'Retired');
  const procuredItems   = allFiltered.filter(u => u.procurement_id);

  const hasActiveFilters = statusFilter !== 'All' || typeFilter !== 'All' || search;

  const openAdd = () => {
    setForm({ type_id:'', serial_number:'', capacity:'', status:'Available', location:'', daily_rate_kwd:'', year_of_manufacture:'', notes:'' });
    setSelected(null);
    setSerialSuggestions([]);
    setShowModal(true);
  };

  const openEdit = (unit) => {
    setForm({
      type_id: unit.type_id, serial_number: unit.serial_number??'',
      capacity: unit.capacity??'', status: unit.status,
      location: unit.location??'', daily_rate_kwd: unit.daily_rate_kwd,
      year_of_manufacture: unit.year_of_manufacture??'', notes: unit.notes??'',
    });
    setSelected(unit);
    setShowModal(true);
  };

  const handleTypeChange = async (typeId) => {
    setForm(f => ({ ...f, type_id: typeId, serial_number: '', capacity: '' }));
    if (typeId) {
      const serials = await getSerialNumbersByType(typeId);
      setSerialSuggestions(serials);
    } else {
      setSerialSuggestions([]);
    }
  };

  const handleSerialSelect = (suggestion) => {
    setForm(f => ({ ...f, serial_number: suggestion.serial_number, capacity: suggestion.capacity ?? f.capacity }));
    setShowSerialDrop(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.type_id)        return toast.error('Select equipment type');
    if (!form.daily_rate_kwd) return toast.error('Enter daily rate');
    setFormLoading(true);
    try {
      if (selected) {
        await updateEquipmentUnit(selected.equipment_id, form);
        toast.success('Equipment updated');
      } else {
        await createEquipmentUnit(form);
        toast.success('Equipment unit added');
      }
      setShowModal(false);
      clearEquipmentCache(); load(true);
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  // Handle status change — if setting to Maintenance, show issue modal first
  const handleStatusChange = async (unit, newStatus) => {
    if (newStatus === 'Maintenance') {
      setMaintenanceModal(unit);
      setMaintenanceIssue('');
      setMaintenanceType('Mechanical');
      setPendingStatus(newStatus);
      return;
    }
    if (newStatus === 'Retired') {
      setRetireTarget(unit);
      setRetireReason('');
      return;
    }
    try {
      await updateEquipmentUnit(unit.equipment_id, { status: newStatus });
      toast.success('Status updated');
      setEquipmentUnits(equipmentUnits.map(u => u.equipment_id === unit.equipment_id ? { ...u, status: newStatus } : u));
    } catch { toast.error('Failed to update status'); }
  };

  const handleMaintenanceConfirm = async () => {
    if (!maintenanceIssue.trim()) return toast.error('Please describe the issue');
    setFormLoading(true);
    try {
      // Update equipment status (trigger will auto-create maintenance log)
      // But we update the notes to pass issue through — or create maintenance directly
      await updateEquipmentUnit(maintenanceModal.equipment_id, {
        status: 'Maintenance',
      });
      // Create maintenance job with the issue
      await createMaintenanceJob({
        equipment_id: maintenanceModal.equipment_id,
        issue:        maintenanceIssue,
        issue_type:   maintenanceType,
        service_date: new Date().toISOString().split('T')[0],
        status:       'Open',
        reported_by:  profile.user_id,
        notes:        `Status changed to Maintenance from Equipment Fleet`,
      });
      toast.success('Equipment set to Maintenance — job logged');
      setMaintenanceModal(null);
      clearEquipmentCache(); load(true);
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  const handleRetireConfirm = async () => {
    if (!retireReason.trim()) return toast.error('Enter retire reason');
    setRetiring(true);
    try {
      await retireEquipment(retireTarget.equipment_id, retireReason);
      toast.success('Equipment retired');
      setRetireTarget(null); setRetireReason('');
      clearEquipmentCache(); load(true);
    } catch { toast.error('Failed to retire');
    } finally { setRetiring(false); }
  };

  const displayedUnits = viewRetired ? retiredFiltered : activeFiltered;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Equipment Fleet</h2>
          <p className="text-sm text-gray-400">{displayedUnits.length} shown · {equipmentUnits.length} total</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { clearEquipmentCache(); load(true); }} className="btn-secondary p-2"><RefreshCw size={16}/></button>
          <button
            onClick={() => setViewRetired(v => !v)}
            className={clsx('btn-secondary flex items-center gap-2', viewRetired && 'ring-2 ring-gray-300')}>
            <Archive size={15}/> {viewRetired ? 'Active Fleet' : `Retired (${statusCounts['Retired']})`}
          </button>
          {canWrite && (
            <button onClick={openAdd} className="btn-primary flex items-center gap-2">
              <Plus size={16}/> Add Unit
            </button>
          )}
        </div>
      </div>

      {/* Status cards — always from all units */}
      {!viewRetired && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {ALL_STATUSES.filter(s => s !== 'Retired').map(s => (
            <button key={s} onClick={() => setEquipmentFilters({ status: statusFilter === s ? 'All' : s })}
              className={clsx('card p-3 text-center transition-all ring-0 hover:shadow-md',
                statusFilter === s && `ring-2 ${STATUS_RING[s]}`)}>
              <p className="text-2xl font-bold text-gray-800">{statusCounts[s]}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s}</p>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9"
              placeholder="Search by type, ID, serial, capacity, location, category…"
              value={search} onChange={e => setEquipmentFilters({ search: e.target.value })}/>
            {search && (
              <button onClick={() => setEquipmentFilters({ search:'' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14}/>
              </button>
            )}
          </div>
          <select className="input w-48" value={typeFilter} onChange={e => setEquipmentFilters({ typeId: e.target.value })}>
            <option value="All">All Types</option>
            {equipmentTypes.map(t => <option key={t.type_id} value={t.type_id}>{t.name}</option>)}
          </select>
          {!viewRetired && (
            <select className="input w-40" value={statusFilter} onChange={e => setEquipmentFilters({ status: e.target.value })}>
              <option value="All">All Statuses</option>
              {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          )}
          {hasActiveFilters && (
            <button onClick={() => setEquipmentFilters({ search:'', status:'All', typeId:'All' })}
              className="btn-secondary text-xs px-3 whitespace-nowrap">Clear</button>
          )}
        </div>
      </div>

      {/* Procured items banner */}
      {!viewRetired && procuredItems.length > 0 && (
        <div className="card p-4 bg-purple-50 border border-purple-100">
          <p className="text-sm font-medium text-purple-700 mb-2">
            🛒 {procuredItems.length} Procured Item{procuredItems.length !== 1 ? 's' : ''} in Fleet
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {procuredItems.slice(0, 4).map(u => (
              <div key={u.equipment_id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-xs">
                <span className="font-medium text-gray-700">{u.equipment_types?.name} {u.capacity}</span>
                <div className="flex items-center gap-2">
                  <span className={clsx('badge border text-xs',
                    u.procurements?.type === 'Lease'
                      ? 'bg-purple-50 text-purple-700 border-purple-100'
                      : 'bg-blue-50 text-blue-700 border-blue-100')}>
                    {u.procurements?.type ?? 'Purchase'}
                  </span>
                  <StatusBadge status={u.status}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <LoadingSpinner fullscreen={false}/> : displayedUnits.length === 0 ? (
        <EmptyState message={viewRetired ? 'No retired equipment' : 'No equipment matches your search'} icon={Package}/>
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
                    {viewRetired && <th className="text-left px-5 py-3">Retire Reason</th>}
                    {canWrite && !viewRetired && <th className="text-left px-5 py-3">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayedUnits.map(u => (
                    <tr key={u.equipment_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">{u.equipment_id}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{u.equipment_types?.name}</p>
                        <p className="text-xs text-gray-400">{u.equipment_types?.category}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{u.serial_number ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-600">{u.capacity ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{u.location ?? '—'}</td>
                      <td className="px-5 py-3 font-medium text-gray-700">KWD {Number(u.daily_rate_kwd).toLocaleString()}</td>
                      <td className="px-5 py-3 text-xs">
                        {u.procurement_id ? (
                          <div>
                            <span className={clsx('badge border text-xs',
                              u.procurements?.type === 'Lease'
                                ? 'bg-purple-50 text-purple-700 border-purple-100'
                                : 'bg-blue-50 text-blue-700 border-blue-100')}>
                              {u.procurements?.type ?? 'Purchase'}
                            </span>
                            {u.procurements?.type === 'Lease' && u.procurements?.lease_end_date && (
                              <p className="text-gray-400 mt-0.5">Until {format(new Date(u.procurements.lease_end_date),'dd MMM yy')}</p>
                            )}
                          </div>
                        ) : <span className="text-gray-300">Own</span>}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {u.expected_return_date ? (
                          <span className="text-orange-600 font-medium">{format(new Date(u.expected_return_date),'dd MMM yyyy')}</span>
                        ) : u.status === 'Available' ? (
                          <span className="text-green-500">In yard</span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={u.status}/></td>
                      {viewRetired && (
                        <td className="px-5 py-3 text-xs text-gray-500 max-w-xs">
                          <p className="truncate">{u.retire_reason ?? '—'}</p>
                          {u.retire_date && <p className="text-gray-400">{format(new Date(u.retire_date),'dd MMM yyyy')}</p>}
                        </td>
                      )}
                      {canWrite && !viewRetired && (
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <select
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                              value={u.status}
                              onChange={e => handleStatusChange(u, e.target.value)}
                              onClick={e => e.stopPropagation()}>
                              {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
                            </select>
                            <button onClick={() => openEdit(u)} className="text-xs text-primary-500 hover:underline">Edit</button>
                            <button onClick={() => setPreviewUnit(u)} className="text-gray-400 hover:text-gray-600"><Eye size={14}/></button>
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
            {displayedUnits.map(u => (
              <div key={u.equipment_id} className="card p-4">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{u.equipment_types?.name}</p>
                  <StatusBadge status={u.status}/>
                </div>
                <p className="text-xs text-gray-400">{u.equipment_id} · {u.serial_number ?? '—'} · {u.capacity}</p>
                <p className="text-xs text-gray-500 mt-1">{u.location ?? '—'} · KWD {Number(u.daily_rate_kwd).toLocaleString()}/day</p>
                {u.expected_return_date && (
                  <p className="text-xs text-orange-600 mt-1 font-medium">Return: {format(new Date(u.expected_return_date),'dd MMM yyyy')}</p>
                )}
                {u.retire_reason && viewRetired && (
                  <p className="text-xs text-gray-400 mt-1">Retired: {u.retire_reason}</p>
                )}
                {canWrite && !viewRetired && (
                  <div className="flex gap-2 mt-2">
                    <select
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 flex-1"
                      value={u.status}
                      onChange={e => handleStatusChange(u, e.target.value)}>
                      {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                    <button onClick={() => openEdit(u)} className="text-xs text-primary-500 hover:underline px-2">Edit</button>
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
              <h3 className="font-semibold text-gray-900">{selected ? 'Edit Equipment Unit' : 'Add Equipment Unit'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Equipment Type *</label>
                <select className="input" value={form.type_id}
                  onChange={e => handleTypeChange(e.target.value)} required>
                  <option value="">Select type…</option>
                  {equipmentTypes.map(t => <option key={t.type_id} value={t.type_id}>{t.name}</option>)}
                </select>
              </div>

              {/* Serial number with auto-suggest */}
              <div ref={serialRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
                <input className="input"
                  placeholder={serialSuggestions.length > 0 ? 'Type or select existing serial…' : 'e.g. FLT-010 (new unit)'}
                  value={form.serial_number}
                  onChange={e => { setForm(f=>({...f, serial_number:e.target.value})); setShowSerialDrop(true); }}
                  onFocus={() => setShowSerialDrop(true)}
                  autoComplete="off"/>

                {showSerialDrop && serialSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 overflow-hidden">
                    <p className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                      Existing serials for this type — select to add another unit, or type a new one:
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                      {serialSuggestions
                        .filter(s => !form.serial_number || s.serial_number.toLowerCase().includes(form.serial_number.toLowerCase()))
                        .map(s => (
                          <button key={s.equipment_id} type="button"
                            onClick={() => handleSerialSelect(s)}
                            className="w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0">
                            <span className="font-medium text-gray-700">{s.serial_number}</span>
                            {s.capacity && <span className="text-gray-400 ml-2">· {s.capacity}</span>}
                            <span className="text-gray-300 ml-2">({s.equipment_id})</span>
                          </button>
                        ))}
                    </div>
                    <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
                      <button type="button" onClick={() => setShowSerialDrop(false)}
                        className="text-xs text-primary-500 hover:underline">
                        + This is a new serial number
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                  <input className="input" value={form.capacity}
                    onChange={e => setForm(f=>({...f, capacity:e.target.value}))} placeholder="e.g. 50 Ton"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Daily Rate (KWD) *</label>
                  <input type="number" min="0" step="0.001" className="input" value={form.daily_rate_kwd}
                    onChange={e => setForm(f=>({...f, daily_rate_kwd:e.target.value}))} required/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year of Manufacture</label>
                  <input type="number" className="input" value={form.year_of_manufacture}
                    onChange={e => setForm(f=>({...f, year_of_manufacture:e.target.value}))} placeholder="e.g. 2020"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="input" value={form.status}
                    onChange={e => setForm(f=>({...f, status:e.target.value}))}>
                    {ALL_STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input className="input" value={form.location}
                  onChange={e => setForm(f=>({...f, location:e.target.value}))} placeholder="e.g. Ahmadi Depot"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input resize-y" rows={2} value={form.notes}
                  onChange={e => setForm(f=>({...f, notes:e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Saving…' : selected ? 'Update' : 'Add Unit'}
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
              <Wrench size={18} className="text-orange-500"/> Set Equipment to Maintenance
            </h3>
            <div className="bg-orange-50 rounded-xl p-3 text-sm text-orange-700">
              <p className="font-medium">{maintenanceModal.equipment_types?.name} {maintenanceModal.capacity}</p>
              <p className="text-xs text-orange-500 mt-0.5">{maintenanceModal.equipment_id}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Issue Description *</label>
              <textarea className="input resize-y" rows={3} value={maintenanceIssue}
                onChange={e => setMaintenanceIssue(e.target.value)}
                placeholder="Describe the maintenance issue…" autoFocus/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Issue Type</label>
              <select className="input" value={maintenanceType} onChange={e => setMaintenanceType(e.target.value)}>
                {ISSUE_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setMaintenanceModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleMaintenanceConfirm} disabled={formLoading || !maintenanceIssue.trim()}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {formLoading && <Loader2 size={14} className="animate-spin"/>}
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
              <Archive size={18} className="text-gray-500"/> Retire Equipment
            </h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">{retireTarget.equipment_types?.name} {retireTarget.capacity}</span>
              {' '}— {retireTarget.equipment_id}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Retirement <span className="text-red-500">*</span>
              </label>
              <textarea className="input resize-y" rows={3} value={retireReason}
                onChange={e => setRetireReason(e.target.value)}
                placeholder="e.g. End of service life, irreparable damage…"/>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setRetireTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleRetireConfirm} disabled={retiring || !retireReason.trim()}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {retiring && <Loader2 size={14} className="animate-spin"/>}
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
                <h3 className="font-semibold text-gray-900">{previewUnit.equipment_id}</h3>
                <p className="text-sm text-gray-400">{previewUnit.equipment_types?.name} · {previewUnit.capacity}</p>
              </div>
              <button onClick={() => setPreviewUnit(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-400">Serial</p><p className="font-medium">{previewUnit.serial_number ?? '—'}</p></div>
                <div><p className="text-xs text-gray-400">Capacity</p><p className="font-medium">{previewUnit.capacity ?? '—'}</p></div>
                <div><p className="text-xs text-gray-400">Location</p><p className="font-medium">{previewUnit.location ?? '—'}</p></div>
                <div><p className="text-xs text-gray-400">Daily Rate</p><p className="font-medium">KWD {Number(previewUnit.daily_rate_kwd).toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-400">Year</p><p className="font-medium">{previewUnit.year_of_manufacture ?? '—'}</p></div>
                <div><p className="text-xs text-gray-400">Status</p><StatusBadge status={previewUnit.status}/></div>
              </div>

              {previewUnit.procurement_id && (
                <div className="bg-purple-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-purple-600 mb-1">Procurement Source</p>
                  <p className="text-sm text-purple-800">{previewUnit.procurements?.title}</p>
                  <p className="text-xs text-purple-500">
                    {previewUnit.procurements?.type}
                    {previewUnit.procurements?.lease_end_date && ` · Lease until ${format(new Date(previewUnit.procurements.lease_end_date),'dd MMM yyyy')}`}
                  </p>
                </div>
              )}

              {previewUnit.expected_return_date && (
                <div className="bg-orange-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-orange-600">Expected Return</p>
                  <p className="text-sm font-medium text-orange-700">{format(new Date(previewUnit.expected_return_date),'dd MMM yyyy')}</p>
                </div>
              )}

              {previewUnit.notes && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-gray-500">Notes</p>
                  <p className="text-sm text-gray-700 mt-0.5">{previewUnit.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}