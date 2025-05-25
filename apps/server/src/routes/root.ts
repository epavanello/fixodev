import { Hono } from 'hono';

const router = new Hono();

router.get('/health', c => {
  return c.json({ status: 'ok' });
});

router.get('/', c => {
  return c.json({ status: 'hi' });
});

export const rootRouter = router;
