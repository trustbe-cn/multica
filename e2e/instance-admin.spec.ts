import { test, expect } from "@playwright/test";
import { loginAsDefault } from "./helpers";
import { TestApiClient } from "./fixtures";
import pg from "pg";

test("workspace owner cannot enter instance administration", async ({page})=>{
 await loginAsDefault(page);
 await page.goto("/admin");
 await expect(page.getByRole("alert").filter({hasText:"Only instance administrators"})).toContainText("Only instance administrators");
 const status=await page.evaluate(async()=>{
  const r=await fetch("/api/admin/computers",{headers:{Authorization:`Bearer ${localStorage.getItem("multica_token")}`}});return r.status;
 });
 expect(status).toBe(403);
 await expect(page.getByRole("button",{name:"Register Computer"})).toHaveCount(0);
});

test("instance admin with no workspace can register and disable Computer",async({page})=>{
 test.skip(!process.env.E2E_INSTANCE_ADMIN_EMAIL,"Requires a seeded isolated instance administrator");
 const api=new TestApiClient();
 await api.login(process.env.E2E_INSTANCE_ADMIN_EMAIL!,"Admin E2E");
 expect(await api.getWorkspaces()).toHaveLength(0);
 await page.addInitScript(token=>localStorage.setItem("multica_token",token!),api.getToken());
 await page.goto("/admin");
 const name=`Admin E2E ${Date.now()}`;
 try {
  await expect(page.getByRole("button",{name:"Register Computer"})).toBeVisible();
  await page.getByLabel("Name",{exact:true}).fill(name);
  await page.getByLabel("SSH host",{exact:true}).fill("e2e.invalid");
  await page.getByLabel("SSH operator username",{exact:true}).fill("operator");
  await page.getByRole("button",{name:"Register Computer"}).click();
  const row=page.getByRole("listitem").filter({hasText:`${name} · Enabled`});
  await expect(row).toBeVisible();
  await row.getByRole("button",{name:"Disable",exact:true}).click();
  await expect(page.getByRole("listitem").filter({hasText:`${name} · Disabled`})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Activity log"})).toBeVisible();
 } finally {
  const client=new pg.Client(process.env.DATABASE_URL);await client.connect();
  try {await client.query("DELETE FROM computer_audit WHERE computer_id IN (SELECT id FROM computer WHERE name=$1)",[name]);await client.query("DELETE FROM computer WHERE name=$1",[name]);} finally {await client.end();}
 }
});
