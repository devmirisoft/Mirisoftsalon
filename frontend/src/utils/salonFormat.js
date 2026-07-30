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

export const roleCanManage = (role) =>
  role === "SUPER_ADMIN" || role === "SALON_ADMIN";
