import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { JavaJwtGuard } from '../read-api/auth.guard.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { AcademicWriteGuard } from './write.guard.js';
import { AcademicWorkflowService } from './workflow.service.js';
@Controller('api/academic')
@UseGuards(AcademicWriteGuard)
@UseFilters(ReadApiErrorFilter)
export class AcademicWorkflowWriteController {
  constructor(private readonly workflow: AcademicWorkflowService) {}
  @Post('question-versions/:versionId/reviews') review(
    @Req() r: ReadRequest,
    @Param('versionId') id: string,
    @Body() b: unknown,
  ) {
    return this.workflow.review(r, id, b);
  }
  @Post('question-imports/validate') validate(
    @Req() r: ReadRequest,
    @Body() b: unknown,
  ) {
    return this.workflow.validate(r, b);
  }
  @Post('question-imports/:batchId/commit') @HttpCode(200) commit(
    @Req() r: ReadRequest,
    @Param('batchId') id: string,
  ) {
    return this.workflow.commit(r, id);
  }
}
@Controller('api/academic')
@UseGuards(JavaJwtGuard)
@UseFilters(ReadApiErrorFilter)
export class AcademicWorkflowReadController {
  constructor(private readonly workflow: AcademicWorkflowService) {}
  @Get('question-imports/:batchId') batch(
    @Req() r: ReadRequest,
    @Param('batchId') id: string,
  ) {
    return this.workflow.getBatch(r, id);
  }
  @Get('question-exports') export(
    @Req() r: ReadRequest,
    @Query() q: Record<string, unknown>,
  ) {
    return this.workflow.export(r, q);
  }
}
