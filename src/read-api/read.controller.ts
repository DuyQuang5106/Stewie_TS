import { Controller, Get, Req, Query, Param, UseGuards, UseFilters } from '@nestjs/common';
import { ClassificationReadService } from './classification.service.js';
import type { ReadRequest } from './auth.guard.js';
import { JavaJwtGuard } from './auth.guard.js';
import { ReadApiErrorFilter } from './error.filter.js';
import { IdentityReadService } from './identity.service.js';

@Controller('api')
@UseGuards(JavaJwtGuard)
@UseFilters(ReadApiErrorFilter)
export class ReadController {
  constructor(private readonly classifications: ClassificationReadService, private readonly identity: IdentityReadService) {}

  @Get('users/me')
  me(@Req() request: ReadRequest) { return request.user; }

  @Get('users/all')
  users(@Req() request: ReadRequest, @Query() query: Record<string, unknown>) {
    return this.identity.list(request, query);
  }

  @Get('users/by-email')
  userByEmail(@Req() request: ReadRequest, @Query('email') email: unknown) {
    return this.identity.find(request, 'email', email);
  }

  @Get('users/:id')
  userById(@Req() request: ReadRequest, @Param('id') id: string) {
    return this.identity.find(request, 'id', id);
  }

  @Get('academic/topics')
  topics(@Req() request: ReadRequest, @Query() query: Record<string, unknown>) {
    return this.classifications.list('topic', request, query);
  }

  @Get('academic/skills')
  skills(@Req() request: ReadRequest, @Query() query: Record<string, unknown>) {
    return this.classifications.list('skill', request, query);
  }

}
