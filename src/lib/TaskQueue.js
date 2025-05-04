
export class TaskQueue {
  constructor() {
    this._chain = Promise.resolve();
  }

  /**
   * Enqueue an async function (taskFn) that returns a Promise.
   * Returns a Promise that resolves or rejects with taskFn’s result.
   */
  push(taskFn) {
    const next = () => Promise.resolve().then(taskFn);
    // keep the chain alive even if the task rejects
    this._chain = this._chain.then(next, next);
    return this._chain;
  }

  /** Returns a Promise that resolves when the queue is empty. */
  idle() {
    return this._chain;
  }
}

/** Global singleton: single queue for the entire app. */
export const queue = new TaskQueue();
