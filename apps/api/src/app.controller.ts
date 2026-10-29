import { Controller, Get } from '@nestjs/common';
import { BRAND } from '@amma/shared';

@Controller()
export class AppController {
  // Rota de saúde: confirma que a API sobe e importa o pacote shared.
  @Get('health')
  health() {
    return { status: 'ok', app: 'AMMA API', brand: BRAND.red };
  }
}
