import { detectToolPlan } from "./ai-intent-router.js";
import { validateSuggestedActions } from "./ai-action-registry.js";
import { handleStatefulSalonRequest } from "./ai-conversation-state.service.js";
import { canUseAiTool } from "./ai-permission.service.js";
import { getAiToolByName, getAiTools } from "./ai-tool-registry.js";
import {
  buildDailyBriefResponse,
  DAILY_BRIEF_TOOL_NAMES,
  salonTodayRange,
} from "./tools/dailyBrief.tools.js";
import * as aiProviderModule from "./providers/ai.provider.js";
import { prisma } from "../../config/prisma.js";
import type {
  AiToolContext,
  AiToolResult,
  ClarificationResponse,
  DailyBriefResponse,
  SalonAiCard,
  SalonAiResponseMode,
  SalonAiSuggestedAction,
  SalonAiTable,
  SalonAiUiContext,
} from "./ai-tool.types.js";

const UNKNOWN_INTENT_FALLBACK =
  "I can answer read-only salon operations questions. Try asking: appointments today, who is on holiday today, who is free at 4 PM, today's revenue, low stock products, outstanding customers, or expiring packages and memberships.";

const isHelpOrGreeting = (message: string) =>
  /^(hi|hello|hey|help|what can you do|how can you help)\b/i.test(
    message.trim()
  );

const unique = (values: string[]) => [...new Set(values)];

const isLikelySalonQuestion = (
  message: string,
  uiContext?: SalonAiUiContext | undefined
) => {
  const text = message.toLowerCase();
  if (uiContext && uiContext.module !== "OTHER") return true;
  return /\b(salon|appointment|customer|client|invoice|bill|payment|balance|product|stock|staff|employee|service|services|menu|treatment|membership|package|coupon|loyalty|expense|report|booking|revenue|sales|holiday|leave|available|branch)\b/.test(
    text
  );
};

type UsedTool = {
  name: string;
  status: "SUCCESS" | "FAILED";
};

type SalonAssistantPlan = {
  goal: string;
  confidence: number;
  steps: Array<{
    id: string;
    tool: string;
    input: Record<string, unknown>;
    dependsOn?: string[];
  }>;
  responseType: "DAILY_BRIEF";
  requiresClarification: boolean;
  clarificationQuestion?: string;
  requiresConfirmation: false;
};

const isDailyBriefRequest = (message: string) =>
  /\b(how'?s|how is|what'?s|what is)\s+today\s+(looking|look|going)\b/i.test(
    message
  ) ||
  /\b(today'?s|today)\s+(brief|briefing|summary|operations|overview)\b/i.test(
    message
  ) ||
  /\bwhat should i focus on today\b/i.test(message);

const buildDailyBriefPlan = (): SalonAssistantPlan => ({
  goal: "Build a grounded salon operations briefing for today.",
  confidence: 0.9,
  steps: DAILY_BRIEF_TOOL_NAMES.map((tool, index) => ({
    id: `step-${index + 1}`,
    tool,
    input: {},
  })),
  responseType: "DAILY_BRIEF",
  requiresClarification: false,
  requiresConfirmation: false,
});

async function generateAnswerSafely(params: {
  userMessage: string;
  toolResults: AiToolResult[];
  uiContext?: SalonAiUiContext | undefined;
}): Promise<{ answer: string; usedFallback: boolean }> {
  const fallback =
    params.toolResults.map((result) => result.summary).join("\n") ||
    UNKNOWN_INTENT_FALLBACK;

  try {
    const provider = aiProviderModule.getAiProvider();
    const answer = await provider.generateAnswer({
      userMessage: params.userMessage,
      toolResults: params.toolResults,
      uiContext: params.uiContext,
    });
    return { answer, usedFallback: false };
  } catch {
    return { answer: fallback, usedFallback: true };
  }
}

async function selectToolsWithAiSafely(params: {
  userMessage: string;
  uiContext?: SalonAiUiContext | undefined;
}): Promise<string[]> {
  if (!isLikelySalonQuestion(params.userMessage, params.uiContext)) return [];

  try {
    const provider = aiProviderModule.getAiProvider();
    if (!provider.selectToolNames) return [];
    return provider.selectToolNames({
      userMessage: params.userMessage,
      uiContext: params.uiContext,
      tools: getAiTools(),
    });
  } catch {
    return [];
  }
}

const providerMetadata = (usedFallback?: boolean) => {
  const provider = (process.env.AI_PROVIDER || "dev").toLowerCase();
  return {
    provider,
    model:
      provider === "gemini"
        ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
        : "dev",
    promptVersion: "salon-assistant-v1",
    usedFallback: usedFallback ?? false,
  };
};

const ensureConversation = async (
  context: AiToolContext,
  conversationId?: string | undefined
) => {
  if (!context.salonId) return null;

  if (conversationId) {
    const scoped = await prisma.salonAssistantConversation.findFirst({
      where: {
        id: conversationId,
        salonId: context.salonId,
        createdById: context.userId,
      },
      select: { id: true, stateJson: true, stateVersion: true },
    });
    if (scoped) return scoped;
  }

  const existing = await prisma.salonAssistantConversation.findFirst({
    where: {
      salonId: context.salonId,
      createdById: context.userId,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, stateJson: true, stateVersion: true },
  });
  if (existing) return existing;

  return prisma.salonAssistantConversation.create({
    data: {
      salonId: context.salonId,
      createdById: context.userId,
    },
    select: { id: true, stateJson: true, stateVersion: true },
  });
};

const startPersistedTurn = async (params: {
  message: string;
  context: AiToolContext;
  conversationId?: string | undefined;
}) => {
  try {
    const conversation = await ensureConversation(
      params.context,
      params.conversationId
    );
    if (!conversation) return null;

    await prisma.salonAssistantMessage.create({
      data: {
        conversationId: conversation.id,
        senderType: "USER",
        content: params.message,
        status: "COMPLETED",
        createdById: params.context.userId,
      },
    });

    const assistant = await prisma.salonAssistantMessage.create({
      data: {
        conversationId: conversation.id,
        senderType: "ASSISTANT",
        content: "",
        status: "STREAMING",
        ...providerMetadata(),
      },
      select: { id: true },
    });

    return {
      conversationId: conversation.id,
      assistantMessageId: assistant.id,
      conversation,
    };
  } catch {
    return null;
  }
};

const completePersistedTurn = async (params: {
  assistantMessageId: string;
  answer: string;
  usedFallback?: boolean;
}) =>
  prisma.salonAssistantMessage.update({
    where: { id: params.assistantMessageId },
    data: {
      content: params.answer,
      status: "COMPLETED",
      ...providerMetadata(params.usedFallback),
    },
  });

const failPersistedTurn = async (params: {
  assistantMessageId: string;
  answer: string;
  errorCode: string;
}) =>
  prisma.salonAssistantMessage.update({
    where: { id: params.assistantMessageId },
    data: {
      content: params.answer,
      status: "FAILED",
      errorCode: params.errorCode,
      ...providerMetadata(true),
    },
  });

export async function chatWithAiAssistant(params: {
  message: string;
  context: AiToolContext;
  uiContext?: SalonAiUiContext | undefined;
  conversationId?: string | undefined;
}): Promise<{
  answer: string;
  responseMode: SalonAiResponseMode;
  summary?: string | undefined;
  cards?: SalonAiCard[] | undefined;
  table?: SalonAiTable | undefined;
  suggestedActions?: SalonAiSuggestedAction[] | undefined;
  suggestedPrompts?: string[] | undefined;
  warnings?: string[] | undefined;
  usedTools: UsedTool[];
  dailyBrief?: DailyBriefResponse | undefined;
  clarification?: ClarificationResponse | undefined;
  conversationId?: string | undefined;
}> {
  const message = params.message.trim();
  if (!message) {
    return {
      answer: UNKNOWN_INTENT_FALLBACK,
      responseMode: "QUICK_ANSWER",
      usedTools: [],
      suggestedPrompts: defaultSuggestedPrompts(params.uiContext),
    };
  }

  const persistedTurn = await startPersistedTurn({
    message,
    context: params.context,
    conversationId: params.conversationId,
  });

  const finish = async (result: {
    answer: string;
    responseMode: SalonAiResponseMode;
    summary?: string | undefined;
    cards?: SalonAiCard[] | undefined;
    table?: SalonAiTable | undefined;
    suggestedActions?: SalonAiSuggestedAction[] | undefined;
    suggestedPrompts?: string[] | undefined;
      warnings?: string[] | undefined;
      usedTools: UsedTool[];
      usedFallback?: boolean;
      dailyBrief?: DailyBriefResponse | undefined;
      clarification?: ClarificationResponse | undefined;
    }) => {
    if (persistedTurn) {
      await completePersistedTurn({
        assistantMessageId: persistedTurn.assistantMessageId,
        answer: result.answer,
        ...(result.usedFallback !== undefined
          ? { usedFallback: result.usedFallback }
          : {}),
      }).catch(() => undefined);
    }
    return {
      answer: result.answer,
      responseMode: result.responseMode,
      ...(result.summary ? { summary: result.summary } : {}),
      ...(result.cards?.length ? { cards: result.cards } : {}),
      ...(result.table ? { table: result.table } : {}),
      ...(result.suggestedActions?.length
        ? { suggestedActions: validateSuggestedActions(result.suggestedActions) }
        : {}),
      ...(result.suggestedPrompts?.length
        ? { suggestedPrompts: result.suggestedPrompts.slice(0, 4) }
        : {}),
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      ...(result.dailyBrief ? { dailyBrief: result.dailyBrief } : {}),
      ...(result.clarification ? { clarification: result.clarification } : {}),
      usedTools: result.usedTools,
      ...(persistedTurn ? { conversationId: persistedTurn.conversationId } : {}),
    };
  };

  if (isHelpOrGreeting(message)) {
    return finish({
      answer:
        "Hi. I can help with appointments, customers, billing, inventory, staff schedules, revenue, outstanding balances, packages, and memberships using only the salon data you are allowed to see.",
      responseMode: "QUICK_ANSWER",
      usedTools: [],
      suggestedPrompts: defaultSuggestedPrompts(params.uiContext),
    });
  }

  const plan = detectToolPlan(message, params.uiContext);

  if (plan.blocked) {
    return finish({
      answer:
        "I cannot perform that action from chat. I can prepare a safe preview for supported actions, but changes require an explicit confirmed backend action.",
      responseMode: "ACTION_PREVIEW",
      usedTools: [],
      suggestedActions: safeActionPreview(message, params.uiContext),
      warnings: ["No data was changed."],
    });
  }

  if (persistedTurn) {
    const stateful = await handleStatefulSalonRequest({
      message,
      conversation: persistedTurn.conversation,
      context: params.context,
    });
    if (stateful) {
      return finish(stateful);
    }
  }

  if (isDailyBriefRequest(message)) {
    const briefPlan = buildDailyBriefPlan();
    const { date } = await salonTodayRange(params.context);
    const executions = await Promise.all(
      briefPlan.steps.map(async (step) => {
        const tool = getAiToolByName(step.tool);
        if (!tool || tool.riskLevel !== "READ") {
          return {
            tool: step.tool,
            status: "FAILED" as const,
            warning: `${step.tool} is not an available read-only tool.`,
          };
        }
        if (!canUseAiTool(params.context.role, tool)) {
          return {
            tool: step.tool,
            status: "FAILED" as const,
            warning: `${step.tool} is restricted for your role.`,
          };
        }
        try {
          const result = await tool.run({
            message,
            context: params.context,
            uiContext: params.uiContext,
          });
          return {
            tool: step.tool,
            status: "SUCCESS" as const,
            result,
          };
        } catch {
          return {
            tool: step.tool,
            status: "FAILED" as const,
            warning: `${step.tool} data was unavailable.`,
          };
        }
      })
    );
    const toolResults = executions
      .map((execution) => execution.result)
      .filter((result): result is AiToolResult => Boolean(result));
    const dailyBrief = buildDailyBriefResponse({
      date,
      results: toolResults,
      sources: executions.map((execution) => ({
        tool: execution.tool,
        status: execution.status,
      })),
    });
    return finish({
      answer: dailyBrief.answer,
      responseMode: "ANALYSIS",
      summary: toolResults.map((result) => result.summary).join(" "),
      cards: dailyBrief.metrics.slice(0, 8).map((item) => ({
        type: "METRIC",
        title: item.label,
        value: String(item.value),
      })),
      suggestedActions: dailyBrief.actions.map((action) => ({
        id: action.type.toLowerCase(),
        label: action.label,
        actionType: "NAVIGATE",
        requiresConfirmation: action.requiresConfirmation,
        payload: { type: action.type, enabled: action.enabled },
      })),
      warnings: [
        ...executions
          .map((execution) => execution.warning)
          .filter((warning): warning is string => Boolean(warning)),
        ...dailyBrief.alerts.map((alert) => alert.message),
      ],
      usedTools: executions.map((execution) => ({
        name: execution.tool,
        status: execution.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      })),
      dailyBrief,
      usedFallback: false,
    });
  }

  const aiToolNames = await selectToolsWithAiSafely({
    userMessage: message,
    uiContext: params.uiContext,
  });
  const plannedToolNames = unique([...aiToolNames, ...plan.toolNames]).slice(
    0,
    4
  );

  if (!plannedToolNames.length) {
    return finish({
      answer: UNKNOWN_INTENT_FALLBACK,
      responseMode: "QUICK_ANSWER",
      usedTools: [],
      suggestedPrompts: defaultSuggestedPrompts(params.uiContext),
    });
  }

  const toolResults: AiToolResult[] = [];
  const usedTools: UsedTool[] = [];
  const warnings: string[] = [];

  for (const toolName of plannedToolNames) {
    const tool = getAiToolByName(toolName);
    if (!tool) {
      warnings.push(`${toolName} is not available yet.`);
      usedTools.push({ name: toolName, status: "FAILED" });
      continue;
    }

    if (!canUseAiTool(params.context.role, tool)) {
      warnings.push("Some requested information is restricted for your role.");
      usedTools.push({ name: toolName, status: "FAILED" });
      continue;
    }

    try {
      const result = await tool.run({
        message,
        context: params.context,
        uiContext: params.uiContext,
      });
      toolResults.push(result);
      usedTools.push({ name: toolName, status: "SUCCESS" });
    } catch {
      warnings.push(`I could not fetch ${tool.description.toLowerCase()}`);
      usedTools.push({ name: toolName, status: "FAILED" });
    }
  }

  if (!toolResults.length) {
    return finish({
      answer:
        warnings[0] ?? "You do not have permission to access that information.",
      responseMode: "ERROR_HELP",
      usedTools,
      warnings,
    });
  }

  const generated = await generateAnswerSafely({
    userMessage: message,
    toolResults,
    uiContext: params.uiContext,
  });
  const mode = chooseResponseMode(message, params.uiContext, toolResults);
  const structured = shapeStructuredResponse(toolResults, params.uiContext);

  return finish({
    answer: generated.answer,
    responseMode: mode,
    summary: toolResults.map((result) => result.summary).join(" "),
    ...structured,
    suggestedPrompts: defaultSuggestedPrompts(params.uiContext),
    warnings: [...warnings, ...(structured.warnings ?? [])],
    usedTools,
    usedFallback: generated.usedFallback,
  });
}

const chooseResponseMode = (
  message: string,
  uiContext: SalonAiUiContext | undefined,
  toolResults: AiToolResult[]
): SalonAiResponseMode => {
  const text = message.toLowerCase();
  if (/why|can't|cannot|failed|problem|issue/.test(text)) return "ERROR_HELP";
  if (/prepare|send|create|apply|record|cancel|move/.test(text)) {
    return "ACTION_PREVIEW";
  }
  if (toolResults.some((result) => result.table)) return "LIST";
  if (/focus|doing|compare|performance|should i|order first/.test(text)) {
    return "ANALYSIS";
  }
  if (uiContext?.selectedEntity) return "GUIDED_WORKFLOW";
  return toolResults.length > 1 ? "ANALYSIS" : "QUICK_ANSWER";
};

const shapeStructuredResponse = (
  toolResults: AiToolResult[],
  uiContext: SalonAiUiContext | undefined
) => {
  const cards = toolResults.flatMap((result) => result.cards ?? []).slice(0, 8);
  const table = toolResults.find((result) => result.table)?.table;
  const suggestedActions = validateSuggestedActions([
    ...toolResults.flatMap((result) => result.suggestedActions ?? []),
    ...contextualNavigationActions(uiContext),
  ]);
  const warnings = toolResults.flatMap((result) => result.warnings ?? []);
  return { cards, table, suggestedActions, warnings };
};

const contextualNavigationActions = (uiContext: SalonAiUiContext | undefined) => {
  if (uiContext?.module === "INVENTORY") {
    return [
      {
        id: "open-low-stock",
        label: "Open low stock",
        actionType: "NAVIGATE" as const,
        requiresConfirmation: false,
        payload: { route: "/admin/low-stock" },
      },
    ];
  }
  if (uiContext?.module === "DASHBOARD") {
    return [
      {
        id: "open-appointments",
        label: "Open appointments",
        actionType: "NAVIGATE" as const,
        requiresConfirmation: false,
        payload: { route: "/appointments" },
      },
    ];
  }
  return [];
};

const safeActionPreview = (
  message: string,
  uiContext: SalonAiUiContext | undefined
) => {
  const text = message.toLowerCase();
  if (text.includes("reminder") && uiContext?.module === "APPOINTMENTS") {
    return [
      {
        id: "prepare-reminders",
        label: "Prepare reminders",
        actionType: "PREVIEW_MESSAGE" as const,
        requiresConfirmation: false,
        payload: { customerIds: [] },
      },
    ];
  }
  return contextualNavigationActions(uiContext);
};

const defaultSuggestedPrompts = (uiContext: SalonAiUiContext | undefined) => {
  if (uiContext?.module === "INVENTORY") {
    return ["What should I order first?", "Which products are low stock?"];
  }
  if (uiContext?.module === "BILLING") {
    return ["Explain this bill.", "Which customers have pending balances?"];
  }
  if (uiContext?.module === "APPOINTMENTS") {
    return ["Are there any problems?", "Prepare reminders for unconfirmed appointments."];
  }
  return [
    "What should I focus on today?",
    "Show today's appointments, revenue and pending balances.",
  ];
};
