import { notFound } from "next/navigation";
import { nextRuntime } from "../../../config/next-runtime";
import { SimulationConsole } from "../../../features/simulation/simulation-console";

export default function SimulationsPage() {
  if (!nextRuntime().testMode) notFound();
  return <SimulationConsole defaultOwnerEmail="owner+simulation@example.test" />;
}
