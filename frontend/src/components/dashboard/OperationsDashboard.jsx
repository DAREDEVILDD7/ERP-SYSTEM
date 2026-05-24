import { useEffect, useState } from 'react';
import { fetchOperationsStats } from '../../api/dashboard';
import StatCard from '../common/StatCard';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { ClipboardList, Package, Truck, Wrench } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';

const COLORS = ['#3b5bdb','#22c55e','#eab308','#a855f7','#ef4444','#9ca3af'];

export default function OperationsDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { fetchOperationsStats().then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return null;

  const { stats, pendingRequirements, equipmentByLocation } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Needs Review"      value={stats.pendingReview}      icon={ClipboardList} color="yellow" />
        <StatCard label="Available Equip."  value={stats.availableEquipment} icon={Package}       color="green"  />
        <StatCard label="Active Dispatches" value={stats.activeDispatches}   icon={Truck}         color="blue"   />
        <StatCard label="Open Maintenance"  value={stats.openMaintenance}    icon={Wrench}        color="red"    />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Pending Requirements</h3>
            <button onClick={() => navigate('/requirements')} className="text-xs text-primary-500 hover:underline">Review all</button>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingRequirements.length === 0
              ? <p className="text-sm text-gray-400 text-center py-8">All clear.</p>
              : pendingRequirements.map(r => (
                <div key={r.requirement_id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{r.requirement_summary}</p>
                    <p className="text-xs text-gray-400">{r.customers?.company_name} · {r.requirement_id}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={r.priority ?? 'Normal'} />
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Equipment by Location</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={equipmentByLocation} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {equipmentByLocation.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}