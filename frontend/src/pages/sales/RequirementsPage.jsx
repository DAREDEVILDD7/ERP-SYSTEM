import { useEffect, useState, useCallback } from 'react';
import { getRequirements } from '../../api/requirements';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import RequirementForm from '../../components/requirements/RequirementForm';
import RequirementDetail from '../../components/requirements/RequirementDetail';
import { Plus, Search, Filter, RefreshCw, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

const STATUSES = [
  'All','Pending Review','Operations Review','Quotation In Progress',
  'Quoted','Approved','Rejected','Completed','Cancelled',
];

export default function RequirementsPage() {
  const { profile, role } = useAuth();

  const [requirements, setRequirements] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm,     setShowForm]     = useState(false);
  const [selected,     setSelected]     = useState(null); // detail view
  const [editTarget,   setEditTarget]   = useState(null); // edit form

  const canCreate = hasPermission(role, 'requirements_create');
  const canReview = hasPermission(role, 'requirements_review');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {};
      // Sales can only see their own
      if (role === 'Sales Executive') filters.created_by = profile.user_id;
      if (statusFilter !== 'All')     filters.status = statusFilter;
      if (search)                     filters.search = search;
      const data = await getRequirements(filters);
      setRequirements(data);
    } catch (err) {
      toast.error('Failed to load requirements');
    } finally {
      setLoading(false);
    }
  }, [role, profile, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('requirements-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requirements' }, () => load())
      .subscribe();
    return () => channel.unsubscribe();
  }, [load]);

  const handleStatusUpdate = async (reqId, newStatus) => {
    try {
      const { error } = await supabase
        .from('requirements')
        .update({ status: newStatus })
        .eq('requirement_id', reqId);
      if (error) throw error;
      toast.success(`Status updated to "${newStatus}"`);
      load();
    } catch {
      toast.error('Failed to update status');
    }
  };

  if (showForm || editTarget) {
    return (
      <RequirementForm
        existing={editTarget}
        onSuccess={() => { setShowForm(false); setEditTarget(null); load(); }}
        onCancel={() => { setShowForm(false); setEditTarget(null); }}
      />
    );
  }

  if (selected) {
    return (
      <RequirementDetail
        requirementId={selected}
        onBack={() => setSelected(null)}
        onEdit={(req) => { setSelected(null); setEditTarget(req); }}
        onStatusChange={handleStatusUpdate}
        canReview={canReview}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Requirements</h2>
          <p className="text-sm text-gray-400">{requirements.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary p-2" title="Refresh">
            <RefreshCw size={16} />
          </button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> New Requirement
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search requirements…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-gray-400 shrink-0" />
          <select
            className="input w-48"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Table — desktop */}
      {loading ? <LoadingSpinner fullscreen={false} /> : (
        <>
          {requirements.length === 0 ? (
            <EmptyState message="No requirements found" icon={ClipboardList} />
          ) : (
            <>
              {/* Desktop table */}
              <div className="card hidden md:block overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                        <th className="text-left px-5 py-3">ID</th>
                        <th className="text-left px-5 py-3">Summary</th>
                        <th className="text-left px-5 py-3">Customer</th>
                        <th className="text-left px-5 py-3">Location</th>
                        <th className="text-left px-5 py-3">Priority</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-left px-5 py-3">Date</th>
                        {canReview && <th className="text-left px-5 py-3">Action</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {requirements.map(r => (
                        <tr
                          key={r.requirement_id}
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => setSelected(r.requirement_id)}
                        >
                          <td className="px-5 py-3 font-mono text-xs text-gray-400">{r.requirement_id}</td>
                          <td className="px-5 py-3 max-w-xs">
                            <p className="font-medium text-gray-800 truncate">{r.requirement_summary}</p>
                            <p className="text-xs text-gray-400">{r.requested_by}</p>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{r.customers?.company_name}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{r.location ?? '—'}</td>
                          <td className="px-5 py-3"><StatusBadge status={r.priority ?? 'Normal'} /></td>
                          <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                          <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {format(new Date(r.created_at), 'dd MMM yyyy')}
                          </td>
                          {canReview && (
                            <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                              <select
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                value={r.status}
                                onChange={e => handleStatusUpdate(r.requirement_id, e.target.value)}
                              >
                                {STATUSES.filter(s => s !== 'All').map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
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
                {requirements.map(r => (
                  <div
                    key={r.requirement_id}
                    className="card p-4 cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => setSelected(r.requirement_id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-gray-800 text-sm leading-snug flex-1">{r.requirement_summary}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{r.customers?.company_name}</span>
                      <span>{format(new Date(r.created_at), 'dd MMM yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="font-mono text-xs text-gray-300">{r.requirement_id}</span>
                      {r.location && <span className="text-xs text-gray-400">· {r.location}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}