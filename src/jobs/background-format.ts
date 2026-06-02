import type { BackgroundTaskSummary } from "./background.js";

export function formatBackgroundTaskList(tasks: BackgroundTaskSummary[]): string {
  if (tasks.length === 0) {
    return "No background tasks for this session.";
  }

  return tasks.map((task) => {
    const lines = [
      `${task.taskId} [${task.status}]`,
      `created: ${task.createdAt}`,
      `prompt: ${task.prompt}`,
    ];
    if (task.startedAt) lines.push(`started: ${task.startedAt}`);
    if (task.finishedAt) lines.push(`finished: ${task.finishedAt}`);
    if (task.detachedSessionId) lines.push(`detached session: ${task.detachedSessionId}`);
    if (task.stopReason) lines.push(`stop: ${task.stopReason}`);
    if (task.errorMessage) lines.push(`error: ${task.errorMessage}`);
    return lines.join("\n");
  }).join("\n\n");
}
