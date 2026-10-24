import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ReadRequest } from '../read-api/auth.guard.js';
import { ReadApiErrorFilter } from '../read-api/error.filter.js';
import { VocabularyGuard } from './vocabulary.guard.js';
import { VocabularyService } from './vocabulary.service.js';
@Controller('api/vocab')
@UseGuards(VocabularyGuard)
@UseFilters(ReadApiErrorFilter)
export class VocabularyController {
  constructor(private readonly service: VocabularyService) {}
  @Get('due') due(@Req() r: ReadRequest) {
    return this.service.read('due', r);
  }
  @Get('playlists') playlists(@Req() r: ReadRequest) {
    return this.service.read('playlists', r);
  }
  @Get('playlists/:id') playlist(
    @Req() r: ReadRequest,
    @Param('id') id: string,
  ) {
    return this.service.read('playlist', r, id);
  }
  @Get('playlists/:id/words') words(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
  ) {
    return this.service.read('words', r, id, q);
  }
  @Get('streak') streak(@Req() r: ReadRequest) {
    return this.service.read('streak', r);
  }
  @Get('lookup') lookup(@Req() r: ReadRequest, @Query('term') term: unknown) {
    return this.service.lookup(r, term);
  }
  @Post('playlists') create(@Req() r: ReadRequest, @Body() b: unknown) {
    return this.service.write('playlist', r, undefined, b);
  }
  @Post('playlists/:id/words') add(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('word', r, id, b);
  }
  @Post('words/:id/reviews') review(
    @Req() r: ReadRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.write('review', r, id, b);
  }
  @Delete('reviews/:id') undo(@Req() r: ReadRequest, @Param('id') id: string) {
    return this.service.write('undo', r, id);
  }
}
