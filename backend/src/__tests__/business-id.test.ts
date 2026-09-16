import {
  buildBusinessCode,
  buildInvoiceCode,
  buildSalonCode,
  nextInvoiceCode,
  salonInitials,
} from "../utils/business-id.js";

describe("business ID formatting", () => {
  const createdAt = new Date("2026-07-04T09:00:25.123Z");

  it("uses salon initials, type, local time, and local date", () => {
    expect(
      buildBusinessCode({
        salonName: "Glam Lounge",
        type: "APT",
        date: createdAt,
        timezone: "Asia/Kolkata",
      })
    ).toBe("GLAPT14302512304072026");
  });

  it("adds a three-digit serial", () => {
    expect(
      buildBusinessCode({
        salonName: "Glam Lounge",
        type: "APT",
        date: createdAt,
        timezone: "Asia/Kolkata",
        serial: 1,
      })
    ).toBe("GLAPT14302512304072026001");
  });

  it("formats invoice codes as initials/year/month/day/time", () => {
    expect(
      buildInvoiceCode({
        salonName: "The Salon Junction Center",
        date: createdAt,
        timezone: "Asia/Kolkata",
      })
    ).toBe("TSJC/2026/07/04/1430");
  });

  it("suffixes an invoice code already taken in the same minute", async () => {
    const salon = { id: "salon-1", name: "Glam Lounge", timezone: "Asia/Kolkata" };
    const tx = { invoice: { count: jest.fn() } };

    tx.invoice.count.mockResolvedValueOnce(0);
    await expect(
      nextInvoiceCode(tx as never, salon, createdAt)
    ).resolves.toBe("GL/2026/07/04/1430");

    tx.invoice.count.mockResolvedValueOnce(1);
    await expect(
      nextInvoiceCode(tx as never, salon, createdAt)
    ).resolves.toBe("GL/2026/07/04/1430-2");
  });

  it("formats salon codes and single-word initials", () => {
    expect(salonInitials("Radiance")).toBe("RAD");
    expect(
      buildSalonCode({
        salonName: "Glam Lounge",
        date: createdAt,
        timezone: "Asia/Kolkata",
      })
    ).toBe("GL14302512304072026");
  });
});
