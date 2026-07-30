import { type Request, type Response } from "express";

import { InvoiceModel } from "./invoice.model.js";
import { AppointmentModel } from "../appointments/appointment.model.js";
import { CustomerModel } from "../customers/customer.model.js";
import {
  InvoiceRetentionError,
  redeemInvoiceLoyalty,
} from "./invoice-retention.service.js";
import {
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  buildBusinessCode,
  businessCodeDayRange,
} from "../../utils/business-id.js";
import {
  CouponServiceError,
  applyCouponToInvoice,
  issueInvoice as issueDraftInvoice,
  removeCouponFromInvoice,
} from "../coupons/coupon.service.js";
import { applyCouponSchema } from "../coupons/coupon.validation.js";
import { reverseUsedPackageUsagesForInvoice } from "../packages/package.service.js";
import { reverseAppointmentConsumables } from "../stock/appointmentConsumableReversal.service.js";
import { resolveCurrentCustomerMembership } from "../customer-memberships/customer-membership.service.js";
import { calculateInvoiceGst } from "./invoice-gst.service.js";


const INVOICE_TYPES = ["GST_INVOICE", "BILL_OF_SUPPLY"] as const;
const INVOICE_STATUSES = ["DRAFT", "ISSUED", "CANCELLED"] as const;
const PAYMENT_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;

type InvoiceType = (typeof INVOICE_TYPES)[number];
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const isValidInvoiceType = (value: string): value is InvoiceType => {
  return INVOICE_TYPES.includes(value as InvoiceType);
};

const isValidInvoiceStatus = (value: string): value is InvoiceStatus => {
  return INVOICE_STATUSES.includes(value as InvoiceStatus);
};

const isValidPaymentStatus = (value: string): value is PaymentStatus => {
  return PAYMENT_STATUSES.includes(value as PaymentStatus);
};

const generateInvoiceCode = async (
  tx: Prisma.TransactionClient,
  salon: { id: string; name: string; timezone?: string | null },
  date: Date = new Date()
) => {
  const range = businessCodeDayRange(date, salon.timezone);
  const serial =
    (await tx.invoice.count({
      where: {
        salonId: salon.id,
        invoiceDate: {
          gte: range.start,
          lt: range.end,
        },
      },
    })) + 1;

  return buildBusinessCode({
    salonName: salon.name,
    type: "INV",
    date,
    timezone: salon.timezone,
    serial,
  });
};

const getInvoiceIdParam = (req: Request) => {
  const { id } = req.params;
  return typeof id === "string" ? id : null;
};

const getAppointmentIdParam = (req: Request) => {
  const { appointmentId } = req.params;
  return typeof appointmentId === "string" ? appointmentId : null;
};

const buildAddress = (parts: Array<string | null | undefined>) => {
  return parts.filter(Boolean).join(", ");
};

const decimalOrZero = (value: unknown) => {
  try {
    return new Prisma.Decimal(
      (value ?? 0) as string | number | Prisma.Decimal
    ).toDecimalPlaces(2);
  } catch {
    return new Prisma.Decimal(0);
  }
};

const getExistingInvoiceByAccess = async (req: Request, invoiceId: string) => {
  if (req.user?.role === "SUPER_ADMIN") {
    return InvoiceModel.findById(invoiceId);
  }

  const salonId = req.user?.salonId;

  if (!salonId) {
    return null;
  }

  const invoice = await InvoiceModel.findByIdAndSalon(invoiceId, salonId);
  if (
    invoice &&
    req.user?.role === "RECEPTIONIST" &&
    req.user.branchId &&
    invoice.branchId !== req.user.branchId
  ) {
    return null;
  }
  return invoice;
};

export const createInvoiceFromAppointment = async (
  req: Request,
  res: Response
) => {
  try {
    const appointmentId = getAppointmentIdParam(req);

    const {
      invoiceType,
      discountAmount,
      processingFeeAmount,
      taxPercent,
      status,
      billingNote,
      footerNote,
    } = req.body as {
      invoiceType?: string;
      discountAmount?: number;
      processingFeeAmount?: number;
      taxPercent?: number;
      status?: string;
      billingNote?: string;
      footerNote?: string;
    };

    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: "Appointment ID is required",
      });
    }

    if (invoiceType && !isValidInvoiceType(invoiceType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice type",
      });
    }

    if (status && !["DRAFT", "ISSUED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invoice status must be DRAFT or ISSUED",
      });
    }

    const appointment =
      req.user?.role === "SUPER_ADMIN"
        ? await AppointmentModel.findInvoiceSourceById(appointmentId)
        : req.user?.salonId
          ? await AppointmentModel.findInvoiceSourceByIdAndSalon(
              appointmentId,
              req.user.salonId
            )
          : null;

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    if (appointment.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Only completed appointments can be converted to invoice",
      });
    }

    const existingInvoice = await InvoiceModel.findByAppointmentIdAndSalon(
      appointment.id,
      appointment.salonId
    );

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: "Invoice already exists for this appointment",
      });
    }

    if (!appointment.services.length) {
      return res.status(400).json({
        success: false,
        message: "Appointment has no services",
      });
    }

    const finalInvoiceType: InvoiceType =
      invoiceType && isValidInvoiceType(invoiceType)
        ? invoiceType
        : "BILL_OF_SUPPLY";

    const subtotalAmount = appointment.services
      .reduce(
        (total, item) => total.plus(new Prisma.Decimal(item.price)),
        new Prisma.Decimal(0)
      )
      .toDecimalPlaces(2);

    const requestedManualDiscountAmount = decimalOrZero(discountAmount);
    if (requestedManualDiscountAmount.isNegative()) {
      return res.status(400).json({
        success: false,
        message: "Discount must be non-negative",
      });
    }
    const manualDiscountAmount = Prisma.Decimal.min(
      requestedManualDiscountAmount,
      subtotalAmount
    ).toDecimalPlaces(2);
    const finalProcessingFeeAmount = decimalOrZero(processingFeeAmount);
    if (finalProcessingFeeAmount.isNegative()) {
      return res.status(400).json({
        success: false,
        message: "Processing fee must be non-negative",
      });
    }
    const requestedTaxPercent =
      taxPercent === undefined ? null : decimalOrZero(taxPercent);
    if (requestedTaxPercent?.isNegative() || requestedTaxPercent?.gt(100)) {
      return res.status(400).json({
        success: false,
        message: "Tax percent must be between 0 and 100",
      });
    }
    const auditContext = requestAuditContext(req);
    const membershipActor = {
      userId: req.user!.userId,
      role: req.user!.role,
      ...(req.user?.salonId ? { salonId: req.user.salonId } : {}),
      ...(req.user?.branchId ? { branchId: req.user.branchId } : {}),
    };

    const { invoice, membershipDiscountAmount } = await prisma.$transaction(
      async (tx) => {
        const currentMembership = await resolveCurrentCustomerMembership(tx, {
          customerId: appointment.customerId,
          actor: membershipActor,
          audit: auditContext,
        });
        const membershipDiscountAmount = currentMembership
          ? Prisma.Decimal.min(
              subtotalAmount
                .mul(currentMembership.discountPercentageSnapshot)
                .div(100),
              subtotalAmount.minus(manualDiscountAmount)
            ).toDecimalPlaces(2)
          : new Prisma.Decimal(0);
        const finalDiscountAmount = Prisma.Decimal.min(
          manualDiscountAmount.plus(membershipDiscountAmount),
          subtotalAmount
        ).toDecimalPlaces(2);
        const gstSettings =
          requestedTaxPercent && finalInvoiceType === "GST_INVOICE"
            ? {
                ...appointment.salon,
                gstEnabled: true,
                serviceGstRate: requestedTaxPercent,
                productGstRate: requestedTaxPercent,
              }
            : appointment.salon;
        const calculation = calculateInvoiceGst(
          {
            invoiceType: finalInvoiceType,
            discountAmount: finalDiscountAmount,
            couponDiscountAmount: new Prisma.Decimal(0),
            processingFeeAmount: finalProcessingFeeAmount,
            items: appointment.services.map((item) => ({
              itemType: "SERVICE",
              quantity: 1,
              unitPrice: new Prisma.Decimal(item.price),
            })),
          },
          gstSettings
        );
        const invoiceDate = new Date();
        const created = await InvoiceModel.create(
          {
            invoiceCode: await generateInvoiceCode(
              tx,
              appointment.salon,
              invoiceDate
            ),
            salonId: appointment.salonId,
            ...(appointment.branchId
              ? { branchId: appointment.branchId }
              : {}),
            customerId: appointment.customerId,
            appointmentId: appointment.id,
            invoiceType: finalInvoiceType,
            salonName: appointment.salon.name,
            ...(appointment.salon.phone
              ? { salonPhone: appointment.salon.phone }
              : {}),
            ...(appointment.salon.email
              ? { salonEmail: appointment.salon.email }
              : {}),
            ...(calculation.gstNumberSnapshot
              ? { salonGst: calculation.gstNumberSnapshot }
              : {}),
            serviceTaxableAmount: calculation.serviceTaxableAmount,
            productTaxableAmount: calculation.productTaxableAmount,
            serviceGstAmount: calculation.serviceGstAmount,
            productGstAmount: calculation.productGstAmount,
            totalGstAmount: calculation.totalGstAmount,
            gstNumberSnapshot: calculation.gstNumberSnapshot,
            gstLegalNameSnapshot: calculation.gstLegalNameSnapshot,
            gstStateCodeSnapshot: calculation.gstStateCodeSnapshot,
            gstEnabledSnapshot: calculation.gstEnabledSnapshot,
            salonAddress: buildAddress([
              appointment.salon.addressLine1,
              appointment.salon.addressLine2,
              appointment.salon.city,
              appointment.salon.state,
              appointment.salon.country,
              appointment.salon.postalCode,
            ]),
            customerName: appointment.customer.name,
            ...(appointment.customer.phone
              ? { customerPhone: appointment.customer.phone }
              : {}),
            ...(appointment.customer.email
              ? { customerEmail: appointment.customer.email }
              : {}),
            ...(appointment.customer.gst
              ? { customerGst: appointment.customer.gst }
              : {}),
            subtotalAmount: calculation.subtotalAmount,
            discountAmount: finalDiscountAmount,
            processingFeeAmount: finalProcessingFeeAmount,
            taxAmount: calculation.totalGstAmount,
            totalAmount: calculation.totalAmount,
            paidAmount: 0,
            balanceAmount: calculation.totalAmount,
            status: status === "DRAFT" ? "DRAFT" : "ISSUED",
            paymentStatus: "UNPAID",
            ...(billingNote ? { billingNote } : {}),
            ...(footerNote ? { footerNote } : {}),
            items: appointment.services.map((item, index) => ({
              serviceId: item.serviceId,
              itemCode: item.serviceId.slice(0, 8),
              description: item.serviceName,
              serviceName: item.serviceName,
              quantity: 1,
              unitPrice: new Prisma.Decimal(item.price),
              discountAmount: 0,
              taxableAmount: calculation.lines[index]?.taxableAmount ?? 0,
              gstRateSnapshot: calculation.lines[index]?.gstRateSnapshot ?? 0,
              gstAmount: calculation.lines[index]?.gstAmount ?? 0,
              totalWithTax: calculation.lines[index]?.totalWithTax ?? 0,
              taxPercent: calculation.lines[index]?.taxPercent ?? 0,
              taxAmount: calculation.lines[index]?.taxAmount ?? 0,
              lineTotal: calculation.lines[index]?.lineTotal ?? 0,
            })),
          },
          tx
        );

        if (created.status === "ISSUED" && created.totalAmount.gt(0)) {
          await CustomerModel.increaseOutstandingWithTransaction(
            {
              customerId: created.customerId,
              salonId: created.salonId,
              invoiceId: created.id,
              billNo: created.invoiceCode,
              amount: created.totalAmount,
              narration: `Invoice issued: ${created.invoiceCode}`,
            },
            tx
          );
        }

        await createAuditLog({
          tx,
          salonId: created.salonId,
          branchId: created.branchId,
          userId: req.user?.userId,
          module: "INVOICE",
          action: "CREATE",
          entityId: created.id,
          entityCode: created.invoiceCode,
          entityName: created.customerName,
          description: `Invoice ${created.invoiceCode} created`,
          newData: {
            status: created.status,
            paymentStatus: created.paymentStatus,
            subtotalAmount: created.subtotalAmount,
            discountAmount: created.discountAmount,
            taxAmount: created.taxAmount,
            serviceTaxableAmount: created.serviceTaxableAmount,
            productTaxableAmount: created.productTaxableAmount,
            serviceGstAmount: created.serviceGstAmount,
            productGstAmount: created.productGstAmount,
            totalGstAmount: created.totalGstAmount,
            gstEnabledSnapshot: created.gstEnabledSnapshot,
            totalAmount: created.totalAmount,
            customerMembershipId: currentMembership?.id ?? null,
            membershipName:
              currentMembership?.membershipNameSnapshot ?? null,
            membershipDiscountPercentage:
              currentMembership?.discountPercentageSnapshot ?? null,
            membershipDiscountAmount,
          },
          ...auditContext,
        });
        return { invoice: created, membershipDiscountAmount };
      }
    );

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: {
        ...invoice,
        manualDiscountAmount,
        membershipDiscountAmount,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getInvoices = async (req: Request, res: Response) => {
  try {
    const { branchId, customerId, status, paymentStatus } = req.query;

    if (status && !isValidInvoiceStatus(String(status))) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice status",
      });
    }

    if (paymentStatus && !isValidPaymentStatus(String(paymentStatus))) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
      });
    }

    if (req.user?.role === "SUPER_ADMIN") {
      const invoices = await InvoiceModel.findAll();

      return res.status(200).json({
        success: true,
        message: "Invoices fetched successfully",
        data: invoices,
      });
    }

    if (!req.user?.salonId) {
      return res.status(400).json({
        success: false,
        message: "Salon ID is missing",
      });
    }

    const invoices = await InvoiceModel.findBySalon(req.user.salonId, {
      ...(req.user.role === "RECEPTIONIST" && req.user.branchId
        ? { branchId: req.user.branchId }
        : branchId
          ? { branchId: String(branchId) }
          : {}),
      ...(customerId ? { customerId: String(customerId) } : {}),
      ...(status ? { status: String(status) as InvoiceStatus } : {}),
      ...(paymentStatus
        ? { paymentStatus: String(paymentStatus) as PaymentStatus }
        : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Invoices fetched successfully",
      data: invoices,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getInvoiceById = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const invoice = await getExistingInvoiceByAccess(req, id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Invoice fetched successfully",
      data: invoice,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const invoiceAuditData = (invoice: {
  invoiceCode: string; invoiceType: string; discountAmount: unknown; processingFeeAmount: unknown;
  couponId?: string | null; couponCodeSnapshot?: string | null; couponDiscountAmount?: unknown;
  taxAmount: unknown; totalAmount: unknown; balanceAmount: unknown;
  status: string; paymentStatus: string; billingNote: string | null; footerNote: string | null;
}) => ({
  invoiceCode: invoice.invoiceCode,
  invoiceType: invoice.invoiceType,
  discountAmount: invoice.discountAmount,
  couponId: invoice.couponId ?? null,
  couponCode: invoice.couponCodeSnapshot ?? null,
  couponDiscountAmount: invoice.couponDiscountAmount ?? 0,
  processingFeeAmount: invoice.processingFeeAmount,
  taxAmount: invoice.taxAmount,
  totalAmount: invoice.totalAmount,
  balanceAmount: invoice.balanceAmount,
  status: invoice.status,
  paymentStatus: invoice.paymentStatus,
  billingNote: invoice.billingNote,
  footerNote: invoice.footerNote,
});

export const updateInvoice = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);
    if (!id) return res.status(400).json({ success: false, message: "Invoice ID is required" });
    const existing = await getExistingInvoiceByAccess(req, id);
    if (!existing) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (existing.status === "CANCELLED") {
      return res.status(409).json({ success: false, message: "Cancelled invoices cannot be edited" });
    }

    const allowed = new Set(["discountAmount", "processingFeeAmount", "taxAmount", "billingNote", "footerNote", "invoiceType"]);
    const keys = Object.keys(req.body);
    if (!keys.length || keys.some((key) => !allowed.has(key))) {
      return res.status(400).json({ success: false, message: "Only controlled invoice fields can be edited" });
    }
    const monetary = keys.some((key) => ["discountAmount", "processingFeeAmount", "taxAmount", "invoiceType"].includes(key));
    if (monetary && existing.status !== "DRAFT") {
      return res.status(409).json({ success: false, message: "Monetary fields can only be edited on draft invoices" });
    }
    if (monetary && (Number(existing.paidAmount) > 0 || existing.paymentStatus !== "UNPAID")) {
      return res.status(409).json({ success: false, message: "Paid or partially paid invoice monetary fields cannot be edited" });
    }
    for (const key of ["billingNote", "footerNote"] as const) {
      if (key in req.body && req.body[key] !== null && typeof req.body[key] !== "string") {
        return res.status(400).json({ success: false, message: `${key} must be a string or null` });
      }
    }
    if ("invoiceType" in req.body && !isValidInvoiceType(req.body.invoiceType)) {
      return res.status(400).json({ success: false, message: "Invalid invoice type" });
    }

    const parseMoney = (key: "discountAmount" | "processingFeeAmount", fallback: Prisma.Decimal) => {
      if (!(key in req.body)) return fallback;
      try {
        const value = new Prisma.Decimal(req.body[key]);
        return value.isNegative() ? null : value.toDecimalPlaces(2);
      } catch {
        return null;
      }
    };
    const discount = parseMoney("discountAmount", existing.discountAmount);
    const fee = parseMoney("processingFeeAmount", existing.processingFeeAmount);
    if (!discount || !fee) {
      return res.status(400).json({ success: false, message: "Invoice amounts must be valid non-negative numbers" });
    }
    if (discount.gt(existing.subtotalAmount)) {
      return res.status(400).json({ success: false, message: "Discount cannot exceed subtotal" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: {
          items: true,
          salon: {
            select: {
              gstEnabled: true,
              gstNumber: true,
              gstLegalName: true,
              gstStateCode: true,
              serviceGstRate: true,
              productGstRate: true,
            },
          },
        },
      });
      if (current.status === "CANCELLED") throw Object.assign(new Error("Cancelled invoices cannot be edited"), { status: 409 });
      if (monetary && (current.status !== "DRAFT" || current.paymentStatus !== "UNPAID" || current.paidAmount.gt(0))) {
        throw Object.assign(new Error("Invoice is no longer eligible for monetary edits"), { status: 409 });
      }
      if (monetary && await tx.customerTransaction.count({ where: { invoiceId: id } })) {
        throw Object.assign(new Error("Invoice ledger already exists; monetary fields are locked"), { status: 409 });
      }
      const nextInvoiceType = req.body.invoiceType ?? current.invoiceType;
      const legacyTax =
        "taxAmount" in req.body ? decimalOrZero(req.body.taxAmount) : current.taxAmount;
      const legacyNoLineDraft = monetary && current.items.length === 0;
      const calculation = monetary && !legacyNoLineDraft
        ? calculateInvoiceGst(
            {
              invoiceType: nextInvoiceType,
              discountAmount: discount,
              couponDiscountAmount: current.couponDiscountAmount,
              processingFeeAmount: fee,
              items: current.items,
            },
            current.salon
          )
        : null;
      if (calculation) {
        for (const [index, item] of current.items.entries()) {
          const line = calculation.lines[index];
          if (!line) continue;
          await tx.invoiceItem.update({
            where: { id: item.id },
            data: {
              taxableAmount: line.taxableAmount,
              gstRateSnapshot: line.gstRateSnapshot,
              gstAmount: line.gstAmount,
              totalWithTax: line.totalWithTax,
              taxPercent: line.taxPercent,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
            },
          });
        }
      }
      const updateData: Prisma.InvoiceUpdateInput = {
        ...(req.body.invoiceType ? { invoiceType: req.body.invoiceType } : {}),
        ...("billingNote" in req.body ? { billingNote: req.body.billingNote } : {}),
        ...("footerNote" in req.body ? { footerNote: req.body.footerNote } : {}),
      };
      if (legacyNoLineDraft) {
        const totalAmount = current.subtotalAmount
          .minus(discount)
          .minus(current.couponDiscountAmount)
          .plus(fee)
          .plus(legacyTax)
          .toDecimalPlaces(2);
        const balanceAmount = totalAmount.minus(current.paidAmount).toDecimalPlaces(2);
        Object.assign(updateData, {
          discountAmount: discount,
          processingFeeAmount: fee,
          taxAmount: legacyTax,
          totalGstAmount: legacyTax,
          totalAmount,
          balanceAmount,
          paymentStatus: balanceAmount.lte(0)
            ? "PAID"
            : current.paidAmount.gt(0)
              ? "PARTIALLY_PAID"
              : "UNPAID",
        });
      } else if (monetary && calculation) {
        const balanceAmount = calculation.totalAmount
          .minus(current.paidAmount)
          .toDecimalPlaces(2);
        Object.assign(updateData, {
          discountAmount: discount,
          processingFeeAmount: fee,
          serviceTaxableAmount: calculation.serviceTaxableAmount,
          productTaxableAmount: calculation.productTaxableAmount,
          serviceGstAmount: calculation.serviceGstAmount,
          productGstAmount: calculation.productGstAmount,
          totalGstAmount: calculation.totalGstAmount,
          gstNumberSnapshot: calculation.gstNumberSnapshot,
          gstLegalNameSnapshot: calculation.gstLegalNameSnapshot,
          gstStateCodeSnapshot: calculation.gstStateCodeSnapshot,
          gstEnabledSnapshot: calculation.gstEnabledSnapshot,
          taxAmount: calculation.totalGstAmount,
          totalAmount: calculation.totalAmount,
          balanceAmount,
          paymentStatus: balanceAmount.lte(0)
            ? "PAID"
            : current.paidAmount.gt(0)
              ? "PARTIALLY_PAID"
              : "UNPAID",
        });
      }
      const invoice = await InvoiceModel.updateSafeFields(id, updateData, tx);
      await createAuditLog({
        tx,
        salonId: current.salonId,
        branchId: current.branchId,
        userId: req.user?.userId,
        module: "INVOICE",
        action: "UPDATE",
        entityId: current.id,
        entityCode: current.invoiceCode,
        entityName: current.customerName,
        description: `Invoice ${current.invoiceCode} updated`,
        oldData: invoiceAuditData(current),
        newData: invoiceAuditData(invoice),
        ...requestAuditContext(req),
      });
      return invoice;
    });
    return res.json({ success: true, message: "Invoice updated successfully", data: updated });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return res.status(status).json({ success: false, message: error instanceof Error && status !== 500 ? error.message : "Internal server error" });
  }
};

export const cancelInvoice = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    const existingInvoice = await getExistingInvoiceByAccess(req, id);

    if (!existingInvoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (existingInvoice.paymentStatus !== "UNPAID") {
      return res.status(400).json({
        success: false,
        message: "Paid or partially paid invoice cannot be cancelled",
      });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.invoice.findUniqueOrThrow({
        where: { id },
      });
      if (current.status === "CANCELLED") {
        throw Object.assign(new Error("Invoice is already cancelled"), {
          status: 409,
        });
      }
      if (current.paymentStatus !== "UNPAID") {
        throw Object.assign(
          new Error("Paid or partially paid invoice cannot be cancelled"),
          { status: 400 }
        );
      }
      if (current.couponId && current.status === "ISSUED") {
        await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${current.couponId} FOR UPDATE`;
        await tx.coupon.updateMany({
          where: { id: current.couponId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }
      if (current.appointmentId) {
        await reverseAppointmentConsumables({
          tx,
          appointmentId: current.appointmentId,
          salonId: current.salonId,
          branchId: current.branchId,
          createdById: req.user?.userId,
        });
      }
      const cancelled = await InvoiceModel.cancel(id, tx);
      await reverseUsedPackageUsagesForInvoice(tx, {
        invoiceId: id,
        userId: req.user?.userId,
        ...requestAuditContext(req),
      });
      const customerPackages = await tx.customerPackage.findMany({
        where: {
          invoiceId: id,
          status: { not: "CANCELLED" },
        },
      });
      if (customerPackages.length) {
        await tx.customerPackage.updateMany({
          where: { id: { in: customerPackages.map((item) => item.id) } },
          data: { status: "CANCELLED" },
        });
        for (const customerPackage of customerPackages) {
          await createAuditLog({
            tx,
            salonId: customerPackage.salonId,
            branchId: customerPackage.branchId,
            userId: req.user?.userId,
            module: "PACKAGE",
            action: "CANCEL",
            entityId: customerPackage.id,
            entityName: customerPackage.packageNameSnapshot,
            description: `Customer package ${customerPackage.packageNameSnapshot} cancelled with invoice ${cancelled.invoiceCode}`,
            oldData: { status: customerPackage.status },
            newData: { status: "CANCELLED", invoiceId: id },
            ...requestAuditContext(req),
          });
        }
      }
      await createAuditLog({
      tx,
      salonId: existingInvoice.salonId,
      branchId: existingInvoice.branchId,
      userId: req.user?.userId,
      module: "INVOICE",
      action: "CANCEL",
      entityId: cancelled.id,
      entityCode: cancelled.invoiceCode,
      entityName: cancelled.customerName,
      description: `Invoice ${cancelled.invoiceCode} cancelled`,
      oldData: { status: existingInvoice.status },
      newData: { status: cancelled.status },
      ...requestAuditContext(req),
      });
      return cancelled;
    });

    return res.status(200).json({
      success: true,
      message: "Invoice cancelled successfully",
      data: invoice,
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;
    return res.status(status).json({
      success: false,
      message:
        error instanceof Error && status !== 500
          ? error.message
          : "Internal server error",
    });
  }
};

const invoiceCouponAccess = (req: Request) => ({
  ...(req.user?.role === "SUPER_ADMIN"
    ? {}
    : { salonId: req.user?.salonId ?? "__missing__" }),
  ...((req.user?.role === "RECEPTIONIST" ||
    req.user?.role === "BRANCH_MANAGER") &&
  req.user.branchId
    ? { actorBranchId: req.user.branchId }
    : {}),
});

const sendCouponError = (res: Response, error: unknown) => {
  if (error instanceof CouponServiceError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
    });
  }
  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

export const applyInvoiceCoupon = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }
    const parsed = applyCouponSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message:
          parsed.error.issues[0]?.message ?? "Invalid coupon data",
      });
    }
    const data = await applyCouponToInvoice({
      invoiceId: id,
      couponCode: parsed.data.couponCode,
      ...invoiceCouponAccess(req),
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
      ...requestAuditContext(req),
    });
    return res.status(200).json({
      success: true,
      message: "Coupon applied successfully",
      data,
    });
  } catch (error) {
    return sendCouponError(res, error);
  }
};

export const removeInvoiceCoupon = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }
    const data = await removeCouponFromInvoice({
      invoiceId: id,
      ...invoiceCouponAccess(req),
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
      ...requestAuditContext(req),
    });
    return res.status(200).json({
      success: true,
      message: "Coupon removed successfully",
      data,
    });
  } catch (error) {
    return sendCouponError(res, error);
  }
};

export const issueInvoice = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }
    const data = await issueDraftInvoice({
      invoiceId: id,
      ...(req.user?.role === "SUPER_ADMIN"
        ? {}
        : { salonId: req.user?.salonId ?? "__missing__" }),
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
      ...requestAuditContext(req),
    });
    return res.status(200).json({
      success: true,
      message: "Invoice issued successfully",
      data,
    });
  } catch (error) {
    return sendCouponError(res, error);
  }
};

export const redeemLoyaltyPoints = async (req: Request, res: Response) => {
  try {
    const id = getInvoiceIdParam(req);
    const points = Number(req.body.points);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    if (
      !Number.isInteger(points) ||
      points <= 0 ||
      typeof req.body.points === "boolean" ||
      req.body.points === null ||
      req.body.points === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Points must be a positive integer",
      });
    }

    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const data = await redeemInvoiceLoyalty({
      invoiceId: id,
      ...(req.user.role === "SUPER_ADMIN"
        ? {}
        : { salonId: req.user.salonId || "__missing__" }),
      points,
      createdById: req.user.userId,
      ...requestAuditContext(req),
    });

    return res.status(200).json({
      success: true,
      message: "Loyalty points redeemed successfully",
      data,
    });
  } catch (error) {
    if (error instanceof InvoiceRetentionError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
