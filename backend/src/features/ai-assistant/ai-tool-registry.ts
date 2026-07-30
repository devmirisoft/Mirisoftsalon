import type { AiTool } from "./ai-tool.types.js";
import { getTodayAppointmentsTool } from "./tools/getTodayAppointments.tool.js";
import { getRevenueSummaryTool } from "./tools/getRevenueSummary.tool.js";
import { getLowStockProductsTool } from "./tools/getLowStockProducts.tool.js";
import { getOutstandingCustomersTool } from "./tools/getOutstandingCustomers.tool.js";
import { getPackageExpirySummaryTool } from "./tools/getPackageExpirySummary.tool.js";
import { getMembershipExpirySummaryTool } from "./tools/getMembershipExpirySummary.tool.js";
import { getHolidaysTodayTool } from "./tools/getHolidaysToday.tool.js";
import { getStaffAvailabilityTool } from "./tools/getStaffAvailability.tool.js";
import { getStaffSummaryTool } from "./tools/getStaffSummary.tool.js";
import { getServiceSummaryTool } from "./tools/getServiceSummary.tool.js";
import { getSelectedCustomerSummaryTool } from "./tools/getSelectedCustomerSummary.tool.js";
import { getSelectedInvoiceSummaryTool } from "./tools/getSelectedInvoiceSummary.tool.js";
import { getSelectedAppointmentSummaryTool } from "./tools/getSelectedAppointmentSummary.tool.js";
import { getSelectedStaffPerformanceTool } from "./tools/getSelectedStaffPerformance.tool.js";
import {
  getCustomerBirthdaysTool,
  getDailyTodayAppointmentsTool,
  getExpectedRevenueTool,
  getLowStockTool,
  getOperationalAlertsTool,
  getStaffAbsencesTool,
  getStaffUtilizationTool,
  getUnpaidInvoicesTool,
} from "./tools/dailyBrief.tools.js";

const tools: AiTool[] = [
  getTodayAppointmentsTool,
  getRevenueSummaryTool,
  getLowStockProductsTool,
  getOutstandingCustomersTool,
  getPackageExpirySummaryTool,
  getMembershipExpirySummaryTool,
  getHolidaysTodayTool,
  getStaffAvailabilityTool,
  getStaffSummaryTool,
  getServiceSummaryTool,
  getSelectedCustomerSummaryTool,
  getSelectedInvoiceSummaryTool,
  getSelectedAppointmentSummaryTool,
  getSelectedStaffPerformanceTool,
  getDailyTodayAppointmentsTool,
  getExpectedRevenueTool,
  getUnpaidInvoicesTool,
  getStaffUtilizationTool,
  getStaffAbsencesTool,
  getLowStockTool,
  getCustomerBirthdaysTool,
  getOperationalAlertsTool,
];

export function getAiTools(): readonly AiTool[] {
  return tools;
}

export function getAiToolByName(name: string): AiTool | undefined {
  return tools.find((tool) => tool.name === name);
}
