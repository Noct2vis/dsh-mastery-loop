// dsh-mastery-loop carries no runtime code of its own.
//
// The bundle works entirely through cordis.patch.yml, which inserts the
// official `@deepseek-ai/dsh-skill-filesystem` provider and points
// `bundledSkillDir` at this package's `skills/` directory. Keeping the skill
// content declarative is deliberate: there is no provider to maintain, no
// discovery logic to get wrong, and nothing to break when DSH changes.

export {};
