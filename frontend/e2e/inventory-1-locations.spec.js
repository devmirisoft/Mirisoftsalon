import { expect, test } from "@playwright/test";
import { STATE, api, fixture, login, tokenFor } from "./helpers.js";

// One seeded salon, walked through in order: stock arrives, moves between
// locations, is opened, used by services, sold, and shows up in history.
test.describe.configure({ mode: "serial" });

const f = fixture();
const admin = tokenFor("admin");
const counter = tokenFor("reception");
// The value of one KPI tile inside a stock card.
const kpi = (scope, label) =>
  scope
    .locator(".card-inner.py-3")
    .filter({ has: scope.page().getByText(label, { exact: true }) })
    .locator(".fs-3");

const productView = (request, token, productId) =>
  api(request, token, "GET", `/api/inventory/products/${productId}`);

test.describe("signed in as the salon admin", () => {
  test.use({ storageState: STATE("admin") });

  test("product inventory: locations, transfers and opened bottles", async ({ page }) => {
    await page.goto(`/admin/products/${f.products.shampoo}/inventory`);
    const main = page.locator('[data-site="Main"]');
    await expect(kpi(main, "Warehouse")).toHaveText("80 bottle");
    await expect(kpi(main, "Retail")).toHaveText("15 bottle");
    await expect(kpi(main, "Sealed Service Stock")).toHaveText("5 bottle");

    // Warehouse → Service, with who issued and who received it.
    await main.getByRole("button", { name: "Transfer Stock" }).click();
    const transfer = page.locator(".modal").filter({ hasText: "Transfer Stock — Shampoo" });
    await transfer.locator("#field-from").selectOption("WAREHOUSE");
    await transfer.locator("#field-toLocation").selectOption("SERVICE");
    await transfer.locator("#field-quantity").fill("3");
    await transfer.locator("#field-issuedByStaffId").selectOption({ label: "Amit" });
    await transfer.locator("#field-receivedByStaffId").selectOption({ label: "Rahul" });
    await transfer.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(transfer).toBeHidden();
    await expect(kpi(main, "Warehouse")).toHaveText("77 bottle");
    await expect(kpi(main, "Sealed Service Stock")).toHaveText("8 bottle");

    // Open a bottle, then another while the first is still open.
    for (const [staffName, reason, code] of [
      ["Rahul", "Normal usage", "SH-001"],
      ["Amit", "Previous one lost or misplaced", "SH-002"],
    ]) {
      await main.getByRole("button", { name: "Open New Bottle" }).click();
      const open = page.locator(".modal").filter({ hasText: "Open New Bottle — Shampoo" });
      await expect(open.getByText("Available sealed service stock")).toBeVisible();
      await open.locator("#field-openedByStaffId").selectOption({ label: staffName });
      await open.locator("#field-reason").selectOption(reason);
      await open.getByRole("button", { name: "Open Bottle" }).click();
      await expect(open).toBeHidden();
      await expect(page.locator("tr", { hasText: code })).toContainText("OPEN");
      await expect(page.locator("tr", { hasText: code })).toContainText(staffName);
    }
    await expect(kpi(main, "Sealed Service Stock")).toHaveText("6 bottle");
    await expect(kpi(main, "Open Containers")).toContainText("2");

    // Stock history shows the transfer and both openings.
    await page.getByRole("link", { name: "Stock History" }).click();
    // Two: the stock the salon opened with, and the transfer above.
    await expect(page.getByRole("cell", { name: "Warehouse → Service" })).toHaveCount(2);
    await expect(page.getByRole("cell", { name: /Opened pack/ })).toHaveCount(2);
  });
});

test.describe("signed in at the counter", () => {
  test.use({ storageState: STATE("reception") });

  test("job cart: usage is confirmed before payment and billed with it", async ({ page, request }) => {
    const cart = await api(request, counter, "POST", "/api/job-carts", {
      branchId: f.branchId,
      customerName: "Walk-in Priya",
      phone: "98765 00003",
      startTime: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      serviceIds: [f.services.hairWash],
      staffId: f.staff.rahul,
    });
    const second = (await productView(request, admin, f.products.shampoo)).containers.find(
      (container) => container.code === "SH-002"
    );

    await page.goto(`/job-carts/${cart.id}`);
    await page.getByRole("button", { name: /Pay Now/ }).click();
    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    await expect(usage.getByText("Hair Wash")).toBeVisible();
    const row = usage.locator('[data-usage-row="Shampoo"]');
    await expect(row).toContainText("Expected 50 ml");
    await expect(row.locator('input[type="number"]')).toHaveValue("50");

    // Cancelling the usage step never reaches payment.
    await usage.getByRole("button", { name: "Cancel" }).click();
    await expect(usage).toBeHidden();
    await expect(page.getByText("Make Payment")).toBeHidden();

    await page.getByRole("button", { name: /Pay Now/ }).click();
    await expect(row).toBeVisible();
    // More than the chosen bottle's neighbour could give is flagged.
    await row.locator('input[type="number"]').fill("2500");
    await expect(row).toContainText("Shortfall");
    // The shared Button marks itself disabled with a class, not the attribute.
    await expect(usage.getByRole("button", { name: "Confirm Usage" })).toHaveClass(/disabled/);
    await row.locator('input[type="number"]').fill("60");
    await row.locator("select").selectOption(second.id);
    await usage.getByRole("button", { name: "Confirm Usage" }).click();
    await expect(usage).toBeHidden();

    const payment = page.locator(".modal").filter({ hasText: "Make Payment" });
    await expect(payment).toBeVisible();
    await payment.locator(".jcp-modal-foot .jcp-pay").click();
    await expect(page.getByRole("button", { name: /Open Invoice/ })).toBeVisible();

    const after = await productView(request, admin, f.products.shampoo);
    expect(Number(after.containers.find((container) => container.code === "SH-002").remainingQuantity)).toBe(940);
    const history = await api(request, admin, "GET", `/api/stock-movements/product/${f.products.shampoo}`);
    const used = history.filter((row) => row.type === "USED_IN_SERVICE" && row.referenceId === cart.id);
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ quantity: "60", expectedQuantity: "50", container: { code: "SH-002" }, service: { name: "Hair Wash" }, staff: { name: "Rahul" } });
  });

  test("appointment completion records usage, then opens Make Bill", async ({ page, request }) => {
    await page.goto("/appointments");
    await page.getByPlaceholder("Search by customer name or phone").fill(f.washCustomer);
    await expect(page.getByText(f.washCustomer).first()).toBeVisible();
    await page.getByText(f.washCustomer).first().click();
    await page.getByRole("button", { name: "Update status" }).click();
    const status = page.locator(".modal").filter({ hasText: "Update status" });
    await status.locator("#field-status").selectOption("COMPLETED");
    await status.getByRole("button", { name: "Update status" }).click();

    const usage = page.locator(".modal").filter({ hasText: "Record Product Usage" });
    await expect(usage.locator('[data-usage-row="Shampoo"]')).toContainText("Expected 50 ml");
    await usage.getByRole("button", { name: "Confirm Usage & Complete" }).click();
    await page.waitForURL(`**/appointments/${f.appointments.wash}/bill`);

    // Oldest open bottle first: SH-001 gives the default 50 ml.
    const after = await productView(request, admin, f.products.shampoo);
    expect(Number(after.containers.find((container) => container.code === "SH-001").remainingQuantity)).toBe(950);
    const plan = await api(request, admin, "GET", `/api/appointments/${f.appointments.wash}`);
    expect(plan.status).toBe("COMPLETED");
  });

  // Billing an appointment seeds its draft invoice and hands over to this
  // same job cart bill page, so retail lines are sold through it.
  const billAppointment = async (page, request, appointmentId) => {
    await api(request, counter, "PATCH", `/api/appointments/${appointmentId}/status`, { status: "COMPLETED" });
    await page.goto(`/appointments/${appointmentId}/bill`);
    await page.waitForURL(/\/job-carts\//);
    const payment = page.locator(".modal").filter({ hasText: "Make Payment" });
    // A haircut uses no product, so the usage step confirms itself and the
    // payment modal opens; close it to put a product on the bill first.
    await expect(payment).toBeVisible();
    await payment.getByRole("button", { name: "Cancel" }).click();
    await expect(payment).toBeHidden();
    return payment;
  };

  const addProduct = async (page, name) => {
    await page.getByRole("button", { name: /Product/ }).click();
    const add = page.locator(".modal").filter({ hasText: "Add Product" });
    const select = add.locator("select").first();
    // The option label carries the stock alongside the name, so pick by value.
    const option = select.locator("option", { hasText: name }).first();
    await select.selectOption(await option.getAttribute("value"));
    return add;
  };

  test("a retail line is sold off the shelf when billing an appointment", async ({ page, request }) => {
    const payment = await billAppointment(page, request, f.appointments.bill);
    const add = await addProduct(page, "Hair Serum");
    await expect(add).toContainText("Retail stock: 5");
    await add.getByRole("button", { name: "Add", exact: true }).click();
    await expect(add).toBeHidden();
    await expect(page.getByText("Hair Serum").first()).toBeVisible();

    await page.getByRole("button", { name: /Pay Now/ }).click();
    await expect(payment).toBeVisible();
    await payment.locator(".jcp-modal-foot .jcp-pay").click();
    await expect(page.getByRole("button", { name: /Open Invoice/ })).toBeVisible();

    const view = await productView(request, counter, f.products.serum);
    expect(view.sites[0]).toMatchObject({ RETAIL: "4", WAREHOUSE: "15" });
  });

  test("an empty shelf offers the warehouse while billing an appointment", async ({ page, request }) => {
    const payment = await billAppointment(page, request, f.appointments.transfer);
    const add = await addProduct(page, "Hair Wax");
    await expect(add).toContainText("Retail stock unavailable");
    await add.getByRole("button", { name: "Transfer From Warehouse" }).click();
    const transfer = page.locator(".modal").filter({ hasText: "Transfer Stock — Hair Wax" });
    await expect(transfer.locator("#field-toLocation")).toHaveValue("RETAIL");
    await transfer.locator("#field-issuedByStaffId").selectOption({ label: "Amit" });
    await transfer.getByRole("button", { name: "Transfer & Continue" }).click();
    await expect(transfer).toBeHidden();
    await expect(page.getByText("Hair Wax").first()).toBeVisible();

    await page.getByRole("button", { name: /Pay Now/ }).click();
    await expect(payment).toBeVisible();
    await payment.locator(".jcp-modal-foot .jcp-pay").click();
    await expect(page.getByRole("button", { name: /Open Invoice/ })).toBeVisible();

    const history = await api(request, counter, "GET", `/api/stock-movements/product/${f.products.wax}`);
    expect(history.map((row) => row.type)).toEqual(["RETAIL_SALE", "TRANSFER", "STOCK_IN"]);
    expect(history[1]).toMatchObject({ location: "WAREHOUSE", toLocation: "RETAIL", staff: { name: "Amit" } });
    expect(history[0]).toMatchObject({ location: "RETAIL" });
  });
});

// The one real sign-in: the login form, then the pages an admin uses daily.
test("signing in loads the existing screens without errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, f.adminEmail, f.password);
  for (const [path, text] of [
    ["/admin/products", /Shampoo/],
    ["/admin/inventory", /Shampoo/],
    ["/admin/inventory/activity", /Transfer/],
    ["/admin/inventory/low-stock", null],
    ["/admin/inventory/reorder", null],
    ["/job-carts", null],
    ["/billing", null],
    ["/reports/inventory", null],
    ["/reports/audit-trails", null],
    ["/customers", /Asha Rao/],
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Cells, not the hidden <option> entries of the filter dropdowns.
    if (text) await expect(page.getByRole("cell", { name: text }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});
