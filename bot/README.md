# Buzzar moderation bot

Fills the gaps general Matrix moderation tools (Draupnir, Meowlnir) leave for Buzzar worlds, using an ordinary
account on any homeserver.

- Quickstart: [Moderation Bot in the main README](../README.md#moderation-bot)
- Features, turning them on in a world, settings: [docs/guides/moderation-bot.md](../docs/guides/moderation-bot.md)
  (published at [haven.software/buzzar/docs/guides/moderation-bot](https://haven.software/buzzar/docs/guides/moderation-bot))

The bot runs its TypeScript directly with Node's type stripping (Node 22.18+), and shares the ban-rule code with the
client (`../src/matrix/policyRules.ts`), so run it from a full checkout of this repository. `npm run check`
type-checks it.
