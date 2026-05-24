import { useEffect, useState } from 'react';
import { fetchFinanceStats } from '../../api/dashboard';
import StatCard from '../common/StatCard';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { DollarSign, FileText, Clock } from 'lucide-react';
import { format } from 'date-fns';

export default function FinanceDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchFinanceStats().then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return null;

  const { stats, recentInvoices } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Pending Invoices"  value={stats.pendingInvoices}  icon={FileText}    color="yellow" />
        <StatCard label="Needs Approval"    value={stats.approvalNeeded}   icon={Clock}       color="red"    />
        <StatCard label="Total Billed (KWD)" value={stats.totalBilled.toLocaleString()}    icon={DollarSign} color="blue"   />
        <StatCard label="Collected (KWD)"   value={stats.totalCollected.toLocaleString()} icon={DollarSign} color="green"  />
      </div>

      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Recent Invoices</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {recentInvoices.length === 0
            ? <p className="text-sm text-gray-400 text-center py-8">No invoices yet.</p>
            : recentInvoices.map(inv => (
              <div key={inv.invoice_id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{inv.customers?.company_name}</p>
                  <p className="text-xs text-gray-400">{inv.invoice_id} · {format(new Date(inv.issue_date), 'dd MMM yyyy')}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={inv.status} />
                  <span className="text-sm font-semibold text-gray-700">{Number(inv.total_amount_kwd).toLocaleString()} KWD</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}