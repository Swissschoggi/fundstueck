# Fundstück — Source Research Report

Capability codes: A = Official search API · B = Official partner/feed (restricted) · C = Public website, no verified API · D = Restricted automation · E = Unknown/investigate.

`technical_access` and `automation_permission` are assessed separately. A site returning HTML does not imply permission to scrape.

## Genuinely implementable (authorized API access)

| Source | Country | Capability | Notes |
|---|---|---|---|
| eBay Browse API | Multi (CH, DE, AT, FR, IT, ES, NL, BE, GB, IE, CA, AU, PL, US, …) | A/B | Official. Requires `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`. Implemented adapter. |
| Mercado Libre API | LATAM (MX, BR, AR, CL, CO, PE, UY, EC, BO, VE) | A/B | Official. Requires app registration. Not yet implemented. |
| Trade Me API | NZ | A/B | Official developer API; search/listing permissions to verify. |
| Marktplaats | NL | B/C | Official feeds exist for seller workflows; public buyer search not guaranteed. |

## Implemented adapters (public pages, terms review required)

| Source | Status | Notes |
|---|---|---|
| Tutti (CH) | live | Public search pages; terms review required. |
| Anibis (CH) | live | Public search pages. |
| Marko (CH) | live | Server-rendered category pages. |
| Kleinanzeigen (DE) | live | Public search pages. |
| Willhaben (AT) | live | Public search pages. |
| Subito (IT) | live | Public search pages; listed as restricted in spec — keep disabled-by-default until authorized. |
| Marktplaats (NL) | live | Public search pages. |
| 2dehands (BE) | live | Public search pages. |
| Kijiji (CA) | live | Public search pages. |
| Depop (global) | available (disabled by default) | Cloudflare-protected; requires FlareSolverr. Terms prohibit scraping — opt-in only. |
| Ricardo (CH) | available (recipe) | Community CLI; requires camoufox browser. |

## Restricted until authorization (do not enable)

Vinted (all countries), Wallapop, Leboncoin, Subito (per spec), Craigslist, OfferUp, Facebook Marketplace. These are listed in the registry with `automation_permission = prohibited_without_authorization` and are never auto-enabled.

## Investigate / pursue permission (Tier 3)

Ricardo, Tutti, Anibis, Kleinanzeigen, willhaben, FINN, Blocket, DBA, Tori, DoneDeal, Adverts.ie, Jiji, Chợ Tốt, Carousell, Bunjang, Karrot. All are `E` (unknown) — adapter_status `not_implemented`. Permission and terms must be verified before any adapter work.

## Not implementable as general C2C search

Back Market (refurbished retail), IndiaMART (B2B), HKTVmall (retail), Price.com.hk (price comparison), TiendaMIA (not general C2C), Segunda Mano (verify status), Melltoo (verify activity), and others noted in the registry verification_notes.

## Summary

Broad country coverage (75 countries, ~230 marketplaces) is provided via the data-driven registry with honest capability/permission metadata. Only a small number of adapters are implemented; restricted and unknown sources are surfaced but never silently enabled.
