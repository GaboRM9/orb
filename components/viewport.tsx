"use client";
import { useEffect } from "react";

// iOS Safari doesn't shrink the page for the keyboard: it slides the whole page up, pushing the top bar off screen,
// and sometimes leaves it there after the keyboard closes. So the body tracks the visible area and the page is put back at the top.
export function Viewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      if (vv.scale > 1) return; // pinch-zoomed: leave it to the user
      document.body.style.height = `${vv.height}px`;
      window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      document.body.style.height = "";
    };
  }, []);
  return null;
}
