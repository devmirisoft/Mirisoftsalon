import { prisma } from "../../config/prisma.js";
export const InvoiceModel = {
    create: async (data, tx) => {
        return (tx ?? prisma).invoice.create({
            data: {
                invoiceCode: data.invoiceCode,
                salonId: data.salonId,
                ...(data.branchId ? { branchId: data.branchId } : {}),
                customerId: data.customerId,
                ...(data.appointmentId ? { appointmentId: data.appointmentId } : {}),
                invoiceType: data.invoiceType || "BILL_OF_SUPPLY",
                salonName: data.salonName,
                ...(data.salonPhone ? { salonPhone: data.salonPhone } : {}),
                ...(data.salonEmail ? { salonEmail: data.salonEmail } : {}),
                ...(data.salonAddress ? { salonAddress: data.salonAddress } : {}),
                ...(data.salonGst ? { salonGst: data.salonGst } : {}),
                serviceTaxableAmount: data.serviceTaxableAmount ?? 0,
                productTaxableAmount: data.productTaxableAmount ?? 0,
                serviceGstAmount: data.serviceGstAmount ?? 0,
                productGstAmount: data.productGstAmount ?? 0,
                totalGstAmount: data.totalGstAmount ?? data.taxAmount,
                gstNumberSnapshot: data.gstNumberSnapshot ?? null,
                gstLegalNameSnapshot: data.gstLegalNameSnapshot ?? null,
                gstStateCodeSnapshot: data.gstStateCodeSnapshot ?? null,
                gstEnabledSnapshot: data.gstEnabledSnapshot ?? false,
                customerName: data.customerName,
                ...(data.customerPhone ? { customerPhone: data.customerPhone } : {}),
                ...(data.customerEmail ? { customerEmail: data.customerEmail } : {}),
                ...(data.customerAddress
                    ? { customerAddress: data.customerAddress }
                    : {}),
                ...(data.customerGst ? { customerGst: data.customerGst } : {}),
                subtotalAmount: data.subtotalAmount,
                discountAmount: data.discountAmount,
                processingFeeAmount: data.processingFeeAmount,
                taxAmount: data.taxAmount,
                roundOffAmount: data.roundOffAmount ?? 0,
                totalAmount: data.totalAmount,
                paidAmount: data.paidAmount || 0,
                balanceAmount: data.balanceAmount,
                status: data.status || "ISSUED",
                paymentStatus: data.paymentStatus || "UNPAID",
                ...(data.billingNote ? { billingNote: data.billingNote } : {}),
                ...(data.footerNote ? { footerNote: data.footerNote } : {}),
                items: {
                    create: data.items.map((item) => ({
                        ...(item.serviceId ? { serviceId: item.serviceId } : {}),
                        ...(item.productId ? { productId: item.productId } : {}),
                        ...(item.itemType ? { itemType: item.itemType } : {}),
                        ...(item.packageId ? { packageId: item.packageId } : {}),
                        ...(item.membershipId ? { membershipId: item.membershipId } : {}),
                        ...(item.soldByStaffId
                            ? { soldByStaffId: item.soldByStaffId }
                            : {}),
                        ...(item.itemCode ? { itemCode: item.itemCode } : {}),
                        description: item.description,
                        serviceName: item.serviceName,
                        quantity: item.quantity || 1,
                        unitPrice: item.unitPrice,
                        discountAmount: item.discountAmount || 0,
                        taxableAmount: item.taxableAmount ?? 0,
                        gstRateSnapshot: item.gstRateSnapshot ?? item.taxPercent ?? 0,
                        gstAmount: item.gstAmount ?? item.taxAmount ?? 0,
                        totalWithTax: item.totalWithTax ?? item.lineTotal,
                        taxPercent: item.taxPercent || 0,
                        taxAmount: item.taxAmount || 0,
                        lineTotal: item.lineTotal,
                    })),
                },
            },
            include: {
                salon: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                        loyaltyPoints: true,
                        membership: {
                            select: {
                                id: true,
                                name: true,
                                discountPercentage: true,
                                status: true,
                            },
                        },
                    },
                },
                appointment: {
                    select: {
                        id: true,
                        appointmentCode: true,
                        status: true,
                    },
                },
                items: true,
                payments: true,
                coupon: true,
            },
        });
    },
    findAll: async () => {
        return prisma.invoice.findMany({
            include: {
                salon: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                        loyaltyPoints: true,
                        membership: {
                            select: {
                                id: true,
                                name: true,
                                discountPercentage: true,
                                status: true,
                            },
                        },
                    },
                },
                appointment: {
                    select: {
                        id: true,
                        appointmentCode: true,
                        status: true,
                    },
                },
                items: true,
                payments: true,
                coupon: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    },
    findBySalon: async (salonId, filters) => {
        return prisma.invoice.findMany({
            where: {
                salonId,
                ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                ...(filters?.customerId ? { customerId: filters.customerId } : {}),
                ...(filters?.paymentStatus
                    ? { paymentStatus: filters.paymentStatus }
                    : {}),
                ...(filters?.status ? { status: filters.status } : {}),
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        customerCode: true,
                        loyaltyPoints: true,
                        membership: {
                            select: {
                                id: true,
                                name: true,
                                discountPercentage: true,
                                status: true,
                            },
                        },
                    },
                },
                items: true,
                payments: true,
                coupon: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    },
    findById: async (id) => {
        return prisma.invoice.findUnique({
            where: {
                id,
            },
            include: {
                salon: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        addressLine1: true,
                        addressLine2: true,
                        city: true,
                        state: true,
                        country: true,
                        postalCode: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        addressLine1: true,
                        city: true,
                        state: true,
                        postalCode: true,
                        phone: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        gst: true,
                        customerCode: true,
                        outstandingAmount: true,
                        walletBalance: true,
                        loyaltyPoints: true,
                        membership: {
                            select: {
                                id: true,
                                name: true,
                                discountPercentage: true,
                                status: true,
                            },
                        },
                    },
                },
                appointment: {
                    select: {
                        id: true,
                        appointmentCode: true,
                        status: true,
                        startTime: true,
                        endTime: true,
                    },
                },
                items: true,
                payments: true,
                coupon: true,
            },
        });
    },
    findByIdAndSalon: async (id, salonId) => {
        return prisma.invoice.findFirst({
            where: {
                id,
                salonId,
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        gst: true,
                        customerCode: true,
                        outstandingAmount: true,
                        walletBalance: true,
                        loyaltyPoints: true,
                        membership: {
                            select: {
                                id: true,
                                name: true,
                                discountPercentage: true,
                                status: true,
                            },
                        },
                    },
                },
                appointment: {
                    select: {
                        id: true,
                        appointmentCode: true,
                        status: true,
                        startTime: true,
                        endTime: true,
                    },
                },
                items: true,
                payments: true,
                coupon: true,
            },
        });
    },
    findByAppointmentIdAndSalon: async (appointmentId, salonId) => {
        return prisma.invoice.findFirst({
            where: {
                appointmentId,
                salonId,
            },
        });
    },
    updatePaymentSummary: async (id, data) => {
        return prisma.invoice.update({
            where: {
                id,
            },
            data: {
                paidAmount: data.paidAmount,
                balanceAmount: data.balanceAmount,
                paymentStatus: data.paymentStatus,
            },
            include: {
                items: true,
                payments: true,
                coupon: true,
            },
        });
    },
    cancel: async (id, tx) => {
        return (tx ?? prisma).invoice.update({
            where: {
                id,
            },
            data: {
                status: "CANCELLED",
            },
        });
    },
    updateSafeFields: async (id, data, tx) => tx.invoice.update({
        where: { id },
        data,
        include: { items: true, payments: true, coupon: true },
    }),
};
