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
  await expect(page.getByText("Needs attention")).toBeVisible();
  // scoped to the admin tab strip — the top nav also has a "Markets" link
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Markets" }).click();
  await expect(page).toHaveURL(/admin\/markets/);
});

test("admin sees the Manage tab on a global market; a member doesn't", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.getByRole("link", { name: /Will the Knicks win their next playoff series/i }).first().click();
  await page.waitForURL(/markets\//);

  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(page.getByText(/Market management/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Close betting now/i })).toBeVisible();
  const marketUrl = page.url();

  await signIn(page, memberEmail);
  await page.goto(marketUrl);
  await expect(page.getByRole("tab", { name: "Manage" })).toHaveCount(0);
  await expect(page.getByText(/Market management/i)).toHaveCount(0);
});

test("admin edits a bet-free market inline from its public page", async ({ page }) => {
  const stamp = Date.now();
  const title = `Smoke edit market ${stamp}?`;

  // create & open a fresh market so the edit window (no bets yet) is open
  await signIn(page, adminEmail);
  await page.goto("/admin/markets/new");
  await page.getByLabel("Question").fill(title);
  await page.getByLabel("Category").fill("Smoke");
  await page.getByLabel(/Description/).fill("Created by the smoke suite to test inline editing.");
  await page.getByLabel("Resolution source").fill("Smoke suite");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(page.getByText(/Market created/i)).toBeVisible();

  // edit it from the public market page via the Manage tab
  await page.goto("/dashboard");
  await page.getByRole("link", { name: title }).first().click();
  await page.waitForURL(/markets\//);
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.locator("summary", { hasText: /Edit market/i }).click();
  const renamed = `${title.slice(0, -1)} (edited)?`;
  await page.locator('input[name="title"]').fill(renamed);
  await page.getByRole("button", { name: "Save market", exact: true }).click();
  await expect(page.getByText(/Market updated/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
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

  // the achievements section links to the full list (all 8 defs, earned or locked)
  await page.getByRole("link", { name: /All achievements/i }).click();
  await page.waitForURL(/\/u\/alex\/achievements/);
  await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  await expect(page.getByText(/of 8 earned/i)).toBeVisible();
  await expect(page.getByText("First Blood")).toBeVisible();
  await expect(page.getByText("Centurion")).toBeVisible();
});

test("gems show in the nav balance dropdown", async ({ page }) => {
  await signIn(page, memberEmail);
  // the balance chip is a dropdown; the gems row links to the store
  await page.getByTitle(/Your balances|allowance is in/i).click();
  const gemsRow = page.getByRole("link", { name: /Gems/i });
  await expect(gemsRow).toBeVisible();
  await gemsRow.click();
  await page.waitForURL(/store/);
  await expect(page.getByRole("heading", { name: "Store" })).toBeVisible();
});

test("store: buy a badge, equip it in the locker, see it on the leaderboard", async ({ page }) => {
  await signIn(page, memberEmail);

  // buy the Dice badge unless a previous run already owns it (one per user)
  await page.goto("/store");
  const diceCard = page
    .locator("div.rounded-xl", { has: page.getByText("Dice", { exact: true }) })
    .first();
  const buyButton = diceCard.getByRole("button", { name: /Buy · 75/ });
  if (await buyButton.isVisible().catch(() => false)) {
    await buyButton.click();
    await expect(page.getByText(/It's yours/i)).toBeVisible();
  } else {
    await expect(diceCard.getByRole("link", { name: /Owned/i })).toBeVisible();
  }

  // equip it from the account locker (skip if already equipped)
  await page.goto("/account");
  const diceTile = page
    .locator("div.rounded-xl", { has: page.getByText("Dice", { exact: true }) })
    .first();
  const equip = diceTile.getByRole("button", { name: "Equip", exact: true });
  if (await equip.isVisible().catch(() => false)) {
    await equip.click();
    await expect(page.getByText(/Equipped\./i)).toBeVisible();
  } else {
    await expect(diceTile.getByRole("button", { name: "Unequip" })).toBeVisible();
  }

  // the badge glyph renders next to Alex's name on the leaderboard
  await page.goto("/leaderboard");
  await expect(page.getByLabel(/Alex's badge/).first()).toBeVisible();
  await expect(page.getByLabel(/Alex's badge/).first()).toHaveText("🎲");
});

test("admin authors a frame, grants it, and the member can equip it", async ({ page, browser, baseURL }) => {
  const stamp = Date.now();
  const itemName = `E2E Frame ${stamp}`;

  // admin creates the item with the structured editor (live preview visible)
  await signIn(page, adminEmail);
  await page.goto("/admin/items/new");
  await page.getByLabel("Slug").fill(`e2e-frame-${stamp}`);
  await page.getByLabel("Name", { exact: true }).fill(itemName);
  await page.getByLabel("Description").fill("Created by the smoke suite.");
  await expect(page.getByText("Live preview")).toBeVisible();
  await page.getByRole("button", { name: "Create item" }).click();
  await page.waitForURL(/admin\/items\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { name: itemName })).toBeVisible();

  // grant it to Alex from the item page
  await page.getByLabel(/Grant to a member/i).selectOption({ label: "Alex" });
  await page.getByRole("button", { name: "Grant" }).click();
  await expect(page.getByText(/it's in their locker/i)).toBeVisible();

  // Alex equips it from the account locker
  const context = await browser.newContext({ baseURL: baseURL! });
  const memberPage = await context.newPage();
  await signIn(memberPage, memberEmail);
  await memberPage.goto("/account");
  const tile = memberPage
    .locator("div.rounded-xl", { has: memberPage.getByText(itemName, { exact: true }) })
    .first();
  await tile.getByRole("button", { name: "Equip", exact: true }).click();
  await expect(memberPage.getByText(/Equipped\./i)).toBeVisible();
  await expect(tile.getByRole("button", { name: "Unequip" })).toBeVisible();
  await context.close();
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

test("leagues: in-app invite and shareable join link", async ({ page, browser, baseURL }) => {
  const stamp = Date.now();
  const name = `Invite League ${stamp}`;

  // alex creates a league and invites Blair from settings
  await signIn(page, memberEmail);
  await page.goto("/leagues");
  await page.getByLabel("League name").fill(name);
  await page.getByRole("button", { name: "Create league" }).click();
  await page.waitForURL(/\/l\/invite-league/);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Invite a member").selectOption({ label: "Blair (@blair)" });
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText(/Invite sent/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  const code = (await page.locator("code").first().textContent())?.trim().replace("-", "") ?? "";

  // blair sees the invite on /leagues and accepts, landing in the league
  const blairContext = await browser.newContext({ baseURL: baseURL! });
  const blairPage = await blairContext.newPage();
  await signIn(blairPage, "blair@prollymarket.local");
  await blairPage.goto("/leagues");
  await expect(blairPage.getByText(/Invites for you/i)).toBeVisible();
  await expect(blairPage.getByText(name)).toBeVisible();
  await blairPage.getByRole("button", { name: "Accept" }).click();
  await blairPage.waitForURL(/\/l\/invite-league/);
  await expect(blairPage.getByRole("heading", { name })).toBeVisible();
  await blairContext.close();

  // casey uses the share link signed OUT: bounced to sign-in, lands back on
  // the confirm page after logging in (callbackUrl round-trip), then joins
  const caseyContext = await browser.newContext({ baseURL: baseURL! });
  const caseyPage = await caseyContext.newPage();
  await caseyPage.goto(`/join/${code}`);
  await caseyPage.waitForURL(/sign-in/);
  await caseyPage.getByLabel("Email").fill("casey@prollymarket.local");
  await caseyPage.getByLabel("Password").fill(password);
  await caseyPage.getByRole("button", { name: "Sign in" }).click();
  await caseyPage.waitForURL(new RegExp(`/join/${code}`));
  await expect(caseyPage.getByText(/You're invited to/i)).toBeVisible();
  await caseyPage.getByRole("button", { name: `Join ${name}` }).click();
  await caseyPage.waitForURL(/\/l\/invite-league/);
  await expect(caseyPage.getByRole("heading", { name })).toBeVisible();
  await caseyContext.close();

  // a rotated code turns the old link into the friendly dead-end (wait for
  // the displayed code to change — navigating too early aborts the action)
  await page.getByRole("button", { name: "Rotate" }).click();
  await expect(page.locator("code").first()).not.toHaveText(`${code.slice(0, 4)}-${code.slice(4)}`);
  await page.goto(`/join/${code}`);
  await expect(page.getByText(/isn't valid anymore/i)).toBeVisible();
});

test("feedback: member sends it from the user menu, admin triages it", async ({ page }) => {
  const message = `Smoke feedback ${Date.now()}`;

  // alex sends feedback from the avatar menu on the dashboard
  await signIn(page, memberEmail);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByPlaceholder(/What's broken/i).fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Feedback sent/i)).toBeVisible();

  // the triage page shows it with the captured path
  await signIn(page, adminEmail);
  await page.goto("/admin/feedback");
  const row = page.locator("div.p-4", { has: page.getByText(message) }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText(/on \/dashboard/)).toBeVisible();

  // resolve it: the row moves into the collapsed Resolved section with a Reopen button
  // (scoped to this test's message — other runs may have left rows behind)
  await row.getByRole("button", { name: "Resolve" }).click();
  const resolvedSection = page.locator("details", { has: page.locator("summary", { hasText: /Resolved/ }) });
  await resolvedSection.locator("summary").click();
  const resolvedRow = resolvedSection.locator("div.p-4", { has: page.getByText(message) }).first();
  await expect(resolvedRow).toBeVisible();
  await expect(resolvedRow.getByRole("button", { name: "Reopen" })).toBeVisible();
});
