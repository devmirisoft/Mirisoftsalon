import { withPage } from "./_verify.mjs";
withPage(async (page, { OUT }) => {
  await page.goto("http://localhost:5174/job-carts/create", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Set date/time explicitly (today, current time) then open modal.
  const dateInput = page.locator('input[type="date"]').first();
  const timeInput = page.locator('input[type="time"]').first();
  console.log("date inputs:", await page.locator('input[type="date"]').count());
  console.log("time inputs:", await page.locator('input[type="time"]').count());

  await page.locator('button:has-text("+ Service")').first().click();
  await page.waitForTimeout(800);
  const staffSelect = page.locator(".modal-body select").nth(1);
  const optionsBefore = await staffSelect.locator("option").allTextContents();
  console.log("staff options (empty cart):", JSON.stringify(optionsBefore));

  // Check one service, close, reopen to see if staff list updates once cart non-empty.
  const firstCb = page.locator(".modal-body label:has(input[type=checkbox])").first();
  await firstCb.locator("input[type=checkbox]").click();
  await page.waitForTimeout(2000); // allow slots fetch
  const optionsAfter = await staffSelect.locator("option").allTextContents();
  console.log("staff options (1 in cart, after wait):", JSON.stringify(optionsAfter));
  await page.screenshot({ path: `${OUT}/debug2.png` });
});
