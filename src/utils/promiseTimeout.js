export class OperationTimeoutError extends Error {
  constructor(message = 'La operación tardó demasiado. Intentá de nuevo.') {
    super(message);
    this.name = 'OperationTimeoutError';
  }
}

export function withTimeout(promise, timeoutMs, message) {
  const durationMs = Number(timeoutMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return Promise.resolve(promise);
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new OperationTimeoutError(message));
    }, durationMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}
