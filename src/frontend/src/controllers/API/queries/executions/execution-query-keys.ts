export const executionQueryKeys = {
  root: ["board-executions"] as const,
  detail: (boardId: string, flowId: string, jobId: string) =>
    ["board-executions", boardId, flowId, jobId] as const,
  list: (boardId: string, flowId: string) =>
    ["board-executions", boardId, flowId, "list"] as const,
};
