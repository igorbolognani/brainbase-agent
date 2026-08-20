import { describe, expect, it, vi } from 'vitest';
import {
  GatewayDispatchError,
  SafeGatewayDispatcher,
  type PinnedTransportRequest,
  type PinnedTransportResponse,
} from '../safe-gateway-dispatcher.js';

const PUBLIC = '93.184.216.34';

function response(
  status: number,
  headers: Record<string, string> = {},
  body = 'ok'
): PinnedTransportResponse {
  return { status, headers, body: Buffer.from(body) };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('SafeGatewayDispatcher', () => {
  it('dispatches a safe synthetic request using a validated pinned address', async () => {
    const transport = vi.fn(async (request: PinnedTransportRequest) => {
      expect(request.address).toBe(PUBLIC);
      expect(request.url.hostname).toBe('gateway.example.com');
      return response(200, { 'content-type': 'application/json' }, '{"ok":true}');
    });
    const dispatcher = new SafeGatewayDispatcher({}, { resolve: async () => [PUBLIC], transport });

    const result = await dispatcher.dispatch({
      url: 'https://gateway.example.com/v1/test',
      headers: { authorization: 'Bearer opaque-test-value' },
      body: '{}',
    });

    expect(result.status).toBe(200);
    expect(result.redirects).toBe(0);
    expect(result.finalUrl).toBe('https://gateway.example.com/v1/test');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a direct private target before transport', async () => {
    const transport = vi.fn();
    const dispatcher = new SafeGatewayDispatcher(
      {},
      { resolve: async () => ['10.0.0.8'], transport }
    );

    await expectCode(dispatcher.dispatch({ url: 'https://gateway.example.com' }), 'unsafe_address');
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 loopback before transport', async () => {
    const transport = vi.fn();
    const dispatcher = new SafeGatewayDispatcher(
      {},
      { resolve: async () => ['::ffff:127.0.0.1'], transport }
    );

    await expectCode(dispatcher.dispatch({ url: 'https://gateway.example.com' }), 'unsafe_address');
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed when any DNS answer is unsafe', async () => {
    const transport = vi.fn();
    const dispatcher = new SafeGatewayDispatcher(
      {},
      { resolve: async () => [PUBLIC, '192.168.1.20'], transport }
    );

    await expectCode(dispatcher.dispatch({ url: 'https://gateway.example.com' }), 'unsafe_address');
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin redirect without forwarding credentials', async () => {
    const transport = vi.fn(async () =>
      response(302, { location: 'https://other.example.com/private' })
    );
    const dispatcher = new SafeGatewayDispatcher({}, { resolve: async () => [PUBLIC], transport });

    await expectCode(
      dispatcher.dispatch({
        url: 'https://gateway.example.com/start',
        headers: { authorization: 'Bearer must-not-cross-origin' },
      }),
      'cross_origin_redirect'
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('re-resolves and rejects a same-origin rebind before the second hop', async () => {
    let resolution = 0;
    const resolve = vi.fn(async () => {
      resolution += 1;
      return resolution === 1 ? [PUBLIC] : ['127.0.0.1'];
    });
    const transport = vi.fn(async () => response(302, { location: '/next' }));
    const dispatcher = new SafeGatewayDispatcher({}, { resolve, transport });

    await expectCode(
      dispatcher.dispatch({ url: 'https://gateway.example.com/start' }),
      'unsafe_address'
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('enforces the redirect limit', async () => {
    const transport = vi.fn(async () => response(302, { location: '/again' }));
    const dispatcher = new SafeGatewayDispatcher(
      { maxRedirects: 1 },
      { resolve: async () => [PUBLIC], transport }
    );

    await expectCode(
      dispatcher.dispatch({ url: 'https://gateway.example.com/start' }),
      'redirect_limit'
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('aborts on the total timeout', async () => {
    const transport = vi.fn(
      async (request: PinnedTransportRequest): Promise<PinnedTransportResponse> => {
        await new Promise<void>((_, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new GatewayDispatchError('timeout', 'aborted')),
            { once: true }
          );
        });
        return response(200);
      }
    );
    const dispatcher = new SafeGatewayDispatcher(
      { timeoutMs: 20 },
      { resolve: async () => [PUBLIC], transport }
    );

    await expectCode(dispatcher.dispatch({ url: 'https://gateway.example.com' }), 'timeout');
  });

  it('rejects non-HTTPS URLs before DNS resolution', async () => {
    const resolve = vi.fn(async () => [PUBLIC]);
    const dispatcher = new SafeGatewayDispatcher({}, { resolve, transport: vi.fn() });

    await expectCode(dispatcher.dispatch({ url: 'http://gateway.example.com' }), 'https_required');
    expect(resolve).not.toHaveBeenCalled();
  });
});
