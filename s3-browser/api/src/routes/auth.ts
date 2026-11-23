import { createAuthRouter } from '@garage/server-config';
import { env } from '../config/env.js';

export default createAuthRouter({
  adminPassword: env.adminPassword,
  adminPasswordHash: env.adminPasswordHash,
  adminUsername: env.adminUsername,
  totpSecret: env.totpSecret,
  jwtSecret: env.jwtSecret,
});
