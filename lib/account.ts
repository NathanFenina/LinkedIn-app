import { cookies } from 'next/headers'
import { getServerSupabase } from './supabase'

export const ACTIVE_ACCOUNT_COOKIE = 'active_linkedin_account'

export interface ResolvedAccount {
  id: string | null
  unipile_account_id: string
  label: string | null
  is_default: boolean
}

/**
 * Apply this filter to any table that has a nullable linkedin_account_id column.
 * Rules:
 *   - When the active account is the default one → show rows tagged with its id
 *     OR untagged rows (NULL). This makes legacy data created before multi-account
 *     visible on the default account.
 *   - On non-default accounts → strict match: only rows explicitly tagged with
 *     that account.
 *
 * Pass the supabase query builder; returns the modified builder.
 */
export function scopeQueryToAccount<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  account: ResolvedAccount,
  column = 'linkedin_account_id'
): T {
  if (!account.id) {
    // env-fallback account: don't filter at all (legacy single-account behavior)
    return query
  }
  if (account.is_default) {
    return query.or(`${column}.eq.${account.id},${column}.is.null`)
  }
  return query.eq(column, account.id)
}

/**
 * Resolves the active LinkedIn (Unipile) account_id for this request.
 * Priority: cookie → first row in DB → process.env.LINKEDIN_ACCOUNT_ID (legacy fallback).
 *
 * Throws if no account is configured at all so callers can return a clean 400.
 */
export async function getActiveAccount(): Promise<ResolvedAccount> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value

  const db = getServerSupabase()

  if (fromCookie) {
    const { data } = await db
      .from('linkedin_accounts')
      .select('id, label, unipile_account_id, is_default')
      .eq('id', fromCookie)
      .maybeSingle()
    if (data?.unipile_account_id) {
      return {
        id: data.id,
        unipile_account_id: data.unipile_account_id,
        label: data.label,
        is_default: !!data.is_default,
      }
    }
  }

  const { data: defaultRow } = await db
    .from('linkedin_accounts')
    .select('id, label, unipile_account_id, is_default')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (defaultRow?.unipile_account_id) {
    return {
      id: defaultRow.id,
      unipile_account_id: defaultRow.unipile_account_id,
      label: defaultRow.label,
      is_default: !!defaultRow.is_default,
    }
  }

  const envFallback = process.env.LINKEDIN_ACCOUNT_ID
  if (envFallback) {
    return { id: null, unipile_account_id: envFallback, label: 'Default (env)', is_default: true }
  }

  throw new Error(
    'Aucun compte LinkedIn configuré. Ajoute un compte dans Settings → Comptes LinkedIn.'
  )
}

export async function getActiveAccountId(): Promise<string> {
  const acc = await getActiveAccount()
  return acc.unipile_account_id
}

export async function getActiveAccountRowId(): Promise<string | null> {
  const acc = await getActiveAccount()
  return acc.id
}
