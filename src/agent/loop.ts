import {
  complete,
  type Context,
  Type,
  validateToolCall,
  type Tool as PiTool,
} from "@earendil-works/pi-ai";
import {
  editTool,
  globTool,
  grepTool,
  readTool,
  webFetchTool,
  webSearchTool,
  writeTool,
} from "../tools/index.js";
import { resolveAgentAuth } from "./auth.js";

export type AgentTurnResult = {
  text: string;
  stopReason: Awaited<ReturnType<typeof complete>>["stopReason"];
  errorMessage?: string;
};

export type AgentLoop = {
  provider: string;
  modelId: string;
  runTurn(prompt: string): Promise<AgentTurnResult>;
};

const exposedTools: PiTool[] = [
  {
    name: "read",
    description: "Read a file, optionally by line range.",
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
    }),
  },
  {
    name: "write",
    description: "Write text to a file.",
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
  },
  {
    name: "edit",
    description: "Replace a line range in a file.",
    parameters: Type.Object({
      path: Type.String(),
      startLine: Type.Number(),
      endLine: Type.Number(),
      newText: Type.String(),
    }),
  },
  {
    name: "grep",
    description: "Search lines in a file.",
    parameters: Type.Object({
      path: Type.String(),
      pattern: Type.String(),
      startLine: Type.Optional(Type.Number()),
      endLine: Type.Optional(Type.Number()),
      caseSensitive: Type.Optional(Type.Boolean()),
      useRegex: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern under a directory.",
    parameters: Type.Object({
      path: Type.String(),
      pattern: Type.String(),
      caseSensitive: Type.Optional(Type.Boolean()),
      includeDirectories: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: "websearch",
    description: "Search the web for a query and return result summaries.",
    parameters: Type.Object({
      query: Type.String(),
      limit: Type.Optional(Type.Number()),
    }),
  },
  {
    name: "webfetch",
    description: "Fetch a web page and return either extracted text or raw HTML.",
    parameters: Type.Object({
      url: Type.String(),
      format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("html")])),
    }),
  },
];

const toolMap = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  grep: grepTool,
  glob: globTool,
  websearch: webSearchTool,
  webfetch: webFetchTool,
};

function getVisibleText(message: Awaited<ReturnType<typeof complete>>): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function createAgentLoop(): Promise<AgentLoop> {
  const { provider, modelId, model, apiKey } = await resolveAgentAuth();
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Keep answers concise.",
    messages: [],
    tools: exposedTools,
  };

  return {
    provider,
    modelId,
    async runTurn(prompt: string): Promise<AgentTurnResult> {
      context.messages.push({
        role: "user",
        content: prompt,
        timestamp: Date.now(),
      });

      let response = await complete(model, context, { apiKey });
      context.messages.push(response);

      while (response.stopReason === "toolUse") {
        const toolCalls = response.content.filter((block) => block.type === "toolCall");

        for (const call of toolCalls) {
          try {
            const args = validateToolCall(exposedTools, call);
            const tool = toolMap[call.name as keyof typeof toolMap];

            if (!tool) {
              throw new Error(`Unknown tool: ${call.name}`);
            }

            const result = await tool.run(args as never);

            context.messages.push({
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError: false,
              timestamp: Date.now(),
            });
          } catch (error) {
            context.messages.push({
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
              isError: true,
              timestamp: Date.now(),
            });
          }
        }

        response = await complete(model, context, { apiKey });
        context.messages.push(response);
      }

      return {
        text: getVisibleText(response),
        stopReason: response.stopReason,
        errorMessage: response.errorMessage,
      };
    },
  };
}
