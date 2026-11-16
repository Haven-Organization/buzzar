/**
 * Buzzar: body posture (standing, crouching, prone), shared by the posture plugin (input, collider, camera,
 * networking), the character controller (speed, jumping) and the animation system (poses).
 */
export enum Posture {
  Standing = 0,
  Crouching = 1,
  Prone = 2,
}

/** Player containers (local and remote) that aren't standing, and their posture. */
export const PostureEntities = new Map<number, Posture>();

/** Movement speed multiplier per posture. */
export const POSTURE_SPEED: Record<Posture, number> = {
  [Posture.Standing]: 1,
  [Posture.Crouching]: 0.5,
  [Posture.Prone]: 0.22,
};

/**
 * The local player's posture (set by the posture plugin, read by the character controller), and the local
 * avatar's standing eye height (reported by the avatar code; the posture plugin eases the camera from it).
 */
export const localPosture: { value: Posture; standingEye?: number } = { value: Posture.Standing };
