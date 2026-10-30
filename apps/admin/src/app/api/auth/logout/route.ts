import { NextResponse } from 'next/server';
import { API_URL, AT_COOKIE, RT_COOKIE } from '@/lib/config';
import { isSameOrigin } from '@/lib/proxy-rules';

export async function POST(req: Request) {
  if (!isSameOrigin('POST', req.headers.get('origin'), req.headers.get('host')))
    return NextResponse.json({ message: 'Origem não permitida' }, { status: 403 });
  const rt = /(?:^|; )amma_rt=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1];
  if (rt)
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    }).catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AT_COOKIE);
  res.cookies.delete(RT_COOKIE);
  return res;
}
