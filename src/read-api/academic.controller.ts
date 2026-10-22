import { Controller, Get, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { ReadRequest } from './auth.guard.js';
import { JavaJwtGuard } from './auth.guard.js';
import { ReadApiErrorFilter } from './error.filter.js';
import { AcademicReadService } from './academic.service.js';
import { ReviewReadService } from './review.service.js';
import { QuestionReadService } from './question.service.js';

@Controller('api/academic')
@UseGuards(JavaJwtGuard)
@UseFilters(ReadApiErrorFilter)
export class AcademicReadController {
  constructor(private readonly academic: AcademicReadService, private readonly questions: QuestionReadService, private readonly reviews: ReviewReadService) {}
  @Get('question-reviews') reviewQueue(@Req() r: ReadRequest, @Query() q: Record<string, unknown>) { return this.reviews.queue(r, q); }
  @Get('question-versions/:versionId/reviews') reviewHistory(@Req() r: ReadRequest, @Param('versionId') id: string) { return this.reviews.history(r, id); }
  @Get('tag-groups') groups(@Req() r: ReadRequest) { return this.academic.groups(r); }
  @Get('tag-groups/:id') group(@Req() r: ReadRequest, @Param('id') id: string) { return this.academic.groups(r, id); }
  @Get('tags/:id') tag(@Req() r: ReadRequest, @Param('id') id: string) { return this.academic.tags(r, id, false); }
  @Get(['tag-groups/:groupId/tags', 'tags/by-group/:groupId'])
  tags(@Req() r: ReadRequest, @Param('groupId') id: string) { return this.academic.tags(r, id, true, 'groupId'); }
  @Get('stimuli') stimuli(@Req() r: ReadRequest, @Query() q: Record<string, unknown>) { return this.academic.resources('stimulus', r, q); }
  @Get('stimuli/:id') stimulus(@Req() r: ReadRequest, @Param('id') id: string) { return this.academic.resources('stimulus', r, {}, id); }
  @Get('question-banks') banks(@Req() r: ReadRequest, @Query() q: Record<string, unknown>) { return this.academic.resources('question_bank', r, q); }
  @Get('question-banks/:id') bank(@Req() r: ReadRequest, @Param('id') id: string) { return this.academic.resources('question_bank', r, {}, id); }
  @Get('questions') list(@Req() r: ReadRequest, @Query() q: Record<string, unknown>) { return this.questions.list(r, q, false); }
  @Get('public/questions') catalog(@Req() r: ReadRequest, @Query() q: Record<string, unknown>) { return this.questions.list(r, q, true); }
  @Get('questions/:id') question(@Req() r: ReadRequest, @Param('id') id: string) { return this.questions.detail(r, id, false); }
  @Get('questions/:id/versions') versions(@Req() r: ReadRequest, @Param('id') id: string) { return this.questions.detail(r, id, true); }
}
