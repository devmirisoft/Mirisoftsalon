import { GoogleGenAI } from "@google/genai";
import { redactAiData } from "../ai-redaction.service.js";
import type { AiTool, AiToolResult, SalonAiUiContext } from "../ai-tool.types.js";

export class GeminiProvider {
  private client: GoogleGenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing");
    }

    this.client = new GoogleGenAI({ apiKey });
    this.model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  async selectToolNames(params: {
    userMessage: string;
    uiContext?: SalonAiUiContext | undefined;
    tools: readonly AiTool[];
  }): Promise<string[]> {
    const toolCatalog = params.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
    const safeUiContext = redactAiData(params.uiContext ?? null);
    const prompt = `
You route salon-management user questions to approved read-only backend functions.

Rules:
- Return only compact JSON with this shape: {"toolNames":["toolName"]}.
- Choose at most 4 tool names from the approved catalog.
- If the question is not about salon-management data or workflow, return {"toolNames":[]}.
- Never invent tool names.
- Never include explanations, markdown, or prose.

User question:
${params.userMessage}

Current screen context:
${JSON.stringify(safeUiContext, null, 2)}

Approved tool catalog:
${JSON.stringify(toolCatalog, null, 2)}
`;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    const text = response.text?.trim() ?? "";
    const jsonText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const parsed = JSON.parse(jsonText) as { toolNames?: unknown };
    if (!Array.isArray(parsed.toolNames)) return [];
    const approvedNames = new Set(params.tools.map((tool) => tool.name));
    return parsed.toolNames
      .filter((name): name is string => typeof name === "string")
      .filter((name) => approvedNames.has(name))
      .slice(0, 4);
  }

  async generateAnswer(params: {
    userMessage: string;
    toolResults: AiToolResult[];
    uiContext?: SalonAiUiContext | undefined;
  }): Promise<string> {
    const safeToolData = redactAiData(
      params.toolResults.map((item) => ({
        summary: item.summary,
        data: item.data,
      }))
    );

    const safeUiContext = redactAiData(params.uiContext ?? null);

    const prompt = `
You are Salon AI, a context-aware operations assistant built directly into salon-management software.

Strict rules:
- Answer only from the provided tool results.
- Do not invent numbers or facts.
- Do not claim direct database access.
- Do not expose passwords, tokens, API keys, secrets, payment credentials, or private system data.
- Do not perform write actions.
- If the user asks to delete, update, cancel, edit, run SQL, export all data, or change salary, refuse.
- Answer the user's question directly and explain the operational meaning when useful.
- For simple questions, be brief. For broad questions, organize the response into a summary, important observations and recommended priorities.
- When the user is completing a workflow, explain the next valid step.
- Do not mention tools, Prisma, prompts, JSON, APIs or internal implementation details.
- Keep the answer natural, practical, and business-friendly.
- If tool results are empty, say no matching data was found.

User question:
${params.userMessage}

Non-authoritative current screen context:
${JSON.stringify(safeUiContext, null, 2)}

Safe backend tool results:
${JSON.stringify(safeToolData, null, 2)}
`;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
    });

    const text = response.text?.trim();

    return text || "I could not generate an answer.";
  }
}
