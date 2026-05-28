import { useEffect, useCallback, useState } from 'react';
import { getRequirements } from '../../api/requirements';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import { useAppStore } from '../../store/useAppStore';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import RequirementForm from '../../components/requirements/RequirementForm';
import RequirementDetail from '../../components/requirements/RequirementDetail';
import { supabase } from '../../lib/supabaseClient';
import {
  Plus, Search, Filter, RefreshCw, ClipboardList,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUSES   = ['All','Pending Review','Operations Review','Quotation In Progress','Quoted','Approved','Rejected','Completed','Cancelled'];
const PRIORITIES = ['All','Low','Normal','High','Urgent'];

const PRIORITY_COLORS = {
  Low:    'bg-gray-100 text-gray-500',
  Normal: 'bg-blue-50 text-blue-600',
  High:   'bg-orange-50 text-orange-600',
  Urgent: 'bg-red-50 text-red-700',
};

export default function RequirementsPage() {
  const { profile, role } = useAuth();

  const {
    requirements, requirementsLoaded, requirementsFilters,
    setRequirements, setRequirementsFilters, clearRequirementsCache,
  } = useAppStore();

  const [loading,      setLoading]      = useState(!requirementsLoaded);
  const [showForm,     setShowForm]     = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [showFilters,  setShowFilters]  = useState(false);

  const { search, status, priority, dateFrom, dateTo, customer } = requirementsFilters;

  const canCreate = hasPermission(role, 'requirements_create');
  const canReview = hasPermission(role, 'requirements_review');

  const load = useCallback(async (force = false) => {
    if (requirementsLoaded && !force) return;
    setLoading(true);
    try {
      const filters = {};
      if (role === 'Sales Executive') filters.created_by = profile.user_id;
      const data = await getRequirements(filters);
      setRequirements(data);
    } catch {
      toast.error('Failed to load requirements');
    } finally {
      setLoading(false);
    }
  }, [requirementsLoaded, role, profile, setRequirements]);

  useEffect(() => { load(); }, [load]);

  // Realtime — only refresh if data changes, don't reload the whole page
  useEffect(() => {
    const channel = supabase
      .channel('requirements-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requirements' }, () => {
        clearRequirementsCache();
        load(true);
      })
      .subscribe();
    return () => channel.unsubscribe();
  }, [clearRequirementsCache, load]);

  // Client-side filtering
  const filtered = requirements.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      r.requirement_id?.toLowerCase().includes(q) ||
      r.requirement_summary?.toLowerCase().includes(q) ||
      r.customers?.company_name?.toLowerCase().includes(q) ||
      r.location?.toLowerCase().includes(q) ||
      r.requested_by?.toLowerCase().includes(q) ||
      r.users?.name?.toLowerCase().includes(q);

    const matchStatus   = status === 'All'   || r.status === status;
    const matchPriority = priority === 'All' || r.priority === priority;
    const matchDateFrom = !dateFrom || r.created_at >= dateFrom;
    const matchDateTo   = !dateTo   || r.created_at <= dateTo + 'T23:59:59';
    const matchCustomer = !customer || r.customers?.company_name?.toLowerCase().includes(customer.toLowerCase());

    return matchSearch && matchStatus && matchPriority && matchDateFrom && matchDateTo && matchCustomer;
  });

  const hasActiveFilters = status !== 'All' || priority !== 'All' || search || dateFrom || dateTo || customer;

  const clearFilters = () => setRequirementsFilters({
    search: '', status: 'All', priority: 'All', dateFrom: '', dateTo: '', customer: '',
  });

  if (showForm || editTarget) {
    return (
      <RequirementForm
        existing={editTarget}
        onSuccess={() => {
          setShowForm(false); setEditTarget(null);
          clearRequirementsCache(); load(true);
        }}
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
          <p className="text-sm text-gray-400">
            {filtered.length} of {requirements.length} shown
            {hasActiveFilters && ' (filtered)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { clearRequirementsCache(); load(true); }}
            className="btn-secondary p-2" title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={clsx('btn-secondary flex items-center gap-2', hasActiveFilters && 'ring-2 ring-primary-300')}
          >
            <Filter size={15} />
            Filters
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-primary-500" />
            )}
          </button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> New Requirement
            </button>
          )}
        </div>
      </div>

      {/* Search bar — always visible */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9 w-full"
          placeholder="Search by ID, summary, customer, location, contact, creator…"
          value={search}
          onChange={e => setRequirementsFilters({ search: e.target.value })}
        />
        {search && (
          <button onClick={() => setRequirementsFilters({ search: '' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Expanded filters panel */}
      {showFilters && (
        <div className="card p-4 space-y-4 border-2 border-primary-100">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Filters</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                <X size={12} /> Clear all
              </button>
            )}
          </div>

          {/* Status chips */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => setRequirementsFilters({ status: s })}
                  className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    status === s
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Priority chips */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Priority</p>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => setRequirementsFilters({ priority: p })}
                  className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                    priority === p
                      ? 'bg-primary-500 text-white border-primary-500'
                      : `${PRIORITY_COLORS[p] ?? 'bg-gray-100 text-gray-600'} border-transparent`
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Date range + Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
              <input
                className="input text-sm"
                placeholder="Filter by customer…"
                value={customer}
                onChange={e => setRequirementsFilters({ customer: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
              <input type="date" className="input text-sm" value={dateFrom} onChange={e => setRequirementsFilters({ dateFrom: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
              <input type="date" className="input text-sm" value={dateTo} onChange={e => setRequirementsFilters({ dateTo: e.target.value })} />
            </div>
          </div>
        </div>
      )}

      {/* Active filter pills */}
      {hasActiveFilters && !showFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-400">Active:</span>
          {status !== 'All'   && <FilterPill label={`Status: ${status}`}   onRemove={() => setRequirementsFilters({ status: 'All' })} />}
          {priority !== 'All' && <FilterPill label={`Priority: ${priority}`} onRemove={() => setRequirementsFilters({ priority: 'All' })} />}
          {customer           && <FilterPill label={`Customer: ${customer}`} onRemove={() => setRequirementsFilters({ customer: '' })} />}
          {dateFrom           && <FilterPill label={`From: ${dateFrom}`}     onRemove={() => setRequirementsFilters({ dateFrom: '' })} />}
          {dateTo             && <FilterPill label={`To: ${dateTo}`}         onRemove={() => setRequirementsFilters({ dateTo: '' })} />}
          <button onClick={clearFilters} className="text-xs text-red-400 hover:underline">Clear all</button>
        </div>
      )}

      {/* Results */}
      {loading ? <LoadingSpinner fullscreen={false} /> : filtered.length === 0 ? (
        <EmptyState
          message={hasActiveFilters ? 'No requirements match your filters' : 'No requirements yet'}
          icon={ClipboardList}
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
                    <th className="text-left px-5 py-3">Summary</th>
                    <th className="text-left px-5 py-3">Customer</th>
                    <th className="text-left px-5 py-3">Location</th>
                    <th className="text-left px-5 py-3">Priority</th>
                    <th className="text-left px-5 py-3">Status</th>
                    <th className="text-left px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(r => (
                    <tr key={r.requirement_id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setSelected(r.requirement_id)}>
                      <td className="px-5 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">{r.requirement_id}</td>
                      <td className="px-5 py-3 max-w-xs">
                        <p className="font-medium text-gray-800 truncate">{r.requirement_summary}</p>
                        <p className="text-xs text-gray-400">{r.requested_by}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{r.customers?.company_name}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">{r.location ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className={clsx('badge text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLORS[r.priority ?? 'Normal'])}>
                          {r.priority ?? 'Normal'}
                        </span>
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={r.status}/></td>
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {format(new Date(r.created_at), 'dd MMM yyyy, HH:mm')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(r => (
              <div
                key={r.requirement_id}
                className="card p-4 cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => setSelected(r.requirement_id)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-gray-800 text-sm leading-snug flex-1">{r.requirement_summary}</p>
                  <StatusBadge status={r.status} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-gray-400 mb-2">
                  <span>{r.customers?.company_name}</span>
                  {r.location && <span>· {r.location}</span>}
                  <span>· {format(new Date(r.created_at), 'dd MMM yyyy, HH:mm')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-300">{r.requirement_id}</span>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', PRIORITY_COLORS[r.priority ?? 'Normal'])}>
                    {r.priority ?? 'Normal'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterPill({ label, onRemove }) {
  return (
    <span className="flex items-center gap-1 px-2 py-1 bg-primary-50 text-primary-700 text-xs rounded-full border border-primary-100">
      {label}
      <button onClick={onRemove} className="text-primary-400 hover:text-primary-700"><X size={11} /></button>
    </span>
  );
}