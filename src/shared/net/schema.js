// @ts-check
export const FieldType = Object.freeze({
  POS: "pos",
  ANGLE: "angle",
  U8: "u8",
  U16: "u16",
  BOOL: "bool",
  ENTITY: "entity",
  NAME: "name",
});
export const Visibility = Object.freeze({
  ALL: "all",
  OWNER: "owner",
  SERVER: "server",
});
export const Authority = Object.freeze({ SERVER: "server", OWNER: "owner" });
export const Blend = Object.freeze({
  LINEAR: "linear",
  ANGLE: "angle",
  STEP: "step",
});
export function defineKind(kind, fields) {
  if (!Number.isInteger(kind) || kind < 1)
    throw new Error("Invalid entity kind");
  for (const spec of Object.values(fields)) {
    for (const [key, values] of [
      ["type", FieldType],
      ["vis", Visibility],
      ["auth", Authority],
      ["blend", Blend],
    ])
      if (!Object.values(values).includes(spec[key]))
        throw new Error(`Invalid field ${key}`);
    Object.freeze(spec);
  }
  return Object.freeze({ kind, fields: Object.freeze(fields) });
}
export function quantize(type, value) {
  return type === FieldType.POS
    ? Math.round(value * 100) / 100
    : type === FieldType.ANGLE
      ? Math.round(value * 1000) / 1000
      : value;
}
export function isValidValue(type, value) {
  if (type === FieldType.NAME)
    return typeof value === "string" && [...value].length <= 20;
  if (type === FieldType.BOOL) return typeof value === "boolean";
  if (!Number.isFinite(value)) return false;
  if (
    type === FieldType.U8 ||
    type === FieldType.U16 ||
    type === FieldType.ENTITY
  )
    return (
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <=
        (type === FieldType.U8
          ? 255
          : type === FieldType.U16
            ? 65535
            : Number.MAX_SAFE_INTEGER)
    );
  return true;
}
export function blend(spec, a, b, t) {
  if (spec.blend === Blend.STEP) return a;
  if (spec.blend === Blend.ANGLE) {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * t;
  }
  return a + (b - a) * t;
}
