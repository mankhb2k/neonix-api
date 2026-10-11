import { Global, Module } from "@nestjs/common";
import { db } from "./client";

export const DATABASE = Symbol("DATABASE");

@Global()
@Module({
  providers: [{ provide: DATABASE, useValue: db }],
  exports: [DATABASE],
})
export class DatabaseModule {}
