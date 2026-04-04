export type Mix = { saltPct: number; brinePct: number; reason: string };

type FrostRisk = { level: "low" | "moderate" | "high"; text: string };

const MAX_SOLID_KG_LKM = 110;
const MAX_LIQUID_GAL_LM = 120;
const PREWET_BRINE_L_PER_1000KG_SALT = 37;
const MAX_PREWET_BRINE_L_LKM = (MAX_SOLID_KG_LKM * PREWET_BRINE_L_PER_1000KG_SALT) / 1000;

const clampPct = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function solidPctFromKgLkm(rate: number) {
  return clampPct((rate / MAX_SOLID_KG_LKM) * 100);
}

function liquidPctFromGalLm(rate: number) {
  return clampPct((rate / MAX_LIQUID_GAL_LM) * 100);
}

function prewetBrinePctFromSolidKgLkm(rate: number) {
  const brineLkm = (rate * PREWET_BRINE_L_PER_1000KG_SALT) / 1000;
  return clampPct((brineLkm / MAX_PREWET_BRINE_L_LKM) * 100);
}

function pickFromRange(min: number, max: number, severity: number) {
  if (min === max) return min;
  return min + (max - min) * Math.max(0, Math.min(1, severity));
}

function snowSeverity(precipInches: number, windSpeed: number, windGust: number) {
  const precipFactor = Math.max(0, Math.min(1, precipInches / 0.1));
  const windFactor = Math.max(0, Math.min(1, Math.max(windSpeed - 8, windGust - 12) / 20));
  return Math.max(precipFactor, windFactor * 0.7);
}

function liquidOnly(rateGalLm: number, reason: string): Mix {
  return { saltPct: 0, brinePct: liquidPctFromGalLm(rateGalLm), reason };
}

function prewettedSolid(rateKgLkm: number, reason: string): Mix {
  return {
    saltPct: solidPctFromKgLkm(rateKgLkm),
    brinePct: prewetBrinePctFromSolidKgLkm(rateKgLkm),
    reason,
  };
}

function combined(rateKgLkm: number, liquidRateGalLm: number, reason: string): Mix {
  return {
    saltPct: solidPctFromKgLkm(rateKgLkm),
    brinePct: liquidPctFromGalLm(liquidRateGalLm),
    reason,
  };
}

export function frostRisk(tempF: number, humidity: number): FrostRisk {
  const tempC = (tempF - 32) * (5 / 9);
  const dewPointC = (237.7 * (((17.27 * tempC) / (237.7 + tempC)) + Math.log(humidity / 100))) / (17.27 - (((17.27 * tempC) / (237.7 + tempC)) + Math.log(humidity / 100)));
  const dewPointF = (dewPointC * 9) / 5 + 32;
  const spreadF = tempF - dewPointF;
  if (tempF <= 32 && dewPointF <= 32) return { level: "high", text: "Frost likely" };
  if (tempF <= 35 && spreadF < 3) return { level: "moderate", text: "Frost risk rising" };
  if (tempF > 45 || spreadF > 8) return { level: "low", text: "Low frost risk" };
  return { level: "moderate", text: "Monitor conditions" };
}

// Workbook-derived treatment mapping:
// - Rates come from the FHWA tables embedded as images in "Salt and Brine Math.xlsx" on the "Area to Cover2" tab.
// - When the FHWA table allows either liquid or prewetted solid, we prefer liquid for light anti-icing and
//   prewetted solid for freezing rain, sleet, and colder snow events.
export function buildWorkbookMix(tempF: number, humidity: number, conditionText: string, precipInches: number, windSpeed: number, windGust: number): Mix {
  const text = conditionText.toLowerCase();
  const frost = frostRisk(tempF, humidity);
  const isSnow = /snow/.test(text);
  const isSleet = /sleet|ice pellets|wintry mix/.test(text);
  const isFreezingRain = /freezing rain|freezing drizzle/.test(text);
  const isRain = /rain|drizzle|shower|thunder/.test(text);
  const isIce = /black ice|ice|frost/.test(text) || (frost.level !== "low" && !isSnow && !isSleet && !isFreezingRain && precipInches < 0.02);
  const severity = snowSeverity(precipInches, windSpeed, windGust);

  if (tempF <= 15) {
    return { saltPct: 0, brinePct: 0, reason: "Workbook table: chemicals not recommended below 15 F" };
  }

  if (frost.level === "low" && !isSnow && !isSleet && !isFreezingRain && !isRain && tempF >= 38 && precipInches < 0.02) {
    return { saltPct: 0, brinePct: 0, reason: "Workbook table: no treatment above 32 F when conditions are mild" };
  }

  if (isFreezingRain) {
    if (tempF > 32) return prewettedSolid(24.5, "Freezing rain table: prewetted solid 21-28 kg/LKM");
    if (tempF > 20) return prewettedSolid(pickFromRange(21, 70, severity), "Freezing rain table: prewetted solid 21-70 kg/LKM");
    return prewettedSolid(pickFromRange(70, 110, severity), "Freezing rain table: prewetted solid 70-110 kg/LKM");
  }

  if (isSleet) {
    if (tempF > 32) return prewettedSolid(35, "Sleet table: prewetted solid 35 kg/LKM");
    if (tempF > 28) return prewettedSolid(pickFromRange(35, 90, severity), "Sleet table: prewetted solid 35-90 kg/LKM");
    return prewettedSolid(pickFromRange(70, 110, severity), "Sleet table: prewetted solid 70-110 kg/LKM");
  }

  if (isSnow) {
    const heavySnow = /heavy|blizzard/.test(text) || precipInches >= 0.06 || windGust >= 22;
    if (tempF > 32) return { saltPct: 0, brinePct: 0, reason: "Snow table: monitor above 32 F" };
    if (tempF > 30) return combined(28, 28, "Snow table: 28 kg/LKM solid with 28 gal/LM liquid");
    if (tempF > 25) {
      if (heavySnow) return combined(pickFromRange(42, 55, severity), 55, "Heavy snow table: 42-55 kg/LKM solid and 55 gal/LM liquid");
      return combined(28, 28, "Light snow table: 28 kg/LKM solid with 28 gal/LM liquid");
    }
    return prewettedSolid(pickFromRange(55, 70, severity), heavySnow ? "Snow table: prewetted solid 55-70 kg/LKM" : "Light snow table: prewetted solid 55-70 kg/LKM");
  }

  if (isIce) {
    if (tempF > 28) return liquidOnly(pickFromRange(7, 18, frost.level === "high" ? 1 : 0.4), "Frost/black ice table: liquid 7-18 gal/LM");
    if (tempF > 20) return liquidOnly(pickFromRange(18, 36, frost.level === "high" ? 1 : 0.5), "Frost/black ice table: liquid 18-36 gal/LM");
    return prewettedSolid(pickFromRange(36, 55, frost.level === "high" ? 1 : 0.5), "Frost/black ice table: prewetted solid 36-55 kg/LKM");
  }

  if (isRain && tempF <= 34) {
    return liquidOnly(pickFromRange(48, 87, severity), "Liquid NaCl table: anti-icing for light freezing rain conditions");
  }

  if (tempF <= 32) {
    return liquidOnly(44, "Liquid NaCl table: anti-icing at 31-32 F");
  }
  if (tempF <= 36) {
    return liquidOnly(32, "Workbook liquid guidance near freezing");
  }

  return { saltPct: 0, brinePct: 0, reason: "Workbook table: no treatment indicated for current conditions" };
}
