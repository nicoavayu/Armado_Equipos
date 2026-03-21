import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';

/**
 * Small wrapper around Supabase realtime subscriptions with cleanup-safe lifecycle.
 * The event list is expected to keep a stable order between renders.
 */
export const useSupabaseRealtime = ({
  enabled = true,
  channelName,
  events = [],
  deps = [],
  onStatusChange,
}) => {
  const eventsRef = useRef(events);
  const statusHandlerRef = useRef(onStatusChange);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    statusHandlerRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!enabled || !channelName || !Array.isArray(eventsRef.current) || eventsRef.current.length === 0) {
      return undefined;
    }

    const channel = supabase.channel(channelName);

    eventsRef.current.forEach((eventConfig, index) => {
      const { handler, ...postgresConfig } = eventConfig || {};
      if (typeof handler !== 'function') return;

      channel.on('postgres_changes', postgresConfig, (payload) => {
        const latestHandler = eventsRef.current[index]?.handler;
        latestHandler?.(payload);
      });
    });

    channel.subscribe((status) => {
      statusHandlerRef.current?.(status);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, enabled, ...deps]);
};

export default useSupabaseRealtime;
