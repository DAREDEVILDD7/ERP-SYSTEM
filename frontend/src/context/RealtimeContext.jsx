import { createContext, useContext, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const RealtimeContext = createContext(null);

export function RealtimeProvider({ children, onRefresh }) {
  const channelRef = useRef(null);

  useEffect(() => {
    channelRef.current = supabase
      .channel('erp-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requirements' }, () => onRefresh?.('requirements'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' },   () => onRefresh?.('quotations'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatches' },   () => onRefresh?.('dispatches'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_units' }, () => onRefresh?.('equipment'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance' },  () => onRefresh?.('maintenance'))
      .subscribe();

    return () => { channelRef.current?.unsubscribe(); };
  }, [onRefresh]);

  return <RealtimeContext.Provider value={null}>{children}</RealtimeContext.Provider>;
}