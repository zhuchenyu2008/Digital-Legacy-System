const health = Object.freeze({ status: "ok", service: "web" });

export function GET(): Response {
  return Response.json(health, { status: 200 });
}
