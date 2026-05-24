import { useEffect, useState } from 'react';
import { fetchMaintenanceStats } from '../../api/dashboard';
import StatCard from '../common/StatCard';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { Wrench, AlertCircle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function MaintenanceDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchMaintenanceStats().then(setData).finally(() => setLoading(false)); }, []);

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!data)   return null;

  const { stats, jobs } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Open Jobs"           value={stats.open}               icon={AlertCircle}  color="red"    />
        <StatCard label="In Progress"         value={stats.inProgress}         icon={Wrench}       color="yellow" />
        <StatCard label="Completed This Month" value={stats.completedThisMonth} icon={CheckCircle} color="green"  />
      </div>

      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Active Maintenance Jobs</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {jobs.length === 0
            ? <p className="text-sm text-gray-400 text-center py-8">No open jobs.</p>
            : jobs.map(j => (
              <div key={j.maintenance_id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{j.issue}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {j.equipment_units?.equipment_types?.name} · {j.equipment_units?.equipment_id}
                    {j.issue_type ? ` · ${j.issue_type}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={j.status} />
                  <span className="text-xs text-gray-400">{j.service_date ? format(new Date(j.service_date), 'dd MMM') : '—'}</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}