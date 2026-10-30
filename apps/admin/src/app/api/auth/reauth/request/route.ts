import { reauthRoute } from '@/lib/reauth-route';

export const POST = (req: Request) => reauthRoute(req, 'request');
