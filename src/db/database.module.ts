import { Global, Module } from "@nestjs/common";
import { db } from "./client";

export const DATABASE = Symbol("DATABASE");

// Global so every feature module can `@Inject(DATABASE)` without importing
// this module explicitly everywhere - the underlying `db` is still the same
// singleton Drizzle instance from client.ts (one pg Pool for the process).
@Global()
@Module({
  providers: [{ provide: DATABASE, useValue: db }],
  exports: [DATABASE],
})
export class DatabaseModule {}
