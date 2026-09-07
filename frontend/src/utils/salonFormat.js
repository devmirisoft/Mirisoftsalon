export const labelize = (value = "") =>
  String(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const formatMoney = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const formatDate = (value, withTime = false) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(date);
};

export const toLocalInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
};

export const todayInputDate = () => toLocalInput(new Date()).slice(0, 10);

export const minDateTimeInput = () => {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  return toLocalInput(date);
};

export const currentInputTime = () => minDateTimeInput().slice(11, 16);

export const addMonthsInputDate = (value, months = 1) => {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() + months);
  return toLocalInput(date).slice(0, 10);
};

export const compactId = (value = "") =>
  value ? `${String(value).slice(0, 8)}…` : "—";

// A branch manager is a salon admin confined to one branch, so it is allowed
// everywhere a salon admin is; the API scopes its data to that branch.
export const allowsRole = (roles, role) =>
  roles.includes(role) ||
  (role === "BRANCH_MANAGER" && roles.includes("SALON_ADMIN"));

export const roleCanManage = (role) =>
  role === "SUPER_ADMIN" || role === "SALON_ADMIN" || role === "BRANCH_MANAGER";

const displayNameKeys = [
  "displayName",
  "fullName",
  "name",
  "title",
  "label",
  "serviceName",
  "packageName",
  "categoryName",
  "brandName",
  "productName",
  "customerName",
  "staffName",
  "branchName",
  "salonName",
  "invoiceCode",
  "appointmentCode",
  "jobCartCode",
  "code",
  "email",
  "phone",
  "mobile",
  "id",
];

const isPlainDisplayValue = (value) =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  value instanceof Date;

export const formatDisplayValue = (value, emptyText = "\u2014") => {
  if (value === null || value === undefined || value === "") return emptyText;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return formatDate(value, true);
  if (typeof value === "string") return value.replaceAll("_", " ");
  if (Array.isArray(value)) {
    if (!value.length) return emptyText;
    return value
      .map((item) => formatDisplayValue(item, ""))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value !== "object") return String(value);

  for (const key of displayNameKeys) {
    if (value[key] !== null && value[key] !== undefined && value[key] !== "") {
      return formatDisplayValue(value[key], emptyText);
    }
  }

  const scalarEntries = Object.entries(value).filter(([, entryValue]) =>
    isPlainDisplayValue(entryValue)
  );

  if (!scalarEntries.length) return emptyText;

  return scalarEntries
    .slice(0, 4)
    .map(([key, entryValue]) => `${labelize(key)}: ${formatDisplayValue(entryValue, emptyText)}`)
    .join(" | ");
};
