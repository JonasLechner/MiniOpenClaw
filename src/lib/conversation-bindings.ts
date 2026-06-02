import { createNewSession } from "./sessions.js";
import type { RuntimePaths } from "./config.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import type { Channel } from "./channels.js";

export type ConversationBinding = {
  channel: Channel;
  chatId: string;
  userId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

const bindingWriteLanes = new Map<string, Promise<void>>();

async function loadBindings(paths: RuntimePaths): Promise<ConversationBinding[]> {
  return readJsonFile(paths.conversationBindings, [] as ConversationBinding[]);
}

async function saveBindings(paths: RuntimePaths, bindings: ConversationBinding[]): Promise<void> {
  await writeJsonFile(paths.conversationBindings, bindings);
}

function enqueueBindingWrite<T>(paths: RuntimePaths, task: () => Promise<T>): Promise<T> {
  const key = paths.conversationBindings;
  const previous = bindingWriteLanes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const lane = next.then(() => undefined, () => undefined);
  bindingWriteLanes.set(key, lane);
  return next.finally(() => {
    if (bindingWriteLanes.get(key) === lane) {
      bindingWriteLanes.delete(key);
    }
  });
}

export async function listConversationBindings(paths: RuntimePaths): Promise<ConversationBinding[]> {
  return loadBindings(paths);
}

export async function getConversationBinding(
  paths: RuntimePaths,
  channel: Channel,
  chatId: string,
  userId: string,
): Promise<ConversationBinding | undefined> {
  const bindings = await loadBindings(paths);
  return bindings.find((binding) => binding.channel === channel && binding.chatId === chatId && binding.userId === userId);
}

export async function setConversationBinding(paths: RuntimePaths, binding: ConversationBinding): Promise<ConversationBinding> {
  return enqueueBindingWrite(paths, async () => {
    const bindings = await loadBindings(paths);
    const nextBindings = bindings.filter((entry) => {
      return !(entry.channel === binding.channel && entry.chatId === binding.chatId && entry.userId === binding.userId);
    });

    nextBindings.push(binding);
    await saveBindings(paths, nextBindings);
    return binding;
  });
}

export async function bindTelegramConversationToSession(
  paths: RuntimePaths,
  chatId: string,
  userId: string,
  sessionId: string,
): Promise<ConversationBinding> {
  return enqueueBindingWrite(paths, async () => {
    const now = new Date().toISOString();
    const bindings = await loadBindings(paths);
    const existing = bindings.find((binding) => {
      return binding.channel === "telegram" && binding.chatId === chatId && binding.userId === userId;
    });

    const nextBinding: ConversationBinding = {
      channel: "telegram",
      chatId,
      userId,
      sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nextBindings = bindings.filter((binding) => {
      return !(binding.channel === nextBinding.channel && binding.chatId === chatId && binding.userId === userId);
    });
    nextBindings.push(nextBinding);
    await saveBindings(paths, nextBindings);
    return nextBinding;
  });
}

export async function resolveTelegramConversationBinding(paths: RuntimePaths, chatId: string, userId: string): Promise<ConversationBinding> {
  const existing = await getConversationBinding(paths, "telegram", chatId, userId);
  if (existing) return existing;

  const session = await createNewSession(paths);
  return bindTelegramConversationToSession(paths, chatId, userId, session.sessionId);
}

export async function getTelegramConversationBindingByChatId(paths: RuntimePaths, chatId: string): Promise<ConversationBinding> {
  const bindings = await loadBindings(paths);
  const matches = bindings.filter((binding) => binding.channel === "telegram" && binding.chatId === chatId);

  if (matches.length === 0) {
    throw new Error(`No Telegram conversation binding found for chat ${chatId}.`);
  }

  if (matches.length > 1) {
    throw new Error(`Multiple Telegram conversation bindings found for chat ${chatId}.`);
  }

  return matches[0];
}
