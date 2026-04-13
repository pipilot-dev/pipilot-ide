/**
 * NotificationContext — combined notification center + toast queue.
 *
 * Notifications:
 *  - Live in localStorage keyed by `pipilot:notifications:<YYYY-MM-DD>`
 *  - Auto-cleared when the date changes (yesterday's notifications evaporate
 *    on first read of the next day)
 *  - Capped at 100 entries to keep storage sane
 *
 * Toasts:
 *  - Lightweight transient popovers (auto-dismiss after 4s)
 *  - Adding a notification via `addNotification` ALSO surfaces a toast,
 *    so callers get both the persistent record and the immediate feedback
 *    in one call. Use `notify()` directly if you only want one.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  timestamp: Date;
  read: boolean;
}

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: NotificationType;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  toasts: Toast[];
  /** Add a persistent notification. Also surfaces a toast unless silent. */
  addNotification: (n: Omit<Notification, "id" | "timestamp" | "read"> & { silent?: boolean }) => void;
  /** Show a transient toast without persisting in the bell center. */
  showToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  removeNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const TOAST_DURATION = 4000;
const MAX_NOTIFICATIONS = 100;

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `pipilot:notifications:${y}-${m}-${day}`;
}

function loadTodayNotifications(): Notification[] {
  if (typeof window === "undefined") return [];
  try {
    // Sweep stale day entries — anything not matching today's key is gone
    const key = todayKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("pipilot:notifications:") && k !== key) {
        localStorage.removeItem(k);
      }
    }
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((n: any) => ({
      ...n,
      timestamp: new Date(n.timestamp),
    }));
  } catch {
    return [];
  }
}

function saveTodayNotifications(notifications: Notification[]) {
  if (typeof window === "undefined") return;
  try {
    if (notifications.length === 0) {
      localStorage.removeItem(todayKey());
    } else {
      localStorage.setItem(todayKey(), JSON.stringify(notifications));
    }
  } catch {}
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>(() => loadTodayNotifications());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Persist on every change
  useEffect(() => {
    saveTodayNotifications(notifications);
  }, [notifications]);

  // Sweep at midnight: when the date rolls over, clear notifications
  useEffect(() => {
    const interval = setInterval(() => {
      // Re-load from localStorage which auto-sweeps stale day keys
      const fresh = loadTodayNotifications();
      // If localStorage has fewer entries than memory, the day must have rolled over
      if (fresh.length === 0 && notifications.length > 0) {
        setNotifications([]);
      }
    }, 60_000); // check every minute
    return () => clearInterval(interval);
  }, [notifications.length]);

  const showToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2, 9);
    const toast: Toast = { ...t, id };
    setToasts((prev) => [...prev, toast]);
    // Auto-dismiss
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
      toastTimers.current.delete(id);
    }, TOAST_DURATION);
    toastTimers.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const addNotification = useCallback(
    (n: Omit<Notification, "id" | "timestamp" | "read"> & { silent?: boolean }) => {
      const { silent, ...rest } = n;
      const notification: Notification = {
        ...rest,
        id: Math.random().toString(36).slice(2, 9),
        timestamp: new Date(),
        read: false,
      };
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
      if (!silent) {
        showToast({ title: rest.title, message: rest.message, type: rest.type });
      }
    },
    [showToast],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      toastTimers.current.forEach((t) => clearTimeout(t));
      toastTimers.current.clear();
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        toasts,
        addNotification,
        showToast,
        dismissToast,
        markAllRead,
        clearAll,
        removeNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
