import {} from "express";
import { PaymentConflictError, PaymentModel } from "./payment.model.js";
import { InvoiceModel } from "../Invoices/invoice.model.js";
import { requestAuditContext } from "../audit-logs/audit-log.service.js";
const PAYMENT_METHODS = ["CASH", "CARD", "UPI", "OTHER"];
const isValidPaymentMethod = (method) => {
    return PAYMENT_METHODS.includes(method);
};
const getPaymentIdParam = (req) => {
    const { id } = req.params;
    return typeof id === "string" ? id : null;
};
const getExistingPaymentByAccess = async (req, paymentId) => {
    if (req.user?.role === "SUPER_ADMIN") {
        return PaymentModel.findById(paymentId);
    }
    const salonId = req.user?.salonId;
    if (!salonId) {
        return null;
    }
    return PaymentModel.findByIdAndSalon(paymentId, salonId);
};
export const createPayment = async (req, res) => {
    try {
        const { invoiceId, amount, method, referenceNo, note, paidAt } = req.body;
        if (!invoiceId || amount === undefined || !method) {
            return res.status(400).json({
                success: false,
                message: "invoiceId, amount and method are required",
            });
        }
        if (!isValidPaymentMethod(method)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method",
            });
        }
        const finalAmount = Number(amount);
        if (Number.isNaN(finalAmount) || finalAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Amount must be greater than 0",
            });
        }
        const invoice = req.user?.role === "SUPER_ADMIN"
            ? await InvoiceModel.findById(invoiceId)
            : req.user?.salonId
                ? await InvoiceModel.findByIdAndSalon(invoiceId, req.user.salonId)
                : null;
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found",
            });
        }
        if (invoice.status === "CANCELLED") {
            return res.status(400).json({
                success: false,
                message: "Cannot add payment to cancelled invoice",
            });
        }
        if (invoice.appointment?.status === "CANCELLED") {
            return res.status(400).json({
                success: false,
                message: "Cannot add payment to a cancelled appointment or job cart",
            });
        }
        if (invoice.paymentStatus === "PAID") {
            return res.status(400).json({
                success: false,
                message: "Invoice is already fully paid",
            });
        }
        const currentBalanceAmount = Number(invoice.balanceAmount);
        if (finalAmount > currentBalanceAmount) {
            return res.status(400).json({
                success: false,
                message: "Payment amount cannot be greater than invoice balance",
            });
        }
        let finalPaidAt;
        if (paidAt) {
            finalPaidAt = new Date(paidAt);
            if (Number.isNaN(finalPaidAt.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid paidAt date",
                });
            }
        }
        const result = await PaymentModel.createAndUpdateInvoice({
            salonId: invoice.salonId,
            ...(invoice.branchId ? { branchId: invoice.branchId } : {}),
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            amount: finalAmount,
            method,
            ...(referenceNo ? { referenceNo } : {}),
            ...(note ? { note } : {}),
            ...(finalPaidAt ? { paidAt: finalPaidAt } : {}),
            ...(req.user?.userId ? { createdById: req.user.userId } : {}),
            ...requestAuditContext(req),
        });
        return res.status(201).json({
            success: true,
            message: "Payment recorded successfully",
            data: result,
        });
    }
    catch (error) {
        if (error instanceof PaymentConflictError) {
            return res.status(error.message === "Invoice not found" ? 404 : 400).json({
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
export const getPayments = async (req, res) => {
    try {
        const { branchId, customerId, invoiceId, method } = req.query;
        if (method && !isValidPaymentMethod(String(method))) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method",
            });
        }
        if (req.user?.role === "SUPER_ADMIN") {
            const payments = await PaymentModel.findAll();
            return res.status(200).json({
                success: true,
                message: "Payments fetched successfully",
                data: payments,
            });
        }
        if (!req.user?.salonId) {
            return res.status(400).json({
                success: false,
                message: "Salon ID is missing",
            });
        }
        const payments = await PaymentModel.findBySalon(req.user.salonId, {
            ...(branchId ? { branchId: String(branchId) } : {}),
            ...(customerId ? { customerId: String(customerId) } : {}),
            ...(invoiceId ? { invoiceId: String(invoiceId) } : {}),
            ...(method ? { method: String(method) } : {}),
        });
        return res.status(200).json({
            success: true,
            message: "Payments fetched successfully",
            data: payments,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
export const getPaymentById = async (req, res) => {
    try {
        const id = getPaymentIdParam(req);
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Payment ID is required",
            });
        }
        const payment = await getExistingPaymentByAccess(req, id);
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: "Payment not found",
            });
        }
        return res.status(200).json({
            success: true,
            message: "Payment fetched successfully",
            data: payment,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};
