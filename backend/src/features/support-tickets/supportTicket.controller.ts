import { randomUUID } from "node:crypto";
import { type Request, type Response } from "express";
import { pinnedBranchId } from "../../utils/branch-scope.js";

import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  SupportTicketModel,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "./supportTicket.model.js";
import { paginationMeta, parsePagination } from "../../utils/pagination.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { prisma } from "../../config/prisma.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_FOR_USER", "REJECTED"],
  IN_PROGRESS: ["WAITING_FOR_USER", "RESOLVED", "REJECTED"],
  WAITING_FOR_USER: ["IN_PROGRESS"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
};

const isCategory = (value: unknown): value is SupportTicketCategory =>
  typeof value === "string" &&
  SUPPORT_TICKET_CATEGORIES.includes(value as SupportTicketCategory);

const isPriority = (value: unknown): value is SupportTicketPriority =>
  typeof value === "string" &&
  SUPPORT_TICKET_PRIORITIES.includes(value as SupportTicketPriority);

const isStatus = (value: unknown): value is SupportTicketStatus =>
  typeof value === "string" &&
  SUPPORT_TICKET_STATUSES.includes(value as SupportTicketStatus);

const getString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const getTicketId = (req: Request) => {
  const { id } = req.params;
  return typeof id === "string" && id ? id : null;
};

const generateTicketCode = () =>
  `TKT${Date.now()}${randomUUID().replaceAll("-", "").slice(0, 8)}`;

const hideInternalNotes = <
  T extends { messages: { isInternalNote: boolean }[] },
>(
  ticket: T
) => ({
  ...ticket,
  messages: ticket.messages.filter((message) => !message.isInternalNote),
});

const getTicketForUser = async (req: Request, id: string) => {
  if (req.user?.role === "SUPER_ADMIN") {
    return SupportTicketModel.findById(id);
  }

  if (req.user?.role === "SALON_ADMIN") {
    if (!req.user.salonId) {
      return null;
    }

    return SupportTicketModel.findByIdAndSalon(id, req.user.salonId);
  }

  const ticket = await SupportTicketModel.findById(id);
  return ticket?.reporterId === req.user?.userId ? ticket : null;
};

const getTicketForMessage = async (req: Request, id: string) => {
  const ticket = await SupportTicketModel.findById(id);

  if (!ticket) {
    return null;
  }

  if (req.user?.role === "SUPER_ADMIN") {
    return ticket;
  }

  return ticket.reporterId === req.user?.userId ? ticket : null;
};

export const createPublicTicket = async (req: Request, res: Response) => {
  try {
    const title = getString(req.body.title);
    const description = getString(req.body.description);
    const reporterEmail = getString(req.body.reporterEmail)?.toLowerCase();

    if (!title || !description || !reporterEmail) {
      return res.status(400).json({
        success: false,
        message: "title, description and reporterEmail are required",
      });
    }

    if (!EMAIL_PATTERN.test(reporterEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reporterEmail",
      });
    }

    if (req.body.category !== undefined && !isCategory(req.body.category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket category",
      });
    }

    if (req.body.priority !== undefined && !isPriority(req.body.priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket priority",
      });
    }

    const reporterName = getString(req.body.reporterName);
    const reporterPhone = getString(req.body.reporterPhone);
    const pageUrl = getString(req.body.pageUrl);
    const browserInfo = getString(req.body.browserInfo);
    const errorMessage = getString(req.body.errorMessage);

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await SupportTicketModel.createPublicTicket({
      ticketCode: generateTicketCode(),
      reporterEmail,
      title,
      description,
      ...(reporterName ? { reporterName } : {}),
      ...(reporterPhone ? { reporterPhone } : {}),
      ...(isCategory(req.body.category)
        ? { category: req.body.category }
        : {}),
      ...(isPriority(req.body.priority)
        ? { priority: req.body.priority }
        : {}),
      ...(pageUrl ? { pageUrl } : {}),
      ...(browserInfo ? { browserInfo } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      }, tx);
      await createAuditLog({
        tx,
        module: "SUPPORT_TICKET",
        action: "CREATE",
        entityId: created.id,
        entityCode: created.ticketCode,
        entityName: created.title,
        description: `Public support ticket ${created.ticketCode} created`,
        newData: { status: created.status, category: created.category, priority: created.priority },
        ...requestAuditContext(req),
      });
      return created;
    });

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: ticket,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getPublicTicketByCode = async (
  req: Request,
  res: Response
) => {
  try {
    const { ticketCode } = req.params;
    const email = getString(req.query.email)?.toLowerCase();

    if (typeof ticketCode !== "string" || !ticketCode || !email) {
      return res.status(400).json({
        success: false,
        message: "ticketCode and email are required",
      });
    }

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email",
      });
    }

    const ticket = await SupportTicketModel.findByTicketCodeAndEmail(
      ticketCode,
      email
    );

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Support ticket fetched successfully",
      data: ticket,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const createTicket = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const title = getString(req.body.title);
    const description = getString(req.body.description);

    if (!userId || !title || !description) {
      return res.status(400).json({
        success: false,
        message: "title and description are required",
      });
    }

    if (req.body.category !== undefined && !isCategory(req.body.category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket category",
      });
    }

    if (req.body.priority !== undefined && !isPriority(req.body.priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket priority",
      });
    }

    const reporter = await SupportTicketModel.findUserById(userId);

    if (!reporter) {
      return res.status(404).json({
        success: false,
        message: "Reporter not found",
      });
    }

    const fallbackEmail = getString(req.body.reporterEmail)?.toLowerCase();
    const reporterEmail = reporter.email || fallbackEmail;

    if (!reporterEmail || !EMAIL_PATTERN.test(reporterEmail)) {
      return res.status(400).json({
        success: false,
        message: "A valid reporter email is required",
      });
    }

    const pageUrl = getString(req.body.pageUrl);
    const browserInfo = getString(req.body.browserInfo);
    const errorMessage = getString(req.body.errorMessage);

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await SupportTicketModel.createDashboardTicket({
      ticketCode: generateTicketCode(),
      reporterId: userId,
      reporterEmail,
      reporterName: reporter.name,
      title,
      description,
      ...(req.user?.salonId ? { salonId: req.user.salonId } : {}),
      ...((pinnedBranchId(req.user) ?? req.user?.branchId)
        ? { branchId: (pinnedBranchId(req.user) ?? req.user?.branchId)! }
        : {}),
      ...(reporter.phone_number
        ? { reporterPhone: reporter.phone_number }
        : {}),
      ...(isCategory(req.body.category)
        ? { category: req.body.category }
        : {}),
      ...(isPriority(req.body.priority)
        ? { priority: req.body.priority }
        : {}),
      ...(pageUrl ? { pageUrl } : {}),
      ...(browserInfo ? { browserInfo } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      }, tx);
      await createAuditLog({
        tx,
        salonId: created.salonId,
        branchId: created.branchId,
        userId,
        module: "SUPPORT_TICKET",
        action: "CREATE",
        entityId: created.id,
        entityCode: created.ticketCode,
        entityName: created.title,
        description: `Support ticket ${created.ticketCode} created`,
        newData: { status: created.status, category: created.category, priority: created.priority },
        ...requestAuditContext(req),
      });
      return created;
    });

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      data: ticket,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getMyTickets = async (req: Request, res: Response) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const tickets = await SupportTicketModel.findMyTickets(req.user.userId);

    return res.status(200).json({
      success: true,
      message: "Support tickets fetched successfully",
      data: tickets.map(hideInternalNotes),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getTickets = async (req: Request, res: Response) => {
  try {
    const { status, priority, category } = req.query;
    const pagination = parsePagination(req.query);
    if ("error" in pagination) {
      return res.status(400).json({ success: false, message: pagination.error });
    }

    if (status !== undefined && !isStatus(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket status",
      });
    }

    if (priority !== undefined && !isPriority(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket priority",
      });
    }

    if (category !== undefined && !isCategory(category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid support ticket category",
      });
    }

    const tickets = await SupportTicketModel.findAll({
      ...(isStatus(status) ? { status } : {}),
      ...(isPriority(priority) ? { priority } : {}),
      ...(isCategory(category) ? { category } : {}),
      skip: pagination.skip,
      take: pagination.limit,
    });

    return res.status(200).json({
      success: true,
      message: "Support tickets fetched successfully",
      data: tickets.data,
      pagination: paginationMeta(pagination.page, pagination.limit, tickets.total),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getTicketById = async (req: Request, res: Response) => {
  try {
    const id = getTicketId(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Support ticket ID is required",
      });
    }

    const ticket = await getTicketForUser(req, id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Support ticket fetched successfully",
      data:
        req.user?.role === "SUPER_ADMIN"
          ? ticket
          : hideInternalNotes(ticket),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const addTicketMessage = async (req: Request, res: Response) => {
  try {
    const id = getTicketId(req);
    const message = getString(req.body.message);

    if (!id || !message) {
      return res.status(400).json({
        success: false,
        message: "Support ticket ID and message are required",
      });
    }

    const ticket = await getTicketForMessage(req, id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    const isInternalNote = req.body.isInternalNote === true;

    if (isInternalNote && req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only super admins can add internal notes",
      });
    }

    const sender = req.user?.userId
      ? await SupportTicketModel.findUserById(req.user.userId)
      : null;

    const updatedTicket = await SupportTicketModel.addMessage({
      ticketId: id,
      message,
      ...(req.user?.userId ? { senderId: req.user.userId } : {}),
      ...(sender?.email ? { senderEmail: sender.email } : {}),
      ...(isInternalNote ? { isInternalNote: true } : {}),
    });

    return res.status(201).json({
      success: true,
      message: "Support ticket message added successfully",
      data:
        req.user?.role === "SUPER_ADMIN" || !updatedTicket
          ? updatedTicket
          : hideInternalNotes(updatedTicket),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const updateTicketStatus = async (req: Request, res: Response) => {
  try {
    const id = getTicketId(req);
    const status = req.body.status;

    if (!id || !isStatus(status)) {
      return res.status(400).json({
        success: false,
        message: "Support ticket ID and valid status are required",
      });
    }

    const ticket = await SupportTicketModel.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    if (!STATUS_TRANSITIONS[ticket.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${ticket.status} to ${status}`,
      });
    }

    const resolutionNotes = getString(req.body.resolutionNotes);
    const note = getString(req.body.note);

    const updatedTicket = await prisma.$transaction(async (tx) => {
      const updated = await SupportTicketModel.updateStatusWithHistory(id, {
        oldStatus: ticket.status,
        newStatus: status,
        changedById: req.user!.userId,
        ...(note ? { note } : {}),
        ...(resolutionNotes ? { resolutionNotes } : {}),
      }, tx);
      await createAuditLog({
      tx,
      salonId: ticket.salonId,
      branchId: ticket.branchId,
      userId: req.user?.userId,
      module: "SUPPORT_TICKET",
      action:
        status === "RESOLVED" || status === "CLOSED"
          ? "SUPPORT_RESOLVED"
          : "STATUS_CHANGE",
      entityId: ticket.id,
      entityCode: ticket.ticketCode,
      entityName: ticket.title,
      description: `Support ticket ${ticket.ticketCode} changed from ${ticket.status} to ${status}`,
      oldData: { status: ticket.status },
      newData: { status, resolutionNotes },
      ...requestAuditContext(req),
      });
      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Support ticket status updated successfully",
      data: updatedTicket,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const assignTicket = async (req: Request, res: Response) => {
  try {
    const id = getTicketId(req);
    const assignedToId = getString(req.body.assignedToId);

    if (!id || !assignedToId) {
      return res.status(400).json({
        success: false,
        message: "Support ticket ID and assignedToId are required",
      });
    }

    const [ticket, assignee] = await Promise.all([
      SupportTicketModel.findById(id),
      SupportTicketModel.findUserById(assignedToId),
    ]);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    if (!assignee) {
      return res.status(400).json({
        success: false,
        message: "Assigned user does not exist",
      });
    }

    if (assignee.role !== "SUPER_ADMIN") {
      return res.status(400).json({
        success: false,
        message: "Tickets can only be assigned to platform support admins",
      });
    }

    const updatedTicket = await prisma.$transaction(async (tx) => {
      const updated = await SupportTicketModel.assignTicket(id, assignedToId, tx);
      await createAuditLog({
        tx,
        salonId: ticket.salonId,
        branchId: ticket.branchId,
        userId: req.user?.userId,
        module: "SUPPORT_TICKET",
        action: "UPDATE",
        entityId: ticket.id,
        entityCode: ticket.ticketCode,
        entityName: ticket.title,
        description: `Support ticket ${ticket.ticketCode} assigned to ${assignee.name}`,
        oldData: { assignedToId: ticket.assignedToId },
        newData: { assignedToId },
        ...requestAuditContext(req),
      });
      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "Support ticket assigned successfully",
      data: updatedTicket,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
