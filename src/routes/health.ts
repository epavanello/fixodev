import { Hono } from 'hono';

const router = new Hono();

router.get('/health', c => {
  return c.json({ status: 'ok' });
});

export const healthRouter = router;
