import type {
  Account,
  AccountMembership,
  AccountRepository,
  MembershipRepository,
  MembershipRole,
  Principal,
} from '@gptrouter/contracts';

export type AuthorizationErrorCode = 'forbidden';

/**
 * Public authorization failures are deliberately non-enumerating: callers do
 * not learn whether a foreign account exists, whether a membership exists, or
 * which status/role check failed.
 */
export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode = 'forbidden';

  constructor() {
    super('Access denied');
    this.name = 'AuthorizationError';
  }
}

export interface AuthorizedAccountContext {
  principal: Principal;
  account: Account;
  membership: AccountMembership;
}

export interface AccountAuthorizationServiceDeps {
  accounts: Pick<AccountRepository, 'getAccount'>;
  memberships: Pick<MembershipRepository, 'getMembership'>;
}

const ROLE_RANK: Record<MembershipRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export class AccountAuthorizationService {
  constructor(private readonly deps: AccountAuthorizationServiceDeps) {}

  async authorize(
    principal: Principal,
    accountId: string,
    minimumRole: MembershipRole = 'viewer'
  ): Promise<AuthorizedAccountContext> {
    // Resolve account + membership independently so the public error surface is
    // identical for nonexistent and foreign accounts.
    const [account, membership] = await Promise.all([
      this.deps.accounts.getAccount(accountId),
      this.deps.memberships.getMembership(accountId, principal.principal_id),
    ]);

    if (
      !account ||
      !membership ||
      membership.account_id !== accountId ||
      membership.principal_id !== principal.principal_id ||
      membership.status !== 'active' ||
      ROLE_RANK[membership.role] < ROLE_RANK[minimumRole]
    ) {
      throw new AuthorizationError();
    }

    return { principal, account, membership };
  }
}
