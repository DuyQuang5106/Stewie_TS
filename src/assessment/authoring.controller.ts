import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { AssessmentGuard } from './assessment.guard.js';
import { AssessmentAuthoringService } from './authoring.service.js';
@Controller('api/assessments')
@UseGuards(AssessmentGuard)
@UseFilters(ReadApiErrorFilter)
export class AssessmentAuthoringController {
  constructor(private readonly service: AssessmentAuthoringService) {}
  @Get() list(@Req() r: ReadRequest, @Query() q: Record<string, unknown>) {
    return this.service.read('list', r, undefined, q);
  }
  @Get('my-assignments') mine(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('assignments', r, undefined, q);
  }
  @Get(':id') detail(@Req() r: ReadRequest, @Param('id') id: string) {
    return this.service.read('detail', r, id);
  }
  @Get(':id/submissions') submissions(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('submissions', r, id, q);
  }
  @Post() create(@Req() r: ReadRequest, @Body() b: unknown) {
    return this.service.write('create', r, undefined, b);
  }
  @Put(':id') update(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('update', r, id, b);
  }
  @Post(':id/publish') @HttpCode(200) publish(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.write('publish', r, id);
  }
  @Post(':id/close') @HttpCode(200) close(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.write('close', r, id);
  }
  @Post(':id/clone') clone(@Req() r: ReadRequest, @Param('id') id: string) {
    return this.service.write('clone', r, id);
  }
  @Post(':id/sections') section(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('section', r, id, b);
  }
  @Post('sections/:id/modules') module(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('module', r, id, b);
  }
  @Post('modules/:id/questions') question(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('question', r, id, b);
  }
  @Post(':id/assign') assign(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('assign', r, id, b);
  }
  @Put(':id/access-mode') access(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('access-mode', r, id, b);
  }
  @Post(':id/release-results') @HttpCode(200) release(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.write('release-results', r, id);
  }
}
