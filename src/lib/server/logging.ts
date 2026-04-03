import type { Handle } from "@sveltejs/kit";
import { isHttpError, isRedirect } from "@sveltejs/kit";

export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip: string;
}

export function createRequestLogger(): Handle {
  return async ({ event, resolve }) => {
    const start = performance.now();
    let response: Response;
    try {
      response = await resolve(event);
    } catch (err) {
      const duration = performance.now() - start;
      let status = 500;
      if (isRedirect(err)) {
        status = err.status;
      } else if (isHttpError(err)) {
        status = err.status;
      }
      const entry: RequestLogEntry = {
        timestamp: new Date().toISOString(),
        method: event.request.method,
        path: event.url.pathname,
        status,
        duration_ms: Math.round(duration * 100) / 100,
        ip: event.getClientAddress(),
      };
      console.log(JSON.stringify(entry));
      throw err;
    }
    const duration = performance.now() - start;

    const entry: RequestLogEntry = {
      timestamp: new Date().toISOString(),
      method: event.request.method,
      path: event.url.pathname,
      status: response.status,
      duration_ms: Math.round(duration * 100) / 100,
      ip: event.getClientAddress(),
    };

    console.log(JSON.stringify(entry));

    return response;
  };
}
