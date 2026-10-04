import { and, count, gte, lt } from 'drizzle-orm';
import { user } from '../../../../../../drizzle/schema';
import { db } from '../../../infrastructure/db';
export function getAccountCounts(sevenDaysAgo: Date, fourteenDaysAgo: Date) {
  const totalUsers = db.select({ count: count() }).from(user).get()!.count;
  const newUsersLast7Days = db
    .select({ count: count() })
    .from(user)
    .where(gte(user.createdAt, sevenDaysAgo))
    .get()!.count;
  const newUsersPrior7Days = db
    .select({ count: count() })
    .from(user)
    .where(and(gte(user.createdAt, fourteenDaysAgo), lt(user.createdAt, sevenDaysAgo)))
    .get()!.count;

  return { totalUsers, newUsersLast7Days, newUsersPrior7Days };
}
