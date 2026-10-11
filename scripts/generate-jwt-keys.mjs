// scripts/generate-jwt-keys.mjs
// Generates an ES256 signing key for EkLink. Keys are printed once and are not
// written to disk.

import crypto from 'node:crypto';
import { exportPKCS8, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const privatePem = await exportPKCS8(privateKey);
const keyId = `eklink-${crypto.randomBytes(8).toString('hex')}`;

console.log('EKLINK_JWT_KEY_ID=' + keyId);
console.log('EKLINK_JWT_PRIVATE_KEY=' + privatePem.replace(/\n/g, '\\n'));
console.log('');
console.log('Put these in .env.local for local testing and in Vercel Project Settings > Environment Variables for deployment.');
