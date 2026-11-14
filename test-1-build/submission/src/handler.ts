import { IncomingMessage, ServerResponse } from 'http';
import { MAX_PAYLOAD_BYTES, validateScoreRequest } from './validation.ts';
import { extractEvidence } from './extractor.ts';
import { computeScore } from './scorer.ts';
import type { ErrorResponse } from './types.ts';

function sendJson(res: ServerResponse, statusCode: number, data: unknown, headers?: Record<string, string>): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export async function handleScoreRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startTime = Date.now();

  // 1. Method check: POST only
  if (req.method !== 'POST') {
    sendJson(
      res,
      405,
      { error: 'method_not_allowed', message: 'Method not allowed. Use POST.' } as ErrorResponse,
      { Allow: 'POST' }
    );
    return;
  }

  // 2. Read request body with strict size limit (64 KB)
  let rawBody = '';
  let bytesReceived = 0;
  let tooLarge = false;

  try {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_PAYLOAD_BYTES) {
          tooLarge = true;
          req.removeAllListeners('data');
          req.resume();
          resolve();
          return;
        }
        rawBody += chunk.toString('utf8');
      });

      req.on('end', () => resolve());
      req.on('error', (err) => reject(err));
    });
  } catch (err) {
    sendJson(res, 400, { error: 'bad_request', message: 'Failed to read request body stream' });
    return;
  }

  if (tooLarge) {
    sendJson(res, 413, {
      error: 'payload_too_large',
      message: `Request payload exceeds maximum allowed size of ${MAX_PAYLOAD_BYTES} bytes`,
    } as ErrorResponse);
    return;
  }

  // 3. Parse JSON
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (err) {
    sendJson(res, 400, {
      error: 'bad_request',
      message: 'Invalid JSON payload in request body',
    } as ErrorResponse);
    return;
  }

  // 4. Validate schema
  const validation = validateScoreRequest(parsedJson);
  if (!validation.valid || !validation.data) {
    sendJson(res, 400, {
      error: 'bad_request',
      message: validation.message || 'Validation failed',
    } as ErrorResponse);
    return;
  }

  const scoreRequest = validation.data;

  // 5. Extract structured evidence and score
  try {
    const evidence = await extractEvidence(scoreRequest);
    const scoreResult = computeScore(scoreRequest, evidence);

    const elapsed = Date.now() - startTime;
    console.log(`[score] lead_id=${scoreResult.lead_id} tier=${scoreResult.tier} score=${scoreResult.score} duration=${elapsed}ms`);

    sendJson(res, 200, scoreResult);
  } catch (err: unknown) {
    const elapsed = Date.now() - startTime;
    const errorObj = err as { name?: string; message?: string };

    console.error(`[score-error] lead_id=${scoreRequest.lead_id} duration=${elapsed}ms message=${errorObj.message}`);

    sendJson(
      res,
      500,
      {
        error: 'internal_error',
        message: 'Internal server error processing lead score request.',
      } as ErrorResponse
    );
  }
}
