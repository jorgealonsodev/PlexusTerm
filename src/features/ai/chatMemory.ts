/** One question and what came back for it. */
export interface ChatTurn {
  id: number;
  question: string;
  selection: string | null;
  /** Paths of the files attached to the question. */
  files?: string[];
  state: "loading" | "answer" | "error";
  answer: string;
  command: string | null;
  error: string;
}

/** A terminal's AI conversation: kept while its chat is closed, until the terminal closes. */
export interface ChatConversation {
  sessionId: string;
  turns: ChatTurn[];
}

const conversations = new Map<string, ChatConversation>();

/** The conversation of the terminal `key` (its pane id), if it had one. */
export const recallChat = (key: string) => conversations.get(key);

/** Keeps the conversation of the terminal `key`; a question still waiting for its answer is not kept. */
export const rememberChat = (key: string, conversation: ChatConversation) =>
  void conversations.set(key, { ...conversation, turns: conversation.turns.filter((t) => t.state !== "loading") });

/** Forgets the conversations of terminals that are no longer open. */
export function forgetChatsExcept(open: ReadonlySet<string>) {
  for (const key of conversations.keys()) if (!open.has(key)) conversations.delete(key);
}
