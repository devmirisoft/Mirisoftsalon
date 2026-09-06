import { type Request, type Response } from "express";
import { createExcelReport } from "../../utils/export/excelExport.js";
import { createPdfReport } from "../../utils/export/pdfReportExport.js";
import {
  REPORT_EXPORT_FORMATS,
  type ReportExportFormat,
} from "../../utils/export/reportExportTypes.js";
import {
  createBestEffortAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { sendInventoryError, transactionError } from "../products/inventory-access.js";
import {
  buildReportExport,
  EXPORT_REPORT_TYPES,
  type ExportReportType,
} from "./report-export.service.js";

const safePart = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const reportFilename: Record<ExportReportType, string> = {
  revenue: "billing-and-payments-report",
  expenses: "expense-report",
  "salon-report": "salon-report",
  inventory: "inventory-report",
  "low-stock": "low-stock-report",
  "staff-performance": "staff-performance-report",
  payroll: "salary-slips-report",
  "customer-outstanding": "customer-report",
  appointments: "appointment-report",
};

export const exportReport = async (req: Request, res: Response) => {
  try {
    const reportType =
      typeof req.params.reportType === "string"
        ? req.params.reportType.toLowerCase()
        : "";
    if (!EXPORT_REPORT_TYPES.includes(reportType as ExportReportType)) {
      throw transactionError("Unsupported report type", 404);
    }
    const format =
      typeof req.query.format === "string"
        ? req.query.format.toLowerCase()
        : "";
    if (!REPORT_EXPORT_FORMATS.includes(format as ReportExportFormat)) {
      throw transactionError("Format must be pdf or xlsx");
    }

    const report = await buildReportExport(req, reportType as ExportReportType);
    const buffer =
      format === "pdf"
        ? await createPdfReport(report)
        : await createExcelReport(report);
    const range = [req.query.from, req.query.to]
      .filter((value): value is string => typeof value === "string" && Boolean(value))
      .map(safePart)
      .join("-");
    const filename = [
      safePart(report.salonName) || "salon",
      reportFilename[reportType as ExportReportType],
      range,
    ].filter(Boolean).join("-");

    res.setHeader(
      "Content-Type",
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}.${format}"`
    );
    res.setHeader("Content-Length", String(buffer.length));

    await createBestEffortAuditLog({
      salonId: report.salonId,
      branchId: report.branchId,
      userId: req.user?.userId,
      module: "SYSTEM",
      action: "CREATE",
      entityName: report.reportType,
      description: `${report.title} exported as ${format.toUpperCase()}`,
      newData: {
        event: "REPORT_EXPORTED",
        reportType: report.reportType,
        format,
        filters: report.filters,
        rowCount: report.rows.length,
      },
      ...requestAuditContext(req),
    });
    return res.status(200).send(buffer);
  } catch (error) {
    return sendInventoryError(res, error);
  }
};
