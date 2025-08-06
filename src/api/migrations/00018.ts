import { pick } from '../../util/iteratees';
import { storage } from '../storages';

export async function start(activeAccountIds?: string[]) {
  if (!activeAccountIds || activeAccountIds.length === 0) {
    return;
  }

  const accounts: Record<string, any> | undefined = await storage.getItem('accounts');

  if (!accounts) {
    return;
  }

  await storage.setItem('accounts', pick(accounts, activeAccountIds));
}
