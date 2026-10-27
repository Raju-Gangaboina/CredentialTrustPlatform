// fetch() wrapper for /api/*. Errors carry .status so the router can react to an expired session.
async function call(method, url, body, isForm) {
  const opts = { method, credentials: 'include' };
  if (body) {
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: url => call('GET', url),
  post: (url, body, isForm) => call('POST', url, body, isForm),
  put: (url, body) => call('PUT', url, body),
  del: url => call('DELETE', url),
};
