// @ts-check
import {
  defineKind,
  FieldType as F,
  Visibility as V,
  Authority as A,
  Blend as B,
} from "../net/schema.js";
export const Kind = Object.freeze({ PLAYER: 1, HUNTER: 2, ITEM: 3, PROP: 4 });
export const PlayerStatus = Object.freeze({
  ACTIVE: 0,
  CAPTURED: 1,
  AFK: 2,
  DISCONNECTED: 3,
});
const field = (type, blend = B.STEP, auth = A.SERVER) => ({
  type,
  blend,
  auth,
  vis: V.ALL,
});
export const PLAYER = defineKind(Kind.PLAYER, {
  x: field(F.POS, B.LINEAR, A.OWNER),
  z: field(F.POS, B.LINEAR, A.OWNER),
  yaw: field(F.ANGLE, B.ANGLE, A.OWNER),
  pitch: field(F.ANGLE, B.ANGLE, A.OWNER),
  ep: field(F.U16),
  lvl: field(F.U8),
  st: field(F.U8),
  carry: field(F.ENTITY),
  name: field(F.NAME),
});
export const PROP = defineKind(Kind.PROP, { state: field(F.BOOL) });
export const schemas = new Map([
  [Kind.PLAYER, PLAYER],
  [Kind.PROP, PROP],
]);
