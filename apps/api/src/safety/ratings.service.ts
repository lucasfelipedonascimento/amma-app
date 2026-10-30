import { Injectable } from '@nestjs/common';
import { ratingSummary, type RatingDirection, type RatingSummary } from '@amma/shared';
import { PrismaService } from '../prisma.service';

/** Notas mais recentes que entram na média (limita a consulta e deixa a nota refletir o momento atual). */
const WINDOW = 200;

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string, direction: RatingDirection): Promise<RatingSummary> {
    const rows = await this.prisma.rating.findMany({
      where: { rateeId: userId, direction },
      orderBy: { createdAt: 'desc' },
      take: WINDOW,
      select: { stars: true },
    });
    return ratingSummary(rows.map((r) => r.stars));
  }
}
