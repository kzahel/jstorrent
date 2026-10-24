import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const gateway = process.env.RSTORRENT_WEB_AUTH_E2E_URL;
const phase = process.env.RSTORRENT_WEB_AUTH_E2E_PHASE;

test("local-open setup admits another browser without a session cookie", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  test.skip(
    gateway === undefined || phase !== "local-open",
    "controlled browser-auth local-open setup is opt-in",
  );

  const owner = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const ownerPage = await owner.newPage();
    await ownerPage.goto(liveUrl());
    await expect(
      ownerPage.getByRole("heading", { name: "Choose web access" }),
    ).toBeVisible();
    await ownerPage
      .getByRole("button", { name: /Keep localhost open/ })
      .click();
    await expectApplication(ownerPage);
    await expectNoSessionCookie(owner);

    const guestPage = await guest.newPage();
    await guestPage.goto(liveUrl());
    await expectApplication(guestPage);
    await expectNoSessionCookie(guest);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test("local-open policy survives restart", async ({ context, page }) => {
  test.setTimeout(60_000);
  test.skip(
    gateway === undefined || phase !== "local-open-restart",
    "controlled browser-auth local-open restart is opt-in",
  );

  await page.goto(liveUrl());
  await expectApplication(page);
  await expectNoSessionCookie(context);
});

test("fresh profile pairs a second browser and revokes it", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  test.skip(
    gateway === undefined || phase !== "onboarding",
    "controlled browser-auth onboarding is opt-in",
  );

  const owner = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const ownerPage = await owner.newPage();
    await ownerPage.goto(liveUrl());
    await expect(
      ownerPage.getByRole("heading", { name: "Choose web access" }),
    ).toBeVisible();
    await ownerPage
      .getByRole("button", { name: /Remember this browser/ })
      .click();
    await expectApplication(ownerPage);
    await expectSessionCookie(owner);

    await ownerPage.getByRole("button", { name: "Settings", exact: true }).click();
    const ownerSettings = ownerPage.getByRole("dialog", { name: "Settings" });
    await ownerSettings.getByRole("tab", { name: "Web access" }).click();
    await ownerSettings.getByRole("button", { name: "Generate code" }).click();
    const codeText = await ownerSettings
      .getByLabel(/^Pairing code /)
      .getAttribute("aria-label");
    const code = codeText?.replace(/\D/g, "") ?? "";
    expect(code).toMatch(/^\d{4}$/);

    const guestPage = await guest.newPage();
    await guestPage.goto(liveUrl());
    await expect(
      guestPage.getByRole("heading", {
        name: "This browser is not approved",
      }),
    ).toBeVisible();
    await guestPage.getByLabel("Four-digit code").fill(code);
    await guestPage.getByRole("button", { name: "Authorize browser" }).click();
    await expectApplication(guestPage);
    await expectSessionCookie(guest);

    await ownerPage.getByRole("button", { name: "Close settings" }).click();
    await ownerPage.getByRole("button", { name: "Settings", exact: true }).click();
    const refreshedSettings = ownerPage.getByRole("dialog", { name: "Settings" });
    await refreshedSettings.getByRole("tab", { name: "Web access" }).click();
    await expect(refreshedSettings.getByText("2 of 32 remembered sessions")).toBeVisible();
    ownerPage.once("dialog", (dialog) => void dialog.accept());
    await refreshedSettings
      .getByRole("button", { name: "Revoke all others" })
      .click();
    await expect(refreshedSettings.getByText("Revoked 1 other browser.")).toBeVisible();

    await guestPage.reload();
    await expect(
      guestPage.getByRole("heading", {
        name: "This browser is not approved",
      }),
    ).toBeVisible();
  } finally {
    await owner.close();
    await guest.close();
  }
});

test("explicit restart recovery approves one cookie-less browser", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(
    gateway === undefined || phase !== "recovery",
    "controlled browser-auth recovery is opt-in",
  );

  await page.goto(liveUrl());
  await expect(
    page.getByRole("heading", { name: "Approve this browser" }),
  ).toBeVisible();
  await expect(page.getByText(/first approval consumes it/i)).toBeVisible();
  await page.getByRole("button", { name: "Approve this browser" }).click();
  await expectApplication(page);
  await expectSessionCookie(context);

  const lateBrowser = await browser.newContext();
  try {
    const latePage = await lateBrowser.newPage();
    await latePage.goto(liveUrl());
    await expect(
      latePage.getByRole("heading", {
        name: "This browser is not approved",
      }),
    ).toBeVisible();
  } finally {
    await lateBrowser.close();
  }
});

async function expectApplication(page: Page): Promise<void> {
  await expect(page.getByRole("grid", { name: "Torrents" })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectSessionCookie(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies(gateway);
  const session = cookies.find((cookie) => cookie.name === "rstorrent_web_session");
  expect(session).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  });
}

async function expectNoSessionCookie(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies(gateway);
  expect(
    cookies.some((cookie) => cookie.name === "rstorrent_web_session"),
  ).toBe(false);
}

function liveUrl(): string {
  return `${gateway}/`;
}
