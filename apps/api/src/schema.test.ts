import { RIDE_STATUSES } from '@amma/shared';
import { RideStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

describe('enum RideStatus', () => {
  it('Prisma e packages/shared têm exatamente os mesmos estados', () => {
    expect(Object.keys(RideStatus).sort()).toEqual([...RIDE_STATUSES].sort());
  });
});
