import { expect, test } from "@playwright/test";
import { STATE, api, fixture, tokenFor } from "./helpers.js";

// The awkward paths: a service with nothing to record, stock that runs out
// mid-workflow, a split across packs, a cancellation, a failed bill, another
// branch, a reload, and a double click.
test.describe.configure({ mode: "serial" });

const f = fixture();
const counter = tokenFor("reception");
const admin = tokenFor("admin");

const view = (request, productId = f.products.shampoo) =>
  api(request, admin, "GET", `/api/inventory/products/${productId}`);
const movements = (request, productId = f.products.shampoo) =>
  api(request, admin, "GET", `/api/stock-movements/product/${productId}`);

// A walk-in cart always starts now and holds its stylist for the length of
// the service, so these carts go on the books without one.
const newCart = (request, serviceIds = [f.services.hairWash], phone = "98765 10000") =>
  api(request, counter, "POST", "/api/job-carts", {
    branchId: f.branchId,
    customerName: "Walk-in Flows",
    phone,
    serviceIds,
  });

/** A customer and an appointment of its own, so no test depends on another. */
let hour = 0;
const bookFor = async (request, name, serviceIds) => {
  hour += 1;
  const customer = await api(request, counter, "POST", "/api/customers", {
    name,
    phone: `99911${String(10000 + hour).slice(-5)}`,
    branchId: f.branchId,
  });
  // An hour apart, starting after now, so the same stylist is free for each
  // and nothing is booked in the past whatever time the suite runs.
  const start = new Date(Date.now() + hour * 3_600_000);
  start.setMinutes(30, 0, 0);
  await api(request, counter, "POST", "/api/appointments", {
    branchId: f.branchId,
    customerId: customer.id,
    staffId: f.staff.amit,
    serviceIds,
    startTime: start.toISOString(),
  });
  return name;
};

/** Finds one appointment on the calendar by customer, then opens it. */
const openAppointment = async (page, customer) => {
  await page.goto("/appointments");
  await page.getByPlaceholder("Search by customer name or phone").fill(customer);
  await expect(page.getByText(customer).first()).toBeVisible();
  await page.getByText(customer).first().click();
};

test.describe("signed in at the counter", () => {
  test.use({ storageState: STATE("reception") });

  test("a service with no consumables completes straight through to the bill", async ({ page, request }) => {
    const customer = await bookFor(request, "Plain Flow", [f.services.haircut]);
    await openAppointment(page, customer);
    await page.getByRole("button", { name: "Update status" }).click();
    const status = page.locator(".modal").filter({ hasText: "Update status" });
    await status.locator("#field-status").selectOption("COMPLETED");
    await status.getByRole("button", { name: "Update status" }).click();
    // Billing hands over to the job cart bill page, and with nothing to
    // record the usage step confirms itself and payment opens.
    await page.waitForURL(/\/job-carts\//);
    await expect(page.locator(".modal").filter({ hasText: "Make Payment" })).toBeVisible();
  });

  test("an empty service area offers a transfer, then a new bottle, then the usage", async ({ page, request }) => {
    // Move every sealed pack out of the service area first.
    const site = (await view(request)).sites.find((row) => row.branchId === f.branchId);
    if (Number(site.sealedService) > 0) {
      await api(request, admin, "POST", "/api/inventory/transfers", {
        productId: f.products.shampoo,
        branchId: f.branchId,
        fromLocation: "SERVICE",
        toLocation: "WAREHOUSE",
        quantity: Number(site.sealedService),
      });
    }
    // Empty the packs that are still open, so the service really is dry.
    for (const container of (await view(request)).containers.filter((row) => row.status === "OPEN")) {
      await api(request, admin, "POST", `/api/inventory/containers/${container.id}/reconcile`, {
        actualRemaining: 0,
        reason: "MEASUREMENT",
      });
    }

    const cart = await newCart(request, [f.services.hairWash], "98765 10001");
    await page.goto(`/job-carts/${cart.id}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    const row = usage.locator('[data-usage-row="Shampoo"]');
    await expect(row).toContainText("Shortfall");
    await expect(usage.getByRole("button", { name: "Confirm Usage" })).toHaveClass(/disabled/);

    await row.getByRole("button", { name: "Transfer From Warehouse" }).click();
    const transfer = page.locator(".modal").filter({ hasText: "Transfer Stock — Shampoo" });
    await transfer.locator("#field-quantity").fill("2");
    await transfer.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(transfer).toBeHidden();

    await row.getByRole("button", { name: /Open New Bottle/ }).click();
    const open = page.locator(".modal").filter({ hasText: "Open New Bottle — Shampoo" });
    await open.locator("#field-openedByStaffId").selectOption({ label: "Rahul" });
    await open.getByRole("button", { name: "Open Bottle" }).click();
    await expect(open).toBeHidden();

    await expect(row).not.toContainText("Shortfall");
    await usage.getByRole("button", { name: "Confirm Usage" }).click();
    const payment = page.locator(".modal").filter({ hasText: "Make Payment" });
    await payment.locator(".jcp-modal-foot .jcp-pay").click();
    await expect(page.getByRole("button", { name: /Open Invoice/ })).toBeVisible();

    const used = (await movements(request)).filter(
      (row) => row.type === "USED_IN_SERVICE" && row.referenceId === cart.id
    );
    expect(used).toHaveLength(1);
    expect(Number(used[0].quantity)).toBe(50);
  });

  test("one usage splits across two open packs", async ({ page, request }) => {
    const open = (await view(request)).containers.filter((row) => row.status === "OPEN");
    // Leave 20 ml in the oldest pack and make sure a second one is open.
    await api(request, admin, "POST", `/api/inventory/containers/${open[open.length - 1].id}/reconcile`, {
      actualRemaining: 20,
      reason: "MEASUREMENT",
    });
    await api(request, admin, "POST", "/api/inventory/containers/open", {
      productId: f.products.shampoo,
      branchId: f.branchId,
      openedByStaffId: f.staff.amit,
    });

    const cart = await newCart(request, [f.services.hairWash], "98765 10002");
    await page.goto(`/job-carts/${cart.id}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    const row = usage.locator('[data-usage-row="Shampoo"]');
    await expect(row).toContainText("Taken from");
    await usage.getByRole("button", { name: "Confirm Usage" }).click();
    const payment = page.locator(".modal").filter({ hasText: "Make Payment" });
    await payment.locator(".jcp-modal-foot .jcp-pay").click();
    await expect(page.getByRole("button", { name: /Open Invoice/ })).toBeVisible();

    const used = (await movements(request)).filter(
      (row) => row.type === "USED_IN_SERVICE" && row.referenceId === cart.id
    );
    expect(used).toHaveLength(2);
    expect(used.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(50);
    expect(new Set(used.map((row) => row.container.code)).size).toBe(2);
  });

  test("a reload during the usage step keeps the stock untouched", async ({ page, request }) => {
    const before = await view(request);
    const cart = await newCart(request, [f.services.hairWash], "98765 10003");
    await page.goto(`/job-carts/${cart.id}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    await usage.locator('[data-usage-row="Shampoo"] input[type="number"]').fill("70");
    await page.reload();

    await expect(page.getByText("Record Product Usage")).toBeHidden();
    await page.getByRole("button", { name: /Pay Now/ }).click();
    // The step starts again from the service default, and nothing was booked.
    await expect(usage.locator('[data-usage-row="Shampoo"] input[type="number"]')).toHaveValue("50");
    const after = await view(request);
    expect(after.containers.map((row) => row.remainingQuantity)).toEqual(
      before.containers.map((row) => row.remainingQuantity)
    );
  });

  test("a rejected payment leaves the cart billable and the stock untouched", async ({ page, request }) => {
    const before = await view(request);
    const cart = await newCart(request, [f.services.hairWash], "98765 10004");
    await page.goto(`/job-carts/${cart.id}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    await usage.getByRole("button", { name: "Confirm Usage" }).click();
    const payment = page.locator(".modal").filter({ hasText: "Make Payment" });
    // More than the bill: the server refuses the whole confirm.
    await payment.locator('input[type="number"]').first().fill("99999");
    await payment.locator(".jcp-modal-foot .jcp-pay").click();

    await expect(page.getByRole("button", { name: /Pay Now/ })).toBeVisible();
    const after = await view(request);
    expect(after.containers.map((row) => row.remainingQuantity)).toEqual(
      before.containers.map((row) => row.remainingQuantity)
    );
    expect(
      (await movements(request)).filter((row) => row.referenceId === cart.id)
    ).toHaveLength(0);
  });

  test("double clicking the final confirm books the usage once", async ({ page, request }) => {
    const cart = await newCart(request, [f.services.hairWash], "98765 10005");
    await page.goto(`/job-carts/${cart.id}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    await usage.getByRole("button", { name: "Confirm Usage" }).click();
    const payment = page.locator(".modal").filter({ hasText: "Make Payment" });
    const pay = payment.locator(".jcp-modal-foot .jcp-pay");
    await pay.click({ force: true });
    await pay.click({ force: true }).catch(() => undefined);
    await expect(page.getByRole("button", { name: /Open Invoice/ })).toBeVisible();

    const used = (await movements(request)).filter(
      (row) => row.type === "USED_IN_SERVICE" && row.referenceId === cart.id
    );
    expect(used).toHaveLength(1);
    expect(await api(request, counter, "GET", `/api/job-carts/${cart.id}`)).toMatchObject({
      appointmentStatus: "COMPLETED",
    });
  });

  test("cancelling a completed appointment puts the content back", async ({ page, request }) => {
    const customer = await bookFor(request, "Cancel Flow", [f.services.hairWash]);
    await openAppointment(page, customer);
    await page.getByRole("button", { name: "Update status" }).click();
    const status = page.locator(".modal").filter({ hasText: "Update status" });
    await status.locator("#field-status").selectOption("COMPLETED");
    await status.getByRole("button", { name: "Update status" }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    await expect(usage.locator('[data-usage-row="Shampoo"]')).toBeVisible();
    await usage.getByRole("button", { name: "Confirm Usage & Complete" }).click();
    await page.waitForURL(/\/job-carts\//);
    const appointmentId = new URL(page.url()).pathname.split("/")[2];
    const afterUse = await view(request);

    await openAppointment(page, customer);
    await page.getByRole("button", { name: "Update status" }).click();
    await status.locator("#field-status").selectOption("CANCELLED");
    await status.getByRole("button", { name: "Update status" }).click();
    await expect(page.locator(".modal").filter({ hasText: "Update status" })).toBeHidden();

    expect(await api(request, counter, "GET", `/api/appointments/${appointmentId}`)).toMatchObject({
      status: "CANCELLED",
    });
    const restored = await view(request);
    const usedNow = restored.containers.reduce((sum, row) => sum + Number(row.remainingQuantity), 0);
    const usedBefore = afterUse.containers.reduce((sum, row) => sum + Number(row.remainingQuantity), 0);
    expect(usedNow).toBe(usedBefore + 50);
    expect(
      (await movements(request)).some(
        (row) => row.type === "RETURNED" && row.referenceType === "APPOINTMENT_CONSUMABLE_REVERSAL"
      )
    ).toBe(true);
  });
});

test.describe("signed in at the second branch", () => {
  test.use({ storageState: STATE("reception2") });

  test("sees its own stock only", async ({ page }) => {
    await page.goto(`/admin/products/${f.products.shampoo}/inventory`);
    await expect(page.locator('[data-site="Main"]')).toHaveCount(0);
    const second = page.locator('[data-site="Second"]');
    await expect(second).toBeVisible();
    await expect(second).toContainText("0 bottle");
    // The other branch's open packs are not listed either.
    await expect(page.getByRole("cell", { name: /^SH-/ })).toHaveCount(0);
  });
});
