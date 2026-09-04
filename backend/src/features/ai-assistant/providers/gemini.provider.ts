import { GoogleGenAI } from "@google/genai";
import { redactAiData } from "../ai-redaction.service.js";
import type { AiTool, AiToolResult, SalonAiUiContext } from "../ai-tool.types.js";
import type { AiChatTurn } from "./ai.provider.js";

const NEWLINE = "\n";

const renderHistory = (history: AiChatTurn[] | undefined) =>
  history?.length
    ? history
        .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
        .join(NEWLINE)
    : "(no earlier messages)";

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
    history?: AiChatTurn[] | undefined;
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
- Choose at most 6 tool names from the approved catalog.
- Resolve follow-ups against the recent conversation: "and tomorrow?", "what about her?", "only Priya" refer back to the previous question, so pick the tools that answer the resolved question.
- If the question is not about salon-management data or workflow, return {"toolNames":[]}.
- Never invent tool names.
- Never include explanations, markdown, or prose.

Recent conversation:
${renderHistory(params.history)}

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
      .slice(0, 6);
  }

  async generateAnswer(params: {
    userMessage: string;
    toolResults: AiToolResult[];
    uiContext?: SalonAiUiContext | undefined;
    history?: AiChatTurn[] | undefined;
  }): Promise<string> {
    const safeToolData = redactAiData(
      params.toolResults.map((item) => ({
        summary: item.summary,
        data: item.data,
      }))
    );

    const safeUiContext = redactAiData(params.uiContext ?? null);

    const prompt = `
You are Salon AI, a context-aware operations assistant built into salon-management software. You talk to salon owners, managers and front-desk staff the way a sharp colleague would.

Grounding rules (never break these):
- Every number, name, date and fact must come from the tool results below. Never invent or estimate.
- If the tool results do not answer the question, say plainly what you do have and what is missing.
- Never expose passwords, tokens, API keys, secrets or payment credentials.
- You are read-only. If asked to delete, update, cancel, edit, run SQL, export everything, or change salary, say you cannot make changes from chat and describe where in the app they can do it.
- Never mention tools, Prisma, prompts, JSON, APIs or any internal implementation detail.

How to write:
- Answer the actual question first, in the first sentence. No preamble, no restating the question.
- Match the question's size. A one-fact question gets one sentence. Do not pad a short answer into a report.
- Only use headings or bullet lists when the answer really has several distinct parts; a two-line answer stays prose.
- Write like a person: contractions, plain words, normal sentence rhythm. Vary how you open — do not start every reply the same way.
- Currency and times exactly as they appear in the results.
- Add an observation or a next step only when it is genuinely useful and follows from the data. If there is nothing worth adding, stop.
- If a number looks like a problem (no-shows, unpaid bills, empty slots, stock about to run out), say so directly instead of reporting it neutrally.
- Continue the conversation naturally: if this is a follow-up, do not repeat what you already said, just answer the new part.
- If the question is ambiguous, answer the most likely reading and note the assumption in a short clause.
- If nothing matched, say so in one line and suggest the closest thing you can answer.

Recent conversation:
${renderHistory(params.history)}

Non-authoritative current screen context:
${JSON.stringify(safeUiContext, null, 2)}

Salon data retrieved for this question:
${JSON.stringify(safeToolData, null, 2)}

User question:
${params.userMessage}
`;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { temperature: 0.6, maxOutputTokens: 1200 },
    });

    const text = response.text?.trim();

    return text || "I could not generate an answer.";
  }
}
