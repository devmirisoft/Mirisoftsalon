import type { SalonAiUiContext } from "./ai-tool.types.js";

export type AiToolPlan = {
  toolNames: string[];
  blocked: boolean;
};

const unique = (values: string[]) => [...new Set(values)];

export function detectToolPlan(
  message: string,
  uiContext?: SalonAiUiContext
): AiToolPlan {
  const text = message.toLowerCase();
  const toolNames: string[] = [];

  const blockedWords = [
    "sql",
    "drop table",
    "delete",
    "remove all",
    "update salary",
    "change salary",
    "cancel all",
    "edit invoice",
    "delete invoice",
    "delete customer",
    "export all",
    "show api key",
    "show password",
    "show token",
  ];

  if (blockedWords.some((word) => text.includes(word))) {
    return { toolNames: [], blocked: true };
  }

  const module = uiContext?.module;
  const selectedType = uiContext?.selectedEntity?.type;

  if (
    (text.includes("appointment") && text.includes("today")) ||
    text.includes("appointments today") ||
    text.includes("today's appointments") ||
    text.includes("problems") ||
    text.includes("focus on today") ||
    module === "APPOINTMENTS"
  ) {
    toolNames.push("getTodayAppointments");
  }

  if (text.includes("holiday") || text.includes("leave") || text.includes("off today")) {
    toolNames.push("getHolidaysToday");
  }

  if (text.includes("free") || text.includes("available") || text.includes("slot")) {
    toolNames.push("getStaffAvailability");
  }

  if (
    /\b(how many|count|total|number of)\b/.test(text) &&
    /\b(staff|employee|team member|people)\b/.test(text)
  ) {
    toolNames.push("getStaffSummary");
  }

  if (
    /\b(how many|count|total|number of|list|show)\b/.test(text) &&
    /\b(service|services|menu)\b/.test(text)
  ) {
    toolNames.push("getServiceSummary");
  }

  if (
    text.includes("revenue") ||
    text.includes("sales") ||
    text.includes("doing today") ||
    text.includes("focus on today") ||
    text.includes("today's appointments")
  ) {
    toolNames.push("getRevenueSummary");
  }

  if (
    text.includes("low stock") ||
    text.includes("stock low") ||
    text.includes("order first") ||
    module === "INVENTORY"
  ) {
    toolNames.push("getLowStockProducts");
  }

  if (
    text.includes("outstanding") ||
    text.includes("balance due") ||
    text.includes("pending balance") ||
    text.includes("pending balances") ||
    text.includes("focus on today")
  ) {
    toolNames.push("getOutstandingCustomers");
  }

  if (text.includes("package") && text.includes("expir")) {
    toolNames.push("getPackageExpirySummary");
  }

  if (text.includes("membership") && text.includes("expir")) {
    toolNames.push("getMembershipExpirySummary");
  }

  if (
    selectedType === "CUSTOMER" ||
    (module === "CUSTOMERS" &&
      /\b(this customer|know about|customer summary)\b/.test(text))
  ) {
    toolNames.unshift("getSelectedCustomerSummary");
  }

  if (
    selectedType === "INVOICE" ||
    (module === "BILLING" && /\b(this bill|this invoice|explain.*bill)\b/.test(text))
  ) {
    toolNames.unshift("getSelectedInvoiceSummary");
  }

  if (
    selectedType === "APPOINTMENT" ||
    (module === "APPOINTMENTS" &&
      /\b(this appointment|complete this|move this|why can't i complete)\b/.test(text))
  ) {
    toolNames.unshift("getSelectedAppointmentSummary");
  }

  if (
    selectedType === "STAFF" ||
    (module === "STAFF" && /\b(this staff|staff member|doing this month)\b/.test(text))
  ) {
    toolNames.unshift("getSelectedStaffPerformance");
  }

  return { toolNames: unique(toolNames).slice(0, 4), blocked: false };
}

export function detectToolName(message: string): string | "BLOCKED" | null {
  const plan = detectToolPlan(message);
  if (plan.blocked) return "BLOCKED";
  return plan.toolNames[0] ?? null;
}
