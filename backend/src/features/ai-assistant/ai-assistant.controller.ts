import type { Request, Response } from "express";
import { chatWithAiAssistant } from "./ai-assistant.service.js";
import { isAiRole, type SalonAiUiContext } from "./ai-tool.types.js";

const MAX_MESSAGE_LENGTH = 1_000;
const UI_MODULES = new Set<SalonAiUiContext["module"]>([
  "DASHBOARD",
  "APPOINTMENTS",
  "CUSTOMERS",
  "BILLING",
  "PAYMENTS",
  "INVENTORY",
  "STAFF",
  "MEMBERSHIPS",
  "PACKAGES",
  "EXPENSES",
  "REPORTS",
  "SETTINGS",
  "OTHER",
]);
const ENTITY_TYPES = new Set([
  "APPOINTMENT",
  "CUSTOMER",
  "INVOICE",
  "PAYMENT",
  "PRODUCT",
  "STAFF",
  "MEMBERSHIP",
  "PACKAGE",
]);

const safeString = (value: unknown, max = 200) =>
  typeof value === "string" ? value.slice(0, max) : undefined;

const parseUiContext = (value: unknown): SalonAiUiContext | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const route = safeString(raw.route, 300) ?? "/";
  const module = UI_MODULES.has(raw.module as SalonAiUiContext["module"])
    ? (raw.module as SalonAiUiContext["module"])
    : "OTHER";
  const selectedRaw =
    raw.selectedEntity && typeof raw.selectedEntity === "object"
      ? (raw.selectedEntity as Record<string, unknown>)
      : null;
  const selectedEntity =
    selectedRaw &&
    ENTITY_TYPES.has(String(selectedRaw.type)) &&
    typeof selectedRaw.id === "string"
      ? {
          type: selectedRaw.type as NonNullable<
            SalonAiUiContext["selectedEntity"]
          >["type"],
          id: selectedRaw.id.slice(0, 100),
        }
      : undefined;
  const dateRangeRaw =
    raw.dateRange && typeof raw.dateRange === "object"
      ? (raw.dateRange as Record<string, unknown>)
      : null;

  return {
    route,
    module,
    ...(safeString(raw.pageTitle, 120) ? { pageTitle: safeString(raw.pageTitle, 120) } : {}),
    ...(selectedEntity ? { selectedEntity } : {}),
    ...(safeString(raw.selectedDate, 20) ? { selectedDate: safeString(raw.selectedDate, 20) } : {}),
    ...(dateRangeRaw &&
    typeof dateRangeRaw.from === "string" &&
    typeof dateRangeRaw.to === "string"
      ? {
          dateRange: {
            from: dateRangeRaw.from.slice(0, 20),
            to: dateRangeRaw.to.slice(0, 20),
          },
        }
      : {}),
    ...(raw.visibleFilters && typeof raw.visibleFilters === "object"
      ? { visibleFilters: raw.visibleFilters as Record<string, unknown> }
      : {}),
  };
};

export async function chat(req: Request, res: Response) {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Message is required.",
    });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    });
  }

  const user = req.user;
  if (!user || !isAiRole(user.role) || typeof user.userId !== "string") {
    return res.status(403).json({
      success: false,
      message: "AI assistant access is not available for this account.",
    });
  }

  if (!user.salonId) {
    return res.status(403).json({
      success: false,
      message: "Salon access denied.",
    });
  }

  const result = await chatWithAiAssistant({
    message,
    conversationId: safeString(req.body?.conversationId, 100),
    uiContext: parseUiContext(req.body?.uiContext),
    context: {
      userId: user.userId,
      role: user.role,
      ...(user.salonId ? { salonId: user.salonId } : {}),
      ...(user.branchId ? { branchId: user.branchId } : {}),
    },
  });

  return res.json({
    success: true,
    data: result,
  });
}

export async function chatStream(req: Request, res: Response) {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Message is required.",
    });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    });
  }

  const user = req.user;
  if (!user || !isAiRole(user.role) || typeof user.userId !== "string") {
    return res.status(403).json({
      success: false,
      message: "AI assistant access is not available for this account.",
    });
  }

  if (!user.salonId) {
    return res.status(403).json({
      success: false,
      message: "Salon access denied.",
    });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const write = (event: Record<string, unknown>) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    write({ type: "message.created" });
    write({ type: "assistant.started" });

    const result = await chatWithAiAssistant({
      message,
      conversationId: safeString(req.body?.conversationId, 100),
      uiContext: parseUiContext(req.body?.uiContext),
      context: {
        userId: user.userId,
        role: user.role,
        ...(user.salonId ? { salonId: user.salonId } : {}),
        ...(user.branchId ? { branchId: user.branchId } : {}),
      },
    });

    write({
      type: "assistant.delta",
      delta: result.answer,
      ...(result.conversationId
        ? { conversationId: result.conversationId }
        : {}),
    });
    write({
      type: "assistant.completed",
      data: result,
    });
  } catch {
    write({
      type: "assistant.failed",
      message: "AI assistant failed. Please try again.",
    });
  } finally {
    res.end();
  }
}
