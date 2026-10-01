import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { actorOf } from '../../../../shared/infra/http/actor';
import { randomBytes } from 'crypto';
import { AuthService } from '../../application/auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from '../../../users/application/dto/auth.dto';
import { JwtAuthGuard } from './auth.guards';
import { cookiePolicy } from './cookie-policy';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  // Session cookie by default; a remembered login gets an explicit lifetime so it survives closing the browser.
  private cookie(response: Response, token: string, persistUntil?: Date) {
    const maxAge = persistUntil ? { maxAge: Math.max(0, persistUntil.getTime() - Date.now()) } : {};
    const path = '/api/v1/auth';
    const { sameSite, secure } = cookiePolicy();
    response.cookie(process.env.REFRESH_COOKIE_NAME ?? 'refresh_token', token, { httpOnly: true, secure, sameSite, path, ...maxAge });
    response.cookie(process.env.CSRF_COOKIE_NAME ?? 'csrf_token', randomBytes(24).toString('hex'), { secure, sameSite, path, ...maxAge });
  }
  // Más alto que MAX_FAILED_ATTEMPTS a propósito. Este límite frena una ráfaga
  // desde una IP; el bloqueo de cuenta es el que sabe de quién se trata y tiene
  // algo útil que decirle. Si el throttler ataja primero, la persona recibe un
  // "esperá un minuto" genérico y el mensaje del bloqueo no se ve nunca.
  @Throttle({ default: { ttl: 60000, limit: 10 } }) @Post('login') async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) { const result = await this.service.login(dto); this.cookie(response, result.refreshToken, result.persistent ? result.expiresAt : undefined); return { accessToken: result.accessToken }; }
  @Post('refresh') async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const csrf = request.headers['x-csrf-token'];
    if (!csrf || csrf !== request.cookies?.[process.env.CSRF_COOKIE_NAME ?? 'csrf_token']) throw new UnauthorizedException();
    const result = await this.service.refresh(request.cookies?.[process.env.REFRESH_COOKIE_NAME ?? 'refresh_token']); this.cookie(response, result.refreshToken, result.persistent ? result.expiresAt : undefined); return { accessToken: result.accessToken };
  }
  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { await this.service.logout(request.cookies?.[process.env.REFRESH_COOKIE_NAME ?? 'refresh_token']); const options = { path: '/api/v1/auth' }; response.clearCookie(process.env.REFRESH_COOKIE_NAME ?? 'refresh_token', options); response.clearCookie(process.env.CSRF_COOKIE_NAME ?? 'csrf_token', options); return { message: 'Sesión cerrada' }; }
  @UseGuards(JwtAuthGuard) @Get('me') me(@Req() request: Request) { return this.service.me(actorOf(request).sub); }
  @UseGuards(JwtAuthGuard) @Post('change-password') async changePassword(@Req() request: Request, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) response: Response) { const result = await this.service.changePassword(actorOf(request).sub, dto); this.cookie(response, result.refreshToken, result.persistent ? result.expiresAt : undefined); return { accessToken: result.accessToken }; }
  @Throttle({ default: { ttl: 60000, limit: 3 } }) @Post('forgot-password') forgot(@Body() dto: ForgotPasswordDto) { return this.service.forgot(dto.email); }
  @Throttle({ default: { ttl: 60000, limit: 5 } }) @Post('reset-password') reset(@Body() dto: ResetPasswordDto) { return this.service.reset(dto); }
}
