"use client";

import type { SceneGraph } from "@personalise-kings/render-schema";
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { ConfigAsset } from "../lib/customiser-api";
import { nudgePosition, positionFromPointerDelta, transformFromTwoPointers, type GesturePoint } from "../lib/scene-utils";

type SceneLayer = SceneGraph["layers"][number];
interface ScenePreviewLayerProps {
  layer: SceneLayer;
  scene: SceneGraph;
  asset?: ConfigAsset;
  selected: boolean;
  allowPosition: boolean;
  allowScale: boolean;
  allowRotation: boolean;
  onSelect: () => void;
  onMove: (xUm: number, yUm: number) => void;
  onTransform: (scaleXPermille: number, scaleYPermille: number, rotationMilliDegrees: number) => void;
}

export function ScenePreviewLayer({
  layer,
  scene,
  asset,
  selected,
  allowPosition,
  allowScale,
  allowRotation,
  onSelect,
  onMove,
  onTransform
}: Readonly<ScenePreviewLayerProps>) {
  const pointers = useRef(new Map<number, GesturePoint>());
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    xUm: number;
    yUm: number;
    widthPx: number;
    heightPx: number;
  } | null>(null);
  const gesture = useRef<{
    firstId: number;
    secondId: number;
    startFirst: GesturePoint;
    startSecond: GesturePoint;
    initialScaleXPermille: number;
    initialScaleYPermille: number;
    initialRotationMilliDegrees: number;
  } | null>(null);
  const latestTransform = useRef(layer.transform);
  latestTransform.current = layer.transform;
  const style: CSSProperties = {
    left: `${layer.transform.translateXUm / scene.printArea.widthUm * 100}%`,
    top: `${layer.transform.translateYUm / scene.printArea.heightUm * 100}%`,
    transform: `rotate(${layer.transform.rotationMilliDegrees / 1000}deg) scale(${layer.transform.scaleXPermille / 1000}, ${layer.transform.scaleYPermille / 1000})`,
    opacity: layer.opacityPermille / 1000
  };

  if (layer.type === "text") {
    style.color = layer.fill;
    style.fontSize = `${layer.fontSizeUm / scene.printArea.widthUm * 100}cqw`;
  } else {
    style.width = `${layer.widthUm / scene.printArea.widthUm * 100}%`;
    style.height = `${layer.heightUm / scene.printArea.heightUm * 100}%`;
  }

  function beginMove(event: PointerEvent<HTMLButtonElement>) {
    onSelect();
    if ((!allowPosition && !allowScale && !allowRotation) || event.button !== 0) return;
    if (pointers.current.size >= 2 || (pointers.current.size === 1 && !allowScale && !allowRotation)) return;
    const printArea = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!printArea) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 1 && allowPosition) {
      drag.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        xUm: latestTransform.current.translateXUm,
        yUm: latestTransform.current.translateYUm,
        widthPx: printArea.width,
        heightPx: printArea.height
      };
    } else if (pointers.current.size === 2 && (allowScale || allowRotation)) {
      const entries = [...pointers.current.entries()];
      const first = entries[0];
      const second = entries[1];
      if (first && second) {
        gesture.current = {
          firstId: first[0],
          secondId: second[0],
          startFirst: first[1],
          startSecond: second[1],
          initialScaleXPermille: latestTransform.current.scaleXPermille,
          initialScaleYPermille: latestTransform.current.scaleYPermille,
          initialRotationMilliDegrees: latestTransform.current.rotationMilliDegrees
        };
        drag.current = null;
      }
    }
    event.preventDefault();
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const activeGesture = gesture.current;
    if (activeGesture) {
      const first = pointers.current.get(activeGesture.firstId);
      const second = pointers.current.get(activeGesture.secondId);
      if (!first || !second) return;
      const transform = transformFromTwoPointers(
        activeGesture.startFirst,
        activeGesture.startSecond,
        first,
        second,
        {
          scaleXPermille: activeGesture.initialScaleXPermille,
          scaleYPermille: activeGesture.initialScaleYPermille,
          rotationMilliDegrees: activeGesture.initialRotationMilliDegrees
        },
        allowScale,
        allowRotation
      );
      onTransform(transform.scaleXPermille, transform.scaleYPermille, transform.rotationMilliDegrees);
      return;
    }
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const position = positionFromPointerDelta(
      { xUm: active.xUm, yUm: active.yUm },
      event.clientX - active.clientX,
      event.clientY - active.clientY,
      active.widthPx,
      active.heightPx,
      scene.printArea
    );
    onMove(position.xUm, position.yUm);
  }

  function endMove(event: PointerEvent<HTMLButtonElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
    if (gesture.current?.firstId === event.pointerId || gesture.current?.secondId === event.pointerId) gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const remaining = [...pointers.current.entries()][0];
    const printArea = event.currentTarget.parentElement?.getBoundingClientRect();
    if (remaining && printArea && allowPosition) {
      drag.current = {
        pointerId: remaining[0],
        clientX: remaining[1].x,
        clientY: remaining[1].y,
        xUm: latestTransform.current.translateXUm,
        yUm: latestTransform.current.translateYUm,
        widthPx: printArea.width,
        heightPx: printArea.height
      };
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = event.key === "ArrowLeft" ? "left"
      : event.key === "ArrowRight" ? "right"
        : event.key === "ArrowUp" ? "up"
          : event.key === "ArrowDown" ? "down"
            : null;
    if (!allowPosition || !direction) return;
    event.preventDefault();
    const stepUm = event.shiftKey ? 2500 : event.altKey ? 100 : 500;
    const position = nudgePosition({
      xUm: layer.transform.translateXUm,
      yUm: layer.transform.translateYUm
    }, direction, stepUm, scene.printArea);
    onMove(position.xUm, position.yUm);
  }

  return (
    <button
      type="button"
      className={`preview-layer ${layer.type}-preview${selected ? " selected" : ""}${allowPosition || allowScale || allowRotation ? " movable" : ""}`}
      style={style}
      aria-label={`Edit ${layer.name}`}
      aria-pressed={selected}
      aria-describedby={allowPosition || allowScale || allowRotation ? "movement-instructions" : undefined}
      aria-keyshortcuts={allowPosition ? "ArrowLeft ArrowRight ArrowUp ArrowDown" : undefined}
      onClick={onSelect}
      onPointerDown={beginMove}
      onPointerMove={move}
      onPointerUp={endMove}
      onPointerCancel={endMove}
      onKeyDown={handleKeyDown}
    >
      {layer.type === "text" ? <span>{layer.text || "Enter text"}</span> : null}
      {layer.type === "image" && asset ? <img src={asset.url} alt="" draggable={false} /> : null}
      {layer.type === "image" && !asset ? <span className="image-placeholder">Choose image</span> : null}
    </button>
  );
}
