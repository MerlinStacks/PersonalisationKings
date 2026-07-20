import type { Prisma } from "@prisma/client";

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }

  return value;
}

function compareCodePoints(left: string, right: string) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}
