import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { AssessmentGuard } from './assessment.guard.js';
import { AssessmentCatalogService } from './catalog.service.js';
@Controller('api/assessments')
@UseGuards(AssessmentGuard)
@UseFilters(ReadApiErrorFilter)
export class AssessmentCatalogController {
  constructor(private readonly service: AssessmentCatalogService) {}
  @Get('catalog') list(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('catalog', r, q);
  }
  @Get('catalog/facets') facets(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('facets', r, q);
  }
  @Get('catalog/:id') item(@Req() r: ReadRequest, @Param('id') id: string) {
    return this.service.read('item', r, {}, id);
  }
  @Get('my-attempts') history(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('history', r, q);
  }
  @Get('my-stats') stats(@Req() r: ReadRequest) {
    return this.service.read('stats', r);
  }
}
