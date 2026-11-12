import { parentPort } from 'node:worker_threads';
import { type WorkerRequest, type WorkerResponse, runTaskInProcess } from './workers';

if (!parentPort) throw new Error('analyze-worker must run as a worker thread');
const port = parentPort;

port.on('message', (req: WorkerRequest) => {
  void (async () => {
    try {
      let last = 0;
      const facts = await runTaskInProcess(req.task, req.ctx, (processed, total) => {
        const now = Date.now();
        if (now - last < 120 && processed !== total) return;
        last = now;
        port.postMessage({
          type: 'progress',
          taskIndex: req.taskIndex,
          processed,
          total,
        } satisfies WorkerResponse);
      });
      port.postMessage({ type: 'done', taskIndex: req.taskIndex, facts } satisfies WorkerResponse);
    } catch (err) {
      port.postMessage({
        type: 'error',
        taskIndex: req.taskIndex,
        message: (err as Error).message,
      } satisfies WorkerResponse);
    }
  })();
});
