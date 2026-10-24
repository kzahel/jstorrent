import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { decryptFragment, parseShortLinkFragment } from "../../../services/link/src/codec";

async function panel(page: Page) {
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Torrents" }).click();
  await page.getByRole("tab", { name: "General" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share torrent" });
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeEnabled();
  return dialog;
}

test("short links opt in, encrypt, copy/share consistently, cache, and remember", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => { (window as any).lastShare = data; } });
  });
  const records: Buffer[] = [];
  await page.route("https://link.jstorrent.com/v1/links", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" } }); return;
    }
    records.push(route.request().postDataBuffer()!);
    await route.fulfill({ status: 201, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ id: String(records.length).padStart(10, "A"), expiresAt: "2099-01-01T00:00:00.000Z" }) });
  });
  let dialog = await panel(page);
  const field = dialog.getByRole("textbox", { name: "Share link" });
  const full = await field.inputValue();
  expect(records).toHaveLength(0);
  const toggle = dialog.getByRole("checkbox", { name: "Short link", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(field).toHaveValue(/^https:\/\/link\.jstorrent\.com\/#/);
  const short = await field.inputValue();
  expect(records).toHaveLength(1);
  const { key } = parseShortLinkFragment(new URL(short).hash);
  expect(await decryptFragment(records[0]!, key)).toBe(full.split("#")[1]);
  await expect(dialog.getByText(/^Expires /)).toBeVisible();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(short);
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  expect(await page.evaluate(() => (window as any).lastShare.url)).toBe(short);
  const firstQr = await dialog.getByRole("img", { name: "QR code for the share link" }).innerHTML();
  await dialog.getByRole("checkbox", { name: "Include my IP address" }).check();
  await expect(field).not.toHaveValue(short);
  await expect(field).toBeEnabled();
  const hinted = await field.inputValue();
  const hintedKey = parseShortLinkFragment(new URL(hinted).hash).key;
  expect(await decryptFragment(records[1]!, hintedKey)).toContain("&x.pe=192.168.1.20:6881");
  expect(await dialog.getByRole("img", { name: "QR code for the share link" }).innerHTML()).not.toBe(firstQr);
  await dialog.getByRole("checkbox", { name: "Include my IP address" }).uncheck();
  await expect(field).toHaveValue(short);
  expect(records).toHaveLength(2);
  await toggle.uncheck(); await expect(field).toHaveValue(full);
  await toggle.check(); await expect(field).toHaveValue(short);
  expect(records).toHaveLength(2);
  const violations = (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(violations).toEqual([]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Share torrent" });
  await expect(dialog.getByRole("checkbox", { name: "Short link", exact: true })).toBeChecked();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(/^https:\/\/link\.jstorrent\.com\/#/);
  expect(records).toHaveLength(3);
});

test("failed creation falls back without retry, and unchecking ignores late results", async ({ page }) => {
  let requests = 0;
  await page.route("https://link.jstorrent.com/v1/links", async route => {
    requests++;
    await route.fulfill({ status: 429, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  let dialog = await panel(page);
  const full = await dialog.getByRole("textbox", { name: "Share link" }).inputValue();
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).check();
  await expect(dialog.getByRole("alert")).toHaveText("Could not create a short link. You can still use the full link.");
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(full);
  await expect(dialog.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).uncheck();
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).check();
  await expect(dialog.getByRole("alert")).toBeVisible(); expect(requests).toBe(1);
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.unroute("https://link.jstorrent.com/v1/links");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://link.jstorrent.com/v1/links", async route => {
    requests++; await held;
    await route.fulfill({ status: 201, headers: { "Access-Control-Allow-Origin": "*" }, contentType: "application/json", body: JSON.stringify({ id: "Late012345", expiresAt: "2099-01-01T00:00:00.000Z" }) });
  });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Share torrent" });
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeEnabled();
  await expect(dialog.getByRole("checkbox", { name: "Short link", exact: true })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).check();
  await expect.poll(() => requests).toBe(2);
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).uncheck();
  release();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(full);
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).check();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toHaveValue(/^https:\/\/link\.jstorrent\.com\/#Late012345\./);
  expect(requests).toBe(2);
});

// Explicitly opt in: this writes two expiring records to the deployed service.
test("live service opens panel links and preserves every rich-link parameter", async ({ page }) => {
  test.skip(process.env.JSTORRENT_LINK_LIVE !== "1", "requires the deployed service");
  let dialog = await panel(page);
  const full = await dialog.getByRole("textbox", { name: "Share link" }).inputValue();
  await dialog.getByRole("checkbox", { name: "Short link", exact: true }).check();
  const field = dialog.getByRole("textbox", { name: "Share link" });
  await expect(field).toHaveValue(/^https:\/\/link\.jstorrent\.com\/#/, { timeout: 20_000 });
  const short = await field.inputValue();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(short);
  await expect(page).toHaveURL(full, { timeout: 20_000 });
  expect(errors).toEqual([]);

  // The existing demo exports no trackers. Exercise a full 32-tracker fragment
  // through the same browser client helper and deployed decrypting page.
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");
  const rich = full + Array.from({ length: 32 }, (_, i) =>
    "&tr=" + encodeURIComponent(`https://tracker${i}.example/announce?pass=abc&x=1`)).join("") +
    "&so=0,2-4&jst.file=Example%20file.mkv&jst.size=1234";
  const result = await page.evaluate(async (fullLink) => {
    const modulePath = "/src/inspection/share-short-link.ts";
    const { createShortLink } = await import(modulePath);
    return createShortLink(fullLink, new AbortController().signal);
  }, rich);
  await page.goto(result.link);
  await expect(page).toHaveURL(rich, { timeout: 20_000 });
  const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(params.getAll("tr")).toHaveLength(32);
  expect(params.get("so")).toBe("0,2-4");
  expect(params.get("jst.file")).toBe("Example file.mkv");
  expect(errors).toEqual([]);
});

test("live open page handles missing, malformed and bare links", async ({ page }) => {
  test.skip(process.env.JSTORRENT_LINK_LIVE !== "1", "requires the deployed service");
  await page.goto("https://link.jstorrent.com/#invalid");
  await expect(page.getByRole("status")).toContainText("invalid, damaged");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.goto("https://link.jstorrent.com/#Absent0000.AAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.getByRole("status")).toContainText("unavailable or has expired");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status")).toContainText("unavailable or has expired");
  await page.goto("https://link.jstorrent.com/");
  await expect(page).toHaveURL("https://jstorrent.com/");
});
