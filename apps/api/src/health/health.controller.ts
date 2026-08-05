import { Controller, Get } from "@nestjs/common";
import type { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  @Get("live")
  public live() {
    return this.health.live();
  }

  @Get("ready")
  public ready() {
    return this.health.ready();
  }
}
