import type { Harness } from "../harness.js";

export interface AgentStrategy {
  readonly tickIntervalMs: number;
  tick(harness: Harness): Promise<void>;
  shutdown?(harness: Harness): Promise<void>;
}
