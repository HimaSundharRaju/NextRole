"use server";

import { z } from "zod";
import { authedAction } from "@/server/action";
import { listNotifications, markAllNotificationsRead } from "@/server/data/notifications";

export const fetchNotifications = authedAction(z.object({}), async (_input, user) => {
  const rows = await listNotifications(user.id, 15);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: Boolean(row.readAt),
    createdAt: row.createdAt.toISOString(),
  }));
});

export const markNotificationsRead = authedAction(z.object({}), async (_input, user) => {
  await markAllNotificationsRead(user.id);
  return null;
});
