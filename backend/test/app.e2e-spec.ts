import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from '../src/shared/infra/http/health.controller';
import { configureApp } from '../src/main';
import { AuthController } from '../src/modules/auth/adapters/http/auth.controller';
import { JwtAuthGuard } from '../src/modules/auth/adapters/http/auth.guards';
import { Roles, RolesGuard } from '../src/modules/auth/adapters/http/auth.guards';
import { Role } from '../src/modules/users/domain/user';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { User } from '../src/modules/users/domain/user';
import { TOKEN_SERVICE, HASHER, CLOCK } from '../src/shared/application/ports';
import { MAILER, RESET_REPOSITORY, SESSION_REPOSITORY } from '../src/modules/auth/auth.repository.port';
import { DataSource } from 'typeorm';

const users = new Map<string, User>();
const sessions = new Map<string, any>();
const resets = new Map<string, any>();
const hasher = { hash: async (value: string) => `hash:${value}`, verify: async (hash: string, value: string) => hash === `hash:${value}` };
const tokens = {
  signAccess: (payload: Record<string, unknown>) => `access:${payload.sub}:${payload.role}`,
  signRefresh: (payload: Record<string, unknown>) => `refresh:${payload.sub}:${payload.jti}:${payload.familyId}`,
  verifyAccess: (token: string) => { const [, sub, role] = token.split(':'); if (!sub || !role) throw new Error('invalid'); return { sub, role }; },
  verifyRefresh: (token: string) => { const [, sub, jti, familyId] = token.split(':'); if (!sub || !jti || !familyId) throw new Error('invalid'); return { sub, jti, familyId }; },
  refreshTtlMs: () => 86400000,
};
const userRepository = {
  findByEmail: async (email: string) => [...users.values()].find((user) => user.email === email),
  findById: async (id: string) => users.get(id),
  save: async (user: User) => { users.set(user.id, user); return user; },
  update: async (user: User) => { users.set(user.id, user); },
  setLoginFailures: async (userId: string, attempts: number, lockedUntil: Date | null) => {
    const user = users.get(userId);
    if (user) { user.failedLoginAttempts = attempts; user.lockedUntil = lockedUntil; }
  },
};
const sessionRepository = {
  save: async (session: any) => { sessions.set(session.jti, session); },
  findByJti: async (jti: string) => sessions.get(jti),
  rotate: async (id: string, hash: string, replacedBy: string, now: Date) => { const session = [...sessions.values()].find((item) => item.id === id); if (!session || session.revokedAt || session.tokenHash !== hash || session.expiresAt <= now) return false; session.revokedAt = now; session.replacedBy = replacedBy; return true; },
  revoke: async (id: string) => { const session = [...sessions.values()].find((item) => item.id === id); if (session) session.revokedAt = new Date(); },
  revokeFamily: async (familyId: string) => { for (const session of sessions.values()) if (session.familyId === familyId) session.revokedAt = new Date(); },
  revokeAllForUser: async (userId: string) => { for (const session of sessions.values()) if (session.userId === userId) session.revokedAt = new Date(); },
};
const resetRepository = {
  save: async (token: any) => resets.set(token.tokenHash, token),
  consume: async (hash: string, now: Date) => {
    const token = resets.get(hash);
    if (!token || token.usedAt || token.expiresAt <= now) return undefined;
    token.usedAt = now;
    return token;
  },
};
const mailer = { sendPasswordReset: jest.fn(async (_email: string, _token: string) => undefined) };

@Controller('admin-only')
class AdminOnlyController {
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  access() { return { ok: true }; }
}

@Module({
  controllers: [HealthController, AuthController, AdminOnlyController],
  providers: [AuthService, JwtAuthGuard, RolesGuard,
    { provide: 'USER_REPOSITORY', useValue: userRepository }, { provide: HASHER, useValue: hasher },
    { provide: TOKEN_SERVICE, useValue: tokens }, { provide: CLOCK, useValue: { now: () => new Date('2026-01-01T00:00:00Z') } },
    { provide: SESSION_REPOSITORY, useValue: sessionRepository }, { provide: RESET_REPOSITORY, useValue: resetRepository },
    { provide: MAILER, useValue: mailer },
    { provide: AuditService, useValue: { record: jest.fn(async () => undefined) } },
    { provide: DataSource, useValue: { query: async () => { throw new Error('database unavailable'); } } },
  ],
})
class E2eModule {}

describe('foundation HTTP', () => {
  let app: any;
  beforeAll(async () => {
    users.clear(); sessions.clear(); resets.clear(); mailer.sendPasswordReset.mockClear();
    users.set('seed-doctor', new User('seed-doctor', 'doctor@example.com', 'Doctor', 'hash:strong-password', Role.DOCTOR));
    users.set('seed-target', new User('seed-target', 'blanco@example.com', 'Blanco', 'hash:strong-password', Role.DOCTOR));
    const module = await Test.createTestingModule({ imports: [E2eModule] }).compile();
    app = configureApp(module.createNestApplication());
    await app.init();
  });
  afterAll(async () => app.close());

  it('expone liveness y devuelve 503 cuando PostgreSQL no está disponible', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200).expect({ status: 'ok' });
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503).expect((response) => {
      expect(response.body.status).toBe(503);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  it('no expone auto-registro y ejecuta login/me sin exponer secretos', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: 'x@y.com', password: 'strong-password' }).expect(404);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'strong-password' }).expect(201);
    expect(login.body).toEqual({ accessToken: expect.stringMatching(/^access:/) });
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200).expect((response) => expect(response.body.email).toBe('doctor@example.com'));
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'wrong-password' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(201).expect({ message: 'Sesión cerrada' });
  });

  it('recordarme persiste la cookie de refresh; sin recordarme es cookie de sesión', async () => {
    const plain = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'strong-password' }).expect(201);
    const plainRefresh = (plain.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!;
    expect(plainRefresh).not.toMatch(/Max-Age=/i);

    const remembered = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'strong-password', rememberMe: true }).expect(201);
    const cookies = remembered.headers['set-cookie'] as unknown as string[];
    const rememberedRefresh = cookies.find((c) => c.startsWith('refresh_token='))!;
    expect(rememberedRefresh).toMatch(/Max-Age=\d+/i);

    // rotation keeps it persistent
    const csrf = cookies.find((c) => c.startsWith('csrf_token='))!.match(/^csrf_token=([^;]+)/)![1];
    const rotated = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookies).set('X-CSRF-Token', csrf).expect(201);
    const rotatedRefresh = (rotated.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!;
    expect(rotatedRefresh).toMatch(/Max-Age=\d+/i);
  });

  it('rota refresh correctamente y revoca la familia ante reuse', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'strong-password' }).expect(201);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((cookie) => cookie.startsWith('refresh_token='))!.split(';')[0];
    const csrf = cookies.find((cookie) => cookie.startsWith('csrf_token='))!.match(/^csrf_token=([^;]+)/)![1];
    const rotated = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookies).set('X-CSRF-Token', csrf).expect(201);
    expect(rotated.body.accessToken).toMatch(/^access:/);
    const rotatedCookies = rotated.headers['set-cookie'] as unknown as string[];
    const rotatedRefresh = rotatedCookies.find((cookie) => cookie.startsWith('refresh_token='))!.split(';')[0];
    const rotatedCsrf = rotatedCookies.find((cookie) => cookie.startsWith('csrf_token='))!.match(/^csrf_token=([^;]+)/)![1];
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', [refresh, `csrf_token=${csrf}`]).set('X-CSRF-Token', csrf).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', [rotatedRefresh, `csrf_token=${rotatedCsrf}`]).set('X-CSRF-Token', rotatedCsrf).expect(401);
  });

  it('rechaza refresh sin CSRF válido', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'strong-password' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', login.headers['set-cookie']).expect(401);
  });

  it('cierra una sesión autenticada y revoca su refresh', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'strong-password' }).expect(201);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const csrf = cookies.find((cookie) => cookie.startsWith('csrf_token='))!.match(/^csrf_token=([^;]+)/)![1];
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookies).expect(201).expect({ message: 'Sesión cerrada' });
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookies).set('X-CSRF-Token', csrf).expect(401);
  });

  it('mantiene anti-enumeración y permite reset válido de un solo uso', async () => {
    const unknown = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'unknown@example.com' }).expect(201);
    const known = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'doctor@example.com' }).expect(201);
    expect(known.body).toEqual(unknown.body);
    const token = mailer.sendPasswordReset.mock.calls.at(-1)![1];
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token, password: 'colina ventana 41' }).expect(201).expect({ message: 'Contraseña actualizada' });
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token, password: 'another-password' }).expect(401);
  });

  it('rechaza reset expirado o alterado sin cambiar la contraseña', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'doctor@example.com' }).expect(201);
    const token = mailer.sendPasswordReset.mock.calls.at(-1)![1];
    const saved = [...resets.values()].at(-1)!;
    saved.expiresAt = new Date('2025-01-01T00:00:00Z');
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token, password: 'new-password' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token: `${token}altered`, password: 'new-password' }).expect(401);
  });

  it('rechaza validaciones, campos extra y rol insuficiente sin side effects', async () => {
    const before = users.size;
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'not-an-email', extra: true }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token: 'x', password: 'short' }).expect(400);
    expect(users.size).toBe(before);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'doctor@example.com', password: 'colina ventana 41' }).expect(201);
    await request(app.getHttpServer()).get('/api/v1/admin-only').set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/admin-only').expect(401);
  });
  it('cinco claves mal bloquean la cuenta, y la clave correcta tampoco entra mientras dure', async () => {
    const attempt = (password: string) => request(app.getHttpServer())
      .post('/api/v1/auth/login').send({ email: 'blanco@example.com', password });

    for (let i = 0; i < 4; i++) await attempt('mal').expect(401);
    await attempt('mal').expect(401);

    const locked = await attempt('strong-password').expect(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.detail).toMatch(/1 minuto/);
    expect(locked.headers['content-type']).toContain('application/problem+json');
  });
});

describe('trazabilidad — seguirle el rastro a UN pedido', () => {
  let app: any;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [E2eModule] }).compile();
    app = configureApp(module.createNestApplication());
    await app.init();
  });
  afterAll(async () => app.close());

  it('toda respuesta vuelve con su x-request-id, aunque haya salido bien', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).not.toHaveLength(0);
  });

  it('si el cliente trae el suyo, se respeta: asi se cruza el rastro entre servicios', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live').set('x-request-id', 'rastro-123').expect(200);
    expect(res.headers['x-request-id']).toBe('rastro-123');
  });

  it('el id del cuerpo del error es el MISMO que el del header, o no sirve para buscar', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
