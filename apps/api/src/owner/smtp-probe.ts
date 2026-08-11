import { connect as createTcpConnection, type Socket } from "node:net";
import { connect as createTlsConnection, type TLSSocket } from "node:tls";
import type { SmtpProbeResult } from "@dls/application";

type SmtpSocket = Socket | TLSSocket;
type SmtpSettings = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  username?: string;
  password?: string;
}>;

type SmtpProbeTransport = Readonly<{
  upgradeToTls?: (socket: SmtpSocket, settings: SmtpSettings) => Promise<TLSSocket>;
}>;

export function smtpTransportSettings(
  transportUrl: string,
  nodeEnv: "development" | "test" | "production",
): SmtpSettings {
  const url = new URL(transportUrl);
  if (!/[s]mtp:/u.test(url.protocol)) throw new Error("Mail transport must use SMTP or SMTPS");
  const secure = url.protocol === "smtps:";
  if (nodeEnv === "production" && !secure && url.port !== "587") {
    throw new Error("Production SMTP must use SMTPS or STARTTLS port 587");
  }
  const port = url.port === "" ? (secure ? 465 : 587) : Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("SMTP port is invalid");
  const startTls = !secure && port === 587;
  return {
    host: url.hostname,
    port,
    secure,
    startTls,
    ...(url.username === ""
      ? {}
      : { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }),
  };
}

type Response = Readonly<{ code: number; message: string }>;

class SmtpReader {
  #buffer = "";
  #lines: string[] = [];
  #waiters: Array<{ resolve: (value: Response) => void; reject: (error: unknown) => void }> = [];
  #current: string[] = [];
  readonly #onData: (chunk: string) => void;
  readonly #onError: (error: unknown) => void;
  readonly #onClose: () => void;

  public constructor(private readonly socket: SmtpSocket) {
    socket.setEncoding("utf8");
    this.#onData = (chunk: string) => this.push(chunk);
    this.#onError = (error: unknown) => this.fail(error);
    this.#onClose = () => this.fail(new Error("SMTP connection closed"));
    socket.on("data", this.#onData);
    socket.on("error", this.#onError);
    socket.on("close", this.#onClose);
  }

  public read(): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
      this.flush();
    });
  }

  public close(): void {
    this.socket.removeListener("data", this.#onData);
    this.socket.removeListener("error", this.#onError);
    this.socket.removeListener("close", this.#onClose);
  }

  private push(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/gu);
    this.#buffer = lines.pop() ?? "";
    this.#lines.push(...lines);
    this.flush();
  }

  private flush(): void {
    while (this.#waiters.length > 0 && this.#lines.length > 0) {
      const line = this.#lines.shift() ?? "";
      const match = /^(\d{3})([ -])(.*)$/u.exec(line);
      if (match === null) continue;
      const code = Number(match[1]);
      this.#current.push(match[3] ?? "");
      if (match[2] === "-") continue;
      const waiter = this.#waiters.shift();
      waiter?.resolve({ code, message: this.#current.join("\n") });
      this.#current = [];
    }
  }

  private fail(error: unknown): void {
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }
}

function connect(settings: SmtpSettings): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const socket = settings.secure
      ? createTlsConnection({
          host: settings.host,
          port: settings.port,
          servername: settings.host,
          rejectUnauthorized: true,
        })
      : createTcpConnection({ host: settings.host, port: settings.port });
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      resolve(socket);
    });
  });
}

function upgradeToTls(socket: SmtpSocket, settings: SmtpSettings): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = createTlsConnection({
      socket: socket as Socket,
      servername: settings.host,
      rejectUnauthorized: true,
    });
    tlsSocket.setTimeout(10_000, () => tlsSocket.destroy(new Error("SMTP TLS timeout")));
    const onError = (error: unknown) => reject(error);
    tlsSocket.once("error", onError);
    tlsSocket.once("secureConnect", () => {
      tlsSocket.removeListener("error", onError);
      resolve(tlsSocket);
    });
  });
}

async function command(
  socket: SmtpSocket,
  reader: SmtpReader,
  value: string,
  expected: number,
): Promise<Response> {
  socket.write(`${value}\r\n`);
  const response = await reader.read();
  if (Math.floor(response.code / 100) !== expected) throw new Error(`SMTP ${response.code}`);
  return response;
}

function fromAddress(value: string): string {
  const match = /<([^<>@\s]+@[^<>@\s]+)>/u.exec(value);
  return match?.[1] ?? value.trim();
}

export class SmtpProbe {
  public constructor(
    private readonly settings: SmtpSettings,
    private readonly from: string,
    private readonly transport: SmtpProbeTransport = {},
  ) {}

  public async send(to: string): Promise<SmtpProbeResult> {
    let socket: SmtpSocket | undefined;
    let reader: SmtpReader | undefined;
    try {
      socket = await connect(this.settings);
      reader = new SmtpReader(socket);
      await reader.read();
      const ehlo = await command(socket, reader, "EHLO dls.local", 2);
      if (this.settings.startTls) {
        if (!ehlo.message.split("\n").some((line) => line.trim().toUpperCase() === "STARTTLS")) {
          throw new Error("SMTP STARTTLS is not advertised");
        }
        await command(socket, reader, "STARTTLS", 2);
        reader.close();
        socket = await (this.transport.upgradeToTls ?? upgradeToTls)(socket, this.settings);
        reader = new SmtpReader(socket);
        await command(socket, reader, "EHLO dls.local", 2);
      }
      if (this.settings.username !== undefined) {
        const token = Buffer.from(
          `\0${this.settings.username}\0${this.settings.password ?? ""}`,
        ).toString("base64");
        await command(socket, reader, `AUTH PLAIN ${token}`, 2);
      }
      await command(socket, reader, `MAIL FROM:<${fromAddress(this.from)}>`, 2);
      await command(socket, reader, `RCPT TO:<${to}>`, 2);
      socket.write("DATA\r\n");
      const ready = await reader.read();
      if (Math.floor(ready.code / 100) !== 3) throw new Error(`SMTP ${ready.code}`);
      const bodyLines = [
        `From: ${this.from}`,
        `To: ${to}`,
        "Subject: Digital Legacy System SMTP test",
        "Message-ID: <dls-smtp-test@localhost>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This is a connectivity test. It contains no legacy content or key material.",
      ];
      const body = `${bodyLines.map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n")}\r\n.\r\n`;
      socket.write(body);
      const sent = await reader.read();
      await command(socket, reader, "QUIT", 2).catch(() => undefined);
      return {
        status: Math.floor(sent.code / 100) === 2 ? "SUCCESS" : "FAILED",
        smtpStatusClass: sent.code,
      };
    } catch (error) {
      socket?.destroy();
      const code = (error as { code?: unknown } | null)?.code;
      return { status: "FAILED", errorCode: typeof code === "string" ? code : "SMTP_TEMP_FAILURE" };
    } finally {
      reader?.close();
      socket?.end();
    }
  }
}
