// src/hooks/useUser.ts
// Manages user profile state — persisted in localStorage
// Used by: Header chip, NewReportModal, ActivityFeed

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User } from '@/types';

const STORAGE_KEY = 'ab_user';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore parse errors
    }
    setLoading(false);
  }, []);

  const saveUser = useCallback((u: User) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  }, []);

  const clearUser = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const register = useCallback(async (payload: {
    name: string; role: string; phone?: string; visible: boolean;
  }) => {
    const res = await fetch('/api/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveUser(data);
    return data as User;
  }, [saveUser]);

  const update = useCallback(async (payload: Partial<User> & { id: string }) => {
    const res = await fetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveUser({ ...user!, ...data });
    return data as User;
  }, [user, saveUser]);

  return { user, loading, saveUser, clearUser, register, update };
}
