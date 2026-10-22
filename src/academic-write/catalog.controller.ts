import {
  Body,
  Controller,
  Delete,
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
import { CatalogWriteService } from './catalog.service.js';
import { AcademicWriteGuard } from './write.guard.js';

@Controller('api/academic')
@UseGuards(AcademicWriteGuard)
@UseFilters(ReadApiErrorFilter)
export class CatalogWriteController {
  constructor(private readonly catalog: CatalogWriteService) {}
  @Post('topics') createTopic(@Req() r: ReadRequest, @Body() body: unknown) {
    return this.catalog.write('topic', 'create', r, undefined, body);
  }
  @Put('topics/:id') updateTopic(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.write('topic', 'update', r, id, body);
  }
  @Post('topics/:id/archive') @HttpCode(200) archiveTopic(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.catalog.write('topic', 'archive', r, id);
  }
  @Post('topics/:id/restore') @HttpCode(200) restoreTopic(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.catalog.write('topic', 'restore', r, id);
  }
  @Post('skills') createSkill(@Req() r: ReadRequest, @Body() body: unknown) {
    return this.catalog.write('skill', 'create', r, undefined, body);
  }
  @Put('skills/:id') updateSkill(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.write('skill', 'update', r, id, body);
  }
  @Post('skills/:id/archive') @HttpCode(200) archiveSkill(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.catalog.write('skill', 'archive', r, id);
  }
  @Post('skills/:id/restore') @HttpCode(200) restoreSkill(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.catalog.write('skill', 'restore', r, id);
  }
  @Post('tag-groups') createGroup(
    @Req() r: ReadRequest,
    @Body() body: unknown,
  ) {
    return this.catalog.write('tag_group', 'create', r, undefined, body);
  }
  @Put('tag-groups/:id') updateGroup(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.write('tag_group', 'update', r, id, body);
  }
  @Delete('tag-groups/:id') @HttpCode(204) deleteGroup(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.catalog.write('tag_group', 'delete', r, id);
  }
  @Post('tags') createTag(@Req() r: ReadRequest, @Body() body: unknown) {
    return this.catalog.write('tag', 'create', r, undefined, body);
  }
  @Put('tags/:id') updateTag(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.write('tag', 'update', r, id, body);
  }
  @Delete('tags/:id') @HttpCode(204) deleteTag(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.catalog.write('tag', 'delete', r, id);
  }
}
