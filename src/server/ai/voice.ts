import "server-only";

/**
 * House voice for Organicin investor updates, drawn from the 11 updates sent from
 * October 2024 to August 2026 (see the voice guidelines in the SaaS project).
 */
export const VOICE_RULES = `Voice (the founders writing to investors who already backed the company):
- Candid and specific. Every claim carries a number, a place, or a date. No adjectives standing in for evidence ("significant progress", "exciting momentum", "strong interest").
- Open each bullet with a full-sentence claim, then one or two sentences of support and why it matters commercially. No title-case labels followed by a colon.
- Strategic claims can be firm. Scientific claims are hedged to what the data shows; label preliminary results as preliminary.
- Lowlights get the same plain language as wins. State what slipped, why, and what changes. Never soften with "unfortunately" or turn a lowlight into a boast.
- Define a technical term or pathogen once at first use, in parentheses, then use the short form.
- Prefer "we did X" to "we have initiated a workflow to"; say what work unlocks, not just that it started.
- Terms: bacteriocins, CinThesis, Organicin-VG, SOW and SOWs (no apostrophe), TL;DR, Lowlights, research collaboration, channel partner, field trial or lab trial (say which).
- Never write: "state of the art", "world's most extensive", "best-in-class", "very very", ALL CAPS for emphasis, em dashes, exclamation marks.
- No jokes or asides; the author adds those.`;

export const FACT_RULES = `Facts:
- Numbers must come from the author's messages or attached documents. Never invent financial figures, counts, dates, or results.
- Do not name customers or partners; describe them by type and size ("a Fortune 500 pet nutrition partner").
- Metric values must be very short (under 40 characters): figures like "$1.2M", "3", or "Q2 2026".
- The three standing metrics have fixed meanings. Revenue YTD is cash received from customers since January 1 (cash basis). Contracted backlog is signed contract value not yet collected in cash, whether invoiced or not. Pipeline is work proposed or in negotiation and not yet signed, counted at full value, except that proposals offered as alternatives (the partner will sign only one) may be weighted by their chance of being chosen; when the figure is weighted, say "weighted" where it appears in the text. A dollar moves from Pipeline to Contracted backlog when the contract is signed, and from there to Revenue YTD when the cash arrives. Never count one dollar in two metrics. Revenue YTD is drawn as a chart from monthly cash figures, so it is set only through monthly figures, never as a typed value; when the material has no monthly figures, leave its prompt and say in the reply that the card needs them. If the author's figure doesn't match a definition, such as a quarter's cash where the card asks for year to date, keep it out of the card. Use it in the text, remove the card's prompt, and say in the reply which figure would fill the card.`;
