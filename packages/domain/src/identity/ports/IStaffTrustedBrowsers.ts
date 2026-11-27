/**
 * The browsers an account told to skip the e-mailed code (OOC-154). Better
 * Auth's `twoFactor` plugin keeps one row per browser; this port only counts
 * them and forgets them, never creates one — trusting happens in the sign-in
 * challenge itself, behind the cargo check in apps/api's auth catch-all.
 */
export interface IStaffTrustedBrowsers {
  /** Browsers still trusted (not expired) for the account. */
  count(userId: string): Promise<number>;
  /** Forgets every trusted browser of the account; answers how many there were. */
  forgetAll(userId: string): Promise<number>;
}
