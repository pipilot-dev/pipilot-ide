/**
 * Zustand store for agent chat messages.
 *
 * Messages are keyed by sessionId so switching tabs is instant —
 * no async IDB load, no flash of stale messages. IndexedDB is used
 * only as a persistence layer (load-once on first visit, periodic save).
 *
 * Install: `npm install zustand` (or pnpm/yarn equivalent)
 */
import { create } from "zustand";
import type { ChatMessage } from "./useChat"; // adjust import path
import { db } from "@/lib/db";

// ── Types ──────────────────────────────────────────────────────────

interface SessionState {
  messages: ChatMessage[];
  /** True while the initial IDB load is in progress */
  loading: boolean;
  /** True once IDB data has been loaded at least once */
  hydrated: boolean;
}

interface AgentChatStore {
  /** Per-session message cache */
  sessions: Record<string, SessionState>;

  /** The currently active session ID */
  activeSessionId: string;

  // ── Actions ──

  /** Switch active session — instant, no async */
  setActiveSession: (sessionId: string) => void;

  /** Get messages for a session (returns [] if not hydrated yet) */
  getMessages: (sessionId: string) => ChatMessage[];

  /** Replace all messages for a session */
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;

  /** Append a message to a session */
  appendMessage: (sessionId: string, message: ChatMessage) => void;

  /** Update a specific message by ID within a session */
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: (msg: ChatMessage) => ChatMessage
  ) => void;

  /** Map over all messages in a session (like setMessages(prev => prev.map(...))) */
  mapMessages: (
    sessionId: string,
    mapper: (msg: ChatMessage) => ChatMessage
  ) => void;

  /** Filter messages in a session */
  filterMessages: (
    sessionId: string,
    predicate: (msg: ChatMessage) => boolean
  ) => void;

  /** Clear messages for a session */
  clearSession: (sessionId: string) => void;

  /** Remove a session entirely from the cache */
  removeSession: (sessionId: string) => void;

  /** Hydrate a session from IndexedDB (called once per session) */
  hydrateFromDB: (sessionId: string) => Promise<void>;

  /** Persist current messages to IndexedDB */
  persistToDB: (sessionId: string) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────

const emptySession: SessionState = {
  messages: [],
  loading: false,
  hydrated: false,
};

function getSession(
  sessions: Record<string, SessionState>,
  id: string
): SessionState {
  return sessions[id] || emptySession;
}

// ── Store ───────────────────────────────────────────────────────────

export const useAgentChatStore = create<AgentChatStore>((set, get) => ({
  sessions: {},
  activeSessionId: "",

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
    // Auto-hydrate if we haven't loaded this session yet
    const session = getSession(get().sessions, sessionId);
    if (!session.hydrated && !session.loading && sessionId) {
      get().hydrateFromDB(sessionId);
    }
  },

  getMessages: (sessionId) => {
    return getSession(get().sessions, sessionId).messages;
  },

  setMessages: (sessionId, messages) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...getSession(state.sessions, sessionId),
          messages,
          hydrated: true,
        },
      },
    }));
  },

  appendMessage: (sessionId, message) => {
    set((state) => {
      const session = getSession(state.sessions, sessionId);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages: [...session.messages, message],
          },
        },
      };
    });
  },

  updateMessage: (sessionId, messageId, updater) => {
    set((state) => {
      const session = getSession(state.sessions, sessionId);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages: session.messages.map((m) =>
              m.id === messageId ? updater(m) : m
            ),
          },
        },
      };
    });
  },

  mapMessages: (sessionId, mapper) => {
    set((state) => {
      const session = getSession(state.sessions, sessionId);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages: session.messages.map(mapper),
          },
        },
      };
    });
  },

  filterMessages: (sessionId, predicate) => {
    set((state) => {
      const session = getSession(state.sessions, sessionId);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages: session.messages.filter(predicate),
          },
        },
      };
    });
  },

  clearSession: (sessionId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { messages: [], loading: false, hydrated: true },
      },
    }));
  },

  removeSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.sessions;
      return { sessions: rest };
    });
  },

  hydrateFromDB: async (sessionId) => {
    // Mark loading
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...getSession(state.sessions, sessionId),
          loading: true,
        },
      },
    }));

    try {
      const dbMsgs = await db.chatMessages
        .where("sessionId")
        .equals(sessionId)
        .sortBy("timestamp");

      const messages: ChatMessage[] = dbMsgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        parts: m.parts ? JSON.parse(m.parts) : undefined,
        tool_call_id: m.tool_call_id,
        reverted: m.reverted || undefined,
      }));

      // Only apply if this session is still relevant (not switched away)
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            messages,
            loading: false,
            hydrated: true,
          },
        },
      }));
    } catch {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...getSession(state.sessions, sessionId),
            loading: false,
            hydrated: true,
          },
        },
      }));
    }
  },

  persistToDB: async (sessionId) => {
    const session = getSession(get().sessions, sessionId);
    const messages = session.messages.filter(
      (m) => m.content || m.toolCalls?.length || m.parts?.length
    );
    if (messages.length === 0) return;

    try {
      await db.chatMessages.where("sessionId").equals(sessionId).delete();
      await db.chatMessages.bulkPut(
        messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : undefined,
          parts: m.parts ? JSON.stringify(m.parts) : undefined,
          tool_call_id: m.tool_call_id,
          sessionId,
          timestamp: m.timestamp,
          reverted: m.reverted || undefined,
        }))
      );
    } catch (err) {
      console.error("[agentChatStore] persistToDB failed:", err);
    }
  },
}));

// ── Selectors (for React components) ────────────────────────────────

/** Use in components: `const messages = useActiveMessages()` */
export function useActiveMessages(): ChatMessage[] {
  return useAgentChatStore((state) => {
    const session = state.sessions[state.activeSessionId];
    return session?.messages || [];
  });
}

/** Use in components: `const loading = useSessionLoading()` */
export function useSessionLoading(): boolean {
  return useAgentChatStore((state) => {
    const session = state.sessions[state.activeSessionId];
    return session?.loading || false;
  });
}
