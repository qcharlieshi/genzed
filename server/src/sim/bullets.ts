export type BulletMeta = {
  shooterId: string;
  damage: number; // snapshot at fire time (includes active-reload bonus)
  diesAtTick: number; // L5 lifetime; MAX_SAFE_INTEGER = until wall/world
};

export type Target = { id: string; x: number; y: number; immune: boolean };

export type Hit = { victimId: string; shooterId: string; damage: number };
