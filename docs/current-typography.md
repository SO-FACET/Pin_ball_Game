# SO/ FACET — current typography hierarchy

Audited against the current `main` website on 20 November 2026. This guide describes the fonts and sizes in the live page styles. `clamp(min, viewport rule, max)` means the size changes continuously with viewport width. Page styles have different mobile breakpoints, so use the breakpoint shown for each row rather than treating the site as one fixed desktop/mobile scale.

## Font families in use

| Family in CSS | Current weights | Where it appears | Font files in the ZIP |
| --- | --- | --- | --- |
| **Josefin Sans** | Light 300, Regular 400, Semibold 600 | Default body and headings, navigation, game HUD, legal pages, account, and most labels | `fonts/Josefin Sans/Light.ttf`, `Regular.ttf`, `SemiBold.ttf` |
| **Brilliant Cut Pro** | Regular 400, Medium 500 | Buttons, loading cards, membership, About body, and reward artwork | `fonts/Brilliant Cut Pro/Regular.woff2`, `Medium.woff2` |
| **Fancy Cut Pro** | Regular 400 | Reward, membership, and About editorial text | `fonts/Fancy Cut Pro/Regular.woff2` |
| **SO/ FACET wordmark** | Regular 400 | Inline brand names | `fonts/SO FACET Wordmark/Regular.otf` |

## Font file paths

| Family | Weight | Website source | ZIP file |
| --- | --- | --- | --- |
| Josefin Sans | 300 | `assets/fonts/sofacet-score-josefin-light.ttf` | `fonts/Josefin Sans/Light.ttf` |
| Josefin Sans | 400 | `assets/fonts/sofacet-score-josefin-regular.ttf` | `fonts/Josefin Sans/Regular.ttf` |
| Josefin Sans | 600 | `assets/fonts/sofacet-score-josefin-semibold.ttf` | `fonts/Josefin Sans/SemiBold.ttf` |
| Brilliant Cut Pro | 400 | `assets/loader-cards/BrilliantCutPro-Regular.woff2` | `fonts/Brilliant Cut Pro/Regular.woff2` |
| Brilliant Cut Pro | 500 | `assets/loader-cards/BrilliantCutPro-Medium.woff2` | `fonts/Brilliant Cut Pro/Medium.woff2` |
| Fancy Cut Pro | 400 | `assets/score-coins/fancy-400.woff2` | `fonts/Fancy Cut Pro/Regular.woff2` |
| SO/ FACET wordmark | 400 | `assets/fonts/policy-wordmark.otf` | `fonts/SO FACET Wordmark/Regular.otf` |

Shared CSS variables in `assets/typography.css`: `--font-body` and `--font-heading` use Josefin Sans; `--font-lead` uses Fancy Cut Pro; `--font-action` uses Brilliant Cut Pro; `--font-brand` uses the wordmark. The About page applies the same files through its page CSS. Use the wordmark only for the brand name, not for editorial copy.

## Desktop hierarchy

Desktop examples below use the wide layout; most page-specific desktop rules begin above 700–767 px. Sizes are CSS pixels.

| Level and use | Family / weight | Current desktop size and line height | Source |
| --- | --- | --- | --- |
| Brand wordmark | Wordmark 400 or SVG | Inline size inherits its context; header SVG is 160 px wide | `assets/typography.css`, `assets/navigation.css` |
| Display / page H1 | Josefin Sans 600 by default; Fancy 400 on About; Brilliant 400 on rewards | Page-specific, generally **42–104 px**; see page table | Global typography plus page CSS |
| Section H2 | Josefin Sans 600 by default; Fancy 400 on About | About **32–47 px**, feature sections **44–66 px**; FAQ **26 px** | About and FAQ styles |
| Story heading | Josefin Sans 600 | `clamp(24px, 2.15vw, 46px)`, line height **1.06** | `style.css` + `assets/typography.css` |
| Editorial lead | Fancy Cut Pro 400, including selected short leads and About copy | About intro `clamp(22px, 2vw, 28px)`, line height **1.5** | `assets/typography.css`, About styles |
| Body copy | Josefin Sans 400; About uses Brilliant 400 | Site base **16 px**; About **18 px / 1.5**; legal and cookie **16 px / 1.6** and **16 px / 1.5** respectively; story `clamp(16px, 1.28vw, 24px) / 1.4` | Page CSS |
| Navigation action | Josefin Sans 600 | Top bar **12–13 px**, line height **1** | `assets/navigation.css` |
| Primary button | Brilliant Cut Pro 500 in the shared action layer | Page-specific **10–17 px**; Notify **17 px / 24 px** | `assets/typography.css`, page CSS |
| Eyebrow / small label | Josefin Sans or Brilliant Cut Pro | Usually **11–14 px**; About section label **13 px** | Page CSS |
| Game HUD score | Josefin Sans 600 | `var(--score-size, 76px)`, line height **1** | `game-source/src/style.css` |
| Reward result amount | Fancy Cut Pro 400 | `calc(clamp(92px, 9.3vw, 143px) - 3px)` in the score page | `game-source/src/score-page.css` |

## Mobile hierarchy

These are the actual small-screen overrides, mostly at 600–767 px. Some readable body and control text stays at its desktop size.

The shared compact-screen rules at the end of `assets/typography.css` can supersede page-level sizes. At ≤600 px, on coarse pointers ≤767 px, and in short landscape viewports ≤950 px, they set selected display headings to **25 px**, section headings to **22 px**, supporting copy to **15 px**, and selected score figures to **54 px**. The page table below records each page's own responsive rules; check this final shared layer when implementing a matching screen.

| Level and use | Family / weight | Current mobile size and line height | Breakpoint / source |
| --- | --- | --- | --- |
| Brand wordmark | Wordmark 400 or SVG | Header SVG **118 px wide**; About text wordmark **24 px** | ≤600 px, navigation and About |
| Story heading | Josefin Sans 600 | `clamp(21px, 5.2vw, 29px) / 1.06` | ≤600 px portrait, `style.css` |
| Story body | Josefin Sans 400 | **16 px / 1.35**; opening/choice copy **15 px** | ≤600 px portrait, `style.css` |
| Navigation action | Josefin Sans 600 | Generally **10–12 px**; game Skip action **11 px** in the compact two-action header | ≤700 px, `assets/navigation.css` |
| About page H1 | Fancy Cut Pro 400 | `clamp(42px, 10.8vw, 54px) / 1.1` | ≤600 px, About |
| About section H2 | Fancy Cut Pro 400 | **32 px / 1.18**; collection heading `clamp(38px, 9.5vw, 46px)` | ≤600 px, About |
| About lead / body | Fancy 400 / Brilliant 400 | Intro **22 px / 1.5**; section labels **12 px**; body remains **18 px** | ≤600 px, About |
| Game HUD score | Josefin Sans 600 | `min(calc(var(--score-size, 76px) * .5), 48px)` in portrait | ≤1024 px portrait, game |
| Reward result heading | Brilliant Cut Pro 400 | `calc(clamp(38px, 8vw, 56px) - 2px) / 1.13` | ≤767 px, score page |
| Reward result amount | Fancy Cut Pro 400 | **91 px** on narrow phones; coin label **13 px** | ≤520 px, score page |
| Cookie notice | Josefin Sans 600 heading and 400 copy | Heading **21 px / 1.3**; body **16 px / 1.5**; option descriptions **13 px** | ≤650 px, cookie styles |
| Legal copy | Josefin Sans 400 | Heading falls to its **32 px** minimum; paragraphs stay **16 px / 1.6** | Fluid heading, legal CSS |

## Page-specific display and action sizes

| Page | Desktop display and supporting text | Mobile display and supporting text |
| --- | --- | --- |
| **Landing / entrance** | Opening welcome `clamp(18px, 1.35vw, 30px)`; story heading `clamp(24px, 2.15vw, 46px)`; story paragraph `clamp(16px, 1.28vw, 24px)` | At ≤1024 px/coarse pointer, opening welcome `clamp(20px, 3vw, 28px)`; at ≤600 px portrait, story heading `clamp(21px, 5.2vw, 29px)` and paragraph **16 px**. The large logo is artwork sized by width. |
| **About SO/ FACET** | Fancy H1 `clamp(54px, 6.1vw, 88px) / 1.08`; Fancy H2 `clamp(32px, 3vw, 47px)`; feature H2 `clamp(44px, 4.5vw, 66px)`; Brilliant body **18 px / 1.5** | At ≤600 px, H1 `clamp(42px, 10.8vw, 54px)`; H2 **32 px**; collection H2 `clamp(38px, 9.5vw, 46px)`; intro **22 px**; label **12 px**. |
| **Pinball and result** | Game HUD score **76 px** default; result amount `calc(clamp(92px, 9.3vw, 143px) - 3px)`; result heading `calc(clamp(39px, 4.25vw, 63px) - 2px)` | HUD portrait cap **48 px** using the half-scale rule; at ≤767 px result heading `calc(clamp(38px, 8vw, 56px) - 2px)`; at ≤520 px amount **91 px** and coin label **13 px**. |
| **Membership / save coins** | Brilliant claim heading `clamp(32px, 3vw, 47px) / 1.12`; Fancy save heading `clamp(34px, 4.4vw, 71px) / 1.06`; Fancy inputs **16 px** | At ≤700 px, claim heading `clamp(27px, 7vw, 34px)`; save heading `clamp(32px, 7.1vw, 43px) / 1.08`; inputs stay **16 px**. |
| **Notify me** | Josefin display `clamp(42px, 4.5vw, 64px) / 1.12`; Brilliant action **17 px / 24 px** | At ≤760 px, display `clamp(30px, 9.1vw, 42px)`; action **16 px**, join action **14 px / 20 px**. |
| **Launching soon** | Josefin H1 `clamp(64px, 6.2vw, 92px) / 1.04`; body **21 px / 1.65**; label **13 px** | At ≤600 px, H1 **54 px** (≤360 px: **47 px**); body **18 px** (≤360 px: **17 px**); label **11 px**. |
| **Account / dashboard** | Josefin page H1 `clamp(58px, 6.5vw, 86px)`; personal score `clamp(68px, 7.2vw, 96px)`; body **16 px / 1.5** | At ≤680 px, page H1 **57 px**, score **88 px**; at ≤360 px, H1 **50 px**, score **78 px**. Form inputs stay **16 px**. |
| **FAQ** | Josefin intro H1 **22 px**; panel H2 **26 px**; Josefin body **13 px**, intro paragraph **14 px / 1.5** | The FAQ keeps those text sizes at ≤700 px while the layout changes to one column. |
| **Legal pages** | Josefin H1 `clamp(32px, 3vw, 47px)`; H2 **20 px**; H3 **16.8 px**; body **16 px / 1.6** | The H1 reaches its **32 px** minimum on phones; body remains **16 px** for readability. |
| **Cookie notice** | Josefin H2 **23 px / 1.3** and body **16 px / 1.5**; Brilliant buttons **14 px / 1.25** | At ≤650 px, H2 **21 px**, option descriptions **13 px**; body and button size remain **16 px** and **14 px**. |
