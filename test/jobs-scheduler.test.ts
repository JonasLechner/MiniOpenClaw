import { afterEach, describe, expect, it, vi } from "vitest";

const getRunnableScheduledTasksMock = vi.fn();
const markScheduledTaskRanMock = vi.fn();
const runScheduledTaskMock = vi.fn();
const createDailySummaryMock = vi.fn();
const shouldEnsurePreviousDailySummaryMock = vi.fn();
const getPreviousLocalDayDateMock = vi.fn();
const originalIsTTY = process.stdout.isTTY;

vi.mock("../src/jobs/task-store.js", () => ({
  getRunnableScheduledTasks: getRunnableScheduledTasksMock,
  markScheduledTaskRan: markScheduledTaskRanMock,
}));

vi.mock("../src/jobs/runner.js", () => ({
  runScheduledTask: runScheduledTaskMock,
}));

vi.mock("../src/jobs/daily-summary.js", () => ({
  createDailySummary: createDailySummaryMock,
  shouldEnsurePreviousDailySummary: shouldEnsurePreviousDailySummaryMock,
  getPreviousLocalDayDate: getPreviousLocalDayDateMock,
}));

afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  vi.clearAllMocks();
});

describe("gateway scheduler", () => {
  it("continues running later due tasks when one task fails", async () => {
    shouldEnsurePreviousDailySummaryMock.mockResolvedValue(false);
    getRunnableScheduledTasksMock.mockResolvedValue([
      { id: "task-1" },
      { id: "task-2" },
    ]);
    runScheduledTaskMock.mockRejectedValueOnce(new Error("boom"));
    runScheduledTaskMock.mockResolvedValueOnce(undefined);
    markScheduledTaskRanMock.mockResolvedValue(undefined);

    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { createGatewayScheduler } = await import("../src/jobs/scheduler.js");
    const scheduler = createGatewayScheduler({ paths: {} } as never, { sendText: vi.fn() } as never, {} as never);

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.stop();

    expect(runScheduledTaskMock).toHaveBeenNthCalledWith(1, { paths: {} }, expect.anything(), { id: "task-1" }, {});
    expect(runScheduledTaskMock).toHaveBeenNthCalledWith(2, { paths: {} }, expect.anything(), { id: "task-2" }, {});
    expect(markScheduledTaskRanMock).toHaveBeenCalledTimes(1);
    expect(markScheduledTaskRanMock).toHaveBeenCalledWith({}, "task-2");
    const failureLog = logSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((payload) => payload.event === "scheduled_task_failed");
    expect(failureLog).toMatchObject({
      event: "scheduled_task_failed",
      level: "error",
      taskId: "task-1",
      message: "boom",
    });
  });

  it("runs daily summary creation even when telegram is disabled", async () => {
    shouldEnsurePreviousDailySummaryMock.mockResolvedValue(true);
    const summaryDate = new Date("2026-06-02T00:00:00");
    getPreviousLocalDayDateMock.mockReturnValue(summaryDate);
    createDailySummaryMock.mockResolvedValue("/workspace/memory/2026-06-02.md");

    const { createGatewayScheduler } = await import("../src/jobs/scheduler.js");
    const scheduler = createGatewayScheduler({ paths: {} } as never);

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.stop();

    expect(createDailySummaryMock).toHaveBeenCalledWith({ paths: {} }, summaryDate);
    expect(getRunnableScheduledTasksMock).not.toHaveBeenCalled();
  });

  it("continues scheduled tasks when daily summary is skipped", async () => {
    shouldEnsurePreviousDailySummaryMock.mockResolvedValue(false);
    getRunnableScheduledTasksMock.mockResolvedValue([{ id: "task-1" }]);
    runScheduledTaskMock.mockResolvedValue(undefined);
    markScheduledTaskRanMock.mockResolvedValue(undefined);

    const { createGatewayScheduler } = await import("../src/jobs/scheduler.js");
    const scheduler = createGatewayScheduler({ paths: {} } as never, { sendText: vi.fn() } as never, {} as never);

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.stop();

    expect(createDailySummaryMock).not.toHaveBeenCalled();
    expect(runScheduledTaskMock).toHaveBeenCalledTimes(1);
    expect(markScheduledTaskRanMock).toHaveBeenCalledWith({}, "task-1");
  });
});
