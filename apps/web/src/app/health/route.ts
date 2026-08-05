const health = Object.freeze({ status: "ok", service: "web", version: "0.1.0" });

export function GET(): Response {
  return Response.json(health, { status: 200 });
}
