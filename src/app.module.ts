import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';
import { JavaJwtGuard } from './read-api/auth.guard.js';
import { ReadController } from './read-api/read.controller.js';
import { ClassificationReadService } from './read-api/classification.service.js';
import { IdentityReadService } from './read-api/identity.service.js';
import { AcademicReadController } from './read-api/academic.controller.js';
import { AcademicReadService } from './read-api/academic.service.js';
import { QuestionReadService } from './read-api/question.service.js';

@Module({ controllers: [AppController, HealthController, ReadController, AcademicReadController], providers: [AppService, DatabaseService, JavaJwtGuard, ClassificationReadService, IdentityReadService, AcademicReadService, QuestionReadService] })
export class AppModule {}
