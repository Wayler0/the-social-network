-- Reactions beyond like (v0.2, ROADMAP "After launch"). One reaction per member per post, kept
-- in the likes table: a v0.1 like is the reaction 'like'. No angry face on purpose: a campus
-- network that under-18s use should make piling on harder, not easier.
alter table likes add column reaction text not null default 'like'
  check (reaction in ('like', 'love', 'haha', 'wow', 'sad', 'support'));
