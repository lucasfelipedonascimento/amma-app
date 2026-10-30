import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
  DocumentBuilder,
  SwaggerModule,
  getSchemaPath,
} from '@nestjs/swagger';
import { getMetadataStorage } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';

// O class-transformer não exporta o storage na API pública; é o mesmo que o `@Type` alimenta.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { defaultMetadataStorage } = require('class-transformer/cjs/storage') as {
  defaultMetadataStorage: {
    findTypeMetadata(target: object, key: string): { typeFunction(): unknown } | undefined;
  };
};

type Ctor = new (...args: never[]) => object;
type Meta = { name?: string; constraints?: unknown[]; each?: boolean; type: string };

const PRIMITIVES = new Set<unknown>([String, Number, Boolean, Object, Array, Date, undefined]);

/** Tipo OpenAPI a partir dos validadores (mais fiel que `design:type`, que vira `Object` em uniões). */
function describeProperty(cls: Ctor, key: string, metas: Meta[]) {
  const has = (n: string) => metas.some((m) => m.name === n);
  const find = (n: string) => metas.find((m) => m.name === n);
  const opts: Record<string, unknown> = {
    required: !metas.some((m) => m.type === 'conditionalValidation' && m.name === 'isOptional'),
  };

  const nested = defaultMetadataStorage.findTypeMetadata(cls, key)?.typeFunction() as
    Type<unknown> | undefined;
  const isArray =
    has('isArray') ||
    Reflect.getMetadata('design:type', cls.prototype, key) === Array ||
    metas.some((m) => m.each);

  let base: unknown = String;
  if (nested && !PRIMITIVES.has(nested)) base = nested;
  else if (has('isInt') || has('isNumber')) {
    base = Number;
    if (has('isInt')) opts.format = 'int32';
  } else if (has('isBoolean')) base = Boolean;
  else if (has('isIn')) {
    const values = (find('isIn')?.constraints?.[0] ?? []) as unknown[];
    opts.enum = values;
    base = values.every((v) => typeof v === 'number') ? Number : String;
  } else if (has('isDateString')) opts.format = 'date-time';
  else if (has('isUuid')) opts.format = 'uuid';
  else if (has('isObject')) base = Object;
  else {
    const design = Reflect.getMetadata('design:type', cls.prototype, key);
    if (design === Number || design === Boolean) base = design;
  }

  if (isArray) {
    opts.type = [base];
    if (has('arrayMaxSize')) opts.maxItems = find('arrayMaxSize')?.constraints?.[0];
    if (has('arrayNotEmpty')) opts.minItems = 1;
    if (has('arrayUnique')) opts.uniqueItems = true;
  } else opts.type = base;

  const lim = (n: string) => find(n)?.constraints?.[0];
  if (has('min')) opts[base === String ? 'minLength' : 'minimum'] = lim('min');
  if (has('max')) opts[base === String ? 'maxLength' : 'maximum'] = lim('max');
  if (has('minLength')) opts.minLength = lim('minLength');
  if (has('maxLength')) opts.maxLength = lim('maxLength');
  if (has('isLength')) {
    const [min, max] = find('isLength')?.constraints ?? [];
    opts.minLength = min;
    if (max !== undefined) opts.maxLength = max;
  }
  if (has('matches')) {
    const re = find('matches')?.constraints?.[0];
    if (re instanceof RegExp) opts.pattern = re.source;
  }
  return opts;
}

const seen = new WeakSet<object>();

/** Registra no Swagger as propriedades de um DTO (e dos DTOs aninhados) lendo o class-validator. */
function documentDto(cls: Ctor) {
  if (seen.has(cls)) return;
  seen.add(cls);
  const metas = getMetadataStorage().getTargetValidationMetadatas(
    cls,
    '',
    true,
    false,
  ) as unknown as (Meta & { propertyName: string })[];
  const byKey = new Map<string, Meta[]>();
  for (const m of metas) byKey.set(m.propertyName, [...(byKey.get(m.propertyName) ?? []), m]);
  for (const [key, list] of byKey) {
    const opts = describeProperty(cls, key, list);
    ApiProperty(opts as never)(cls.prototype, key);
    const inner = (Array.isArray(opts.type) ? opts.type[0] : opts.type) as Ctor;
    if (typeof inner === 'function' && !PRIMITIVES.has(inner)) documentDto(inner);
  }
}

/** "driverPhoto" -> "Driver photo". */
const humanize = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/**
 * Descreve todas as rotas sem anotar uma a uma (a build usa `tsc`, sem o plugin do Nest):
 *  - DTOs: lidos do class-validator, então a documentação nunca destoa da validação real;
 *  - login: rota com `AuthGuard` pede Bearer; `@Roles`/`@PanelAccess` entram na descrição;
 *  - tag: nome do controller.
 */
function documentRoutes(app: INestApplication) {
  const modules = app.get(ModulesContainer);
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as Type<unknown> | null;
      if (!ctrl || Reflect.getMetadata(PATH_METADATA, ctrl) === undefined) continue;
      ApiTags(ctrl.name.replace(/Controller$/, ''))(ctrl);
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? [];

      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = ctrl.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const desc = Object.getOwnPropertyDescriptor(ctrl.prototype, name)!;

        const guards = [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
        const roles: string[] =
          Reflect.getMetadata('roles', handler) ?? Reflect.getMetadata('roles', ctrl) ?? [];
        const panel: string[] =
          Reflect.getMetadata('panelRoles', handler) ??
          Reflect.getMetadata('panelRoles', ctrl) ??
          [];
        const needsAuth = guards.includes(AuthGuard);

        const access = [
          needsAuth ? 'Requer login (Bearer).' : 'Rota pública.',
          roles.length ? `Papéis: ${roles.join(', ')}.` : '',
          panel.length ? `Painel: ${panel.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
        ApiOperation({ summary: humanize(name), description: access })(ctrl.prototype, name, desc);
        // Declarar 401/403 apaga o 200/201 padrão do Swagger; repõe o sucesso real da rota.
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number;
        const status: number =
          Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? (method === 1 ? 201 : 200);
        const ok =
          status === 204
            ? ApiNoContentResponse
            : status === 201
              ? ApiCreatedResponse
              : ApiOkResponse;
        ok({ description: 'Sucesso.' })(ctrl.prototype, name, desc);
        if (needsAuth) {
          ApiBearerAuth()(ctrl.prototype, name, desc);
          ApiUnauthorizedResponse({ description: 'Token ausente, inválido ou expirado.' })(
            ctrl.prototype,
            name,
            desc,
          );
          ApiForbiddenResponse({ description: 'Sem permissão, ou conta bloqueada.' })(
            ctrl.prototype,
            name,
            desc,
          );
        }

        const params: unknown[] =
          Reflect.getMetadata('design:paramtypes', ctrl.prototype, name) ?? [];
        for (const p of params)
          if (typeof p === 'function' && !PRIMITIVES.has(p)) documentDto(p as Ctor);
        const args = Reflect.getMetadata('__routeArguments__', ctrl, name) as
          Record<string, unknown> | undefined;
        // RouteParamtypes: BODY = 3, FILE = 8. Upload é multipart: o DTO ganha o campo do arquivo.
        const keys = Object.keys(args ?? {});
        if (keys.some((k) => k.startsWith('8:'))) {
          const bodyKey = keys.find((k) => k.startsWith('3:'));
          const dto = bodyKey
            ? (params[Number(bodyKey.split(':')[1])] as Ctor | undefined)
            : undefined;
          const file = {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
          };
          ApiConsumes('multipart/form-data')(ctrl.prototype, name, desc);
          ApiBody({
            schema: {
              allOf: [...(dto && !PRIMITIVES.has(dto) ? [{ $ref: getSchemaPath(dto) }] : []), file],
            },
          })(ctrl.prototype, name, desc);
        }
      }
    }
  }
}

/** Swagger em `/docs` (JSON em `/docs-json`). Desligado em produção, salvo `SWAGGER_ENABLED=true`. */
export function setupSwagger(app: INestApplication) {
  const enabled =
    process.env.SWAGGER_ENABLED !== undefined
      ? process.env.SWAGGER_ENABLED === 'true'
      : process.env.NODE_ENV !== 'production';
  if (!enabled) return false;

  documentRoutes(app);
  const config = new DocumentBuilder()
    .setTitle('AMMA API')
    .setDescription(
      'API da AMMA (corridas, entregas, associação e painel). O login é por OTP: `POST /auth/otp/request` e `POST /auth/otp/verify` devolvem o token; use "Authorize" com ele.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/, '')}_${method}`,
  });
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  return true;
}
