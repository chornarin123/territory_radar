import { timingSafeEqual } from 'node:crypto';
import { Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppConfig } from '../config/app-config.service.js';

const IS_PUBLIC = 'isPublic';

/** Exempts a route from the API key check (health checks only). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Every route requires `x-api-key: <API_KEY>` unless marked @Public().
 * One shared key is a stopgap: replace with per-officer auth before the app
 * leaves the pilot, since a key shipped in a mobile binary can be extracted.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: AppConfig,
  ) {
    this.expected = Buffer.from(config.get('API_KEY'));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = context.switchToHttp().getRequest<FastifyRequest>().headers['x-api-key'];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    if (given.length !== this.expected.length || !timingSafeEqual(given, this.expected)) {
      throw new UnauthorizedException('Missing or invalid x-api-key');
    }
    return true;
  }
}
