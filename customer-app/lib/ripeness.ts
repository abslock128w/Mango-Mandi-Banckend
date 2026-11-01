import type { RipenessStage } from "./types";

/** Display order: what most shoppers want first. */
export const STAGES: RipenessStage[] = ["RIPE", "SEMI_RIPE", "RAW"];

/** Wording from the old shop (customer-app i18n en.ts), unchanged. */
export const RIPENESS: Record<RipenessStage, { label: string; hint: string; short: string; tone: "ripe" | "semi" | "raw"; care: string[] }> = {
  RIPE: {
    label: "Ripe",
    hint: "Ready to eat on delivery.",
    short: "Eat now",
    tone: "ripe",
    care: ["Ready to eat now. Enjoy them within a day or two.", "To keep them 2 to 3 more days, put them in the fridge.", "Take them out half an hour before eating for the best flavour."],
  },
  SEMI_RIPE: {
    label: "Semi-ripe",
    hint: "Softening. Ready in 1 to 2 days.",
    short: "Ready in 1 to 2 days",
    tone: "semi",
    care: ["Leave them at room temperature for 1 to 2 days.", "They are ready when they smell sweet at the stem and give a little when pressed.", "Once ripe, eat them or move them to the fridge."],
  },
  RAW: {
    label: "Raw",
    hint: "Firm. Ripens at home over 3 to 4 days.",
    short: "Ripens in 3 to 4 days",
    tone: "raw",
    care: [
      "Keep them at room temperature, out of the sun. Wrapping them in newspaper or a paper bag speeds things up.",
      "Don't refrigerate them yet: cold stops them ripening.",
      "They are ready in 3 to 4 days, when they smell sweet at the stem and give a little when pressed.",
    ],
  },
};

export const stageSlug: Record<RipenessStage, string> = { RIPE: "ripe", SEMI_RIPE: "semi-ripe", RAW: "raw" };
export const slugStage = (s: string | null | undefined): RipenessStage | null => (s === "ripe" ? "RIPE" : s === "semi-ripe" ? "SEMI_RIPE" : s === "raw" ? "RAW" : null);
