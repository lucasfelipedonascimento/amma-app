import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RIDE_VEHICLE_TYPES, type RideVehicleType } from '@amma/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, Max, Min } from 'class-validator';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { PrismaService } from '../prisma.service';
import { RidesService } from '../rides/rides.service';
import { DeliveryService } from './delivery.service';

/** Passageira de exemplo do seed: é "quem pede" nos pedidos simulados. */
const SIMULATED_CLIENT_PHONE = '+5583999990002';
const SANDBOX_CARD_TOKEN = 'sbx_ok_4242_visa';
const METERS_PER_DEG = 111_000;

export class SimulateOrderDto {
  @IsIn(['ENTREGA', 'CORRIDA']) kind!: 'ENTREGA' | 'CORRIDA';
  /** Posição do motorista (celular de teste): a coleta nasce ~300 m ao norte dela. */
  @Type(() => Number) @IsLatitude() lat!: number;
  @Type(() => Number) @IsLongitude() lng!: number;
  /** Distância da coleta até o destino, em metros (padrão 2000). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(20_000) distanceMeters?: number;
  /** Só corrida (padrão CARRO). */
  @IsOptional() @IsIn(RIDE_VEHICLE_TYPES) vehicleType?: RideVehicleType;
}

/**
 * TEMPORÁRIO — simulador de corridas/entregas para testar o app do motorista num celular real.
 * Cria um pedido de verdade (pago no provedor simulado) em nome da passageira de exemplo e dispara
 * o despacho. Desligado em produção e fora do provedor de pagamento simulado.
 */
@Controller('admin/simulator')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class SimulatorController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveryService,
    private readonly rides: RidesService,
  ) {}

  private isEnabled() {
    return (
      this.config.get('NODE_ENV') !== 'production' &&
      (this.config.get<string>('PAYMENT_PROVIDER') ?? 'sandbox') === 'sandbox'
    );
  }

  @Get()
  status() {
    return { enabled: this.isEnabled() };
  }

  @Post('orders')
  async create(@Req() _req: { user: AuthUser }, @Body() dto: SimulateOrderDto) {
    if (!this.isEnabled()) throw new ForbiddenException('Simulador desligado neste ambiente');
    const client = await this.prisma.user.findUnique({
      where: { phone: SIMULATED_CLIENT_PHONE },
      select: { id: true, roles: true },
    });
    if (!client) throw new ForbiddenException('Rode o seed: falta a passageira de exemplo');
    const user: AuthUser = { id: client.id, roles: client.roles, blocked: false };

    const meters = dto.distanceMeters ?? 2000;
    const pickupLat = dto.lat + 300 / METERS_PER_DEG;
    const body = {
      pickup: {
        lat: pickupLat,
        lng: dto.lng,
        address: 'Coleta de teste (~300 m ao norte)',
      },
      dropoff: {
        lat: pickupLat + meters / METERS_PER_DEG,
        lng: dto.lng,
        address: `Destino de teste (~${(meters / 1000).toFixed(1)} km ao norte)`,
      },
      payment: { method: 'CARTAO' as const, cardToken: SANDBOX_CARD_TOKEN },
    };
    const d =
      dto.kind === 'CORRIDA'
        ? await this.rides.create(user, { ...body, vehicleType: dto.vehicleType ?? 'CARRO' })
        : await this.deliveries.create(user, { ...body, notes: 'Pedido simulado pelo admin' });
    return {
      id: d.id,
      kind: dto.kind,
      status: d.status,
      fareCents: d.fareCents,
      offered: d.status !== 'CRIADO',
    };
  }
}
