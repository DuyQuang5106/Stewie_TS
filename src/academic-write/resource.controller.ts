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
import { ResourceWriteService } from './resource.service.js';

@Controller('api/academic')
@UseGuards(AcademicWriteGuard)
@UseFilters(ReadApiErrorFilter)
export class ResourceWriteController {
  constructor(private readonly resources: ResourceWriteService) {}
  @Post('stimuli') createStimulus(@Req() r: ReadRequest, @Body() b: unknown) {
    return this.resources.write('stimulus', 'create', r, undefined, b);
  }
  @Put('stimuli/:id') updateStimulus(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.resources.write('stimulus', 'update', r, id, b);
  }
  @Post('stimuli/:id/publish') @HttpCode(200) publishStimulus(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.resources.write('stimulus', 'publish', r, id);
  }
  @Post('stimuli/:id/archive') @HttpCode(200) archiveStimulus(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.resources.write('stimulus', 'archive', r, id);
  }
  @Post('stimuli/:id/restore') @HttpCode(200) restoreStimulus(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.resources.write('stimulus', 'restore', r, id);
  }
  @Post('question-banks') createBank(
    @Req() r: ReadRequest,
    @Body() b: unknown,
  ) {
    return this.resources.write('question_bank', 'create', r, undefined, b);
  }
  @Put('question-banks/:id') updateBank(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.resources.write('question_bank', 'update', r, id, b);
  }
  @Post('question-banks/:id/archive') @HttpCode(200) archiveBank(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.resources.write('question_bank', 'archive', r, id);
  }
  @Post('question-banks/:id/restore') @HttpCode(200) restoreBank(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.resources.write('question_bank', 'restore', r, id);
  }
}
