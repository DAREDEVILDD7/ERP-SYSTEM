import { useEffect, useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getQuotations, deleteQuotation } from '../../api/quotations';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import { useAppStore } from '../../store/useAppStore';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import QuotationForm from '../../components/quotations/QuotationForm';
import QuotationDetail from '../../components/quotations/QuotationDetail';
import {
  Plus, Search, FileText, RefreshCw, Filter, X, Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUSES = ['All','Draft','Sent','Approved','Rejected','Expired','Invoiced'];

export default function QuotationsPage() {
  const { profile, role } = useAuth();
  const location = useLocation();

  const {
    quotations, quotationsLoaded, quotationsFilters,
    setQuotations, setQuotationsFilters, clearQuotationsCache,
  } = useAppStore();

  const [loading,      setLoading]      = useState(!quotationsLoaded);
  const [showForm,     setShowForm]     = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [prefilledReq, setPrefilledReq] = useState(null);
  const [showFilters,  setShowFilters]  = useState(false);
  const [deleting,     setDeleting]     = useState(null);

  const { search, status, preparedBy, dateFrom, dateTo } = quotationsFilters;

  const canCreate  = hasPermission(role, 'quotations_create');
  const canApprove = hasPermission(role, 'quotations_approve');

  useEffect(() => {
    if (location.state?.requirementId) {
      setPrefilledReq({ requirement_id: location.state.requirementId });
      setShowForm(true);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const load = useCallback(async (force = false) => {
    if (quotationsLoaded && !force) return;
    setLoading(true);
    try {
      const filters = {};
      if (role === 'Sales Executive') filters.prepared_by = profile.user_id;
      if (status !== 'All') filters.status = status;
      const data = await getQuotations(filters);
      setQuotations(data);
    } catch {
      toast.error('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [quotationsLoaded, role, profile, status, setQuotations]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('quotations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, () => {
        clearQuotationsCache();
        load(true);
      })
      .subscribe();
    return () => ch.unsubscribe();
  }, [clearQuotationsCache, load]);

  // Client-side filtering
  const filtered = quotations.filter(q => {
    const s = search.toLowerCase();
    const matchSearch = !s ||
      q.quotation_id?.toLowerCase().includes(s) ||
      q.customers?.company_name?.toLowerCase().includes(s) ||
      q.users?.name?.toLowerCase().includes(s) ||
      q.requirements?.requirement_summary?.toLowerCase().includes(s);

    const matchStatus = status === 'All' || q.status === status;

    const matchPreparedBy = !preparedBy ||
      q.users?.name?.toLowerCase().includes(preparedBy.toLowerCase());

    const matchDateFrom = !dateFrom || q.quotation_date >= dateFrom;
    const matchDateTo   = !dateTo   || q.quotation_date <= dateTo;

    return matchSearch && matchStatus && matchPreparedBy && matchDateFrom && matchDateTo;
  });

  const hasActiveFilters = status !== 'All' || search || preparedBy || dateFrom || dateTo;
  const clearFilters = () => setQuotationsFilters({ search:'', status:'All', preparedBy:'', dateFrom:'', dateTo:'' });

  const handleDelete = async (e, q) => {
    e.stopPropagation();
    if (!window.confirm(`Delete quotation ${q.quotation_id}? This cannot be undone.`)) return;
    setDeleting(q.quotation_id);
    try {
      await deleteQuotation(q.quotation_id);
      toast.success('Quotation deleted');
      setQuotations(quotations.filter(x => x.quotation_id !== q.quotation_id));
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  if (showForm || editTarget) {
    return (
      <QuotationForm
        existing={editTarget}
        prefilledRequirement={prefilledReq}
        onSuccess={() => {
          setShowForm(false); setEditTarget(null); setPrefilledReq(null);
          clearQuotationsCache(); load(true);
        }}
        onCancel={() => { setShowForm(false); setEditTarget(null); setPrefilledReq(null); }}
      />
    );
  }

  if (selected) {
    return (
      <QuotationDetail
        quotationId={selected}
        onBack={() => setSelected(null)}
        onEdit={(q) => { setSelected(null); setEditTarget(q); }}
        canApprove={canApprove}
        onRefresh={() => { clearQuotationsCache(); load(true); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Quotations</h2>
          <p className="text-sm text-gray-400">
            {filtered.length} of {quotations.length} shown
            {hasActiveFilters && ' (filtered)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { clearQuotationsCache(); load(true); }} className="btn-secondary p-2"><RefreshCw size={16} /></button>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={clsx('btn-secondary flex items-center gap-2', hasActiveFilters && 'ring-2 ring-primary-300')}
          >
            <Filter size={15} /> Filters
            {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-primary-500" />}
          </button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> New Quotation
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9 w-full"
          placeholder="Search by ID, customer, prepared by, requirement…"
          value={search}
          onChange={e => setQuotationsFilters({ search: e.target.value })}
        />
        {search && (
          <button onClick={() => setQuotationsFilters({ search: '' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filters panel */}
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

          {/* Status */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button key={s} onClick={() => setQuotationsFilters({ status: s })}
                  className={clsx('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    status === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Prepared By</label>
              <input className="input text-sm" placeholder="Filter by name…" value={preparedBy}
                onChange={e => setQuotationsFilters({ preparedBy: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
              <input type="date" className="input text-sm" value={dateFrom}
                onChange={e => setQuotationsFilters({ dateFrom: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
              <input type="date" className="input text-sm" value={dateTo}
                onChange={e => setQuotationsFilters({ dateTo: e.target.value })} />
            </div>
          </div>
        </div>
      )}

      {/* Active filter pills */}
      {hasActiveFilters && !showFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-400">Active:</span>
          {status !== 'All' && <FilterPill label={`Status: ${status}`} onRemove={() => setQuotationsFilters({ status: 'All' })} />}
          {preparedBy && <FilterPill label={`By: ${preparedBy}`} onRemove={() => setQuotationsFilters({ preparedBy: '' })} />}
          {dateFrom   && <FilterPill label={`From: ${dateFrom}`} onRemove={() => setQuotationsFilters({ dateFrom: '' })} />}
          {dateTo     && <FilterPill label={`To: ${dateTo}`}     onRemove={() => setQuotationsFilters({ dateTo: '' })} />}
          <button onClick={clearFilters} className="text-xs text-red-400 hover:underline">Clear all</button>
        </div>
      )}

      {loading ? <LoadingSpinner fullscreen={false} /> : filtered.length === 0 ? (
        <EmptyState message="No quotations found" icon={FileText} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-5 py-3">ID</th>
                    <th className="text-left px-5 py-3">Customer</th>
                    <th className="text-left px-5 py-3">Prepared By</th>
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-right px-5 py-3">Subtotal</th>
                    <th className="text-right px-5 py-3">Discount</th>
                    <th className="text-right px-5 py-3">Total (KWD)</th>
                    <th className="text-left px-5 py-3">Status</th>
                    <th className="text-left px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(q => (
                    <tr
                      key={q.quotation_id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setSelected(q.quotation_id)}
                    >
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">{q.quotation_id}</td>
                      <td className="px-5 py-3 font-medium text-gray-800">{q.customers?.company_name}</td>
                      <td className="px-5 py-3 text-gray-500 text-sm">{q.users?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {format(new Date(q.quotation_date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-500 text-sm">
                        {Number(q.subtotal_kwd ?? 0).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                      </td>
                      <td className="px-5 py-3 text-right text-sm">
                        {Number(q.discount_amount ?? 0) > 0 ? (
                          <span className="text-red-500">-{Number(q.discount_amount).toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-800">
                        {Number(q.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={q.status} /></td>
                      <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                        {q.status === 'Draft' && (
                          <button
                            onClick={(e) => handleDelete(e, q)}
                            disabled={deleting === q.quotation_id}
                            className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                            title="Delete draft"
                          >
                            {deleting === q.quotation_id
                              ? <div className="w-4 h-4 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 size={15} />
                            }
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(q => (
              <div
                key={q.quotation_id}
                className="card p-4 cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => setSelected(q.quotation_id)}
              >
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{q.customers?.company_name}</p>
                  <StatusBadge status={q.status} />
                </div>
                <p className="text-xs text-gray-400">{q.quotation_id} · {q.users?.name} · {format(new Date(q.quotation_date), 'dd MMM yyyy')}</p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-sm font-semibold text-gray-700">
                    KWD {Number(q.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                  </p>
                  {q.status === 'Draft' && (
                    <button
                      onClick={(e) => handleDelete(e, q)}
                      className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
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