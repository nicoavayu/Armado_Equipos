// Reuse the reviewed authentication handlers; credentials remain runtime-only.
export function adapt(handler) {
  return async (request) => {
    const headers = Object.fromEntries(request.headers);
    const url = new URL(request.url);
    headers.host = url.host;
    headers['x-forwarded-host'] = url.host;
    headers['x-forwarded-proto'] = url.protocol.slice(0, -1);
    let body = '';
    if (request.body) {
      const reader = request.body.getReader();
      let length = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) {
          await reader.cancel();
          return new Response('Request body too large', { status: 413, headers: { 'Cache-Control': 'no-store' } });
        }
        chunks.push(value);
      }
      body = new TextDecoder().decode(Buffer.concat(chunks));
    }
    const responseHeaders = new Headers();
    let responseBody = '';
    const response = {
      statusCode: 200,
      setHeader(name, value) { responseHeaders.set(name, value); },
      end(value = '') { responseBody = value; },
    };
    await handler({ method: request.method, headers, body }, response);
    return new Response(response.statusCode === 204 ? null : responseBody, {
      status: response.statusCode, headers: responseHeaders,
    });
  };
}
