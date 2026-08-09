import { Module } from "@nestjs/common";
import { SecurityModule } from "../security/security.module.js";
import { SimulationController } from "./simulation.controller.js";
import { createSimulationRuntime, SIMULATION_RUNTIME } from "./simulation.runtime.js";

@Module({
  imports: [SecurityModule],
  controllers: [SimulationController],
  providers: [{ provide: SIMULATION_RUNTIME, useFactory: createSimulationRuntime }],
})
export class SimulationModule {}
