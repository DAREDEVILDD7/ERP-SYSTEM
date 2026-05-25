import { useEffect, useState, useCallback } from 'react';
import { getDispatches, createDispatch, updateDispatch } from '../../api/dispatch';
import { getEquipmentUnits } from '../../api/equipment';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { Plus, Truck, X, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

const STATUSES     = ['All','Pending','Assigned','In Transit','Completed','Cancelled'];
const DSP_STATUSES = ['Pending','Assigned','In Transit','Completed','Cancelled'];

const EMPTY_FORM = { equipment_id:'', driver_name:'', vehicle_type:'', vehicle_plate:'', destination:'', dispatch_date:'', return_date:'', notes:'', status:'Pending' };

export default function DispatchManagePage() {
  const { profile, role } = useAuth();
  const [dispatches,   setDispatches]   = useState([]);
  const [equipment,    setEquipment]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal,    setShowModal]    = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [formLoading,  setFormLoading]  = useState(false);

  const canWrite = hasPermission(role, 'dispatch_create');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([
        getDispatches(statusFilter !== 'All' ? { status: statusFilter } : {}),
        getEquipmentUnits(),
      ]);
      setDispatches(d);
      setEquipment(e);
    } catch { toast.error('Failed to load dispatches'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('dispatch-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatches' }, load)
      .subscribe();
    return () => ch.unsubscribe();
  }, [load]);

  const openAdd  = () => { setForm(EMPTY_FORM); setSelected(null); setShowModal(true); };
  const openEdit = (d) => {
    setForm({ equipment_id: d.equipment_id, driver_name: d.driver_name??'', vehicle_type: d.vehicle_type??'', vehicle_plate: d.vehicle_plate??'', destination: d.destination, dispatch_date: d.dispatch_date??'', return_date: d.return_date??'', notes: d.notes??'', status: d.status });
    setSelected(d);
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.equipment_id) return toast.error('Select equipment');
    if (!form.destination)  return toast.error('Enter destination');
    setFormLoading(true);
    try {
      if (selected) {
        await updateDispatch(selected.dispatch_id, form);
        toast.success('Dispatch updated');
      } else {
        await createDispatch({ ...form, assigned_by: profile.user_id });
        toast.success('Dispatch created');
      }
      setShowModal(false);
      load();
    } catch (err) { toast.error(err.message || 'Failed to save');
    } finally { setFormLoading(false); }
  };

  const quickStatus = async (id, status) => {
    try {
      await updateDispatch(id, { status });
      toast.success(`Marked as ${status}`);
      load();
    } catch { toast.error('Failed to update'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dispatch Management</h2>
          <p className="text-sm text-gray-400">{dispatches.length} dispatches</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16} /></button>
          {canWrite && <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={16} /> New Dispatch</button>}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex gap-2 overflow-x-auto">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : dispatches.length === 0 ? <EmptyState message="No dispatches found" icon={Truck} /> : (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">ID</th>
                  <th className="text-left px-5 py-3">Equipment</th>
                  <th className="text-left px-5 py-3">Driver</th>
                  <th className="text-left px-5 py-3">Destination</th>
                  <th className="text-left px-5 py-3">Dispatch Date</th>
                  <th className="text-left px-5 py-3">Status</th>
                  {canWrite && <th className="text-left px-5 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dispatches.map(d => (
                  <tr key={d.dispatch_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{d.dispatch_id}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{d.equipment_units?.equipment_types?.name}</p>
                      <p className="text-xs text-gray-400">{d.equipment_units?.capacity} · {d.equipment_units?.equipment_id}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{d.driver_name || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{d.destination}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{d.dispatch_date ? format(new Date(d.dispatch_date), 'dd MMM yyyy') : '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                    {canWrite && (
                      <td className="px-5 py-3 flex items-center gap-2">
                        {d.status === 'Assigned'   && <button onClick={() => quickStatus(d.dispatch_id, 'In Transit')} className="text-xs btn-primary py-1">→ Transit</button>}
                        {d.status === 'In Transit' && <button onClick={() => quickStatus(d.dispatch_id, 'Completed')} className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg">✓ Done</button>}
                        {d.status === 'Pending'    && <button onClick={() => quickStatus(d.dispatch_id, 'Assigned')}  className="text-xs btn-primary py-1">Assign</button>}
                        <button onClick={() => openEdit(d)} className="text-xs text-primary-500 hover:underline">Edit</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {dispatches.map(d => (
              <div key={d.dispatch_id} className="card p-4" onClick={() => canWrite && openEdit(d)}>
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{d.equipment_units?.equipment_types?.name} · {d.equipment_units?.capacity}</p>
                  <StatusBadge status={d.status} />
                </div>
                <p className="text-xs text-gray-500">Driver: {d.driver_name || '—'}</p>
                <p className="text-xs text-gray-500">→ {d.destination}</p>
                {d.dispatch_date && <p className="text-xs text-gray-400 mt-1">{format(new Date(d.dispatch_date), 'dd MMM yyyy')}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{selected ? 'Edit Dispatch' : 'New Dispatch'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Equipment *</label>
                <select className="input" value={form.equipment_id} onChange={e => setForm(f => ({ ...f, equipment_id: e.target.value }))} required>
                  <option value="">Select equipment…</option>
                  {equipment.map(e => (
                    <option key={e.equipment_id} value={e.equipment_id}>
                      {e.equipment_id} — {e.equipment_types?.name} {e.capacity} ({e.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
                  <input className="input" value={form.driver_name} onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))} placeholder="Full name" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                  <input className="input" value={form.vehicle_type} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))} placeholder="e.g. Flatbed Trailer" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Plate</label>
                  <input className="input" value={form.vehicle_plate} onChange={e => setForm(f => ({ ...f, vehicle_plate: e.target.value }))} placeholder="e.g. KWI 12345" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {DSP_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dispatch Date</label>
                  <input type="date" className="input" value={form.dispatch_date} onChange={e => setForm(f => ({ ...f, dispatch_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected Return</label>
                  <input type="date" className="input" value={form.return_date} onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destination *</label>
                <input className="input" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Ahmadi Refinery" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : selected ? 'Update' : 'Create Dispatch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}