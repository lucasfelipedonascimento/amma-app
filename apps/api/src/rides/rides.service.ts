import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  RIDE_VEHICLE_LABEL,
  RIDE_VEHICLE_TYPES,
  categoryRules,
  pricingProfile,
  type RideVehicleType,
} from '@amma/shared';
import { AuthUser } from '../auth/auth.guard';
import { DeliveryService } from '../delivery/delivery.service';
import { CreateRideDto, RideQuoteDto } from '../delivery/dto';
import { DispatchService } from '../dispatch/dispatch.service';
import { MunicipalRulesService } from '../municipal/municipal-rules.service';

/** Corridas de passageiro: cotação por tipo de veículo e pedido. O resto do fluxo é o do pedido (DeliveryService). */
@Injectable()
export class RidesService {
  constructor(
    private readonly deliveries: DeliveryService,
    private readonly dispatch: DispatchService,
    private readonly municipal: MunicipalRulesService,
  ) {}

  /** O que o passageiro pode escolher hoje: tipos liberados, avisos e se a opção "motorista mulher" existe. */
  async rules() {
    const book = await this.municipal.current();
    const r = book.rules;
    return {
      city: r.city,
      womenDriverOptionEnabled: r.womenDriverOptionEnabled,
      vehicleTypes: RIDE_VEHICLE_TYPES.map((type) => ({
        type,
        label: RIDE_VEHICLE_LABEL[type],
        enabled: categoryRules(r, type).enabled,
        notices: categoryRules(r, type).passengerNotices,
      })),
    };
  }

  /**
   * Estimativa para cada tipo de veículo liberado: preço, tempo de viagem e quanto o motorista mais
   * próximo leva para chegar. A rota é a mesma para todos; só a tabela de preço muda.
   */
  async quote(dto: RideQuoteDto) {
    const [{ rules }, route] = await Promise.all([
      this.municipal.current(),
      this.deliveries.route(dto),
    ]);
    const women = !!dto.womenDriverOnly && rules.womenDriverOptionEnabled;
    const options = await Promise.all(
      RIDE_VEHICLE_TYPES.filter((t) => categoryRules(rules, t).enabled).map(async (type) => {
        const [price, avail] = await Promise.all([
          // Sem tabela de preço para o perfil, o tipo aparece como indisponível em vez de derrubar a cotação.
          this.deliveries.priceRoute(route, pricingProfile('CORRIDA', type)).catch((e: unknown) => {
            if (e instanceof ServiceUnavailableException) return null;
            throw e;
          }),
          this.dispatch.availability(dto.pickup, type, women),
        ]);
        return {
          vehicleType: type,
          label: RIDE_VEHICLE_LABEL[type],
          available: price !== null,
          fareCents: price?.fareCents ?? null,
          minimumApplied: price?.minimumApplied ?? false,
          pricingVersion: price?.pricingVersion ?? null,
          driversNearby: avail.drivers,
          pickupEtaSeconds: avail.pickupEtaSeconds,
          notices: categoryRules(rules, type).passengerNotices,
        };
      }),
    );
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      womenDriverOnly: women,
      options,
    };
  }

  async create(user: AuthUser, dto: CreateRideDto) {
    const { rules } = await this.municipal.current();
    if (!categoryRules(rules, dto.vehicleType).enabled)
      throw new ConflictException(
        `Corrida de ${RIDE_VEHICLE_LABEL[dto.vehicleType].toLowerCase()} não está liberada em ${rules.city} no momento.`,
      );
    if (dto.womenDriverOnly && !rules.womenDriverOptionEnabled)
      throw new ConflictException('A opção de motorista mulher não está disponível no momento.');
    return this.deliveries.create(user, dto, {
      vehicleType: dto.vehicleType as RideVehicleType,
      womenDriverOnly: !!dto.womenDriverOnly,
    });
  }

  list(clientId: string, limit?: number) {
    return this.deliveries.list(clientId, undefined, limit, 'CORRIDA');
  }
}
