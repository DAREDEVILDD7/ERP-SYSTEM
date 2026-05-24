import { useEffect, useState } from 'react';
import { fetchAdminStats } from '../../api/dashboard';
import StatCard from '../common/StatCard';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { Package, ClipboardList, FileText, Truck, DollarSign } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';

const EQ_COLORS  = { Available: '#22c55e', Reserved: '#eab308', Dispatched: '#3b82f6', Maintenance: '#ef4444', Retired: '#9ca3af' };
const REQ_COLORS = ['#3b5bdb','#eab308','#a855f7','#22c55e','#ef4444','#9ca3af'];

export default function AdminDashboard() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminStats().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return <p className="text-gray-400 text-sm">Failed to load dashboard.</p>;

  const { stats, recentRequirements, equipmentByStatus, requirementsByStatus } = data;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Total Equipment"    value={stats.totalEquipment}     icon={Package}       color="blue"   />
        <StatCard label="Available"          value={stats.availableEquipment}  icon={Package}       color="green"  />
        <StatCard label="Active Requirements" value={stats.activeRequirements} icon={ClipboardList} color="yellow" />
        <StatCard label="Open Quotations"    value={stats.openQuotations}      icon={FileText}      color="purple" />
        <StatCard label="Pending Dispatches" value={stats.pendingDispatches}   icon={Truck}         color="blue"   />
        <StatCard label="Revenue (KWD)"      value={stats.totalRevenue.toLocaleString()} icon={DollarSign} color="green" sub="Approved quotations" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Equipment by status */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Equipment by Status</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={equipmentByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                {equipmentByStatus.map((entry) => (
                  <Cell key={entry.name} fill={EQ_COLORS[entry.name] ?? '#9ca3af'} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Requirements by status */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Requirements by Status</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={requirementsByStatus} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {requirementsByStatus.map((_, i) => (
                  <Cell key={i} fill={REQ_COLORS[i % REQ_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent requirements */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Recent Requirements</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {recentRequirements.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No requirements yet.</p>
          ) : recentRequirements.map(r => (
            <div key={r.requirement_id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{r.requirement_summary}</p>
                <p className="text-xs text-gray-400 mt-0.5">{r.customers?.company_name} · {r.requirement_id}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <StatusBadge status={r.status} />
                <span className="text-xs text-gray-400 hidden sm:block">
                  {format(new Date(r.created_at), 'dd MMM yyyy')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}