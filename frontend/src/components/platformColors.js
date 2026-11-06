// Held apart for colour-blind readers, not only by eye: platformColors.test.js
// pins the minimum ΔE2000 under simulated deuteranopia and protanopia.
const platformColors = [
  {
    platform: "mooring",
    color: "#ff8a17",
  },
  {
    platform: "land or seafloor",
    color: "#e3285e",
  },
  {
    platform: "surface vessel",
    // Darker than the red of "land or seafloor" so the two stay apart for
    // red-green colour blindness, where only their lightness differs.
    color: "#0e6b00",
  },
  {
    platform: "cryosphere",
    color: "#009eff",
  },
  {
    platform: "organism",
    color: "#e8a1ae",
  },
  {
    platform: "amphibious vehicle",
    color: "#a5ae77",
  },
  {
    platform: "spacecraft",
    color: "#c6c2ff",
  },
  {
    platform: "float",
    color: "#f5e91c",
  },
  {
    platform: "submersible",
    color: "#2b00c2",
  },
  {
    platform: "buoyant aircraft",
    color: "#51ffb5",
  },
  {
    platform: "non-buoyant aircraft",
    color: "#ff3fd5",
  },
  {
    platform: "unknown",
    // Navy-tinted, like every neutral in the theme.
    color: "#414355",
  },
];

export default platformColors;
