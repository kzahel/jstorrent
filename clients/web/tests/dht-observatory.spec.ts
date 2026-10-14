import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("DHT observatory teaches normalized and literal routing encodings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=dht-observatory&at=30000&autoplay=0");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Big Buck Bunny" })
    .click();
  await page.getByRole("tab", { name: "DHT" }).click();

  await expect(page.getByRole("heading", { name: "DHT observatory" })).toBeVisible();
  await expect(page.getByText("171", { exact: true })).toBeVisible();
  await expect(page.getByText("25 occupied bands")).toBeVisible();
  await expect(page.getByText("24 shared bits")).toBeVisible();
  await expect(page.getByText("lookup 41")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Normalized shared-prefix depth zero through 31/ }),
  ).toBeVisible();

  const literal = page.getByRole("button", { name: "Buckets · literal" });
  await literal.click();
  await expect(literal).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("img", { name: /Literal engine bucket indices zero through 159/ }),
  ).toBeVisible();
  await expect(page.getByText(/Equal widths describe storage slots/)).toBeVisible();

  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: /Dark/ }).check();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "dark");
  const darkViolations = (
    await new AxeBuilder({ page })
      .include('[aria-label="Session DHT observatory"]')
      .analyze()
  ).violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(darkViolations).toEqual([]);
});

test("DHT observatory keeps the complete normalized explanation on a narrow pane", async ({
  page,
}) => {
  // Narrow layouts open session views from the navigation drawer.
  await page.setViewportSize({ width: 720, height: 820 });
  await page.goto("/?demo=dht-observatory&at=50000&autoplay=0");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("navigation", { name: "Session views" })
    .getByRole("button", { name: "DHT" })
    .click();

  await expect(page.getByText("172", { exact: true })).toBeVisible();
  await expect(page.getByText("39 bits", { exact: true })).toBeVisible();
  await expect(page.getByText(/Depth = 159 − bucket index/)).toBeVisible();
  await expect(page.getByText("No lookup is active.")).toBeVisible();
});
