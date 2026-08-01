import { handleRequest } from '../server.mjs';

export const runtime = 'nodejs';

export default async function handler(req, res) {
  await handleRequest(req, res);
}
