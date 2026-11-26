-- Alumni keep access (CLAUDE.md section 5, answered 25 Nov 2026): the university closes the student
-- email right after graduation, so a member can link a personal email while their campus email
-- still works, and sign in with it later. Only ever set after a code sent to it is entered.
-- Private: shown only to the member (and in their data export); never used to create accounts.
alter table users add column personal_email text check (personal_email = lower(personal_email)),
                  add column personal_email_linked_at timestamptz;
create unique index users_personal_email_key on users (personal_email) where personal_email is not null;

-- Codes that link a personal email belong to the signed-in member who asked for them.
alter table auth_codes add column user_id uuid references users (id) on delete cascade;
alter table auth_codes drop constraint auth_codes_purpose_check;
alter table auth_codes add constraint auth_codes_purpose_check check (purpose in ('sign_in', 'change_email', 'link_email'));
alter table auth_codes add constraint auth_codes_link_has_user check (purpose <> 'link_email' or user_id is not null);
