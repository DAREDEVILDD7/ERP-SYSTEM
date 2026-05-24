import { useEffect, useState } from 'react';
import { fetchDispatchStats } from '../../api/dashboard';
import StatCard from '../common/StatCard';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { Truck, Clock, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function DispatchDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchDispatchStats().then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return null;

  const { stats, activeDispatches } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending"        value={stats.pending}        icon={Clock}        color="yellow" />
        <StatCard label="In Transit"     value={stats.inTransit}      icon={Truck}        color="blue"   />
        <StatCard label="Completed Today" value={stats.completedToday} icon={CheckCircle} color="green"  />
      </div>

      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Active Dispatches</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 font-medium uppercase tracking-wide">
                <th className="text-left px-5 py-3">ID</th>
                <th className="text-left px-5 py-3">Equipment</th>
                <th className="text-left px-5 py-3">Driver</th>
                <th className="text-left px-5 py-3">Destination</th>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {activeDispatches.length === 0
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">No active dispatches.</td></tr>
                : activeDispatches.map(d => (
                  <tr key={d.dispatch_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{d.dispatch_id}</td>
                    <td className="px-5 py-3 text-gray-800">{d.equipment_units?.equipment_types?.name} · {d.equipment_units?.capacity}</td>
                    <td className="px-5 py-3 text-gray-600">{d.driver_name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{d.destination}</td>
                    <td className="px-5 py-3 text-gray-500">{d.dispatch_date ? format(new Date(d.dispatch_date), 'dd MMM') : '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}