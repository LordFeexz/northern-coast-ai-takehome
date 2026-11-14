import http from 'http';
import { handleScoreRequest } from './handler.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = req.url || '';
    if (url === '/api/score' || url.startsWith('/api/score?')) {
      await handleScoreRequest(req, res);
    } else if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: `Route ${url} not found` }));
    }
  });
}

const server = createServer();

// Vercel imports the server and manages its listener.
export default server;

// When run directly, Node needs an explicit listener.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  server.listen(PORT, HOST, () => {
    console.log(`[server] Northern Coast lead scoring server listening on http://${HOST}:${PORT}`);
  });
}
