import { AssessmentExpiryService } from './assessment/expiry.service.js';
import { AssessmentCatalogController } from './assessment/catalog.controller.js';
import { AssessmentCatalogService } from './assessment/catalog.service.js';
import { AssessmentTakingController } from './assessment/taking.controller.js';
import { AssessmentTakingService } from './assessment/taking.service.js';
import { AssessmentAuthoringController } from './assessment/authoring.controller.js';
import { AssessmentAuthoringService } from './assessment/authoring.service.js';
import { AssessmentGuard } from './assessment/assessment.guard.js';
import { VocabularyController } from './vocabulary/vocabulary.controller.js';
import { VocabularyService } from './vocabulary/vocabulary.service.js';
import { VocabularyGuard } from './vocabulary/vocabulary.guard.js';
import { AcademicWorkflowService } from './academic-write/workflow.service.js';
import {
  AcademicWorkflowWriteController,
  AcademicWorkflowReadController,
} from './academic-write/workflow.controller.js';
import { QuestionWriteController } from './academic-write/question.controller.js';
import { QuestionWriteService } from './academic-write/question.service.js';
import { ResourceWriteController } from './academic-write/resource.controller.js';
import { ResourceWriteService } from './academic-write/resource.service.js';
import { CatalogWriteController } from './academic-write/catalog.controller.js';
import { CatalogWriteService } from './academic-write/catalog.service.js';
import { AcademicWriteGuard } from './academic-write/write.guard.js';
import { ReviewReadService } from './read-api/review.service.js';
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

@Module({
  controllers: [
    AssessmentCatalogController,
    AssessmentTakingController,
    AssessmentAuthoringController,
    VocabularyController,
    AcademicWorkflowWriteController,
    AcademicWorkflowReadController,
    QuestionWriteController,
    ResourceWriteController,
    CatalogWriteController,
    AppController,
    HealthController,
    ReadController,
    AcademicReadController,
  ],
  providers: [
    AssessmentExpiryService,
    AssessmentCatalogService,
    AssessmentTakingService,
    AssessmentAuthoringService,
    AssessmentGuard,
    VocabularyService,
    VocabularyGuard,
    AcademicWorkflowService,
    QuestionWriteService,
    ResourceWriteService,
    CatalogWriteService,
    AcademicWriteGuard,
    AppService,
    DatabaseService,
    JavaJwtGuard,
    ClassificationReadService,
    IdentityReadService,
    AcademicReadService,
    QuestionReadService,
    ReviewReadService,
  ],
})
export class AppModule {}
