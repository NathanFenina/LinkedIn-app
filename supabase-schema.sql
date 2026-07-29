-- LinkedIn CRM Schema
-- Run this in Supabase SQL Editor

-- Contacts table (connexions LinkedIn + interlocuteurs conversations)
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  profile_url TEXT,
  avatar_url TEXT,
  job_title TEXT,
  company TEXT,
  status TEXT DEFAULT 'not_contacted' CHECK (status IN (
    'not_contacted', 'to_contact', 'in_progress', 'treated', 'do_not_contact', 'prospect', 'client'
  )),
  score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 10),
  score_reason TEXT,
  notes TEXT,
  chat_id TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  is_sender_last BOOLEAN DEFAULT false,
  conversation_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profile visitors table
CREATE TABLE IF NOT EXISTS profile_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_id TEXT,
  name TEXT NOT NULL,
  profile_url TEXT,
  avatar_url TEXT,
  job_title TEXT,
  company TEXT,
  visited_at TIMESTAMPTZ DEFAULT NOW(),
  contacted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_score ON contacts(score DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_last_message_at ON contacts(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_visited_at ON profile_visitors(visited_at DESC);

-- How many messages have already been fetched for this chat (for "remonter plus" sync)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS messages_fetched INTEGER DEFAULT 0;
-- IA-suggested status (kept separate from manual status so user can override)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS suggested_status TEXT;

-- Message templates for quick replies
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS message_templates_updated_at ON message_templates;
CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Re-create the status CHECK to allow 'treated' on existing DBs
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_status_check CHECK (status IN (
  'not_contacted', 'to_contact', 'in_progress', 'treated', 'do_not_contact', 'prospect', 'client'
));

-- ===========================================================================
-- Feature: full message history per conversation (resolves "load more messages")
-- ===========================================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  unipile_message_id TEXT UNIQUE,
  text TEXT,
  is_sender BOOLEAN NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, sent_at DESC);

-- ===========================================================================
-- Feature 5: signal mining (intent posts)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS signal_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_id TEXT UNIQUE,
  post_url TEXT,
  author_name TEXT,
  author_headline TEXT,
  author_profile_url TEXT,
  author_provider_id TEXT,
  content TEXT,
  posted_at TIMESTAMPTZ,
  matched_keyword TEXT,
  is_real_signal BOOLEAN,
  qualification_reason TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'commented', 'dmed', 'ignored')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signal_posts_status ON signal_posts(status);
CREATE INDEX IF NOT EXISTS idx_signal_posts_posted_at ON signal_posts(posted_at DESC);

DROP TRIGGER IF EXISTS signal_posts_updated_at ON signal_posts;
CREATE TRIGGER signal_posts_updated_at
  BEFORE UPDATE ON signal_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===========================================================================
-- Feature 6: job postings → reach decision-makers
-- ===========================================================================
CREATE TABLE IF NOT EXISTS job_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unipile_job_id TEXT UNIQUE,
  title TEXT,
  company TEXT,
  company_url TEXT,
  location TEXT,
  job_url TEXT,
  posted_at TIMESTAMPTZ,
  matched_keyword TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'contacted', 'ignored')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_job_postings_posted_at ON job_postings(posted_at DESC);

DROP TRIGGER IF EXISTS job_postings_updated_at ON job_postings;
CREATE TRIGGER job_postings_updated_at
  BEFORE UPDATE ON job_postings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===========================================================================
-- Feature 1: lead magnet automation on post comments
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lead_magnet_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  post_url TEXT NOT NULL,
  social_id TEXT,
  trigger_keyword TEXT,
  message_template TEXT NOT NULL,
  magnet_url TEXT,
  active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS lead_magnet_campaigns_updated_at ON lead_magnet_campaigns;
CREATE TRIGGER lead_magnet_campaigns_updated_at
  BEFORE UPDATE ON lead_magnet_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS lead_magnet_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES lead_magnet_campaigns(id) ON DELETE CASCADE,
  commenter_provider_id TEXT,
  commenter_name TEXT,
  commenter_profile_url TEXT,
  comment_text TEXT,
  message_sent TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (campaign_id, commenter_provider_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_sends_campaign ON lead_magnet_sends(campaign_id);

-- ===========================================================================
-- Feature 4: competitor outreach (commenters of competitor posts → invite)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS competitor_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT,
  post_url TEXT NOT NULL,
  social_id TEXT,
  notes TEXT,
  last_run_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS competitor_targets_updated_at ON competitor_targets;
CREATE TRIGGER competitor_targets_updated_at BEFORE UPDATE ON competitor_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS competitor_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID REFERENCES competitor_targets(id) ON DELETE CASCADE,
  commenter_provider_id TEXT,
  commenter_name TEXT,
  commenter_headline TEXT,
  commenter_profile_url TEXT,
  comment_text TEXT,
  commented_at TIMESTAMPTZ,
  score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 10),
  score_reason TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'invited', 'connected', 'ignored')),
  invitation_message TEXT,
  invited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (target_id, commenter_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_leads_target ON competitor_leads(target_id);
CREATE INDEX IF NOT EXISTS idx_competitor_leads_status ON competitor_leads(status);
CREATE INDEX IF NOT EXISTS idx_competitor_leads_score ON competitor_leads(score DESC);

DROP TRIGGER IF EXISTS competitor_leads_updated_at ON competitor_leads;
CREATE TRIGGER competitor_leads_updated_at BEFORE UPDATE ON competitor_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===========================================================================
-- Multi-account: plusieurs comptes LinkedIn (Unipile) gérés depuis l'UI.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS linkedin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  unipile_account_id TEXT NOT NULL UNIQUE,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS linkedin_accounts_updated_at ON linkedin_accounts;
CREATE TRIGGER linkedin_accounts_updated_at BEFORE UPDATE ON linkedin_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tag chaque entité par le compte LinkedIn dont elle vient (NULL = legacy / global).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL;
ALTER TABLE profile_visitors ADD COLUMN IF NOT EXISTS linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL;
ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL;
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL;
ALTER TABLE lead_magnet_campaigns ADD COLUMN IF NOT EXISTS linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL;
ALTER TABLE competitor_targets ADD COLUMN IF NOT EXISTS linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_visitors_account ON profile_visitors(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_signal_posts_account ON signal_posts(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_account ON job_postings(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_lead_magnet_campaigns_account ON lead_magnet_campaigns(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_competitor_targets_account ON competitor_targets(linkedin_account_id);

-- ===========================================================================
-- Lead magnet: seuil minimum de commentaires pour déclencher.
-- ===========================================================================
ALTER TABLE lead_magnet_campaigns ADD COLUMN IF NOT EXISTS min_comments INTEGER DEFAULT 0;
ALTER TABLE lead_magnet_campaigns ADD COLUMN IF NOT EXISTS auto_run BOOLEAN DEFAULT false;

-- ===========================================================================
-- Competitor: critères de scoring déterministes (avant IA) sur le target.
-- ===========================================================================
ALTER TABLE competitor_targets ADD COLUMN IF NOT EXISTS job_title_keywords TEXT[];
ALTER TABLE competitor_targets ADD COLUMN IF NOT EXISTS company_size_tags TEXT[];

-- ===========================================================================
-- Visitors : IA scoring + invitation tracking
-- ===========================================================================
ALTER TABLE profile_visitors ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE profile_visitors ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 10);
ALTER TABLE profile_visitors ADD COLUMN IF NOT EXISTS score_reason TEXT;
ALTER TABLE profile_visitors ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE profile_visitors ADD COLUMN IF NOT EXISTS invitation_message TEXT;
CREATE INDEX IF NOT EXISTS idx_visitors_score ON profile_visitors(score DESC);

-- ===========================================================================
-- Feature 6: auto-comment (commente les posts <24h d'une liste de membres)
-- Remplace le workflow N8N "AUTO-COMMENTS". La liste de membres = les
-- provider_ids LinkedIn (ACoAA...) extraits d'une recherche facettée.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS comment_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE SET NULL,
  -- Liste des provider_ids LinkedIn (ACoAA...) des membres à suivre.
  member_ids TEXT[] NOT NULL DEFAULT '{}',
  -- Plafond de commentaires postés par jour (garde-fou anti-blocage).
  daily_cap INTEGER NOT NULL DEFAULT 15,
  -- Nb de commentaires postés par appel. 1 = le runner de session (GitHub
  -- Actions) espace lui-même chaque commentaire (voir min/max_delay_sec).
  max_per_run INTEGER NOT NULL DEFAULT 1,
  -- Espacement aléatoire entre 2 commentaires d'une session (secondes).
  -- Défaut 180–240s = 3–4 min, comme demandé.
  min_delay_sec INTEGER NOT NULL DEFAULT 180,
  max_delay_sec INTEGER NOT NULL DEFAULT 240,
  -- Fenêtre horaire de posting (heure locale serveur, UTC). NULL = pas de limite.
  active_hour_start INTEGER,
  active_hour_end INTEGER,
  -- Aussi liker le post en plus de le commenter (comme l'ancien workflow).
  also_like BOOLEAN NOT NULL DEFAULT true,
  -- Autoriser 1 mention auto-promo (Decupler) dans ~20% des commentaires.
  allow_self_promo BOOLEAN NOT NULL DEFAULT false,
  -- Consignes libres injectées dans le prompt (ton, longueur, sujets à éviter…).
  instructions TEXT,
  active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS comment_campaigns_updated_at ON comment_campaigns;
CREATE TRIGGER comment_campaigns_updated_at
  BEFORE UPDATE ON comment_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS comment_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES comment_campaigns(id) ON DELETE CASCADE,
  post_social_id TEXT NOT NULL,
  post_url TEXT,
  author_name TEXT,
  author_id TEXT,
  post_excerpt TEXT,
  comment_text TEXT,
  liked BOOLEAN DEFAULT false,
  -- 'sent' = posté ; 'error' = échec Unipile/IA.
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Anti-doublon : 1 seul commentaire par post et par campagne.
  UNIQUE (campaign_id, post_social_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_sends_campaign ON comment_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_comment_sends_created ON comment_sends(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_campaigns_account ON comment_campaigns(linkedin_account_id);

NOTIFY pgrst, 'reload schema';
