import { pgTable, text, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const qaRunsTable = pgTable("qa_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  appUrl: text("app_url").notNull(),
  appDescription: text("app_description").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  errorMessage: text("error_message"),
  report: jsonb("report"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQaRunSchema = createInsertSchema(qaRunsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQaRun = z.infer<typeof insertQaRunSchema>;
export type QaRun = typeof qaRunsTable.$inferSelect;
