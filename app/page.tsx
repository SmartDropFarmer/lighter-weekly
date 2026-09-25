"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const PROGRAM_START = Date.UTC(2026, 7, 10);
const WEEKLY_CAMPAIGN_START = Date.UTC(2026, 7, 12);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REFERRAL_URL = "https://robinhoodchain.lighter.xyz/?referral=SMART&source=none";
const TWITTER_URL = "https://x.com/SmartDropFarmer";
const WEEKLY_STRATEGY_URL = "https://x.com/SmartDropFarmer/status/2103429570590310733";
const CRYPTO_LOADING_LINES = [
  "Checking whether the Lambo budget survived this week…",
  "Running the highly scientific $10B FDV scenario…",
  "Asking the blockchain to stop being dramatic…",
  "Separating real volume from main-character energy…",
  "Calculating how many points the timeline will call ‘free’…",
  "Confirming that ‘one last trade’ was not actually the last…",
];
const END_MONTH_OPTIONS = Array.from({ length: 41 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7 + index, 1));
  return {
    value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
  };
});
const SHARE_BACKGROUNDS = [
  { id: "rest", label: "Rest", src: "/share-bg-energy.jpg", character: "/card-character-rest.png", thumb: "/card-thumb-rest.jpg" },
  { id: "low", label: "Low points", src: "/share-bg-eclipse.jpg", character: "/card-character-low.png", thumb: "/card-thumb-low.jpg" },
  { id: "medium", label: "Good week", src: "/share-bg-sentinel.jpg", character: "/card-character-medium.png", thumb: "/card-thumb-medium.jpg" },
  { id: "high", label: "Big week", src: "/share-bg-monolith.jpg", character: "/card-character-high.png", thumb: "/card-thumb-high.jpg" },
];

type MarketVolume = { marketId: number; symbol: string; volume: number };
type PriceScenario = "bearish" | "neutral" | "bullish";
type ScenarioInputs = { litPrice: number; endMonth: string; poolLit: number; weeklyPoints: number };

const PRICE_SCENARIOS: Record<Exclude<PriceScenario, "custom">, ScenarioInputs & { label: string; note: string }> = {
  bearish: { label: "Bearish", note: "Lower LIT price · longer campaign", litPrice: 3, endMonth: "2027-08", poolLit: 11_000_000, weeklyPoints: 72_500 },
  neutral: { label: "Neutral", note: "Base case · campaign ends January", litPrice: 4.5, endMonth: "2027-01", poolLit: 11_000_000, weeklyPoints: 72_500 },
  bullish: { label: "Bullish", note: "Higher LIT price · campaign ends January", litPrice: 7, endMonth: "2027-01", poolLit: 11_000_000, weeklyPoints: 72_500 },
};
type WeeklyData = {
  success: true;
  wallet: string;
  accountIndexes: number[];
  week: number;
  range: "week" | "total";
  period: { from: string; to: string; type: "lighter_week" };
  points: { value: number | null; status: "pending_distribution" | "unavailable" | "available" };
  summary: {
    volume: number; fills: number; markets: number; activeDays: number;
    avgTradeSize: number; makerFills: number; takerFills: number; makerPercent: number;
  };
  volumeByMarket: MarketVolume[];
  dataCompleteness: "complete" | "partial";
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format;

function getCurrentCampaignWeek() {
  return Math.max(1, Math.floor((Date.now() - WEEKLY_CAMPAIGN_START) / WEEK_MS) + 1);
}

function weeksUntilMonthEnd(endMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(endMonth);
  if (!match) return 1;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const firstDayAfterMonth = Date.UTC(year, month, 1);
  return Math.max(1, Math.ceil((firstDayAfterMonth - PROGRAM_START) / WEEK_MS));
}

function formatPeriod(from: string, to: string) {
  const format = new Intl.DateTimeFormat("en-US", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
  const rawEnd = new Date(to);
  const displayEnd = rawEnd.getUTCHours() === 0 && rawEnd.getUTCMinutes() === 0 && rawEnd.getUTCSeconds() === 0
    ? new Date(rawEnd.getTime() - 1)
    : rawEnd;
  return `${format.format(new Date(from))} — ${format.format(displayEnd)} UTC`;
}

function formatCardPeriod(from: string, to: string) {
  const format = new Intl.DateTimeFormat("en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const rawEnd = new Date(to);
  const displayEnd = rawEnd.getUTCHours() === 0 && rawEnd.getUTCMinutes() === 0 && rawEnd.getUTCSeconds() === 0
    ? new Date(rawEnd.getTime() - 1)
    : rawEnd;
  return `${format.format(new Date(from))} — ${format.format(displayEnd)}`;
}

export default function Home() {
  const [walletInput, setWalletInput] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [week, setWeek] = useState(0);
  const [range, setRange] = useState<"week" | "total">("week");
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadStartedAt, setLoadStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [estimatedMs, setEstimatedMs] = useState(12000);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBackground, setShareBackground] = useState<string | null>(null);
  const [showAverageTrade, setShowAverageTrade] = useState(true);
  const [customCardImage, setCustomCardImage] = useState<string | null>(null);
  const [showEstimatedValue, setShowEstimatedValue] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showTopMarket, setShowTopMarket] = useState(true);
  const [showPeriod, setShowPeriod] = useState(true);
  const [showCreator, setShowCreator] = useState(true);
  const [showWallet, setShowWallet] = useState(false);
  const currentCampaignWeek = getCurrentCampaignWeek();
  const weekOptions = useMemo(() => Array.from({ length: currentCampaignWeek }, (_, offset) => offset), [currentCampaignWeek]);
  const [pointSnapshots, setPointSnapshots] = useState<Record<number, number>>({});
  const [pointWeek, setPointWeek] = useState(Math.max(1, currentCampaignWeek - 1));
  const [pointTotal, setPointTotal] = useState("");
  const pointsImportRef = useRef<HTMLInputElement>(null);
  const shareDialogRef = useRef<HTMLDivElement>(null);
  const [priceScenario, setPriceScenario] = useState<PriceScenario>("neutral");
  const [scenarioValues, setScenarioValues] = useState<Record<PriceScenario, ScenarioInputs>>({
    bearish: { litPrice: 3, endMonth: "2027-08", poolLit: 11_000_000, weeklyPoints: 72_500 },
    neutral: { litPrice: 4.5, endMonth: "2027-01", poolLit: 11_000_000, weeklyPoints: 72_500 },
    bullish: { litPrice: 7, endMonth: "2027-01", poolLit: 11_000_000, weeklyPoints: 72_500 },
  });

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - loadStartedAt);
    }, 250);
    return () => window.clearInterval(timer);
  }, [loading, loadStartedAt]);

  useEffect(() => {
    if (!shareOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    shareDialogRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [shareOpen]);

  const loadPeriod = useCallback(async (address: string, selectedWeek: number, selectedRange: "week" | "total") => {
    const startedAt = Date.now();
    const timingKey = `lighter-timing:${address.toLowerCase()}`;
    const savedEstimate = Number(window.localStorage.getItem(timingKey));
    setLoadStartedAt(startedAt);
    setElapsedMs(0);
    setEstimatedMs(Number.isFinite(savedEstimate) && savedEstimate > 0 ? savedEstimate : 12000);
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ wallet: address, week: String(selectedWeek) });
      if (selectedRange === "total") params.set("range", "total");
      const response = await fetch(`/api/lighter/weekly?${params}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Unable to load wallet activity");
      setData(result as WeeklyData);
      const duration = Date.now() - startedAt;
      const nextEstimate = Number.isFinite(savedEstimate) && savedEstimate > 0
        ? Math.round(savedEstimate * 0.65 + duration * 0.35)
        : duration;
      window.localStorage.setItem(timingKey, String(nextEstimate));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unexpected error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = walletInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Enter a valid wallet address starting with 0x.");
      return;
    }
    setWallet(address);
    setWeek(0);
    setRange("week");
    const savedPoints = window.localStorage.getItem(`lighter-points:${address.toLowerCase()}`);
    if (savedPoints) {
      try {
        setPointSnapshots(JSON.parse(savedPoints) as Record<number, number>);
      } catch {
        setPointSnapshots({});
      }
    } else {
      setPointSnapshots({});
    }
    void loadPeriod(address, 0, "week");
  }

  function selectPeriod(selectedWeek: number, selectedRange: "week" | "total") {
    if (!wallet) return;
    setWeek(selectedWeek);
    setRange(selectedRange);
    setShareBackground(null);
    void loadPeriod(wallet, selectedWeek, selectedRange);
  }

  function savePointSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet) return;
    const total = Number(pointTotal);
    if (!Number.isFinite(total) || total < 0 || pointTotal.trim() === "") {
      setError("Enter a valid cumulative points total.");
      return;
    }
    const previousTotal = pointSnapshots[pointWeek - 1];
    const nextTotal = pointSnapshots[pointWeek + 1];
    if ((previousTotal !== undefined && total < previousTotal) || (nextTotal !== undefined && total > nextTotal)) {
      setError("Cumulative points must not decrease between campaign weeks.");
      return;
    }
    if (pointSnapshots[pointWeek] !== undefined && pointSnapshots[pointWeek] !== total && !window.confirm(`Replace the saved total for Week ${pointWeek}?`)) return;
    const nextSnapshots = { ...pointSnapshots, [pointWeek]: total };
    setPointSnapshots(nextSnapshots);
    window.localStorage.setItem(`lighter-points:${wallet.toLowerCase()}`, JSON.stringify(nextSnapshots));
    setPointTotal("");
    setError("");
  }

  function removePointSnapshot(campaignWeek: number) {
    if (!wallet || !window.confirm(`Delete the saved total for Week ${campaignWeek}?`)) return;
    const nextSnapshots = { ...pointSnapshots };
    delete nextSnapshots[campaignWeek];
    setPointSnapshots(nextSnapshots);
    window.localStorage.setItem(`lighter-points:${wallet.toLowerCase()}`, JSON.stringify(nextSnapshots));
  }

  function exportPointSnapshots() {
    if (!wallet) return;
    const payload = JSON.stringify({ version: 1, wallet, pointSnapshots, exportedAt: new Date().toISOString() }, null, 2);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    link.download = `lighter-points-${wallet.slice(0, 6)}-${wallet.slice(-4)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importPointSnapshots(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !wallet) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result)) as { wallet?: string; pointSnapshots?: Record<string, unknown> };
        if (payload.wallet?.toLowerCase() !== wallet.toLowerCase() || !payload.pointSnapshots) throw new Error("Backup belongs to a different wallet.");
        const imported = Object.fromEntries(Object.entries(payload.pointSnapshots).map(([key, value]) => [Number(key), Number(value)]));
        if (Object.entries(imported).some(([key, value]) => !Number.isSafeInteger(Number(key)) || Number(key) < 1 || !Number.isFinite(value) || value < 0)) throw new Error("Backup contains invalid point totals.");
        const orderedTotals = Object.entries(imported).sort(([a], [b]) => Number(a) - Number(b)).map(([, value]) => value);
        if (orderedTotals.some((value, index) => index > 0 && value < orderedTotals[index - 1])) throw new Error("Backup contains decreasing cumulative totals.");
        setPointSnapshots(imported);
        window.localStorage.setItem(`lighter-points:${wallet.toLowerCase()}`, JSON.stringify(imported));
        setError("");
      } catch (importError) {
        setError(importError instanceof Error ? importError.message : "Unable to import this backup.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function handleShareDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { setShareOpen(false); return; }
    if (event.key !== "Tab" || !shareDialogRef.current) return;
    const controls = Array.from(shareDialogRef.current.querySelectorAll<HTMLElement>("button, input, select, [href], [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function uploadCardImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError("Custom card images must be PNG, JPEG or WebP.");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Custom card images must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setCustomCardImage(reader.result);
      setError("");
    };
    reader.onerror = () => setError("The custom image could not be read.");
    reader.readAsDataURL(file);
  }

  const maxMarketVolume = data?.volumeByMarket[0]?.volume ?? 0;
  const selectedCampaignWeek = currentCampaignWeek - week;
  const savedWeeks = Object.keys(pointSnapshots).map(Number).sort((a, b) => b - a);
  const latestPoints = savedWeeks.length > 0 ? pointSnapshots[savedWeeks[0]] : null;
  const selectedSnapshot = pointSnapshots[selectedCampaignWeek];
  const previousSnapshot = selectedCampaignWeek === 1 ? 0 : pointSnapshots[selectedCampaignWeek - 1];
  const weeklyPoints = selectedSnapshot !== undefined && previousSnapshot !== undefined
    ? selectedSnapshot - previousSnapshot
    : null;
  const pointsForTier = range === "total" ? latestPoints : weeklyPoints;
  const recommendedBackground = pointsForTier === null || pointsForTier < 5
    ? SHARE_BACKGROUNDS[0]
    : pointsForTier < 20
      ? SHARE_BACKGROUNDS[1]
      : pointsForTier < 75
        ? SHARE_BACKGROUNDS[2]
        : SHARE_BACKGROUNDS[3];
  const selectedBackground = SHARE_BACKGROUNDS.find((option) => option.src === shareBackground) ?? recommendedBackground;
  const activeCardImage = customCardImage ?? selectedBackground.character;
  const pointsValue = range === "total"
    ? latestPoints === null ? "—" : latestPoints.toLocaleString("en-US", { maximumFractionDigits: 3 })
    : week === 0 ? "Pending" : weeklyPoints === null ? "—" : weeklyPoints.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const progress = Math.min(92, Math.max(6, (elapsedMs / estimatedMs) * 88));
  const secondsLeft = Math.max(1, Math.ceil((estimatedMs - elapsedMs) / 1000));
  const cryptoLoadingLine = CRYPTO_LOADING_LINES[Math.floor(elapsedMs / 2600) % CRYPTO_LOADING_LINES.length];
  const progressStep = progress < 24
    ? ["Resolving linked accounts", "Finding every Lighter account connected to this wallet."]
    : progress < 67
      ? ["Reading public trade history", "Working through the explorer pages for this period."]
      : progress < 84
        ? ["Sorting the selected week", "Removing duplicates and grouping trades by market."]
        : ["Building your summary", "Calculating volume, active days and market breakdown."];
  const metrics = data ? [
    [range === "total" ? "Total volume" : "Weekly volume", compactMoney.format(data.summary.volume), "Eligible notional traded"],
    [range === "total" ? "Total points" : "Weekly points", pointsValue, range === "total" ? latestPoints === null ? "Add your first points snapshot below" : `Updated after Week ${savedWeeks[0]}` : week === 0 ? "Distributed on Friday after the week closes" : weeklyPoints === null ? "Add consecutive totals to calculate this week" : "Calculated from your saved totals"],
    ["Active days", String(data.summary.activeDays), range === "total" ? "Across the campaign" : "Out of 7 days"],
    ["Markets traded", String(data.summary.markets), data.accountIndexes.length > 1 ? `Across ${data.accountIndexes.length} linked accounts` : "Across your linked account"],
  ] : [];
  const periodTitle = range === "total"
    ? "Campaign total"
    : week === 0 ? "Current week" : `Week ${selectedCampaignWeek}`;
  const scenarioInputs = scenarioValues[priceScenario];
  const durationWeeks = weeksUntilMonthEnd(scenarioInputs.endMonth);
  const projectedProgramPoints = durationWeeks * scenarioInputs.weeklyPoints;
  const litPerPoint = projectedProgramPoints > 0 ? scenarioInputs.poolLit / projectedProgramPoints : 0;
  const dollarsPerPoint = litPerPoint * scenarioInputs.litPrice;
  const pointsToValue = latestPoints ?? 0;
  const estimatedUserLit = pointsToValue * litPerPoint;
  const estimatedUserValue = estimatedUserLit * scenarioInputs.litPrice;
  const cardPointNumber = range === "total" ? latestPoints : week === 0 ? null : weeklyPoints;
  const cardEstimatedValue = cardPointNumber === null ? null : cardPointNumber * dollarsPerPoint;
  const scenarioEstimates = (Object.keys(PRICE_SCENARIOS) as PriceScenario[]).map((scenario) => {
    const inputs = scenarioValues[scenario];
    const projectedPoints = weeksUntilMonthEnd(inputs.endMonth) * inputs.weeklyPoints;
    const pointValue = projectedPoints > 0 ? (inputs.poolLit / projectedPoints) * inputs.litPrice : 0;
    return { scenario, label: PRICE_SCENARIOS[scenario].label, pointValue, totalValue: cardPointNumber === null ? null : cardPointNumber * pointValue };
  });

  function updateScenario(field: keyof ScenarioInputs, rawValue: string) {
    if (field === "endMonth") {
      setScenarioValues((current) => ({ ...current, [priceScenario]: { ...current[priceScenario], endMonth: rawValue } }));
      return;
    }
    const value = Number(rawValue);
    setScenarioValues((current) => ({ ...current, [priceScenario]: { ...current[priceScenario], [field]: Number.isFinite(value) ? Math.max(0, value) : 0 } }));
  }

  async function downloadSummary() {
    if (!data) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 675;
    const context = canvas.getContext("2d");
    if (!context) return;

    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    const background = await loadImage(selectedBackground.src);
    context.drawImage(background, 0, 0, canvas.width, canvas.height);
    const character = await loadImage(activeCardImage);
    const characterHeight = 570;
    const characterWidth = character.width * (characterHeight / character.height);
    context.drawImage(character, Math.max(700, 1200 - characterWidth + 30), 24, characterWidth, characterHeight);
    const shade = context.createLinearGradient(0, 0, 820, 0);
    shade.addColorStop(0, "rgba(2,5,5,.98)");
    shade.addColorStop(.62, "rgba(2,5,5,.76)");
    shade.addColorStop(1, "rgba(2,5,5,.08)");
    context.fillStyle = shade;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const glow = context.createRadialGradient(1060, 0, 0, 1060, 0, 520);
    glow.addColorStop(0, "rgba(117,237,134,.22)");
    glow.addColorStop(1, "rgba(7,9,13,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#29312c";
    context.strokeRect(44, 44, 1112, 587);

    const lockup = await loadImage("/lighter-robinhood-lockup-transparent.png");
    context.drawImage(lockup, 82, 72, 204, 34);
    context.fillStyle = "rgba(18,35,24,.62)";
    context.strokeStyle = "rgba(117,237,134,.42)";
    context.lineWidth = 1;
    context.fillRect(82, 124, 150, 38);
    context.strokeRect(82, 124, 150, 38);
    context.fillStyle = "#f0f2ed";
    context.font = "700 18px Arial";
    context.fillText(periodTitle.toUpperCase(), 94, 150);
    context.fillStyle = "#75ed86";
    context.font = "700 100px Arial";
    context.fillText(pointsValue === "Pending" ? "PENDING" : `${pointsValue} PTS`, 76, 294);

    if (showEstimatedValue) {
      context.fillStyle = "rgba(5,10,8,.9)";
      context.strokeStyle = "rgba(117,237,134,.28)";
      context.fillRect(70, 316, 300, 104);
      context.strokeRect(70, 316, 300, 104);
      context.fillStyle = "#8c938e";
      context.font = "700 14px Arial";
      context.fillText(`${priceScenario.toUpperCase()} ESTIMATED VALUE`, 84, 342);
      context.fillStyle = "#d9f6dd";
      context.font = "700 34px Arial";
      context.fillText(cardEstimatedValue === null ? "PENDING" : compactMoney.format(cardEstimatedValue), 84, 382);
      context.fillStyle = "#69716b";
      context.font = "14px Arial";
      context.fillText(`${money.format(dollarsPerPoint)} estimated per point`, 84, 407);
    }

    const details = [
      ...(showVolume ? [[range === "total" ? "TOTAL VOLUME" : "PERIOD VOLUME", compactMoney.format(data.summary.volume)]] : []),
      ...(showTopMarket ? [["TOP MARKET", data.volumeByMarket[0]?.symbol ?? "—"]] : []),
      ...(showAverageTrade ? [["AVERAGE TRADE SIZE", money.format(data.summary.avgTradeSize)]] : []),
    ];
    const detailY = showEstimatedValue ? 472 : 397;
    const detailValueY = detailY + 45;
    const detailSlotWidth = details.length > 0 ? 610 / details.length : 610;
    details.forEach(([label, value], index) => {
      const x = 82 + index * detailSlotWidth;
      context.fillStyle = "rgba(5,10,8,.9)";
      context.strokeStyle = "rgba(117,237,134,.24)";
      context.fillRect(x - 12, detailY - 27, detailSlotWidth - 10, 86);
      context.strokeRect(x - 12, detailY - 27, detailSlotWidth - 10, 86);
      context.fillStyle = "#8c938e";
      context.font = "700 14px Arial";
      context.fillText(label, x, detailY);
      context.fillStyle = "#f0f2ed";
      context.font = "700 28px Arial";
      context.fillText(value, x, detailValueY);
    });
    if (showPeriod) {
      context.fillStyle = "#69716b";
      context.font = "16px Arial";
      context.fillText(formatCardPeriod(data.period.from, data.period.to), 82, 588);
    }
    if (showCreator) {
      const creatorLogo = await loadImage("/smart-drop-farmer-logo.png");
      context.globalAlpha = .42;
      context.drawImage(creatorLogo, 866, 562, 28, 28);
      context.fillText("Built by Smart Drop Farmer", 905, 582);
      context.globalAlpha = 1;
    }
    if (showWallet) {
      context.fillStyle = "#69716b";
      context.font = "14px Arial";
      context.textAlign = "right";
      context.fillText(`${data.wallet.slice(0, 6)}…${data.wallet.slice(-4)}`, 1115, 610);
      context.textAlign = "left";
    }

    const link = document.createElement("a");
    link.download = `lighter-${range === "total" ? "total" : `week-${selectedCampaignWeek}`}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" role="img" aria-label="Lighter" /><span>Lighter Weekly</span></div>
        <div className="topbar-actions"><a className="creator-credit" href={TWITTER_URL} rel="noreferrer" target="_blank"><span className="creator-logo" role="img" aria-label="Smart Drop Farmer" /><div><small>WEEKLY ALPHA BY</small><strong>Smart Drop Farmer ↗</strong></div></a><a className="referral-button" href={REFERRAL_URL} rel="noreferrer" target="_blank">Start farming ↗</a></div>
      </header>

      <section className="hero">
        <div className="hero-copy"><p className="eyebrow creator-eyebrow"><span className="creator-mini-logo" />SMART DROP FARMER · WEEKLY</p><h1>Your trading,<br /><em>week by week.</em></h1><p className="intro">Track volume and points across every Robinhood Lighter campaign week.</p></div>
        <a className="weekly-insight" href={WEEKLY_STRATEGY_URL} rel="noreferrer" target="_blank"><span className="weekly-insight-kicker"><i className="creator-mini-logo" />THIS WEEK&apos;S STRATEGY</span><strong>How I&apos;m approaching the current points week</strong><small>Read the latest breakdown from @SmartDropFarmer <b>↗</b></small></a>
        <form className="account-form" onSubmit={handleSubmit}>
          <label htmlFor="wallet">Wallet address</label>
          <div><input id="wallet" autoComplete="off" placeholder="0x…" type="text" value={walletInput} onChange={(event) => setWalletInput(event.target.value)} /><button type="submit">View stats</button></div>
          <p>New to Robinhood Lighter? <a href={REFERRAL_URL} rel="noreferrer" target="_blank">Join with code SMART ↗</a> <span>· Referral link; the creator may benefit.</span></p>
        </form>
      </section>

      {error && <div className="notice error">{error}</div>}

      {!wallet ? (
        <section className="empty-state"><span className="empty-icon">↗</span><h2>Explore your activity</h2><p>Paste your wallet to see weekly volume, points and markets.</p></section>
      ) : <>
        <section className="period-nav">
          <div className="period-heading"><strong>{range === "total" ? "All-time campaign" : week === 0 ? "Current week" : `Campaign week ${currentCampaignWeek - week}`}</strong><span>{data ? formatPeriod(data.period.from, data.period.to) : "Loading period…"}</span></div>
          <div className="period-selector">
            <button className={`period-button total ${range === "total" ? "active" : ""}`} onClick={() => selectPeriod(0, "total")}>Total</button>
            {weekOptions.map((offset) => <button className={`period-button ${range === "week" && week === offset ? "active" : ""}`} key={offset} onClick={() => selectPeriod(offset, "week")}>{offset === 0 ? "Current" : `Week ${currentCampaignWeek - offset}`}</button>)}
          </div>
          <div className="points-window-note"><span>HOW WEEKLY POINTS WORK</span><strong>Friday&apos;s points drop rewards the trading volume generated from Wednesday through Tuesday.</strong></div>
        </section>

        <section className="points-tracker">
          <div className="points-copy"><p className="eyebrow">POINTS TRACKER</p><h2>Enter each week&apos;s final cumulative total once</h2><p>Start by saving the total you had after each completed campaign week. The browser remembers it for this wallet. From then on, simply add your new cumulative total after every distribution and we calculate the points earned during each week.</p><div className="points-how"><span><b>1</b> Choose the completed week</span><span><b>2</b> Enter your total points</span><span><b>3</b> Save once — we do the maths</span></div></div>
          <form className="points-form" onSubmit={savePointSnapshot}>
            <label><span>After</span><select value={pointWeek} onChange={(event) => setPointWeek(Number(event.target.value))}>{Array.from({ length: Math.max(0, currentCampaignWeek - 1) }, (_, index) => index + 1).reverse().map((campaignWeek) => <option key={campaignWeek} value={campaignWeek}>Week {campaignWeek}</option>)}</select></label>
            <label><span>Total points</span><input inputMode="decimal" min="0" step="any" placeholder="e.g. 40" type="number" value={pointTotal} onChange={(event) => setPointTotal(event.target.value)} /></label>
            <button type="submit">Save total</button>
          </form>
          <div className="points-storage-note"><span>Saved only in this browser and device.</span><div><button onClick={exportPointSnapshots} type="button">Export backup</button><button onClick={() => pointsImportRef.current?.click()} type="button">Import backup</button><input accept="application/json" onChange={importPointSnapshots} ref={pointsImportRef} type="file" /></div></div>
          {savedWeeks.length > 0 && <div className="snapshot-list">{savedWeeks.map((campaignWeek) => <div className="snapshot-item" key={campaignWeek}><button onClick={() => { setPointWeek(campaignWeek); setPointTotal(String(pointSnapshots[campaignWeek])); }}><span>Week {campaignWeek}</span><strong>{pointSnapshots[campaignWeek].toLocaleString("en-US", { maximumFractionDigits: 3 })} pts</strong></button><button aria-label={`Delete Week ${campaignWeek} points`} className="snapshot-delete" onClick={() => removePointSnapshot(campaignWeek)}>×</button></div>)}</div>}
        </section>

        {loading && <section className="progress-card" aria-live="polite">
          <div className="progress-orbit" style={{ background: `conic-gradient(var(--green) ${progress * 3.6}deg, #263129 0deg)` }}><i style={{ transform: `rotate(${progress * 3.6}deg)` }} /><span>{Math.round(progress)}%</span></div>
          <div className="progress-copy"><p className="eyebrow">BUILDING YOUR WEEK</p><h2>{progressStep[0]}</h2><p>{progressStep[1]}</p><p className="crypto-quip">“{cryptoLoadingLine}”</p><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><small>{elapsedMs < estimatedMs ? `About ${secondsLeft}s remaining` : "Almost there — this wallet has more activity than usual"} · {Math.floor(elapsedMs / 1000)}s elapsed</small></div>
          <div className="progress-steps">
            {["Accounts", "Trades", "Week", "Summary"].map((label, index) => <span className={progress >= [6, 24, 67, 84][index] ? "done" : ""} key={label}><i />{label}</span>)}
          </div>
        </section>}

        {loading && !data ? null : data ? <>
          {data.dataCompleteness === "partial" && <div className="notice warning"><strong>Partial data:</strong> this wallet reached the explorer history limit. Values may be lower than the complete total.</div>}
          <section className={`metrics ${loading ? "refreshing" : ""}`}>
            {metrics.map(([label, value, note]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
          </section>
          <section className="points-desk">
            <div className="points-desk-heading"><div><p className="eyebrow">POINT VALUE LAB</p><h2>What could one point be worth?</h2><p>Explore hypothetical outcomes using the 11M LIT community pool and an estimated 72,500 points distributed each week.</p></div><span>ESTIMATE · NOT A GUARANTEE</span></div>
            <div className="scenario-tabs">
              {(Object.keys(PRICE_SCENARIOS) as PriceScenario[]).map((scenario) => <button className={priceScenario === scenario ? "active" : ""} key={scenario} onClick={() => setPriceScenario(scenario)}><strong>{PRICE_SCENARIOS[scenario].label}</strong><small>{PRICE_SCENARIOS[scenario].note}</small></button>)}
            </div>
            <div className="points-desk-grid">
              <div className="scenario-controls">
                <label><span>Campaign end month</span><div><select onChange={(event) => updateScenario("endMonth", event.target.value)} value={scenarioInputs.endMonth}>{END_MONTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><small className="calculated-weeks">{durationWeeks} weeks from campaign start</small></label>
                <label><span>Estimated LIT price</span><div><b>$</b><input inputMode="decimal" min="0" onChange={(event) => updateScenario("litPrice", event.target.value)} step="0.01" type="number" value={scenarioInputs.litPrice} /></div></label>
                <label><span>Community pool</span><div><input inputMode="numeric" min="0" onChange={(event) => updateScenario("poolLit", event.target.value)} type="number" value={scenarioInputs.poolLit} /><b>LIT</b></div></label>
                <label><span>Points distributed weekly</span><div><input inputMode="numeric" min="1" onChange={(event) => updateScenario("weeklyPoints", event.target.value)} type="number" value={scenarioInputs.weeklyPoints} /><b>pts</b></div></label>
              </div>
              <div className="point-value-result"><span>ONE POINT COULD BE WORTH</span><strong>{money.format(dollarsPerPoint)}</strong><p>≈ {litPerPoint.toLocaleString("en-US", { maximumFractionDigits: 3 })} LIT per point</p><small>11M LIT ÷ {compactNumber(projectedProgramPoints)} projected program points</small></div>
              <div className="estimate-breakdown">
                <div><span>Projected points issued</span><strong>{compactNumber(projectedProgramPoints)}</strong></div>
                <div><span>Pool value</span><strong>{compactMoney.format(scenarioInputs.poolLit * scenarioInputs.litPrice)}</strong></div>
                <div><span>Your saved points</span><strong>{latestPoints === null ? "Not added" : compactNumber(pointsToValue)}</strong></div>
                <div><span>Your hypothetical value</span><strong>{latestPoints === null ? "—" : compactMoney.format(estimatedUserValue)}</strong><small>{latestPoints === null ? "Save a cumulative points total above" : `≈ ${estimatedUserLit.toLocaleString("en-US", { maximumFractionDigits: 2 })} LIT`}</small></div>
              </div>
            </div>
            <div className="points-desk-note"><b>Known:</b> Lighter announced an 11M LIT allocation to the Robinhood community. <b>Assumptions:</b> token price, campaign duration and future weekly point issuance. Robinhood Wallet&apos;s 2× earning rate changes how quickly users earn points, not this estimated redemption value per point. Updated September 2026. For information only — not financial advice and not a guaranteed token allocation or valuation.</div>
          </section>
          <section className="detail-grid">
            <article className="panel markets-panel">
              <div className="panel-title"><div><p className="eyebrow">BREAKDOWN</p><h2>Volume by market</h2></div><span>{data.summary.markets} markets</span></div>
              {data.volumeByMarket.length === 0 ? <p className="no-data">No trades found during this period.</p> : <div className="market-list">{data.volumeByMarket.slice(0, 6).map((market) => <div className="market-row" key={market.marketId}><span className="market-symbol">{market.symbol}</span><div className="bar-track"><i style={{ width: `${maxMarketVolume > 0 ? (market.volume / maxMarketVolume) * 100 : 0}%` }} /></div><strong>{compactMoney.format(market.volume)}</strong></div>)}</div>}
            </article>
            <article className="panel execution-panel" style={{ backgroundImage: `linear-gradient(90deg, rgba(4,7,7,.98), rgba(4,7,7,.79) 62%, rgba(4,7,7,.22)), url(${selectedBackground.src})` }}>
              <span className="highlight-character" style={{ backgroundImage: `url(${activeCardImage})` }} />
              <div className="panel-title highlight-title"><div><span className="highlight-lockup" role="img" aria-label="Robinhood Chain and Lighter" /><h2>{periodTitle}</h2><small>{formatCardPeriod(data.period.from, data.period.to)}</small></div><button className="download-button" onClick={() => setShareOpen(true)}>↗ Share card</button></div>
              <div className="highlight-points"><span>{range === "total" ? "Total points" : `${periodTitle} points`}</span><strong>{pointsValue === "Pending" ? "PENDING" : `${pointsValue} PTS`}</strong></div>
              <div className="highlight-volume"><span>{range === "total" ? "Total estimated value" : `${periodTitle} value`} · {priceScenario}</span><strong>{cardEstimatedValue === null ? "PENDING" : compactMoney.format(cardEstimatedValue)}</strong></div>
              <div className="highlight-grid scenario-comparison">{scenarioEstimates.map((estimate) => <div key={estimate.scenario}><span>{estimate.label} estimate</span><strong>{estimate.totalValue === null ? "—" : compactMoney.format(estimate.totalValue)}</strong><small>{money.format(estimate.pointValue)} / point</small></div>)}</div>
              <div className="inline-backgrounds"><span>Choose style</span><div>{SHARE_BACKGROUNDS.map((backgroundOption) => <button aria-label={backgroundOption.label} aria-pressed={selectedBackground.id === backgroundOption.id} className={selectedBackground.id === backgroundOption.id ? "active" : ""} key={backgroundOption.id} onClick={() => setShareBackground(backgroundOption.src)} style={{ backgroundImage: `url(${backgroundOption.thumb})` }} />)}</div></div>
            </article>
          </section>
        </> : null}
      </>}
      {shareOpen && data && <div className="share-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareOpen(false); }} role="dialog" aria-modal="true" aria-label="Customize share card">
        <div className="share-dialog" onKeyDown={handleShareDialogKeyDown} ref={shareDialogRef} tabIndex={-1}>
          <div className="share-dialog-title"><div><p className="eyebrow">SHARE CARD</p><h2>Make this week yours</h2></div><button aria-label="Close" onClick={() => setShareOpen(false)}>×</button></div>
          <div className="share-preview" style={{ backgroundImage: `linear-gradient(90deg, rgba(2,5,5,.98), rgba(2,5,5,.72) 58%, rgba(2,5,5,.08)), url(${selectedBackground.src})` }}>
            <span className="share-character" style={{ backgroundImage: `url(${activeCardImage})` }} />
            <div className="share-brand"><span className="share-logo" role="img" aria-label="Robinhood Chain and Lighter" /><strong>{periodTitle}</strong></div>
            <div className="share-points">{pointsValue === "Pending" ? "PENDING" : `${pointsValue} PTS`}</div>
            {showEstimatedValue && <div className="share-estimate"><span>{priceScenario.toUpperCase()} ESTIMATED VALUE</span><strong>{cardEstimatedValue === null ? "PENDING" : compactMoney.format(cardEstimatedValue)}</strong><small>{money.format(dollarsPerPoint)} estimated per point</small></div>}
            {(showVolume || showTopMarket || showAverageTrade) && <div className="share-stats">{showVolume && <div><span>{range === "total" ? "TOTAL VOLUME" : "PERIOD VOLUME"}</span><strong>{compactMoney.format(data.summary.volume)}</strong></div>}{showTopMarket && <div><span>TOP MARKET</span><strong>{data.volumeByMarket[0]?.symbol ?? "—"}</strong></div>}{showAverageTrade && <div><span>AVERAGE TRADE SIZE</span><strong>{money.format(data.summary.avgTradeSize)}</strong></div>}</div>}
            {showPeriod && <small>{formatCardPeriod(data.period.from, data.period.to)}</small>}{showCreator && <b><span className="share-creator-logo" />Built by Smart Drop Farmer</b>}{showWallet && <em className="share-wallet">{data.wallet.slice(0, 6)}…{data.wallet.slice(-4)}</em>}
          </div>
          <div className="card-controls"><div className="card-control-heading"><span>CARD CONTENT</span><small>Points always stay visible</small></div><div className="card-option-grid">
            <button aria-pressed={showEstimatedValue} className={showEstimatedValue ? "active" : ""} onClick={() => setShowEstimatedValue((value) => !value)}>Estimated value</button>
            <button aria-pressed={showVolume} className={showVolume ? "active" : ""} onClick={() => setShowVolume((value) => !value)}>Volume</button>
            <button aria-pressed={showTopMarket} className={showTopMarket ? "active" : ""} onClick={() => setShowTopMarket((value) => !value)}>Top market</button>
            <button aria-pressed={showAverageTrade} className={showAverageTrade ? "active" : ""} onClick={() => setShowAverageTrade((value) => !value)}>Average trade</button>
            <button aria-pressed={showPeriod} className={showPeriod ? "active" : ""} onClick={() => setShowPeriod((value) => !value)}>Dates</button>
            <button aria-pressed={showCreator} className={showCreator ? "active" : ""} onClick={() => setShowCreator((value) => !value)}>Creator credit</button>
            <button aria-pressed={showWallet} className={showWallet ? "active" : ""} onClick={() => setShowWallet((value) => !value)}>Wallet</button>
          </div></div>
          <div className="card-scenario-picker"><span>VALUE SCENARIO</span><div>{(Object.keys(PRICE_SCENARIOS) as PriceScenario[]).map((scenario) => <button className={priceScenario === scenario ? "active" : ""} key={scenario} onClick={() => setPriceScenario(scenario)}>{PRICE_SCENARIOS[scenario].label}<small>{money.format(scenarioValues[scenario].litPrice)} · {weeksUntilMonthEnd(scenarioValues[scenario].endMonth)}w</small></button>)}</div><div className="card-scenario-settings"><label><span>LIT price</span><div><b>$</b><input min="0" onChange={(event) => updateScenario("litPrice", event.target.value)} step="0.1" type="number" value={scenarioInputs.litPrice} /></div></label><label><span>End month</span><div><select onChange={(event) => updateScenario("endMonth", event.target.value)} value={scenarioInputs.endMonth}>{END_MONTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><small>{durationWeeks} weeks total</small></label><label><span>Weekly points</span><div><input min="1" onChange={(event) => updateScenario("weeklyPoints", event.target.value)} type="number" value={scenarioInputs.weeklyPoints} /><b>pts</b></div></label></div></div>
          <div className="background-picker"><span>CARD STYLE · AUTO-SELECTED BY POINTS</span><div>{SHARE_BACKGROUNDS.map((backgroundOption) => <button aria-label={backgroundOption.label} aria-pressed={selectedBackground.id === backgroundOption.id} className={selectedBackground.id === backgroundOption.id ? "active" : ""} key={backgroundOption.id} onClick={() => setShareBackground(backgroundOption.src)} style={{ backgroundImage: `url(${backgroundOption.thumb})` }} />)}</div></div>
          <div className="custom-image-control">
            <div><strong>Custom artwork</strong><small>PNG, JPEG or WebP · Maximum 5 MB · Processed locally</small></div>
            <div><label htmlFor="custom-card-image">{customCardImage ? "Replace image" : "Upload image"}</label><input accept="image/png,image/jpeg,image/webp" id="custom-card-image" onChange={uploadCardImage} type="file" />{customCardImage && <button onClick={() => setCustomCardImage(null)}>Use default</button>}</div>
          </div>
          <button className="save-card-button" onClick={() => void downloadSummary()}>Download card</button>
        </div>
      </div>}
      <footer className="site-footer"><span>Independent community analytics tool · Not affiliated with Robinhood or Lighter.</span><a href={TWITTER_URL} rel="noreferrer" target="_blank">Built by Smart Drop Farmer ↗</a></footer>
    </main>
  );
}
