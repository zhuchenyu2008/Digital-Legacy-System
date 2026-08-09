import { createServer } from "node:http";

let confirmAlive = 0;
let scenario = "contact";

const contacts = [
  { id: "contact-1", displayName: "张伟", email: "zhang.wei@example.com", status: "ACTIVE", consentVersion: "1" },
  { id: "contact-2", displayName: "王芳", email: "wang.fang@example.com", status: "ACTIVE", consentVersion: "1" },
  { id: "contact-3", displayName: "李强", email: "li.qiang@example.com", status: "ACTIVE", consentVersion: "1" },
];

const contactWorkflow = {
  workflowId: "workflow-1",
  kind: "DEATH_CONFIRMATION",
  state: "AWAITING_CONFIRMATIONS",
  ownerDisplayName: "陈明",
  startedAt: "2026-08-09T06:00:00.000Z",
  expiresAt: null,
  approvedCount: 1,
  requiredCount: 2,
  decisionAlreadyMade: false,
  legalNextActions: ["CONFIRM_DEATH", "CONFIRM_ALIVE"],
  share: {
    generationId: "generation-1",
    shareIndex: 1,
    protocolVersion: 1,
    ciphertext: "not-used-by-alive-confirmation",
    commitment: "not-used-by-alive-confirmation",
  },
  ingress: { purpose: "DEATH", version: 4, publicKey: "not-used-by-alive-confirmation" },
};

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
}

function ownerWorkflow() {
  if (scenario !== "release") return null;
  return {
    workflowId: "00000000-0000-0000-0000-000000000601",
    state: "RELEASE_PENDING",
    releaseAt: "2026-08-10T06:00:00.000Z",
    serverNow: "2026-08-09T06:00:00.000Z",
    publishLockedAt: null,
    approvedCount: 3,
    requiredCount: 3,
  };
}

function publicStatus() {
  if (scenario === "death") {
    return { state: "DEATH_CONFIRMING", approvedCount: 2, requiredCount: 3, serverNow: "2026-08-09T06:00:00.000Z" };
  }
  if (scenario === "release") {
    return { state: "RELEASE_PENDING", approvedCount: 3, requiredCount: 3, releaseAt: "2026-08-10T06:00:00.000Z", serverNow: "2026-08-09T06:00:00.000Z" };
  }
  if (scenario === "legacy") return { state: "RELEASED", serverNow: "2026-08-09T06:00:00.000Z" };
  return { state: "NORMAL", serverNow: "2026-08-09T06:00:00.000Z" };
}

function routeFixture(request, url) {
  if (request.method === "GET" && url.pathname === "/auth/session") {
    if (scenario === "anonymous") return [401, { code: "DLS-AUTH-REQUIRED" }];
    return [200, { data: { authenticated: true, role: "OWNER", actor: { actorId: "00000000-0000-0000-0000-000000000001" } } }];
  }
  if (request.method === "GET" && url.pathname === "/owner/check-in-schedule") {
    return [200, { data: { lastCheckInAt: "2026-08-09T01:30:00.000Z", nextDeadlineAt: "2026-08-12T00:00:00.000Z" } }];
  }
  if (request.method === "GET" && url.pathname === "/owner/settings") {
    return [200, { data: { missedDaysThreshold: 3, timezone: "Asia/Shanghai", settingsVersion: 4, activePackageVersion: 3, smtp: { configured: true } } }];
  }
  if (request.method === "GET" && url.pathname === "/owner/workflows/current") {
    const workflow = ownerWorkflow();
    return workflow === null ? [404, { code: "DLS-NO-ACTIVE-WORKFLOW" }] : [200, { data: workflow }];
  }
  if (request.method === "GET" && url.pathname === "/owner/contacts") return [200, { data: contacts }];
  if (request.method === "GET" && url.pathname === "/owner/packages") {
    return [200, { data: [
      { id: "package-3", versionNo: 3, status: "ACTIVE", ciphertextSha256: "ab".repeat(32), uploadedAt: "2026-08-08T06:00:00.000Z", activatedAt: "2026-08-08T07:00:00.000Z" },
      { id: "package-2", versionNo: 2, status: "SUPERSEDED", ciphertextSha256: "cd".repeat(32), uploadedAt: "2026-08-01T06:00:00.000Z" },
    ] }];
  }
  if (request.method === "GET" && url.pathname === "/owner/audit-events") {
    return [200, { data: { items: [{ sequence: 4, eventId: "event-4", occurredAt: "2026-08-09T06:00:00.000Z", eventType: "OWNER_LOGIN_CHECKIN", actorType: "OWNER", targetType: "owner", targetId: "00000000-0000-0000-0000-000000000001", result: "SUCCESS", requestId: "request-4", eventHash: "abcdef" }], nextCursor: null } }];
  }
  if (request.method === "GET" && url.pathname === "/owner/audit-integrity") {
    return [200, { data: { valid: true, entries: 4, lastSequence: 4, lastHash: "abcdef" } }];
  }
  if (request.method === "GET" && url.pathname === "/owner/system-health") {
    return [200, { data: { serverNow: "2026-08-09T06:00:00.000Z", pendingJobs: 0, categories: [{ code: "database", status: "ok" }, { code: "storage", status: "ok", backend: "local-volume" }, { code: "worker", status: "unknown", lastSeenAt: null }, { code: "deadlineScanner", status: "unknown", lastSeenAt: "2026-08-09T05:55:00.000Z" }, { code: "smtp", status: "ok", lastSeenAt: "2026-08-09T05:58:00.000Z" }] } }];
  }
  if (request.method === "GET" && url.pathname === "/public/status") return [200, { data: publicStatus() }];
  if (request.method === "GET" && url.pathname === "/public/legacy") {
    return [200, { data: { ownerDisplayName: "陈明", publishedAt: "2026-08-09T04:00:00.000Z", willHtml: "<h2>致我最亲爱的人</h2><p>如果你正在阅读这些文字，愿你记得我们共同度过的平静时光。</p><p>请照顾彼此，也请带着善意继续生活。</p>", packageBytes: 12582912, packageSha256: "ef".repeat(32), auditRootHash: "12".repeat(32) } }];
  }
  if (request.method === "GET" && url.pathname === "/public/legacy/audit") {
    return [200, { data: [{ id: "public-1", eventType: "遗产已发布", occurredAt: "2026-08-09T04:00:00.000Z", summary: "公开对象和验证摘要已原子提交。", hash: "34".repeat(32) }] }];
  }
  if (request.method === "GET" && url.pathname === "/setup/status") return [200, { data: { initialized: false } }];
  if (request.method === "GET" && url.pathname === "/contact/workflows/current") return [200, { data: contactWorkflow }];
  return undefined;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4311");
  if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
  if (request.method === "POST" && url.pathname === "/__test/scenario") {
    const body = await readJson(request);
    scenario = String(body.scenario ?? "contact");
    return json(response, 200, { scenario });
  }
  if (request.method === "GET" && url.pathname === "/__test/counts") return json(response, 200, { confirmAlive });
  if (request.method === "POST" && url.pathname === "/contact/workflows/workflow-1/confirm-alive") {
    const body = await readJson(request);
    const expected = "我确认陈明仍然健在，并终止本次确认流程";
    if (body.password !== "contact-password-123" || body.confirmationText !== expected) {
      return json(response, 400, { code: "DLS-TEST-INVALID", message: "invalid confirmation fixture" });
    }
    confirmAlive += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return json(response, 200, { data: { cancelled: true, workflowState: "CANCELLED" } }, { "x-request-id": "e2e-alive-1" });
  }
  const fixture = routeFixture(request, url);
  if (fixture !== undefined) return json(response, fixture[0], fixture[1]);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) {
    await readJson(request).catch(() => ({}));
    return json(response, 200, { data: { accepted: true } }, { "x-request-id": "e2e-mutation-1" });
  }
  return json(response, 404, { code: "DLS-TEST-NOT-FOUND", message: "fixture route not found" });
});

server.listen(4311, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
