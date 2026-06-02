import { afterEach, describe, expect, it, vi } from "vitest";

const getRunnableScheduledTasksMock = vi.fn();
const markScheduledTaskRanMock = vi.fn();
const runScheduledTaskMock = vi.fn();

vi.mock("../src/lib/proactivity/scheduled-task-store.js", () => ({
  getRunnableScheduledTasks: getRunnableScheduledTasksMock,
  markScheduledTaskRan: markScheduledTaskRanMock,
}));

vi.mock("../src/gateway/proactivity/runner.js", () => ({
  runScheduledTask: runScheduledTaskMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("gateway scheduler", () => {
  it("continues running later due tasks when one task fails", async () => {
    getRunnableScheduledTasksMock.mockResolvedValue([
      { id: "task-1" },
      { id: "task-2" },
    ]);
    runScheduledTaskMock.mockRejectedValueOnce(new Error("boom"));
    runScheduledTaskMock.mockResolvedValueOnce(undefined);
    markScheduledTaskRanMock.mockResolvedValue(undefined);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { createGatewayScheduler } = await import("../src/gateway/proactivity/scheduler.js");
    const scheduler = createGatewayScheduler({ paths: {} } as never, { sendText: vi.fn() } as never, {} as never);

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.stop();

    expect(runScheduledTaskMock).toHaveBeenNthCalledWith(1, { paths: {} }, expect.anything(), { id: "task-1" }, {});
    expect(runScheduledTaskMock).toHaveBeenNthCalledWith(2, { paths: {} }, expect.anything(), { id: "task-2" }, {});
    expect(markScheduledTaskRanMock).toHaveBeenCalledTimes(1);
    expect(markScheduledTaskRanMock).toHaveBeenCalledWith({}, "task-2");
    expect(errorSpy).toHaveBeenCalledWith("scheduled cron task task-1 failed:", expect.any(Error));

    errorSpy.mockRestore();
  });
});
