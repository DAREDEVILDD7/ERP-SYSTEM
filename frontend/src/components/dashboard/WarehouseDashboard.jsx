import { useEffect, useState } from 'react';
import { fetchWarehouseStats } from '../../api/dashboard';
import StatCard from '../common/StatCard';
import LoadingSpinner from '../common/LoadingSpinner';
import { Package, CheckCircle, Wrench } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const COLORS = ['#3b5bdb','#22c55e','#eab308','#a855f7','#ef4444','#9ca3af','#06b6d4','#f97316'];

export default function WarehouseDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchWarehouseStats().then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return null;

  const { stats, byType } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Units"  value={stats.total}       icon={Package}       color="blue"   />
        <StatCard label="Available"    value={stats.available}   icon={CheckCircle}   color="green"  />
        <StatCard label="In Maintenance" value={stats.maintenance} icon={Wrench}      color="red"    />
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Equipment Count by Type</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={byType} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
            <Tooltip />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {byType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}