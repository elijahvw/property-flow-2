import { recordBrowserEvent } from "./browser-telemetry";
import { beginOperation, type OperationName } from "./operation-lifecycle";
// Only closed operation names, outcomes and timings are exported. Never export form values, URLs,
// exception messages, identity or financial details.
const started = new Map<string, number>();
const localOperations = {
  startFeatureOperation(_name: string, options: { operationKey: string }) {
    started.set(options.operationKey, performance.now());
  },
  succeedFeatureOperation(name: string, options: { operationKey: string }) {
    finish(name, "success", options.operationKey);
  },
  failFeatureOperation(
    name: string,
    reason: string,
    options: { operationKey: string },
  ) {
    finish(name, reason, options.operationKey);
  },
};
function finish(name: string, outcome: string, key: string) {
  const start = started.get(key);
  started.delete(key);
  if (start === undefined) return;
  recordBrowserEvent(name, outcome, performance.now() - start);
  performance.measure(`propertyflow:${name}:${outcome}`, {
    start,
    end: performance.now(),
  });
  // Avoid retaining an unbounded browser performance timeline during long sessions.
  if (performance.getEntriesByType("measure").length > 200)
    performance.clearMeasures();
}
export const startOperation = (name: OperationName, timeoutMs?: number) =>
  beginOperation(localOperations, name, timeoutMs);
export async function monitorOperation<T>(
  name: OperationName,
  run: () => Promise<T>,
): Promise<T> {
  const operation = startOperation(name);
  try {
    const value = await run();
    operation.succeed();
    return value;
  } catch (error) {
    operation.fail(error);
    throw error;
  }
}
