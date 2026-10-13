import { CodeKitEngine } from './engine.js';
import type { HostToKitWorker, KitWorkerToHost } from './protocol.js';
interface UtilityPort {
  on(event: 'message', listener: (event: { data: HostToKitWorker }) => void): void;
  postMessage(message: KitWorkerToHost): void;
}
const port = (process as typeof process & { parentPort?: UtilityPort }).parentPort;
const send = (message: KitWorkerToHost) => {
  if (port) port.postMessage(message);
  else process.send?.(message);
};
const engine = new CodeKitEngine(),
  controllers = new Map<string, AbortController>();
let loading = false;
async function receive(message: HostToKitWorker) {
  if (message.type === 'dispose') {
    for (const controller of controllers.values()) controller.abort();
    engine.dispose();
    process.exit(0);
  }
  if (message.type === 'abort') {
    controllers.get(message.callId)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(message.callId, controller);
  try {
    if (message.type === 'load') {
      if (loading) throw new Error('Kit loading is already in progress');
      loading = true;
      const result = await engine.load(
        message.directory,
        message.manifest,
        message.dependencies,
        message.expectedDigest,
      );
      controller.signal.throwIfAborted();
      send({ type: 'result', callId: message.callId, result });
    } else {
      const result = await engine.invoke(
        message.capabilityId,
        message.input,
        message.context,
        controller.signal,
      );
      send({ type: 'result', callId: message.callId, result });
    }
  } catch (error) {
    send({
      type: 'error',
      callId: message.callId,
      error: error instanceof Error ? error.message.slice(0, 2000) : 'Code Kit operation failed',
    });
  } finally {
    controllers.delete(message.callId);
  }
}
if (port)
  port.on('message', (event) => {
    void receive(event.data);
  });
else
  process.on('message', (message) => {
    void receive(message as HostToKitWorker);
  });
process.on('disconnect', () => {
  engine.dispose();
  process.exit(0);
});
send({ type: 'ready' });
