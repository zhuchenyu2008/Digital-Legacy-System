import { Readable } from "node:stream";
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { PUBLIC_RUNTIME, type PublicDownload, type PublicRuntime } from "./public.runtime.js";

export function parseSingleByteRange(
  value: string | undefined,
): Readonly<{ start: number; endInclusive?: number }> | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(0|[1-9]\d*)-(?:(0|[1-9]\d*))?$/u.exec(value.trim());
  if (match === null) throw new HttpException("only one explicit byte range is supported", 416);
  const start = Number(match[1]);
  const end = match[2] === undefined ? undefined : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < start))
  ) {
    throw new HttpException("byte range is invalid", 416);
  }
  return end === undefined ? { start } : { start, endInclusive: end };
}

@ApiTags("Public legacy")
@Controller("public")
export class PublicController {
  public constructor(@Inject(PUBLIC_RUNTIME) private readonly runtime: PublicRuntime) {}

  @Get("legacy")
  @ApiOperation({ summary: "Read the committed public digital legacy" })
  @ApiResponse({ status: 200, description: "Committed publication metadata and sanitized will" })
  @ApiResponse({ status: 404, description: "No committed publication" })
  public async publication() {
    const publication = await this.runtime.publication();
    if (publication === null) throw new NotFoundException("digital legacy is not published");
    return publication;
  }

  @Get("legacy/audit")
  @ApiOperation({ summary: "Read the immutable public publication audit chain" })
  @ApiResponse({ status: 200, description: "Ordered public audit events" })
  @ApiResponse({ status: 404, description: "No committed publication" })
  public async audit() {
    const audit = await this.runtime.audit();
    if (audit === null) throw new NotFoundException("digital legacy is not published");
    return audit;
  }

  @Get("legacy/package")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Download the committed immutable legacy ZIP" })
  @ApiHeader({ name: "range", required: false, description: "One bytes=start-end range" })
  @ApiProduces("application/zip")
  @ApiResponse({ status: 200, description: "Complete ZIP" })
  @ApiResponse({ status: 206, description: "Single byte range" })
  @ApiResponse({ status: 416, description: "Invalid or unsatisfiable range" })
  public async download(
    @Headers("range") rangeHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const range = parseSingleByteRange(rangeHeader);
    let opened: PublicDownload;
    try {
      opened = await this.runtime.download(range);
    } catch (error) {
      if (error instanceof RangeError) {
        reply.header("content-range", "bytes */*");
        throw new HttpException("byte range is unsatisfiable", 416);
      }
      throw error;
    }
    const partial = range !== undefined;
    reply.status(partial ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
    reply.header("accept-ranges", "bytes");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("content-disposition", 'attachment; filename="digital-legacy.zip"');
    reply.header("content-length", String(opened.bytes));
    reply.header("etag", `"${opened.sha256}"`);
    reply.header("x-content-type-options", "nosniff");
    if (partial) {
      const start = range.start;
      reply.header(
        "content-range",
        `bytes ${start}-${start + opened.bytes - 1}/${opened.totalBytes}`,
      );
    }
    return new StreamableFile(Readable.from(opened.body), { type: "application/zip" });
  }
}
