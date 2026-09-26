// Splits the product use confirmed on the usage step across the stock it
// comes from: for a product opened into containers the chosen container
// first, then the oldest open ones; otherwise the sealed service stock.
// Worked in hundredths so 0.1 + 0.2 stays 0.3, matching the server.
const toHundredths = (value) => Math.round(Number(value || 0) * 100);
const fromHundredths = (value) => value / 100;

/**
 * rows: [{ key, productId, actual, containerId? }] in the order shown.
 * products: usage-plan products by id ({ containerTracked, openContainers,
 * stock: { SERVICE } }).
 * Returns { [key]: { parts: [{ containerId, quantity }], shortfall } }; a
 * sealed-stock row has no parts, only a shortfall.
 */
export const allocateUsage = (rows, products) => {
  const left = new Map();
  for (const [productId, product] of Object.entries(products)) {
    if (product.containerTracked) {
      for (const container of product.openContainers || []) {
        left.set(container.id, toHundredths(container.remainingQuantity));
      }
    } else {
      left.set(productId, toHundredths(product.stock?.SERVICE));
    }
  }
  const result = {};
  for (const row of rows) {
    const product = products[row.productId] || {};
    let need = Math.max(toHundredths(row.actual), 0);
    const parts = [];
    if (product.containerTracked) {
      const pool = product.openContainers || [];
      const order = [
        ...pool.filter((container) => container.id === row.containerId),
        ...pool.filter((container) => container.id !== row.containerId),
      ];
      for (const container of order) {
        if (need <= 0) break;
        const take = Math.min(need, left.get(container.id) || 0);
        if (take <= 0) continue;
        parts.push({ containerId: container.id, quantity: fromHundredths(take) });
        left.set(container.id, left.get(container.id) - take);
        need -= take;
      }
    } else {
      const take = Math.min(need, left.get(row.productId) || 0);
      left.set(row.productId, (left.get(row.productId) || 0) - take);
      need -= take;
    }
    result[row.key] = { parts, shortfall: fromHundredths(need) };
  }
  return result;
};

/** Up to two decimals, not negative: what the server accepts. */
export const isValidQuantity = (value) =>
  value !== "" &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Math.abs(Math.round(Number(value) * 100) - Number(value) * 100) < 1e-6;
