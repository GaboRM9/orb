import type { ComponentType } from "react";
import type { SurfaceViewProps } from "../surface";
import { ClockView } from "./clock";
import { ConvertView } from "./convert";
import { DirectionsView } from "./directions";
import { FxView } from "./fx";
import { LoanView } from "./loan";
import { NearbyView } from "./nearby";
import { WeatherView } from "./weather";
import { WikiView } from "./wiki";

// How wide a card may grow: a number answer reads best narrow, text a little wider, maps take the whole column.
// On a phone every card is the column's width anyway.
export const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl", full: "" } as const;
type View = { title: string; width: keyof typeof WIDTH; View: ComponentType<SurfaceViewProps> };
const view = (title: string, width: View["width"], View: unknown): View => ({ title, width, View: View as ComponentType<SurfaceViewProps> }); // each view knows its own params and data

/** The browser half of each surface in lib/surfaces, by the same name. A surface without a view shows its summary. */
export const views: Record<string, View> = {
  weather: view("Weather", "md", WeatherView),
  directions: view("Directions", "full", DirectionsView),
  nearby: view("Nearby", "full", NearbyView),
  fx: view("Currency", "sm", FxView),
  clock: view("World clock", "md", ClockView),
  convert: view("Convert", "sm", ConvertView),
  loan: view("Loan", "md", LoanView),
  wiki: view("Wikipedia", "lg", WikiView),
};
