# Week 0 survey — results (read 16 Nov 2026)

Source: Google Form "Hatua campus survey (Week 0)" (questions in `survey.md`), 14 responses submitted by 16 Nov.
Numbers come from the form's summary page. No names, emails or other personal details are copied here.
For the Sunday 22 Nov briefing: each finding below should become a GitHub issue labelled `user-feedback`.

## ⚠️ Problem with the form: it collected emails

The form tells people "it's anonymous … we don't collect your name or email", and `survey.md` says email collection
is OFF. On 16 Nov the live form had **Collect email addresses: Verified** turned on (shown as "Required by Locked mode",
so the quiz/Locked mode setting probably turned it on). Every response is stored with the respondent's Google email,
including the 2 under-18 respondents.

To do (form owner):
1. Settings → Responses → Collect email addresses → **Do not collect** (turn off quiz/Locked mode first if it is locked).
2. Never export or share responses with the email column. The team decides whether to delete the stored emails
   (deleting responses removes them) or tell respondents.
3. Before sharing the form again, check the settings match `survey.md`.

## Who answered

- 14 responses: 12 said they are 18 or older; the 2 under-18s were stopped after question 1, as intended.
- Of the 12: Year 1: 3 · Year 2: 2 · Year 3: 2 · Year 4+: 4 · Staff: 1. No postgraduates or alumni.
- Only 3 freshers, so the sample under-represents the main audience for Ask a Senior.

## Results

| Question | Answers |
|---|---|
| Where do you get campus news? (12) | WhatsApp class groups 9 · official email 3 · notice boards 3 · friends 2 · social media 2 · student portal 0 |
| How often do you miss something important? (12; 1 = never, 5 = very often) | 1: 4 · 2: 2 · 3: 3 · 4: 1 · 5: 2 |
| What would you actually use? (8, not required) | Official campus news 7 · course/year groups 5 · market 4 · short videos 4 · jobs and internships 4 · Ask a Senior 3 · events 3 · map 3 · club pages 2 · private chat 2 |
| What annoys you about WhatsApp class groups? (9) | Important notices buried under many messages · off-topic chat and business talk · scam messages · stickers · late updates · having to be in many groups to get the news · group admins · one "nothing" |
| What could stop you joining? (12) | Privacy worries 7 · data/bundle cost 4 · phone storage 1 · staff seeing my posts 1 · too many apps 1 |
| Phone (12) | Android 10 · iPhone 2 |
| Getting online on campus (12) | Mostly Wi-Fi 8 · mobile data 2 · both equally 2 |
| Willing to test an early version (12) | Yes 9 · No 3 |
| Anything else? (7) | Work offline · jobs near campus · e-learning material, class notifications and cancellations · online classes · better meals · organise the app by course |

## Findings (one `user-feedback` issue each)

1. **Official news is the main reason to join.** 7 of 8 would use it, and WhatsApp (the current channel) buries
   notices. Keep the Today board and admin-only Announcements tabs central in v0.1. Consider letting class reps post
   class notices and cancellations (a request from the free-text answers).
2. **Privacy is the biggest barrier** (7 of 12). The privacy policy (#14) needs a short plain-language summary at
   sign-up: what we collect, that the university doesn't run the app, that staff can't see student-only groups or message
   students first. Our own survey collecting emails (above) is exactly the kind of thing that destroys this trust.
3. **Data cost matters** (4 of 12; one asked for offline use). Keep the app light: compressed images, the offline
   app shell (PR #53), and a data-saver mode before reels ship.
4. **Android first.** 10 of 12 on Android: run the week 2 tests on cheap Android phones; still check the 2 iPhones.
5. **Jobs, market and short videos have demand** (4 of 8 each), but they're not in v0.1. They support the
   v0.2/v0.3 order in ROADMAP "After launch". Jobs ties into sponsored job ads (CLAUDE.md section 8).
6. **Ask a Senior scored low (3 of 8)**, but only 3 freshers answered. Test it with freshers in the week 1 canvas
   round before drawing conclusions.
7. **Staff seeing posts worries only 1 person.** The student-first staff rules stay, but they aren't a main selling point.

## Limits

12 adult answers, and only 8 answered the feature question. Treat these as signals to check in interviews and the
canvas tests, not as proof. Two questions have duplicate options ("Wi-Fi/ campus WiFi" and "Campus Wi-Fi", and two
"Yes" options for testing), probably from editing an option after responses came in. They are combined above.
Merge them in the form.
