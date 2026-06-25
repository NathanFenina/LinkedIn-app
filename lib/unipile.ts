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
    const retryAfter = res.headers.get('retry-after')
    throw new Error(
      `Unipile API error ${res.status}${retryAfter ? ` (retry-after ${retryAfter}s)` : ''}: ${text}`
    )
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
  // Unipile's actual shape: `author` is a plain string (the display name) and
  // the structured fields live in `author_details`.
  author?: string
  author_details?: {
    id?: string
    is_company?: boolean
    headline?: string
    profile_url?: string
    network_distance?: string
    profile_picture_url?: string
    public_identifier?: string
  }
}

export interface NormalizedComment {
  commenter_provider_id: string | null
  commenter_name: string | null
  commenter_headline: string | null
  commenter_profile_url: string | null
  comment_text: string | null
  commented_at: string | null
}

export function normalizeComment(c: RawComment): NormalizedComment {
  const a = c.author_details || {}
  return {
    commenter_provider_id: a.id || a.public_identifier || null,
    commenter_name: typeof c.author === 'string' ? c.author : null,
    commenter_headline: a.headline || null,
    commenter_profile_url: a.profile_url || null,
    comment_text: c.text || null,
    commented_at: c.date || null,
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

// Like (or other reaction) a post. Mirrors the n8n "Send reaction" node:
//   POST /posts/reaction  body: { account_id, post_id, reaction_type }
export async function sendPostReaction(
  accountId: string,
  postId: string,
  reactionType = 'like'
) {
  return unipileFetch(`/posts/reaction`, {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, post_id: postId, reaction_type: reactionType }),
  })
}

// Run a raw LinkedIn search/feed URL through Unipile and get back the posts.
// Mirrors the n8n "LinkedIn Search" node: POST /linkedin/search?account_id=...&cursor=...
// with body { url: "<the search/feed URL>" }. Returns the posts + a pagination cursor.
export async function searchLinkedInByUrl(
  accountId: string,
  searchUrl: string,
  cursor?: string
): Promise<{ items: RawPost[]; cursor?: string }> {
  const params = new URLSearchParams({ account_id: accountId })
  if (cursor) params.set('cursor', cursor)
  const data = await unipileFetch(`/linkedin/search?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({ url: searchUrl }),
  })
  return {
    items: (data.items || []) as RawPost[],
    cursor: (data.cursor as string | undefined) || undefined,
  }
}

// Normalize a post coming from the search/feed endpoint into the fields the
// auto-comment engine needs. (LinkedIn post URLs carry tracking query params we drop.)
export interface NormalizedFeedPost {
  social_id: string | null
  post_url: string | null
  text: string | null
  author_name: string | null
  author_id: string | null
}

export function normalizeFeedPost(p: RawPost): NormalizedFeedPost {
  // The search payload nests author as an object with id/name (unlike comment
  // payloads where author is a plain string), and exposes share_url + social_id.
  const author = (p.author || {}) as { name?: string; id?: string; provider_id?: string }
  return {
    social_id: p.social_id || p.id || null,
    post_url: (p.share_url || '').split('?')[0] || null,
    text: p.text || null,
    author_name: author.name || null,
    author_id: author.id || author.provider_id || null,
  }
}

// Extract a LinkedIn post identifier from a post URL, in the exact format
// Unipile's /posts/{post_id} endpoint expects. Per Unipile docs:
//   - URLs containing "activity" → raw numeric ID  (e.g. "7332661864792854528")
//   - URLs containing "share"    → full URN        (e.g. "urn:li:share:1234")
//   - URLs containing "ugcPost"  → full URN        (e.g. "urn:li:ugcPost:1234")
// Returns null if no recognizable pattern is found.
export function extractPostIdFromUrl(url: string): string | null {
  // Activity → raw numeric ID
  const activityMatch = url.match(/activity[-:]?(\d+)/i)
  if (activityMatch) return activityMatch[1]
  // ugcPost → urn:li:ugcPost:ID
  const ugcMatch = url.match(/ugcPost[-:]?(\d+)/i)
  if (ugcMatch) return `urn:li:ugcPost:${ugcMatch[1]}`
  // share → urn:li:share:ID
  const shareMatch = url.match(/share[-:]?(\d+)/i)
  if (shareMatch) return `urn:li:share:${shareMatch[1]}`
  // Fallback: longest numeric run (LinkedIn post IDs are typically 19 digits).
  // Default to share URN since modern "/posts/" URLs use the share format.
  const numbers = url.match(/\d{15,}/g)
  if (numbers && numbers.length) {
    const longest = numbers.sort((a, b) => b.length - a.length)[0]
    return /\/posts\//i.test(url) ? `urn:li:share:${longest}` : longest
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
