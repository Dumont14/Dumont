// src/hooks/useActivityFeed.ts
// Loads activity feed and subscribes to realtime inserts

'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { ActivityEvent } from '@/types';

export function useActivityFeed(limit = 50) {
  const [events, setEvents]   = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    fetch(`/api/activity?limit=${limit}`)
      .then(r => r.json())
      .then(data => { setEvents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError('Feed unavailable'); setLoading(false); });
  }, [limit]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('ab_activity_feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ab_activity' },
        async (payload) => {
          try {
            const { data: u } = await supabase
              .from('ab_users')
              .select('id, name, role, visible')
              .eq('id', payload.new.user_id)
              .single();
            if (!u?.visible) return;
            const newEvent = { ...payload.new, ab_users: u } as ActivityEvent;
            setEvents(prev => [newEvent, ...prev].slice(0, limit));
          } catch { /* ignore */ }
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [limit]);

  return { events, loading, error };
}
