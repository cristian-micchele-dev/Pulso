import { Inject, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TOKEN_SERVICE, TokenService } from '../../shared/application/ports';

@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(@Inject(TOKEN_SERVICE) private readonly tokens: TokenService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.tokens.verifyAccess(token);
      const userId = payload.sub as string;

      if (!userId) {
        client.disconnect();
        return;
      }

      await client.join(`user:${userId}`);
      this.logger.debug(`Client connected: ${client.id} -> user:${userId}`);
    } catch {
      client.disconnect();
    }
  }

  notifyUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
