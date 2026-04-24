import { pgTable, text, timestamp, jsonb, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

// ─── QA Runs ─────────────────────────────────────────────────────────────────

export const qaRunsTable = pgTable("qa_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  runType: text("run_type", { enum: ["url", "sast"] }).notNull().default("url"),
  appUrl: text("app_url"),
  appDescription: text("app_description"),
  projectName: text("project_name"),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  errorMessage: text("error_message"),
  report: jsonb("report"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQaRunSchema = createInsertSchema(qaRunsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQaRun = z.infer<typeof insertQaRunSchema>;
export type QaRun = typeof qaRunsTable.$inferSelect;

// ─── Shareable Report Tokens ──────────────────────────────────────────────────
// A time-limited, unauthenticated read-only share link for a completed report.
// Security: token is a cryptographically random UUID, stored hashed is overkill
// for this use-case since the token itself is not a high-value credential.
// Expiry is enforced server-side on every access.

export const shareTokensTable = pgTable("share_tokens", {
  token: text("token").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("run_id").notNull().references(() => qaRunsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShareToken = typeof shareTokensTable.$inferSelect;

// ─── Issue Statuses ───────────────────────────────────────────────────────────
// Per-user, per-issue lifecycle tracking. issueIndex is the 0-based index
// of the issue in report.issues array.

export const issueStatusesTable = pgTable(
  "issue_statuses",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id").notNull().references(() => qaRunsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    issueIndex: integer("issue_index").notNull(),
    status: text("status", {
      enum: ["open", "acknowledged", "resolved", "wont_fix"],
    }).notNull().default("open"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("uniq_issue_status").on(t.runId, t.userId, t.issueIndex)],
);

export type IssueStatus = typeof issueStatusesTable.$inferSelect;
