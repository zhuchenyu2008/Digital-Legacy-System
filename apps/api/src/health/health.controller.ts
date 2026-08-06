import { Controller, Get, Inject } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  public constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get("live")
  public live() {
    return this.health.live();
  }

  @Get("ready")
  public ready() {
    return this.health.ready();
  }
}
