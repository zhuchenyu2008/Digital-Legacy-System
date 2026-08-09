import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AuditIntegrity } from "../audit/audit-integrity";
import { PrivateAuditList } from "../audit/private-audit-list";
import { SystemHealth } from "../health/system-health";
import { LegalDocument } from "./legal-document";
import { clearSensitiveClientState, SupportErrorState } from "./support-error-state";

describe("audit, health, legal, and error support pages", () => {
  test("renders private audit in Beijing time without secret-bearing fields", () => {
    const html = renderToStaticMarkup(
      <>
        <AuditIntegrity
          integrity={{ valid: true, entries: 2, lastSequence: 2, lastHash: "abcdef" }}
        />
        <PrivateAuditList
          initial={{
            items: [
              {
                sequence: 2,
                eventId: "event-2",
                occurredAt: "2026-08-09T06:00:00.000Z",
                eventType: "OWNER_LOGIN_CHECKIN",
                actorType: "OWNER",
                result: "SUCCESS",
                eventHash: "abcdef",
              },
            ],
            nextCursor: null,
          }}
        />
      </>,
    );
    expect(html).toContain("2026-08-09 14:00:00（北京时间）");
    expect(html).toContain("链完整");
    expect(html).not.toMatch(/password|ciphertext|private key|token/iu);
  });

  test("renders categorized health and explicit policy versions without invented legal claims", () => {
    const health = renderToStaticMarkup(
      <SystemHealth
        health={{
          serverNow: "2026-08-09T06:00:00.000Z",
          categories: [
            { code: "database", status: "ok" },
            { code: "storage", status: "unknown", backend: "local-volume" },
            { code: "worker", status: "unknown", lastSeenAt: null },
          ],
          pendingJobs: 0,
        }}
      />,
    );
    expect(health).toContain("数据库");
    expect(health).toContain("本地文件卷");
    expect(health).not.toMatch(/postgresql:\/\/|\\Users\\|password|secret/iu);

    const legal = renderToStaticMarkup(
      <LegalDocument
        kind="legal"
        operatorContact="本地部署管理员"
        version="local-v1.0"
        versionDate="2026-08-09"
      />,
    );
    const privacy = renderToStaticMarkup(
      <LegalDocument
        kind="privacy"
        operatorContact="本地部署管理员"
        version="local-v1.0"
        versionDate="2026-08-09"
      />,
    );
    expect(legal).toContain("不构成法律意见");
    expect(legal).toContain("2026-08-09");
    expect(privacy).toContain("数据最小化");
    expect(privacy).toContain("本地部署管理员");
  });

  test("uses non-enumerating error copy, copies request IDs, and clears sensitive client state", () => {
    const html = renderToStaticMarkup(
      <SupportErrorState code="403" requestId="request-1" retry={() => undefined} />,
    );
    expect(html).toContain("无法访问此页面或资源");
    expect(html).not.toContain("资源存在");
    expect(html).toContain("request-1");

    const fields = [{ value: "owner-secret" }, { value: "contact-secret" }];
    clearSensitiveClientState({ passwordFields: fields, clearCsrf: () => undefined });
    expect(fields).toEqual([{ value: "" }, { value: "" }]);
  });
});
