import { useEffect, useState } from 'react';
import { fetchSalesStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import StatCard from '../common/StatCard';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { ClipboardList, FileText, Clock, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

export default function SalesDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.user_id) fetchSalesStats(profile.user_id).then(setData).finally(() => setLoading(false));
  }, [profile]);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return null;

  const { stats, myRecentQuotations, myRecentRequirements } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Welcome back, <span className="font-medium text-gray-700">{profile?.name}</span></p>
        <button onClick={() => navigate('/requirements')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Requirement
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="My Requirements" value={stats.myRequirements}  icon={ClipboardList} color="blue"   />
        <StatCard label="My Quotations"   value={stats.myQuotations}    icon={FileText}      color="purple" />
        <StatCard label="Awaiting Approval" value={stats.pendingApproval} icon={Clock}       color="yellow" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent requirements */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">My Requirements</h3>
            <button onClick={() => navigate('/requirements')} className="text-xs text-primary-500 hover:underline">View all</button>
          </div>
          <div className="divide-y divide-gray-50">
            {myRecentRequirements.length === 0
              ? <p className="text-sm text-gray-400 text-center py-8">No requirements yet.</p>
              : myRecentRequirements.map(r => (
                <div key={r.requirement_id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{r.requirement_summary}</p>
                    <p className="text-xs text-gray-400">{r.customers?.company_name}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
          </div>
        </div>

        {/* Recent quotations */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">My Quotations</h3>
            <button onClick={() => navigate('/quotations')} className="text-xs text-primary-500 hover:underline">View all</button>
          </div>
          <div className="divide-y divide-gray-50">
            {myRecentQuotations.length === 0
              ? <p className="text-sm text-gray-400 text-center py-8">No quotations yet.</p>
              : myRecentQuotations.map(q => (
                <div key={q.quotation_id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{q.customers?.company_name}</p>
                    <p className="text-xs text-gray-400">{q.quotation_id} · {format(new Date(q.quotation_date), 'dd MMM yyyy')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={q.status} />
                    <span className="text-sm font-medium text-gray-700">{Number(q.total_amount_kwd).toLocaleString()} KWD</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}