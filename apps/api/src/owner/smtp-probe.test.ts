import { once } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { SmtpProbe, smtpTransportSettings } from "./smtp-probe.js";

describe("SMTP probe configuration", () => {
  it("accepts the local Mailpit transport and never exposes credentials", () => {
    expect(smtpTransportSettings("smtp://user:secret@mailpit:1025", "test")).toEqual({
      host: "mailpit",
      port: 1025,
      secure: false,
      startTls: false,
      username: "user",
      password: "secret",
    });
  });

  it("performs STARTTLS on production port 587 before sending the test message", async () => {
    const server = createServer((socket) => {
      let body = "";
      let dataMode = false;
      socket.write("220 fake.smtp.test ESMTP\r\n");
      socket.on("data", (chunk) => {
        body += chunk.toString("utf8");
        while (body.includes("\r\n")) {
          const boundary = body.indexOf("\r\n");
          const line = body.slice(0, boundary);
          body = body.slice(boundary + 2);
          if (dataMode) {
            if (line === ".") {
              dataMode = false;
              socket.write("250 2.0.0 queued\r\n");
            }
            continue;
          }
          if (/^EHLO /u.test(line)) {
            socket.write("250-fake.smtp.test\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n");
          } else if (line === "STARTTLS") {
            socket.write("220 2.0.0 ready\r\n");
          } else if (/^MAIL FROM:/u.test(line) || /^RCPT TO:/u.test(line)) {
            socket.write("250 2.0.0 ok\r\n");
          } else if (line === "DATA") {
            dataMode = true;
            socket.write("354 3.0.0 end with dot\r\n");
          } else if (line === "QUIT") {
            socket.write("221 2.0.0 bye\r\n");
            socket.end();
          }
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("test SMTP server did not bind");

    try {
      const settings = {
        host: "127.0.0.1",
        port: address.port,
        secure: false,
        startTls: true,
      } as const;
      const probe = new SmtpProbe(settings, "Digital Legacy System <no-reply@dls.local>", {
        upgradeToTls: async (socket) => socket as never,
      });
      await expect(probe.send("owner@example.com")).resolves.toMatchObject({ status: "SUCCESS" });
    } finally {
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });
});
