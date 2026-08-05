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

// ---------------------------------------------------------------------------
// Auto-comment: search posts by member list, react (like), post comment.
// Mirrors the proven N8N "AUTO-COMMENTS" flow:
//   POST /linkedin/search  body {url}  → Unipile accepts a raw faceted URL
//   POST /posts/reaction   body {account_id, post_id, reaction_type}
// ---------------------------------------------------------------------------

export interface SearchPost {
  author_name: string
  author_id: string
  post_content: string
  url: string
  social_id: string
  type: string
  posted_at: string | null
}

// Build the LinkedIn faceted content-search URL for a set of member provider_ids,
// filtered to the last 24h and sorted by recency (exact format Unipile expects).
export function buildMemberSearchUrl(memberIds: string[]): string {
  const clean = memberIds.map((m) => m.trim()).filter((m) => m.startsWith('ACo'))
  const encoded = encodeURIComponent(JSON.stringify(clean))
  return `https://www.linkedin.com/search/results/content/?datePosted=%22past-24h%22&fromMember=${encoded}&origin=FACETED_SEARCH&sid=SM%40&sortBy=%22date_posted%22`
}

// Extract the fromMember=[...] provider_ids out of a pasted LinkedIn search URL.
// Lets the user paste their existing saved-search URL instead of raw IDs.
export function extractMemberIdsFromSearchUrl(input: string): string[] {
  // Grab every ACoAA... token; works whether the URL is encoded or not.
  const matches = input.match(/ACoAA[A-Za-z0-9_-]+/g)
  if (!matches) return []
  return Array.from(new Set(matches))
}

// Extract individual LinkedIn POST urls from a blob of pasted text (WhatsApp
// dumps, notes…). Matches /posts/ and /feed/update/ links; excludes /search/.
export function extractPostUrls(input: string): string[] {
  const matches =
    input.match(/https?:\/\/(?:[\w.-]*\.)?linkedin\.com\/(?:posts|feed\/update)\/[^\s"'<>]+/gi) || []
  // Strip trailing punctuation / query cruft, dedupe.
  const cleaned = matches.map((u) => u.replace(/[).,]+$/, ''))
  return Array.from(new Set(cleaned))
}

// One page of the content search. Pass the faceted URL as body {url}.
export async function searchPostsBySearchUrl(
  accountId: string,
  searchUrl: string,
  cursor?: string
): Promise<{ items: SearchPost[]; cursor?: string }> {
  const params = new URLSearchParams({ account_id: accountId })
  if (cursor) params.set('cursor', cursor)
  const data = await unipileFetch(`/linkedin/search?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({ url: searchUrl }),
  })
  const rawItems = (data.items || []) as Array<Record<string, unknown>>
  const items: SearchPost[] = rawItems.map((p) => {
    const author = (p.author || {}) as Record<string, unknown>
    const shareUrl = (p.share_url as string) || ''
    return {
      author_name: (author.name as string) || '',
      author_id: (author.id as string) || '',
      post_content: (p.text as string) || '',
      url: shareUrl.split('?')[0],
      social_id: (p.social_id as string) || (p.id as string) || '',
      type: (p.type as string) || '',
      posted_at: (p.parsed_datetime as string) || (p.date as string) || null,
    }
  })
  return { items, cursor: (data.cursor as string | undefined) || undefined }
}

// ---------------------------------------------------------------------------
// LinkedIn invitations REÇUES : lister + accepter/décliner
//   GET  /users/invite/received?account_id=...
//   POST /users/invite/received/{invitation_id}
//        body { provider:"LINKEDIN", account_id, action:"accept"|"decline", shared_secret }
// ---------------------------------------------------------------------------
export interface RawReceivedInvitation {
  id: string
  invited_user?: string | null
  date?: string
  parsed_datetime?: string | null
  invitation_text?: string | null
  inviter?: {
    inviter_name?: string
    inviter_id?: string
    inviter_public_identifier?: string
    inviter_description?: string | null
  }
  specifics?: { provider?: string; shared_secret?: string }
}

export interface NormalizedInvitation {
  id: string
  name: string | null
  headline: string | null
  provider_id: string | null
  public_identifier: string | null
  message: string | null
  date: string | null
  shared_secret: string | null
}

export function normalizeInvitation(i: RawReceivedInvitation): NormalizedInvitation {
  const inv = i.inviter || {}
  return {
    id: i.id,
    name: inv.inviter_name || null,
    headline: inv.inviter_description || null,
    provider_id: inv.inviter_id || null,
    public_identifier: inv.inviter_public_identifier || null,
    message: i.invitation_text || null,
    date: i.parsed_datetime || i.date || null,
    shared_secret: i.specifics?.shared_secret || null,
  }
}

export async function getReceivedInvitations(
  accountId: string,
  cursor?: string,
  limit = 100
): Promise<{ items: NormalizedInvitation[]; cursor?: string }> {
  const params = new URLSearchParams({ account_id: accountId, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const data = await unipileFetch(`/users/invite/received?${params.toString()}`)
  const raw = (data.items || []) as RawReceivedInvitation[]
  return {
    items: raw.map(normalizeInvitation),
    cursor: (data.cursor as string | undefined) || undefined,
  }
}

export async function handleInvitation(
  accountId: string,
  invitationId: string,
  action: 'accept' | 'decline',
  sharedSecret?: string | null
) {
  return unipileFetch(`/users/invite/received/${encodeURIComponent(invitationId)}`, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'LINKEDIN',
      account_id: accountId,
      action,
      ...(sharedSecret ? { shared_secret: sharedSecret } : {}),
    }),
  })
}

export async function likePost(accountId: string, socialId: string, reaction = 'like') {
  return unipileFetch(`/posts/reaction`, {
    method: 'POST',
    body: JSON.stringify({
      account_id: accountId,
      post_id: socialId,
      reaction_type: reaction,
    }),
  })
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
