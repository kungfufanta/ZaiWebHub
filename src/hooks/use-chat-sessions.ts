'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatSession } from '@/lib/chat-types';
import { createSession } from '@/lib/chat-utils';

const STORAGE_KEY = 'zaiwebhub-dev-console.sessions.v1';
const MAX_SESSIONS = 50;
const PERSIST_DEBOUNCE_MS = 250;

interface PersistedStore {
  sessions: ChatSession[];
  activeSessionId: string | null;
}

function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<ChatSession>;
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.messages)
  );
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const sessionsRef = useRef<ChatSession[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Hydrate once from localStorage. Messages that were mid-stream when the
  // app closed are marked as interrupted so the UI stays truthful.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedStore>;
          const list = Array.isArray(parsed.sessions)
            ? parsed.sessions.filter(isChatSession).map((s) => ({
                ...s,
                messages: s.messages.map((m) =>
                  m.status === 'streaming' ? { ...m, status: 'interrupted' as const } : m,
                ),
              }))
            : [];
          setSessions(list);
          const active =
            parsed.activeSessionId && list.some((s) => s.id === parsed.activeSessionId)
              ? parsed.activeSessionId
              : (list[0]?.id ?? null);
          setActiveSessionId(active);
        }
      } catch {
        // corrupted storage -> start clean
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Persist (debounced) whenever data changes.
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const payload: PersistedStore = { sessions, activeSessionId };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // storage full / private mode -> ignore
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [sessions, activeSessionId, hydrated]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const createNewSession = useCallback((): ChatSession => {
    const next = createSession();
    setSessions((prev) => [next, ...prev].slice(0, MAX_SESSIONS));
    setActiveSessionId(next.id);
    return next;
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    const remaining = sessionsRef.current.filter((s) => s.id !== id);
    setSessions(remaining);
    setActiveSessionId((cur) => (cur === id ? (remaining[0]?.id ?? null) : cur));
  }, []);

  const clearAllSessions = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s)),
    );
  }, []);

  const appendMessages = useCallback((sessionId: string, msgs: ChatMessage[]) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, ...msgs], updatedAt: Date.now() }
          : s,
      ),
    );
  }, []);

  const patchMessage = useCallback(
    (sessionId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== sessionId
            ? s
            : {
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
              },
        ),
      );
    },
    [],
  );

  const removeMessage = useCallback((sessionId: string, messageId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, messages: s.messages.filter((m) => m.id !== messageId), updatedAt: Date.now() }
          : s,
      ),
    );
  }, []);

  const clearMessages = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messages: [], updatedAt: Date.now() } : s)),
    );
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    hydrated,
    createNewSession,
    selectSession,
    deleteSession,
    clearAllSessions,
    renameSession,
    appendMessages,
    patchMessage,
    removeMessage,
    clearMessages,
  };
}

export type ChatSessionsStore = ReturnType<typeof useChatSessions>;
