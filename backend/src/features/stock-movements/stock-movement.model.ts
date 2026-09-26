import { prisma } from "../../config/prisma.js";

const include = {
  product: {
    include: {
      brand: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  container: { select: { id: true, code: true, unit: true } },
  service: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true } },
  receivedByStaff: { select: { id: true, name: true } },
} as const;

export const StockMovementModel = {
  list: async (where: object) => {
    const movements = await prisma.productStockMovement.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
    });
    // Service use points at its appointment by id; one lookup names them all.
    const appointmentIds = [
      ...new Set(
        movements
          .filter((row) => row.referenceType === "APPOINTMENT" && row.referenceId)
          .map((row) => row.referenceId!)
      ),
    ];
    const appointments = appointmentIds.length
      ? await prisma.appointment.findMany({
          where: { id: { in: appointmentIds } },
          select: { id: true, appointmentCode: true, walkInJobCart: true },
        })
      : [];
    const byId = new Map(appointments.map((row) => [row.id, row]));
    return movements.map((row) => ({
      ...row,
      appointment:
        row.referenceType === "APPOINTMENT" && row.referenceId
          ? (byId.get(row.referenceId) ?? null)
          : null,
    }));
  },
};
