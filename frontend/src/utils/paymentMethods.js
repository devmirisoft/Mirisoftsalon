import { labelize } from "./salonFormat.js";

// Mirrors the PaymentMethod enum in the Prisma schema. Every payment picker in
// the app sources its options from here, so a new tender type is added once.
export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "GPAY", label: "GPay" },
  { value: "PAYTM", label: "Paytm" },
  { value: "PHONEPE", label: "PhonePe" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "MEMBERSHIP_WALLET", label: "Membership wallet" },
  { value: "OTHER", label: "Other" },
];

// The wallet debits a membership balance, so it is only ever offered by screens
// that route to the wallet API; the plain payment endpoint rejects it.
export const PAYABLE_METHODS = PAYMENT_METHODS.filter(
  (method) => method.value !== "MEMBERSHIP_WALLET"
);

export const methodLabel = (value) =>
  PAYMENT_METHODS.find((method) => method.value === value)?.label ||
  labelize(value);

const methodOrder = new Map(
  PAYMENT_METHODS.map((method, index) => [method.value, index])
);

// Collapses payment rows into one line per tender type. Amounts arrive from the
// API as Decimal strings, so they are coerced before summing.
export const groupPaymentsByMethod = (payments = []) => {
  const totals = new Map();

  for (const payment of payments || []) {
    if (!payment?.method) continue;
    const amount = Number(payment.amount || 0);
    if (!Number.isFinite(amount)) continue;
    totals.set(payment.method, (totals.get(payment.method) || 0) + amount);
  }

  return [...totals]
    .filter(([, amount]) => amount !== 0)
    .sort(
      ([left], [right]) =>
        (methodOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (methodOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    )
    .map(([method, amount]) => ({
      method,
      label: methodLabel(method),
      amount,
    }));
};
