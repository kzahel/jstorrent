import { expect, test } from "@playwright/test";

const gateway = process.env.RSTORRENT_FILE_SAFETY_GATEWAY;
const token = process.env.RSTORRENT_LIVE_GATEWAY_TOKEN;

test("file safety explains skips, grants and undoes an override without resuming", async ({
  page,
}) => {
  test.skip(!gateway || !token, "controlled file-safety fixture is opt-in");
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto(
    `/?gateway=${encodeURIComponent(gateway!)}&token=${encodeURIComponent(token!)}`,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Downloads", exact: true }).click();
  const safety = settings.getByRole("group", {
    name: "File safety",
    exact: true,
  });
  await expect(
    safety.getByRole("checkbox", {
      name: "Automatically skip potentially dangerous files",
    }),
  ).toBeChecked();
  await expect(
    safety.getByRole("checkbox", {
      name: "Mark downloaded files as coming from the internet",
    }),
  ).toBeChecked();
  await safety
    .getByRole("combobox", { name: "Files to skip" })
    .selectOption("custom");
  await safety
    .getByRole("textbox", { name: "File extensions" })
    .fill(".exe .dmg .zip");
  await safety
    .getByRole("button", { name: "Save file safety settings" })
    .click();
  await expect(
    safety.getByRole("button", { name: "Save file safety settings" }),
  ).toBeDisabled();
  await expect(
    safety.getByRole("combobox", { name: "Files to skip" }),
  ).toBeEnabled();
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settings).toBeHidden();
  const torrent = page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "safety" });
  await torrent.dblclick();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(
    page.getByText(/Skipped by safety settings.*\.exe/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Download anyway setup.exe", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Undo safety override setup.exe",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.getByText(/Safety override.*\.exe/)).toBeVisible();
  await page
    .getByRole("button", {
      name: "Undo safety override setup.exe",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Download anyway setup.exe",
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("safety-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await torrent.click();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(
    page.getByText(/Skipped by safety settings.*\.exe/),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("safety-phone.png") });
});
