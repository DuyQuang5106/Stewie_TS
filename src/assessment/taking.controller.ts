import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { AssessmentGuard } from './assessment.guard.js';
import { AssessmentTakingService } from './taking.service.js';
@Controller('api/assessments')
@UseGuards(AssessmentGuard)
@UseFilters(ReadApiErrorFilter)
export class AssessmentTakingController {
  constructor(private readonly service: AssessmentTakingService) {}
  @Post(':id/start') start(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.start(r, id, b);
  }
  @Get('attempts/:id/resume') resume(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.read('resume', r, id);
  }
  @Get('attempts/:id/current-section') section(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.read('current-section', r, id);
  }
  @Get('attempts/:id/clock') clock(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.read('clock', r, id);
  }
  @Get('attempts/:id/result') result(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.read('result', r, id);
  }
  @Get('attempts/:id/review') review(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.read('review', r, id);
  }
  @Put('attempts/:id/answers') answers(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('answers', r, id, b);
  }
  @Put('attempts/:id/flag') flag(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('flag', r, id, b);
  }
  @Post('attempts/:id/question-time') @HttpCode(200) time(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('question-time', r, id, b);
  }
  @Post('attempts/:id/modules/:partId/complete') @HttpCode(200) completeModule(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Param('partId') part: string,
  ) {
    return this.service.write('module-complete', r, id, undefined, part);
  }
  @Post('attempts/:id/sections/:partId/complete')
  @HttpCode(200)
  completeSection(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Param('partId') part: string,
  ) {
    return this.service.write('section-complete', r, id, undefined, part);
  }
  @Post('attempts/:id/sections/:partId/start') @HttpCode(200) startSection(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Param('partId') part: string,
  ) {
    return this.service.write('section-start', r, id, undefined, part);
  }
  @Post('attempts/:id/submit') @HttpCode(200) submit(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.write('submit', r, id);
  }
}
