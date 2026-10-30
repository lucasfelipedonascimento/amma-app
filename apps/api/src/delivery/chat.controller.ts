import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { RateLimit } from '../common/rate-limit';
import { RolesGuard } from '../auth/roles';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto';

/** Chat do pedido: cliente e motorista, nos dois sentidos. */
@Controller('deliveries/:id/messages')
@UseGuards(AuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@Req() req: { user: AuthUser }, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.list(req.user, id);
  }

  @RateLimit(40, 60)
  @Post()
  @HttpCode(201)
  send(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.send(req.user, id, dto.body);
  }
}
