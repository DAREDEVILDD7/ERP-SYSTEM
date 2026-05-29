import { useEffect, useState } from 'react';
import { getRequirement } from '../../api/requirements';
import StatusBadge from '../common/StatusBadge';
import { Package, X, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const PRIORITY_COLORS = {
  Low:    'bg-gray-100 text-gray-500',
  Normal: 'bg-blue-50 text-blue-600',
  High:   'bg-orange-50 text-orange-600',
  Urgent: 'bg-red-50 text-red-700',
};

export default function RequirementSidePanel({ requirementId, onClose, compact = false }) {
  const [req,     setReq]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!requirementId) return;
    setLoading(true);
    getRequirement(requirementId)
      .then(setReq)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [requirementId]);

  if (!requirementId) return null;

  const panelContent = (
    <div className={clsx('space-y-3', collapsed && 'hidden')}>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : !req ? (
        <p className="text-xs text-gray-400 text-center py-4">Requirement not found</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={req.status}/>
            <span className={clsx('badge text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLORS[req.priority ?? 'Normal'])}>
              {req.priority ?? 'Normal'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-gray-400">Customer</p>
              <p className="font-medium text-gray-700">{req.customers?.company_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400">Contact</p>
              <p className="font-medium text-gray-700">{req.requested_by}</p>
            </div>
            {req.location && (
              <div>
                <p className="text-gray-400">Location</p>
                <p className="font-medium text-gray-700">{req.location}</p>
              </div>
            )}
            {req.start_date && (
              <div>
                <p className="text-gray-400">Start Date</p>
                <p className="font-medium text-gray-700">{format(new Date(req.start_date), 'dd MMM yyyy')}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-3">
            <p className="text-xs text-gray-400 mb-1">Summary</p>
            <p className="text-xs text-gray-700 leading-relaxed">{req.requirement_summary}</p>
          </div>

          {req.notes && (
            <div className="bg-yellow-50 rounded-xl border border-yellow-100 p-3">
              <p className="text-xs text-yellow-600 mb-0.5 font-medium">Notes</p>
              <p className="text-xs text-yellow-700 leading-relaxed">{req.notes}</p>
            </div>
          )}

          {/* Equipment items */}
          {req.requirement_items?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                <Package size={11}/> Requested Equipment ({req.requirement_items.length} items)
              </p>
              <div className="space-y-1.5">
                {req.requirement_items.map((item, i) => (
                  <div key={i} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-700">{item.description}</p>
                      <span className="text-xs font-semibold text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        × {item.quantity}
                      </span>
                    </div>
                    {item.capacity && (
                      <p className="text-xs text-gray-400 mt-0.5">{item.capacity}</p>
                    )}
                    {item.equipment_types?.name && (
                      <p className="text-xs text-gray-400">{item.equipment_types.name}</p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-gray-400 italic mt-0.5">{item.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  if (compact) {
    // Mobile: collapsible bar at top
    return (
      <div className="card border-l-4 border-l-primary-400 overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-500"/>
            <span className="text-sm font-medium text-gray-700">
              Linked Requirement: {requirementId}
            </span>
          </div>
          {collapsed ? <ChevronDown size={16} className="text-gray-400"/> : <ChevronUp size={16} className="text-gray-400"/>}
        </button>
        {!collapsed && (
          <div className="px-4 pb-4 space-y-3">
            {panelContent}
          </div>
        )}
      </div>
    );
  }

  // Desktop: sticky side panel
  return (
    <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary-500"/>
          <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">Linked Requirement</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={14}/>
          </button>
        )}
      </div>
      <p className="font-mono text-xs text-primary-600 font-medium">{requirementId}</p>
      {panelContent}
    </div>
  );
}