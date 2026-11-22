import type { Request, Response } from 'express';
import { app } from '../server/app.ts';
import { ensureAdminSeeded } from '../server/auth.ts';
import { ensureDbReady } from '../server/db.ts';

export default async function handler(req: Request, res: Response) {
  await ensureDbReady();
  await ensureAdminSeeded();
  return app(req, res);
}
