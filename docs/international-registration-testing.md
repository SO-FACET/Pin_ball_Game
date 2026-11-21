# International registration: development testing

The game server and legacy API helper now use the existing libphonenumber parser. Signup resolves every country selector option instead of mapping only four dialing codes. Indian national numbers keep their existing default. OTP proof binding, age/consent requirements, account identity and reward rules are unchanged.

A companion backend fix on `abhi211195/so-facet-website` branch `development` preserves an explicitly supplied `+` country code. Without that fix in the test backend, some shorter numbers such as Singapore +65 are incorrectly prefixed with +91. Deploy both branches to isolated test services to verify all destinations; do not point a test game at a different backend without matching its private rewards key and policy URLs.

Automated HTTP tests use simulated OTP/profile/rewards APIs and temporary player stores. They cover signup, OTP verification, profile saving, crediting and returning-member login for India, US, UK, UAE, Singapore and Australia, plus malformed-number rejection. They do not prove real WhatsApp delivery or imply every destination is supported by Meta.

Manual acceptance:

1. Choose a country and use a real consenting test recipient; confirm the code arrives on WhatsApp.
2. Verify, save profile and score, then sign out and sign back in with the full international number.
3. Confirm the same member, score and rewards are retained, including an existing Indian member.
4. Check expired/wrong codes, resends and delivery failures. Failed verification must never save membership or award coins.
5. Confirm unknown/unsupported destinations show an actionable error. Account setup does not add international shipping or change redemption terms.

`development` is connected to the separate Pin_ball_Game Railway service at shopsofacet.com. The production facet-pinball service uses main and sofacet.com. This change does not update main or the live player data.

Validation: membership build and account/rewards/source-map tests pass. The broader test suite's media-delivery check requires Git LFS video bytes; a source-only checkout cannot satisfy that check.
