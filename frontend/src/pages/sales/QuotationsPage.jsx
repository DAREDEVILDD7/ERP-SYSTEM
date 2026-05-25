import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { getQuotations } from '../../api/quotations';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import QuotationForm from '../../components/quotations/QuotationForm';
import QuotationDetail from '../../components/quotations/QuotationDetail';
import { Plus, Search, FileText, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

const STATUSES = ['All','Draft','Sent','Approved','Rejected','Expired','Invoiced'];

export default function QuotationsPage() {
  const { profile, role } = useAuth();
  const location = useLocation();

  const [quotations,   setQuotations]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm,     setShowForm]     = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [prefilledReq, setPrefilledReq] = useState(null);

  const canCreate  = hasPermission(role, 'quotations_create');
  const canApprove = hasPermission(role, 'quotations_approve');

  // Handle navigation from requirement detail
  useEffect(() => {
    if (location.state?.requirementId) {
      setPrefilledReq({ requirement_id: location.state.requirementId });
      setShowForm(true);
    }
  }, [location.state]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {};
      if (role === 'Sales Executive') filters.prepared_by = profile.user_id;
      if (statusFilter !== 'All') filters.status = statusFilter;
      let data = await getQuotations(filters);
      if (search) {
        data = data.filter(q =>
          q.customers?.company_name?.toLowerCase().includes(search.toLowerCase()) ||
          q.quotation_id?.toLowerCase().includes(search.toLowerCase())
        );
      }
      setQuotations(data);
    } catch {
      toast.error('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [role, profile, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('quotations-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, () => load())
      .subscribe();
    return () => channel.unsubscribe();
  }, [load]);

  if (showForm || editTarget) {
    return (
      <QuotationForm
        existing={editTarget}
        prefilledRequirement={prefilledReq}
        onSuccess={() => { setShowForm(false); setEditTarget(null); setPrefilledReq(null); load(); }}
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
        onRefresh={load}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Quotations</h2>
          <p className="text-sm text-gray-400">{quotations.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16} /></button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> New Quotation
            </button>
          )}
        </div>
      </div>

      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by customer or ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : (
        <>
          {quotations.length === 0 ? <EmptyState message="No quotations found" icon={FileText} /> : (
            <>
              {/* Desktop */}
              <div className="card hidden md:block overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left px-5 py-3">ID</th>
                      <th className="text-left px-5 py-3">Customer</th>
                      <th className="text-left px-5 py-3">Prepared By</th>
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-left px-5 py-3">Total (KWD)</th>
                      <th className="text-left px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {quotations.map(q => (
                      <tr key={q.quotation_id} className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => setSelected(q.quotation_id)}>
                        <td className="px-5 py-3 font-mono text-xs text-gray-400">{q.quotation_id}</td>
                        <td className="px-5 py-3 font-medium text-gray-800">{q.customers?.company_name}</td>
                        <td className="px-5 py-3 text-gray-600">{q.users?.name}</td>
                        <td className="px-5 py-3 text-gray-400 text-xs">{format(new Date(q.quotation_date), 'dd MMM yyyy')}</td>
                        <td className="px-5 py-3 font-semibold text-gray-800">{Number(q.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</td>
                        <td className="px-5 py-3"><StatusBadge status={q.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-3">
                {quotations.map(q => (
                  <div key={q.quotation_id} className="card p-4 cursor-pointer" onClick={() => setSelected(q.quotation_id)}>
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-medium text-gray-800">{q.customers?.company_name}</p>
                      <StatusBadge status={q.status} />
                    </div>
                    <p className="text-xs text-gray-400">{q.quotation_id} · {format(new Date(q.quotation_date), 'dd MMM yyyy')}</p>
                    <p className="text-sm font-semibold text-gray-700 mt-1">KWD {Number(q.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</p>
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