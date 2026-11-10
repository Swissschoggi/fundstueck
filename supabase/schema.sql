-- Supabase schema for Fundstück Auth, Favorites, and Deal Radar.

create table if not exists fundstueck_favorites (
  user_id uuid not null,
  listing_id text not null,
  source text,
  title text,
  price numeric,
  currency text,
  listing_url text,
  image_url text,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table if not exists fundstueck_price_history (
  id bigserial primary key,
  listing_id text not null,
  source text,
  title text,
  price numeric,
  currency text,
  recorded_at timestamptz not null default now()
);

create table if not exists fundstueck_deals (
  id bigserial primary key,
  listing_id text not null,
  source text,
  title text,
  old_price numeric,
  new_price numeric,
  currency text,
  drop_pct numeric,
  detected_at timestamptz not null default now()
);
