import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@prollymarket.local";
const memberEmail = process.env.E2E_MEMBER_EMAIL ?? "alex@prollymarket.local";
const password = process.env.E2E_PASSWORD ?? "password123";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard/);
}

test("member can sign in and reach the dashboard", async ({ page }) => {
  await signIn(page, memberEmail);
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("link", { name: /ProllyMarket/i }).first()).toBeVisible();
});

test("member can open a market and place a bet", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.getByRole("link", { name: /Will the Knicks win their next playoff series/i }).first().click();
  await page.waitForURL(/markets\//);

  // both mobile and desktop bet slips are in the DOM — target the visible one
  await page.locator('input[name="amount"]:visible').fill("5");
  await page.locator('button:visible', { hasText: /Bet 5 pts on Yes/i }).click();
  await expect(page.getByText(/You're in — 5 points on Yes/i).first()).toBeVisible();
});

test("member can bet on a multi-outcome market", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.getByRole("link", { name: /Who wins the North London derby/i }).first().click();
  await page.waitForURL(/markets\//);

  // pick a named outcome, then bet on it (labels may carry an emoji prefix)
  await page.locator("button:visible", { hasText: /Draw/ }).first().click();
  await page.locator('input[name="amount"]:visible').fill("5");
  await page.locator("button:visible", { hasText: /Bet 5 pts on .*Draw/i }).click();
  await expect(page.getByText(/You're in — 5 points on .*Draw/i).first()).toBeVisible();
});

test("member can post a comment", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.getByRole("link", { name: /Will the Knicks win their next playoff series/i }).first().click();
  await page.waitForURL(/markets\//);

  await page.getByRole("tab", { name: /Comments/i }).click();
  const body = `Smoke test comment ${Date.now()}`;
  await page.getByPlaceholder(/Add a comment/i).fill(body);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText(body)).toBeVisible();
});

test("admin can reach the control center and see the proposal queue", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /League control center/i })).toBeVisible();
  await page.getByRole("link", { name: /Manage all markets/i }).click();
  await expect(page).toHaveURL(/admin\/markets/);
});

test("leaderboard page loads after sign-in", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.getByRole("link", { name: "Leaderboard" }).first().click();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
});

test("signup lands in the approval queue and cannot log in until approved", async ({ page }) => {
  const stamp = Date.now();
  const email = `newbie-${stamp}@prollymarket.local`;

  await page.goto("/sign-up");
  await page.getByLabel("Display name").fill("Smoke Newbie");
  await page.getByLabel("Username").fill(`newbie-${stamp}`.slice(0, 20));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/You're in the queue/i)).toBeVisible();

  // pending accounts are locked out with a distinct message
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/waiting on admin approval/i)).toBeVisible();

  // admin approves from the members queue
  await signIn(page, adminEmail);
  await page.goto("/admin/members");
  const row = page.getByTestId(`member-row-${email}`);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).not.toBeVisible();

  // now the new member can log in
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/dashboard/);
  await expect(page).toHaveURL(/dashboard/);
});

test("profiles are reachable from the leaderboard and editable from the account page", async ({ page }) => {
  await signIn(page, memberEmail);

  // leaderboard names link to profiles
  await page.goto("/leaderboard");
  await page.getByRole("link", { name: /League Admin/ }).first().click();
  await page.waitForURL(/\/u\/league-admin/);
  await expect(page.getByText("@league-admin")).toBeVisible();
  await expect(page.getByText(/Trophy case/i)).toBeVisible();
  await expect(page.getByText(/No trophies yet/i)).toBeVisible();

  // own profile via the account page, and the bio round-trips
  const bio = `Smoke bio ${Date.now()}`;
  await page.goto("/account");
  await page.getByLabel("Bio").fill(bio);
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText(/Bio updated/i)).toBeVisible();
  await page.getByRole("link", { name: /View your profile/i }).click();
  await page.waitForURL(/\/u\/alex/);
  await expect(page.getByText("@alex")).toBeVisible();
  await expect(page.getByText(bio)).toBeVisible();
});

test("leagues: create one, start a season, and a friend joins by invite code", async ({
  page,
  browser,
  baseURL,
}) => {
  const stamp = Date.now();
  const name = `Smoke League ${stamp}`;

  // alex creates a league from /leagues
  await signIn(page, memberEmail);
  await page.goto("/leagues");
  await page.getByLabel("League name").fill(name);
  await page.getByRole("button", { name: "Create league" }).click();
  await page.waitForURL(/\/l\/smoke-league/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // owner starts a season straight from the overview; the page revalidates
  // into season mode — the stack card is the proof the stacks were dealt
  await page.getByRole("button", { name: "One week" }).click();
  await page.getByRole("button", { name: "Start season" }).click();
  await expect(page.getByText(/Your stack — Season 1/i)).toBeVisible();
  await expect(page.getByText("500 pts").first()).toBeVisible();

  // the invite code lives on the settings tab
  await page.getByRole("link", { name: "Settings" }).click();
  const code = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // blair joins with the code from a separate session
  const context = await browser.newContext({ baseURL: baseURL! });
  const friendPage = await context.newPage();
  await signIn(friendPage, "blair@prollymarket.local");
  await friendPage.goto("/leagues");
  await friendPage.getByLabel("Invite code").fill(code);
  await friendPage.getByRole("button", { name: "Join league" }).click();
  await friendPage.waitForURL(/\/l\/smoke-league/);
  await expect(friendPage.getByRole("heading", { name })).toBeVisible();
  await context.close();
});
