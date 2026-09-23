const express = require('express');
const request = require('supertest');
const { requestLogger, sanitizeUrl } = require('../middleware/requestLogger');
const { logger } = require('../middleware/logger');

describe('Request Logger Middleware', () => {
  let infoSpy;
  let warnSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('sanitizeUrl redacts sensitive query parameters', () => {
    const raw = '/api/devices?search=test&token=secret123&apiKey=topsecret&jwt=xyz';
    const sanitized = sanitizeUrl(raw);
    expect(sanitized).toContain('search=test');
    expect(sanitized).toContain('token=%5BREDACTED%5D');
    expect(sanitized).toContain('apiKey=%5BREDACTED%5D');
    expect(sanitized).toContain('jwt=%5BREDACTED%5D');
    expect(sanitized).not.toContain('secret123');
    expect(sanitized).not.toContain('topsecret');
  });

  test('does not log /health or /health/detailed requests', async () => {
    const app = express();
    app.use(requestLogger);
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.get('/health/detailed', (_req, res) => res.json({ status: 'detailed' }));

    await request(app).get('/health');
    await request(app).get('/health/detailed');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('logs normal requests as INFO with duration <= 1000ms, routePattern, and content-length', async () => {
    const app = express();
    app.use((req, res, next) => {
      req.id = 'req-123';
      next();
    });
    app.use(requestLogger);

    const router = express.Router();
    router.get('/:id', (req, res) => {
      res.setHeader('content-length', '42');
      res.status(200).send('ok');
    });
    app.use('/api/devices', router);

    await request(app).get('/api/devices/999?search=test');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const logCall = infoSpy.mock.calls[0];
    const logMessage = logCall[0];
    const logMeta = logCall[1];

    expect(logMessage).toContain('GET');
    expect(logMessage).toContain('/api/devices/:id');
    expect(logMessage).toContain('/api/devices/999?search=test');
    expect(logMessage).toContain('200');
    expect(logMessage).toContain(' 2 - ');
    expect(logMeta.requestId).toBe('req-123');
    expect(logMeta.routePattern).toBe('/api/devices/:id');
  });

  test('logs "-" when content-length header is not present', async () => {
    const app = express();
    app.use(requestLogger);
    app.get('/no-cl', (req, res) => {
      // Chunked or no content-length
      res.removeHeader('Content-Length');
      res.status(200).end();
    });

    await request(app).get('/no-cl');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const logMessage = infoSpy.mock.calls[0][0];
    expect(logMessage).toContain(' 200 - - ');
  });

  test('logs WARN [SlowRequest] when duration > 1000ms', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/slow-op',
      path: '/api/slow-op',
      baseUrl: '',
      route: { path: '/api/slow-op' },
      id: 'req-slow',
    };
    const listeners = {};
    const res = {
      statusCode: 200,
      writableFinished: true,
      getHeader: () => '100',
      on: (event, cb) => {
        listeners[event] = cb;
      },
    };

    // Simulate request start hrtime 1.5 seconds in the past
    const originalHrtime = process.hrtime.bigint;
    let callCount = 0;
    process.hrtime.bigint = jest.fn(() => {
      callCount++;
      return callCount === 1 ? 0n : 1_500_000_000n; // 1500 ms elapsed
    });

    try {
      requestLogger(req, res, () => {});
      listeners['close']();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnCall = warnSpy.mock.calls[0];
      expect(warnCall[0]).toContain('[SlowRequest]');
      expect(warnCall[0]).toContain('1500ms');
    } finally {
      process.hrtime.bigint = originalHrtime;
    }
  });

  test('logs WARN [AbortedRequest] when client closes connection prematurely', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/commands',
      path: '/api/commands',
      baseUrl: '',
      route: { path: '/api/commands' },
      id: 'req-abort',
    };
    const listeners = {};
    const res = {
      statusCode: 200,
      writableFinished: false, // client aborted!
      getHeader: () => null,
      on: (event, cb) => {
        listeners[event] = cb;
      },
    };

    requestLogger(req, res, () => {});
    listeners['close']();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnCall = warnSpy.mock.calls[0];
    expect(warnCall[0]).toContain('[AbortedRequest]');
    expect(warnCall[0]).toContain('POST');
    expect(warnCall[0]).toContain('/api/commands');
  });
});
