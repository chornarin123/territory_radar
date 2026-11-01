import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import { ApiError, api, type CoachReply } from '../api/client';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Assistant only: which model or the offline coach answered. */
  source?: CoachReply['source'];
  model?: string | null;
  notice?: string;
}

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
}

/** ok: false means the message was not kept — `text` is handed back for editing. */
export type SendResult = { ok: true } | { ok: false; text: string };

interface CoachValue {
  chat: (prospectId: string) => ChatState;
  send: (prospectId: string, text: string) => Promise<SendResult>;
  clear: (prospectId: string) => void;
}

const EMPTY: ChatState = { messages: [], sending: false, error: null };
const Ctx = createContext<CoachValue | null>(null);
let seq = 0;

/**
 * Coach chats, one per prospect, kept in memory for this session only: going
 * back to a prospect resumes its chat, and nothing is written to the server.
 *
 * Chats live in a ref, not in state, because `send` must read the history at the
 * moment it sends — a setState updater runs later, during render.
 */
export function CoachProvider({ children }: { children: React.ReactNode }) {
  const chats = useRef<Record<string, ChatState>>({});
  const [version, rerender] = useReducer((n: number) => n + 1, 0);

  const update = useCallback((prospectId: string, fn: (c: ChatState) => ChatState) => {
    chats.current = { ...chats.current, [prospectId]: fn(chats.current[prospectId] ?? EMPTY) };
    rerender();
  }, []);

  const send = useCallback(
    async (prospectId: string, text: string): Promise<SendResult> => {
      const content = text.trim();
      const cur = chats.current[prospectId] ?? EMPTY;
      if (!content || cur.sending) return { ok: false, text };

      const mine: ChatMessage = { id: `m${++seq}`, role: 'user', content };
      const history = [...cur.messages, mine];
      update(prospectId, () => ({ messages: history, sending: true, error: null }));

      try {
        const r = await api.coach(prospectId, history);
        update(prospectId, (c) => ({
          sending: false,
          error: null,
          messages: [
            ...c.messages,
            {
              id: `m${++seq}`,
              role: 'assistant',
              content: r.reply,
              source: r.source,
              model: r.model,
              notice: r.notice,
            },
          ],
        }));
        return { ok: true };
      } catch (e) {
        // Refused or failed: take the message back out so the chat stays a valid
        // user/assistant alternation, and show why under the input.
        const error =
          e instanceof ApiError || e instanceof Error ? e.message : 'Could not reach the coach';
        update(prospectId, (c) => ({
          sending: false,
          error,
          messages: c.messages.filter((m) => m.id !== mine.id),
        }));
        return { ok: false, text: content };
      }
    },
    [update],
  );

  const value = useMemo<CoachValue>(
    () => ({
      chat: (id) => chats.current[id] ?? EMPTY,
      send,
      clear: (id) => update(id, () => EMPTY),
    }),
    // `version` changes on every update, so consumers re-render with the new chat.
    [version, send, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoach(): CoachValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoach must be used inside <CoachProvider>');
  return v;
}
