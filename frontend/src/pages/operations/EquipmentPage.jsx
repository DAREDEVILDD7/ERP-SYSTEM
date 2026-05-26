import { useEffect, useCallback, useState } from 'react';
import { getEquipmentUnitsWithProcurement, getEquipmentTypes, createEquipmentUnit, updateEquipmentUnit } from '../../api/equipment';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import { useAppStore } from '../../store/useAppStore';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { Plus, Search, Package, RefreshCw, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const ALL_STATUSES = ['Available','Reserved','Dispatched','Maintenance','Retired'];

const STATUS_RING = {
  Available:   'ring-green-300 bg-green-50 text-green-700',
  Reserved:    'ring-yellow-300 bg-yellow-50 text-yellow-700',
  Dispatched:  'ring-blue-300 bg-blue-50 text-blue-700',
  Maintenance: 'ring-red-300 bg-red-50 text-red-700',
  Retired:     'ring-gray-300 bg-gray-50 text-gray-500',
};

export default function EquipmentPage() {
  const { role } = useAuth();

  const {
    equipmentUnits, equipmentTypes, equipmentLoaded, equipmentFilters,
    setEquipmentUnits, setEquipmentTypes, setEquipmentFilters, clearEquipmentCache,
  } = useAppStore();

  const [loading,     setLoading]     = useState(!equipmentLoaded);
  const [showModal,   setShowModal]   = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [formLoading, setFormLoading] = useState(false);
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

  // Status counts always from ALL units
  const statusCounts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = equipmentUnits.filter(u => u.status === s).length;
    return acc;
  }, {});

  // Client-side filter
  const filtered = equipmentUnits.filter(u => {
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

  const hasActiveFilters = statusFilter !== 'All' || typeFilter !== 'All' || search;

  const openAdd = () => {
    setForm({ type_id:'', serial_number:'', capacity:'', status:'Available', location:'', daily_rate_kwd:'', year_of_manufacture:'', notes:'' });
    setSelected(null); setShowModal(true);
  };

  const openEdit = (unit) => {
    setForm({
      type_id: unit.type_id, serial_number: unit.serial_number??'',
      capacity: unit.capacity??'', status: unit.status,
      location: unit.location??'', daily_rate_kwd: unit.daily_rate_kwd,
      year_of_manufacture: unit.year_of_manufacture??'', notes: unit.notes??'',
    });
    setSelected(unit); setShowModal(true);
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

  const handleStatusChange = async (unitId, newStatus) => {
    try {
      await updateEquipmentUnit(unitId, { status: newStatus });
      toast.success('Status updated');
      // Optimistic local update
      setEquipmentUnits(equipmentUnits.map(u => u.equipment_id === unitId ? { ...u, status: newStatus } : u));
    } catch { toast.error('Failed to update status'); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Equipment Fleet</h2>
          <p className="text-sm text-gray-400">{filtered.length} of {equipmentUnits.length} shown</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { clearEquipmentCache(); load(true); }} className="btn-secondary p-2"><RefreshCw size={16} /></button>
          {canWrite && <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Unit</button>}
        </div>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {ALL_STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setEquipmentFilters({ status: statusFilter === s ? 'All' : s })}
            className={clsx(
              'card p-3 text-center transition-all ring-0 hover:shadow-md',
              statusFilter === s && `ring-2 ${STATUS_RING[s]}`
            )}
          >
            <p className="text-2xl font-bold text-gray-800">{statusCounts[s]}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search by type, ID, serial, capacity, location, category…"
              value={search}
              onChange={e => setEquipmentFilters({ search: e.target.value })}
            />
            {search && (
              <button onClick={() => setEquipmentFilters({ search: '' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <select className="input w-48" value={typeFilter}
            onChange={e => setEquipmentFilters({ typeId: e.target.value })}>
            <option value="All">All Types</option>
            {equipmentTypes.map(t => <option key={t.type_id} value={t.type_id}>{t.name}</option>)}
          </select>
          <select className="input w-40" value={statusFilter}
            onChange={e => setEquipmentFilters({ status: e.target.value })}>
            <option value="All">All Statuses</option>
            {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => setEquipmentFilters({ search:'', status:'All', typeId:'All' })}
              className="btn-secondary text-xs px-3 whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : filtered.length === 0 ? (
        <EmptyState message="No equipment matches your search" icon={Package} />
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
                    {canWrite && <th className="text-left px-5 py-3">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(u => (
                    <tr key={u.equipment_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">{u.equipment_id}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{u.equipment_types?.name}</p>
                        <p className="text-xs text-gray-400">{u.equipment_types?.category}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{u.serial_number ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-600">{u.capacity ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{u.location ?? '—'}</td>
                      <td className="px-5 py-3 font-medium text-gray-700">
                        KWD {Number(u.daily_rate_kwd).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {u.procurement_id ? (
                          <div>
                            <span className={clsx('badge border text-xs',
                              u.procurement_type === 'Lease'
                                ? 'bg-purple-50 text-purple-700 border-purple-100'
                                : 'bg-blue-50 text-blue-700 border-blue-100'
                            )}>
                              {u.procurement_type ?? 'Purchase'}
                            </span>
                            {u.procurement_type === 'Lease' && u.lease_end_date && (
                              <p className="text-gray-400 mt-0.5 text-xs">
                                Until {format(new Date(u.lease_end_date), 'dd MMM yyyy')}
                              </p>
                            )}
                          </div>
                        ) : <span className="text-gray-300">Own fleet</span>}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {u.expected_return_date ? (
                          <span className="text-orange-600 font-medium">
                            {format(new Date(u.expected_return_date), 'dd MMM yyyy')}
                          </span>
                        ) : u.status === 'Available' ? (
                          <span className="text-green-500 text-xs">In yard</span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={u.status} /></td>
                      {canWrite && (
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <select
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                              value={u.status}
                              onChange={e => handleStatusChange(u.equipment_id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                            >
                              {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
                            </select>
                            <button onClick={() => openEdit(u)} className="text-xs text-primary-500 hover:underline">Edit</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(u => (
              <div key={u.equipment_id} className="card p-4" onClick={() => canWrite && openEdit(u)}>
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{u.equipment_types?.name}</p>
                  <StatusBadge status={u.status} />
                </div>
                <p className="text-xs text-gray-400">{u.equipment_id} · {u.serial_number ?? '—'} · {u.capacity}</p>
                <p className="text-xs text-gray-500 mt-1">{u.location ?? '—'} · KWD {Number(u.daily_rate_kwd).toLocaleString()}/day</p>
                {u.expected_return_date && (
                  <p className="text-xs text-orange-600 mt-1 font-medium">
                    Return: {format(new Date(u.expected_return_date), 'dd MMM yyyy')}
                  </p>
                )}
                {u.procurement_id && (
                  <span className={clsx('mt-1 inline-block badge border text-xs',
                    u.procurement_type === 'Lease' ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                  )}>
                    {u.procurement_type ?? 'Purchase'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{selected ? 'Edit Equipment Unit' : 'Add Equipment Unit'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Equipment Type *</label>
                <select className="input" value={form.type_id} onChange={e => setForm(f => ({ ...f, type_id: e.target.value }))} required>
                  <option value="">Select type…</option>
                  {equipmentTypes.map(t => <option key={t.type_id} value={t.type_id}>{t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
                  <input className="input" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="e.g. FLT-010" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                  <input className="input" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} placeholder="e.g. 50 Ton" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Daily Rate (KWD) *</label>
                  <input type="number" min="0" step="0.001" className="input" value={form.daily_rate_kwd} onChange={e => setForm(f => ({ ...f, daily_rate_kwd: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year of Manufacture</label>
                  <input type="number" className="input" value={form.year_of_manufacture} onChange={e => setForm(f => ({ ...f, year_of_manufacture: e.target.value }))} placeholder="e.g. 2020" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Ahmadi Depot" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input resize-y" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : selected ? 'Update' : 'Add Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}