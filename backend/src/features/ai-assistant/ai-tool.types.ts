import { Role } from "../../generated/prisma/enums.js";

export type AiRole = Role;

export type AiToolContext = {
  userId: string;
  role: AiRole;
  salonId?: string;
  branchId?: string;
  allowedBranchIds?: string[] | undefined;
  timezone?: string | undefined;
  currency?: string | undefined;
  locale?: string | undefined;
  permissions?: string[] | undefined;
};

export type AiToolRiskLevel = "READ" | "WRITE";

export type AiToolSourceStatus = "SUCCESS" | "FAILED" | "PARTIAL";

export type DailyBriefResponse = {
  type: "DAILY_BRIEF";
  answer: string;
  confidence: {
    level: "HIGH" | "MEDIUM" | "LOW";
    score: number;
    limitations?: string[] | undefined;
  };
  metrics: Array<{
    key: string;
    label: string;
    value: number | string;
    format?: "NUMBER" | "INR" | "PERCENT" | "TIME" | undefined;
  }>;
  alerts: Array<{
    severity: "INFO" | "WARNING" | "CRITICAL";
    code: string;
    message: string;
    evidence?: Record<string, unknown> | undefined;
  }>;
  actions: Array<{
    type: string;
    label: string;
    requiresConfirmation: boolean;
    enabled: boolean;
  }>;
  sources: Array<{
    tool: string;
    status: AiToolSourceStatus;
  }>;
};

export type ClarificationResponse = {
  type: "CLARIFICATION_REQUIRED";
  clarificationId: string;
  question: string;
  candidates?: Array<{
    candidateId: string;
    label: string;
    description?: string | undefined;
  }> | undefined;
  allowFreeText: boolean;
  expiresAt: string;
};

export type EntityReference = {
  type: "CUSTOMER" | "STAFF" | "SERVICE" | "APPOINTMENT" | "INVOICE";
  id: string;
  displayName: string;
  resolvedAt: string;
};

export type SalonConversationState = {
  version: number;
  summary: string;
  activeIntent?: string | undefined;
  activeEntities: {
    customer?: EntityReference | undefined;
    staff?: EntityReference | undefined;
    service?: EntityReference | undefined;
    appointment?: EntityReference | undefined;
    invoice?: EntityReference | undefined;
  };
  activeFilters: {
    dateRange?: {
      from: string;
      to: string;
      timezone: string;
    } | undefined;
    paymentStatus?: string[] | undefined;
    appointmentStatus?: string[] | undefined;
    minimumLoyaltyPoints?: number | undefined;
    inactivityDays?: number | undefined;
    branchId?: string | undefined;
    timeExpression?: string | undefined;
  };
  previousResult?: {
    resultId: string;
    toolName: string;
    queryFingerprint: string;
    resultCount: number;
    selectedEntityIds?: string[] | undefined;
    createdAt: string;
    expiresAt: string;
  } | undefined;
  pendingClarification?: {
    clarificationId: string;
    type: "CUSTOMER" | "STAFF" | "SERVICE" | "DATE" | "TIME" | "OTHER";
    originalMessage: string;
    candidates: Array<{
      candidateId: string;
      displayLabel: string;
      description?: string | undefined;
      entityId?: string | undefined;
    }>;
    planDraft?: Record<string, unknown> | undefined;
    createdAt: string;
    expiresAt: string;
  } | undefined;
};

export type SalonAiUiContext = {
  route: string;
  module:
    | "DASHBOARD"
    | "APPOINTMENTS"
    | "CUSTOMERS"
    | "BILLING"
    | "PAYMENTS"
    | "INVENTORY"
    | "STAFF"
    | "MEMBERSHIPS"
    | "PACKAGES"
    | "EXPENSES"
    | "REPORTS"
    | "SETTINGS"
    | "OTHER";
  pageTitle?: string | undefined;
  selectedEntity?: {
    type:
      | "APPOINTMENT"
      | "CUSTOMER"
      | "INVOICE"
      | "PAYMENT"
      | "PRODUCT"
      | "STAFF"
      | "MEMBERSHIP"
      | "PACKAGE";
    id: string;
  };
  selectedDate?: string | undefined;
  dateRange?: {
    from: string;
    to: string;
  } | undefined;
  visibleFilters?: Record<string, unknown> | undefined;
};

export type SalonAiResponseMode =
  | "QUICK_ANSWER"
  | "ANALYSIS"
  | "LIST"
  | "GUIDED_WORKFLOW"
  | "ACTION_PREVIEW"
  | "ERROR_HELP";

export type SalonAiCard = {
  type: "METRIC" | "WARNING" | "INSIGHT" | "ENTITY";
  title: string;
  value?: string | undefined;
  description?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
};

export type SalonAiTable = {
  columns: Array<{
    key: string;
    label: string;
  }>;
  rows: Array<Record<string, unknown>>;
};

export type SalonAiSuggestedAction = {
  id: string;
  label: string;
  actionType:
    | "NAVIGATE"
    | "OPEN_ENTITY"
    | "PREFILL_FORM"
    | "PREVIEW_MESSAGE"
    | "RUN_FOLLOW_UP";
  requiresConfirmation: boolean;
  payload: Record<string, unknown>;
};

export type AiToolResult = {
  summary: string;
  data?: unknown;
  dailyBrief?: Partial<DailyBriefResponse> | undefined;
  cards?: SalonAiCard[] | undefined;
  table?: SalonAiTable | undefined;
  suggestedActions?: SalonAiSuggestedAction[] | undefined;
  warnings?: string[] | undefined;
};

export type AiToolRunParams = {
  message: string;
  context: AiToolContext;
  uiContext?: SalonAiUiContext | undefined;
};

export interface AiTool {
  name: string;
  description: string;
  requiredPermissions?: string[] | undefined;
  riskLevel?: AiToolRiskLevel | undefined;
  inputSchema?: unknown;
  outputSchema?: unknown;
  allowedRoles: AiRole[];
  run(params: AiToolRunParams): Promise<AiToolResult>;
}

export const AI_ROLES = Object.values(Role) as readonly AiRole[];

export function isAiRole(value: unknown): value is AiRole {
  return typeof value === "string" && AI_ROLES.includes(value as AiRole);
}
