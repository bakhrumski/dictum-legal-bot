'use strict';

/**
 * Portal Module Entry Point
 *
 * Usage in server.js:
 *   const { mountPortal } = require('../portal');
 *   mountPortal(app);
 *
 * This mounts:
 *   /api/portal/*     — all REST endpoints
 *   /api/portal/docs  — Swagger UI (auto-generated)
 */

const portalRoutes = require('./routes');
const { runPortalMigrations } = require('./models');

async function mountPortal(app) {
  // Run database migrations
  await runPortalMigrations();

  // Mount API routes
  app.use('/api/portal', portalRoutes);

  // Simple API documentation endpoint
  app.get('/api/portal/docs', (req, res) => {
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'Dictum AI Portal API',
        version: '1.0.0',
        description: 'Yuridik AI yordamchi — REST API'
      },
      servers: [{ url: '/api/portal' }],
      paths: {
        '/auth/register': {
          post: {
            summary: 'Ro\'yxatdan o\'tish',
            tags: ['Auth'],
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['fullName', 'email', 'password'], properties: {
              fullName: { type: 'string', example: 'Alisher Karimov' },
              email: { type: 'string', example: 'alisher@example.com' },
              password: { type: 'string', example: '12345678' },
              phone: { type: 'string', example: '+998901234567' },
              firmName: { type: 'string', example: 'Huquq Markazi' },
              plan: { type: 'string', enum: ['trial', 'silver', 'gold', 'platinum'], default: 'trial' }
            }}}}},
            responses: { '201': { description: 'User created + JWT token' }, '409': { description: 'Email already exists' } }
          }
        },
        '/auth/login': {
          post: {
            summary: 'Kirish',
            tags: ['Auth'],
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: {
              email: { type: 'string' }, password: { type: 'string' }
            }}}}},
            responses: { '200': { description: 'JWT tokens' }, '401': { description: 'Invalid credentials' } }
          }
        },
        '/auth/refresh': { post: { summary: 'Tokenni yangilash', tags: ['Auth'] } },
        '/auth/me': { get: { summary: 'Joriy foydalanuvchi profili', tags: ['Auth'], security: [{ bearerAuth: [] }] } },
        '/conversations': {
          get: { summary: 'Suhbatlar ro\'yxati', tags: ['Conversations'], security: [{ bearerAuth: [] }] },
          post: { summary: 'Yangi suhbat ochish', tags: ['Conversations'], security: [{ bearerAuth: [] }] }
        },
        '/conversations/{id}': {
          get: { summary: 'Suhbat + xabarlar', tags: ['Conversations'], security: [{ bearerAuth: [] }] },
          delete: { summary: 'Suhbatni o\'chirish', tags: ['Conversations'], security: [{ bearerAuth: [] }] }
        },
        '/chat': {
          post: {
            summary: 'AI ga xabar yuborish (JSON)',
            tags: ['Chat'],
            security: [{ bearerAuth: [] }],
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: {
              message: { type: 'string', example: 'Mehnat shartnomasini buzish tartibi qanday?' },
              topic: { type: 'string', example: 'mehnat' },
              conversationId: { type: 'integer' },
              history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } }
            }}}}}
          }
        },
        '/chat/stream': {
          post: {
            summary: 'AI ga xabar yuborish (SSE streaming)',
            tags: ['Chat'],
            security: [{ bearerAuth: [] }],
            description: 'Server-Sent Events stream. Events: start, chunk, done, error'
          }
        },
        '/documents/upload': {
          post: {
            summary: 'Hujjat yuklash (PDF/TXT/DOCX)',
            tags: ['Documents'],
            security: [{ bearerAuth: [] }],
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: {
              document: { type: 'string', format: 'binary' }
            }}}}}
          }
        },
        '/documents': { get: { summary: 'Hujjatlar ro\'yxati', tags: ['Documents'], security: [{ bearerAuth: [] }] } },
        '/documents/{id}': { get: { summary: 'Hujjat ma\'lumotlari', tags: ['Documents'], security: [{ bearerAuth: [] }] } },
        '/documents/{id}/analyze': { post: { summary: 'Hujjat tahlilini boshlash', tags: ['Documents'], security: [{ bearerAuth: [] }] } },
        '/tasks/types': { get: { summary: 'Agent vazifa turlari', tags: ['Agent Tasks'], security: [{ bearerAuth: [] }] } },
        '/tasks': {
          post: {
            summary: 'Yangi agent vazifa boshlash',
            tags: ['Agent Tasks'],
            security: [{ bearerAuth: [] }],
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['taskType', 'input'], properties: {
              taskType: { type: 'string', enum: ['draft-nda', 'compliance-review', 'contract-review', 'legal-memo'] },
              input: { type: 'object', properties: { description: { type: 'string' }, query: { type: 'string' } } }
            }}}}}
          },
          get: { summary: 'Vazifalar ro\'yxati', tags: ['Agent Tasks'], security: [{ bearerAuth: [] }] }
        },
        '/tasks/{id}': { get: { summary: 'Vazifa holati', tags: ['Agent Tasks'], security: [{ bearerAuth: [] }] } },
        '/tasks/{id}/stream': { get: { summary: 'Vazifa jarayoni (SSE)', tags: ['Agent Tasks'], security: [{ bearerAuth: [] }] } },
        '/tasks/{id}/cancel': { post: { summary: 'Vazifani bekor qilish', tags: ['Agent Tasks'], security: [{ bearerAuth: [] }] } },
        '/topics': { get: { summary: 'Huquqiy sohalar ro\'yxati', tags: ['Reference'] } },
        '/plans': { get: { summary: 'Tarif rejalari', tags: ['Reference'] } },
        '/admin/users': { get: { summary: 'Barcha foydalanuvchilar (admin)', tags: ['Admin'], security: [{ bearerAuth: [] }] } },
        '/admin/users/{id}': { patch: { summary: 'Foydalanuvchini yangilash (admin)', tags: ['Admin'], security: [{ bearerAuth: [] }] } },
        '/admin/stats': { get: { summary: 'Platforma statistikasi (admin)', tags: ['Admin'], security: [{ bearerAuth: [] }] } }
      },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
      }
    });
  });

  console.log('[PORTAL] API mounted at /api/portal');
  console.log('[PORTAL] OpenAPI docs at /api/portal/docs');
}

module.exports = { mountPortal };
