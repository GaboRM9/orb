import type { ComponentType } from "react";
import type { SurfaceViewProps } from "../surface";
import { DirectionsView } from "./directions";

/** The browser half of each surface in lib/surfaces, by the same name. A surface without a view shows its summary. */
export const views: Record<string, { title: string; View: ComponentType<SurfaceViewProps> }> = {
  directions: { title: "Directions", View: DirectionsView as unknown as ComponentType<SurfaceViewProps> }, // each view knows its own params and data
};
