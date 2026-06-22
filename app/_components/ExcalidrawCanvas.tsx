"use client";

// Thin wrapper around the Excalidraw React component. This module is ONLY ever
// imported via next/dynamic with `ssr: false`, so the static imports of Excalidraw
// and its stylesheet never run on the server (Excalidraw needs the browser DOM).
import "@excalidraw/excalidraw/index.css";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof Excalidraw>;

export default function ExcalidrawCanvas(props: Props) {
  return <Excalidraw {...props} />;
}
