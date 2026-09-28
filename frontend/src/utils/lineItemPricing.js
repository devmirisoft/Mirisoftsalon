
export const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
 
// A quantity below 1 would make the price back-solve divide by zero.
export const qtyOf = (qty) => Math.max(1, Math.floor(Number(qty) || 1));
 
export const pctOf = (discount) =>
  Math.min(100, Math.max(0, Number(discount || 0)));
 
export const cappedDiscount = (price, discount, type) => {
  if (discount === "") return "";
  const value = Number(discount);
  const numeric = Number.isFinite(value) ? Math.max(0, value) : 0;
  const max = type === "PCT" ? 100 : Math.max(0, Number(price || 0));
  return String(round2(Math.min(numeric, max)));
};
 
export const discountAmountOf = (price, discount, type) =>
  type === "PCT"
    ? (Number(price || 0) * pctOf(discount)) / 100
    : Number(cappedDiscount(price, discount, type) || 0);
 
export const netPrice = (price, discount, type) =>
  Math.max(
    0,
    round2(Number(price || 0) - discountAmountOf(price, discount, type))
  );
 
export const priceToTotal = (price, qty, gst, discount = 0, type = "AMT") =>
  String(
    round2(netPrice(price, discount, type) * qtyOf(qty) * (1 + gst / 100))
  );
 
// Back-solving a percentage discount at 100% off has no single answer, so the
// base price collapses to 0 rather than dividing by zero.
export const totalToPrice = (total, qty, gst, discount = 0, type = "AMT") => {
  const net = Number(total || 0) / qtyOf(qty) / (1 + gst / 100);
  if (type !== "PCT") return String(round2(net + Number(discount || 0)));
  const pct = pctOf(discount);
  return String(pct >= 100 ? 0 : round2(net / (1 - pct / 100)));
};
 