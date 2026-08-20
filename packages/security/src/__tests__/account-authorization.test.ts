import { describe, expect, it, vi } from 'vitest';
import type { Account, AccountMembership, MembershipRole, Principal } from '@gptrouter/contracts';
import { AccountAuthorizationService, AuthorizationError } from '../account-authorization.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');

function principal(id = 'principal-1'): Principal {
  return {
    principal_id: id,
    issuer: 'https://issuer.example.com',
    subject: `subject-${id}`,
    created_at: NOW,
    updated_at: NOW,
  };
}

function account(id = 'account-1'): Account {
  return { account_id: id, name: 'Test Account', created_at: NOW, updated_at: NOW };
}

function membership(overrides: Partial<AccountMembership> = {}): AccountMembership {
  return {
    membership_id: 'membership-1',
    account_id: 'account-1',
    principal_id: 'principal-1',
    role: 'member',
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function service(
  resolvedAccount: Account | null,
  resolvedMembership: AccountMembership | null
): AccountAuthorizationService {
  return new AccountAuthorizationService({
    accounts: { getAccount: vi.fn(async () => resolvedAccount) },
    memberships: { getMembership: vi.fn(async () => resolvedMembership) },
  });
}

async function expectDenied(
  resolvedAccount: Account | null,
  resolvedMembership: AccountMembership | null,
  minimumRole: MembershipRole = 'viewer'
): Promise<void> {
  const error = await service(resolvedAccount, resolvedMembership)
    .authorize(principal(), 'account-1', minimumRole)
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(AuthorizationError);
  expect(error).toMatchObject({ code: 'forbidden', message: 'Access denied' });
}

describe('AccountAuthorizationService', () => {
  it('authorizes an active same-account membership', async () => {
    const result = await service(account(), membership()).authorize(
      principal(),
      'account-1',
      'member'
    );
    expect(result.account.account_id).toBe('account-1');
    expect(result.membership.role).toBe('member');
  });

  it('denies a cross-account membership', async () => {
    await expectDenied(account(), membership({ account_id: 'foreign-account' }));
  });

  it.each(['suspended', 'revoked'] as const)('denies %s membership', async (status) => {
    await expectDenied(account(), membership({ status }));
  });

  it('denies insufficient role', async () => {
    await expectDenied(account(), membership({ role: 'member' }), 'admin');
  });

  it('uses the same public error for nonexistent account and missing membership', async () => {
    const missingAccount = await service(null, null)
      .authorize(principal(), 'account-1')
      .catch((caught: unknown) => caught);
    const missingMembership = await service(account(), null)
      .authorize(principal(), 'account-1')
      .catch((caught: unknown) => caught);

    expect(missingAccount).toMatchObject({ code: 'forbidden', message: 'Access denied' });
    expect(missingMembership).toMatchObject({ code: 'forbidden', message: 'Access denied' });
  });

  it('denies a membership for another principal even if repository data is malformed', async () => {
    await expectDenied(account(), membership({ principal_id: 'other-principal' }));
  });

  it.each([
    ['viewer', 'viewer'],
    ['member', 'viewer'],
    ['admin', 'member'],
    ['owner', 'admin'],
    ['owner', 'owner'],
  ] as Array<[MembershipRole, MembershipRole]>)(
    'accepts role %s for minimum %s',
    async (role, minimum) => {
      await expect(
        service(account(), membership({ role })).authorize(principal(), 'account-1', minimum)
      ).resolves.toBeTruthy();
    }
  );
});
