import type { FastifyInstance } from "fastify";

export function registerBinaryBodyParser(server: FastifyInstance): void {
  server.addContentTypeParser("application/octet-stream", (_request, payload, done) =>
    done(null, payload),
  );
}
