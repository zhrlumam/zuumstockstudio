import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { app } from './server/app.ts';
import { ensureAdminSeeded } from './server/auth.ts';
import { ensureDbReady } from './server/db.ts';

async function startServer() {
  await ensureDbReady();
  await ensureAdminSeeded();

  const PORT = Number(process.env.PORT || 3000);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ZuumStock Studio running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
