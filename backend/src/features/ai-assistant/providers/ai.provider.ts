import type { AiTool, AiToolResult, SalonAiUiContext } from "../ai-tool.types.js";
import { GeminiProvider } from "./gemini.provider.js";

export type AiChatTurn = { role: "user" | "assistant"; content: string };

export interface AiProvider {
  selectToolNames?(params: {
    userMessage: string;
    uiContext?: SalonAiUiContext | undefined;
    tools: readonly AiTool[];
    history?: AiChatTurn[] | undefined;
  }): Promise<string[]>;

  generateAnswer(params: {
    userMessage: string;
    toolResults: AiToolResult[];
    uiContext?: SalonAiUiContext | undefined;
    history?: AiChatTurn[] | undefined;
  }): Promise<string>;
}

let aiProviderFactoryOverride: (() => AiProvider) | undefined;

export class DevAiProvider implements AiProvider {
  async generateAnswer(params: {
    userMessage: string;
    toolResults: AiToolResult[];
    uiContext?: SalonAiUiContext | undefined;
    history?: AiChatTurn[] | undefined;
  }): Promise<string> {
    if (!params.toolResults.length) {
      return "I can answer read-only salon operations questions. Try asking about appointments, holidays, staff availability, revenue, low stock, outstanding customers, packages, or memberships.";
    }

    return params.toolResults.map((r) => r.summary).join("\n");
  }
}

export function getAiProvider(): AiProvider {
  if (aiProviderFactoryOverride) {
    return aiProviderFactoryOverride();
  }

  const provider = process.env.AI_PROVIDER || "dev";

  if (provider.toLowerCase() === "gemini") {
    return new GeminiProvider();
  }

  return new DevAiProvider();
}

export function setAiProviderFactoryForTesting(
  factory: (() => AiProvider) | undefined
) {
  aiProviderFactoryOverride = factory;
}
