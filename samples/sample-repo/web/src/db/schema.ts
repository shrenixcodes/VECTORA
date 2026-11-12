import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  email: text('email').notNull(),
});

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey(),
  ownerId: integer('owner_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
});
