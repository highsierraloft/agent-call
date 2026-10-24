import { test, expect } from "@playwright/test";
import { installFixture } from "./fixture";

test("reading older calls is not reset by automatic refresh", async ({
  page,
}) => {
  const state = await installFixture(page);
  state.paginate = true;
  await page.clock.install();
  await page.goto("/calls");
  await page.getByRole("button", { name: "Load More", exact: true }).click();
  await expect(page.getByText("Bookshop", { exact: true })).toBeVisible();
  await page.clock.fastForward(16000);
  await expect(page.getByText("Bookshop", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh calls", exact: true })
    .click();
  await expect(page.getByText("Bookshop", { exact: true })).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load More", exact: true }),
  ).toBeVisible();
});

test("call history, readable transcript, notes, and full Markdown download", async ({
  page,
}, info) => {
  await installFixture(page);
  await page.goto("/calls");
  await page.getByRole("button", { name: /Alex Morgan/ }).click();
  await expect(
    page.getByRole("heading", { name: "Alex Morgan" }),
  ).toBeVisible();
  await expect(
    page.getByText("Saturday afternoon works. Can we meet by the park?"),
  ).toBeVisible();
  await expect(page.getByText(/Recording unavailable/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Full Markdown" }).click();
  expect((await download).suggestedFilename()).toBe("transcript.md");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByLabel("Notes", { exact: true }).fill("Natural conversation.");
  await page.getByLabel("Quality tags").fill("Clear voice");
  await page.getByRole("button", { name: "Save Notes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("tab", { name: "Transcript", exact: true }).click();
  await page.screenshot({ path: info.outputPath("calls.png"), fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("personalities share guided and full-text values and preserve edits during practice", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.goto("/personalities");
  await page
    .getByLabel("Personality prompt")
    .fill("Be thoughtful. Ask about the next chess game.");
  await page.getByRole("button", { name: "Full Text Editor" }).click();
  const editor = page.getByLabel("Configuration", { exact: true });
  const json = JSON.parse(await editor.inputValue());
  expect(json.prompt).toContain("chess");
  json.description = "A chess partner";
  await editor.fill(JSON.stringify(json, null, 2));
  await page.getByRole("button", { name: "Guided Editor" }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "A chess partner",
  );
  await page.getByRole("button", { name: "Try in Playground" }).click();
  await expect(page.getByText("Testing unsaved changes")).toBeVisible();
  await page.getByRole("link", { name: "Personalities", exact: true }).click();
  await expect(page.getByLabel("Personality prompt")).toHaveValue(
    "Be thoughtful. Ask about the next chess game.",
  );
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  expect(state.records["profile:warm"].revision).toBe(2);
  expect(state.started).toBe(0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".history-panel summary")
    .filter({ hasText: "Version 1" })
    .click();
  await page
    .getByRole("button", { name: "Restore This Version" })
    .last()
    .click();
  await expect.poll(() => state.records["profile:warm"].revision).toBe(3);
});

test("a conflicting save keeps edits and requires an explicit choice", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.goto("/personalities");
  await page.getByLabel("Personality prompt").fill("My revised tone.");
  state.records["profile:warm"].revision = 2;
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A newer version is available" }),
  ).toBeVisible();
  await expect(page.getByLabel("Personality prompt")).toHaveValue(
    "My revised tone.",
  );
  await page.getByRole("button", { name: "Keep My Edits" }).click();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect.poll(() => state.records["profile:warm"].revision).toBe(3);
});

test("new calls require review and start only on the Call action", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.goto("/calls");
  await page.getByRole("button", { name: "New Call", exact: true }).click();
  await page.getByLabel("Recipient", { exact: true }).fill("Casey");
  await page.getByLabel("Phone number").fill("+1 202 555 0111");
  await page
    .getByLabel("What should the agent achieve?")
    .fill("Invite Casey to play chess.");
  await page.getByRole("button", { name: "Review Call", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review Call" }),
  ).toBeVisible();
  expect(state.prepared).toBe(1);
  expect(state.started).toBe(0);
  await page.getByRole("button", { name: "Call Casey", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "End Call", exact: true }),
  ).toBeVisible();
  expect(state.started).toBe(1);
  await page.getByRole("button", { name: "End Call", exact: true }).click();
  await expect.poll(() => state.ended).toBe(1);
});

test("text practice stays separate from telephone calls and stops cleanly", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.goto("/playground");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Start Text Practice" }).click();
  await page.getByLabel("Practice message", { exact: true }).fill("Hello");
  await page.getByRole("button", { name: "Send practice message" }).click();
  await expect(
    page.getByText("What would you like to talk about?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "End Practice", exact: true }).click();
  await expect.poll(() => state.practiceStops).toBeGreaterThan(0);
  expect(state.started).toBe(0);
});

test("integration saves calling guidance and shows the actual tool contract", async ({
  page,
}, info) => {
  const state = await installFixture(page);
  await page.goto("/integration");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Ask only for missing facts. Return both files.");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect.poll(() => state.records.guide.revision).toBe(2);
  await page.getByRole("tab", { name: "Exposed Tools" }).click();
  await page.getByText("get_calling_setup", { exact: true }).click();
  await expect(
    page.getByText("Read the current guide and available profiles."),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("integration.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("compact layout and keyboard focus remain usable at a narrow zoom-equivalent width", async ({
  page,
}) => {
  await installFixture(page);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/calls");
  await expect(
    page.getByRole("link", { name: "Calls", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await page.getByRole("button", { name: /Alex Morgan/ }).click();
  await expect(
    page.getByRole("heading", { name: "Alex Morgan" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Calls", exact: true }).click();
  await expect(
    page.getByPlaceholder("Search calls and transcripts"),
  ).toBeVisible();
});

test("microphone denial does not reserve practice capacity or dial", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.addInitScript(() => {
    (window as any).__micRequests = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          (window as any).__micRequests++;
          throw new DOMException(
            "Microphone permission denied for this test",
            "NotAllowedError",
          );
        },
      },
    });
  });
  await page.goto("/playground");
  await page
    .getByRole("button", { name: "Start Voice Practice", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.practiceStarts).toBe(0);
  expect(
    await page.evaluate(() => (window as any).__micRequests),
  ).toBeGreaterThan(0);
  expect(state.started).toBe(0);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("voice practice connects with local audio and releases its microphone", async ({
  page,
}) => {
  const state = await installFixture(page);
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://"))
      remoteRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    (window as any).__practiceTracks = tracks;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        getSupportedConstraints: () => ({}),
        enumerateDevices: async () => [
          {
            kind: "audioinput",
            deviceId: "synthetic",
            groupId: "test",
            label: "Synthetic microphone",
            toJSON() {
              return {};
            },
          },
        ],
        getUserMedia: async () => {
          const context = new AudioContext({ sampleRate: 16000 });
          const stream = context.createMediaStreamDestination().stream;
          for (const track of stream.getTracks()) {
            tracks.push(track);
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              void context.close();
            };
          }
          return stream;
        },
      },
    });
  });
  const { ProtobufFrameSerializer } =
    await import("@pipecat-ai/websocket-transport");
  const serializer = new ProtobufFrameSerializer();
  let connected = false;
  await page.routeWebSocket("**/admin/api/practice/*/audio", (socket) => {
    connected = true;
    state.onPracticeStop = () => socket.close({ code: 1000 });
    socket.onMessage(() => {
      state.practice.state = "connected";
      socket.send(
        Buffer.from(
          serializer.serializeMessage({
            label: "rtvi-ai",
            type: "bot-ready",
            id: "test",
            data: { version: "2.0.0" },
          }),
        ),
      );
    });
  });
  await page.goto("/playground");
  await page
    .getByRole("button", { name: "Start Voice Practice", exact: true })
    .click();
  await expect.poll(() => connected).toBe(true);
  await expect(
    page.getByRole("button", { name: "End Practice", exact: true }),
  ).toBeEnabled();
  expect(remoteRequests).toEqual([]);
  await page.getByRole("button", { name: "End Practice", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start Voice Practice", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as any).__practiceTracks.every(
        (t: MediaStreamTrack) => t.readyState === "ended",
      ),
    ),
  ).toBe(true);
  expect(state.started).toBe(0);
  expect(state.practiceStops).toBeGreaterThan(0);
  await expect(page.getByRole("alert")).not.toBeVisible();
});
