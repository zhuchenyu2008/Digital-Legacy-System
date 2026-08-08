import { SessionError } from "@dls/application";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";

type ErrorResponse = Readonly<{
  error: Readonly<{ code: string; message: string; requestId: string; details: unknown }>;
}>;

type ResponseLike = {
  status(code: number): ResponseLike;
  send(body: ErrorResponse): void;
};

@Catch()
export class StableErrorFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const request = host.switchToHttp().getRequest<{ id?: string }>();
    const requestId = request.id ?? "00000000-0000-0000-0000-000000000000";
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof SessionError
          ? exception.status
          : 500;
    const raw = exception instanceof HttpException ? exception.getResponse() : exception;
    const rawRecord =
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const code =
      exception instanceof SessionError
        ? exception.code
        : typeof rawRecord.code === "string"
          ? rawRecord.code
          : status >= 500
            ? "INTERNAL_ERROR"
            : "REQUEST_INVALID";
    const message =
      exception instanceof Error
        ? exception.message
        : typeof rawRecord.message === "string"
          ? rawRecord.message
          : "Request failed";
    response.status(status).send({ error: { code, message, requestId, details: null } });
  }
}
