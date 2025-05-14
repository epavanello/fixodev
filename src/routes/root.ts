import { logger } from '@/config/logger';
import { Hono } from 'hono';

const router = new Hono();

router.get('/health', c => {
  logger.info('Health route hit');
  return c.json({ status: 'ok' });
});

router.get('/', c => {
  logger.info('Root route hit');
  return c.json({ status: 'ok' });
});

export const rootRouter = router;
