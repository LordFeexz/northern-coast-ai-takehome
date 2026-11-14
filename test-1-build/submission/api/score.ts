import { IncomingMessage, ServerResponse } from 'http';
import { handleScoreRequest } from '../src/handler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleScoreRequest(req, res);
}
