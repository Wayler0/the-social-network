-- Story background colour (team request 25 Nov 2026): solid black by default, or one of the
-- app's colours for text stories. Photos always sit on black.
alter table stories
  add column background text not null default 'black'
    check (background in ('black', 'violet', 'coral', 'mint', 'sunshine', 'white'));
