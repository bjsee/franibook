import Fastify from 'fastify';

const PORT = Number(process.env['PORT'] ?? 5174);

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({ status: 'ok' }));

/**
 * Bindet ausschließlich an das Loopback-Interface. Der Server läuft ohne
 * Authentifizierung und darf deshalb unter keinen Umständen im Netz stehen.
 */
await app.listen({ port: PORT, host: '127.0.0.1' });
