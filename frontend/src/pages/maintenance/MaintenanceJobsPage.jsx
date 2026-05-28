import { useEffect, useState, useCallback } from 'react';
import {
  getMaintenanceJobs, createMaintenanceJob,
  updateMaintenanceJob, cancelMaintenanceJob, approveMaintenanceJob,
} from '../../api/maintenance';
import { getEquipmentUnits } from '../../api/equipment';
import { getUsers } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import {
  Plus, Wrench, X, Loader2, RefreshCw,
  XCircle, CheckCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUSES     = ['All','Open','In Progress','Completed','Cancelled'];
const MNT_STATUSES = ['Open','In Progress','Completed','Cancelled'];
const ISSUE_TYPES  = ['Mechanical','Electrical','Hydraulic','Tyre','Cooling','Body','Other'];

const EMPTY = {
  equipment_id:'', issue:'', issue_type:'Mechanical',
  service_date:'', cost_kwd:0, status:'Open',
  notes:'', assigned_to:'', start_date:'',
};

export default function MaintenanceJobsPage() {
  const { profile, role } = useAuth();

  const [jobs,         setJobs]         = useState([]);
  const [equipment,    setEquipment]    = useState([]);
  const [engineers,    setEngineers]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');

  // Modals
  const [showAddModal,    setShowAddModal]    = useState(false);
  const [editTarget,      setEditTarget]      = useState(null);
  const [cancelTarget,    setCancelTarget]    = useState(null);
  const [cancelReason,    setCancelReason]    = useState('');
  const [cancelling,      setCancelling]      = useState(false);
  const [completeTarget,  setCompleteTarget]  = useState(null);
  const [expandedId,      setExpandedId]      = useState(null);

  const [form,         setForm]         = useState(EMPTY);
  const [formLoading,  setFormLoading]  = useState(false);

  const canWrite = hasPermission(role, 'maintenance_create');
  const canApprove = hasPermission(role, 'maintenance_edit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, e, u] = await Promise.all([
        getMaintenanceJobs(statusFilter !== 'All' ? { status: statusFilter } : {}),
        getEquipmentUnits(),
        getUsers(),
      ]);
      setJobs(j);
      setEquipment(e);
      setEngineers(u.filter(u => ['Maintenance Engineer','Operations Manager','Admin'].includes(u.role)));
    } catch { toast.error('Failed to load maintenance jobs'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('maintenance-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' }, load)
      .subscribe();
    return () => ch.unsubscribe();
  }, [load]);

  const openAdd = () => {
    setForm({ ...EMPTY, service_date: new Date().toISOString().split('T')[0] });
    setEditTarget(null);
    setShowAddModal(true);
  };

  const openEdit = (j) => {
    setForm({
      equipment_id: j.equipment_id, issue: j.issue, issue_type: j.issue_type ?? 'Mechanical',
      service_date: j.service_date ?? '', cost_kwd: j.cost_kwd ?? 0, status: j.status,
      notes: j.notes ?? '', assigned_to: j.assigned_to ?? '', start_date: j.start_date ?? '',
    });
    setEditTarget(j);
    setShowAddModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.equipment_id) return toast.error('Select equipment');
    if (!form.issue.trim()) return toast.error('Describe the issue');
    setFormLoading(true);
    try {
      if (editTarget) {
        await updateMaintenanceJob(editTarget.maintenance_id, form);
        toast.success('Job updated');
      } else {
        await createMaintenanceJob({ ...form, reported_by: profile.user_id });
        toast.success('Maintenance job created');
      }
      setShowAddModal(false);
      load();
    } catch (err) { toast.error(err.message || 'Failed to save');
    } finally { setFormLoading(false); }
  };

  const handleApprove = async (job) => {
    try {
      await approveMaintenanceJob(job.maintenance_id, profile.user_id);
      toast.success('Job approved and started');
      load();
    } catch { toast.error('Failed to approve'); }
  };

  const handleComplete = async () => {
    try {
      await updateMaintenanceJob(completeTarget.maintenance_id, {
        status: 'Completed',
        completion_date: new Date().toISOString().split('T')[0],
      });
      toast.success(`Completed — ${completeTarget.equipment_units?.equipment_id} is now Available`);
      setCompleteTarget(null);
      load();
    } catch { toast.error('Failed to complete'); }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) return toast.error('Enter a reason for cancellation');
    setCancelling(true);
    try {
      await cancelMaintenanceJob(cancelTarget.maintenance_id, cancelReason, profile.user_id);
      toast.success('Job cancelled');
      setCancelTarget(null); setCancelReason('');
      load();
    } catch { toast.error('Failed to cancel');
    } finally { setCancelling(false); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Maintenance Jobs</h2>
          <p className="text-sm text-gray-400">{jobs.length} jobs</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16}/></button>
          {canWrite && (
            <button onClick={openAdd} className="btn-primary flex items-center gap-2">
              <Plus size={16}/> Log Issue
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

      {loading ? <LoadingSpinner fullscreen={false}/> : jobs.length === 0 ? (
        <EmptyState message="No maintenance jobs" icon={Wrench}/>
      ) : (
        <>
          {/* Desktop */}
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="w-8 px-3 py-3"></th>
                  <th className="text-left px-5 py-3">ID</th>
                  <th className="text-left px-5 py-3">Equipment</th>
                  <th className="text-left px-5 py-3">Issue</th>
                  <th className="text-left px-5 py-3">Type</th>
                  <th className="text-left px-5 py-3">Start Date</th>
                  <th className="text-left px-5 py-3">Service Date</th>
                  <th className="text-left px-5 py-3">Completion</th>
                  <th className="text-left px-5 py-3">Cost (KWD)</th>
                  <th className="text-left px-5 py-3">Approved By</th>
                  <th className="text-left px-5 py-3">Status</th>
                  {canWrite && <th className="text-left px-5 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map(j => (
                  <>
                    <tr key={j.maintenance_id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === j.maintenance_id ? null : j.maintenance_id)}>
                      <td className="px-3 py-3 text-gray-400 text-xs">{expandedId === j.maintenance_id ? '▲' : '▼'}</td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">{j.maintenance_id}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{j.equipment_units?.equipment_types?.name}</p>
                        <p className="text-xs text-gray-400">{j.equipment_units?.equipment_id} · {j.equipment_units?.location}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-700 max-w-xs">
                        <p className="truncate">{j.issue}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{j.issue_type ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {j.start_date ? format(new Date(j.start_date),'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {j.service_date ? format(new Date(j.service_date),'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {j.completion_date ? (
                          <span className="text-green-600 font-medium">{format(new Date(j.completion_date),'dd MMM yyyy')}</span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-600">{Number(j.cost_kwd ?? 0).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        {j.approver ? (
                          <div>
                            <p className="text-xs font-medium text-green-700">{j.approver.name}</p>
                            <p className="text-xs text-gray-400">{j.approver.role}</p>
                          </div>
                        ) : <span className="text-gray-300 text-xs">Pending</span>}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={j.status}/></td>
                      {canWrite && (
                        <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {j.status === 'Open' && canApprove && (
                              <button onClick={() => handleApprove(j)}
                                className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg flex items-center gap-1">
                                <CheckCircle size={11}/> Approve
                              </button>
                            )}
                            {['Open','In Progress'].includes(j.status) && (
                              <button onClick={() => setCompleteTarget(j)}
                                className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg">✓ Done</button>
                            )}
                            {!['Completed','Cancelled'].includes(j.status) && (
                              <button onClick={() => { setCancelTarget(j); setCancelReason(''); }}
                                className="text-xs bg-red-50 text-red-500 px-2 py-1 rounded-lg hover:bg-red-100">
                                <XCircle size={12}/>
                              </button>
                            )}
                            <button onClick={() => openEdit(j)} className="text-xs text-primary-500 hover:underline">Edit</button>
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* Expanded row */}
                    {expandedId === j.maintenance_id && (
                      <tr key={`${j.maintenance_id}-exp`} className="bg-gray-50/80">
                        <td colSpan={canWrite ? 12 : 11} className="px-8 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            {j.reporter && (
                              <div className="bg-white rounded-lg border border-gray-100 p-2">
                                <p className="text-gray-400">Reported By</p>
                                <p className="font-medium text-gray-700">{j.reporter.name}</p>
                              </div>
                            )}
                            {j.assignee && (
                              <div className="bg-white rounded-lg border border-gray-100 p-2">
                                <p className="text-gray-400">Assigned To</p>
                                <p className="font-medium text-gray-700">{j.assignee.name}</p>
                              </div>
                            )}
                            {j.approver && (
                              <div className="bg-green-50 rounded-lg border border-green-100 p-2">
                                <p className="text-green-600">Approved By</p>
                                <p className="font-medium text-green-700">{j.approver.name}</p>
                              </div>
                            )}
                            {j.cancelledByUser && (
                              <div className="bg-red-50 rounded-lg border border-red-100 p-2">
                                <p className="text-red-400">Cancelled By</p>
                                <p className="font-medium text-red-700">{j.cancelledByUser.name}</p>
                              </div>
                            )}
                          </div>
                          {j.cancel_reason && (
                            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100">
                              <p className="text-xs text-red-500 font-medium">Cancellation Reason</p>
                              <p className="text-xs text-red-700 mt-0.5">{j.cancel_reason}</p>
                            </div>
                          )}
                          {j.notes && (
                            <div className="mt-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                              <p className="text-xs text-yellow-600 font-medium">Notes</p>
                              <p className="text-xs text-yellow-700 mt-0.5">{j.notes}</p>
                            </div>
                          )}
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
            {jobs.map(j => (
              <div key={j.maintenance_id} className="card p-4">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{j.equipment_units?.equipment_types?.name}</p>
                  <StatusBadge status={j.status}/>
                </div>
                <p className="text-sm text-gray-600 mt-1">{j.issue}</p>
                <p className="text-xs text-gray-400 mt-0.5">{j.issue_type} · {j.equipment_units?.equipment_id}</p>
                {j.start_date && <p className="text-xs text-gray-400">Started: {format(new Date(j.start_date),'dd MMM yyyy')}</p>}
                {j.completion_date && <p className="text-xs text-green-600">Completed: {format(new Date(j.completion_date),'dd MMM yyyy')}</p>}
                {j.approver && <p className="text-xs text-green-600">Approved by: {j.approver.name}</p>}
                {j.cancel_reason && <p className="text-xs text-red-500 mt-1">Cancelled: {j.cancel_reason}</p>}
                <div className="flex gap-2 mt-2 flex-wrap">
                  {j.status === 'Open' && canApprove && (
                    <button onClick={() => handleApprove(j)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg">Approve</button>
                  )}
                  {['Open','In Progress'].includes(j.status) && (
                    <button onClick={() => setCompleteTarget(j)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg">Complete</button>
                  )}
                  {!['Completed','Cancelled'].includes(j.status) && (
                    <button onClick={() => { setCancelTarget(j); setCancelReason(''); }}
                      className="text-xs bg-red-50 text-red-500 px-3 py-1 rounded-lg border border-red-100">Cancel</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Add/Edit Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{editTarget ? 'Edit Job' : 'Log Maintenance Issue'}</h3>
              <button onClick={() => setShowAddModal(false)}><X size={18} className="text-gray-400"/></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Equipment *</label>
                <select className="input" value={form.equipment_id}
                  onChange={e => setForm(f=>({...f, equipment_id:e.target.value}))} required>
                  <option value="">Select equipment…</option>
                  {equipment.map(e => (
                    <option key={e.equipment_id} value={e.equipment_id}>
                      {e.equipment_id} — {e.equipment_types?.name} ({e.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Issue Description *</label>
                <textarea className="input" rows={3} value={form.issue}
                  onChange={e => setForm(f=>({...f, issue:e.target.value}))}
                  placeholder="Describe the issue in detail…" required/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Issue Type</label>
                  <select className="input" value={form.issue_type}
                    onChange={e => setForm(f=>({...f, issue_type:e.target.value}))}>
                    {ISSUE_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="input" value={form.status}
                    onChange={e => setForm(f=>({...f, status:e.target.value}))}>
                    {MNT_STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
                  <input type="date" className="input" value={form.service_date}
                    onChange={e => setForm(f=>({...f, service_date:e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" className="input" value={form.start_date}
                    onChange={e => setForm(f=>({...f, start_date:e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost (KWD)</label>
                  <input type="number" min="0" step="0.001" className="input" value={form.cost_kwd}
                    onChange={e => setForm(f=>({...f, cost_kwd:e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
                  <select className="input" value={form.assigned_to}
                    onChange={e => setForm(f=>({...f, assigned_to:e.target.value}))}>
                    <option value="">Unassigned</option>
                    {engineers.map(u=><option key={u.user_id} value={u.user_id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={form.notes}
                  onChange={e => setForm(f=>({...f, notes:e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Saving…' : editTarget ? 'Update' : 'Log Issue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Complete confirmation modal ── */}
      {completeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <CheckCircle size={18} className="text-green-500"/> Complete Maintenance Job
            </h3>
            <p className="text-sm text-gray-500">
              Equipment <span className="font-medium text-gray-700">{completeTarget.equipment_units?.equipment_id}</span> will automatically be set to <span className="text-green-600 font-medium">Available</span>.
            </p>
            <p className="text-sm text-gray-600">Issue: <span className="font-medium">{completeTarget.issue}</span></p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setCompleteTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleComplete}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                <CheckCircle size={15}/> Confirm Complete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel maintenance modal ── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <XCircle size={18} className="text-red-500"/> Cancel Maintenance Job
            </h3>
            <p className="text-sm text-gray-500">
              Job: <span className="font-medium text-gray-700">{cancelTarget.maintenance_id}</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Cancellation <span className="text-red-500">*</span>
              </label>
              <textarea className="input resize-y" rows={3} value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Why is this maintenance job being cancelled?"/>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setCancelTarget(null)} className="btn-secondary">Keep Job</button>
              <button onClick={handleCancel} disabled={cancelling || !cancelReason.trim()}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {cancelling && <Loader2 size={14} className="animate-spin"/>}
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}