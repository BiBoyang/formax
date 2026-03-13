export function runAsyncSafely(task: Promise<unknown>) {
  void task.catch(() => undefined)
}
