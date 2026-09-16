import type { Prisma } from "../generated/prisma/client.js";
import { getSalonLocalParts, salonLocalDateTimeToUtc } from "./timezone.js";

type BusinessCodeType = "APT" | "EXP" | "PUR" | "RET" | "JC";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

const pad = (value: number, size: number) => String(value).padStart(size, "0");

export const salonInitials = (salonName: string) => {
  const words = salonName
    .trim()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const initials =
    words.length > 1
      ? words.map((word) => word[0]).join("")
      : (words[0] ?? salonName).slice(0, 3);

  return initials.replace(/[^a-z0-9]/gi, "").toUpperCase() || "SAL";
};

export const businessCodeDateKey = (
  date: Date = new Date(),
  timezone?: string | null
) => {
  const parts = getSalonLocalParts(date, timezone || DEFAULT_TIMEZONE);
  return `${parts.year}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
};

export const businessCodeDayRange = (
  date: Date = new Date(),
  timezone?: string | null
) => {
  const effectiveTimezone = timezone || DEFAULT_TIMEZONE;
  const parts = getSalonLocalParts(date, effectiveTimezone);
  const dateKey = `${parts.year}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const nextDateKey = `${next.getUTCFullYear()}-${pad(
    next.getUTCMonth() + 1,
    2
  )}-${pad(next.getUTCDate(), 2)}`;

  return {
    start: salonLocalDateTimeToUtc(dateKey, "00:00", effectiveTimezone),
    end: salonLocalDateTimeToUtc(nextDateKey, "00:00", effectiveTimezone),
  };
};

export const buildBusinessCode = ({
  salonName,
  type,
  date = new Date(),
  timezone,
  serial,
}: {
  salonName: string;
  type: BusinessCodeType;
  date?: Date | undefined;
  timezone?: string | null | undefined;
  serial?: number | undefined;
}) => {
  const parts = getSalonLocalParts(date, timezone || DEFAULT_TIMEZONE);
  const timePart = `${pad(parts.hour, 2)}${pad(parts.minute, 2)}${pad(
    parts.second,
    2
  )}${pad(date.getMilliseconds(), 3)}`;
  const datePart = `${pad(parts.day, 2)}${pad(parts.month, 2)}${parts.year}`;
  const serialPart = serial === undefined ? "" : pad(serial, 3);

  return `${salonInitials(salonName)}${type}${timePart}${datePart}${serialPart}`;
};

// Invoices read as INITIALS/YYYY/MM/DD/HHMM: the customer can say the code out
// loud and it still says which salon billed them, and when.
export const buildInvoiceCode = ({
  salonName,
  date = new Date(),
  timezone,
}: {
  salonName: string;
  date?: Date | undefined;
  timezone?: string | null | undefined;
}) => {
  const parts = getSalonLocalParts(date, timezone || DEFAULT_TIMEZONE);

  return [
    salonInitials(salonName),
    parts.year,
    pad(parts.month, 2),
    pad(parts.day, 2),
    `${pad(parts.hour, 2)}${pad(parts.minute, 2)}`,
  ].join("/");
};

// Codes are minute-resolution and unique per salon, so a second bill inside the
// same minute takes a -2, -3, ... suffix rather than failing the insert.
// ponytail: count-then-insert, so two bills committed in the same minute at the
// exact same instant can still collide on the unique index; retry the insert
// with a fresh code if that ever shows up in the logs.
export const nextInvoiceCode = async (
  tx: Prisma.TransactionClient,
  salon: { id: string; name: string; timezone?: string | null },
  date: Date = new Date()
) => {
  const code = buildInvoiceCode({
    salonName: salon.name,
    date,
    timezone: salon.timezone,
  });
  const taken = await tx.invoice.count({
    where: { salonId: salon.id, invoiceCode: { startsWith: code } },
  });

  return taken ? `${code}-${taken + 1}` : code;
};

export const buildSalonCode = ({
  salonName,
  date = new Date(),
  timezone,
}: {
  salonName: string;
  date?: Date | undefined;
  timezone?: string | null | undefined;
}) => {
  const parts = getSalonLocalParts(date, timezone || DEFAULT_TIMEZONE);
  const timePart = `${pad(parts.hour, 2)}${pad(parts.minute, 2)}${pad(
    parts.second,
    2
  )}${pad(date.getMilliseconds(), 3)}`;
  const datePart = `${pad(parts.day, 2)}${pad(parts.month, 2)}${parts.year}`;

  return `${salonInitials(salonName)}${timePart}${datePart}`;
};
