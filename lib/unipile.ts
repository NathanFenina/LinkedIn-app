const DSN = process.env.UNIPILE_DSN!
const API_KEY = process.env.UNIPILE_API_KEY!
const BASE_URL = `https://${DSN}/api/v1`

async function unipileFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-KEY': API_KEY,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Unipile API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getChatAttendees(chatId: string) {
  const data = await unipileFetch(`/chats/${chatId}/attendees`)
  return (data.items || []) as RawAttendee[]
}

export async function getChatMessages(chatId: string, limit = 15) {
  const data = await unipileFetch(`/chats/${chatId}/messages?limit=${limit}`)
  return (data.items || []) as RawMessage[]
}

export async function getChats(accountId: string, limit = 50, cursor?: string) {
  const params = new URLSearchParams({ account_id: accountId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const data = await unipileFetch(`/chats?${params.toString()}`)
  return {
    items: (data.items || []) as RawChat[],
    cursor: (data.cursor as string | undefined) || undefined,
  }
}

export async function sendMessage(chatId: string, text: string) {
  return unipileFetch(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function getConnections(accountId: string, limit = 200, cursor?: string) {
  const params = new URLSearchParams({
    account_id: accountId,
    relation: 'CONTACT',
    limit: String(limit),
  })
  if (cursor) params.set('cursor', cursor)
  const data = await unipileFetch(`/users/relations?${params.toString()}`)
  return {
    items: (data.items || []) as RawConnection[],
    cursor: (data.cursor as string | undefined) || undefined,
  }
}

export async function startNewChat(accountId: string, linkedinUserId: string, text: string) {
  return unipileFetch(`/chats`, {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, attendees_ids: [linkedinUserId], text }),
  }) as Promise<{ id: string }>
}

// ---------------------------------------------------------------------------
// LinkedIn search (posts, jobs, people)
// Docs: POST {DSN}/api/v1/linkedin/search?account_id=...
// ---------------------------------------------------------------------------
export type LinkedInSearchCategory = 'posts' | 'jobs' | 'people' | 'companies'

export interface LinkedInSearchOptions {
  category: LinkedInSearchCategory
  keywords?: string
  api?: 'classic' | 'sales_navigator' | 'recruiter'
  sort_by?: 'relevance' | 'date'
  date_posted?: 'past_24h' | 'past_week' | 'past_month' | 'any_time'
  location?: string
  limit?: number
  cursor?: string
  // Job-specific
  job_type?: string[]
  experience?: string[]
  // Free-form extras passed straight to Unipile
  extra?: Record<string, unknown>
}

export async function searchLinkedIn<T = unknown>(
  accountId: string,
  options: LinkedInSearchOptions
): Promise<{ items: T[]; cursor?: string }> {
  const { extra, ...rest } = options
  const body = {
    api: options.api || 'classic',
    ...rest,
    ...(extra || {}),
  }
  const params = new URLSearchParams({ account_id: accountId })
  if (options.cursor) params.set('cursor', options.cursor)
  const data = await unipileFetch(`/linkedin/search?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    items: (data.items || []) as T[],
    cursor: (data.cursor as string | undefined) || undefined,
  }
}

// ---------------------------------------------------------------------------
// LinkedIn search parameter lookup (e.g., COMPANY id, LOCATION id)
// GET /linkedin/search/parameters?account_id=...&type=COMPANY&keywords=...
// ---------------------------------------------------------------------------
export interface RawSearchParameter {
  id: string
  title?: string
  subtitle?: string
}

export async function lookupSearchParameter(
  accountId: string,
  type: 'COMPANY' | 'LOCATION' | 'INDUSTRY' | 'SCHOOL' | 'PEOPLE' | 'SERVICE',
  keywords: string,
  limit = 10
): Promise<RawSearchParameter[]> {
  const params = new URLSearchParams({
    account_id: accountId,
    type,
    keywords,
    limit: String(limit),
  })
  const data = await unipileFetch(`/linkedin/search/parameters?${params.toString()}`)
  return (data.items || data || []) as RawSearchParameter[]
}

// ---------------------------------------------------------------------------
// LinkedIn invitation (connection request)
// POST /users/invite  body: { account_id, provider_id, message? }
// ---------------------------------------------------------------------------
export async function sendLinkedInInvitation(
  accountId: string,
  providerId: string,
  message?: string
) {
  return unipileFetch(`/users/invite`, {
    method: 'POST',
    body: JSON.stringify({
      account_id: accountId,
      provider_id: providerId,
      ...(message ? { message } : {}),
    }),
  })
}

// ---------------------------------------------------------------------------
// LinkedIn posts: retrieve, list comments, send comment
// ---------------------------------------------------------------------------
export interface RawPost {
  id?: string
  social_id?: string
  share_url?: string
  text?: string
  date?: string
  author?: {
    name?: string
    headline?: string
    profile_url?: string
    public_identifier?: string
    provider_id?: string
  }
}

export interface RawComment {
  id?: string
  text?: string
  date?: string
  author?: {
    name?: string
    headline?: string
    profile_url?: string
    public_identifier?: string
    provider_id?: string
  }
}

export async function getPost(accountId: string, postId: string): Promise<RawPost> {
  const data = await unipileFetch(`/posts/${encodeURIComponent(postId)}?account_id=${accountId}`)
  return data as RawPost
}

export async function getPostComments(
  accountId: string,
  socialId: string,
  cursor?: string,
  limit = 100
): Promise<{ items: RawComment[]; cursor?: string }> {
  const params = new URLSearchParams({ account_id: accountId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const data = await unipileFetch(
    `/posts/${encodeURIComponent(socialId)}/comments?${params.toString()}`
  )
  return {
    items: (data.items || []) as RawComment[],
    cursor: (data.cursor as string | undefined) || undefined,
  }
}

export async function sendPostComment(accountId: string, socialId: string, text: string) {
  return unipileFetch(`/posts/${encodeURIComponent(socialId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, text }),
  })
}

// Extract LinkedIn post ID/social_id from a post URL.
// Supported formats:
//   - urn:li:activity:1234567890 (old activity URN)
//   - linkedin.com/feed/update/urn:li:activity:1234567890
//   - linkedin.com/posts/foo_bar-activity-1234567890-XXX
//   - linkedin.com/posts/foo_bar-share-1234567890-XXX (modern share URL)
//   - linkedin.com/posts/foo_bar-ugcPost-1234567890-XXX
// We pick the LONGEST numeric run as a fallback in case none of the named
// patterns matches but the URL still contains a 16+ digit ID.
export function extractPostIdFromUrl(url: string): string | null {
  const activityMatch = url.match(/activity[-:]?(\d+)/i)
  if (activityMatch) return activityMatch[1]
  const ugcMatch = url.match(/ugcPost[-:]?(\d+)/i)
  if (ugcMatch) return ugcMatch[1]
  const shareMatch = url.match(/share[-:]?(\d+)/i)
  if (shareMatch) return shareMatch[1]
  // Last-resort fallback: pick the longest run of digits (LinkedIn post IDs
  // are typically 19 digits, much longer than any other number in the URL).
  const numbers = url.match(/\d{15,}/g)
  if (numbers && numbers.length) {
    return numbers.sort((a, b) => b.length - a.length)[0]
  }
  return null
}

// Raw types matching the actual Unipile API response
export interface RawChat {
  id: string
  account_id: string
  attendee_provider_id: string
  timestamp: string
  unread_count: number
}

export interface RawAttendee {
  id: string
  is_self: number
  name: string
  provider_id: string
  picture_url: string | null
  profile_url: string | null
  specifics?: {
    occupation?: string
    provider?: string
  }
}

export interface RawMessage {
  id: string
  chat_id: string
  text: string
  is_sender: number | boolean
  timestamp: string
  sender_id: string
}

export interface RawConnection {
  id: string
  provider_id?: string
  name?: string
  headline?: string
  profile_url?: string
  picture_url?: string
  first_name?: string
  last_name?: string
}
