import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import {
  parseSalonDateRange,
  salonLocalDateTimeToUtc,
} from "../../utils/timezone.js";
import { checkStaffAvailabilityForSlot } from "../staff-availability/staffAvailability.service.js";
import { aiExactBranchScope } from "./ai-permission.service.js";
import { salonTodayRange } from "./tools/dailyBrief.tools.js";
import type {
  AiToolContext,
  ClarificationResponse,
  SalonAiCard,
  SalonAiResponseMode,
  SalonAiTable,
  SalonConversationState,
} from "./ai-tool.types.js";

type ConversationRecord = {
  id: string;
  stateJson: unknown;
  stateVersion: number;
};

type StatefulResponse = {
  answer: string;
  responseMode: SalonAiResponseMode;
  summary?: string | undefined;
  cards?: SalonAiCard[] | undefined;
  table?: SalonAiTable | undefined;
  warnings?: string[] | undefined;
  usedTools: Array<{ name: string; status: "SUCCESS" | "FAILED" }>;
  clarification?: ClarificationResponse | undefined;
};

const RESULT_TTL_MS = 15 * 60_000;
const CLARIFICATION_TTL_MS = 10 * 60_000;

const defaultState = (): SalonConversationState => ({
  version: 1,
  summary: "",
  activeEntities: {},
  activeFilters: {},
});

const asState = (value: unknown): SalonConversationState => {
  if (!value || typeof value !== "object") return defaultState();
  const raw = value as Partial<SalonConversationState>;
  return {
    version: Number(raw.version ?? 1),
    summary: typeof raw.summary === "string" ? raw.summary : "",
    activeIntent: raw.activeIntent,
    activeEntities: raw.activeEntities ?? {},
    activeFilters: raw.activeFilters ?? {},
    previousResult: raw.previousResult,
    pendingClarification: raw.pendingClarification,
  };
};

const expiresAt = (ms: number) => new Date(Date.now() + ms).toISOString();
const isExpired = (iso: string | undefined) =>
  !iso || new Date(iso).getTime() <= Date.now();

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ordinal = (message: string) => {
  const text = normalize(message);
  if (/\b(first|1st|one)\b/.test(text)) return 0;
  if (/\b(second|2nd|two)\b/.test(text)) return 1;
  if (/\b(third|3rd|three)\b/.test(text)) return 2;
  const numeric = /\b(\d+)\b/.exec(text);
  return numeric?.[1] ? Number(numeric[1]) - 1 : undefined;
};

const requestedTime = (message: string) => {
  const meridiem = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(message);
  if (meridiem?.[1] && meridiem[3]) {
    let hour = Number(meridiem[1]);
    const minute = Number(meridiem[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return undefined;
    const suffix = meridiem[3].toLowerCase();
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const clock = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(message);
  if (!clock?.[1] || !clock[2]) return undefined;
  return `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}`;
};

const addDays = (date: string, days: number) => {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
};

const detectDate = async (message: string, context: AiToolContext) => {
  const day = await salonTodayRange(context);
  const text = normalize(message);
  if (text.includes("tomorrow")) return addDays(day.date, 1);
  if (text.includes("yesterday")) return addDays(day.date, -1);
  if (text.includes("today")) return day.date;
  return undefined;
};

const nameAfterOnly = (message: string) => {
  const match =
    /\bonly\s+([a-z][a-z .'-]{1,60})(?:'s|’s)?[.?!]?\s*$/i.exec(message) ??
    /\bshow\s+([a-z][a-z .'-]{1,60}?)(?:'s|’s)\b/i.exec(message) ??
    /^([a-z][a-z .'-]{1,60})[.?!]?\s*$/i.exec(message);
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  const possessiveCleaned = value
    .replace(/[.?!]+$/g, "")
    .replace(/['’]s$/i, "")
    .trim();
  const ignored = new Set(["those", "that", "this", "tomorrow instead"]);
  return ignored.has(normalize(possessiveCleaned)) ? undefined : possessiveCleaned;
};

const phoneFragment = (phone: string | null | undefined) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `Ending ${digits.slice(-4)}` : undefined;
};

async function updateState(
  conversation: ConversationRecord,
  nextState: SalonConversationState
) {
  const next = {
    ...nextState,
    version: conversation.stateVersion + 1,
  };
  const updated = await prisma.salonAssistantConversation.updateMany({
    where: { id: conversation.id, stateVersion: conversation.stateVersion },
    data: {
      stateJson: JSON.parse(JSON.stringify(next)),
      stateVersion: { increment: 1 },
    },
  });
  return updated.count === 1;
}

async function resolveCustomer(name: string, context: AiToolContext) {
  const needle = normalize(name);
  const customers = await prisma.customer.findMany({
    where: aiExactBranchScope(context),
    select: {
      id: true,
      name: true,
      customerCode: true,
      phone: true,
      loyaltyPoints: true,
    },
    orderBy: { name: "asc" },
    take: 100,
  });
  const matches = customers.filter((customer) => {
    const candidate = normalize(customer.name);
    return candidate === needle || candidate.includes(needle);
  });
  return matches.map((customer) => ({
    id: customer.id,
    displayName: customer.name,
    description:
      phoneFragment(customer.phone) ?? `Code ${customer.customerCode}`,
  }));
}

async function resolveStaff(name: string, context: AiToolContext) {
  const needle = normalize(name);
  const staff = await prisma.staff.findMany({
    where: { ...aiExactBranchScope(context), status: true },
    select: { id: true, name: true, jobRole: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return staff
    .filter((member) => {
      const candidate = normalize(member.name);
      return candidate === needle || candidate.includes(needle);
    })
    .map((member) => ({
      id: member.id,
      displayName: member.name,
      description: member.jobRole,
    }));
}

const clarification = (
  state: SalonConversationState
): ClarificationResponse | undefined => {
  const pending = state.pendingClarification;
  if (!pending) return undefined;
  return {
    type: "CLARIFICATION_REQUIRED",
    clarificationId: pending.clarificationId,
    question:
      pending.type === "CUSTOMER"
        ? "Which customer do you mean?"
        : pending.type === "STAFF"
          ? "Which staff member do you mean?"
          : "Which option do you mean?",
    candidates: pending.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.displayLabel,
      ...(candidate.description ? { description: candidate.description } : {}),
    })),
    allowFreeText: true,
    expiresAt: pending.expiresAt,
  };
};

async function askClarification(params: {
  conversation: ConversationRecord;
  state: SalonConversationState;
  type: "CUSTOMER" | "STAFF";
  originalMessage: string;
  candidates: Array<{ id: string; displayName: string; description?: string | undefined }>;
  planDraft: Record<string, unknown>;
}) {
  const nextState: SalonConversationState = {
    ...params.state,
    pendingClarification: {
      clarificationId: randomUUID(),
      type: params.type,
      originalMessage: params.originalMessage,
      candidates: params.candidates.map((candidate) => ({
        candidateId: randomUUID(),
        displayLabel: candidate.displayName,
        ...(candidate.description ? { description: candidate.description } : {}),
        entityId: candidate.id,
      })),
      planDraft: params.planDraft,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt(CLARIFICATION_TTL_MS),
    },
  };
  await updateState(params.conversation, nextState);
  return {
    answer:
      params.type === "CUSTOMER"
        ? "Which customer do you mean?"
        : "Which staff member do you mean?",
    responseMode: "GUIDED_WORKFLOW" as const,
    usedTools: [],
    clarification: clarification(nextState),
  };
}

async function resolvePendingClarification(params: {
  message: string;
  conversation: ConversationRecord;
  state: SalonConversationState;
  context: AiToolContext;
}) {
  const pending = params.state.pendingClarification;
  if (!pending) return undefined;
  if (isExpired(pending.expiresAt)) {
    const nextState = { ...params.state, pendingClarification: undefined };
    await updateState(params.conversation, nextState);
    return {
      answer: "That clarification expired. Please ask the question again.",
      responseMode: "ERROR_HELP" as const,
      usedTools: [],
      warnings: ["Expired clarification was not reused."],
    };
  }
  const index = ordinal(params.message);
  const byCandidateId = pending.candidates.find(
    (candidate) => candidate.candidateId === params.message.trim()
  );
  const byOrdinal =
    index !== undefined && index >= 0 ? pending.candidates[index] : undefined;
  const byName = pending.candidates.find(
    (candidate) =>
      normalize(candidate.displayLabel) === normalize(params.message) ||
      normalize(candidate.displayLabel).includes(normalize(params.message))
  );
  const selected = byCandidateId ?? byOrdinal ?? byName;
  if (!selected?.entityId) {
    return {
      answer: "I could not match that to one of the clarification options.",
      responseMode: "ERROR_HELP" as const,
      usedTools: [],
      clarification: clarification(params.state),
    };
  }

  const entity =
    pending.type === "CUSTOMER"
      ? await resolveCustomer(selected.displayLabel, params.context)
      : await resolveStaff(selected.displayLabel, params.context);
  if (!entity.some((item) => item.id === selected.entityId)) {
    return {
      answer: "That option is no longer available with your current access.",
      responseMode: "ERROR_HELP" as const,
      usedTools: [],
    };
  }
  const planDraft = pending.planDraft ?? {};
  const nextState: SalonConversationState = {
    ...params.state,
    pendingClarification: undefined,
    activeIntent: String(planDraft.intent ?? params.state.activeIntent ?? ""),
    activeEntities: {
      ...params.state.activeEntities,
      ...(pending.type === "CUSTOMER"
        ? {
            customer: {
              type: "CUSTOMER" as const,
              id: selected.entityId,
              displayName: selected.displayLabel,
              resolvedAt: new Date().toISOString(),
            },
          }
        : {
            staff: {
              type: "STAFF" as const,
              id: selected.entityId,
              displayName: selected.displayLabel,
              resolvedAt: new Date().toISOString(),
            },
          }),
    },
  };
  const intent = String(planDraft.intent ?? params.state.activeIntent ?? "");
  if (intent === "UNPAID_INVOICES") {
    return unpaidInvoices(params.conversation, nextState, params.context);
  }
  if (intent === "APPOINTMENTS") {
    return appointments(params.conversation, nextState, params.context);
  }
  await updateState(params.conversation, nextState);
  return {
    answer: `I selected ${selected.displayLabel}.`,
    responseMode: "QUICK_ANSWER" as const,
    usedTools: [],
  };
}

async function unpaidInvoices(
  conversation: ConversationRecord,
  state: SalonConversationState,
  context: AiToolContext
): Promise<StatefulResponse> {
  const customer = state.activeEntities.customer;
  const where = {
    ...aiExactBranchScope(context),
    status: "ISSUED" as const,
    balanceAmount: { gt: 0 },
    ...(customer ? { customerId: customer.id } : {}),
  };
  const [invoices, aggregate, count] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        invoiceCode: true,
        customerName: true,
        balanceAmount: true,
        paymentStatus: true,
      },
      orderBy: { balanceAmount: "desc" },
      take: 10,
    }),
    prisma.invoice.aggregate({ where, _sum: { balanceAmount: true } }),
    prisma.invoice.count({ where }),
  ]);
  const total = Number(aggregate._sum?.balanceAmount ?? 0);
  const nextState: SalonConversationState = {
    ...state,
    activeIntent: "UNPAID_INVOICES",
    activeFilters: {
      ...state.activeFilters,
      paymentStatus: ["UNPAID", "PARTIALLY_PAID"],
    },
    previousResult: {
      resultId: randomUUID(),
      toolName: "GetUnpaidInvoices",
      queryFingerprint: JSON.stringify({
        intent: "UNPAID_INVOICES",
        customerId: customer?.id ?? null,
        branchId: context.branchId ?? null,
      }),
      resultCount: count,
      ...(customer ? { selectedEntityIds: [customer.id] } : {}),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt(RESULT_TTL_MS),
    },
    summary: customer
      ? `The user viewed unpaid invoices for ${customer.displayName}.`
      : "The user viewed unpaid invoices.",
  };
  await updateState(conversation, nextState);
  const target = customer ? `${customer.displayName} has` : "Found";
  return {
    answer: `${target} ${count} unpaid invoice${
      count === 1 ? "" : "s"
    } totaling ${total.toFixed(2)}.`,
    responseMode: "LIST",
    summary: nextState.summary,
    usedTools: [{ name: "GetUnpaidInvoices", status: "SUCCESS" }],
    cards: [
      { type: "METRIC", title: "Unpaid invoices", value: String(count) },
      { type: "WARNING", title: "Balance", value: `₹${total.toFixed(2)}` },
    ],
    table: {
      columns: [
        { key: "invoiceCode", label: "Invoice" },
        { key: "customerName", label: "Customer" },
        { key: "balanceAmount", label: "Balance" },
      ],
      rows: invoices.map((invoice) => ({
        invoiceCode: invoice.invoiceCode,
        customerName: invoice.customerName,
        balanceAmount: Number(invoice.balanceAmount),
        paymentStatus: invoice.paymentStatus,
      })),
    },
  };
}

async function appointments(
  conversation: ConversationRecord,
  state: SalonConversationState,
  context: AiToolContext
): Promise<StatefulResponse> {
  const { timezone } = await salonTodayRange(context);
  const date = state.activeFilters.dateRange?.from ?? (await salonTodayRange(context)).date;
  const range = parseSalonDateRange(date, date, timezone);
  if (!range.start || !range.end) throw new Error("Unable to resolve date");
  const staff = state.activeEntities.staff;
  const appointmentsToday = await prisma.appointment.findMany({
    where: {
      ...aiExactBranchScope(context),
      ...(staff ? { staffId: staff.id } : {}),
      startTime: { gte: range.start, lt: range.end },
    },
    select: {
      appointmentCode: true,
      startTime: true,
      status: true,
      customer: { select: { name: true } },
      staff: { select: { name: true } },
    },
    orderBy: { startTime: "asc" },
    take: 10,
  });
  const nextState: SalonConversationState = {
    ...state,
    activeIntent: "APPOINTMENTS",
    activeFilters: {
      ...state.activeFilters,
      dateRange: { from: date, to: date, timezone },
    },
    previousResult: {
      resultId: randomUUID(),
      toolName: "GetTodayAppointments",
      queryFingerprint: JSON.stringify({
        intent: "APPOINTMENTS",
        date,
        staffId: staff?.id ?? null,
        branchId: context.branchId ?? null,
      }),
      resultCount: appointmentsToday.length,
      ...(staff ? { selectedEntityIds: [staff.id] } : {}),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt(RESULT_TTL_MS),
    },
    summary: staff
      ? `The user viewed ${staff.displayName}'s appointments for ${date}.`
      : `The user viewed appointments for ${date}.`,
  };
  await updateState(conversation, nextState);
  return {
    answer: `${staff ? `${staff.displayName} has` : "Found"} ${
      appointmentsToday.length
    } appointment${appointmentsToday.length === 1 ? "" : "s"} for ${date}.`,
    responseMode: "LIST",
    usedTools: [{ name: "GetTodayAppointments", status: "SUCCESS" }],
    table: {
      columns: [
        { key: "time", label: "Time" },
        { key: "customer", label: "Customer" },
        { key: "staff", label: "Staff" },
        { key: "status", label: "Status" },
      ],
      rows: appointmentsToday.map((appointment) => ({
        time: appointment.startTime.toISOString(),
        customer: appointment.customer.name,
        staff: appointment.staff?.name ?? "",
        status: appointment.status,
      })),
    },
  };
}

async function staffAvailability(
  conversation: ConversationRecord,
  state: SalonConversationState,
  context: AiToolContext
): Promise<StatefulResponse> {
  const day = await salonTodayRange(context);
  const time = state.activeFilters.timeExpression;
  if (!time) {
    return {
      answer: "Please include a time, for example 4 PM.",
      responseMode: "ERROR_HELP",
      usedTools: [],
    };
  }
  const startTime = salonLocalDateTimeToUtc(day.date, time, day.timezone);
  const endTime = new Date(startTime.getTime() + 30 * 60_000);
  const staff = await prisma.staff.findMany({
    where: { ...aiExactBranchScope(context), status: true },
    select: { id: true, name: true, jobRole: true },
    orderBy: { name: "asc" },
  });
  const checked = await Promise.all(
    staff.map(async (member) => ({
      member,
      check: await checkStaffAvailabilityForSlot({
        staffId: member.id,
        startTime,
        endTime,
        ...(context.salonId ? { salonId: context.salonId } : {}),
        ...(context.branchId ? { branchId: context.branchId } : {}),
      }),
    }))
  );
  const available = checked.filter((item) => item.check.available);
  const nextState: SalonConversationState = {
    ...state,
    activeIntent: "STAFF_AVAILABILITY",
    activeFilters: { ...state.activeFilters, timeExpression: time },
    previousResult: {
      resultId: randomUUID(),
      toolName: "getStaffAvailability",
      queryFingerprint: JSON.stringify({ intent: "STAFF_AVAILABILITY", time }),
      resultCount: available.length,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt(RESULT_TTL_MS),
    },
    summary: `The user checked staff availability at ${time}.`,
  };
  await updateState(conversation, nextState);
  return {
    answer: `${available.length} staff member${
      available.length === 1 ? " is" : "s are"
    } available at ${time}.`,
    responseMode: "LIST",
    usedTools: [{ name: "getStaffAvailability", status: "SUCCESS" }],
    table: {
      columns: [
        { key: "staffName", label: "Staff" },
        { key: "jobRole", label: "Role" },
      ],
      rows: available.map(({ member }) => ({
        staffName: member.name,
        jobRole: member.jobRole,
      })),
    },
  };
}

async function inactiveCustomers(
  conversation: ConversationRecord,
  state: SalonConversationState,
  context: AiToolContext
): Promise<StatefulResponse> {
  const days = state.activeFilters.inactivityDays ?? 90;
  const minimumPoints = state.activeFilters.minimumLoyaltyPoints;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
  const customers = await prisma.customer.findMany({
    where: {
      ...aiExactBranchScope(context),
      ...(minimumPoints ? { loyaltyPoints: { gt: minimumPoints } } : {}),
    },
    select: {
      customerCode: true,
      name: true,
      loyaltyPoints: true,
      appointments: {
        select: { startTime: true },
        orderBy: { startTime: "desc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
    take: 100,
  });
  const inactive = customers.filter((customer) => {
    const last = customer.appointments[0]?.startTime;
    return !last || last < cutoff;
  });
  const nextState: SalonConversationState = {
    ...state,
    activeIntent: "INACTIVE_CUSTOMERS",
    activeFilters: {
      ...state.activeFilters,
      inactivityDays: days,
      ...(minimumPoints ? { minimumLoyaltyPoints: minimumPoints } : {}),
    },
    previousResult: {
      resultId: randomUUID(),
      toolName: "GetInactiveCustomers",
      queryFingerprint: JSON.stringify({ days, minimumPoints, branchId: context.branchId }),
      resultCount: inactive.length,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt(RESULT_TTL_MS),
    },
    summary: `The user viewed customers inactive for ${days} days${
      minimumPoints ? ` with more than ${minimumPoints} loyalty points` : ""
    }.`,
  };
  await updateState(conversation, nextState);
  return {
    answer: `Found ${inactive.length} customer${
      inactive.length === 1 ? "" : "s"
    } inactive for ${days} days${
      minimumPoints ? ` with more than ${minimumPoints} loyalty points` : ""
    }.`,
    responseMode: "LIST",
    usedTools: [{ name: "GetInactiveCustomers", status: "SUCCESS" }],
    table: {
      columns: [
        { key: "customerCode", label: "Code" },
        { key: "name", label: "Customer" },
        { key: "loyaltyPoints", label: "Points" },
      ],
      rows: inactive.slice(0, 10).map((customer) => ({
        customerCode: customer.customerCode,
        name: customer.name,
        loyaltyPoints: customer.loyaltyPoints,
      })),
    },
  };
}

export async function handleStatefulSalonRequest(params: {
  message: string;
  conversation: ConversationRecord;
  context: AiToolContext;
}): Promise<StatefulResponse | undefined> {
  const message = params.message.trim();
  const state = asState(params.conversation.stateJson);
  const pending = await resolvePendingClarification({
    message,
    conversation: params.conversation,
    state,
    context: params.context,
  });
  if (pending) return pending;

  const text = normalize(message);
  const inheritedIntent = state.activeIntent;
  const date = await detectDate(message, params.context);
  let time = requestedTime(message);
  if (
    time &&
    inheritedIntent === "STAFF_AVAILABILITY" &&
    !/\b(am|pm)\b/i.test(message) &&
    Number(time.slice(0, 2)) < 12 &&
    Number(state.activeFilters.timeExpression?.slice(0, 2) ?? 0) >= 12
  ) {
    time = `${String(Number(time.slice(0, 2)) + 12).padStart(2, "0")}${time.slice(2)}`;
  }
  const loyalty = /\b(?:over|more than|above)\s+(\d+)\s+loyalty/i.exec(message);
  const inactivity = /\binactive\s+for\s+(\d+)\s+days/i.exec(message);
  const currentName = nameAfterOnly(message);

  if (
    text.includes("unpaid invoice") ||
    (inheritedIntent === "UNPAID_INVOICES" && currentName)
  ) {
    const customerName =
      currentName && !text.includes("unpaid invoice") ? currentName : undefined;
    const nextState: SalonConversationState = {
      ...state,
      activeIntent: "UNPAID_INVOICES",
      activeFilters: {
        ...state.activeFilters,
        paymentStatus: ["UNPAID", "PARTIALLY_PAID"],
      },
      activeEntities:
        inheritedIntent === "UNPAID_INVOICES"
          ? state.activeEntities
          : {},
    };
    if (customerName) {
      const candidates = await resolveCustomer(customerName, params.context);
      if (candidates.length === 0) {
        return {
          answer: `I could not find an authorized customer matching "${customerName}".`,
          responseMode: "ERROR_HELP",
          usedTools: [],
        };
      }
      if (candidates.length > 1) {
        return askClarification({
          conversation: params.conversation,
          state: nextState,
          type: "CUSTOMER",
          originalMessage: message,
          candidates,
          planDraft: { intent: "UNPAID_INVOICES" },
        });
      }
      const candidate = candidates[0];
      if (!candidate) return undefined;
      nextState.activeEntities = {
        ...nextState.activeEntities,
        customer: {
          type: "CUSTOMER",
          id: candidate.id,
          displayName: candidate.displayName,
          resolvedAt: new Date().toISOString(),
        },
      };
    }
    return unpaidInvoices(params.conversation, nextState, params.context);
  }

  if (
    /\bshow\b.*\bappointments?\b/.test(text) ||
    (inheritedIntent === "APPOINTMENTS" && text.includes("tomorrow instead"))
  ) {
    const nextState: SalonConversationState = {
      ...state,
      activeIntent: "APPOINTMENTS",
      activeFilters: { ...state.activeFilters },
      activeEntities:
        inheritedIntent === "APPOINTMENTS" ? state.activeEntities : {},
    };
    if (date) {
      const day = await salonTodayRange(params.context);
      nextState.activeFilters.dateRange = {
        from: date,
        to: date,
        timezone: day.timezone,
      };
    }
    const staffName = /\bshow\s+([a-z][a-z .'-]{1,60}?)(?:'s|’s)\s+appointments/i.exec(message)?.[1];
    if (staffName) {
      const candidates = await resolveStaff(staffName, params.context);
      if (candidates.length === 0) {
        return {
          answer: `I could not find an authorized staff member matching "${staffName}".`,
          responseMode: "ERROR_HELP",
          usedTools: [],
        };
      }
      if (candidates.length > 1) {
        return askClarification({
          conversation: params.conversation,
          state: nextState,
          type: "STAFF",
          originalMessage: message,
          candidates,
          planDraft: { intent: "APPOINTMENTS" },
        });
      }
      const candidate = candidates[0];
      if (candidate) {
        nextState.activeEntities.staff = {
          type: "STAFF",
          id: candidate.id,
          displayName: candidate.displayName,
          resolvedAt: new Date().toISOString(),
        };
      }
    }
    return appointments(params.conversation, nextState, params.context);
  }

  if (
    text.includes("free") ||
    text.includes("available") ||
    (inheritedIntent === "STAFF_AVAILABILITY" && time)
  ) {
    const nextState: SalonConversationState = {
      ...state,
      activeIntent: "STAFF_AVAILABILITY",
      activeFilters: {
        ...state.activeFilters,
        ...(time ? { timeExpression: time } : {}),
      },
      activeEntities: {},
    };
    return staffAvailability(params.conversation, nextState, params.context);
  }

  if (
    text.includes("inactive") ||
    (inheritedIntent === "INACTIVE_CUSTOMERS" && loyalty?.[1])
  ) {
    const nextState: SalonConversationState = {
      ...state,
      activeIntent: "INACTIVE_CUSTOMERS",
      activeEntities: {},
      activeFilters: {
        ...state.activeFilters,
        ...(inactivity?.[1] ? { inactivityDays: Number(inactivity[1]) } : {}),
        ...(loyalty?.[1] ? { minimumLoyaltyPoints: Number(loyalty[1]) } : {}),
      },
    };
    return inactiveCustomers(params.conversation, nextState, params.context);
  }

  return undefined;
}
