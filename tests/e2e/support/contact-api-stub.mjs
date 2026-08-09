import { createServer } from "node:http";

let confirmAlive = 0;

const workflow = {
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4311");
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/contact/workflows/current") {
    json(response, 200, workflow);
    return;
  }
  if (request.method === "GET" && url.pathname === "/__test/counts") {
    json(response, 200, { confirmAlive });
    return;
  }
  if (request.method === "POST" && url.pathname === "/contact/workflows/workflow-1/confirm-alive") {
    const body = await readJson(request);
    const expected = "我确认陈明仍然健在，并终止本次确认流程";
    if (body.password !== "contact-password-123" || body.confirmationText !== expected) {
      json(response, 400, { code: "DLS-TEST-INVALID", message: "invalid confirmation fixture" });
      return;
    }
    confirmAlive += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    json(response, 200, { data: { cancelled: true, workflowState: "CANCELLED" } }, { "x-request-id": "e2e-alive-1" });
    return;
  }
  json(response, 404, { code: "DLS-TEST-NOT-FOUND", message: "fixture route not found" });
});

server.listen(4311, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
