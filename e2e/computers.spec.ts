import { test, expect } from "@playwright/test";
import { loginAsDefault } from "./helpers";

test("personal Computer settings load without operator privileges", async ({
  page,
}) => {
  test.skip(
    !process.env.MULTICA_COMPUTER_SECRET_KEY,
    "Requires Computer encryption configured in the isolated environment",
  );
  const slug = await loginAsDefault(page);
  await page.goto(`/${slug}/settings?tab=computers`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Your credentials", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Git author name", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Register Computer", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Linux username", { exact: true }),
  ).not.toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
});
