import { estimateSessionContextTokens, maybeCompactSession, type CompactionResult } from "../core/compaction.js";
import type { Session } from "../core/sessions.js";
import type { AgentEventListener } from "./events.js";

export type RunCompactionOptions = {
  session: Session;
  model: unknown;
  apiKey: string;
  trigger: "automatic" | "manual";
  runId: string;
  force?: boolean;
  protectedEventIndex?: number;
  emit: AgentEventListener;
  transient?: AgentEventListener;
};

export async function runSessionCompaction({
  session,
  model,
  apiKey,
  trigger,
  runId,
  force = false,
  protectedEventIndex,
  emit,
  transient,
}: RunCompactionOptions): Promise<CompactionResult> {
  const sessionId = session.sessionId;
  let started = false;

  try {
    const result = await maybeCompactSession({
      model,
      apiKey,
      session,
      trigger,
      force,
      protectedEventIndex,
      onCompacting: () => {
        if (started) return;
        started = true;
        emitWithTransient(emit, transient, { type: "compaction_start", sessionId, runId, trigger });
      },
    });

    if (started) {
      emitWithTransient(emit, transient, {
        type: "compaction_end",
        sessionId,
        runId,
        trigger,
        compacted: result.compacted,
        estimatedTokensBefore: result.estimatedTokensBefore,
        estimatedTokensAfter: result.estimatedTokensAfter,
        warning: result.warning,
      });
    }

    return result;
  } catch (error) {
    if (started) {
      emitWithTransient(emit, transient, {
        type: "compaction_end",
        sessionId,
        runId,
        trigger,
        compacted: false,
        estimatedTokensBefore: estimateSessionContextTokens(session),
        warning: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

function emitWithTransient(emit: AgentEventListener, transient: AgentEventListener | undefined, event: Parameters<AgentEventListener>[0]): void {
  transient?.(event);
  emit(event);
}
