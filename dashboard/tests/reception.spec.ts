import { test, expect, type Page } from "@playwright/test";
import { installFixture } from "./fixture";

test.use({ timezoneId: "Europe/Madrid" });

async function nav(page: Page, label: string) {
  await page.locator(".sidebar").waitFor({ state: "attached" });
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: label, exact: true }).click();
}

async function fixture(page: Page) {
  const state = await installFixture(page);
  const contact = {
    contact_id: "contact_maria",
    revision: 1,
    name: "María",
    background: "Runs a cafe",
    private_note: "Owner-only planning note",
    numbers: [{ phone: "+34614000000", source: "owner", confirmed: true }],
    memory: {
      revision: 1,
      facts: [
        {
          key: "opening",
          text: "Prefers calls in the afternoon",
          evidence_turn_ids: ["t1"],
          source_call_id: "call_demo_1",
          owner_protected: false,
        },
      ],
      removed_keys: [],
    },
    calls: [
      {
        call_id: "call_demo_1",
        state: "completed",
        direction: "inbound",
        created_at: "2026-10-25T10:00:00Z",
        summary: {
          text: "Discussed the cafe's booking needs. A follow-up needs an approved quote.",
          outcome: "incomplete",
        },
        review_state: "done",
      },
    ],
    next_offset: null,
    callbacks: [],
  };
  const extra = {
    contact,
    contactsWritten: 0,
    memoryWrites: 0,
    schedules: [] as any[],
    scheduleRequests: [] as any[],
    acceptance: { passed: false, window_until: null as string | null },
  };
  await page.route("**/admin/api/inbound/**", (route) =>
    route.fulfill({ json: extra.acceptance }),
  );
  await page.route("**/admin/api/contacts**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      if (path.endsWith("/memory")) {
        if (body.expected_revision !== extra.contact.memory.revision)
          return route.fulfill({
            status: 409,
            json: {
              detail: "Contact memory changed. Reload it before saving.",
            },
          });
        extra.memoryWrites++;
        extra.contact.memory = {
          ...extra.contact.memory,
          revision: extra.contact.memory.revision + 1,
          facts: body.facts,
        };
        return route.fulfill({ json: extra.contact.memory });
      }
      extra.contactsWritten++;
      extra.contact = {
        ...extra.contact,
        ...body,
        revision: extra.contact.revision + 1,
        numbers: body.numbers.map((phone: string) => ({
          phone,
          source: "owner",
          confirmed: true,
        })),
      };
      return route.fulfill({ json: extra.contact });
    }
    return route.fulfill({
      json: path.endsWith("/contacts")
        ? { contacts: [extra.contact], next_offset: null }
        : extra.contact,
    });
  });
  await page.route("**/admin/api/callbacks**", async (route) => {
    if (route.request().method() === "PUT") {
      const row = extra.schedules[0],
        body = route.request().postDataJSON();
      row.state = body.action === "cancel" ? "cancelled" : "scheduled";
      if (body.action === "resolve_information")
        row.value = {
          ...row.value,
          needed_information: body.needed_information,
          new_facts: body.new_facts,
        };
      row.revision++;
      return route.fulfill({ json: row });
    }
    return route.fulfill({
      json: { callbacks: extra.schedules, next_offset: null },
    });
  });
  await page.route("**/admin/api/calls/*/callbacks", async (route) => {
    const value = route.request().postDataJSON();
    extra.scheduleRequests.push(value);
    const row = {
      schedule_id: "schedule_demo",
      source_call_id: "call_demo_1",
      revision: 1,
      state: "scheduled",
      destination: value.destination,
      window_start: value.window_start,
      window_end: value.window_end,
      value,
      call_id: null,
      dial_claimed: 0,
      reason: null,
    };
    extra.schedules.push(row);
    return route.fulfill({ json: row });
  });
  return { state, extra };
}

test("grouped sidebar becomes a labeled drawer with keyboard dismissal", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/calls");
  await page.locator(".sidebar").waitFor({ state: "attached" });
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  for (const label of ["Activity", "Agent", "Workspace"])
    await expect(
      drawer.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  await expect(drawer.getByRole("link")).toHaveCount(10);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(menu).toBeFocused();
  await nav(page, "Contacts");
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("business and outbound editing preserve voice settings and show conflicts", async ({
  page,
}) => {
  const { state } = await fixture(page);
  const original = structuredClone(state.records.global.value.voice);
  await page.goto("/settings");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("My reception business");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect
    .poll(() => state.records.business.value.name)
    .toBe("My reception business");
  await nav(page, "Outbound");
  await page
    .getByRole("textbox", { name: "Conversation instructions", exact: true })
    .fill("Ask one useful question and follow the approved task.");
  state.records.global.revision++;
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(
    page.getByRole("textbox", {
      name: "Conversation instructions",
      exact: true,
    }),
  ).toHaveValue("Ask one useful question and follow the approved task.");
  expect(state.records.global.value.voice).toEqual(original);
});

test("inbound drafts enter practice without enabling reception or changing contacts", async ({
  page,
}, info) => {
  const { state, extra } = await fixture(page);
  await page.goto("/inbound");
  await expect(page.getByText("Answering Off", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Reception instructions", exact: true })
    .fill("Ask what the caller needs and learn the useful missing details.");
  await page.screenshot({
    path: info.outputPath("inbound.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Try in Playground", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Call direction", exact: true }),
  ).toHaveValue("inbound");
  await page
    .getByRole("combobox", { name: "Caller context", exact: true })
    .selectOption("contact_maria");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page
    .getByRole("button", { name: "Start Text Practice", exact: true })
    .click();
  expect(state.practiceRequest.context.direction).toBe("inbound");
  expect(state.practiceRequest.overrides.inbound.instructions).toContain(
    "useful missing details",
  );
  expect(state.practiceRequest.overrides.simulation_contact_id).toBe(
    "contact_maria",
  );
  expect(state.records.inbound.value.enabled).toBe(false);
  expect(extra.contactsWritten).toBe(0);
  expect(extra.memoryWrites).toBe(0);
  expect(state.started).toBe(0);
});

test("contact history keeps recordings linked and memory conflicts retain edits", async ({
  page,
}, info) => {
  const { extra } = await fixture(page);
  await page.goto("/contacts/contact_maria");
  await expect(
    page.getByText(/Discussed the cafe's booking needs/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Open Transcript & Recording",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading contacts…", { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("contact-history.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Fact 1", exact: true })
    .fill("Prefers mornings now.");
  extra.contact.memory.revision = 2;
  await page.getByRole("button", { name: "Save Memory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("memory changed");
  await expect(
    page.getByRole("textbox", { name: "Fact 1", exact: true }),
  ).toHaveValue("Prefers mornings now.");
  expect(extra.memoryWrites).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("callback creation requires review and sends the device timezone's actual offset", async ({
  page,
}, info) => {
  const { state, extra } = await fixture(page);
  await page.goto("/callbacks");
  await page
    .getByRole("button", { name: "Schedule Callback", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Source conversation", exact: true })
    .selectOption("call_demo_1");
  await page
    .getByRole("textbox", { name: "Callback task", exact: true })
    .fill("Discuss the approved quote");
  await page
    .getByLabel("Confirmed number", { exact: true })
    .fill("+34614000000");
  await page
    .getByLabel("Window starts", { exact: true })
    .fill("2026-11-02T10:00");
  await page
    .getByLabel("Window ends", { exact: true })
    .fill("2026-11-02T10:15");
  expect(extra.scheduleRequests).toHaveLength(0);
  await page
    .getByRole("button", { name: "Review Schedule", exact: true })
    .click();
  await expect(
    page.getByText("One automatic dialing attempt.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm Schedule", exact: true })
    .click();
  await expect.poll(() => extra.scheduleRequests.length).toBe(1);
  expect(extra.scheduleRequests[0].window_start).toBe(
    "2026-11-02T10:00:00+01:00",
  );
  expect(extra.scheduleRequests[0].timezone).toBe("Europe/Madrid");
  expect(state.started).toBe(0);
  await expect(
    page.getByRole("button", { name: "Cancel Callback", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("callbacks.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Cancel Callback", exact: true })
    .click();
  await expect.poll(() => extra.schedules[0].state).toBe("cancelled");
});

test("the full-text editor rejects invalid shapes before opening guided controls", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/settings");
  await page.getByLabel("Business name", { exact: true }).waitFor();
  await page.locator(".revision-form .action-menu > summary").click();
  await page
    .getByRole("button", { name: "Full Text Editor", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Configuration JSON", exact: true })
    .fill("[]");
  await page.locator(".revision-form .action-menu > summary").click();
  await page
    .getByRole("button", { name: "Guided Editor", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Correct the JSON");
  await expect(
    page.getByRole("textbox", { name: "Configuration JSON", exact: true }),
  ).toHaveValue("[]");
});

test("saving memory preserves the separate unsaved identity draft", async ({
  page,
}) => {
  const { extra } = await fixture(page);
  await page.goto("/contacts/contact_maria");
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("María draft");
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Fact 1", exact: true })
    .fill("Prefers weekday mornings");
  await page.getByRole("button", { name: "Save Memory", exact: true }).click();
  await expect.poll(() => extra.memoryWrites).toBe(1);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("María draft");
  expect(extra.contactsWritten).toBe(0);
});

test("blocked callbacks require verified answers before release", async ({
  page,
}) => {
  const { extra } = await fixture(page);
  extra.schedules.push({
    schedule_id: "schedule_blocked",
    source_call_id: "call_demo_1",
    revision: 1,
    state: "needs_information",
    destination: "+34614000000",
    window_start: "2026-11-02T10:00:00Z",
    window_end: "2026-11-02T10:15:00Z",
    value: {
      objective: "Discuss the approved quote",
      needed_information: ["Confirm the approved price"],
    },
    dial_claimed: 0,
  });
  await page.goto("/callbacks");
  await expect(
    page.getByRole("button", { name: "Call Now", exact: true }),
  ).toBeDisabled();
  await page
    .getByText("Waiting for required information", { exact: true })
    .click();
  const release = page.getByRole("button", {
    name: "Confirm Answers and Release Callback",
    exact: true,
  });
  await expect(release).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Verified answers", exact: true })
    .fill("The approved price is 20 EUR monthly.");
  await release.click();
  await expect.poll(() => extra.schedules[0].state).toBe("scheduled");
  await expect(
    page.getByRole("button", { name: "Call Now", exact: true }),
  ).toBeEnabled();
});

test("contact drafts survive cancelled navigation and browser back", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/calls");
  await nav(page, "Contacts");
  await page.getByRole("link", { name: /María/ }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Unsaved María");
  page.once("dialog", (dialog) => dialog.dismiss());
  await nav(page, "Calls");
  await expect(page).toHaveURL(/contacts\/contact_maria$/);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Unsaved María");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/contacts\/contact_maria$/);
  page.once("dialog", (dialog) => dialog.accept());
  await nav(page, "Calls");
  await expect(page).toHaveURL(/\/calls$/);
});
