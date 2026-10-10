import { Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module";
import { AppController } from "./app.controller";
import { AssetsModule } from "./assets/assets.module";
import { AuditEventsModule } from "./audit-events/audit-events.module";
import { BillingModule } from "./billing/billing.module";
import { DatabaseModule } from "./db/database.module";
import { ExportsModule } from "./exports/exports.module";
import { FontsModule } from "./fonts/fonts.module";
import { ProfileModule } from "./profile/profile.module";
import { ProjectsModule } from "./projects/projects.module";
import { SystemCatalogModule } from "./system-catalog/system-catalog.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    DatabaseModule,
    WorkspacesModule,
    ProjectsModule,
    AssetsModule,
    FontsModule,
    ExportsModule,
    AuditEventsModule,
    BillingModule,
    ApiKeysModule,
    ProfileModule,
    SystemCatalogModule,
    AccountModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
