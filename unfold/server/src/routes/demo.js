import { Router } from 'express';
import { ensureFictionalDemo, fictionalDemoSession, resetFictionalDemo } from '../fictional-demo.js';

/** Only mounted when the server is explicitly running in local demo mode. */
export function demoRouter(db) {
  const router = Router();
  router.get('/session', (_req, res) => {
    ensureFictionalDemo(db);
    return res.json(fictionalDemoSession(db));
  });
  // Start the shared demo over: Maya's original case and conversation only.
  router.post('/reset', (_req, res) => {
    resetFictionalDemo(db);
    return res.json(fictionalDemoSession(db));
  });
  return router;
}
