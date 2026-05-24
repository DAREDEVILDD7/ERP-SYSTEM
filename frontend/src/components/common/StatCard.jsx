import clsx from 'clsx';

const COLOR_MAP = {
  blue:   'bg-blue-50 text-blue-600',
  green:  'bg-green-50 text-green-600',
  yellow: 'bg-yellow-50 text-yellow-600',
  red:    'bg-red-50 text-red-600',
  purple: 'bg-purple-50 text-purple-600',
  gray:   'bg-gray-100 text-gray-600',
};

export default function StatCard({ label, value, icon: Icon, color = 'blue', sub }) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={clsx('p-2.5 rounded-xl shrink-0', COLOR_MAP[color])}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value ?? '—'}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}