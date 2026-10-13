import { datadogRum } from '@datadog/browser-rum';
import { beginOperation, type OperationName } from './operation-lifecycle';
export const startOperation = (name: OperationName, timeoutMs?: number) =>
  beginOperation(datadogRum, name, timeoutMs);
export async function monitorOperation<T>(name: OperationName, run: () => Promise<T>): Promise<T> {
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
