export const CRUMB_COMPATIBILITY_PROFILE = "crumb.unity/1.3.5" as const;
export const CRUMB_TESTED_GAME_VERSION = "1.3.5" as const;
export const CRUMB_TESTED_STEAM_BUILD_ID = "17183476" as const;
export const CRUMB_ENGINE_FAMILY = "Unity" as const;
export const CRUMB_ENGINE_VERSION = "2022.1.16f1" as const;

export const CRUMB_COMPATIBILITY_PROFILE_DESCRIPTOR = Object.freeze({
  compatibilityProfile: CRUMB_COMPATIBILITY_PROFILE,
  status: "tested" as const,
  product: "CRUMB",
  productVersion: CRUMB_TESTED_GAME_VERSION,
  distribution: Object.freeze({
    channel: "Steam",
    buildId: CRUMB_TESTED_STEAM_BUILD_ID,
  }),
  engine: Object.freeze({
    family: CRUMB_ENGINE_FAMILY,
    version: CRUMB_ENGINE_VERSION,
  }),
  evidence: Object.freeze({
    basis: "controlled-installed-build-observation" as const,
    automaticFileFormatDetection: false as const,
    limitation:
      "Selects the interpretation evidence applied to .cru data; it does not detect a file's originating build and must not be applied to Godot builds without separate evidence.",
  }),
});
