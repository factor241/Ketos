/**
 * The clone card's editable draft and the review state that follows a stored
 * revision: the field list, the value conversions, and the record the board
 * store keeps per clone so switching the clone window's body never loses the
 * user's text or the marks that say which fields the agent rewrote.
 * @module ui-board/clone-draft
 */
import type { CloneDto, CloneSkill, CloneStatus, CloneUpdatePatch } from '@ketos/clone-core/types'

/** The editable fields of one clone. */
export interface CloneDraft {
  name: string
  role: string
  description: string
  persona: string
  methodology: string
  skills: readonly CloneSkill[]
  preferredModel: string | null
  status: CloneStatus
}

/** Every editable field of one draft, in form order. */
export const CLONE_FIELDS = [
  'name', 'role', 'description', 'persona', 'methodology', 'skills', 'preferredModel', 'status',
] as const satisfies readonly (keyof CloneDraft)[]

/** One editable field of a clone. */
export type CloneField = typeof CLONE_FIELDS[number]

/**
 * Longest value each field accepts. The route enforces these bounds on the
 * wire (`packages/ketos/clone-core/src/routes.ts` LIMITS); the form caps input
 * at the same numbers so a valid draft can never be refused for its length.
 */
export const CLONE_LIMITS = {
  name: 120,
  role: 120,
  description: 500,
  persona: 20_000,
  methodology: 20_000,
  skillName: 64,
  skillDescription: 500,
  skillInstructions: 20_000,
  skillCount: 100,
} as const

/**
 * Skill names the route accepts, mirrored from the host's `CLONE_SKILL_NAME`
 * validation: lowercase kebab-case, the identity the skill registry uses.
 */
export const CLONE_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * One clone's editor state as the board store keeps it: the live draft, the
 * stored values it was seeded from, the revision the next save must match, the
 * stored values of a newer revision the user has not applied, and the fields
 * whose stored value moved since the last adoption.
 */
export interface CloneEdit {
  readonly draft: CloneDraft
  /** Stored values the draft started from; equal to the draft means no unsaved edits. */
  readonly base: CloneDraft
  readonly revision: number
  /**
   * Stored values of a newer revision the user has not applied to the draft;
   * present only while a dirty draft shadows them.
   */
  readonly incoming?: CloneDraft
  /** Fields whose stored value differs from the last adopted stored value. */
  readonly agentFields: readonly CloneField[]
}

/**
 * The editable fields of one stored record.
 * @param clone - the stored record to project.
 * @returns the record's editable values.
 */
export function toDraft(clone: CloneDto): CloneDraft {
  return {
    name: clone.name,
    role: clone.role,
    description: clone.description,
    persona: clone.persona,
    methodology: clone.methodology,
    skills: clone.skills.map(skill => ({ ...skill, name: skill.name.trim() })),
    preferredModel: clone.preferredModel,
    status: clone.status,
  }
}

/** Whether two skills carry the same name, description, and instructions. */
function sameSkill(left: CloneSkill, right: CloneSkill): boolean {
  return left.name === right.name
    && left.description === right.description
    && left.instructions === right.instructions
}

/** Whether two skill lists carry the same entries in the same order. */
function sameSkills(left: readonly CloneSkill[], right: readonly CloneSkill[]): boolean {
  if (left.length !== right.length) return false
  return left.every((skill, index) => {
    const other = right[index]
    return other !== undefined && sameSkill(skill, other)
  })
}

/** Whether two drafts agree on one editable field. */
function sameField(field: CloneField, left: CloneDraft, right: CloneDraft): boolean {
  return field === 'skills' ? sameSkills(left.skills, right.skills) : left[field] === right[field]
}

/**
 * Whether two drafts hold the same editable values.
 * @param left - one draft.
 * @param right - the other draft.
 * @returns whether every editable field is equal.
 */
export function sameDraft(left: CloneDraft, right: CloneDraft): boolean {
  return CLONE_FIELDS.every(field => sameField(field, left, right))
}

/**
 * Fields whose values differ between two stored drafts.
 * @param previous - the values the user last adopted.
 * @param next - the values the record now holds.
 * @returns the names of the fields that moved.
 */
export function changedFields(previous: CloneDraft, next: CloneDraft): readonly CloneField[] {
  return CLONE_FIELDS.filter(field => !sameField(field, previous, next))
}

/**
 * The complete update patch one draft sends.
 * @param draft - the draft to convert.
 * @returns the patch carrying every editable field.
 */
export function toPatch(draft: CloneDraft): CloneUpdatePatch {
  return {
    name: draft.name.trim(),
    role: draft.role.trim(),
    description: draft.description,
    persona: draft.persona,
    methodology: draft.methodology,
    skills: draft.skills.map(skill => ({
      name: skill.name.trim(),
      description: skill.description,
      instructions: skill.instructions,
    })),
    preferredModel: draft.preferredModel,
    status: draft.status,
  }
}
