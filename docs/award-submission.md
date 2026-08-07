# JuristAI — Tech Award Submission Materials

Language: English (jury default). Uzbek/Russian versions on request.

---

## Platform Description (~200 words, for the application form)

**JuristAI** is an AI legal assistant built for Uzbekistan — a country of 37
million people with roughly one lawyer per 3,000 citizens. Available as a
Telegram bot and a web platform, JuristAI answers legal questions, explains
uploaded documents in plain language, drafts legal documents from templates,
and produces formal legal opinions — in Uzbek and Russian.

What makes JuristAI different is that it treats **citation accuracy as an
engineering problem, not a disclaimer**. Every legal act an answer relies on
is verified live against lex.uz, the national legislation database: the
system extracts each cited decree and law from the user's document, resolves
it on lex.uz through an identity-verification gate (document number, adoption
year, in-force status), and grounds its analysis only on confirmed, currently
effective law. When an act cannot be verified, the opinion says so explicitly
— with the reason — instead of guessing. Repealed legislation is flagged,
every source is a clickable lex.uz link, and users can flag any inaccuracy
for expert review, feeding a continuously corrected legal corpus.

The result: legal help that costs a fraction of a consultation, answers in
seconds, and shows its sources — making first-line legal knowledge accessible
to citizens and small businesses across Uzbekistan.

---

## Video Script — 3:00 cut (~420 words VO)

**Format:** voiceover + screen recordings. Timings are targets.

### [0:00–0:20 — THE PROBLEM]
*Visual: street scenes of Tashkent, a person staring at a dense legal
document; a phone with an unanswered question typed out.*

**VO:** In Uzbekistan, there is roughly one lawyer for every three thousand
people. For most citizens, a legal question means days of searching,
conflicting advice, or an expensive consultation. And getting it wrong — a
repealed decree, a misquoted article — has real consequences.

### [0:20–0:40 — THE IDEA]
*Visual: JuristAI logo animates in. Split screen: Telegram bot on a phone,
web dashboard on a laptop.*

**VO:** JuristAI is an AI legal assistant built for Uzbek law, in Uzbek and
Russian. Ask a question in Telegram or on the web — and get an answer
grounded in the actual legislation of the Republic of Uzbekistan, with
sources you can click and check.

### [0:40–1:10 — HOW IT'S DIFFERENT]
*Visual: animation — a question flows into a pipeline: "Corpus search →
lex.uz verification → cited answer". Show a real answer with its sources
list of lex.uz links.*

**VO:** Every AI can produce a confident answer. JuristAI produces a
**verified** one. Behind every response is a retrieval system built on the
national legal database — and a verification layer that checks each cited law
directly on lex.uz: the correct document number, the correct year, and
whether it is still in force. Repealed law gets flagged. Unverifiable claims
are labeled honestly, never invented. Every source in the answer is a live
link to the official text.

### [1:10–2:00 — THE FLAGSHIP: LEGAL OPINIONS]
*Visual: screen recording — a 25-page report is uploaded; progress
indicators; the finished opinion scrolls: Masala, Faktlar, Qo'llaniladigan
huquq, Tahlil, Xulosa, Manbalar. Zoom on a line citing a decree with its
clause number.*

**VO:** Upload a contract or a report, and JuristAI writes a formal legal
opinion in classic legal-memo structure: the issue, the facts clause by
clause, the applicable law, the analysis, and a reasoned conclusion. The
system reads the whole document, extracts every legal act it cites — even
informal references — finds each one on lex.uz, confirms its identity and
validity, and applies the real text of the law to the real clauses of your
document. What used to take a legal department days now takes minutes — at
the cost of a cup of coffee.

### [2:00–2:30 — THE ECOSYSTEM]
*Visual: quick cuts — document drafting from a template; a photo of a
document being explained in simple words; a user selecting text and flagging
an error; admin dashboard with the correction loop.*

**VO:** JuristAI also drafts legal documents, explains complex paperwork in
plain language, and reads scanned files. And it learns: users can flag any
inaccuracy directly in the answer — flagged content goes to legal experts,
and corrections flow back into the knowledge base. Accuracy is not a
promise. It is a process.

### [2:30–3:00 — THE VISION]
*Visual: map of Uzbekistan lighting up; usage counter; closing card — logo,
@yuristga_savolbot, web address.*

**VO:** Our goal is simple: first-line legal knowledge for every citizen and
every small business — affordable, in their language, and always backed by
the law as it stands today. JuristAI. The law, verified.

---

## Video Script — 60-second cut (~150 words VO)

Tight version for awards that cap submissions at one minute. One continuous
screen-recording aesthetic; no B-roll needed.

### [0:00–0:10 — HOOK]
*Visual: a legal question typed into Telegram; instant answer appears with
lex.uz source links.*

**VO:** One lawyer for every three thousand people — that's Uzbekistan.
JuristAI is the AI legal assistant closing that gap.

### [0:10–0:30 — THE DIFFERENCE]
*Visual: pipeline animation compressed to 5 seconds; an answer's source list;
a repealed-law warning badge.*

**VO:** Any AI can sound confident. JuristAI verifies. Every cited law is
checked live against the national legislation database — right number, right
year, still in force. Repealed law gets flagged. Unverifiable claims are
labeled, never invented.

### [0:30–0:50 — THE FLAGSHIP]
*Visual: 25-page report uploaded → finished legal opinion scrolls; zoom on a
verified citation and its lex.uz link.*

**VO:** Upload a twenty-five-page contract and receive a formal legal
opinion: issue, facts, applicable law, analysis, conclusion — every citation
confirmed on lex.uz, every source a clickable link. Days of legal work, in
minutes.

### [0:50–1:00 — CLOSE]
*Visual: closing card — logo, @yuristga_savolbot, web address.*

**VO:** Legal knowledge for every citizen, in their language, backed by the
law as it stands today. JuristAI. The law, verified.

---

## Production notes

- The strongest 15 seconds for a jury is the upload-to-opinion sequence
  (3-min cut: 1:10–1:25; 60-sec cut: 0:30–0:50). Rehearse that screen
  recording until flawless; use a real document with visible lex.uz links in
  the result.
- Live demo / Q&A one-liner: *"Every legal AI can answer. Ours is the one
  that checks the law is still in force before it does."*
- Closing tagline translations: *"Qonun — tasdiqlangan."* /
  *"Закон — проверено."*

---

## AI Video Generator Prompts (60-second cut, Uzbek voiceover)

Workflow that produces the best result with today's tools (Veo 3, Sora,
Runway Gen-4, Kling):

1. **Generate the B-roll clips below silently** (no dialogue in the prompt).
   AI models garble non-English speech and any on-screen text — let them do
   atmosphere only.
2. **Record the real product on screen** for Scenes 2–3 UI moments. AI cannot
   render your actual interface, and a jury can tell a mockup from a product.
   Blend: AI clip → real screen recording → AI clip.
3. **Record the Uzbek voiceover separately** (a human voice, or a TTS with
   real Uzbek support) and lay it over the edit. Do not ask the video model
   to speak Uzbek.

Global style (prepend to every prompt):

> Cinematic corporate tech film, 16:9, shallow depth of field, natural warm
> lighting mixed with cool screen glow, muted color grade with teal-and-amber
> accents, smooth slow camera movement, photorealistic, 4k, no on-screen
> text, no captions, no watermarks.

### Scene 1 — Hook (0:00–0:10) · 2 clips × 5s

**Clip 1A prompt:**
> Aerial drone shot slowly descending over Tashkent, Uzbekistan at golden
> hour: modern government buildings, wide avenues, crowds of small figures
> crossing a plaza. The city feels vast and busy. Slow push-in.

**Clip 1B prompt:**
> Close-up of a worried middle-aged man at a kitchen table at night, holding
> a thick stack of official documents, warm lamp light, his phone lying dark
> beside him. He rubs his forehead. Rack focus from the papers to the dark
> phone screen. Documentary realism.

**Uzbek VO (Scene 1):**
> Har uch ming kishiga — bitta yurist. Bu — O'zbekiston. JuristAI ana shu
> bo'shliqni to'ldirayotgan sun'iy intellektli yuridik yordamchidir.

### Scene 2 — The Difference (0:10–0:30) · 1 AI clip + real screen capture

**Clip 2A prompt (metaphor for verification):**
> Macro shot inside a vast dark archive of glowing document pages floating in
> rows like a library of light. A single beam scans across them; one document
> lights up green with a soft pulse, another flickers red and dims. Abstract,
> elegant, futuristic data-verification aesthetic, volumetric light, slow
> dolly forward. No text.

**Real footage 2B (do not generate):** screen recording — a chat answer
appearing with its sources list; cursor clicks a lex.uz link; the official
law page opens. Then a repealed-document warning badge in close-up.

**Uzbek VO (Scene 2):**
> Har qanday sun'iy intellekt ishonchli javob bera oladi. JuristAI esa —
> tekshiradi. Har bir keltirilgan qonun lex.uz milliy bazasida jonli
> tekshiriladi: raqami to'g'ri, yili to'g'ri va hozir ham kuchda. Bekor
> qilingan hujjatlar belgilanadi. Tasdiqlanmagan da'volar esa hech qachon
> o'ylab topilmaydi.

### Scene 3 — The Flagship (0:30–0:50) · 1 AI clip + real screen capture

**Clip 3A prompt (transition into the demo):**
> Over-the-shoulder shot of a young Uzbek professional woman in a modern
> office dragging a thick paper contract toward a laptop; as it reaches the
> screen the paper dissolves into particles of light flowing into the
> display. Cool blue screen glow on her face, cinematic, slow motion at the
> moment of dissolve. No readable text.

**Real footage 3B (do not generate):** screen recording — the upload, the
progress states, the finished opinion scrolling section by section (Masala →
Faktlar → Qo'llaniladigan huquq → Tahlil → Xulosa → Manbalar), ending on a
zoom into one verified citation and its lex.uz link.

**Uzbek VO (Scene 3):**
> Yigirma besh sahifalik shartnomani yuklang — va rasmiy yuridik xulosani
> oling: masala, faktlar, qo'llaniladigan huquq, tahlil va xulosa. Har bir
> iqtibos lex.uz'da tasdiqlangan, har bir manba — bosiladigan havola.
> Kunlab davom etadigan yuridik ish — endi bir necha daqiqada.

### Scene 4 — Close (0:50–1:00) · 1 clip × 5s + title card

**Clip 4A prompt:**
> Stylized dark map of Uzbekistan seen from above; points of warm light
> ignite one by one across cities and connect into a glowing network,
> starting from Tashkent and spreading to the whole country. Elegant,
> minimal, dark background, slow zoom out. No text, no labels.

**Title card (build in the editor, not the model):** logo,
`@yuristga_savolbot`, web address, tagline **"Qonun — tasdiqlangan."**

**Uzbek VO (Scene 4):**
> Har bir fuqaro uchun yuridik bilim — o'z tilida, bugungi kunda amalda
> bo'lgan qonunga tayangan holda. JuristAI. Qonun — tasdiqlangan.

### Practical notes

- **Negative prompt** (for models that accept one): text, captions,
  subtitles, watermark, logo, distorted faces, extra fingers, jerky motion.
- Generate 2–3 takes per clip and pick; AI video variance is high.
- Keep every AI clip ≤ 8 seconds — quality degrades on longer generations;
  the edit rhythm above never needs more.
- The Uzbek VO above is ~140 words — comfortably 60 seconds at a calm,
  confident pace. Ask the narrator for "measured, assured, not salesy."
- Music: minimal electronic pulse, swelling slightly at Scene 3's dissolve
  moment and resolving cleanly under the tagline.
