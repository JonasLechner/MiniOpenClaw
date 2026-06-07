import { createNewSession } from "./sessions.js";
import type { RuntimePaths } from "./config.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import type { Channel } from "./channels.js";
import { createDefaultTelegramScheduledTasks } from "../jobs/task-store.js";

export type ConversationBinding = {
  channel: Channel;
  chatId: string;
  userId?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

const bindingWriteLanes = new Map<string, Promise<void>>();

function bindingKey(binding: Pick<ConversationBinding, "channel" | "chatId">): string {
  return `${binding.channel}:${binding.chatId}`;
}

function assertNoDuplicateBindings(bindings: ConversationBinding[]): ConversationBinding[] {
  const seen = new Set<string>();

  for (const binding of bindings) {
    const key = bindingKey(binding);
    if (seen.has(key)) {
      if (binding.channel === "telegram") {
        throw new Error(`Multiple Telegram conversation bindings found for chat ${binding.chatId}.`);
      }
      throw new Error(`Multiple conversation bindings found for ${key}.`);
    }
    seen.add(key);
  }

  return bindings;
}

async function loadBindings(paths: RuntimePaths): Promise<ConversationBinding[]> {
  return assertNoDuplicateBindings(await readJsonFile(paths.conversationBindings, [] as ConversationBinding[]));
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

async function getBinding(paths: RuntimePaths, channel: Channel, chatId: string): Promise<ConversationBinding | undefined> {
  const bindings = await loadBindings(paths);
  return bindings.find((binding) => binding.channel === channel && binding.chatId === chatId);
}

async function saveBinding(paths: RuntimePaths, binding: ConversationBinding): Promise<ConversationBinding> {
  const bindings = await loadBindings(paths);
  const nextBindings = bindings.filter((entry) => bindingKey(entry) !== bindingKey(binding));

  nextBindings.push(binding);
  await saveBindings(paths, nextBindings);
  return binding;
}

export async function getTelegramBinding(paths: RuntimePaths, chatId: string): Promise<ConversationBinding | undefined> {
  return getBinding(paths, "telegram", chatId);
}

export async function bindTelegramChatToSession(
  paths: RuntimePaths,
  chatId: string,
  sessionId: string,
  userId?: string,
): Promise<ConversationBinding> {
  return enqueueBindingWrite(paths, async () => {
    const now = new Date().toISOString();
    const bindings = await loadBindings(paths);
    const existing = bindings.find((binding) => binding.channel === "telegram" && binding.chatId === chatId);

    const nextBinding: ConversationBinding = {
      channel: "telegram",
      chatId,
      userId,
      sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    return saveBinding(paths, nextBinding);
  });
}

export async function resolveTelegramBinding(paths: RuntimePaths, chatId: string, userId?: string): Promise<ConversationBinding> {
  const existing = await getTelegramBinding(paths, chatId);
  if (existing) return existing;

  const session = await createNewSession(paths);
  const binding = await bindTelegramChatToSession(paths, chatId, session.sessionId, userId);
  await createDefaultTelegramScheduledTasks(paths, chatId);
  return binding;
}

export async function requireTelegramBinding(paths: RuntimePaths, chatId: string): Promise<ConversationBinding> {
  const binding = await getTelegramBinding(paths, chatId);

  if (!binding) {
    throw new Error(`No Telegram conversation binding found for chat ${chatId}.`);
  }

  return binding;
}
