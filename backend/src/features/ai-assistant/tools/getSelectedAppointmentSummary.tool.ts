import { prisma } from "../../../config/prisma.js";
import type { AiTool } from "../ai-tool.types.js";
import { aiExactBranchScope } from "../ai-permission.service.js";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const getSelectedAppointmentSummaryTool: AiTool = {
  name: "getSelectedAppointmentSummary",
  description: "Explains the selected appointment and safe next steps.",
  allowedRoles: [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
    "STAFF",
  ],

  async run({ context, uiContext }) {
    const selected = uiContext?.selectedEntity;
    if (selected?.type !== "APPOINTMENT") {
      return {
        summary: "Open an appointment first, then ask about this appointment.",
        warnings: ["No selected appointment was provided by the current screen."],
      };
    }

    const appointment = await prisma.appointment.findFirst({
      where: {
        id: selected.id,
        ...aiExactBranchScope(context),
      },
      select: {
        id: true,
        appointmentCode: true,
        startTime: true,
        endTime: true,
        status: true,
        totalDurationMinutes: true,
        estimatedAmount: true,
        bookingNote: true,
        customer: { select: { id: true, customerCode: true, name: true } },
        staff: { select: { id: true, name: true, jobRole: true } },
        services: {
          select: {
            serviceName: true,
            price: true,
            durationValue: true,
            durationUnit: true,
          },
        },
        invoice: {
          select: {
            id: true,
            invoiceCode: true,
            paymentStatus: true,
            balanceAmount: true,
          },
        },
      },
    });

    if (!appointment) {
      return {
        summary: "I could not find that appointment within your allowed salon and branch scope.",
        warnings: ["The selected appointment is unavailable or outside your access."],
      };
    }

    const warnings: string[] = [];
    if (!appointment.staff) warnings.push("No staff member is assigned.");
    if (appointment.status === "CANCELLED") {
      warnings.push("Cancelled appointments cannot be completed.");
    }
    if (appointment.status === "COMPLETED") {
      warnings.push("This appointment is already completed.");
    }
    if (appointment.invoice && Number(appointment.invoice.balanceAmount) > 0) {
      warnings.push("The linked invoice has an unpaid balance.");
    }

    return {
      summary: `${appointment.appointmentCode} is ${appointment.status} for ${
        appointment.customer.name
      } with ${appointment.staff?.name ?? "no assigned staff"}. Estimated value is ${inr.format(
        Number(appointment.estimatedAmount)
      )}.`,
      data: {
        appointment: {
          id: appointment.id,
          appointmentCode: appointment.appointmentCode,
          startTime: appointment.startTime.toISOString(),
          endTime: appointment.endTime.toISOString(),
          status: appointment.status,
          totalDurationMinutes: appointment.totalDurationMinutes,
          estimatedAmount: Number(appointment.estimatedAmount),
          customer: appointment.customer,
          staff: appointment.staff,
          invoice: appointment.invoice
            ? {
                ...appointment.invoice,
                balanceAmount: Number(appointment.invoice.balanceAmount),
              }
            : null,
        },
      },
      cards: [
        {
          type: warnings.length ? "WARNING" : "INSIGHT",
          title: "Completion readiness",
          value: warnings.length ? "Needs review" : "Ready",
          description:
            warnings[0] ?? "No obvious read-only blocker was found.",
        },
      ],
      table: {
        columns: [
          { key: "serviceName", label: "Service" },
          { key: "price", label: "Price" },
          { key: "duration", label: "Duration" },
        ],
        rows: appointment.services.map((service) => ({
          serviceName: service.serviceName,
          price: Number(service.price),
          duration: service.durationValue
            ? `${service.durationValue} ${service.durationUnit ?? "MINUTES"}`
            : "",
        })),
      },
      suggestedActions: [
        {
          id: "open-appointment",
          label: "Open appointment",
          actionType: "OPEN_ENTITY",
          requiresConfirmation: false,
          payload: { entityType: "APPOINTMENT", entityId: appointment.id },
        },
      ],
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
