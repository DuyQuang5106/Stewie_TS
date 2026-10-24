import {
  Controller,
  Get,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { AnalyticsGuard } from './analytics.guard.js';
import { StudentAnalyticsService } from './analytics.service.js';
@Controller('api/analytics/me')
@UseGuards(AnalyticsGuard)
@UseFilters(ReadApiErrorFilter)
export class StudentAnalyticsController {
  constructor(private readonly service: StudentAnalyticsService) {}
  @Get('assessment-history') history(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('assessment-history', r, q);
  }
  @Get('summary') summary(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('summary', r, q);
  }
  @Get('performance') performance(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('performance', r, q);
  }
  @Get('score-trend') trend(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('score-trend', r, q);
  }
  @Get('time-summary') time(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('time-summary', r, q);
  }
  @Get('recap') recap(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('recap', r, q);
  }
  @Get('next-practice') next(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('next-practice', r, q);
  }
}
