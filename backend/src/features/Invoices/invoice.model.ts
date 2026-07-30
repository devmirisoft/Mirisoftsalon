import { prisma } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

type InvoiceType = "GST_INVOICE" | "BILL_OF_SUPPLY";
type InvoiceStatus = "DRAFT" | "ISSUED" | "CANCELLED";
type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

type CreateInvoiceItemInput = {
  serviceId?: string;
  productId?: string;
  itemType?: "SERVICE" | "PRODUCT" | "PACKAGE" | "PACKAGE_REDEMPTION";
  packageId?: string;
  soldByStaffId?: string;
  itemCode?: string;
  description: string;
  serviceName: string;
  quantity?: number;
  unitPrice: Prisma.Decimal | number;
  discountAmount?: Prisma.Decimal | number;
  taxableAmount?: Prisma.Decimal | number;
  gstRateSnapshot?: Prisma.Decimal | number;
  gstAmount?: Prisma.Decimal | number;
  totalWithTax?: Prisma.Decimal | number;
  taxPercent?: Prisma.Decimal | number;
  taxAmount?: Prisma.Decimal | number;
  lineTotal: Prisma.Decimal | number;
};

export const InvoiceModel = {
  create: async (data: {
    invoiceCode: string;

    salonId: string;
    branchId?: string;
    customerId: string;
    appointmentId?: string;

    invoiceType?: InvoiceType;

    salonName: string;
    salonPhone?: string;
    salonEmail?: string;
    salonAddress?: string;
    salonGst?: string;

    customerName: string;
    customerPhone?: string;
    customerEmail?: string;
    customerAddress?: string;
    customerGst?: string;

    serviceTaxableAmount?: Prisma.Decimal | number;
    productTaxableAmount?: Prisma.Decimal | number;
    serviceGstAmount?: Prisma.Decimal | number;
    productGstAmount?: Prisma.Decimal | number;
    totalGstAmount?: Prisma.Decimal | number;
    gstNumberSnapshot?: string | null;
    gstLegalNameSnapshot?: string | null;
    gstStateCodeSnapshot?: string | null;
    gstEnabledSnapshot?: boolean;

    subtotalAmount: Prisma.Decimal | number;
    discountAmount: Prisma.Decimal | number;
    processingFeeAmount: Prisma.Decimal | number;
    taxAmount: Prisma.Decimal | number;
    totalAmount: Prisma.Decimal | number;

    paidAmount?: Prisma.Decimal | number;
    balanceAmount: Prisma.Decimal | number;

    status?: InvoiceStatus;
    paymentStatus?: PaymentStatus;

    billingNote?: string;
    footerNote?: string;

    items: CreateInvoiceItemInput[];
  }, tx?: Prisma.TransactionClient) => {
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

  findBySalon: async (
    salonId: string,
    filters?: {
      branchId?: string;
      customerId?: string;
      paymentStatus?: PaymentStatus;
      status?: InvoiceStatus;
    }
  ) => {
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

  findById: async (id: string) => {
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

  findByIdAndSalon: async (id: string, salonId: string) => {
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

  findByAppointmentIdAndSalon: async (
    appointmentId: string,
    salonId: string
  ) => {
    return prisma.invoice.findFirst({
      where: {
        appointmentId,
        salonId,
      },
    });
  },

  updatePaymentSummary: async (
    id: string,
    data: {
      paidAmount: number;
      balanceAmount: number;
      paymentStatus: PaymentStatus;
    }
  ) => {
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

  cancel: async (id: string, tx?: Prisma.TransactionClient) => {
    return (tx ?? prisma).invoice.update({
      where: {
        id,
      },
      data: {
        status: "CANCELLED",
      },
    });
  },

  updateSafeFields: async (
    id: string,
    data: Prisma.InvoiceUpdateInput,
    tx: Prisma.TransactionClient
  ) =>
    tx.invoice.update({
      where: { id },
      data,
      include: { items: true, payments: true, coupon: true },
    }),
};
