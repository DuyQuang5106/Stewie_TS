import {
  Body,
  Controller,
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
import { AcademicWriteGuard } from './write.guard.js';
import { QuestionWriteService } from './question.service.js';
@Controller('api/academic/questions')
@UseGuards(AcademicWriteGuard)
@UseFilters(ReadApiErrorFilter)
export class QuestionWriteController {
  constructor(private readonly questions: QuestionWriteService) {}
  @Post() create(@Req() r: ReadRequest, @Body() body: unknown) {
    return this.questions.write('create', r, undefined, body);
  }
  @Put(':id') update(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.questions.write('update', r, id, body);
  }
  @Post(':id/publish') @HttpCode(200) publish(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.questions.write('publish', r, id, body);
  }
  @Post(':id/revise') @HttpCode(200) revise(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.questions.write('revise', r, id);
  }
  @Post(':id/archive') @HttpCode(200) archive(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.questions.write('archive', r, id);
  }
  @Post(':id/restore') @HttpCode(200) restore(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.questions.write('restore', r, id);
  }
  @Post(':id/duplicate') @HttpCode(201) duplicate(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.questions.write('duplicate', r, id, body);
  }
  @Post(':id/transfer-ownership') @HttpCode(200) transfer_ownership(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.questions.write('transfer-ownership', r, id, body);
  }
}
