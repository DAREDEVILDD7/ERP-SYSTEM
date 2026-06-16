import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createRequirement, updateRequirement, getCustomers } from '../../api/requirements';
import { getEquipmentTypes, getEquipmentUnitsWithProcurement } from '../../api/equipment';
import { useDraft } from '../../hooks/useDraft';
import {
  ArrowLeft, Loader2, Plus, Trash2, Package,
  Search, X, ChevronDown, ChevronUp, CheckCircle,
  AlertTriangle, Info, Layers, Database,
} from 'lucide-react';
import StatusBadge from '../common/StatusBadge';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

// Item modes
const MODE_TYPE  = 'type';   // pick from equipment catalogue (no fleet unit required)
const MODE_FLEET = 'fleet';  // pick a specific fleet unit

const EMPTY_ITEM = {
  mode:              MODE_TYPE,  // default: catalogue-based, fleet-independent
  equipment_id:      '',         // only set in MODE_FLEET
  equipment_type_id: '',         // set in both modes
  description:       '',
  quantity:          1,
  capacity:          '',
  notes:             '',
};

// ── Equipment Type Selector (catalogue) ───────────────────────────────────────
// Used in MODE_TYPE — no dependency on fleet availability
function TypeSelector({ value, types, onChange, disabled }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref                 = useRef(null);

  const filtered = types.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.name?.toLowerCase().includes(s) ||
      t.category?.toLowerCase().includes(s) ||
      t.description?.toLowerCase().includes(s)
    );
  });

  const selected = types.find(t => t.type_id === value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => { if (!disabled) { setOpen(v => !v); setSearch(''); } }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); }
        }}
        className={clsx(
          'input w-full text-left flex items-center justify-between text-sm select-none',
          disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'cursor-pointer'
        )}
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-medium text-gray-800 truncate">{selected.name}</span>
            {selected.category && (
              <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
                — {selected.category}
              </span>
            )}
          </div>
        ) : (
          <span className="text-gray-400 flex items-center gap-2">
            <Search size={13}/> Search equipment types…
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && !disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500"
            >
              <X size={13}/>
            </button>
          )}
          {open ? <ChevronUp size={14} className="text-gray-400"/> : <ChevronDown size={14} className="text-gray-400"/>}
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 z-40 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                autoFocus
                className="input pl-7 text-xs"
                placeholder="Search by type name or category…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={12}/>
                </button>
              )}
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50"
            >
              — No specific type / describe manually
            </button>

            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No equipment types found</p>
            ) : (
              // Group by category
              Object.entries(
                filtered.reduce((acc, t) => {
                  const cat = t.category || 'Other';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(t);
                  return acc;
                }, {})
              ).map(([cat, items]) => (
                <div key={cat}>
                  <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                    {cat}
                  </p>
                  {items.map(t => (
                    <button
                      key={t.type_id}
                      type="button"
                      onClick={() => { onChange(t.type_id, t); setOpen(false); setSearch(''); }}
                      className={clsx(
                        'w-full flex items-start justify-between px-4 py-2.5 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                        value === t.type_id && 'bg-primary-50'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800">{t.name}</p>
                        {t.description && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{t.description}</p>
                        )}
                      </div>
                      {t.default_daily_rate_kwd > 0 && (
                        <span className="text-xs text-gray-400 ml-3 shrink-0">
                          KWD {Number(t.default_daily_rate_kwd).toLocaleString()}/day
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="p-2 border-t border-gray-100 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fleet Unit Selector ─────────────────────────────────────────────────────
// Used in MODE_FLEET — requires a specific unit from equipment_units
function FleetSelector({ value, equipment, usedEquipmentIds = [], typeFilter = '', onChange }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref                 = useRef(null);

  const filtered = equipment.filter(e => {
    if (e.equipment_id !== value && usedEquipmentIds.includes(e.equipment_id)) return false;
    // If caller already picked a type, pre-filter to that type for convenience
    if (typeFilter && e.type_id !== typeFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.equipment_types?.name?.toLowerCase().includes(s) ||
      e.equipment_id?.toLowerCase().includes(s) ||
      e.serial_number?.toLowerCase().includes(s) ||
      e.capacity?.toLowerCase().includes(s) ||
      e.location?.toLowerCase().includes(s) ||
      e.status?.toLowerCase().includes(s)
    );
  });

  // Show unfiltered if type filter gives nothing (fallback)
  const listToShow = filtered.length > 0 || typeFilter
    ? filtered
    : equipment.filter(e => {
        if (e.equipment_id !== value && usedEquipmentIds.includes(e.equipment_id)) return false;
        if (!search) return true;
        const s = search.toLowerCase();
        return (
          e.equipment_types?.name?.toLowerCase().includes(s) ||
          e.equipment_id?.toLowerCase().includes(s) ||
          e.serial_number?.toLowerCase().includes(s) ||
          e.capacity?.toLowerCase().includes(s) ||
          e.location?.toLowerCase().includes(s)
        );
      });

  const selected = equipment.find(e => e.equipment_id === value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
        className="input w-full text-left flex items-center justify-between text-sm cursor-pointer select-none"
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-medium text-gray-800 truncate">
              {selected.equipment_types?.name} {selected.capacity}
            </span>
            <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
              — {selected.equipment_id}
            </span>
            <StatusBadge status={selected.status}/>
          </div>
        ) : (
          <span className="text-gray-400 flex items-center gap-2">
            <Search size={13}/> Search fleet units…
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500"
            >
              <X size={13}/>
            </button>
          )}
          {open ? <ChevronUp size={14} className="text-gray-400"/> : <ChevronDown size={14} className="text-gray-400"/>}
        </div>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-40 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                autoFocus
                className="input pl-7 text-xs"
                placeholder="Search by type, ID, serial, capacity, location…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={12}/>
                </button>
              )}
            </div>
            {typeFilter && filtered.length === 0 && equipment.length > 0 && (
              <p className="text-xs text-orange-500 mt-1.5 px-1">
                No fleet units of this type — showing all units below
              </p>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50"
            >
              — None / Clear selection
            </button>

            {listToShow.length === 0 ? (
              <div className="text-center py-5 px-4">
                <Database size={20} className="text-gray-200 mx-auto mb-2"/>
                <p className="text-xs text-gray-400">No fleet units found</p>
                <p className="text-xs text-gray-300 mt-1">
                  Switch to "By Type" mode to request without a fleet unit
                </p>
              </div>
            ) : listToShow.map(eq => (
              <button
                key={eq.equipment_id}
                type="button"
                onClick={() => { onChange(eq.equipment_id); setOpen(false); setSearch(''); }}
                className={clsx(
                  'w-full flex items-start justify-between px-4 py-3 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                  value === eq.equipment_id && 'bg-primary-50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">
                    {eq.equipment_types?.name}
                    {eq.capacity && <span className="text-gray-500 ml-1">— {eq.capacity}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {eq.equipment_id}
                    {eq.serial_number && ` · S/N: ${eq.serial_number}`}
                    {eq.location && ` · ${eq.location}`}
                  </p>
                  {eq.equipment_types?.category && (
                    <p className="text-xs text-gray-300">{eq.equipment_types.category}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                  <StatusBadge status={eq.status}/>
                  {eq.daily_rate_kwd > 0 && (
                    <span className="text-xs text-gray-400">
                      KWD {Number(eq.daily_rate_kwd).toLocaleString()}/day
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-gray-100 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fleet unit detail card ──────────────────────────────────────────────────
function FleetUnitCard({ equipment, equipmentId }) {
  const eq = equipment.find(e => e.equipment_id === equipmentId);
  if (!eq) return null;

  const statusColors = {
    Available:   'bg-green-50 border-green-100',
    Reserved:    'bg-yellow-50 border-yellow-100',
    Dispatched:  'bg-blue-50 border-blue-100',
    Maintenance: 'bg-red-50 border-red-100',
  };

  return (
    <div className={clsx(
      'rounded-xl border p-3 text-xs space-y-2',
      statusColors[eq.status] ?? 'bg-gray-50 border-gray-100'
    )}>
      <div className="flex items-center gap-2 flex-wrap">
        <CheckCircle size={12} className="text-green-500 shrink-0"/>
        <span className="font-semibold text-gray-700">Fleet unit linked</span>
        <StatusBadge status={eq.status}/>
        {eq.status !== 'Available' && (
          <span className="text-orange-500 text-xs flex items-center gap-1">
            <AlertTriangle size={10}/>
            Currently {eq.status.toLowerCase()} — may not be free when needed
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
        <div><span className="text-gray-400">Type:</span> {eq.equipment_types?.name ?? '—'}</div>
        <div><span className="text-gray-400">Capacity:</span> {eq.capacity ?? '—'}</div>
        <div><span className="text-gray-400">ID:</span> <span className="font-mono">{eq.equipment_id}</span></div>
        <div><span className="text-gray-400">Serial:</span> {eq.serial_number ?? '—'}</div>
        <div><span className="text-gray-400">Location:</span> {eq.location ?? '—'}</div>
        <div><span className="text-gray-400">Rate:</span> KWD {Number(eq.daily_rate_kwd).toLocaleString()}/day</div>
      </div>
    </div>
  );
}

// ── Availability badge for a type ───────────────────────────────────────────
function TypeAvailabilityBadge({ typeId, equipment }) {
  if (!typeId) return null;
  const units = equipment.filter(e => e.type_id === typeId);
  const available = units.filter(e => e.status === 'Available').length;
  const total = units.length;

  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100">
        <AlertTriangle size={10}/> Not in fleet — procurement may be needed
      </span>
    );
  }
  if (available === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
        <AlertTriangle size={10}/> {total} unit{total !== 1 ? 's' : ''} in fleet, none available now
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
      <CheckCircle size={10}/> {available}/{total} available in fleet
    </span>
  );
}

// ── Single requirement item row ─────────────────────────────────────────────
function ItemRow({ item, idx, types, equipment, usedEquipmentIds, onSetItem, onRemove }) {
  const isFleetMode = item.mode === MODE_FLEET;

  const handleModeSwitch = useCallback((newMode) => {
    // Reset fleet/type fields when switching modes
    onSetItem(idx, 'mode', newMode);
    if (newMode === MODE_TYPE) {
      onSetItem(idx, 'equipment_id', '');  // clear fleet unit
    }
    if (newMode === MODE_FLEET) {
      // Don't clear type — user may have already picked one
    }
  }, [idx, onSetItem]);

  return (
    <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/40 space-y-3">
      {/* Item header: number + mode toggle + remove */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-gray-500 shrink-0">Item {idx + 1}</p>

        {/* Mode toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 flex-1 max-w-xs">
          <button
            type="button"
            onClick={() => handleModeSwitch(MODE_TYPE)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all flex-1 justify-center',
              !isFleetMode
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Layers size={11}/>
            <span className="hidden sm:inline">By Type</span>
            <span className="sm:hidden">Type</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch(MODE_FLEET)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all flex-1 justify-center',
              isFleetMode
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Database size={11}/>
            <span className="hidden sm:inline">Fleet Unit</span>
            <span className="sm:hidden">Fleet</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onRemove(idx)}
          className="text-gray-300 hover:text-red-500 transition-colors shrink-0"
          title="Remove item"
        >
          <Trash2 size={14}/>
        </button>
      </div>

      {/* Mode explanation pill */}
      {!isFleetMode ? (
        <div className="flex items-start gap-2 px-2.5 py-2 bg-blue-50 rounded-lg border border-blue-100">
          <Info size={12} className="text-blue-400 mt-0.5 shrink-0"/>
          <p className="text-xs text-blue-600">
            <span className="font-medium">By Type</span> — Request by equipment category.
            No specific unit required. Operations will allocate from fleet (or procure if unavailable).
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-2.5 py-2 bg-purple-50 rounded-lg border border-purple-100">
          <Info size={12} className="text-purple-400 mt-0.5 shrink-0"/>
          <p className="text-xs text-purple-600">
            <span className="font-medium">Specific Fleet Unit</span> — Link to an exact unit from your fleet.
            You can still proceed even if the unit is unavailable now.
          </p>
        </div>
      )}

      {/* ── BY TYPE mode ── */}
      {!isFleetMode && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
              Equipment Type
              <span className="text-gray-400">(optional — select from catalogue)</span>
            </label>
            <TypeSelector
              value={item.equipment_type_id}
              types={types}
              onChange={(typeId, typeObj) => {
                onSetItem(idx, 'equipment_type_id', typeId);
                // Auto-fill description from type name if description is empty
                if (typeObj && !item.description?.trim()) {
                  onSetItem(idx, 'description', typeObj.name);
                }
                // Auto-fill capacity from type default if empty
                if (typeObj?.default_capacity && !item.capacity?.trim()) {
                  onSetItem(idx, 'capacity', typeObj.default_capacity);
                }
              }}
            />
            {/* Inline availability info */}
            {item.equipment_type_id && (
              <div className="mt-1.5">
                <TypeAvailabilityBadge typeId={item.equipment_type_id} equipment={equipment}/>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── FLEET mode ── */}
      {isFleetMode && (
        <div className="space-y-3">
          {/* Optional: filter fleet by type first */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Filter Fleet by Type <span className="text-gray-400">(optional)</span>
            </label>
            <TypeSelector
              value={item.equipment_type_id}
              types={types}
              onChange={(typeId) => {
                onSetItem(idx, 'equipment_type_id', typeId);
                // If user changes type, clear the fleet unit to avoid mismatch
                if (item.equipment_id) onSetItem(idx, 'equipment_id', '');
              }}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Select Fleet Unit <span className="text-gray-400">(optional even in this mode)</span>
            </label>
            <FleetSelector
              value={item.equipment_id}
              equipment={equipment}
              usedEquipmentIds={usedEquipmentIds}
              typeFilter={item.equipment_type_id}
              onChange={(val) => {
                onSetItem(idx, 'equipment_id', val);
                if (val) {
                  const eq = equipment.find(e => e.equipment_id === val);
                  if (eq) {
                    // Auto-fill from fleet unit
                    if (!item.equipment_type_id) onSetItem(idx, 'equipment_type_id', eq.type_id ?? '');
                    onSetItem(idx, 'description', `${eq.equipment_types?.name ?? ''} ${eq.capacity ?? ''}`.trim());
                    onSetItem(idx, 'capacity', eq.capacity ?? '');
                  }
                }
              }}
            />
          </div>

          {/* Fleet unit detail card */}
          {item.equipment_id && (
            <FleetUnitCard equipment={equipment} equipmentId={item.equipment_id}/>
          )}
        </div>
      )}

      {/* ── Common fields (both modes) ── */}
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 sm:col-span-6">
          <label className="block text-xs text-gray-500 mb-1">
            Description <span className="text-red-400">*</span>
            {(item.equipment_id || item.equipment_type_id) && (
              <span className="text-green-600 ml-1">(auto-filled — editable)</span>
            )}
          </label>
          <input
            className="input text-sm"
            placeholder="e.g. 50 Ton Mobile Crane"
            value={item.description}
            onChange={e => onSetItem(idx, 'description', e.target.value)}
            required
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">
            Capacity / Spec
            {item.equipment_id && <span className="text-green-600 ml-1">(auto)</span>}
          </label>
          <input
            className="input text-sm"
            placeholder="e.g. 50T"
            value={item.capacity}
            onChange={e => onSetItem(idx, 'capacity', e.target.value)}
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">Quantity</label>
          <input
            type="number"
            min="1"
            max="999"
            className="input text-sm text-center"
            value={item.quantity}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              onSetItem(idx, 'quantity', isNaN(v) || v < 1 ? 1 : v);
            }}
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
        <input
          className="input text-sm"
          placeholder="Specific requirements, conditions, make/model preferences…"
          value={item.notes}
          onChange={e => onSetItem(idx, 'notes', e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Main Form ───────────────────────────────────────────────────────────────
export default function RequirementForm({ existing, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers,   setCustomers]   = useState([]);
  const [equipment,   setEquipment]   = useState([]);   // fleet units
  const [types,       setTypes]       = useState([]);   // equipment catalogue
  const [loading,     setLoading]     = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError,   setDataError]   = useState(null);

  const draftKey = isEdit ? `req-edit-${existing?.requirement_id}` : 'req-new';

  const INIT_FORM = {
    customer_id:         existing?.customer_id         ?? '',
    requested_by:        existing?.requested_by        ?? '',
    requirement_summary: existing?.requirement_summary ?? '',
    location:            existing?.location            ?? '',
    start_date:          existing?.start_date          ?? '',
    end_date:            existing?.end_date            ?? '',
    priority:            existing?.priority            ?? 'Normal',
    notes:               existing?.notes               ?? '',
  };

  // Preserve mode from existing items where possible
  const INIT_ITEMS = existing?.requirement_items?.length > 0
    ? existing.requirement_items.map(i => ({
        mode:              i.equipment_id ? MODE_FLEET : MODE_TYPE,
        equipment_id:      i.equipment_id      ?? '',
        equipment_type_id: i.equipment_type_id ?? '',
        description:       i.description       ?? '',
        quantity:          i.quantity           ?? 1,
        capacity:          i.capacity           ?? '',
        notes:             i.notes              ?? '',
      }))
    : [];

  const [form,  setForm,  clearDraft,      hasDraft]      = useDraft(draftKey, INIT_FORM);
  const [items, setItems, clearItemsDraft]                = useDraft(`${draftKey}-items`, INIT_ITEMS);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [c, e, t] = await Promise.all([
        getCustomers(),
        getEquipmentUnitsWithProcurement(),
        getEquipmentTypes(),
      ]);
      setCustomers(c ?? []);
      setEquipment(e ?? []);
      setTypes(t ?? []);
    } catch (err) {
      console.error('Failed to load form data:', err);
      setDataError('Failed to load form data. Please try again.');
      toast.error('Failed to load form data');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const addItem    = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(i => i.filter((_, j) => j !== idx));

  // Stable callback — avoids re-renders inside ItemRow
  const setItem = useCallback((idx, field, val) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }, [setItems]);

  // const usedEquipmentIds = items.map(i => i.equipment_id).filter(Boolean);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate required header fields
    if (!form.customer_id)                return toast.error('Please select a customer');
    if (!form.requested_by?.trim())        return toast.error('Please enter the contact name');
    if (!form.requirement_summary?.trim()) return toast.error('Please describe the requirement');

    // Validate date range if both provided
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      return toast.error('End date must be after start date');
    }

    // Validate items — description required for each
    const itemsWithContent = items.filter(i => i.description?.trim());
    const incompleteItems  = items.filter(i => !i.description?.trim() && (i.equipment_id || i.equipment_type_id));
    if (incompleteItems.length > 0) {
      return toast.error('Please add a description for all equipment items');
    }

    // Check for duplicate fleet unit assignments
    const fleetIds = items.filter(i => i.equipment_id).map(i => i.equipment_id);
    const uniqueFleet = new Set(fleetIds);
    if (fleetIds.length !== uniqueFleet.size) {
      return toast.error('Each fleet unit can only be assigned to one item');
    }

    setLoading(true);
    try {
      const payload = {
        ...form,
        created_by: profile.user_id,
        start_date: form.start_date || null,
        end_date:   form.end_date   || null,
      };

      const cleanItems = itemsWithContent.map(i => ({
        equipment_id:      i.equipment_id      || null,
        equipment_type_id: i.equipment_type_id || null,
        description:       i.description.trim(),
        quantity:          Number(i.quantity)  || 1,
        capacity:          i.capacity?.trim()  || null,
        notes:             i.notes?.trim()     || null,
        // mode is a UI-only field — not saved to DB
      }));

      if (isEdit) {
        await updateRequirement(existing.requirement_id, form, cleanItems);
        toast.success('Requirement updated');
      } else {
        await createRequirement(payload, cleanItems);
        toast.success('Requirement created — pending review');
      }

      clearDraft();
      clearItemsDraft();
      onSuccess();
    } catch (err) {
      console.error('Failed to save requirement:', err);
      // Handle specific Supabase/network errors
      if (err?.code === 'PGRST301' || err?.message?.includes('JWT')) {
        toast.error('Session expired — please refresh and log in again');
      } else if (err?.code === '23503') {
        toast.error('A referenced customer or equipment no longer exists');
      } else {
        toast.error(err.message || 'Failed to save requirement — please try again');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (dataLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 size={28} className="animate-spin text-primary-500"/>
      <p className="text-sm text-gray-400">Loading form data…</p>
    </div>
  );

  // ── Data error state ──────────────────────────────────────────────────────
  if (dataError) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <AlertTriangle size={32} className="text-red-300"/>
      <p className="text-sm text-gray-500">{dataError}</p>
      <button onClick={loadData} className="btn-primary text-sm flex items-center gap-2">
        <Loader2 size={14}/> Retry
      </button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2" type="button">
          <ArrowLeft size={16}/>
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit Requirement' : 'New Requirement'}
          </h2>
          <p className="text-sm text-gray-400">
            {isEdit ? `Editing ${existing.requirement_id}` : 'Create a new requirement ticket'}
          </p>
        </div>
      </div>

      {/* Draft banner */}
      {!isEdit && hasDraft() && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-yellow-700">📝 Draft restored from your last session</p>
          <button type="button"
            onClick={() => { clearDraft(); clearItemsDraft(); window.location.reload(); }}
            className="text-xs text-yellow-600 hover:underline ml-4">
            Clear draft
          </button>
        </div>
      )}

      {/* Status note */}
      {!isEdit && (
        <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100">
          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/>
          <p className="text-xs text-blue-700">
            New requirements start as <span className="font-semibold">Pending Review</span>.
            Equipment availability is <span className="font-semibold">not</span> checked at this stage —
            Operations will confirm during review.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Basic Info ─────────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">
            Requirement Details
          </h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            <select className="input" value={form.customer_id}
              onChange={e => set('customer_id', e.target.value)} required>
              <option value="">Select a customer…</option>
              {customers.length === 0 && (
                <option disabled>No customers found</option>
              )}
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.company_name}{c.contact_person ? ` — ${c.contact_person}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Requested By (Contact Name) <span className="text-red-500">*</span>
            </label>
            <input className="input" placeholder="e.g. Hassan Shaikh"
              value={form.requested_by}
              onChange={e => set('requested_by', e.target.value)} required/>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Requirement Summary <span className="text-red-500">*</span>
            </label>
            <textarea className="input min-h-[80px] resize-y"
              placeholder="Describe what the customer needs…"
              value={form.requirement_summary}
              onChange={e => set('requirement_summary', e.target.value)} required/>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input className="input" placeholder="e.g. Ahmadi Refinery"
                value={form.location} onChange={e => set('location', e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select className="input" value={form.priority}
                onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input type="date" className="input" value={form.start_date}
                onChange={e => set('start_date', e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input type="date" className="input" value={form.end_date}
                min={form.start_date || undefined}
                onChange={e => set('end_date', e.target.value)}/>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input resize-y" rows={2}
              placeholder="Any additional notes or context…"
              value={form.notes} onChange={e => set('notes', e.target.value)}/>
          </div>
        </div>

        {/* ── Equipment Items ─────────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="flex items-start justify-between border-b border-gray-100 pb-3 mb-4 gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Package size={15} className="text-primary-500"/>
                Equipment Required
              </h3>
              <p className="text-xs text-gray-400 mt-0.5 max-w-sm">
                Add items by equipment type (no fleet availability needed) or link to a specific fleet unit.
                Operations will confirm allocation.
              </p>
            </div>
            <button type="button" onClick={addItem}
              className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 shrink-0">
              <Plus size={13}/> Add Item
            </button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <Layers size={12} className="text-primary-400"/>
              <span><span className="font-medium text-gray-600">By Type</span> — request by category, no unit needed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Database size={12} className="text-purple-400"/>
              <span><span className="font-medium text-gray-600">Fleet Unit</span> — link to a specific unit</span>
            </span>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <Package size={28} className="opacity-30 mb-2"/>
              <p className="text-sm">No equipment items added yet</p>
              <p className="text-xs text-gray-300 mt-1">Items are optional — you can describe needs in the summary</p>
              <button type="button" onClick={addItem}
                className="mt-3 text-xs text-primary-500 hover:underline flex items-center gap-1">
                <Plus size={12}/> Add first item
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, idx) => (
                <ItemRow
                  key={idx}
                  item={item}
                  idx={idx}
                  types={types}
                  equipment={equipment}
                  usedEquipmentIds={items
                    .filter((it, j) => j !== idx && it.equipment_id)
                    .map(it => it.equipment_id)}
                  onSetItem={setItem}
                  onRemove={removeItem}
                />
              ))}
            </div>
          )}

          {/* Summary of items with availability warnings */}
          {items.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                {items.filter(i => i.description?.trim()).length} item(s) · {' '}
                {items.filter(i => i.mode === MODE_FLEET && i.equipment_id).length} fleet unit(s) linked · {' '}
                {items.filter(i => i.mode === MODE_TYPE && i.equipment_type_id).length} by type · {' '}
                {items.filter(i => !i.equipment_id && !i.equipment_type_id).length} manual description only
              </p>
            </div>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2 min-w-[140px] justify-center">
            {loading
              ? <><Loader2 size={15} className="animate-spin"/> Saving…</>
              : isEdit ? 'Update Requirement' : 'Create Requirement'
            }
          </button>
        </div>
      </form>
    </div>
  );
}