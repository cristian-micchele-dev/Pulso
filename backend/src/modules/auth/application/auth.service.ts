import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DomainError, UnauthorizedError } from '../../../shared/domain/errors';
import { CLOCK as CLOCK_TOKEN, Clock, HASHER, Hasher, TOKEN_SERVICE, TokenService } from '../../../shared/application/ports';
import { UserRepository } from '../../users/user.repository.port';
import { User } from '../../users/domain/user';
import { ChangePasswordDto, LoginDto, ResetPasswordDto } from '../../users/application/dto/auth.dto';
import { MailerPort, MAILER, RESET_REPOSITORY, ResetRepository, SESSION_REPOSITORY, SessionRepository } from '../auth.repository.port';
import { assertStrongPassword } from '../../users/domain/password-policy';
import { isLocked, minutesLeft, registerFailure } from '../../users/domain/account-lockout';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-entry';
import { MetricsService } from '../../../shared/infra/metrics/metrics.service';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Se le dice a la persona que está bloqueada y cuánto falta, en vez del
 * "credenciales inválidas" de siempre. Sí, eso confirma que la cuenta existe;
 * pero acá no hay auto-registro —las cuentas las crea un admin— y el costo de
 * que un médico quede afuera sin entender por qué es más alto que el de esa
 * filtración.
 */
export class AccountLockedError extends DomainError {
  constructor(minutes: number) {
    super('ACCOUNT_LOCKED', `Demasiados intentos fallidos. Volvé a probar en ${minutes} minuto${minutes === 1 ? '' : 's'}.`, 429);
  }
}

@Injectable()
export class AuthService {
  constructor(@Inject('USER_REPOSITORY') private readonly users: UserRepository, @Inject(HASHER) private readonly hasher: Hasher, @Inject(TOKEN_SERVICE) private readonly tokens: TokenService, @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository, @Inject(RESET_REPOSITORY) private readonly resets: ResetRepository, @Inject(MAILER) private readonly mailer: MailerPort, @Inject(CLOCK_TOKEN) private readonly clock: Clock, private readonly audit: AuditService, @Optional() private readonly metrics?: MetricsService) {}
  // A remembered session lives longer and the refresh JWT must expire together with it.
  private async issue(user: User, familyId: string = randomUUID(), persistent = false) {
    const jti = randomUUID();
    const ttlMs = persistent ? (this.tokens.rememberTtlMs?.() ?? 30 * 86400000) : (this.tokens.refreshTtlMs?.() ?? 7 * 86400000);
    const refreshToken = this.tokens.signRefresh({ sub: user.id, jti, familyId }, persistent ? ttlMs : undefined);
    const expiresAt = new Date(this.clock.now().getTime() + ttlMs);
    await this.sessions.save({ id: randomUUID(), userId: user.id, familyId, tokenHash: sha(refreshToken), jti, expiresAt, persistent });
    return { accessToken: this.tokens.signAccess({ sub: user.id, role: user.role }), refreshToken, persistent, expiresAt };
  }
  async login(dto: LoginDto) {
    const now = this.clock.now();
    const user = await this.users.findByEmail(dto.email.trim().toLowerCase());
    // Primero el candado: verificar la clave de una cuenta bloqueada sería regalar
    // un oráculo de "esta era la buena" a fuerza de medir el tiempo de respuesta.
    if (user && isLocked(user.lockedUntil, now)) throw new AccountLockedError(minutesLeft(user.lockedUntil, now));
    const passwordOk = user ? await this.hasher.verify(user.passwordHash, dto.password) : false;
    if (!user || !user.active || !passwordOk) {
      if (user && !passwordOk) await this.countFailure(user, now);
      throw new UnauthorizedError();
    }
    // Una racha interrumpida no se arrastra; sin racha, no se escribe de gusto.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) await this.users.setLoginFailures(user.id, 0, null);
    return this.issue(user, undefined, Boolean(dto.rememberMe));
  }

  private async countFailure(user: User, now: Date) {
    const { attempts, lockedUntil } = registerFailure(user.failedLoginAttempts, now);
    await this.users.setLoginFailures(user.id, attempts, lockedUntil);
    // Solo el bloqueo va a la auditoría: anotar cada fallo le daría al atacante
    // una forma barata de llenarle la tabla a la clínica.
    this.metrics?.recordEvent('login_failed');
    if (lockedUntil) {
      // Un bloqueo no devuelve error de sistema: sin esta metrica, una oleada de
      // intentos contra muchas cuentas no se ve en ningun grafico.
      this.metrics?.recordEvent('account_locked');
      await this.audit.record(null, AuditAction.ACCOUNT_LOCKED, 'user', user.id, { attempts, minutes: minutesLeft(lockedUntil, now) });
    }
  }
  async refresh(raw: string) { try { if (!raw) throw new UnauthorizedError(); const payload = this.tokens.verifyRefresh(raw); const session = await this.sessions.findByJti(String(payload.jti)); if (!session || session.familyId !== String(payload.familyId) || session.revokedAt || session.expiresAt <= this.clock.now() || session.tokenHash !== sha(raw)) { if (session) await this.sessions.revokeFamily(session.familyId); throw new UnauthorizedError(); } const user = await this.users.findById(session.userId); if (!user?.active) throw new UnauthorizedError(); const replacement = await this.issue(user, session.familyId, Boolean(session.persistent)); const replacementPayload = this.tokens.verifyRefresh(replacement.refreshToken); if (!await this.sessions.rotate(session.id, sha(raw), String(replacementPayload.jti), this.clock.now())) { await this.sessions.revokeFamily(session.familyId); throw new UnauthorizedError(); } return replacement; } catch (error) { if (error instanceof UnauthorizedError) throw error; throw new UnauthorizedError(); } }
  async logout(raw?: string) { if (!raw) return; try { const payload = this.tokens.verifyRefresh(raw); const session = await this.sessions.findByJti(String(payload.jti)); if (session && !session.revokedAt) await this.sessions.revoke(session.id); } catch { /* idempotente */ } }
  async me(id: string) { const user = await this.users.findById(id); if (!user) throw new UnauthorizedError(); return user.toPublic(); }
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findById(userId);
    if (!user || !user.active || !(await this.hasher.verify(user.passwordHash, dto.currentPassword))) throw new UnauthorizedError();
    if (dto.currentPassword === dto.newPassword) throw new DomainError('PASSWORD_REUSED', 'La nueva contraseña debe ser distinta a la actual', 400);
    assertStrongPassword(dto.newPassword, { email: user.email, name: user.name });
    user.passwordHash = await this.hasher.hash(dto.newPassword);
    user.mustChangePassword = false;
    await this.users.update(user);
    await this.sessions.revokeAllForUser(user.id);
    return this.issue(user);
  }
  async forgot(email: string) { const user = await this.users.findByEmail(email.trim().toLowerCase()); if (user) { const token = randomBytes(32).toString('base64url'); await this.resets.save({ id: randomUUID(), userId: user.id, tokenHash: sha(token), expiresAt: new Date(this.clock.now().getTime() + 3600000) }); await this.mailer.sendPasswordReset(user.email, token); } return { message: 'Si el correo existe, recibirás instrucciones para recuperar tu contraseña' }; }
  async reset(dto: ResetPasswordDto) { const token = await this.resets.consume(sha(dto.token), this.clock.now()); if (!token) throw new UnauthorizedError(); const user = await this.users.findById(token.userId); if (!user) throw new UnauthorizedError(); assertStrongPassword(dto.password, { email: user.email, name: user.name }); user.passwordHash = await this.hasher.hash(dto.password); await this.users.update(user); /* Recuperar la clave también saca el candado: ya demostró ser quien dice. */ await this.users.setLoginFailures(user.id, 0, null); await this.sessions.revokeAllForUser(user.id); return { message: 'Contraseña actualizada' }; }
}
