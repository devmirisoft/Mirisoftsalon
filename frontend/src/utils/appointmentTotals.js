// Cart math for the appointment booking modal: catalog price per service,
// salon service GST on top, durations rolled up for the end time.
export const serviceMinutes = (service) =>
  Number(service?.durationValue || 0) *
  (service?.durationUnit === "HOURS" ? 60 : 1);

export const appointmentTotals = (cart = [], gstPercent = 0) => {
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const minutes = cart.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const tax = (subtotal * Number(gstPercent || 0)) / 100;
  return { subtotal, minutes, tax, total: subtotal + tax };
};
